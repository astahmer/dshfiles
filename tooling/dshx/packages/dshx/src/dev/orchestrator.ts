import { execa } from 'execa'
import { resolve } from 'node:path'
import type { BuildClientOptions } from '../compiler/client/build.js'
import { watchClient } from '../compiler/client/build.js'
import type { BuildHostOptions } from '../compiler/host/build.js'
import { watchHost } from '../compiler/host/build.js'
import { DshxError } from '../diagnostics.js'
import type { DshxDiagnostic } from '../diagnostics.js'
import type { JsonObject, JsonValue } from '../json.js'
import { resolveDshxConfig } from '../config/resolve.js'
import { ProfileOrchestrator } from '../profile/orchestrator.js'
import { watchProjectFiles } from './project-watcher.js'
import type { DevBuildEvent, DevChildProcess, DevEvent, DevProjectWatcher, DevSession, DevSessionOptions, DevState, DevWatcher } from './types.js'
import type { ResolvedDshxConfig } from '../config/types.js'
import {
  DevSessionStateModel,
  type BuildsState,
  type ChildPhase,
  type DevFace,
  type DevLifecycle,
  type FaceConfigured,
  type ReloadPhase,
} from './session-state.js'

const DEFAULT_STOP_TIMEOUT_MS = 3_000

type WatcherGroupPhase = 'buffering' | 'active' | 'closed'

interface CompilerWatcherGroup {
  readonly generation: number
  readonly watchers: { host?: DevWatcher; client?: DevWatcher }
  readonly pending: Array<{ readonly face: DevFace; readonly event: DevBuildEvent }>
  phase: WatcherGroupPhase
  eventChain: Promise<void>
}

