import { Schema } from 'effect'
import { HTML_PREVIEW_TOOL, HTML_RENDER_TOOL, HTML_SCREENSHOT_TOOL } from './html-page.js'

/** An html tool refused the call; `recovery` tells the agent what to change, and is the whole message it reads. */
export class HtmlToolRefused extends Schema.TaggedError<HtmlToolRefused>()(
  'HtmlToolRefused',
  {
    tool: Schema.Literals([HTML_RENDER_TOOL, HTML_PREVIEW_TOOL, HTML_SCREENSHOT_TOOL]),
    recovery: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
  { dshxWireCode: 'html-render-refused' },
) {
  override get message(): string {
    return this.recovery
  }
}
