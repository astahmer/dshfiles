import { defineApi, method } from '@dshfiles/dshx/api'
import { z } from 'zod'

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
      input: z
        .object({
          document: z.string().min(1).max(RenderHtmlLimits.maxDocumentChars).describe('Complete HTML document to show; it runs in a sandboxed frame.'),
          width: z
            .number()
            .int()
            .min(RenderHtmlLimits.minWidth)
            .max(RenderHtmlLimits.maxWidth)
            .optional()
            .describe('Viewport width in CSS pixels; default 1280.'),
          height: z
            .number()
            .int()
            .min(RenderHtmlLimits.minHeight)
            .max(RenderHtmlLimits.maxHeight)
            .optional()
            .describe('Viewport height in CSS pixels; default 800.'),
          fullPage: z.boolean().optional().describe('Capture the whole document height (capped at 6000 pixels) instead of the viewport.'),
          colorScheme: z.enum(['light', 'dark']).optional().describe('prefers-color-scheme of the page; default light.'),
        })
        .strict(),
      output: z.object({
        image: z.string().describe('Base64 JPEG.'),
        mediaType: z.literal('image/jpeg'),
        width: z.number().int(),
        height: z.number().int(),
      }),
      description:
        'Render an untrusted HTML document in the preview Host Chromium and return a JPEG: a fresh offline context per call, every request aborted, the document in a sandboxed (allow-scripts, opaque-origin) srcdoc frame. For other Host plugins only.',
    }),
  },
})
