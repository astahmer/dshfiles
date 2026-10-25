import { mkdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { delimiter, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { prepareComposedBootProfile } from '../project/boot-profile.js'
import { DSHFILES_ROOT, buildPlugin, findFreePort, LocalBundleModel } from '../project/local-bundles.js'
import { compositionFailures, readProfileComposition } from '../project/profile-composition.js'
import { ScratchProfileRuntime } from '../project/scratch-profile.js'
import { registerScratchWorkspace } from '../project/scratch-workspace.js'
import { ScratchReaperRuntime, type ReapedScratch, type WarnedScratch } from './reaper.js'
import { ScratchSeedRuntime } from './seed.js'
import { LIVE_DSH_HOME, LIVE_DSH_PORT, ScratchError, ScratchStateRuntime, type ScratchState } from './state.js'

export interface ScratchUpOptions {
  readonly name: string
  readonly stateDir: string
  readonly plugins: readonly string[]
  /** Registry bundles from the web profile's dependencies, loaded beside the owned ones (a model provider, say). */
  readonly bundles: readonly string[]
  readonly project?: string
  readonly port?: number
  readonly skipBuild: boolean
  /** Put the e2e fake `secret` CLI first on the Host's PATH, with synthetic aliases for the project. */
  readonly fakeSecretCli: boolean
  /** Minutes without a `dshx dev` command before the watchdog warns; 0 keeps it up until `down`. */
  readonly idleTimeoutMinutes: number
  /** Minutes of warning grace before the automatic `down`; 0 stops as soon as the lease expires. */
  readonly warnMinutes: number
  readonly timeoutMs: number
  readonly onProgress: (message: string) => void
}

const URL_PATTERN = /http:\/\/127\.0\.0\.1:\d+\/\S*/
const browserHostScript = fileURLToPath(new URL('./browser-host.js', import.meta.url))
const watchdogScript = fileURLToPath(new URL('./watchdog.js', import.meta.url))

const sleep = (ms: number): Promise<void> => new Promise(resolveSleep => setTimeout(resolveSleep, ms))

const waitFor = async <Value>(read: () => Promise<Value | undefined>, timeoutMs: number, failure: () => Promise<Error>): Promise<Value> => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = await read()
    if (value !== undefined) return value
    await sleep(250)
  }
  throw await failure()
}

const stopGroup = async (pid: number): Promise<void> => {
  try {
    process.kill(-pid, 'SIGTERM')
  } catch {
    return
  }
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await sleep(100)
    try {
      process.kill(-pid, 0)
    } catch {
      return
    }
  }
  try {
    process.kill(-pid, 'SIGKILL')
  } catch {
    /* already gone */
  }
}

/**
 * Loader rows a scratch Host needs that the bundles do not compose. The traces receiver (@dshfiles/traces) defaults to the
 * standard OTLP port 4318, which the live Host or an external viewer may own; a scratch takes any free port instead and
 * its panel shows which one.
 */
const scratchCordisPatch = (packageIds: readonly string[]): { readonly cordisPatch?: string } =>
  packageIds.includes('@dshfiles/traces') ? { cordisPatch: '- id: dshfiles-traces\n  config:\n    port: 0\n' } : {}

