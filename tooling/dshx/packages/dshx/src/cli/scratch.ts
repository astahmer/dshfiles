import { parseArgs } from 'node:util'
import type { Writable } from 'node:stream'
import { ScratchError, publicState, readScratchState, resolveStateDir, scratchNameSchema } from '../scratch/state.js'

export const SCRATCH_ACTIONS: ReadonlySet<string> = new Set(['up', 'doctor', 'open', 'shot', 'down'])

const COMMON_HELP = `Common options:
  --name <name>        Scratch instance name (default "default"); several can run side by side.
  --state-dir <dir>    Where the state file, logs and evidence live (default $TMPDIR/dshx-dev/<name>).
  --json               Print one JSON envelope: { schemaVersion, command, ok, data | error: { code, message, hint } }.
  -h, --help           Show help for the action.`

const HELP: Readonly<Record<string, string>> = {
  overview: `dshx dev <up|doctor|open|shot|down> — drive a scratch DSH for verification.

A scratch DSH has its own temp DSH_HOME, a free port, the owned plugins under test, a registered
project, and a headless Chromium that keeps its page between commands. It never touches the live
DSH on 127.0.0.1:3080 or ~/.dsh. The launch URL is a secret: it stays in the mode-600 state file.

  dshx dev up [--plugin @dshfiles/<name>]...   start it (builds the plugins, seeds a jj project)
  dshx dev doctor                              read-only health check
  dshx dev open <feature>                      walk a catalog feature's "reach" steps in the browser
  dshx dev shot [--label <label>]              screenshot + console/network error summary
  dshx dev down [--dry-run]                    stop what up started, delete the scratch home

Run "dshx dev <action> --help" for details.

${COMMON_HELP}

Plugin dev session (no action):
  dshx dev [--cwd <path>] [--port <port>] [--open] [--verbose] [--quiet] [--no-color]

Run from a plugin project: checks compatibility, links the project into the profile its manifest
names (in the current DSH home, not a scratch one), rebuilds on change and runs dsh on --port
(0 lets the OS choose).
  --cwd <path>         Run from a different project directory.
  --open               Open the development URL.
  --verbose            Print underlying command failures.
  --quiet              Suppress human-readable output; retain exit status.`,
  up: `dshx dev up — start a scratch DSH.

Builds the selected owned plugins (and the client bundles they load), installs a disposable profile
from ~/.dsh/profiles/web's registry dependencies, seeds a jj project with a "main" bookmark (or
registers --project) in the scratch workspace storage, starts dsh on a free port and a headless
Chromium, and records pids, origin and paths in <state-dir>/state.json (mode 600).

Options:
  --plugin <id>        Owned bundle to load, repeatable (default: every bundle under plugins/@dshfiles).
  --project <dir>      Register this folder instead of seeding a sample jj project; down keeps it.
  --port <port>        Host port (default: a free one; 3080 is refused).
  --skip-build         Use each plugin's existing dist/.
  --timeout <ms>       Boot timeout (default 120000).

Example:
  dshx dev up --plugin @dshfiles/jj-integration --plugin @dshfiles/home --json

${COMMON_HELP}`,
  doctor: `dshx dev doctor — read-only health check of a scratch DSH.

Checks: isolated from the live DSH, dsh and Chromium still running (and still ours), the URL answers
and authenticates, every plugin entry is active and every bundle under test loaded, and the host log
has no error lines. Exit code 1 when any check fails; each failure carries a "fix".

${COMMON_HELP}`,
  open: `dshx dev open <feature> — drive the scratch browser to a catalog feature.

<feature> is a feature id from a plugins/@dshfiles/*/dshx.features.json catalog, optionally
qualified: "thread-destination", "jj-integration/thread-destination" or
"@dshfiles/jj-integration#thread-destination". Navigates to the app root, dismisses the Preview
Notice and "Add an API key" dialogs, then runs the feature's "reach" steps:
  click <role|text|label> "<name>"   fill <role|label> "<name>" "<value>"
  expect <role|text|label> "<name>"  press <key>
Names match exactly; "name*" matches a case-insensitive substring. "text" without "*" is exact too.
A failing step stops the walk, saves a screenshot and exits 1: fix the catalog when the UI path
moved, report a regression when the feature broke (skill maintain-verify-dsh).

Options:
  --timeout <ms>       Per-step timeout (default 15000).

${COMMON_HELP}`,
  shot: `dshx dev shot — capture evidence from the scratch browser.

Saves <evidence-dir>/<time>-<label>.png and a .json summary of console errors, page errors, failed
requests and HTTP >= 400 responses recorded since up (launch tokens redacted).

Options:
  --label <label>      File name label (default "shot").
  --out <dir>          Evidence directory (default <state-dir>/evidence; down keeps it).

${COMMON_HELP}`,
  down: `dshx dev down — stop exactly what up started.

Stops the recorded dsh and Chromium process groups only while their command lines still match what
up started (a reused pid is left alone), deletes the scratch home and the state/log files, and keeps
the evidence directory and any --project folder.

Options:
  --dry-run            List what would be stopped and removed; change nothing.

${COMMON_HELP}`,
}

