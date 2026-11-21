import { Schema } from 'effect'

/** A client tool call that could not run; the message says what to change and retry. */
export class ClientToolRefused extends Schema.TaggedError<ClientToolRefused>()(
  'ClientToolRefused',
  {
    reason: Schema.Literals(['disabled', 'not-agent', 'no-window', 'unknown-window', 'unknown-tool', 'timeout', 'window-closed', 'failed']),
    recovery: Schema.String,
  },
  { dshxWireCode: 'client-bridge' },
) {
  override get message(): string {
    return this.recovery
  }
}
