import { parseArgs } from 'node:util'
import type { Writable } from 'node:stream'
import { sweepScratch } from '../scratch/sweep.js'

const HELP = `dshx scratch sweep — stop scratch DSH Hosts nobody owns any more, and prune old scratch state.

Stops (SIGTERM, then SIGKILL after a few seconds) the process group of every scratch Host whose registry record
(\${TMPDIR}/dshx-scratch/<pid>.json) names an owner that is gone — its pid exited or now belongs to another process —
after checking its command line still carries "--profile dshx-boot". Also stops "--profile dshx-boot" processes with no
record, parent pid 1 and over 2 h old (Hosts leaked before the registry existed). Drops records of Hosts that already
exited, deletes \${TMPDIR}/dshx-dev/<name> state dirs untouched for 24 h with no live process, and keeps each
instance's newest 20 evidence runs. The live DSH runs another profile and is never touched.

Options:
  --dry-run            List what would be stopped and removed; change nothing.
  --json               Print { schemaVersion, command, ok, data: { actions, live, leftRunning } }.
  -h, --help           Show this help.
`

export const runScratchSweepCli = async (argv: readonly string[], io: { readonly stdout: Writable; readonly stderr: Writable }): Promise<number> => {
  let values: { readonly 'dry-run'?: boolean; readonly json?: boolean; readonly help?: boolean }
  let positionals: readonly string[]
  try {
    ;({ values, positionals } = parseArgs({
      args: [...argv],
      allowPositionals: true,
      strict: true,
      options: { 'dry-run': { type: 'boolean' }, json: { type: 'boolean' }, help: { type: 'boolean', short: 'h' } },
    }))
  } catch (error) {
    io.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n  fix: run "dshx scratch sweep --help".\n`)
    return 2
  }
  if (values.help === true || positionals[0] !== 'sweep' || positionals.length !== 1) {
    io[values.help === true ? 'stdout' : 'stderr'].write(HELP)
    return values.help === true ? 0 : 2
  }
  const dryRun = values['dry-run'] === true
  const result = await sweepScratch({ dryRun })
  const ok = result.leftRunning.length === 0
  if (values.json === true) {
    io.stdout.write(`${JSON.stringify({ schemaVersion: 1, command: 'scratch sweep', ok, data: { dryRun, ...result } }, null, 2)}\n`)
    return ok ? 0 : 1
  }
  const lines = result.actions.map(action => `  ${dryRun ? 'would ' : ''}${action.kind.padEnd(19)} ${action.target} — ${action.reason}`)
  io.stdout.write(
    `${result.actions.length === 0 ? 'Nothing to sweep.' : `${dryRun ? 'Would sweep' : 'Swept'} ${String(result.actions.length)} item(s):`}\n${lines.map(line => `${line}\n`).join('')}` +
      `${String(result.live.length)} scratch Host(s) still owned.\n` +
      (ok ? '' : `Still running after SIGKILL: ${result.leftRunning.join(', ')}. Check them with "ps -o pid,ppid,command -p <pid>".\n`),
  )
  return ok ? 0 : 1
}
