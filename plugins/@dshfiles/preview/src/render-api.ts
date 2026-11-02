import { defineApi, method } from '@dshfiles/dshx/api'
import * as Schema from 'effect/Schema'

export const RenderHtmlLimits = {
  maxDocumentChars: 700_000,
  minWidth: 320,
  maxWidth: 1920,
  defaultWidth: 1280,
  minHeight: 200,
  maxHeight: 2000,
  defaultHeight: 800,
  maxFullPageHeight: 6000,
} as const

const screenshotOutputSchema = Schema.Struct({
  image: Schema.String.annotate({ description: 'Base64 JPEG.' }),
  mediaType: Schema.Literal('image/jpeg'),
  width: Schema.Number.check(Schema.isFinite(), Schema.isInt()),
  height: Schema.Number.check(Schema.isFinite(), Schema.isInt()),
})

export type RenderHtmlScreenshot = typeof screenshotOutputSchema.Type

/**
 * Screenshots of untrusted HTML for other Host plugins (html-render's html_render_screenshot). The preview Host owns the
 * Chromium; the caller owns what the document is. Only plugin callers are served: a Client or an Agent uses the
 * caller's own tool instead.
 */
export const previewRenderApi = defineApi({
  id: 'preview-render',
  version: 1,
  owner: '@dshfiles/preview',
  methods: {
    screenshotHtml: method({
      input: Schema.Struct({
        document: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(RenderHtmlLimits.maxDocumentChars)).annotate({
          description: 'Complete HTML document to show; it runs in a sandboxed frame.',
        }),
        width: Schema.optionalKey(
          Schema.Number.check(
            Schema.isFinite(),
            Schema.isInt(),
            Schema.isGreaterThanOrEqualTo(RenderHtmlLimits.minWidth),
            Schema.isLessThanOrEqualTo(RenderHtmlLimits.maxWidth),
          ),
        ).annotate({ description: 'Viewport width in CSS pixels; default 1280.' }),
        height: Schema.optionalKey(
          Schema.Number.check(
            Schema.isFinite(),
            Schema.isInt(),
            Schema.isGreaterThanOrEqualTo(RenderHtmlLimits.minHeight),
            Schema.isLessThanOrEqualTo(RenderHtmlLimits.maxHeight),
          ),
        ).annotate({ description: 'Viewport height in CSS pixels; default 800.' }),
        fullPage: Schema.optionalKey(Schema.Boolean).annotate({
          description: 'Capture the whole document height (capped at 6000 pixels) instead of the viewport.',
        }),
        colorScheme: Schema.optionalKey(Schema.Literals(['light', 'dark'])).annotate({ description: 'prefers-color-scheme of the page; default light.' }),
      }),
      output: screenshotOutputSchema,
      description:
        'Render an untrusted HTML document in the preview Host Chromium and return a JPEG: a fresh offline context per call, every request aborted, the document in a sandboxed (allow-scripts, opaque-origin) srcdoc frame. For other Host plugins only.',
    }),
  },
})
