/**
 * Send preparers for a new thread's first message, published as the `@dshfiles/rich-composer/composer-send` dshx
 * module. When the composer sends the first message of a blank Session, after the Host created it and before the
 * prompt, each preparer may set the thread up (its agent's preset, model and record) and rewrite the outgoing text (an
 * agent's instructions ahead of the request). The composer keeps the draft as typed; only the sent text changes.
 *
 * A plugin adds one with `api.add(ComposerSendPreparers, …)`; the composer owns the send and calls the preparers in
 * `order`. A preparer that throws or exceeds its time is skipped and the text it was given is sent unchanged, so a
 * missing or failing provider never blocks a send. Imports no React and no provider: a plugin that prepares sends
 * depends on rich-composer, never the reverse (docs/plugin-boundaries.md).
 */
import { defineRegistry } from '@dshfiles/dshx/client'

export interface ComposerSendInput {
  /** The Host Session the message goes to; it exists on the Host and has not started a turn. */
  readonly sessionId: string
  /** The outgoing text as serialized for the wire (`@{handle}` mentions, reference tokens), after earlier preparers. */
  readonly text: string
  /** Aborts when the send is cancelled; a preparer stops its Host work then. */
  readonly signal: AbortSignal
}

export interface ComposerSendPreparer {
  /** Unique across plugins: the providing package plus a verb (`@dshfiles/agents.thread-agent`). */
  readonly id: string
  /** Lower first. */
  readonly order?: number
  /** Resolve the text to send instead, or undefined to keep it. */
  readonly prepare: (input: ComposerSendInput) => Promise<{ readonly text: string } | undefined>
}

export const ComposerSendPreparers = defineRegistry<ComposerSendPreparer>('@dshfiles/rich-composer.composer-send-preparer')
