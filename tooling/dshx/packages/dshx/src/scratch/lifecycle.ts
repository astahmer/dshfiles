import { readFile, rm } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { tmpdir } from 'node:os'
import { connectDshPlatformClient } from '../platform/client.js'
import { ScratchSeedRuntime } from './seed.js'
import {
  DEFAULT_IDLE_TIMEOUT_MINUTES,
  DEFAULT_WARN_MINUTES,
  LIVE_DSH_HOME,
  LIVE_DSH_PORT,
  ScratchStateRuntime,
  type ScratchState,
  type ScratchWarning,
} from './state.js'

export interface DoctorCheck {
  readonly id: string
  readonly ok: boolean
  readonly detail: string
  readonly fix?: string
}

const HOST_ERROR_LINE = /did not activate|\berror\b|\bfailed\b|EADDRINUSE|unhandled/i

/**
 * Read-only: never restarts, navigates or writes anything. Any command that touches an instance answers its pending
 * warning first, so the doctor is handed what it answered to report instead of printing an already-cancelled warning.
 */
export const scratchDoctor = async (options: { readonly state: ScratchState; readonly answeredWarning?: ScratchWarning }): Promise<readonly DoctorCheck[]> => {
  const state = options.state
  const checks: DoctorCheck[] = []
  const isolated = state.port !== LIVE_DSH_PORT && !ScratchStateRuntime.isWithin(LIVE_DSH_HOME, state.home)
  checks.push({
    id: 'isolated',
    ok: isolated,
    detail: isolated ? `port ${state.port}, home ${state.home}` : 'state points at the live DSH port or home',
    ...(!isolated && { fix: 'Do not use this state; run "dshx dev down --dry-run" and inspect it by hand.' }),
  })
  const host = ScratchStateRuntime.ownedProcessStatus(state.host)
  checks.push({
    id: 'host-process',
    ok: host === 'running',
    detail: `pid ${state.host.pid} ${host}`,
    ...(host !== 'running' && { fix: 'Run "dshx dev down" then "dshx dev up".' }),
  })
  const browser = ScratchStateRuntime.ownedProcessStatus(state.browser)
  checks.push({
    id: 'browser-process',
    ok: browser === 'running',
    detail: `pid ${state.browser.pid} ${browser}`,
    ...(browser !== 'running' && { fix: 'Run "dshx dev down" then "dshx dev up".' }),
  })
  const idleTimeoutMinutes = state.idleTimeoutMinutes ?? DEFAULT_IDLE_TIMEOUT_MINUTES
  const warnMinutes = state.warnMinutes ?? DEFAULT_WARN_MINUTES
  const watchdog = state.watchdog === undefined ? 'not recorded' : ScratchStateRuntime.ownedProcessStatus(state.watchdog)
  const lease =
    state.kept === true
      ? 'pinned by "dshx dev keep --forever": no idle stop'
      : idleTimeoutMinutes === 0
        ? 'no idle timeout'
        : `warns after ${idleTimeoutMinutes} min without a dshx dev command, then stops after a ${warnMinutes} min grace`
  const autoStopDetail = `watchdog ${state.watchdog === undefined ? '' : `pid ${state.watchdog.pid} `}${watchdog}; ${lease}`
  checks.push(
    watchdog === 'running'
      ? { id: 'auto-stop', ok: true, detail: autoStopDetail }
      : {
          id: 'auto-stop',
          ok: false,
          detail: autoStopDetail,
          fix: 'Nothing stops this instance on its own: run "dshx dev down" when done, then "dshx dev up" again.',
        },
  )

  const keepHint = `"dshx dev keep --name ${state.name}" cancels a warning and renews the lease; add --forever to pin it`
  const warning = options.answeredWarning
  checks.push(
    warning === undefined
      ? { id: 'warning', ok: true, detail: `no warning pending; ${keepHint}` }
      : {
          id: 'warning',
          ok: true,
          detail: `answered a pending warning (started ${warning.warnedAt}, ${ScratchStateRuntime.formatMinutes(warning.minutesLeft)} of its ${warnMinutes} min grace left)`,
          fix: `Answered by this command; ${keepHint}.`,
        },
  )

  let plugins: Awaited<ReturnType<Awaited<ReturnType<typeof connectDshPlatformClient>>['plugins']['list']>> | undefined
  try {
    const client = await connectDshPlatformClient({ url: state.launchUrl })
    checks.push({ id: 'url', ok: true, detail: `${state.origin} answers and authenticates` })
    plugins = await client.plugins.list()
  } catch (error) {
    checks.push({
      id: 'url',
      ok: false,
      detail: ScratchStateRuntime.redactUrls(error instanceof Error ? error.message : String(error)),
      fix: 'Read the host log; if dsh exited, run "dshx dev down" then "dshx dev up".',
    })
  }
  if (plugins !== undefined) {
    const broken = plugins.filter(plugin => plugin.enabled && (plugin.phase === 'failed' || plugin.phase === 'pending'))
    const loadedModules = plugins.filter(plugin => plugin.phase === 'active').map(plugin => plugin.moduleName)
    const missing = state.bundles.filter(bundle => !loadedModules.some(moduleName => moduleName === bundle || moduleName.startsWith(`${bundle}/`)))
    const ok = broken.length === 0 && missing.length === 0
    checks.push({
      id: 'plugins',
      ok,
      detail: ok
        ? `${loadedModules.length} active entries; all ${state.bundles.length} bundles under test loaded`
        : [
            broken.length > 0 ? `not active: ${broken.map(plugin => `${plugin.id} (${plugin.phase})`).join(', ')}` : '',
            missing.length > 0 ? `no active entry: ${missing.join(', ')}` : '',
          ]
            .filter(Boolean)
            .join('; '),
      ...(!ok && { fix: 'The first entry named is often a dependent; read the host log and run "dshx check --boot" in the plugin.' }),
    })
  }
  const hostErrors = (await readFile(state.hostLog, 'utf8').catch(() => ''))
    .split('\n')
    .filter(line => HOST_ERROR_LINE.test(line))
    .map(line => ScratchStateRuntime.redactUrls(line).slice(0, 300))
  checks.push({
    id: 'host-log',
    ok: hostErrors.length === 0,
    detail: hostErrors.length === 0 ? 'no error lines' : hostErrors.slice(-10).join('\n'),
    ...(hostErrors.length !== 0 && { fix: `Read ${state.hostLog} (it holds the launch token; do not paste it).` }),
  })
  return checks
}