export const scratchUp = async (
  options: ScratchUpOptions,
): Promise<{ readonly state: ScratchState; readonly swept: readonly ReapedScratch[]; readonly warned: readonly WarnedScratch[] }> => {
  if (options.port === LIVE_DSH_PORT) {
    throw new ScratchError('live-port', `Port ${LIVE_DSH_PORT} belongs to the live DSH.`, 'Omit --port to take a free port.')
  }
  if (options.project !== undefined && ScratchStateRuntime.isWithin(LIVE_DSH_HOME, resolve(options.project))) {
    throw new ScratchError('live-home', 'The project lies inside the live DSH home.', 'Pass a project folder outside ~/.dsh.')
  }
  if (
    options.project !== undefined &&
    !(await stat(options.project).then(
      info => info.isDirectory(),
      () => false,
    ))
  ) {
    throw new ScratchError(
      'project-missing',
      `${options.project} is not a directory.`,
      'Pass an existing folder to --project, or omit it to seed a sample jj project.',
    )
  }
  const { reaped: swept, warned } = await ScratchReaperRuntime.sweepStaleScratches({
    root: ScratchStateRuntime.stateRoot(),
    extraStateDirs: [options.stateDir],
  })
  for (const reaped of swept) options.onProgress(`stopped stale scratch "${reaped.name}" (${reaped.reason})`)
  for (const warning of warned)
    options.onProgress(
      `scratch "${warning.name}" is in its warning grace (${ScratchStateRuntime.formatMinutes(warning.warning.minutesLeft)} left); keep it with "dshx dev keep --name ${warning.name}"`,
    )
  const existing = await ScratchStateRuntime.read(options.stateDir, options.name).catch(() => undefined)
  // Reaching for an instance answers its warning, even when up then refuses to start a second one beside it.
  if (existing !== undefined && existing.warnedAt !== undefined) await ScratchStateRuntime.cancelWarning(existing)
  if (existing !== undefined && ScratchStateRuntime.ownedProcessStatus(existing.host) === 'running') {
    throw new ScratchError(
      'already-up',
      `A scratch DSH named "${options.name}" is already up at ${existing.origin} (pid ${existing.host.pid}).`,
      `Reuse it, run "dshx dev down${options.name === 'default' ? '' : ` --name ${options.name}`}", or pass --name <other>.`,
    )
  }

  const available = await LocalBundleModel.listLocalBootBundles()
  const requested = options.plugins.length > 0 ? options.plugins : available.map(bundle => bundle.packageId)
  const bundles = LocalBundleModel.withSharedStylesheet(LocalBundleModel.resolveLocalBundles(requested, available), available)
  const [firstBundle, ...otherBundles] = bundles
  if (firstBundle === undefined) throw new ScratchError('no-bundles', 'No owned plugin bundles were selected.', 'Pass --plugin @dshfiles/<name>.')
  if (!options.skipBuild) {
    for (const bundle of bundles) {
      options.onProgress(`building ${bundle.packageId}`)
      await buildPlugin(bundle.projectRoot, bundle.packageId)
    }
  }
  options.onProgress('installing the scratch profile')
  const prepared = await prepareComposedBootProfile([firstBundle, ...otherBundles], {
    additionalBundleIds: options.bundles,
    ...scratchCordisPatch(bundles.map(bundle => bundle.packageId)),
  })
  const home = prepared.homeRoot
  let hostPid: number | undefined
  let browserPid: number | undefined
  try {
    const dump = await readProfileComposition({
      projectRoot: DSHFILES_ROOT,
      profile: prepared.profile,
      profileRoot: prepared.profileRoot,
      dshHome: home,
      timeoutMs: options.timeoutMs,
    })
    const missing = compositionFailures(dump, prepared.expectedBundles)
    if (missing.length > 0)
      throw new ScratchError(
        'composition',
        `The scratch profile did not compose ${missing.join(', ')}.`,
        'Run "dshx check --boot" in that plugin to see why it does not load.',
      )

    // DSH compares a Session's resolved cwd with the stored path, and macOS temp dirs live behind the /var -> /private/var link.
    const project = await realpath(options.project === undefined ? await ScratchSeedRuntime.sampleProject(home) : resolve(options.project))
    const workspaceId = await registerScratchWorkspace(home, project)
    const fakeSecretCli = options.fakeSecretCli ? await ScratchSeedRuntime.installFakeSecretCli({ home, project }) : undefined
    const hostSource = fakeSecretCli === undefined ? process.env : { ...process.env, PATH: `${fakeSecretCli}${delimiter}${process.env.PATH ?? ''}` }

    await mkdir(options.stateDir, { recursive: true, mode: 0o700 })
    const hostLog = join(options.stateDir, 'host.log')
    const browserLog = join(options.stateDir, 'browser.log')
    const browserEvents = join(options.stateDir, 'browser-events.jsonl')
    const browserReady = join(options.stateDir, 'browser.ready')
    await Promise.all([hostLog, browserLog, browserEvents, browserReady].map(file => rm(file, { force: true })))
    await writeFile(browserEvents, '', { mode: 0o600 })

    const port = options.port ?? (await findFreePort())
    options.onProgress(`starting dsh on 127.0.0.1:${port}`)
    const hostArgs = ['--profile', prepared.profile, '--port', String(port), '--no-open']
    hostPid = ScratchStateRuntime.spawnDetached('dsh', hostArgs, {
      cwd: DSHFILES_ROOT,
      env: ScratchProfileRuntime.hostEnvironment(home, prepared.profileRoot, hostSource),
      log: hostLog,
    })
    const launchUrl = await waitFor(
      async () => {
        if (ScratchStateRuntime.ownedProcessStatus({ pid: hostPid ?? 0, signature: ['--port'] }) === 'gone')
          throw new ScratchError('host-exited', 'dsh exited before announcing its URL.', `Read ${hostLog} (it holds the launch token; do not paste it).`)
        return URL_PATTERN.exec(await readFile(hostLog, 'utf8').catch(() => ''))?.[0]
      },
      options.timeoutMs,
      async () =>
        new ScratchError(
          'host-timeout',
          `dsh did not announce a URL within ${options.timeoutMs} ms:\n${ScratchStateRuntime.redactUrls((await readFile(hostLog, 'utf8').catch(() => '')).slice(-2_000))}`,
          'Raise --timeout, or read the host log for activation failures.',
        ),
    )

    const cdpPort = await findFreePort()
    options.onProgress('starting headless Chromium')
    browserPid = ScratchStateRuntime.spawnDetached(
      process.execPath,
      [browserHostScript, '--cdp-port', String(cdpPort), '--user-data-dir', join(home, 'browser'), '--events', browserEvents, '--ready', browserReady],
      { cwd: options.stateDir, env: process.env, log: browserLog },
    )
    await waitFor(
      async () => ((await stat(browserReady).catch(() => undefined)) === undefined ? undefined : true),
      60_000,
      async () =>
        new ScratchError(
          'browser-timeout',
          `Chromium did not start:\n${(await readFile(browserLog, 'utf8').catch(() => '')).slice(-2_000)}`,
          'Run "pnpm run setup:browser" from the repository root to install the Playwright Chromium.',
        ),
    )

    const state: ScratchState = {
      schemaVersion: 1,
      name: options.name,
      createdAt: new Date().toISOString(),
      stateDir: options.stateDir,
      home,
      profile: prepared.profile,
      port,
      origin: new URL(launchUrl).origin,
      launchUrl,
      bundles: bundles.map(bundle => bundle.packageId),
      expectedClientEntries: bundles.filter(bundle => bundle.hasClient).map(bundle => bundle.packageId),
      project: { path: project, workspaceId, ownedByScratch: options.project === undefined },
      host: { pid: hostPid, signature: [`--profile ${prepared.profile}`, `--port ${port}`] },
      browser: { pid: browserPid, signature: [browserHostScript, browserEvents], cdpPort },
      hostLog,
      browserLog,
      browserEvents,
      evidenceDir: join(options.stateDir, 'evidence'),
    }
    if (fakeSecretCli !== undefined) state.fakeSecretCli = fakeSecretCli
    state.idleTimeoutMinutes = options.idleTimeoutMinutes
    state.warnMinutes = options.warnMinutes
    await ScratchStateRuntime.write(state)
    const watchdogPid = ScratchStateRuntime.spawnDetached(process.execPath, [watchdogScript, '--state-dir', options.stateDir], {
      cwd: options.stateDir,
      env: process.env,
      log: join(options.stateDir, 'watchdog.log'),
    })
    state.watchdog = { pid: watchdogPid, signature: [watchdogScript, options.stateDir] }
    await ScratchStateRuntime.write(state)
    return { state, swept, warned }
  } catch (error) {
    if (browserPid !== undefined) await stopGroup(browserPid)
    if (hostPid !== undefined) await stopGroup(hostPid)
    await prepared.dispose()
    throw error
  }
}