function diagnostic(code: string, message: string, file: string, hint: string): DshxDiagnostic {
  return { code, severity: 'error', message, file, hint }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

const isJsonObject = (value: JsonValue | undefined): value is JsonObject => typeof value === 'object' && value !== null && !Array.isArray(value)

function clientManifestArray(project: ResolvedDshxConfig, field: 'external' | 'inject'): readonly string[] {
  const dsh = project.manifest.dsh
  if (!isJsonObject(dsh)) return []
  const client = dsh.client
  if (!isJsonObject(client)) return []
  const value = client[field]
  if (!Array.isArray(value)) return []
  const strings = value.filter((item): item is string => typeof item === 'string')
  return strings.length === value.length ? strings : []
}

function childFromExeca(
  project: ResolvedDshxConfig,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  executable: 'local' | 'global',
): Promise<DevChildProcess> {
  const subprocess = execa('dsh', [...args], {
    cwd: project.root,
    env,
    preferLocal: executable === 'local',
    stdio: ['ignore', 'inherit', 'inherit'],
    reject: false,
  })
  const child = subprocess.nodeChildProcess
  if (child === undefined) {
    return Promise.reject(
      new DshxError('DSHX4401', 'Failed to start the DSH process.', {
        file: project.packageFile,
        hint: 'Install @deepseek-ai/dsh in the project or make the official dsh command available on PATH, then retry.',
      }),
    )
  }
  void subprocess.catch(() => undefined)
  return Promise.resolve(child)
}

interface BuildPaths {
  readonly host?: BuildHostOptions
  readonly client?: BuildClientOptions
}

function buildOptions(project: ResolvedDshxConfig, compatibility: import('../compat/types.js').DshCompatibility): BuildPaths {
  return {
    ...(project.hostEntry !== undefined && {
      host: {
        packageId: project.packageId,
        logicalName: project.name,
        root: project.root,
        entry: project.hostEntry,
        outDir: project.outDir,
        sourcemap: project.build.sourcemap,
        declarations: project.build.declarations ?? true,
        bundleDependencies: project.hostBundleDependencies ?? [],
        ...(project.hostDshxRuntime !== undefined && { dshxRuntime: project.hostDshxRuntime }),
        ...(project.hostVitePlugins !== undefined && { vite: { plugins: project.hostVitePlugins } }),
        compatibility,
        ...(project.dev.hostHmr !== undefined && { generation: { hostContractVersion: project.dev.hostHmr.hostContractVersion } }),
      },
    }),
    ...(project.clientEntry !== undefined && {
      client: {
        packageId: project.packageId,
        logicalName: project.name,
        root: project.root,
        entry: project.clientEntry,
        outDir: project.outDir,
        sourcemap: project.build.sourcemap,
        declarations: project.build.declarations ?? true,
        bundleDependencies: project.clientBundleDependencies ?? [],
        ...(project.clientShared !== undefined && { shared: project.clientShared }),
        ...(project.clientSharedRuntime !== undefined && { sharedRuntime: project.clientSharedRuntime }),
        ...(project.clientVitePlugins !== undefined && { vite: { plugins: project.clientVitePlugins } }),
        external: clientManifestArray(project, 'external'),
        inject: clientManifestArray(project, 'inject'),
        compatibility,
      },
    }),
  }
}

function projectInputs(project: ResolvedDshxConfig): readonly string[] {
  return [
    ...new Set([
      resolve(project.root, 'dshx.config.ts'),
      project.packageFile,
      ...(project.configFile === undefined ? [] : [project.configFile]),
      ...project.configDependencies,
    ]),
  ]
}

const facesOf = (project: ResolvedDshxConfig): FaceConfigured => ({
  host: project.hostEntry !== undefined,
  client: project.clientEntry !== undefined,
})

/** Start a coordinated Host/Client watch build and selected DSH process. */
export async function startDevSession(project: ResolvedDshxConfig, options: DevSessionOptions = {}): Promise<DevSession> {
  const environment = { ...process.env, ...options.profile?.env, ...options.env }
  const profileOptions = { ...options.profile, env: environment }
  const ensureProfile = options.ensureProfile ?? ProfileOrchestrator.ensureProjectProfile
  let activeProject = project
  let activeProfile = options.preparedProfile ?? (await ensureProfile(project, profileOptions))
  const initialBuildPaths = buildOptions(project, activeProfile.dsh.compatibility)
  const listeners = new Set<(event: DevEvent) => void>()
  const diagnostics: DshxDiagnostic[] = [...activeProfile.diagnostics]
  let activeWatchers: CompilerWatcherGroup | undefined
  let projectWatcher: DevProjectWatcher | undefined
  let lifecycle: DevLifecycle = 'open'
  let builds: BuildsState = DevSessionStateModel.initialBuilds(facesOf(project))
  let child: ChildPhase = DevSessionStateModel.initialChild
  let reload: ReloadPhase = DevSessionStateModel.initialReload
  let restartQueue: Promise<void> = Promise.resolve()
  let reloadCompletion: Promise<void> = Promise.resolve()
  let state: DevState = DevSessionStateModel.projectDevState({ lifecycle, builds, child })

  const emit = (event: DevEvent): void => {
    for (const listener of [...listeners]) listener(event)
  }
  const publish = (): void => {
    state = DevSessionStateModel.projectDevState({ lifecycle, builds, child })
    emit({ type: 'state', state })
  }
  const emitDiagnostic = (item: DshxDiagnostic): void => {
    diagnostics.push(item)
    emit({ type: 'diagnostic', diagnostic: item })
  }
  const currentChild = (): DevChildProcess | undefined => (child.kind === 'running' || child.kind === 'restart-required' ? child.child : undefined)

  const stopChild = async (target: DevChildProcess): Promise<void> => {
    const exited = new Promise<void>(resolve => {
      target.on('exit', () => resolve())
    })
    target.kill('SIGTERM')
    const timeout = options.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS
    let timer: ReturnType<typeof setTimeout> | undefined
    const didExit = await Promise.race([
      exited.then(() => true),
      new Promise<false>(resolve => {
        timer = setTimeout(() => resolve(false), timeout)
      }),
    ])
    if (timer !== undefined) clearTimeout(timer)
    if (!didExit) target.kill('SIGKILL')
  }

  const runChildStart = async (input: {
    readonly restarting: boolean
    readonly project: ResolvedDshxConfig
    readonly profile: typeof activeProfile
    readonly starting: ChildPhase
  }): Promise<void> => {
    // `--open` is a DSHX-only policy flag. rc.2 opens the browser when no
    // `--no-open` flag is present, but rejects an explicit `--open` argument.
    const requestedDshArgs = options.dshArgs ?? []
    const forwardedDshArgs = requestedDshArgs.filter(arg => arg !== '--open')
    const args = [
      '--profile',
      input.profile.profile,
      ...(input.profile.profile === 'web' && !requestedDshArgs.includes('--open') && !forwardedDshArgs.includes('--no-open') ? ['--no-open'] : []),
      ...forwardedDshArgs,
    ]
    const childEnvironment = options.inspectBridge === true ? { ...environment, DSHX_INSPECT_BRIDGE: '1' } : environment
    try {
      const childFactory =
        options.child ?? ((projectValue, childArgs, childEnv) => childFromExeca(projectValue, childArgs, childEnv, input.profile.dsh.executable ?? 'local'))
      const started = await childFactory(input.project, args, childEnvironment)
      if (child !== input.starting) {
        await stopChild(started)
        return
      }
      child = DevSessionStateModel.transitionChild(child, { kind: 'spawned', child: started })
      started.on('error', error => {
        if (currentChild() !== started) return
        child = DevSessionStateModel.transitionChild(child, { kind: 'exited' })
        publish()
        emitDiagnostic(
          diagnostic(
            input.restarting ? 'DSHX4404' : 'DSHX4401',
            `DSH process failed to start: ${errorMessage(error)}`,
            input.project.packageFile,
            'Install DSH locally or make the official dsh command available on PATH, then retry.',
          ),
        )
      })
      started.on('exit', (code, signal) => {
        if (currentChild() !== started) return
        child = DevSessionStateModel.transitionChild(child, { kind: 'exited' })
        publish()
        const item = diagnostic(
          code === null ? 'DSHX4403' : 'DSHX4402',
          code === null ? `DSH process exited due to signal ${signal ?? 'unknown'}.` : `DSH process exited with code ${code}.`,
          input.project.packageFile,
          'Inspect the DSH stderr output, then call restart() after fixing the issue.',
        )
        emit({ type: 'dsh-exit', code, signal, diagnostic: item })
        emitDiagnostic(item)
      })
      publish()
    } catch (error) {
      if (child !== input.starting) return
      child = DevSessionStateModel.transitionChild(child, { kind: 'start-failed' })
      publish()
      emitDiagnostic(
        diagnostic(
          input.restarting ? 'DSHX4404' : 'DSHX4401',
          `Failed to start DSH process: ${errorMessage(error)}`,
          input.project.packageFile,
          'Install DSH locally or make the official dsh command available on PATH, then retry.',
        ),
      )
    }
  }

  const startChild = (restarting = false): Promise<void> => {
    if (child.kind === 'starting') return child.completion
    if (DevSessionStateModel.isClosed(lifecycle) || !DevSessionStateModel.buildsReady(builds)) return Promise.resolve()
    let settle!: () => void
    const completion = new Promise<void>(resolve => {
      settle = resolve
    })
    child = DevSessionStateModel.transitionChild(child, { kind: 'start', completion })
    if (child.kind !== 'starting') {
      settle()
      return Promise.resolve()
    }
    publish()
    return runChildStart({ restarting, project: activeProject, profile: activeProfile, starting: child }).finally(settle)
  }

  const startInitialChild = async (): Promise<void> => {
    if (child.kind !== 'pending' || !DevSessionStateModel.buildsReady(builds)) return
    await startChild()
  }

  const stopDsh = async (): Promise<void> => {
    if (!DevSessionStateModel.isChildRunning(child)) {
      if (child.kind !== 'failed') return
      child = DevSessionStateModel.transitionChild(child, { kind: 'stopped' })
      publish()
      return
    }
    const target = currentChild()
    child = DevSessionStateModel.transitionChild(child, { kind: 'stopped' })
    publish()
    if (target !== undefined) await stopChild(target)
  }

  const restartInternal = async (): Promise<void> => {
    if (DevSessionStateModel.isClosed(lifecycle) || reload.kind !== 'idle') return
    await stopDsh()
    await startChild(true)
  }

  const restart = (): Promise<void> => {
    restartQueue = restartQueue.then(restartInternal, restartInternal)
    return restartQueue
  }

  const handleBuildEvent = async (generation: number, face: DevFace, event: DevBuildEvent): Promise<void> => {
    if (DevSessionStateModel.isClosed(lifecycle) || reload.kind !== 'idle') return
    if (event.code === 'START' || event.code === 'BUNDLE_START') {
      const advanced = DevSessionStateModel.advanceBuild(builds, { generation, face, kind: 'begin' })
      if (advanced === undefined) return
      builds = advanced.builds
      publish()
      return
    }
    if (event.code === 'ERROR') {
      const advanced = DevSessionStateModel.advanceBuild(builds, { generation, face, kind: 'failed' })
      if (advanced === undefined) return
      builds = advanced.builds
      publish()
      const file = face === 'host' ? (activeProject.hostEntry ?? activeProject.packageFile) : (activeProject.clientEntry ?? activeProject.packageFile)
      const item = diagnostic(
        'DSHX4406',
        `${face === 'host' ? 'Host' : 'Client'} build failed: ${errorMessage(event.error)}`,
        file,
        'Fix the source error; the watcher remains active and will retry on the next change.',
      )
      emit({ type: 'build-error', face, error: event.error, diagnostic: item })
      emitDiagnostic(item)
      return
    }
    if (event.code !== 'BUNDLE_END') return
    const advanced = DevSessionStateModel.advanceBuild(builds, { generation, face, kind: 'succeeded' })
    if (advanced === undefined) return
    builds = advanced.builds
    publish()
    emit({ type: 'build-success', face, initial: advanced.initial })
    if (!advanced.initial && DevSessionStateModel.isChildRunning(child)) {
      if (face === 'client') {
        emit({ type: 'client-rebuilt' })
      } else if (activeProject.dev.hostHmr !== undefined) {
        emit({ type: 'host-generation-updated' })
      } else if (activeProject.dev.hostRestart === 'auto') {
        await restart()
      } else {
        if (child.kind === 'running') {
          child = DevSessionStateModel.transitionChild(child, { kind: 'restart-required' })
          publish()
        }
        emit({ type: 'host-restart-required' })
      }
    }
    await startInitialChild()
  }

  const closeCompilerWatchers = async (group: CompilerWatcherGroup, reportErrors = true): Promise<void> => {
    if (group.phase === 'closed') return
    group.phase = 'closed'
    await group.eventChain.catch(() => undefined)
    await Promise.all(
      Object.entries(group.watchers).map(async ([face, watcher]) => {
        if (watcher === undefined) return
        try {
          await watcher.close()
        } catch (error) {
          if (!reportErrors) return
          emitDiagnostic(
            diagnostic(
              'DSHX4405',
              `Failed to close the ${face === 'host' ? 'Host' : 'Client'} watcher: ${errorMessage(error)}`,
              activeProject.packageFile,
              'Check for stale file watchers and restart the session.',
            ),
          )
        }
      }),
    )
  }

  const createCompilerWatchers = async (
    candidate: ResolvedDshxConfig,
    paths: ReturnType<typeof buildOptions>,
    generation: number,
  ): Promise<CompilerWatcherGroup> => {
    const group: CompilerWatcherGroup = {
      generation,
      watchers: {},
      pending: [],
      phase: 'buffering',
      eventChain: Promise.resolve(),
    }
    const attach = async (face: DevFace): Promise<void> => {
      try {
        const created =
          face === 'host'
            ? await (options.hostWatcher ?? (async (opts: BuildHostOptions): Promise<DevWatcher> => watchHost(opts)))(paths.host!)
            : await (options.clientWatcher ?? (async (opts: BuildClientOptions): Promise<DevWatcher> => watchClient(opts)))(paths.client!)
        group.watchers[face] = created
        created.on('event', event => {
          if (group.phase === 'closed') return
          if (group.phase === 'buffering') {
            group.pending.push({ face, event })
            return
          }
          const operation = handleBuildEvent(group.generation, face, event).catch(error => {
            emitDiagnostic(
              diagnostic('DSHX4405', `${face} watcher failed: ${errorMessage(error)}`, candidate.packageFile, 'Close and restart the development session.'),
            )
          })
          group.eventChain = Promise.all([group.eventChain, operation]).then(() => undefined)
        })
      } catch (error) {
        const item = diagnostic(
          'DSHX4405',
          `Failed to start ${face} watcher: ${errorMessage(error)}`,
          candidate.packageFile,
          'Fix the compiler configuration, then restart the development session.',
        )
        await closeCompilerWatchers(group, false)
        throw new DshxError(item.code, item.message, { cause: error, file: item.file, hint: item.hint })
      }
    }
    if (paths.host !== undefined) await attach('host')
    if (paths.client !== undefined) await attach('client')
    return group
  }

  const activateCompilerWatchers = (group: CompilerWatcherGroup): void => {
    if (group.phase !== 'buffering') return
    group.phase = 'active'
    for (const { face, event } of group.pending.splice(0)) {
      const operation = handleBuildEvent(group.generation, face, event).catch(error => {
        emitDiagnostic(
          diagnostic(
            'DSHX4405',
            `Watcher failed while activating a new project configuration: ${errorMessage(error)}`,
            activeProject.packageFile,
            'Fix the source error or restart the development session.',
          ),
        )
      })
      group.eventChain = Promise.all([group.eventChain, operation]).then(() => undefined)
    }
  }

  const createProjectWatcher = async (candidate: ResolvedDshxConfig): Promise<DevProjectWatcher> => {
    const factory = options.projectWatcher ?? watchProjectFiles
    return factory(projectInputs(candidate), file => requestProjectReload(file))
  }

  const closeProjectWatcher = async (): Promise<void> => {
    await projectWatcher?.close().catch(error => {
      emitDiagnostic(
        diagnostic(
          'DSHX4408',
          `Failed to close the project watcher: ${errorMessage(error)}`,
          activeProject.packageFile,
          'Check for stale file watchers and restart the session.',
        ),
      )
    })
  }

  const discardCandidates = async (
    candidateWatchers: CompilerWatcherGroup | undefined,
    candidateProjectWatcher: DevProjectWatcher | undefined,
  ): Promise<void> => {
    if (candidateWatchers !== undefined) await closeCompilerWatchers(candidateWatchers, false)
    await candidateProjectWatcher?.close().catch(() => undefined)
  }

  const reloadProject = async (changedFile: string): Promise<void> => {
    let candidateWatchers: CompilerWatcherGroup | undefined
    let candidateProjectWatcher: DevProjectWatcher | undefined
    try {
      const resolver = options.resolveProject ?? resolveDshxConfig
      const candidate = await resolver({ cwd: activeProject.root })
      if (DevSessionStateModel.isClosed(lifecycle)) return
      const candidateProfile = await ensureProfile(candidate, profileOptions)
      if (DevSessionStateModel.isClosed(lifecycle)) return
      const candidateBuildPaths = buildOptions(candidate, candidateProfile.dsh.compatibility)
      candidateWatchers = await createCompilerWatchers(candidate, candidateBuildPaths, DevSessionStateModel.nextBuildGeneration(builds))
      try {
        candidateProjectWatcher = await createProjectWatcher(candidate)
      } catch (error) {
        await discardCandidates(candidateWatchers, undefined)
        candidateWatchers = undefined
        throw error
      }
      if (DevSessionStateModel.isClosed(lifecycle)) {
        await discardCandidates(candidateWatchers, candidateProjectWatcher)
        return
      }

      await restartQueue.catch(() => undefined)
      if (DevSessionStateModel.isClosed(lifecycle)) {
        await discardCandidates(candidateWatchers, candidateProjectWatcher)
        return
      }
      if (activeWatchers !== undefined) await closeCompilerWatchers(activeWatchers)
      await stopDsh()
      await closeProjectWatcher()
      if (DevSessionStateModel.isClosed(lifecycle)) {
        await discardCandidates(candidateWatchers, candidateProjectWatcher)
        return
      }

      activeProject = candidate
      activeProfile = candidateProfile
      activeWatchers = candidateWatchers
      projectWatcher = candidateProjectWatcher
      candidateWatchers = undefined
      candidateProjectWatcher = undefined
      builds = DevSessionStateModel.nextBuilds(builds, facesOf(candidate))
      child = DevSessionStateModel.transitionChild(child, { kind: 'reset' })
      publish()
      activateCompilerWatchers(activeWatchers)
      for (const item of candidateProfile.diagnostics) emitDiagnostic(item)
      await activeWatchers.eventChain
      await startInitialChild()
    } catch (error) {
      await discardCandidates(candidateWatchers, candidateProjectWatcher)
      if (DevSessionStateModel.isClosed(lifecycle)) return
      const file = error instanceof DshxError && error.file !== undefined ? error.file : changedFile
      emitDiagnostic(
        diagnostic(
          'DSHX4407',
          `Project configuration reload failed; the last-good development session is still active: ${errorMessage(error)}`,
          file,
          'Fix the config, package manifest, or imported config dependency. DSHX will retry on the next watched change.',
        ),
      )
    }
  }

  const drainProjectReloads = async (): Promise<void> => {
    while (!DevSessionStateModel.isClosed(lifecycle)) {
      const started = DevSessionStateModel.beginReload(reload)
      if (started === undefined) return
      reload = started.phase
      await reloadProject(started.changedFile)
      reload = DevSessionStateModel.finishReload(reload)
    }
  }

  function requestProjectReload(file: string): void {
    if (DevSessionStateModel.isClosed(lifecycle)) return
    const idle = reload.kind === 'idle'
    reload = DevSessionStateModel.requestReload(reload, file)
    if (!idle) return
    reloadCompletion = drainProjectReloads()
    void reloadCompletion.catch(() => undefined)
  }

  const session: DevSession = {
    get state() {
      return state
    },
    get diagnostics() {
      return diagnostics
    },
    on<T extends DevEvent['type']>(eventOrListener: T | ((event: DevEvent) => void), typedListener?: (event: Extract<DevEvent, { type: T }>) => void) {
      const listener =
        typeof eventOrListener === 'function'
          ? eventOrListener
          : (event: DevEvent): void => {
              if (event.type === eventOrListener) {
                // SAFETY: the equality check selects exactly the event type the caller registered T for.
                typedListener?.(event as Extract<DevEvent, { type: T }>)
              }
            }
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    restart,
    async close() {
      if (DevSessionStateModel.isClosed(lifecycle)) return
      lifecycle = 'closing'
      reload = DevSessionStateModel.initialReload
      await closeProjectWatcher()
      await reloadCompletion.catch(() => undefined)
      if (activeWatchers !== undefined) await closeCompilerWatchers(activeWatchers)
      await stopDsh()
      if (child.kind === 'starting') await child.completion.catch(() => undefined)
      await restartQueue.catch(() => undefined)
      await stopDsh()
      child = DevSessionStateModel.transitionChild(child, { kind: 'ended' })
      lifecycle = 'closed'
      publish()
    },
  }

  emit({ type: 'state', state })
  try {
    activeWatchers = await createCompilerWatchers(activeProject, initialBuildPaths, builds.generation)
    projectWatcher = await createProjectWatcher(activeProject)
    activateCompilerWatchers(activeWatchers)
  } catch (error) {
    lifecycle = 'closed'
    if (activeWatchers !== undefined) await closeCompilerWatchers(activeWatchers, false)
    await closeProjectWatcher()
    if (error instanceof DshxError) throw error
    throw new DshxError('DSHX4408', `Failed to start the project configuration watcher: ${errorMessage(error)}`, {
      cause: error,
      file: activeProject.configFile ?? activeProject.packageFile,
      hint: 'Check file watcher permissions and restart the development session.',
    })
  }
  await startInitialChild()
  return session
}
