import type { BacklogAttention } from './item.js'

const attentionPhrases = {
  none: 'cleared the request',
  'needs-input': 'asked for your input',
  blocked: 'flagged it blocked',
  waiting: 'set it waiting',
} satisfies Record<BacklogAttention, string>

/** `attention: blocked (the thread failed: RATE_LIMIT)`: an attention signal with the reason it fired. */
const attentionSignal = /^attention: (none|needs-input|blocked|waiting)(?: \((.*)\))?$/u

const signalPhrase = (value: string | undefined): string | undefined => {
  if (value === 'none') return attentionPhrases.none
  if (value === 'needs-input') return attentionPhrases['needs-input']
  if (value === 'blocked') return attentionPhrases.blocked
  if (value === 'waiting') return attentionPhrases.waiting
  return undefined
}

/**
 * One event as a short sentence after the actor's name. An early attention edit recorded only the field name, so the
 * item's current attention says what it was set to; a signal records its own value and why it fired.
 */
export const activityPhrase = (event: { readonly kind: string; readonly detail: string; readonly actor: string }, attention: BacklogAttention): string => {
  if (event.kind === 'created') return 'captured it'
  if (event.kind === 'moved') return `moved it ${event.detail}`
  if (event.kind === 'commented') return 'commented'
  if (event.kind === 'linked') return `linked ${event.detail}`
  if (event.kind === 'unlinked') return `unlinked ${event.detail}`
  if (event.kind === 'triaged') return event.actor === 'system' ? `triage ${event.detail}` : `${event.detail.split(' ')[0] ?? 'handled'} a suggestion`
  const signal = attentionSignal.exec(event.detail)
  const phrase = signal === null ? undefined : signalPhrase(signal[1])
  if (phrase !== undefined) return signal?.[2] === undefined ? phrase : `${phrase} (${signal[2]})`
  if (event.detail === 'attention') return attentionPhrases[attention]
  return `edited ${event.detail}`
}
