/**
 * Applies the {@link CodeFences} registry (see `./code-fences.tsx`) where the native Markdown renderer draws a fence.
 * Chat-internal.
 *
 * Since DSH 0.2.2 the native renderer no longer returns a fence as a `CodeBlock` element a caller could find in its
 * output: it draws each fence whose language is final in its own seat, which asks the nearest
 * `MarkdownDelegate.renderCode` first and falls back to its built-in code and math blocks. So the registry is applied
 * there: {@link CodeFenceSeat} provides a `renderCode` that hands a claimed fence to its renderer, with what the fence
 * would have shown without it (the enclosing delegate's block, or the built-in one) as the renderer's `fallback`.
 */
import {
  CodeBlock,
  FenceCodeBlock,
  FenceMathBlock,
  MarkdownDelegateProvider,
  useMarkdownDelegate,
  type MarkdownCodeLabels,
  type MarkdownDelegate,
  type MarkdownDelegateFenceInfo,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { Component, useMemo, type ErrorInfo, type ReactNode } from 'react'
import type { CodeFenceProps, CodeFenceRenderer } from './code-fences.js'
import { createReportOnce, type ReportOnce } from './report-once.js'

interface FenceBoundaryProps {
  readonly id: string
  readonly code: string
  readonly fallback: ReactNode
  readonly report: ReportOnce
  readonly children: ReactNode
}

interface FenceBoundaryState {
  readonly failed: boolean
  /** The source the failure belongs to; new source clears it. */
  readonly code: string
}

/** A renderer that throws shows the native card instead of taking the message down; new source tries again. */
class FenceBoundary extends Component<FenceBoundaryProps, FenceBoundaryState> {
  override state: FenceBoundaryState = { failed: false, code: this.props.code }
  static getDerivedStateFromError(): Partial<FenceBoundaryState> {
    return { failed: true }
  }
  static getDerivedStateFromProps(props: FenceBoundaryProps, state: FenceBoundaryState): FenceBoundaryState | null {
    return props.code === state.code ? null : { failed: false, code: props.code }
  }
  override componentDidCatch(error: unknown, _info: ErrorInfo): void {
    this.props.report(`${this.props.id}:render`, `renderer ${this.props.id} failed; the fence renders as code.`, error)
  }
  override render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

/** What the native seat draws for a fence when no delegate renders it. */
const builtInFence = (fence: MarkdownDelegateFenceInfo, labels: MarkdownCodeLabels): ReactNode =>
  !fence.streaming && fence.lang === 'math'
    ? <FenceMathBlock code={fence.code} />
    : <FenceCodeBlock lang={fence.lang} code={fence.code} streaming={fence.streaming} labels={labels} />

/** Renderers by lower-cased language; the first registered renderer of a language wins. */
const byLanguage = (renderers: readonly CodeFenceRenderer[]): ReadonlyMap<string, CodeFenceRenderer> => {
  const map = new Map<string, CodeFenceRenderer>()
  for (const renderer of renderers)
    for (const language of renderer.languages) {
      const key = language.toLowerCase()
      if (!map.has(key)) map.set(key, renderer)
    }
  return map
}

export interface CodeFenceSeatProps {
  /** The registered renderers (`useRegistry(CodeFences)`). */
  readonly renderers: readonly CodeFenceRenderer[]
  /** The code-card labels the Markdown below renders with, for the built-in block a claimed fence falls back to. */
  readonly labels: MarkdownCodeLabels
  /** The native Markdown whose fences the renderers may claim. */
  readonly children: ReactNode
}

/**
 * Fences in `children` whose language a renderer claims render through it; every other fence, and every other
 * delegate capability, stays exactly what the enclosing Markdown owner provides. Without renderers it adds nothing.
 */
export function CodeFenceSeat({ renderers, labels, children }: CodeFenceSeatProps): ReactNode {
  const enclosing = useMarkdownDelegate()
  const report = useMemo(() => createReportOnce('@dshfiles/chat code fences'), [])
  const claimed = useMemo(() => byLanguage(renderers), [renderers])
  const renderCode = useMemo<MarkdownDelegate['renderCode']>(() => {
    if (claimed.size === 0) return enclosing.renderCode
    const outer = enclosing.renderCode
    return (fence: MarkdownDelegateFenceInfo): ReactNode => {
      const fallback = outer === undefined ? builtInFence(fence, labels) : outer(fence)
      const renderer = claimed.get(fence.lang)
      if (renderer === undefined) return fallback
      const props: CodeFenceProps = {
        code: fence.code,
        lang: fence.lang,
        streaming: fence.streaming,
        fallback,
        source: (
          <CodeBlock
            // FenceCodeBlock's convention: the native card trims one trailing newline for display.
            code={`${fence.code}\n`}
            lang={fence.lang}
            streaming={fence.streaming}
            showHeader={false}
            copyLabel={labels.copyLabel}
            copiedLabel={labels.copiedLabel}
            toolbarLabels={labels.toolbarLabels}
          />
        ),
      }
      const Renderer = renderer.Component
      return (
        <FenceBoundary id={renderer.id} code={fence.code} fallback={fallback} report={report}>
          <Renderer {...props} />
        </FenceBoundary>
      )
    }
  }, [claimed, enclosing.renderCode, labels, report])
  if (renderCode === enclosing.renderCode) return children
  return <MarkdownDelegateProvider {...enclosing} renderCode={renderCode}>{children}</MarkdownDelegateProvider>
}
