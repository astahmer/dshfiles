import type { ReferenceInsert } from './native/contract/draft-editor.ts'
import type { ComposerAttachment } from '@dshfiles/dshx/client'
import { decodeJson } from '@dshfiles/dshx/json'
import * as Schema from 'effect/Schema'

const SNIPPET_SOURCE = 'composer-snippet'

const snippetSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('quote'), text: Schema.String }),
  Schema.Struct({ kind: Schema.Literal('note'), text: Schema.String }),
  Schema.Struct({
    kind: Schema.Literal('comment'),
    path: Schema.String,
    line: Schema.Number,
    endLine: Schema.optionalKey(Schema.Number),
    text: Schema.String,
  }),
])

type Snippet = typeof snippetSchema.Type

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
    const snippet = Schema.decodeUnknownSync(snippetSchema)(attachment)
    const firstLine = attachment.text.trim().split('\n')[0] ?? ''
    const label =
      attachment.kind === 'comment'
        ? `${attachment.path.split('/').at(-1) ?? attachment.path}:${ComposerSnippets.lines(attachment)}`
        : (attachment.label ?? (firstLine.length > 40 ? `${firstLine.slice(0, 40)}…` : firstLine))
    return { source: SNIPPET_SOURCE, ref: JSON.stringify(snippet), label, clipboardText: ComposerSnippets.clipboardText(snippet) }
  }

  /** What the model reads in place of the chip. */
  static serialize = (ref: string): string => {
    const snippet = decodeJson(snippetSchema, ref)
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
        clipboardText: ref => ComposerSnippets.clipboardText(decodeJson(snippetSchema, ref)),
        serialize: ref => Promise.resolve(ComposerSnippets.serialize(ref)),
      },
    })
  }

  private static lines = (comment: { readonly line: number; readonly endLine?: number | undefined }): string =>
    comment.endLine === undefined || comment.endLine === comment.line ? String(comment.line) : `${String(comment.line)}-${String(comment.endLine)}`

  private static clipboardText = (snippet: Snippet): string => {
    if (snippet.kind === 'note') return snippet.text
    if (snippet.kind === 'comment') return `${snippet.path}:${ComposerSnippets.lines(snippet)} ${snippet.text}`
    return snippet.text
      .split('\n')
      .map(line => `> ${line}`)
      .join('\n')
  }
}
