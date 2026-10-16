export type ContinuationMessage = {
  readonly content: readonly { readonly type: string; readonly text?: string }[]
  readonly source: { readonly kind: string; readonly rpcId?: unknown }
}

export type UserActivityIdentity = {
  readonly continuationId: string | null
  readonly queueSource: 'manual' | 'schedule' | null
}

const CONTINUATION_MARKER = 'ai-accounts-quota-continuation'

export class QuotaContinuationMessage {
  static markerFor = (continuationId: string): string => `<!-- ${CONTINUATION_MARKER}:${continuationId} -->`

  static promptFor = (continuationId: string): string =>
    `${QuotaContinuationMessage.markerFor(continuationId)}\nA provider quota interrupted the previous turn. Review the latest user request, the recorded tool outcomes, and the current state. Continue only when earlier actions have known outcomes; ask before repeating anything that may already have taken effect.`

  private static textOf = (message: ContinuationMessage): string | null => {
    if (message.content.length !== 1 || message.content[0]?.type !== 'text') return null
    return message.content[0].text ?? null
  }

  static continuationIdOf = (message: ContinuationMessage): string | null => {
    const text = QuotaContinuationMessage.textOf(message)
    const match = text?.match(/^<!-- ai-accounts-quota-continuation:([0-9a-f-]{36}) -->\n/i)
    const continuationId = match?.[1]
    if (continuationId === undefined || text !== QuotaContinuationMessage.promptFor(continuationId)) return null
    if (message.source.kind === 'schedule') return continuationId
    if (message.source.kind === 'user' && message.source.rpcId === continuationId) return continuationId
    return null
  }

  static userActivityForMessage = (message: ContinuationMessage): UserActivityIdentity => {
    const continuationId = QuotaContinuationMessage.continuationIdOf(message)
    return {
      continuationId,
      queueSource: continuationId === null ? null : message.source.kind === 'schedule' ? 'schedule' : 'manual',
    }
  }
}
