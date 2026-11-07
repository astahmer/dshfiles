import type { PendingInteractionPublisher } from '@deepseek-ai/dsh-client-ui-session/client'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RemoteInteraction } from './api.js'

declare module '@deepseek-ai/dsh-client-ui-session/client' {
  interface SessionPendingInteractionMap {
    /** A tool call on another machine waiting on this person's decision. */
    'remote-approval': PendingRemoteApproval
  }
}

export type RemoteApprovalOutcome = 'allowed-once' | 'rejected'

type ApprovalRow = RemoteInteraction & { readonly request: Extract<RemoteInteraction['request'], { readonly kind: 'approval' }> }

const isApproval = (row: RemoteInteraction): row is ApprovalRow => row.request.kind === 'approval'

type Decide = (input: {
  readonly sessionId: string
  readonly interactionId: string
  readonly outcome: RemoteApprovalOutcome
}) => Promise<{ readonly ok: true } | { readonly ok: false; readonly message: string }>

/** One request the owning runtime holds open, as the composer seat presents it. The owner decides whether it is valid. */
export class PendingRemoteApproval {
  readonly kind = 'remote-approval' as const
  readonly key: string
  readonly sessionId: SessionId
  readonly toolName: string
  readonly callId: string | undefined
  readonly reason: string | undefined
  readonly displayReason: Readonly<Record<string, string>> | undefined
  readonly #decide: Decide
  readonly #id: string

  constructor(row: ApprovalRow, decide: Decide) {
    this.#id = row.id
    this.#decide = decide
    this.key = `remote-approval:${row.id}`
    this.sessionId = SessionId(row.sessionId)
    this.toolName = row.request.toolName
    this.callId = row.request.callId
    this.reason = row.request.reason
    this.displayReason = row.request.displayReason
  }

  /** Send the decision to the owner; a refusal is thrown for the panel to show, and the request stays. */
  async answer(outcome: RemoteApprovalOutcome): Promise<void> {
    const result = await this.#decide({ sessionId: this.sessionId, interactionId: this.#id, outcome })
    if (!result.ok) throw new Error(result.message)
  }
}

/** Keep the composer seat equal to what the owners hold: a new row publishes a card, a row that went removes it. */
export class RemoteApprovals {
  readonly #cards = new Map<string, () => void>()
  readonly #publish: PendingInteractionPublisher<PendingRemoteApproval>
  readonly #decide: Decide

  constructor(input: { readonly publish: PendingInteractionPublisher<PendingRemoteApproval>; readonly decide: Decide }) {
    this.#publish = input.publish
    this.#decide = input.decide
  }

  sync(rows: readonly RemoteInteraction[]): void {
    const held = rows.filter(isApproval)
    const current = new Set(held.map(row => row.id))
    for (const [id, remove] of this.#cards) {
      if (current.has(id)) continue
      remove()
      this.#cards.delete(id)
    }
    for (const row of held) {
      if (this.#cards.has(row.id)) continue
      // The owner keeps the request, so leaving the seat here hands nothing on.
      this.#cards.set(
        row.id,
        this.#publish(new PendingRemoteApproval(row, this.#decide), () => Promise.resolve()),
      )
    }
  }

  dispose(): void {
    for (const remove of this.#cards.values()) remove()
    this.#cards.clear()
  }
}
