import { parseArgs } from 'node:util'
import type { Writable } from 'node:stream'
import { CheckoutSyncError } from '../checkout/rebuild.js'
import { syncCheckout, type CheckoutSyncResult } from '../checkout/sync.js'

const HELP = `dshx checkout sync — bring the jj checkout that runs DSH onto main.

Work lands on main from other workspaces, but the checkout "dsh web" runs from (the "default" workspace)
stays on the old main. This rebases that workspace's working copy onto the bookmark from its own
directory (jj rebase -r @, or -b @ when it has ancestors off main), keeping local undescribed edits and
dropping described revisions main already holds. It refuses described work main lacks, undoes a
conflicting rebase, then runs pnpm install where a lockfile changed and rebuilds dshx and the plugins
whose sources changed (plus their dependants). It reports which plugins changed and whether DSH needs a
restart (Host bundle, manifest or profile changes) or picks the change up over HMR (client bundles).
It never restarts DSH.

Options:
  --workspace <name>   jj workspace to sync (default "default").
  --bookmark <name>    Bookmark to move onto (default "main").
  --cwd <dir>          Any directory inside the repository (default: the current directory).
  --dry-run            Report what would move, install and rebuild; files and the repository stay as they are.
  --json               Print one JSON envelope: { schemaVersion, command, ok, data | error: { code, message, hint } }.
  -h, --help           Show this help.

Exit codes: 0 synced or up to date, 1 refused, conflicted, build failed or error, 2 usage.`

const write = (stream: Writable, text: string): void => {
  stream.write(text)
}

const list = (items: readonly string[]): string => (items.length === 0 ? 'none' : items.join(', '))

const humanReport = (result: CheckoutSyncResult): string => {
  const lines = [`${result.workspace} (${result.path}): ${result.status}${result.dryRun ? ' (dry run)' : ''}`]
  if (result.updatedStale) lines.push('  updated its stale working copy')
  if (result.kept.length > 0) lines.push(`  kept       ${result.kept.map(revision => revision.changeId).join(', ')}`)
  if (result.absorbed.length > 0) lines.push(`  absorbed   ${result.absorbed.map(revision => `${revision.changeId} ${revision.description}`).join('; ')}`)
  if (result.unlanded.length > 0) lines.push(`  unlanded   ${result.unlanded.map(revision => `${revision.changeId} ${revision.description}`).join('; ')}`)
  if (result.conflicts.length > 0) lines.push(`  conflicts  ${list(result.conflicts)}`)
  if (result.status === 'synced' || result.status === 'would-sync' || result.status === 'build-failed') {
    lines.push(`  files      ${String(result.changedFiles.length)} changed between ${result.from?.slice(0, 12) ?? 'root'} and ${result.to.slice(0, 12)}`)
    lines.push(`  install    ${list(result.installs)}`)
    lines.push(`  rebuild    ${list([...(result.rebuilt.dshx ? ['dshx'] : []), ...result.rebuilt.plugins])}`)
    const hot = result.plugins.filter(plugin => plugin.client && !plugin.host).map(plugin => plugin.name)
    if (hot.length > 0) lines.push(`  hmr        ${list(hot)}`)
    lines.push(result.restart.needed ? `  restart    needed: ${result.restart.reasons.join('; ')}` : '  restart    not needed')
  }
  if (result.failure !== null)
    lines.push(
      `  failed     ${result.failure.step}\n${result.failure.output
        .trim()
        .split('\n')
        .slice(-15)
        .map(line => `    ${line}`)
        .join('\n')}`,
    )
  if (result.hint !== null) lines.push(`fix: ${result.hint}`)
  return `${lines.join('\n')}\n`
}

export const runCheckoutCli = async (argv: readonly string[], io: { readonly stdout: Writable; readonly stderr: Writable }): Promise<number> => {
  const action = argv[0] ?? ''
  const command = `checkout ${action}`.trim()
  const json = argv.includes('--json')
  const fail = (error: CheckoutSyncError): number => {
    if (json)
      write(
        io.stdout,
        `${JSON.stringify({ schemaVersion: 1, command, ok: false, error: { code: error.code, message: error.message, hint: error.hint } }, null, 2)}\n`,
      )
    else write(io.stderr, `error: ${error.message}\n  fix: ${error.hint}\n`)
    return error.code === 'usage' ? 2 : 1
  }
  if (action === '--help' || action === '-h' || (action === 'sync' && (argv.includes('--help') || argv.includes('-h')))) {
    write(io.stdout, `${HELP}\n`)
    return 0
  }
  if (action !== 'sync') return fail(new CheckoutSyncError('usage', `Unknown checkout action "${action}".`, 'Run "dshx checkout sync --help".'))

  const parse = () =>
    parseArgs({
      args: argv.slice(1),
      strict: true,
      options: {
        workspace: { type: 'string', default: 'default' },
        bookmark: { type: 'string', default: 'main' },
        cwd: { type: 'string' },
        'dry-run': { type: 'boolean' },
        json: { type: 'boolean' },
      },
    }).values
  let values: ReturnType<typeof parse>
  try {
    values = parse()
  } catch (error) {
    return fail(new CheckoutSyncError('usage', error instanceof Error ? error.message : String(error), 'Run "dshx checkout sync --help".'))
  }
  const names = /^[A-Za-z0-9._-]+$/
  if (!names.test(values.workspace) || !names.test(values.bookmark))
    return fail(new CheckoutSyncError('usage', '--workspace and --bookmark take a plain jj name.', 'Use e.g. --workspace default --bookmark main.'))

  try {
    const result = await syncCheckout({
      cwd: values.cwd ?? process.cwd(),
      workspace: values.workspace,
      bookmark: values.bookmark,
      dryRun: values['dry-run'] === true,
      onProgress: message => write(io.stderr, `dshx checkout sync: ${message}\n`),
      onOutput: chunk => write(io.stderr, chunk),
    })
    const ok = result.status === 'synced' || result.status === 'up-to-date' || result.status === 'would-sync'
    write(io.stdout, json ? `${JSON.stringify({ schemaVersion: 1, command, ok, data: result }, null, 2)}\n` : humanReport(result))
    return ok ? 0 : 1
  } catch (error) {
    if (error instanceof CheckoutSyncError) return fail(error)
    return fail(new CheckoutSyncError('failed', error instanceof Error ? error.message : String(error), 'Re-run with --json and read the reported step.'))
  }
}
