import { z } from 'zod'

export const HTML_RENDER_TOOL = 'html_render'
export const HTML_PREVIEW_TOOL = 'html_preview'
export const HTML_SCREENSHOT_TOOL = 'html_render_screenshot'

export const HtmlPageLimits = {
  maxHtmlBytes: 512 * 1024,
  maxTitleLength: 200,
  minHeight: 80,
  maxHeight: 2000,
  defaultHeight: 360,
} as const

export const htmlPageThemes = ['auto', 'light', 'dark'] as const
export type HtmlPageTheme = (typeof htmlPageThemes)[number]

/** The page a settled call persists as its presentation metadata; the card reads it back on reload. */
export const htmlPageSchema = z.object({
  title: z.string(),
  html: z.string(),
  height: z.number().int(),
  theme: z.enum(htmlPageThemes),
})
export type HtmlPage = z.infer<typeof htmlPageSchema>

const utf8 = new TextEncoder()

const clampHeight = (height: number | undefined): number =>
  Math.min(HtmlPageLimits.maxHeight, Math.max(HtmlPageLimits.minHeight, Math.round(height ?? HtmlPageLimits.defaultHeight)))

const toolArgsSchema = z.object({
  title: z.string().trim().min(1, 'title is empty; give the page a short name.').max(HtmlPageLimits.maxTitleLength),
  html: z.string().min(1, 'html is empty; pass the complete page markup.'),
  height: z.number().finite().optional(),
  theme: z.enum(htmlPageThemes).optional(),
})

type HtmlPageParse = { readonly ok: true; readonly page: HtmlPage; readonly bytes: number } | { readonly ok: false; readonly error: string }

const byteLength = (html: string): number => utf8.encode(html).byteLength

const formatBytes = (bytes: number): string => (bytes < 1024 ? `${String(bytes)} B` : `${(bytes / 1024).toFixed(1)} KB`)

/** Validate html_render arguments once, at the tool boundary; partial streaming arguments fail the same way. */
const parse = (args: unknown): HtmlPageParse => {
  const parsed = toolArgsSchema.safeParse(args)
  if (!parsed.success) return { ok: false, error: parsed.error.issues.map(issue => `${issue.path.join('.') || 'arguments'}: ${issue.message}`).join('; ') }
  const bytes = byteLength(parsed.data.html)
  if (bytes > HtmlPageLimits.maxHtmlBytes)
    return {
      ok: false,
      error: `html is ${formatBytes(bytes)}; html_render accepts at most ${formatBytes(HtmlPageLimits.maxHtmlBytes)}. Downsample inline images, drop unused CSS or data, or split the page into several html_render calls.`,
    }
  return {
    ok: true,
    bytes,
    page: { title: parsed.data.title, html: parsed.data.html, height: clampHeight(parsed.data.height), theme: parsed.data.theme ?? 'auto' },
  }
}

export class HtmlPageModel {
  static readonly byteLength = byteLength
  static readonly formatBytes = formatBytes
  static readonly parse = parse
}
