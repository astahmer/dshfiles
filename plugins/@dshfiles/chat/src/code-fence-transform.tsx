/**
 * Applies the {@link CodeFences} registry to a rendered Markdown tree (see `./code-fences.tsx`). Chat-internal. The
 * caller passes the component that draws a native fence (`CodeBlock` from the native primitives), so this module
 * never loads the native renderer and its tests can build trees by hand.
 */
import { useRegistry } from '@dshfiles/dshx/client'
import { Component, Fragment, cloneElement, isValidElement, useMemo, type ErrorInfo, type ReactElement, type ReactNode } from 'react'
import { CodeFences, type CodeFenceProps, type CodeFenceRenderer } from './code-fences.js'
import { createReportOnce, type ReportOnce } from './report-once.js'

interface CodeBlockElementProps {
  readonly code: string
  readonly showHeader?: boolean | undefined
  readonly lang?: string | undefined
  readonly streaming?: boolean | undefined
}

type ElementProps = { readonly children?: ReactNode; readonly dangerouslySetInnerHTML?: unknown }

/** Elements a fence never sits inside: links, controls, math, inline code. */
const SKIPPED = new Set(['a', 'button', 'code', 'kbd', 'samp', 'script', 'style', 'textarea', 'svg', 'math', 'input', 'select', 'pre'])

interface FenceBoundaryProps {
  readonly id: string
  readonly code: string
  readonly fallback: ReactNode
  readonly report: ReportOnce
  readonly children: ReactNode
}

/** A renderer that throws shows the native card instead of taking the message down; new source tries again. */
class FenceBoundary extends Component<FenceBoundaryProps, { readonly failed: boolean }> {
  override state = { failed: false }
  static getDerivedStateFromError(): { readonly failed: boolean } {
    return { failed: true }
  }
  override componentDidCatch(error: unknown, _info: ErrorInfo): void {
    this.props.report(`${this.props.id}:render`, `renderer ${this.props.id} failed; the fence renders as code.`, error)
  }
  override componentDidUpdate(previous: FenceBoundaryProps): void {
    if (this.state.failed && previous.code !== this.props.code) this.setState({ failed: false })
  }
  override render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

export interface CodeFenceState {
  /** The element type the native renderer draws a fence with. */
  readonly codeBlock: unknown
  /** Renderers by lower-cased language; the first registered renderer of a language wins. */
  readonly byLanguage: ReadonlyMap<string, CodeFenceRenderer>
  /**
   * Transformed elements by identity, one cache for blocks that are complete and one for the block a streaming
   * message is still writing: a frozen block keeps its element, so React skips it.
   */
  readonly complete: WeakMap<object, ReactNode>
  readonly growing: WeakMap<object, ReactNode>
  readonly report: ReportOnce
}

const createState = (items: readonly CodeFenceRenderer[], codeBlock: unknown): CodeFenceState => {
  const byLanguage = new Map<string, CodeFenceRenderer>()
  for (const item of items)
    for (const language of item.languages) {
      const key = language.toLowerCase()
      if (!byLanguage.has(key)) byLanguage.set(key, item)
    }
  return { codeBlock, byLanguage, complete: new WeakMap(), growing: new WeakMap(), report: createReportOnce('@dshfiles/chat code fences') }
}

const isCodeBlock = (node: ReactElement, state: CodeFenceState): node is ReactElement<CodeBlockElementProps> => node.type === state.codeBlock

/**
 * @param complete - the fence's block is followed by another block, so its closing fence was written even though the
 * message still streams.
 */
const renderFence = (node: ReactElement<CodeBlockElementProps>, renderer: CodeFenceRenderer, lang: string, complete: boolean, state: CodeFenceState): ReactNode => {
  const { code, streaming } = node.props
  const props: CodeFenceProps = {
    code: code.endsWith('\n') ? code.slice(0, -1) : code,
    lang,
    streaming: streaming === true && !complete,
    fallback: node,
    source: cloneElement(node, { key: 'source', showHeader: false }),
  }
  const Renderer = renderer.Component
  return (
    <FenceBoundary key={node.key} id={renderer.id} code={props.code} fallback={node} report={state.report}>
      <Renderer {...props} />
    </FenceBoundary>
  )
}

const transformChildren = (children: ReactNode, complete: boolean, state: CodeFenceState): ReactNode => {
  if (!Array.isArray(children)) return transformNode(children, complete, state)
  let changed = false
  const next = children.map((child: ReactNode) => {
    const transformed = transformNode(child, complete, state)
    if (transformed !== child) changed = true
    return transformed
  })
  return changed ? next : children
}

const transformNode = (node: ReactNode, complete: boolean, state: CodeFenceState): ReactNode => {
  if (!isValidElement<ElementProps>(node)) return node
  const cache = complete ? state.complete : state.growing
  const cached = cache.get(node)
  if (cached !== undefined) return cached
  if (isCodeBlock(node, state)) {
    const lang = node.props.lang?.toLowerCase()
    const renderer = lang === undefined ? undefined : state.byLanguage.get(lang)
    if (renderer === undefined || lang === undefined) return node
    const result = renderFence(node, renderer, lang, complete, state)
    cache.set(node, result)
    return result
  }
  const type = node.type
  if (type !== Fragment && typeof type !== 'string') return node
  if (typeof type === 'string' && SKIPPED.has(type)) return node
  if (node.props.dangerouslySetInnerHTML !== undefined || node.props.children === undefined) return node
  const children = transformChildren(node.props.children, complete, state)
  const result = children === node.props.children ? node : cloneElement(node, undefined, ...(Array.isArray(children) ? children : [children]))
  cache.set(node, result)
  return result
}

/**
 * The native root holds one child per top-level block (with newline strings between them). Every block before the
 * last is complete, so a fence there renders while the message still streams; only the last block may still grow.
 */
const transformRoot = (root: ReactElement<ElementProps>, state: CodeFenceState): ReactNode => {
  const children = root.props.children
  if (!Array.isArray(children)) return transformNode(root, false, state)
  const last = children.findLastIndex((child: ReactNode) => isValidElement(child))
  let changed = false
  const next = children.map((child: ReactNode, index: number) => {
    const transformed = transformNode(child, index < last, state)
    if (transformed !== child) changed = true
    return transformed
  })
  return changed ? cloneElement(root, undefined, ...next) : root
}

/** Swap claimed fences in a rendered Markdown tree; reuse one state across renders to keep the element caches. */
const transform = (tree: ReactNode, state: CodeFenceState): ReactNode =>
  state.byLanguage.size === 0 || !isValidElement<ElementProps>(tree) ? tree : transformRoot(tree, state)

/**
 * The registered renderers and fresh caches whenever they change.
 * @param codeBlock - the native `CodeBlock` component.
 */
const useFenceState = (codeBlock: unknown): CodeFenceState => {
  const items = useRegistry(CodeFences)
  return useMemo(() => createState(items, codeBlock), [items, codeBlock])
}

export class CodeFenceModel {
  static readonly state = createState
  static readonly transform = transform
  static readonly useState = useFenceState
}
