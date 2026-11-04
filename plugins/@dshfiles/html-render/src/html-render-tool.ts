import { Tool } from '@dshfiles/dshx/effect'
import { Effect, Schema } from 'effect'
import { HTML_RENDER_TOOL, HtmlPageLimits, HtmlPageModel, htmlPageSchema, htmlPageThemes } from './html-page.js'
import { HtmlPages } from './html-page-store.js'
import { HtmlToolRefused } from './html-refusal.js'

const inputSchema = Schema.Struct({
  title: Schema.String.annotate({ description: `Short page name shown in the card header (at most ${String(HtmlPageLimits.maxTitleLength)} characters).` }),
  html: Schema.String.annotate({ description: 'Complete page markup: a full document or a body fragment, with inline CSS and JavaScript.' }),
  height: Schema.optionalKey(
    Schema.Int.annotate({
      description: `Initial card height in pixels, ${String(HtmlPageLimits.minHeight)}–${String(HtmlPageLimits.maxHeight)}; defaults to ${String(HtmlPageLimits.defaultHeight)}. The user can resize it.`,
    }),
  ),
  theme: Schema.optionalKey(
    Schema.Literals(htmlPageThemes).annotate({ description: 'auto (default) follows the DSH light/dark theme; light or dark pins the page colours.' }),
  ),
})

const outputSchema = Schema.Struct({ ...htmlPageSchema.fields, bytes: Schema.Int })

export const htmlRenderTool = Tool.make({
  name: HTML_RENDER_TOOL,
  description: [
    'Publish a self-contained HTML page (chart, mockup, table, diagram, collage) to the user as a card in the chat transcript.',
    `The page runs in a sandboxed iframe with no network access: inline every script, style and image (data: URIs); external URLs, fetch and forms are blocked. Max ${HtmlPageModel.formatBytes(HtmlPageLimits.maxHtmlBytes)} of HTML.`,
    'The page inherits theme CSS variables: --dsh-bg, --dsh-surface, --dsh-fg, --dsh-muted, --dsh-border, --dsh-accent, --dsh-success, --dsh-warning, --dsh-danger, --dsh-font and --dsh-mono-font; use them so it matches light and dark mode.',
    'The user can resize the card, expand it to full screen, open it in a new tab and copy its HTML. Use it to show, not to tell: keep the answer text short when the page carries the content.',
  ].join(' '),
  input: inputSchema,
  output: outputSchema,
  readOnly: true,
  render: output =>
    `Published "${output.title}" (${HtmlPageModel.formatBytes(output.bytes)}) to the user as an HTML card in the transcript. The user sees it; do not repeat its content.`,
  presentation: output => ({ title: output.title, html: output.html, height: output.height, theme: output.theme }),
  execute: Effect.fn('html page render')(function* (input, call) {
    const parsed = HtmlPageModel.parse(input)
    if (!parsed.ok) return yield* new HtmlToolRefused({ tool: HTML_RENDER_TOOL, recovery: parsed.error })
    const sessionId = call.sessionId
    if (sessionId !== undefined) yield* HtmlPages.use(pages => pages.remember({ sessionId, callId: call.callId, page: parsed.page, bytes: parsed.bytes }))
    return { ...parsed.page, bytes: parsed.bytes }
  }),
})
