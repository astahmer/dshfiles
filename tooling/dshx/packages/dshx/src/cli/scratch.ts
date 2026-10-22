import { parseArgs } from 'node:util'
import type { Writable } from 'node:stream'
import { DEFAULT_IDLE_TIMEOUT_MINUTES, DEFAULT_WARN_MINUTES, ScratchError, ScratchStateRuntime, scratchNameSchema } from '../scratch/state.js'

export const SCRATCH_ACTIONS: ReadonlySet<string> = new Set(['up', 'doctor', 'open', 'shot', 'keep', 'down'])

const COMMON_HELP = `Common options:
  --name <name>        Scratch instance name (default "default"); several can run side by side.
  --state-dir <dir>    Where the state file, logs and evidence live (default $TMPDIR/dshx-dev/<name>).
  --json               Print one JSON envelope: { schemaVersion, command, ok, data | error: { code, message, hint } }.
  -h, --help           Show help for the action.`

const HELP: Readonly<Record<string, string>> = {
  overview: `dshx dev <up|doctor|open|shot|keep|down> — drive a scratch DSH for verification.

A scratch DSH has its own temp DSH_HOME, a free port, the owned plugins under test, a registered
project, and a headless Chromium that keeps its page between commands. It never touches the live
DSH on 127.0.0.1:3080 or ~/.dsh. The launch URL is a secret: it stays in the mode-600 state file.
A watchdog stops a forgotten instance ${DEFAULT_IDLE_TIMEOUT_MINUTES} min after its last dshx dev command (up
--idle-timeout), after a ${DEFAULT_WARN_MINUTES} min warning grace (up --warn-minutes) that any dshx dev command answers,
or as soon as its dsh exits. Still run "dshx dev down" when done.

  dshx dev up [--plugin @dshfiles/<name>]...   start it (builds the plugins, seeds a jj project)
  dshx dev doctor                              read-only health check
  dshx dev open <feature>                      walk a catalog feature's "reach" steps in the browser
  dshx dev shot [--label <label>]              screenshot + console/network error summary
  dshx dev keep [--forever]                    answer a stop warning, or pin the instance
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

Auto-stop: up also starts a detached watchdog that warns once the instance went --idle-timeout
minutes without a dshx dev command (doctor, open, shot and keep renew the lease; it is the state
file's mtime), then runs "down" when the --warn-minutes grace ends with no keep, and runs "down" as
soon as its dsh process is gone. Any dshx dev command that reaches the instance cancels a pending
warning; "dshx dev keep --name <name> [--forever]" answers it on purpose and --forever pins the
instance so it never stops on its own. Total lifetime without a command: idle + grace (40 min by
default). Before starting, up runs "down" on every other instance under the state root whose lease
and grace expired or whose dsh exited, and lists the ones waiting in their warning grace.

Options:
  --plugin <id>        Owned bundle to load, repeatable (default: every bundle under plugins/@dshfiles).
  --bundle <id>        Also load a registry bundle the web profile installs (e.g. dsh-our-free-model), repeatable.
  --project <dir>      Register this folder instead of seeding a sample jj project; down keeps it.
  --port <port>        Host port (default: a free one; 3080 is refused).
  --skip-build         Use each plugin's existing dist/.
  --fake-secret-cli    Put the e2e fake secret CLI (synthetic aliases, no vault) first on the Host's PATH.
  --timeout <ms>       Boot timeout (default 120000).
  --idle-timeout <min> Minutes without a dshx dev command before the watchdog warns (default ${DEFAULT_IDLE_TIMEOUT_MINUTES}; 0 = never).
  --warn-minutes <min> Warning grace before the automatic down (default ${DEFAULT_WARN_MINUTES}; 0 = stop at once, no warning).

Example:
  dshx dev up --plugin @dshfiles/jj-integration --plugin @dshfiles/home --json

${COMMON_HELP}`,
  doctor: `dshx dev doctor — read-only health check of a scratch DSH.

Checks: isolated from the live DSH, dsh and Chromium still running (and still ours), the auto-stop
watchdog running, the URL answers and authenticates, every plugin entry is active and every bundle
under test loaded, and the host log has no error lines. It also reports the lease and any pending
warning (its start time and remaining grace) and how to keep the instance. Like open, shot and
keep, it answers a pending warning and renews the idle lease. Exit code 1 when any check fails;
each failure carries a "fix".

${COMMON_HELP}`,
  open: `dshx dev open <feature> — drive the scratch browser to a catalog feature.

<feature> is a feature id from a plugins/@dshfiles/*/dshx.features.json catalog, optionally
qualified: "thread-destination", "jj-integration/thread-destination" or
"@dshfiles/jj-integration#thread-destination". Navigates to the app root, dismisses the Preview
Notice and provider-setup dialogs, then runs the feature's "reach" steps:
  click <role|text|label|title> "<name>"       fill <role|label> "<name>" "<value>"
  rightclick <role|text|label|title> "<name>"  press <key>
  hover <role|text|label|title> "<name>"       (leaves the pointer there, for hover-only UI)
  expect <role|text|label|title> "<name>"      seed <rebase-ready-thread|pending-restart|tool-call-thread|jev-setup-chat-thread|quota-blocked-thread|chat-reference-thread|credential-recovery|fake-secret-cli|backlog-jev-enabled|multi-host-hosts>
  attach "<file>"                              (a repository file, to the page's file input)
Names match exactly; "name*" matches a case-insensitive substring. "text" without "*" is exact too.
A click, rightclick or hover may end with "at <x>,<y>" to hit that point of the element's own box
instead of its centre: a row that seats a hover-only action strip over its right half is still
clicked from its left half with 'rightclick text "Mute target" at 24,16'.
Seed steps come first and run once per instance: rebase-ready-thread starts a thread in its own jj
workspace through the New thread screen and describes a revision there; pending-restart changes
thread-sidebar's Host entry on disk, as a rebuild would ("down" restores it); tool-call-thread
points an AI Accounts Command Code account at a loopback fake provider ("down" stops it) and runs a
thread whose model calls bash for three seconds; jev-setup-chat-thread asks "Can you help me set up Jev?"
through that loopback provider; quota-blocked-thread creates an exhausted turn that appears in the
Usage limit group; credential-recovery configures a Command Code account whose loopback provider
rejects the next turn with HTTP 401 (these seeds need @dshfiles/ai-accounts);
fake-secret-cli resets the synthetic aliases of a Host started with "up --fake-secret-cli".
backlog-jev-enabled uses Settings to turn on Jev only when it is off, without entering a key;
chat-reference-thread adds a rendered jj:main link to a fake-provider transcript, and multi-host-hosts
writes synthetic host data for the Hosts page.
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
  keep: `dshx dev keep — answer a stop warning, or pin the scratch DSH.

Cancels a pending warning for this instance and renews its idle lease, so the watchdog's countdown
starts again; doctor, open and shot do the same implicitly. With --forever the instance is pinned:
its idle timeout drops to 0 and no warning or automatic "down" ever runs until "dshx dev down".
The watchdog's warning line and this cancellation both land in <state-dir>/watchdog.log.

Options:
  --forever            Pin the instance: no idle stop, no warning (still stopped by "dshx dev down").

${COMMON_HELP}`,
  down: `dshx dev down — stop exactly what up started.

Stops the recorded watchdog, dsh and Chromium process groups only while their command lines still
match what up started (a reused pid is left alone), deletes the scratch home and the state/log files, and keeps
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
  const succeed = <Data>(data: Data, human: string, ok = true): number => {
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
        bundle: { type: 'string', multiple: true },
        project: { type: 'string' },
        port: { type: 'string' },
        'skip-build': { type: 'boolean' },
        'fake-secret-cli': { type: 'boolean' },
        timeout: { type: 'string' },
        'idle-timeout': { type: 'string' },
        'warn-minutes': { type: 'string' },
        forever: { type: 'boolean' },
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
    up: ['plugin', 'bundle', 'project', 'port', 'skip-build', 'fake-secret-cli', 'timeout', 'idle-timeout', 'warn-minutes'],
    doctor: [],
    open: ['timeout'],
    shot: ['label', 'out'],
    keep: ['forever'],
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
  const stateDir = ScratchStateRuntime.resolveStateDir({
    name: name.data,
    ...(typeof values['state-dir'] === 'string' ? { stateDir: values['state-dir'] } : {}),
  })

  try {
    if (action === 'up') {
      const timeoutMs = numberOption('timeout', 120_000)
      if (timeoutMs instanceof ScratchError) return fail(timeoutMs)
      const port = values.port === undefined ? undefined : numberOption('port', 0)
      if (port instanceof ScratchError) return fail(port)
      const idleTimeoutMinutes = Number(values['idle-timeout'] ?? DEFAULT_IDLE_TIMEOUT_MINUTES)
      if (!Number.isSafeInteger(idleTimeoutMinutes) || idleTimeoutMinutes < 0)
        return fail(new ScratchError('usage', '--idle-timeout requires a whole number of minutes (0 = never).', 'Run "dshx dev up --help".'))
      const warnMinutes = Number(values['warn-minutes'] ?? DEFAULT_WARN_MINUTES)
      if (!Number.isSafeInteger(warnMinutes) || warnMinutes < 0)
        return fail(new ScratchError('usage', '--warn-minutes requires a whole number of minutes (0 = stop at once).', 'Run "dshx dev up --help".'))
      const { scratchUp } = await import('../scratch/up.js')
      const { state, swept, warned } = await scratchUp({
        name: name.data,
        stateDir,
        plugins: Array.isArray(values.plugin) ? values.plugin : [],
        bundles: Array.isArray(values.bundle) ? values.bundle : [],
        ...(typeof values.project === 'string' ? { project: values.project } : {}),
        ...(port === undefined ? {} : { port }),
        skipBuild: values['skip-build'] === true,
        fakeSecretCli: values['fake-secret-cli'] === true,
        idleTimeoutMinutes,
        warnMinutes,
        timeoutMs,
        onProgress: message => write(io.stderr, `dshx dev up: ${message}\n`),
      })
      const shown = ScratchStateRuntime.publicState(state)
      const sweptLines = swept.map(reaped => `stopped stale scratch "${reaped.name}" (${reaped.reason})\n`).join('')
      const warnedLines = warned
        .map(
          entry =>
            `scratch "${entry.name}" waits in its warning grace (${ScratchStateRuntime.formatMinutes(entry.warning.minutesLeft)} left); keep it with "dshx dev keep --name ${entry.name}"\n`,
        )
        .join('')
      const autoStop =
        shown.idleTimeoutMinutes === 0
          ? 'when its dsh exits'
          : `after ${shown.idleTimeoutMinutes} idle min + a ${shown.warnMinutes} min warning grace, or when its dsh exits`
      return succeed(
        {
          ...shown,
          swept: swept.map(reaped => ({ name: reaped.name, stateDir: reaped.stateDir, reason: reaped.reason, leftRunning: reaped.leftRunning })),
          warned: warned.map(entry => ({
            name: entry.name,
            stateDir: entry.stateDir,
            warnedAt: entry.warning.warnedAt,
            graceEndsAt: entry.warning.graceEndsAt,
          })),
        },
        `${sweptLines}${warnedLines}Scratch DSH "${shown.name}" up at ${shown.origin} (dsh pid ${shown.hostPid}, chromium pid ${shown.browserPid}).\n  home     ${shown.home}\n  project  ${shown.project}\n  state    ${shown.stateDir}\n  stops    ${autoStop} (watchdog pid ${shown.watchdogPid ?? 'none'})\n  keep     dshx dev keep --name ${shown.name} [--forever]\nNext: dshx dev doctor\n`,
      )
    }
    const readState = await ScratchStateRuntime.read(stateDir, name.data)
    if (action === 'keep') {
      const result = await ScratchStateRuntime.keepScratch({ state: readState, forever: values.forever === true })
      const kept = ScratchStateRuntime.publicState(result.state)
      const stops =
        kept.idleTimeoutMinutes === 0
          ? 'pinned: no idle stop until "dshx dev down"'
          : `after ${kept.idleTimeoutMinutes} idle min + a ${kept.warnMinutes} min warning grace, or when its dsh exits`
      return succeed(
        { ...kept, cancelledWarning: result.cancelledWarning },
        `Scratch DSH "${kept.name}" kept: ${result.cancelledWarning ? 'warning cancelled, ' : ''}lease renewed.\n  stops  ${stops}\n  state  ${kept.stateDir}\n`,
      )
    }
    // Every command that reaches an instance answers its warning; doctor reports the one it answered. `down` stops it anyway.
    const answeredWarning = ScratchStateRuntime.scratchWarning(readState, Date.now())
    const cancelled = action === 'down' ? { state: readState } : await ScratchStateRuntime.cancelWarning(readState)
    const state = cancelled.state
    if (action !== 'down') await ScratchStateRuntime.renewLease(stateDir)
    if (action === 'doctor') {
      const { scratchDoctor } = await import('../scratch/lifecycle.js')
      const checks = await scratchDoctor({ state, ...(answeredWarning === undefined ? {} : { answeredWarning }) })
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
