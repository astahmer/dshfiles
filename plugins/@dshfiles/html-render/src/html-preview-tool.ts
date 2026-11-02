import { basename, dirname, relative } from 'node:path'
import type { FsTarget } from '@deepseek-ai/dsh-fs'
import { Tool } from '@dshfiles/dshx/effect'
import { Effect, Option, Schema } from 'effect'
import { HtmlHost } from './html-host-promise.js'
import { HTML_PREVIEW_TOOL, HtmlPageLimits, HtmlPageModel, htmlPageSchema, htmlPageThemes } from './html-page.js'
import { HtmlPages } from './html-page-store.js'
import { HtmlToolRefused } from './html-refusal.js'
import { RelativeAssets } from './relative-assets.js'

const nonEmptyTrimmed = (input: { readonly description: string; readonly emptyMessage: string; readonly maxLength: number }) =>
  Schema.String.annotate({ description: input.description }).pipe(
    Schema.decodeTo(
      Schema.Trim.check(
        Schema.makeFilter(value => (value.length > 0 ? true : input.emptyMessage)),
        Schema.isMaxLength(input.maxLength),
      ),
    ),
  )

const inputSchema = Schema.Struct({
  path: nonEmptyTrimmed({
    description: 'The .html file, relative to the thread working directory, e.g. "dist/report.html".',
    emptyMessage: 'path is empty; pass an .html file relative to the thread workspace.',
    maxLength: 2048,
  }),
  title: Schema.optionalKey(
    nonEmptyTrimmed({
      description: `Card header; defaults to the file name (at most ${String(HtmlPageLimits.maxTitleLength)} characters).`,
      emptyMessage: 'title is empty; give the page a short name.',
      maxLength: HtmlPageLimits.maxTitleLength,
    }),
  ),
  height: Schema.optionalKey(
    Schema.Int.annotate({
      description: `Initial card height in pixels, ${String(HtmlPageLimits.minHeight)}–${String(HtmlPageLimits.maxHeight)}; defaults to ${String(HtmlPageLimits.defaultHeight)}.`,
    }),
  ),
  theme: Schema.optionalKey(
    Schema.Literals(htmlPageThemes).annotate({ description: 'auto (default) follows the DSH light/dark theme; light or dark pins the page colours.' }),
  ),
})

const outputSchema = Schema.Struct({
  ...htmlPageSchema.fields,
  bytes: Schema.Int,
  path: Schema.String,
  inlined: Schema.Array(Schema.String),
  skipped: Schema.Array(Schema.String),
})

const HTML_EXTENSIONS = /\.x?html?$/i
const MAX_SKIPPED_REPORTED = 8
const strictUtf8 = new TextDecoder('utf-8', { fatal: true })

const decodeUtf8 = (bytes: Uint8Array): Option.Option<string> => {
  try {
    return Option.some(strictUtf8.decode(bytes))
  } catch {
    return Option.none()
  }
}

const refuse = (recovery: string) => new HtmlToolRefused({ tool: HTML_PREVIEW_TOOL, recovery })

