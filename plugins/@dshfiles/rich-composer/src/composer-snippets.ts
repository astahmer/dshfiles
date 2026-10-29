import type { ReferenceInsert } from './native/contract/draft-editor.ts'
import type { ComposerAttachment } from '@dshfiles/dshx/client'
import { z } from 'zod/mini'

const SNIPPET_SOURCE = 'composer-snippet'

const Snippet = z.discriminatedUnion('kind', [
  z.object({ kind: z.enum(['quote', 'note']), text: z.string() }),
  z.object({ kind: z.literal('comment'), path: z.string(), line: z.number(), endLine: z.optional(z.number()), text: z.string() }),
])

type SnippetAttachment = Exclude<ComposerAttachment, { kind: 'file' }>

/** The slice of `@dshfiles/input-trigger`'s source contract this chip needs; its client types re-declare the upstream conversation package this fork replaces. */
interface SnippetSource {
  readonly trigger: '@'
  readonly name: string
  readonly showGroupTitle: boolean
  candidates(): Promise<readonly never[]>
  onPick(): undefined
  readonly codec: { clipboardText(ref: string): string; serialize(ref: string): Promise<string> }
}

const isSourceRegistry = (value: unknown): value is { registerSource(source: SnippetSource): () => void } =>
  typeof value === 'object' && value !== null && 'registerSource' in value && typeof value.registerSource === 'function'

/** The composer's quote, note and line-comment chips: the chip keeps its content in `ref`, so a restored draft still sends it. */
export class ComposerSnippets {
  static reference = (attachment: SnippetAttachment): ReferenceInsert => {
    const snippet = Snippet.parse(attachment)
    const firstLine = attachment.text.trim().split('\n')[0] ?? ''
    const label =
      attachment.kind === 'comment'
        ? `${attachment.path.split('/').at(-1) ?? attachment.path}:${ComposerSnippets.lines(attachment)}`
        : (attachment.label ?? (firstLine.length > 40 ? `${firstLine.slice(0, 40)}…` : firstLine))
    return { source: SNIPPET_SOURCE, ref: JSON.stringify(snippet), label, clipboardText: ComposerSnippets.clipboardText(snippet) }
  }

  /** What the model reads in place of the chip. */
  static serialize = (ref: string): string => {
    const snippet = Snippet.parse(JSON.parse(ref))
    if (snippet.kind === 'note') return `<note>\n${snippet.text}\n</note>`
    if (snippet.kind === 'comment') return `<comment path="${snippet.path}" lines="${ComposerSnippets.lines(snippet)}">\n${snippet.text}\n</comment>`
    return ComposerSnippets.clipboardText(snippet)
  }

  /** Registers the chips' serializer with the input-trigger pipeline; a draft holding one cannot send without it. */
  static register = (inputTriggers: unknown): (() => void) => {
    if (!isSourceRegistry(inputTriggers)) return () => {}
    return inputTriggers.registerSource({
      trigger: '@',
      name: SNIPPET_SOURCE,
      showGroupTitle: false,
      candidates: () => Promise.resolve([]),
      onPick: () => undefined,
      codec: {
        clipboardText: ref => ComposerSnippets.clipboardText(Snippet.parse(JSON.parse(ref))),
        serialize: ref => Promise.resolve(ComposerSnippets.serialize(ref)),
      },
    })
  }

  private static lines = (comment: { readonly line: number; readonly endLine?: number | undefined }): string =>
    comment.endLine === undefined || comment.endLine === comment.line ? String(comment.line) : `${String(comment.line)}-${String(comment.endLine)}`

  private static clipboardText = (snippet: z.infer<typeof Snippet>): string => {
    if (snippet.kind === 'note') return snippet.text
    if (snippet.kind === 'comment') return `${snippet.path}:${ComposerSnippets.lines(snippet)} ${snippet.text}`
    return snippet.text
      .split('\n')
      .map(line => `> ${line}`)
      .join('\n')
  }
}
