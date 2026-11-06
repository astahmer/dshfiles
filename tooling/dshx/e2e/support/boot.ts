import { type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { delimiter, join } from 'node:path'
import { prepareComposedBootProfile, type PreparedBootProfile } from '../../packages/dshx/src/project/boot-profile.js'
import { DSHFILES_ROOT, buildPlugin, findFreePort, LocalBundleModel } from '../../packages/dshx/src/project/local-bundles.js'
import { compositionFailures, readProfileComposition } from '../../packages/dshx/src/project/profile-composition.js'
import { spawnOwnedProcess, stopOwnedProcess } from '../../packages/dshx/src/project/owned-process.js'
import { resolveDshExecutable } from '../../packages/dshx/src/project/dsh-executable.js'
import { guardedCommand } from '../../packages/dshx/src/scratch/guarded-spawn.js'
import { ScratchRegistry, type ScratchOwner } from '../../packages/dshx/src/scratch/registry.js'
import { sweepScratch } from '../../packages/dshx/src/scratch/sweep.js'
import { recordScratchProcess, scratchLedgerPath } from '../../scripts/reap-scratch-processes.mjs'
import { isolatedHostEnvironment, redactHostOutput } from './scratch-profile.js'
import { createScratchHostLifecycle, type ScratchHostInstance } from './scratch-host-lifecycle.js'
import { AI_ACCOUNTS_WORKSPACE_SEED_KEY, seedAiAccountsWorkspace } from './ai-accounts-workspace.js'
import { startHostEgressGuard } from './host-egress-guard.js'

// Registry dependencies come from the checked-in seed, not the live ~/.dsh profile, so a journey (and its cached
// Turbo result) depends only on the repository.
const sourceProfileRoot = join(DSHFILES_ROOT, 'profiles/web')
const URL_PATTERN = /http:\/\/127\.0\.0\.1:\d+\/\S*/
const WELCOME_NOTICE_VERSION_PATTERN = /^\s+welcomeNoticeVersion:\s*(\S+)\s*$/mu

/**
 * The web seed acknowledges DSH's Preview Notice in its own `cordis.patch.yml`; a scratch boot copies only its package
 * manifest, so without this every scratch page showed the notice. Native onboarding mounts it only once the Session list
 * is ready and its settings scope has loaded, which under load lands after any fixed dismissal window and then covers
 * the page mid-scenario. Seeding the same acknowledgement makes the notice never render, as on a real web profile.
 * `@dshfiles/settings-shell` ports the step into its own namespace, so its row gets the same version when composed.
 */
let welcomeNoticeVersion: Promise<string> | undefined
const readWelcomeNoticeVersion = (): Promise<string> =>
  (welcomeNoticeVersion ??= readFile(join(sourceProfileRoot, 'cordis.patch.yml'), 'utf8').then(source => {
    const version = WELCOME_NOTICE_VERSION_PATTERN.exec(source)?.[1]
    if (version === undefined) throw new Error('profiles/web/cordis.patch.yml no longer acknowledges the welcome notice (welcomeNoticeVersion).')
    return version
  }))

export const withStartupAcknowledgements = async (packageIds: readonly string[], cordisPatch?: string): Promise<string> => {
  const version = await readWelcomeNoticeVersion()
  const rows = [
    `- id: ui-settings-general\n  name: '@deepseek-ai/dsh-client-ui-settings-general'\n  config:\n    welcomeNoticeVersion: ${version}\n`,
    ...(packageIds.includes('@dshfiles/settings-shell') ? [`- id: dshfiles-settings-shell\n  config:\n    welcomeNoticeVersion: ${version}\n`] : []),
  ]
  const existing = cordisPatch === undefined || cordisPatch.trim() === '' ? '' : `${cordisPatch.replace(/\n*$/u, '')}\n`
  return `${existing}${rows.join('')}`
}

/**
 * Phase timings for one scratch boot, printed when `DSHX_E2E_BOOT_TRACE=1`. A journey's dominant cost is its boot, so
 * the phases are measured rather than assumed: preparation, the composition dump, the Host's own startup, the page
 * load and the client-ready wait.
 */
export const traceBootPhase = (phase: string, startedAt: number, detail = ''): void => {
  if (process.env.DSHX_E2E_BOOT_TRACE !== '1') return
  process.stderr.write(`[boot-trace] ${phase} ${String(Date.now() - startedAt)}ms${detail === '' ? '' : ` ${detail}`}\n`)
}

/**
 * Compositions already proven to load their bundles in this worker. A worker runs many scenarios of one composition
 * (23 of them in thread-sidebar.feature) and the composition is a property of the profile files, not of the scratch
 * home: re-dumping it per scenario spent 0.45-0.83s and a whole `dsh` process to prove the same thing again.
 */
const compositionValidations = new Map<string, Promise<void>>()

const compositionKeyFor = async (prepared: PreparedBootProfile, executable: string): Promise<string> => {
  const hash = createHash('sha256')
  for (const name of ['package.json', 'cordis.patch.yml', 'pnpm-workspace.yaml']) {
    hash.update(`${name}\0`)
    hash.update(await readFile(join(prepared.profileRoot, name)).catch(() => Buffer.from('<absent>')))
  }
  hash.update(`\0${[...prepared.expectedBundles].sort().join(',')}\0${executable}`)
  return hash.digest('hex')
}

const validateComposition = async (prepared: PreparedBootProfile, timeoutMs: number, executable: string): Promise<void> => {
  const dump = await readProfileComposition({
    projectRoot: DSHFILES_ROOT,
    profile: prepared.profile,
    profileRoot: prepared.profileRoot,
    dshHome: prepared.homeRoot,
    executable,
    timeoutMs,
  })
  const missingBundles = compositionFailures(dump, prepared.expectedBundles)
  if (missingBundles.length > 0) throw new Error(`The scratch profile did not compose expected bundles: ${missingBundles.join(', ')}.`)
}

export interface BootedProfile {
  /** Tokenized URL held only for navigation inside the browser test. */
  readonly url: string
  readonly profile: string
  readonly homeRoot: string
  readonly port: number
  readonly expectedClientEntries: readonly string[]
  readonly host: ChildProcess
  /** Startup output with tokenized URLs removed. */
  output(): string
  /** `host:port` targets this Host tried to reach beyond loopback; each was refused (see host-egress-guard.ts). */
  egressAttempts(): readonly string[]
  /** Restart only this fixture-owned process and return its fresh tokenized URL. */
  restart(): Promise<string>
  close(): Promise<void>
}

type LocalBootBundle = Awaited<ReturnType<typeof LocalBundleModel.listLocalBootBundles>>[number]

const requireNonEmptyBundles = (bundles: readonly LocalBootBundle[], message: string): [LocalBootBundle, ...LocalBootBundle[]] => {
  const [firstBundle, ...remainingBundles] = bundles
  if (firstBundle === undefined) throw new Error(message)
  return [firstBundle, ...remainingBundles]
}

const waitForHostUrl = (host: ChildProcess, output: () => string, profile: string, timeoutMs: number): Promise<string> =>
  new Promise<string>((resolveUrl, reject) => {
    const startedAt = Date.now()
    const timer = setInterval(() => {
      const match = URL_PATTERN.exec(output())
      if (match?.[0] !== undefined) {
        clearInterval(timer)
        host.off('exit', handleExit)
        resolveUrl(match[0])
        return
      }
      if (Date.now() - startedAt > timeoutMs) {
        clearInterval(timer)
        host.off('exit', handleExit)
        reject(new Error(`the ${profile} scratch profile did not announce a URL within ${String(timeoutMs)}ms:\n${redactHostOutput(output())}`))
      }
    }, 250)
    const handleExit = (code: number | null): void => {
      clearInterval(timer)
      reject(new Error(`${profile} scratch profile exited with code ${String(code)} before announcing a URL:\n${redactHostOutput(output())}`))
    }
    host.once('exit', handleExit)
  })

/** This worker owns every Host it starts: their guards stop them when it dies, whatever killed it. */
let workerOwner: ScratchOwner | undefined
const scratchOwner = (): ScratchOwner => (workerOwner ??= ScratchRegistry.currentOwner(DSHFILES_ROOT))

/**
 * Once per worker, before its first Host: stop scratch Hosts whose owner died (a run killed before the guard existed).
 * `DSHX_SCRATCH_SWEEP=0` skips it for specs that mock the Host.
 */
let orphanSweep: Promise<void> | undefined
const sweepOrphansOnce = (): Promise<void> =>
  process.env.DSHX_SCRATCH_SWEEP === '0'
    ? Promise.resolve()
    : (orphanSweep ??= sweepScratch({ dryRun: false }).then(
        result => {
          const stopped = result.actions.filter(action => action.kind === 'stop-orphan' || action.kind === 'stop-legacy')
          if (stopped.length > 0)
            process.stderr.write(
              `[scratch-sweep] stopped ${String(stopped.length)} orphaned scratch Host(s): ${stopped.map(action => action.target).join(', ')}\n`,
            )
        },
        () => undefined,
      ))

export const startScratchProfile = async (
  prepared: PreparedBootProfile,
  profileLabel: string,
  expectedClientEntries: readonly string[],
  timeoutMs: number,
  pathPrefix?: string,
  hostEnv: Readonly<Record<string, string>> = {},
  executableOverride?: string,
): Promise<BootedProfile> => {
  const executable = await resolveDshExecutable(executableOverride, process.env, DSHFILES_ROOT)
  await sweepOrphansOnce()
  const validatedAt = Date.now()
  const compositionKey = await compositionKeyFor(prepared, executable)
  const known = compositionValidations.get(compositionKey)
  if (known === undefined) {
    const validation = validateComposition(prepared, timeoutMs, executable)
    compositionValidations.set(compositionKey, validation)
    // A failure must not be remembered: the next scenario of this composition re-proves it and reports it.
    validation.catch(() => compositionValidations.delete(compositionKey))
  }
  await compositionValidations.get(compositionKey)
  traceBootPhase('composition-validated', validatedAt, profileLabel)

  // One guard per profile, kept across restarts, so its record covers everything this scenario's Host did.
  const egressGuard = await startHostEgressGuard()
  const start = async (port: number): Promise<ScratchHostInstance> => {
    const scratchEnvironment = isolatedHostEnvironment(prepared.homeRoot, prepared.profileRoot)
    const hostPath = pathPrefix === undefined ? scratchEnvironment.PATH : [pathPrefix, scratchEnvironment.PATH].filter(Boolean).join(delimiter)
    const hostEnvironment = hostPath === undefined ? scratchEnvironment : { ...scratchEnvironment, PATH: hostPath }
    // The Host runs under the parent-death guard: this worker holds its stdin pipe, and the kernel closes it however
    // the worker dies (a SIGKILLed worker never reaches `close()` or an exit handler), which stops the Host's group.
    const guarded = guardedCommand({
      command: executable,
      args: ['--profile', prepared.profile, '--port', String(port), '--no-open'],
      owner: scratchOwner(),
      pipe: true,
      recordKind: 'e2e',
      // directory-picker-auto mounts the OS chooser on a darwin/win32 loopback Host, which a browser cannot drive; an SSH
      // launch is its documented signal for the in-app browse picker, so folder journeys behave the same on every platform.
      env: { ...hostEnvironment, ...egressGuard.environment, ...hostEnv, SSH_CONNECTION: '127.0.0.1 0 127.0.0.1 0' },
    })
    const host = spawnOwnedProcess(guarded.command, guarded.args, { cwd: DSHFILES_ROOT, env: guarded.env, stdio: ['pipe', 'pipe', 'pipe'] })
    let output = ''
    const collect = (chunk: Buffer): void => {
      output = `${output}${chunk.toString('utf8')}`.slice(-32_768)
    }
    host.stdout?.on('data', collect)
    host.stderr?.on('data', collect)
    // A cancelled run never reaches its `After` hook, so record the Host: the next run's sweep reaps exactly this pid
    // and nothing that merely looks like it (a live `dshx dev up` Host has the same profile).
    await recordScratchProcess({
      ledgerPath: scratchLedgerPath(DSHFILES_ROOT),
      pid: host.pid,
      signature: `--profile ${prepared.profile} --port ${String(port)}`,
    })
    try {
      const spawnStartedAt = Date.now()
      const url = await waitForHostUrl(host, () => output, profileLabel, timeoutMs)
      traceBootPhase('host-url', spawnStartedAt, profileLabel)
      return { host, port, url, output: () => redactHostOutput(output) }
    } catch (error) {
      try {
        if (host.exitCode === null && host.signalCode === null) await stopOwnedProcess(host)
      } catch {
        await prepared.dispose()
      }
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(redactHostOutput(message))
    }
  }

  try {
    const initial = await start(await findFreePort())
    const lifecycle = createScratchHostLifecycle({
      initial,
      start,
      dispose: async () => {
        await egressGuard.close()
        await prepared.dispose()
      },
    })
    return {
      get url() {
        return lifecycle.url
      },
      profile: prepared.profile,
      homeRoot: prepared.homeRoot,
      get port() {
        return lifecycle.port
      },
      expectedClientEntries,
      get host() {
        return lifecycle.host
      },
      output: () => lifecycle.output(),
      egressAttempts: () => egressGuard.attempts(),
      restart: () => lifecycle.restart(),
      close: () => lifecycle.close(),
    }
  } catch (error) {
    await egressGuard.close()
    await prepared.dispose()
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(redactHostOutput(message))
  }
}

// A bundle's sources do not change during a run, so each worker builds it once instead of once per scenario; `pnpm
// check:e2e` builds every bundle up front and sets DSHX_E2E_PREBUILT=1 to skip even that.
const builtBundles = new Set<string>()

const buildBundleOnce = async (bundle: { readonly projectRoot: string; readonly packageId: string }): Promise<void> => {
  if (process.env.DSHX_E2E_PREBUILT === '1' || builtBundles.has(bundle.packageId)) return
  await buildPlugin(bundle.projectRoot, bundle.packageId)
  builtBundles.add(bundle.packageId)
}

/** Boot a scratch composition of all owned bundles without touching the user's `web` profile. */
export const bootProfile = async (profileLabel: string, timeoutMs = 90_000): Promise<BootedProfile> => {
  const bundles = requireNonEmptyBundles(await LocalBundleModel.listLocalBootBundles(), 'No owned plugin bundles were found for the composed scratch profile.')
  for (const bundle of bundles) await buildBundleOnce(bundle)
  const prepareStartedAt = Date.now()
  const cordisPatch = await withStartupAcknowledgements(bundles.map(bundle => bundle.packageId))
  const prepared = await prepareComposedBootProfile(bundles, { sourceProfileRoot, cordisPatch })
  traceBootPhase('prepare', prepareStartedAt, profileLabel)
  const expectedClientEntries = bundles.filter(bundle => bundle.hasClient).map(bundle => bundle.packageId)
  try {
    return await startScratchProfile(prepared, profileLabel, expectedClientEntries, timeoutMs)
  } catch (error) {
    await prepared.dispose()
    throw error
  }
}

interface ComposedBootRequest {
  /** Resolve once before preparing or prewarming a profile; restarts use the same installed core. */
  readonly executable: string
  readonly packageIds: readonly [string, ...string[]]
  readonly profileLabel: string
  readonly timeoutMs: number
  readonly additionalBundleIds: readonly string[]
  readonly seedHome?: (homeRoot: string) => Promise<void | { readonly hostPathPrefix?: string }>
  /** Stable recipe identity permits prewarming; each sibling still runs seedHome in its own new home. */
  readonly seedKey?: string
  readonly cordisPatch?: string
  /** Extra environment for the Host process, e.g. a plugin's verification switch. */
  readonly hostEnv?: Readonly<Record<string, string>>
}

/**
 * A Host's startup is 4-12s and cannot be cached, only overlapped: a worker's scenarios overwhelmingly share one
 * composition (23 of 26 in thread-sidebar.feature), so while a scenario runs its steps, boot a sibling of the same
 * composition and hand it to the next scenario that asks for one. Isolation is untouched — the sibling owns its own
 * home, Host and port, exactly as an on-demand boot would — and an unused sibling is closed in the `After` hook.
 */
const prewarmRecipes = new Map<string, ComposedBootRequest>()
const prewarmSlots = new Map<string, { readonly startedAt: number; readonly pending: Promise<BootedProfile | undefined> }>()
const profileCompositionKeys = new WeakMap<BootedProfile, string>()
/** Hosts a prewarm owns right now: the worker's exit is synchronous, so they are killed by pid, not awaited. */
const prewarmedHostPids = new Set<number>()

const killPrewarmedHostsOnExit = (): void => {
  for (const pid of prewarmedHostPids) {
    for (const target of [-pid, pid]) {
      try {
        process.kill(target, 'SIGKILL')
      } catch {
        // Already gone.
      }
    }
  }
  prewarmedHostPids.clear()
}

process.once('exit', killPrewarmedHostsOnExit)

const compositionKeyOf = (request: ComposedBootRequest): string | undefined => {
  if (request.seedHome !== undefined && request.seedKey === undefined) return undefined
  const hash = createHash('sha256')
  const env = Object.entries(request.hostEnv ?? {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('&')
  hash.update(
    `${[...request.packageIds].sort().join(',')}\0${[...request.additionalBundleIds].sort().join(',')}\0${request.cordisPatch ?? ''}\0${request.executable}\0${request.seedKey ?? ''}\0${env}`,
  )
  return hash.digest('hex')
}

/**
 * Boot a sibling of this profile in the background, so the next scenario of the same composition starts instantly. At
 * most one spare is kept: a worker's next scenario usually wants the same composition, and one it does not want is
 * dead weight, so an untaken spare is dropped before a new one starts.
 */
export const prewarmSibling = (profile: BootedProfile): void => {
  const key = profileCompositionKeys.get(profile)
  if (key === undefined || process.env.DSHX_E2E_PREWARM === '0' || prewarmSlots.has(key)) return
  const recipe = prewarmRecipes.get(key)
  if (recipe === undefined) return
  void closePrewarmedProfiles()
  const pending = bootComposedProfile(recipe)
    .then(booted => {
      if (booted.host.pid !== undefined) prewarmedHostPids.add(booted.host.pid)
      return booted
    })
    .catch(() => undefined)
  prewarmSlots.set(key, { startedAt: Date.now(), pending })
}

/** Close whatever the worker prewarmed and no scenario consumed. */
export const closePrewarmedProfiles = async (): Promise<void> => {
  const slots = [...prewarmSlots.values()]
  prewarmSlots.clear()
  prewarmedHostPids.clear()
  for (const slot of slots) {
    const profile = await slot.pending
    if (profile !== undefined) traceBootPhase('prewarm-dropped', slot.startedAt)
    await profile?.close().catch(() => undefined)
  }
}

const bootComposedProfile = async (request: ComposedBootRequest): Promise<BootedProfile> => {
  const available = await LocalBundleModel.listLocalBootBundles()
  const bundles = requireNonEmptyBundles(
    LocalBundleModel.withSharedStylesheet(LocalBundleModel.resolveLocalBundles(request.packageIds, available), available),
    'No requested owned plugin bundles were found for the composed scratch profile.',
  )
  for (const bundle of bundles) await buildBundleOnce(bundle)
  const prepareStartedAt = Date.now()
  const cordisPatch = await withStartupAcknowledgements(
    bundles.map(bundle => bundle.packageId),
    request.cordisPatch,
  )
  const prepared = await prepareComposedBootProfile(bundles, { additionalBundleIds: request.additionalBundleIds, sourceProfileRoot, cordisPatch })
  traceBootPhase('prepare', prepareStartedAt, request.profileLabel)
  const expectedClientEntries = bundles.filter(bundle => bundle.hasClient).map(bundle => bundle.packageId)
  try {
    const seededHome = await request.seedHome?.(prepared.homeRoot)
    return await startScratchProfile(
      prepared,
      request.profileLabel,
      expectedClientEntries,
      request.timeoutMs,
      seededHome?.hostPathPrefix,
      request.hostEnv,
      request.executable,
    )
  } catch (error) {
    await prepared.dispose()
    throw error
  }
}

export const bootComposedPluginProfile = async (request: {
  readonly packageIds: readonly [string, ...string[]]
  readonly profileLabel: string
  readonly timeoutMs?: number
  readonly additionalBundleIds?: readonly string[]
  readonly seedHome?: (homeRoot: string) => Promise<void | { readonly hostPathPrefix?: string }>
  /** Stable recipe identity permits prewarming; each sibling still runs seedHome in its own new home. */
  readonly seedKey?: string
  readonly cordisPatch?: string
  /** Extra environment for the Host process, e.g. a plugin's verification switch. */
  readonly hostEnv?: Readonly<Record<string, string>>
}): Promise<BootedProfile> => {
  if (request.seedKey !== undefined && (request.seedHome === undefined || request.seedKey.trim() === '')) {
    throw new Error('A non-empty seedKey requires a deterministic seedHome recipe.')
  }
  const composed: ComposedBootRequest = {
    executable: await resolveDshExecutable(undefined, process.env, DSHFILES_ROOT),
    packageIds: request.packageIds,
    profileLabel: request.profileLabel,
    timeoutMs: request.timeoutMs ?? 90_000,
    additionalBundleIds: request.additionalBundleIds ?? [],
    ...(request.seedHome === undefined ? {} : { seedHome: request.seedHome }),
    ...(request.seedKey === undefined ? {} : { seedKey: request.seedKey }),
    ...(request.cordisPatch === undefined ? {} : { cordisPatch: request.cordisPatch }),
    ...(request.hostEnv === undefined ? {} : { hostEnv: request.hostEnv }),
  }
  const compositionKey = compositionKeyOf(composed)
  if (compositionKey !== undefined) {
    const slot = prewarmSlots.get(compositionKey)
    if (slot !== undefined) {
      prewarmSlots.delete(compositionKey)
      const prewarmed = await slot.pending
      if (prewarmed !== undefined) {
        // The scenario owns this Host now: the exit guard must not kill it, and only one spare is ever kept.
        prewarmedHostPids.clear()
        traceBootPhase('prewarmed-take', slot.startedAt, composed.profileLabel)
        return prewarmed
      }
    }
  }
  const profile = await bootComposedProfile(composed)
  if (compositionKey !== undefined) {
    prewarmRecipes.set(compositionKey, composed)
    profileCompositionKeys.set(profile, compositionKey)
  }
  return profile
}

/**
 * Boot a scratch profile around one fixture bundle that lives outside plugins/@dshfiles (under e2e/fixtures), so a
 * scenario can compose a deliberately broken bundle without it ever joining the owned plugin set. The fixture's client
 * entry is expected, so a boot that never loads it fails instead of looking clean.
 */
export const bootFixtureBundleProfile = async (
  fixture: { readonly projectRoot: string; readonly packageId: string },
  timeoutMs = 90_000,
): Promise<BootedProfile> => {
  const prepared = await prepareComposedBootProfile([fixture], { sourceProfileRoot })
  try {
    return await startScratchProfile(prepared, fixture.packageId, [fixture.packageId], timeoutMs)
  } catch (error) {
    await prepared.dispose()
    throw error
  }
}

export const bootPluginProfile = async (packageId: string, timeoutMs = 90_000): Promise<BootedProfile> =>
  bootComposedPluginProfile({
    packageIds: [packageId],
    profileLabel: packageId,
    timeoutMs,
    ...(packageId === '@dshfiles/ai-accounts' ? { seedHome: seedAiAccountsWorkspace, seedKey: AI_ACCOUNTS_WORKSPACE_SEED_KEY } : {}),
  })