const summary = (value: typeof outputSchema.Type): string => {
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

/** Shows an HTML file of the calling thread's workspace in the same sandboxed card as html_render. */
export const htmlPreviewTool = Tool.make({
  name: HTML_PREVIEW_TOOL,
  description: [
    'Show an HTML file from this thread’s workspace to the user as a card in the chat transcript (the same sandboxed, themed card as html_render).',
    `path is relative to the thread working directory and must stay inside the thread workspace; at most ${HtmlPageModel.formatBytes(HtmlPageLimits.maxHtmlBytes)} after inlining.`,
    'Relative <link rel="stylesheet" href>, <script src> and <img src> files are inlined; CSS url(), @import, fonts, srcset, fetch and remote URLs are not, and the card has no network. Read-only.',
  ].join(' '),
  input: inputSchema,
  output: outputSchema,
  readOnly: true,
  render: summary,
  presentation: output => ({ title: output.title, html: output.html, height: output.height, theme: output.theme, path: output.path }),
  execute: Effect.fn('html preview show')(function* (args, call) {
    const host = yield* HtmlHost
    const agent = call.agent
    if (agent === undefined) return yield* refuse('html_preview runs only on behalf of an Agent.')
    const cwd = yield* host.workingDirectory(agent)
    const workspacePath = agent.session.header.cwd ?? cwd
    const workspace = yield* host.resolve({ path: workspacePath })
    const target = yield* host.resolve({ path: args.path, cwd })
    if (!host.contains({ root: workspace, target }))
      return yield* refuse(
        `${args.path} is outside this thread’s workspace (${workspacePath}); html_preview only shows files inside it. Copy the page into the workspace, or publish it with html_render.`,
      )
    if (!HTML_EXTENSIONS.test(target.displayPath))
      return yield* refuse(`${args.path} is not an .html file. Pass an .html or .htm file, or publish markup with html_render.`)
    const info = yield* host.stat(target)
    if (info === undefined) return yield* refuse(`${args.path} does not exist in ${cwd}. Check the path, relative to the thread working directory.`)
    if (info.type !== 'file') return yield* refuse(`${args.path} is not a regular file.`)
    const tooLarge = refuse(
      `${args.path} is ${info.size === undefined ? 'larger than the cap' : HtmlPageModel.formatBytes(info.size)}; html_preview shows at most ${HtmlPageModel.formatBytes(HtmlPageLimits.maxHtmlBytes)}. Downsample inline images, move data out of the page, or split it.`,
    )
    if (info.size !== undefined && info.size > HtmlPageLimits.maxHtmlBytes) return yield* tooLarge
    const raw = yield* host.readBytes({ target, maxBytes: HtmlPageLimits.maxHtmlBytes }).pipe(Effect.catchTag('HtmlHostFailed', () => Effect.fail(tooLarge)))
    const source = decodeUtf8(raw)
    if (Option.isNone(source)) return yield* refuse(`${args.path} is not UTF-8 text. Save the page as UTF-8.`)
    const pageDirectory = dirname(host.processPath(target))
    const outside = { ok: false, reason: 'outside the thread workspace' } as const
    const readAsset = Effect.fn('html asset read')(function* (request: { readonly path: string; readonly maxBytes: number }) {
      const asset: Option.Option<FsTarget> = yield* Effect.option(host.resolve({ path: request.path, cwd: pageDirectory }))
      if (Option.isNone(asset) || !host.contains({ root: workspace, target: asset.value })) return outside
      const assetInfo = yield* host.stat(asset.value)
      if (assetInfo?.type !== 'file') return { ok: false, reason: 'not found' } as const
      if (assetInfo.size !== undefined && assetInfo.size > request.maxBytes) return { ok: false, reason: 'too large to inline' } as const
      const bytes = yield* Effect.option(host.readBytes({ target: asset.value, maxBytes: request.maxBytes }))
      return Option.isNone(bytes) ? ({ ok: false, reason: 'too large to inline' } as const) : ({ ok: true, bytes: bytes.value } as const)
    })
    const inlined = yield* RelativeAssets.inline({ html: source.value, reader: { read: readAsset }, maxBytes: HtmlPageLimits.maxHtmlBytes })
    const displayPath = relative(host.processPath(workspace), host.processPath(target)) || basename(target.displayPath)
    const page = HtmlPageModel.parse({ title: args.title ?? basename(target.displayPath), html: inlined.html, height: args.height, theme: args.theme })
    if (!page.ok) return yield* refuse(page.error.replaceAll('html_render', 'html_preview'))
    yield* HtmlPages.use(pages => pages.remember({ sessionId: agent.id, callId: call.callId, page: page.page, bytes: page.bytes }))
    return { ...page.page, bytes: page.bytes, path: displayPath, inlined: [...inlined.inlined], skipped: [...inlined.skipped] }
  }),
})
