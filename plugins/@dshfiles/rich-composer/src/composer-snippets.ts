import type { ReferenceInsert } from './native/contract/draft-editor.ts'
import type { ComposerAttachment } from '@dshfiles/dshx/client'
import { z } from 'zod/mini'

const SNIPPET_SOURCE = 'composer-snippet'

const Snippet = z.object({ kind: z.enum(['quote', 'note']), text: z.string() })

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

/** The composer's quote and note chips: the chip keeps its text in `ref`, so a restored draft still sends it. */
export class ComposerSnippets {
  static reference = (attachment: Extract<ComposerAttachment, { kind: 'quote' | 'note' }>): ReferenceInsert => {
    const firstLine = attachment.text.trim().split('\n')[0] ?? ''
    return {
      source: SNIPPET_SOURCE,
      ref: JSON.stringify({ kind: attachment.kind, text: attachment.text }),
      label: attachment.label ?? (firstLine.length > 40 ? `${firstLine.slice(0, 40)}…` : firstLine),
      clipboardText: ComposerSnippets.clipboardText(attachment),
    }
  }

  /** What the model reads in place of the chip. */
  static serialize = (ref: string): string => {
    const snippet = Snippet.parse(JSON.parse(ref))
    return snippet.kind === 'quote' ? ComposerSnippets.clipboardText(snippet) : `<note>\n${snippet.text}\n</note>`
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

  private static clipboardText = (snippet: { readonly kind: 'quote' | 'note'; readonly text: string }): string =>
    snippet.kind === 'note'
      ? snippet.text
      : snippet.text
          .split('\n')
          .map(line => `> ${line}`)
          .join('\n')
}