export interface DownAction {
  readonly action: 'stop' | 'skip' | 'remove' | 'keep' | 'restore'
  readonly target: string
  readonly reason: string
}

const scratchHomeIsOurs = (home: string): boolean =>
  ScratchStateRuntime.isWithin(tmpdir(), home) && basename(home).startsWith('dshx-boot-profile-') && !ScratchStateRuntime.isWithin(LIVE_DSH_HOME, home)

const stopGroup = async (pid: number): Promise<boolean> => {
  const alive = (): boolean => {
    try {
      process.kill(-pid, 0)
      return true
    } catch {
      return false
    }
  }
  try {
    process.kill(-pid, 'SIGTERM')
  } catch {
    return !alive()
  }
  for (let attempt = 0; attempt < 50 && alive(); attempt += 1) await new Promise(resolve => setTimeout(resolve, 100))
  if (alive()) {
    try {
      process.kill(-pid, 'SIGKILL')
    } catch {
      /* exited in between */
    }
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  return !alive()
}

/** Stop exactly the processes `up` recorded (if they still are ours) and remove the scratch home; evidence stays. */
export const scratchDown = async (
  state: ScratchState,
  dryRun: boolean,
): Promise<{ readonly actions: readonly DownAction[]; readonly leftRunning: readonly number[] }> => {
  const actions: DownAction[] = []
  const leftRunning: number[] = []
  for (const [label, owned] of [
    // The watchdog goes first: it would otherwise see the dsh process gone and run a second down beside this one.
    ...(state.watchdog === undefined ? [] : ([['watchdog', state.watchdog]] as const)),
    ['browser', state.browser],
    ['dsh', state.host],
    ...(state.fakeProvider === undefined ? [] : ([['fake model provider', state.fakeProvider]] as const)),
  ] as const) {
    if (owned.pid === process.pid) {
      actions.push({ action: 'skip', target: `${label} pid ${owned.pid}`, reason: 'this watchdog is running down; it exits next' })
      continue
    }
    const status = ScratchStateRuntime.ownedProcessStatus(owned)
    if (status === 'gone') {
      actions.push({ action: 'skip', target: `${label} pid ${owned.pid}`, reason: 'already exited' })
      continue
    }
    if (status === 'foreign') {
      actions.push({ action: 'skip', target: `${label} pid ${owned.pid}`, reason: 'the pid now runs another command; not ours to kill' })
      continue
    }
    actions.push({ action: 'stop', target: `${label} pid ${owned.pid} (process group)`, reason: 'started by dshx dev up' })
    if (!dryRun && !(await stopGroup(owned.pid))) leftRunning.push(owned.pid)
  }
  const restoredHostEntry = await ScratchSeedRuntime.restorePendingRestart(state, dryRun)
  if (restoredHostEntry !== undefined) actions.push({ action: 'restore', target: restoredHostEntry, reason: 'undo the pending-restart seed' })
  if (scratchHomeIsOurs(state.home)) {
    actions.push({ action: 'remove', target: state.home, reason: 'scratch home (profile, storages, browser profile, sample project)' })
    if (!dryRun) await rm(state.home, { recursive: true, force: true })
  } else {
    actions.push({ action: 'skip', target: state.home, reason: 'not a dshx scratch home under the temp directory; left alone' })
  }
  const fakeProviderFiles = state.fakeProvider === undefined ? [] : [join(state.stateDir, 'fake-provider.ready'), join(state.stateDir, 'fake-provider.log')]
  const stateFiles = [
    state.hostLog,
    state.browserLog,
    state.browserEvents,
    join(state.stateDir, 'browser.ready'),
    join(state.stateDir, 'watchdog.log'),
    ...fakeProviderFiles,
  ]
  for (const file of [...stateFiles, join(state.stateDir, 'state.json')]) {
    actions.push({ action: 'remove', target: file, reason: 'scratch state (the host log and state hold the launch token)' })
  }
  if (!dryRun) {
    await Promise.all(stateFiles.map(file => rm(file, { force: true })))
    await ScratchStateRuntime.remove(state.stateDir)
  }
  if (!state.project.ownedByScratch) actions.push({ action: 'keep', target: state.project.path, reason: 'project passed with --project' })
  actions.push({ action: 'keep', target: state.evidenceDir, reason: 'evidence' })
  return { actions, leftRunning }
}
