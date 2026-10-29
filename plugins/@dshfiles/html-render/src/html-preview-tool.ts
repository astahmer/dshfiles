import { basename, dirname, relative } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-fs'
import type { FsTarget } from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-working-directory'
import { defineTool } from '@dshfiles/dshx/host'
import { z } from 'zod'
import { HTML_PREVIEW_TOOL, HtmlPageLimits, HtmlPageModel, htmlPageThemes } from './html-page.js'
import { RelativeAssets, type AssetReader } from './relative-assets.js'

const argsSchema = z.object({
  path: z.string().trim().min(1, 'path is empty; pass an .html file relative to the thread workspace.').max(2048),
  title: z.string().trim().min(1).max(HtmlPageLimits.maxTitleLength).optional(),
  height: z.number().finite().optional(),
  theme: z.enum(htmlPageThemes).optional(),
})

const HTML_EXTENSIONS = /\.x?html?$/i
const MAX_SKIPPED_REPORTED = 8
const strictUtf8 = new TextDecoder('utf-8', { fatal: true })

const outputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: { type: 'string', required: true },
    html: { type: 'string', required: true },
    height: { type: 'integer', required: true },
    theme: { type: 'string', enum: htmlPageThemes, required: true },
    bytes: { type: 'integer', required: true },
    path: { type: 'string', required: true },
    inlined: { type: 'array', items: { type: 'string' }, required: true },
    skipped: { type: 'array', items: { type: 'string' }, required: true },
  },
} as const

const decodeUtf8 = (bytes: Uint8Array): string | undefined => {
  try {
    return strictUtf8.decode(bytes)
  } catch {
    return undefined
  }
}

const fail = (message: string): never => {
  throw new Error(message)
}

const summary = (value: {
  readonly title: string
  readonly path: string
  readonly bytes: number
  readonly inlined: readonly string[]
  readonly skipped: readonly string[]
}): string => {
  const lines = [
    `Showing ${value.path} as "${value.title}" (${HtmlPageModel.formatBytes(value.bytes)}) in an HTML card in the transcript. The user sees it; do not repeat its content.`,
  ]
  if (value.inlined.length > 0) lines.push(`Inlined ${String(value.inlined.length)} relative asset(s).`)
  if (value.skipped.length > 0) {
    const shown = value.skipped.slice(0, MAX_SKIPPED_REPORTED).join('; ')
    const more = value.skipped.length > MAX_SKIPPED_REPORTED ? `; and ${String(value.skipped.length - MAX_SKIPPED_REPORTED)} more` : ''
    lines.push(`Not inlined (the card has no network, so these do not load): ${shown}${more}.`)
  }
  return lines.join(' ')
}

/**
 * Shows an HTML file of the calling thread's workspace in the same sandboxed card as html_render. Built from the
 * plugin's own context (like apply_patch) so the filesystem services it injects are readable during the call.
 */
