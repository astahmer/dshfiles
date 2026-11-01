import * as Schema from 'effect/Schema'

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
export const htmlPageSchema = Schema.Struct({
  title: Schema.String,
  html: Schema.String,
  height: Schema.Number.check(Schema.isFinite(), Schema.isInt()),
  theme: Schema.Literals(htmlPageThemes),
})
export type HtmlPage = typeof htmlPageSchema.Type

/** `z.string().trim()`: decode to the trimmed value, so every check below measures it. */
export const trimmedText = Schema.String.pipe(Schema.decodeTo(Schema.Trim))

const utf8 = new TextEncoder()

const clampHeight = (height: number | undefined): number =>
  Math.min(HtmlPageLimits.maxHeight, Math.max(HtmlPageLimits.minHeight, Math.round(height ?? HtmlPageLimits.defaultHeight)))

const toolArgsSchema = Schema.Struct({
  title: trimmedText.check(
    Schema.makeFilter(value => (value.length > 0 ? true : 'title is empty; give the page a short name.')),
    Schema.isMaxLength(HtmlPageLimits.maxTitleLength),
  ),
  html: Schema.String.check(Schema.makeFilter(value => (value.length > 0 ? true : 'html is empty; pass the complete page markup.'))),
  height: Schema.optional(Schema.Number.check(Schema.isFinite())),
  theme: Schema.optional(Schema.Literals(htmlPageThemes)),
})

type HtmlPageParse = { readonly ok: true; readonly page: HtmlPage; readonly bytes: number } | { readonly ok: false; readonly error: string }

const byteLength = (html: string): number => utf8.encode(html).byteLength

const formatBytes = (bytes: number): string => (bytes < 1024 ? `${String(bytes)} B` : `${(bytes / 1024).toFixed(1)} KB`)

const pathKey = (segment: { readonly key: PropertyKey } | PropertyKey): string => (typeof segment === 'object' ? String(segment.key) : String(segment))

/**
 * Decode tool arguments once, at the boundary, naming every invalid field. The Standard Schema view is the same one
 * the Host publishes, so a rejected call and its published contract can never disagree about what is valid.
 */
export const decodeToolArguments = <ValueSchema extends Schema.ConstraintDecoder<unknown>>(
  schema: ValueSchema,
  args: unknown,
): { readonly ok: true; readonly value: ValueSchema['Type'] } | { readonly ok: false; readonly error: string } => {
  const result = Schema.toStandardSchemaV1(schema)['~standard'].validate(args)
  if (result instanceof Promise) throw new TypeError('Tool arguments decode synchronously.')
  if (result.issues === undefined) return { ok: true, value: result.value }
  return { ok: false, error: result.issues.map(issue => `${issue.path?.map(pathKey).join('.') || 'arguments'}: ${issue.message}`).join('; ') }
}

/** Validate html_render arguments once, at the tool boundary; partial streaming arguments fail the same way. */
const parse = (args: unknown): HtmlPageParse => {
  const decoded = decodeToolArguments(toolArgsSchema, args)
  if (!decoded.ok) return { ok: false, error: decoded.error }
  const bytes = byteLength(decoded.value.html)
  if (bytes > HtmlPageLimits.maxHtmlBytes)
    return {
      ok: false,
      error: `html is ${formatBytes(bytes)}; html_render accepts at most ${formatBytes(HtmlPageLimits.maxHtmlBytes)}. Downsample inline images, drop unused CSS or data, or split the page into several html_render calls.`,
    }
  return {
    ok: true,
    bytes,
    page: {
      title: decoded.value.title,
      html: decoded.value.html,
      height: clampHeight(decoded.value.height),
      theme: decoded.value.theme ?? 'auto',
    },
  }
}

const decode = (value: unknown): HtmlPage => Schema.decodeUnknownSync(htmlPageSchema)(value)

export class HtmlPageModel {
  static readonly byteLength = byteLength
  static readonly formatBytes = formatBytes
  static readonly parse = parse
  static readonly decode = decode
}
