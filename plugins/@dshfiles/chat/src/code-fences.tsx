/**
 * Fenced code blocks a plugin renders in place of the native code card: a ```` ```mermaid ```` fence becomes a
 * diagram, for example.
 *
 * Chat owns the transcript. A plugin that knows a fence language adds a {@link CodeFenceRenderer} to the
 * {@link CodeFences} registry. While Chat renders a message it swaps each native `CodeBlock` whose language a renderer
 * claims for that renderer's component and hands it the native card as `fallback`, so a renderer that is still
 * loading, fails, or chooses to show the source renders exactly what Chat showed before. No plugin scans or rewrites
 * the transcript DOM; without renderers Chat renders exactly what the native renderer produced.
 */
import { defineRegistry } from '@dshfiles/dshx/client'
import type { ComponentType, ReactNode } from 'react'

/** What a renderer receives for one fence. */
export interface CodeFenceProps {
  /** The fence body as written, without the trailing newline the native card adds. */
  readonly code: string
  /** The first word of the fence's info string, lower-cased (`mermaid` for ```` ```Mermaid title ````). */
  readonly lang: string
  /** The message is still streaming: the body may be incomplete. */
  readonly streaming: boolean
  /** The native code card for this fence, header and copy action included; render it to show the fence as before. */
  readonly fallback: ReactNode
  /** The same highlighted code without the native card's header, for a renderer that draws its own header. */
  readonly source: ReactNode
}

/** A registry item: the fence languages one renderer claims and the component that renders them. */
export interface CodeFenceRenderer {
  readonly id: string
  /** Fence languages, matched case-insensitively against the first word of the info string. */
  readonly languages: readonly string[]
  readonly Component: ComponentType<CodeFenceProps>
}

/** Add one with `plugin.add(CodeFences, { id, languages: ['mermaid'], Component })`. */
export const CodeFences = defineRegistry<CodeFenceRenderer>('@dshfiles/chat.code-fence')
