import { defineTool } from '@dshfiles/dshx/host'
import { HTML_RENDER_TOOL, HtmlPageLimits, HtmlPageModel, htmlPageThemes } from './html-page.js'

export const htmlRenderTool = defineTool({
  name: HTML_RENDER_TOOL,
  description: [
    'Publish a self-contained HTML page (chart, mockup, table, diagram, collage) to the user as a card in the chat transcript.',
    `The page runs in a sandboxed iframe with no network access: inline every script, style and image (data: URIs); external URLs, fetch and forms are blocked. Max ${HtmlPageModel.formatBytes(HtmlPageLimits.maxHtmlBytes)} of HTML.`,
    'The page inherits theme CSS variables: --dsh-bg, --dsh-surface, --dsh-fg, --dsh-muted, --dsh-border, --dsh-accent, --dsh-success, --dsh-warning, --dsh-danger, --dsh-font and --dsh-mono-font; use them so it matches light and dark mode.',
    'The user can resize the card, expand it to full screen, open it in a new tab and copy its HTML. Use it to show, not to tell: keep the answer text short when the page carries the content.',
  ].join(' '),
  parameters: {
    title: {
      type: 'string',
      required: true,
      description: `Short page name shown in the card header (at most ${String(HtmlPageLimits.maxTitleLength)} characters).`,
    },
    html: { type: 'string', required: true, description: 'Complete page markup: a full document or a body fragment, with inline CSS and JavaScript.' },
    height: {
      type: 'integer',
      description: `Initial card height in pixels, ${String(HtmlPageLimits.minHeight)}–${String(HtmlPageLimits.maxHeight)}; defaults to ${String(HtmlPageLimits.defaultHeight)}. The user can resize it.`,
    },
    theme: {
      type: 'string',
      enum: htmlPageThemes,
      description: 'auto (default) follows the DSH light/dark theme; light or dark pins the page colours.',
    },
  },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        title: { type: 'string', required: true },
        html: { type: 'string', required: true },
        height: { type: 'integer', required: true },
        theme: { type: 'string', enum: htmlPageThemes, required: true },
        bytes: { type: 'integer', required: true },
      },
    },
    render: (_args, value) => [
      {
        type: 'text',
        text: `Published "${value.title}" (${HtmlPageModel.formatBytes(value.bytes)}) to the user as an HTML card in the transcript. The user sees it; do not repeat its content.`,
      },
    ],
    presentationMeta: (_args, value) => ({ title: value.title, html: value.html, height: value.height, theme: value.theme }),
  },
  isConcurrencySafe: () => true,
  async execute(args) {
    const parsed = HtmlPageModel.parse(args)
    if (!parsed.ok) throw new Error(parsed.error)
    return { ...parsed.page, bytes: parsed.bytes }
  },
})
