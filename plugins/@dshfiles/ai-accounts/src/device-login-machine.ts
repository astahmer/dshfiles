/** One explicit device-login lifecycle shared by the Codex and Copilot host sign-in services. */
export interface DeviceLoginPrompt {
  readonly userCode: string
  readonly verificationUri: string
}

export type DeviceLoginPhase<Failure extends string = string> =
  | { readonly kind: 'idle'; readonly message: string | null }
  | ActiveDeviceLoginPhase
  | { readonly kind: 'complete'; readonly message: string; readonly prompt: DeviceLoginPrompt | null }
  | { readonly kind: 'failed'; readonly message: string; readonly failure: Failure; readonly prompt: DeviceLoginPrompt | null }
  | { readonly kind: 'cancelled'; readonly message: string }

export type ActiveDeviceLoginPhase =
  | { readonly kind: 'starting'; readonly message: string }
  | { readonly kind: 'running'; readonly message: string }
  | { readonly kind: 'waiting'; readonly message: string; readonly prompt: DeviceLoginPrompt }
  | { readonly kind: 'adopting'; readonly message: string; readonly prompt: DeviceLoginPrompt | null }

export type DeviceLoginEvent<Failure extends string = string> =
  | { readonly type: 'start'; readonly message: string }
  | { readonly type: 'run' }
  | { readonly type: 'device'; readonly message: string; readonly prompt: DeviceLoginPrompt }
  | { readonly type: 'adopt' }
  | { readonly type: 'complete'; readonly message: string }
  | { readonly type: 'fail'; readonly message: string; readonly failure: Failure }
  | { readonly type: 'cleanup-failed'; readonly message: string; readonly failure: Failure }
  | { readonly type: 'cancel'; readonly message: string }
  | { readonly type: 'reset'; readonly message: string }
  | { readonly type: 'message'; readonly message: string }

export type DeviceLoginStatus = 'idle' | 'starting' | 'waiting' | 'complete' | 'error' | 'cancelled'

export interface DeviceLoginView<Failure extends string = string> {
  readonly status: DeviceLoginStatus
  readonly message: string | null
  readonly prompt: DeviceLoginPrompt | null
  readonly failure: Failure | null
}

export class DeviceLoginModel {
  static readonly isActive = <Failure extends string = string>(phase: DeviceLoginPhase<Failure>): phase is ActiveDeviceLoginPhase =>
    phase.kind === 'starting' || phase.kind === 'running' || phase.kind === 'waiting' || phase.kind === 'adopting'

  static readonly prompt = <Failure extends string>(phase: DeviceLoginPhase<Failure>): DeviceLoginPrompt | null =>
    phase.kind === 'waiting' || phase.kind === 'adopting' || phase.kind === 'complete' || phase.kind === 'failed' ? phase.prompt : null

  /** Bad combinations — device codes outside `waiting`, a cancel after adoption, a fail or complete after cancellation — are unrepresentable. */
  static readonly transition = <Failure extends string>(phase: DeviceLoginPhase<Failure>, event: DeviceLoginEvent<Failure>): DeviceLoginPhase<Failure> => {
    switch (event.type) {
      case 'start':
        return DeviceLoginModel.isActive(phase) ? phase : { kind: 'starting', message: event.message }
      case 'run':
        return phase.kind === 'starting' ? { kind: 'running', message: phase.message } : phase
      case 'device':
        return phase.kind === 'starting' || phase.kind === 'running' || phase.kind === 'waiting'
          ? { kind: 'waiting', message: event.message, prompt: event.prompt }
          : phase
      case 'adopt':
        return DeviceLoginModel.isActive(phase) && phase.kind !== 'adopting'
          ? { kind: 'adopting', message: phase.message, prompt: DeviceLoginModel.prompt(phase) }
          : phase
      case 'complete':
        return DeviceLoginModel.isActive(phase) ? { kind: 'complete', message: event.message, prompt: DeviceLoginModel.prompt(phase) } : phase
      case 'fail':
        return phase.kind === 'complete' || DeviceLoginModel.isActive(phase)
          ? { kind: 'failed', message: event.message, failure: event.failure, prompt: DeviceLoginModel.prompt(phase) }
          : phase
      case 'cleanup-failed':
        return phase.kind === 'idle' ? phase : { kind: 'failed', message: event.message, failure: event.failure, prompt: DeviceLoginModel.prompt(phase) }
      case 'cancel':
        return DeviceLoginModel.isActive(phase) ? { kind: 'cancelled', message: event.message } : phase
      case 'reset':
        return { kind: 'idle', message: event.message }
      case 'message':
        return DeviceLoginModel.isActive(phase) ? { ...phase, message: event.message } : phase
    }
  }

  /** The shared projection for both public state schemas; each service keeps its own fields and prompt policy. */
  static readonly view = <Failure extends string>(phase: DeviceLoginPhase<Failure>): DeviceLoginView<Failure> => {
    switch (phase.kind) {
      case 'idle':
        return { status: 'idle', message: phase.message, prompt: null, failure: null }
      case 'starting':
      case 'running':
        return { status: 'starting', message: phase.message, prompt: null, failure: null }
      case 'waiting':
      case 'adopting':
        return { status: 'waiting', message: phase.message, prompt: phase.prompt, failure: null }
      case 'complete':
        return { status: 'complete', message: phase.message, prompt: phase.prompt, failure: null }
      case 'failed':
        return { status: 'error', message: phase.message, prompt: phase.prompt, failure: phase.failure }
      case 'cancelled':
        return { status: 'cancelled', message: phase.message, prompt: null, failure: null }
    }
  }
}
