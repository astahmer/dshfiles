import type { AccountConnectionSnapshot } from './api.js'

type SetupWork = Promise<AccountConnectionSnapshot>

/**
 * Where one connection-operation stands. Every flag the flow used to keep beside its status is a variant here:
 * configuring and committing cannot coexist, and a committed operation has no staging left to clean.
 */
export type SetupPhase =
  | { readonly kind: 'pending' }
  | { readonly kind: 'configuring'; readonly configuration: SetupWork }
  | { readonly kind: 'verifying'; readonly completion: SetupWork }
  | { readonly kind: 'committing'; readonly completion: SetupWork }
  | { readonly kind: 'complete' }
  | {
      readonly kind: 'discarded'
      /** What the operation abandoned; cleanup joins it before removing the private staging. */
      readonly joining: SetupWork | undefined
      readonly cleaned: boolean
      readonly cleanup: Promise<void> | undefined
      readonly resourceCleanup: Promise<void> | undefined
    }

export type SetupEvent =
  | { readonly kind: 'configure'; readonly configuration: SetupWork }
  | { readonly kind: 'configured' }
  | { readonly kind: 'verify'; readonly completion: SetupWork }
  | { readonly kind: 'commit' }
  | { readonly kind: 'committed' }
  | { readonly kind: 'commitFailed' }
  | { readonly kind: 'discard' }
  | { readonly kind: 'cleaned' }

export class AccountSetupPhaseModel {
  static joiningOf = (phase: SetupPhase): SetupWork | undefined => {
    if (phase.kind === 'configuring') return phase.configuration
    if (phase.kind === 'verifying' || phase.kind === 'committing') return phase.completion
    return phase.kind === 'discarded' ? phase.joining : undefined
  }

  /** The only way an operation changes phase; a committed or discarded operation ignores every later event. */
  static transition = (phase: SetupPhase, event: SetupEvent): SetupPhase => {
    switch (event.kind) {
      case 'configure':
        return phase.kind === 'pending' ? { kind: 'configuring', configuration: event.configuration } : phase
      case 'configured':
        return phase.kind === 'configuring' ? { kind: 'pending' } : phase
      case 'verify':
        return phase.kind === 'pending' ? { kind: 'verifying', completion: event.completion } : phase
      case 'commit':
        return phase.kind === 'verifying' ? { kind: 'committing', completion: phase.completion } : phase
      case 'committed':
        return phase.kind === 'committing' ? { kind: 'complete' } : phase
      case 'commitFailed':
        return phase.kind === 'committing' ? { kind: 'pending' } : phase
      case 'discard':
        return phase.kind === 'pending' || phase.kind === 'configuring' || phase.kind === 'verifying'
          ? { kind: 'discarded', joining: AccountSetupPhaseModel.joiningOf(phase), cleaned: false, cleanup: undefined, resourceCleanup: undefined }
          : phase
      case 'cleaned':
        return phase.kind === 'discarded' && !phase.cleaned ? { ...phase, cleaned: true } : phase
    }
  }

  static statusOf = (phase: SetupPhase): AccountConnectionSnapshot['status'] => {
    switch (phase.kind) {
      case 'pending':
      case 'configuring':
        return 'pending'
      case 'verifying':
      case 'committing':
        return 'verifying'
      case 'complete':
        return 'complete'
      case 'discarded':
        return 'discarded'
    }
  }
}
