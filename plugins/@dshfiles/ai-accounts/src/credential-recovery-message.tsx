import type { TurnLocation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { TurnErrorActionOwnerProps } from '@dshfiles/chat/turn-error-action'
import { TurnFailure } from '@dshfiles/chat/turn-error-action'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { KeyRoundIcon } from '@dshfiles/plugin-ui/icons'
import { useEffect, useSyncExternalStore } from 'react'
import { isCredentialRecoveryFailure } from './credential-recovery.js'

/**
 * The failed turns whose card already shows the action (the owned Chat fork's seat). A composition with the native Chat
 * has no seat, so the action stays under the turn there; with the fork it shows once, in the card.
 */
const seated = new Set<number>()
const listeners = new Set<() => void>()
const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
const seat = (seq: number): (() => void) => {
  seated.add(seq)
  for (const listener of [...listeners]) listener()
  return () => {
    seated.delete(seq)
    for (const listener of [...listeners]) listener()
  }
}

/**
 * The failure card's primary for a credential failure (round four D5): Retry and "Ask to fix" are not offered there,
 * so this is the one control that can change the outcome. Chat's `TurnFailure` reads core's own "no API key" sentence,
 * which carries no code.
 */
export const CredentialRecoveryAction = (
  props: Pick<TurnErrorActionOwnerProps, 'code' | 'message'> & {
    readonly seq?: number
    readonly onOpenAccounts: () => void
    readonly actionLabel: string
  },
): JSX.Element | null => {
  const credential = TurnFailure.isCredential(props) || isCredentialRecoveryFailure({ code: props.code.trim() })
  const seq = props.seq
  useEffect(() => (credential && seq !== undefined ? seat(seq) : undefined), [credential, seq])
  if (!credential) return null
  return (
    <Button className="dshx-root" variant="default" size="sm" onClick={props.onOpenAccounts}>
      <KeyRoundIcon />
      {props.actionLabel}
    </Button>
  )
}

/** The same action under a failed turn, for a composition whose Chat has no failure-card seat (the native Chat). */
export const CredentialRecoveryTail = (props: {
  readonly turn: TurnLocation
  readonly onOpenAccounts: () => void
  readonly actionLabel: string
}): JSX.Element | null => {
  const end = props.turn.end
  const read = (): boolean => end !== undefined && seated.has(end.seq)
  const inCard = useSyncExternalStore(subscribe, read, read)
  if (end === undefined || inCard || end.data.reason.kind !== 'error') return null
  const error = end.data.reason.error
  if (!isCredentialRecoveryFailure(error) && !TurnFailure.isCredential({ code: error.code, message: error.message })) return null
  return (
    <div className="dshx-root dshx:mt-2 dshx:flex dshx:items-center">
      <Button variant="default" size="sm" onClick={props.onOpenAccounts}>
        <KeyRoundIcon />
        {props.actionLabel}
      </Button>
    </div>
  )
}