export const createHtmlPreviewTool = (ctx: Context) =>
  defineTool({
    name: HTML_PREVIEW_TOOL,
    description: [
      'Show an HTML file from this thread’s workspace to the user as a card in the chat transcript (the same sandboxed, themed card as html_render).',
      `path is relative to the thread working directory and must stay inside the thread workspace; at most ${HtmlPageModel.formatBytes(HtmlPageLimits.maxHtmlBytes)} after inlining.`,
      'Relative <link rel="stylesheet" href>, <script src> and <img src> files are inlined; CSS url(), @import, fonts, srcset, fetch and remote URLs are not, and the card has no network. Read-only.',
    ].join(' '),
    parameters: {
      path: { type: 'string', required: true, description: 'The .html file, relative to the thread working directory, e.g. "dist/report.html".' },
      title: { type: 'string', description: `Card header; defaults to the file name (at most ${String(HtmlPageLimits.maxTitleLength)} characters).` },
      height: {
        type: 'integer',
        description: `Initial card height in pixels, ${String(HtmlPageLimits.minHeight)}–${String(HtmlPageLimits.maxHeight)}; defaults to ${String(HtmlPageLimits.defaultHeight)}.`,
      },
      theme: { type: 'string', enum: htmlPageThemes, description: 'auto (default) follows the DSH light/dark theme; light or dark pins the page colours.' },
    },
    output: {
      schema: outputSchema,
      render: (_args, value) => [{ type: 'text', text: summary(value) }],
      presentationMeta: (_args, value) => ({ title: value.title, html: value.html, height: value.height, theme: value.theme, path: value.path }),
    },
    isConcurrencySafe: () => true,
    async execute(rawArgs, execution) {
      const parsedArgs = argsSchema.safeParse(rawArgs)
      if (!parsedArgs.success) return fail(parsedArgs.error.issues.map(issue => `${issue.path.join('.') || 'arguments'}: ${issue.message}`).join('; '))
      const args = parsedArgs.data
      const agent = execution.agent ?? fail('html_preview runs only on behalf of an Agent.')
      const signal = execution.signal
      const cwd = await ctx.workingDirectory.ensure(agent, signal)
      const workspacePath = agent.session.header.cwd ?? cwd
      const workspace = await ctx.fs.resolve(workspacePath, { signal })
      const target = await ctx.fs.resolve(args.path, { cwd, signal })
      const outsideMessage = `${args.path} is outside this thread’s workspace (${workspacePath}); html_preview only shows files inside it. Copy the page into the workspace, or publish it with html_render.`
      if (!ctx.fs.contains(workspace, target)) return fail(outsideMessage)
      if (!HTML_EXTENSIONS.test(target.displayPath))
        return fail(`${args.path} is not an .html file. Pass an .html or .htm file, or publish markup with html_render.`)
      const info = await ctx.fs.stat(target, signal)
      if (info === undefined) return fail(`${args.path} does not exist in ${cwd}. Check the path, relative to the thread working directory.`)
      if (info.type !== 'file') return fail(`${args.path} is not a regular file.`)
      const tooLarge = (bytes: number | undefined) =>
        `${args.path} is ${bytes === undefined ? 'larger than the cap' : HtmlPageModel.formatBytes(bytes)}; html_preview shows at most ${HtmlPageModel.formatBytes(HtmlPageLimits.maxHtmlBytes)}. Downsample inline images, move data out of the page, or split it.`
      if (info.size !== undefined && info.size > HtmlPageLimits.maxHtmlBytes) return fail(tooLarge(info.size))
      const raw = await ctx.fs.readBytes(target, signal, HtmlPageLimits.maxHtmlBytes).catch(() => fail(tooLarge(info.size)))
      const source = decodeUtf8(raw) ?? fail(`${args.path} is not UTF-8 text. Save the page as UTF-8.`)
      const pageDirectory = dirname(ctx.fs.processPath(target))
      const reader: AssetReader = {
        read: async request => {
          const asset: FsTarget | undefined = await ctx.fs.resolve(request.path, { cwd: pageDirectory, signal }).catch(() => undefined)
          if (asset === undefined || !ctx.fs.contains(workspace, asset)) return { ok: false, reason: 'outside the thread workspace' }
          const assetInfo = await ctx.fs.stat(asset, signal)
          if (assetInfo?.type !== 'file') return { ok: false, reason: 'not found' }
          if (assetInfo.size !== undefined && assetInfo.size > request.maxBytes) return { ok: false, reason: 'too large to inline' }
          const bytes = await ctx.fs.readBytes(asset, signal, request.maxBytes).catch(() => undefined)
          return bytes === undefined ? { ok: false, reason: 'too large to inline' } : { ok: true, bytes }
        },
      }
      const inlined = await RelativeAssets.inline({ html: source, reader, maxBytes: HtmlPageLimits.maxHtmlBytes })
      const displayPath = relative(ctx.fs.processPath(workspace), ctx.fs.processPath(target)) || basename(target.displayPath)
      const page = HtmlPageModel.parse({ title: args.title ?? basename(target.displayPath), html: inlined.html, height: args.height, theme: args.theme })
      if (!page.ok) return fail(page.error.replaceAll('html_render', 'html_preview'))
      return { ...page.page, bytes: page.bytes, path: displayPath, inlined: [...inlined.inlined], skipped: [...inlined.skipped] }
    },
  })
