import type { DevChildProcess, DevState } from './types.js'

export type DevFace = 'host' | 'client'

/** Latest build outcome of one compiler face; `ready-failed` is a successful build whose latest rebuild failed. */
export type FaceBuild = 'idle' | 'building' | 'failed' | 'ready' | 'rebuilding' | 'ready-failed'

/** The parallel build region: one generation tag plus one phase per configured face. */
export interface BuildsState {
  readonly generation: number
  readonly host: FaceBuild
  readonly client: FaceBuild
}

export interface FaceConfigured {
  readonly host: boolean
  readonly client: boolean
}

export const initialBuilds = (configured: FaceConfigured): BuildsState => ({
  generation: 0,
  host: configured.host ? 'building' : 'idle',
  client: configured.client ? 'building' : 'idle',
})

export const nextBuildGeneration = (state: BuildsState): number => state.generation + 1

export const nextBuilds = (state: BuildsState, configured: FaceConfigured): BuildsState => ({
  generation: nextBuildGeneration(state),
  host: configured.host ? 'building' : 'idle',
  client: configured.client ? 'building' : 'idle',
})

export const isFaceReady = (phase: FaceBuild): boolean => phase === 'ready' || phase === 'rebuilding' || phase === 'ready-failed'

export const buildsReady = (state: BuildsState): boolean =>
  (state.host === 'idle' || isFaceReady(state.host)) && (state.client === 'idle' || isFaceReady(state.client))

export type BuildEventKind = 'begin' | 'failed' | 'succeeded'

export interface BuildAdvance {
  readonly builds: BuildsState
  readonly initial: boolean
}

const beginFace = (phase: FaceBuild): FaceBuild => {
  if (phase === 'idle' || phase === 'building' || phase === 'rebuilding') return phase
  return phase === 'failed' ? 'building' : 'rebuilding'
}

const failFace = (phase: FaceBuild): FaceBuild => {
  if (phase === 'idle' || phase === 'failed' || phase === 'ready-failed') return phase
  return phase === 'ready' || phase === 'rebuilding' ? 'ready-failed' : 'failed'
}

const withFace = (state: BuildsState, face: DevFace, phase: FaceBuild): BuildsState =>
  face === 'host' ? { ...state, host: phase } : { ...state, client: phase }

/** Apply one build event of a known generation; a stale generation or an unconfigured face is ignored. */
export const advanceBuild = (
  state: BuildsState,
  event: { readonly generation: number; readonly face: DevFace; readonly kind: BuildEventKind },
): BuildAdvance | undefined => {
  if (event.generation !== state.generation) return undefined
  const phase = state[event.face]
  if (phase === 'idle') return undefined
  if (event.kind === 'succeeded') return { builds: withFace(state, event.face, 'ready'), initial: !isFaceReady(phase) }
  return { builds: withFace(state, event.face, event.kind === 'begin' ? beginFace(phase) : failFace(phase)), initial: false }
}

export type ChildPhase =
  | { readonly kind: 'pending' }
  | { readonly kind: 'starting'; readonly completion: Promise<void> }
  | { readonly kind: 'running'; readonly child: DevChildProcess }
  | { readonly kind: 'restart-required'; readonly child: DevChildProcess }
  | { readonly kind: 'failed' }
  | { readonly kind: 'ended' }

export const initialChild: ChildPhase = { kind: 'pending' }

export const isChildRunning = (phase: ChildPhase): boolean => phase.kind === 'running' || phase.kind === 'restart-required'

export type ChildEvent =
  | { readonly kind: 'start'; readonly completion: Promise<void> }
  | { readonly kind: 'spawned'; readonly child: DevChildProcess }
  | { readonly kind: 'start-failed' }
  | { readonly kind: 'exited' }
  | { readonly kind: 'restart-required' }
  | { readonly kind: 'stopped' }
  | { readonly kind: 'reset' }
  | { readonly kind: 'ended' }

/** The one child region transition; every event that its phase does not accept leaves it unchanged. */
export const transitionChild = (phase: ChildPhase, event: ChildEvent): ChildPhase => {
  if (phase.kind === 'ended') return phase
  switch (event.kind) {
    case 'start':
      return phase.kind === 'pending' ? { kind: 'starting', completion: event.completion } : phase
    case 'spawned':
      return phase.kind === 'starting' ? { kind: 'running', child: event.child } : phase
    case 'start-failed':
      return phase.kind === 'starting' ? { kind: 'failed' } : phase
    case 'exited':
      return isChildRunning(phase) ? { kind: 'failed' } : phase
    case 'restart-required':
      return phase.kind === 'running' ? { kind: 'restart-required', child: phase.child } : phase
    case 'stopped':
      return phase.kind === 'running' || phase.kind === 'restart-required' || phase.kind === 'failed' ? { kind: 'pending' } : phase
    case 'reset':
      return { kind: 'pending' }
    case 'ended':
      return { kind: 'ended' }
  }
}

export type ReloadPhase =
  | { readonly kind: 'idle' }
  | { readonly kind: 'queued'; readonly changedFile: string }
  | { readonly kind: 'running'; readonly changedFile: string; readonly next: string | undefined }

export const initialReload: ReloadPhase = { kind: 'idle' }

/** Coalesce a project change: the latest file wins, and a change during a reload becomes its next pass. */
export const requestReload = (phase: ReloadPhase, changedFile: string): ReloadPhase => {
  if (phase.kind === 'running') return { kind: 'running', changedFile: phase.changedFile, next: changedFile }
  return { kind: 'queued', changedFile }
}

export const beginReload = (phase: ReloadPhase): { readonly phase: ReloadPhase; readonly changedFile: string } | undefined => {
  if (phase.kind !== 'queued') return undefined
  return { phase: { kind: 'running', changedFile: phase.changedFile, next: undefined }, changedFile: phase.changedFile }
}

export const finishReload = (phase: ReloadPhase): ReloadPhase => {
  if (phase.kind !== 'running') return phase
  return phase.next === undefined ? { kind: 'idle' } : { kind: 'queued', changedFile: phase.next }
}

export type DevLifecycle = 'open' | 'closing' | 'closed'

export const isClosed = (lifecycle: DevLifecycle): boolean => lifecycle !== 'open'

const faceDisplay = (phase: FaceBuild): DevState['hostBuild'] => {
  if (phase === 'idle') return 'idle'
  if (phase === 'ready') return 'ok'
  if (phase === 'failed' || phase === 'ready-failed') return 'error'
  return 'building'
}

const childDisplay = (phase: ChildPhase): DevState['dshProcess'] => {
  switch (phase.kind) {
    case 'pending':
      return 'stopped'
    case 'starting':
      return 'starting'
    case 'running':
    case 'restart-required':
      return 'running'
    case 'failed':
      return 'failed'
    case 'ended':
      return 'stopped'
  }
}

export interface SessionRegions {
  readonly lifecycle: DevLifecycle
  readonly builds: BuildsState
  readonly child: ChildPhase
}

export const projectDevState = (state: SessionRegions): DevState => ({
  hostBuild: faceDisplay(state.builds.host),
  clientBuild: faceDisplay(state.builds.client),
  hostRestartRequired: state.child.kind === 'restart-required',
  dshProcess: isClosed(state.lifecycle) ? 'stopped' : childDisplay(state.child),
})