const write = (stream: Writable, text: string): void => {
  stream.write(text)
}

export const runScratchCli = async (argv: readonly string[], io: { readonly stdout: Writable; readonly stderr: Writable }): Promise<number> => {
  const action = argv[0] ?? ''
  const command = `dev ${action}`
  const json = argv.includes('--json')
  const fail = (error: ScratchError): number => {
    if (json)
      write(
        io.stdout,
        `${JSON.stringify({ schemaVersion: 1, command, ok: false, error: { code: error.code, message: error.message, hint: error.hint } }, null, 2)}\n`,
      )
    else write(io.stderr, `error: ${error.message}\n  fix: ${error.hint}\n`)
    return error.code === 'usage' ? 2 : 1
  }
  const succeed = (data: unknown, human: string, ok = true): number => {
    write(io.stdout, json ? `${JSON.stringify({ schemaVersion: 1, command, ok, data }, null, 2)}\n` : human)
    return ok ? 0 : 1
  }

  let values: { [name: string]: string | boolean | string[] | undefined }
  let positionals: string[]
  try {
    ;({ values, positionals } = parseArgs({
      args: argv.slice(1),
      allowPositionals: true,
      strict: true,
      options: {
        name: { type: 'string', default: 'default' },
        'state-dir': { type: 'string' },
        json: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
        plugin: { type: 'string', multiple: true },
        project: { type: 'string' },
        port: { type: 'string' },
        'skip-build': { type: 'boolean' },
        timeout: { type: 'string' },
        label: { type: 'string' },
        out: { type: 'string' },
        'dry-run': { type: 'boolean' },
      },
    }))
  } catch (error) {
    return fail(new ScratchError('usage', error instanceof Error ? error.message : String(error), `Run "dshx dev ${action} --help".`))
  }
  if (values.help === true) {
    write(io.stdout, `${HELP[action] ?? HELP.overview}\n`)
    return 0
  }
  const allowed: Readonly<Record<string, readonly string[]>> = {
    up: ['plugin', 'project', 'port', 'skip-build', 'timeout'],
    doctor: [],
    open: ['timeout'],
    shot: ['label', 'out'],
    down: ['dry-run'],
  }
  const common = ['name', 'state-dir', 'json', 'help']
  const misplaced = Object.keys(values).filter(option => values[option] !== undefined && !common.includes(option) && !(allowed[action] ?? []).includes(option))
  if (misplaced.length > 0) return fail(new ScratchError('usage', `--${misplaced[0]} is not an option of dev ${action}.`, `Run "dshx dev ${action} --help".`))
  if (action === 'open' ? positionals.length !== 1 : positionals.length > 0) {
    return fail(
      new ScratchError(
        'usage',
        action === 'open' ? 'dev open takes exactly one feature id.' : `dev ${action} takes no positional arguments.`,
        `Run "dshx dev ${action} --help".`,
      ),
    )
  }
  const name = scratchNameSchema.safeParse(values.name)
  if (!name.success)
    return fail(new ScratchError('usage', `--name ${String(values.name)}: ${name.error.issues[0]?.message ?? 'invalid'}.`, 'Use e.g. --name jj-check.'))
  const numberOption = (option: string, fallback: number): number | ScratchError => {
    const raw = values[option]
    if (raw === undefined) return fallback
    const parsed = Number(raw)
    return Number.isSafeInteger(parsed) && parsed > 0
      ? parsed
      : new ScratchError('usage', `--${option} requires a positive integer.`, `Run "dshx dev ${action} --help".`)
  }
  const stateDir = resolveStateDir({ name: name.data, ...(typeof values['state-dir'] === 'string' ? { stateDir: values['state-dir'] } : {}) })

  try {
    if (action === 'up') {
      const timeoutMs = numberOption('timeout', 120_000)
      if (timeoutMs instanceof ScratchError) return fail(timeoutMs)
      const port = values.port === undefined ? undefined : numberOption('port', 0)
      if (port instanceof ScratchError) return fail(port)
      const { scratchUp } = await import('../scratch/up.js')
      const state = await scratchUp({
        name: name.data,
        stateDir,
        plugins: Array.isArray(values.plugin) ? values.plugin : [],
        ...(typeof values.project === 'string' ? { project: values.project } : {}),
        ...(port === undefined ? {} : { port }),
        skipBuild: values['skip-build'] === true,
        timeoutMs,
        onProgress: message => write(io.stderr, `dshx dev up: ${message}\n`),
      })
      const shown = publicState(state)
      return succeed(
        shown,
        `Scratch DSH "${shown.name}" up at ${shown.origin} (dsh pid ${shown.hostPid}, chromium pid ${shown.browserPid}).\n  home     ${shown.home}\n  project  ${shown.project}\n  state    ${shown.stateDir}\nNext: dshx dev doctor\n`,
      )
    }
    const state = await readScratchState(stateDir, name.data)
    if (action === 'doctor') {
      const { scratchDoctor } = await import('../scratch/lifecycle.js')
      const checks = await scratchDoctor(state)
      const ok = checks.every(check => check.ok)
      return succeed(
        { name: state.name, origin: state.origin, checks },
        `${checks.map(check => `${check.ok ? 'ok  ' : 'FAIL'} ${check.id}: ${check.detail}${check.fix === undefined ? '' : `\n     fix: ${check.fix}`}`).join('\n')}\n`,
        ok,
      )
    }
    if (action === 'open') {
      const timeoutMs = numberOption('timeout', 15_000)
      if (timeoutMs instanceof ScratchError) return fail(timeoutMs)
      const { scratchOpen } = await import('../scratch/drive.js')
      const result = await scratchOpen(state, positionals[0] ?? '', timeoutMs)
      const lines = result.steps.map(
        step => `${step.ok ? 'ok  ' : 'FAIL'} ${step.step} (${step.ms} ms)${step.error === undefined ? '' : `\n     ${step.error}`}`,
      )
      const footer = result.ok
        ? `Reached ${result.packageId}#${result.feature}. Next: dshx dev shot --label ${result.feature}\n`
        : `Could not reach ${result.packageId}#${result.feature}; screenshot ${result.failureShot ?? 'not saved'}.\nfix: if the UI path moved, update "reach" in ${result.catalogFile}; if the feature broke, report it (skill maintain-verify-dsh).\n`
      return succeed(result, `${lines.join('\n')}\n${footer}`, result.ok)
    }
    if (action === 'shot') {
      const { scratchShot } = await import('../scratch/drive.js')
      const result = await scratchShot(state, typeof values.label === 'string' ? values.label : 'shot', typeof values.out === 'string' ? values.out : undefined)
      return succeed(
        result,
        `screenshot ${result.screenshot}\nsummary    ${result.summary}\npage       ${result.path} "${result.title}"\nerrors     console ${result.errors.console}, page ${result.errors.page}, requests ${result.errors.requests}, http ${result.errors.http}; warnings ${result.warnings}\n${result.topErrors.map(error => `  ${error.count}× ${error.kind}: ${error.detail}`).join('\n')}\n`,
      )
    }
    const { scratchDown } = await import('../scratch/lifecycle.js')
    const dryRun = values['dry-run'] === true
    const result = await scratchDown(state, dryRun)
    return succeed(
      { dryRun, ...result },
      `${result.actions.map(item => `${dryRun && item.action !== 'keep' && item.action !== 'skip' ? `would ${item.action}` : item.action} ${item.target} — ${item.reason}`).join('\n')}\n${result.leftRunning.length > 0 ? `still running: ${result.leftRunning.join(', ')}\n` : ''}`,
      result.leftRunning.length === 0,
    )
  } catch (error) {
    if (error instanceof ScratchError) return fail(error)
    const message = error instanceof Error ? error.message : String(error)
    return fail(
      new ScratchError(
        'failed',
        message.replace(/https?:\/\/127\.0\.0\.1:\d+\/\S*/g, '[redacted-url]'),
        'Re-run with --json and read the host log in the state directory.',
      ),
    )
  }
}
