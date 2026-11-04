import { Schema } from 'effect'

/** A preview call was refused; the message tells the caller what to change and retry. */
export class PreviewRefused extends Schema.TaggedError<PreviewRefused>()(
  'PreviewRefused',
  {
    tool: Schema.String,
    recovery: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
  { dshxWireCode: 'preview' },
) {
  override get message(): string {
    return this.recovery
  }
}

/** The caller asked for a thread it does not own. */
export class PreviewThreadRefused extends Schema.TaggedError<PreviewThreadRefused>()(
  'PreviewThreadRefused',
  { reason: Schema.Literals(['no-thread', 'other-thread']), sessionId: Schema.optional(Schema.String) },
  { dshxWireCode: 'preview-thread' },
) {
  override get message(): string {
    if (this.reason === 'no-thread') return 'Pass the sessionId of the thread.'
    return 'An agent can only act on its own thread’s preview pages and dev servers.'
  }
}

/** The Host half has not activated yet, or the renderer was asked for a caller it does not serve. */
export class PreviewInactive extends Schema.TaggedError<PreviewInactive>()(
  'PreviewInactive',
  { reason: Schema.Literals(['inactive', 'plugin-only']), cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'preview' },
) {
  override get message(): string {
    if (this.reason === 'plugin-only') return 'preview-render serves other DSH Host plugins only; agents use html_render_screenshot.'
    return 'The preview Host is not active. Reload the page; if it persists, restart DSH.'
  }
}
