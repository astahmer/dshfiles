/**
 * Inline references in the chat transcript: `b:12`, `@{luna}`, `memory: n:3`, `jj:main` and the like.
 *
 * Chat owns the rendering. A plugin that knows one grammar adds an {@link InlineReference} to the
 * {@link InlineReferences} registry: a matcher over plain text runs and a React renderer for each match. Chat runs the
 * matchers while it renders a message and places the returned nodes as React children, so no plugin scans or rewrites
 * the transcript DOM after the fact. Without providers Chat renders exactly what the native renderer produced.
 */
import { defineRegistry, useRegistry, type Subscribable } from '@dshfiles/dshx/client'
import {
  Component,
  createContext,
  Fragment,
  isValidElement,
  cloneElement,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ErrorInfo,
  type ReactNode,
} from 'react'
import { createReportOnce } from './report-once.js'

/**
 * Where a text run sits. `prose` is ordinary Markdown text; `code` is the text of an inline code span (fenced blocks
 * are never offered); `summary` is a user message's "Referenced session · …" line.
 */
export type InlineReferenceSurface = 'prose' | 'code' | 'summary'

export interface InlineReferenceContext {
  /** The Session whose transcript renders the text; undefined outside a conversation (a backlog comment). */
  readonly sessionId: string | undefined
  /** That Session's working directory, when known. */
  readonly cwd: string | undefined
  readonly surface: InlineReferenceSurface
  /**
   * Text of the same block before this run, inline code included: `memory: ` before an inline-code `t:abc` lets a
   * matcher that only sees the code span still know it is a citation.
   */
  readonly before: string
}

export interface InlineReferenceMatch<Value> {
  /** Half-open UTF-16 range in the run's text. */
  readonly start: number
  readonly end: number
  readonly value: Value
}

export interface InlineReferenceRenderInput<Value> {
  readonly value: Value
  /** The matched text, exactly as written. */
  readonly text: string
  readonly context: InlineReferenceContext
}

/** What a provider writes; {@link InlineReferenceModel.define} turns it into a registry item. */
export interface InlineReferenceDefinition<Value> {
  readonly id: string
  /**
   * Higher wins when two providers claim overlapping text; equal priorities prefer the earlier start, then the longer
   * match, then registration order. Defaults to 0.
   */
  readonly priority?: number
  /** Runs this provider is offered; defaults to `['prose']`. */
  readonly surfaces?: readonly InlineReferenceSurface[]
  /** Pure and synchronous: return non-overlapping matches in this run. Invalid ranges are ignored. */
  readonly match: (text: string, context: InlineReferenceContext) => readonly InlineReferenceMatch<Value>[]
  /** The React node shown in place of the matched text. A throw falls back to the text as written. */
  readonly render: (input: InlineReferenceRenderInput<Value>) => ReactNode
  /**
   * The matcher reads state that changes outside the message (an agent list, a repository's bookmarks): bump this
   * source's value whenever the matcher's answer may change, and Chat re-renders the visible messages.
   */
  readonly vocabulary?: Subscribable<number>
}

/** One claimed range, ready to render. */
export interface InlineReferenceSpan {
  readonly start: number
  readonly end: number
  readonly render: () => ReactNode
}

/** A registry item: the provider's grammar with its value type erased behind `find`. */
export interface InlineReference {
  readonly id: string
  readonly priority: number
  readonly surfaces: readonly InlineReferenceSurface[]
  readonly find: (text: string, context: InlineReferenceContext) => readonly InlineReferenceSpan[]
  readonly vocabulary?: Subscribable<number>
}

/** Add one with `plugin.add(InlineReferences, InlineReferenceModel.define({ … }))`. */
export const InlineReferences = defineRegistry<InlineReference>('@dshfiles/chat.inline-reference')

const define = <Value,>(definition: InlineReferenceDefinition<Value>): InlineReference => {
  const reference: InlineReference = {
    id: definition.id,
    priority: definition.priority ?? 0,
    surfaces: definition.surfaces ?? ['prose'],
    find: (text, context) =>
      definition.match(text, context).map(match => ({
        start: match.start,
        end: match.end,
        render: () => definition.render({ value: match.value, text: text.slice(match.start, match.end), context }),
      })),
  }
  return definition.vocabulary === undefined ? reference : { ...reference, vocabulary: definition.vocabulary }
}

/** A mutable version counter for {@link InlineReferenceDefinition.vocabulary}. */
const createVocabulary = (): Subscribable<number> & { readonly bump: () => void } => {
  let version = 0
  const listeners = new Set<() => void>()
  return {
    get: () => version,
    subscribe: listener => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    bump: () => {
      version += 1
      for (const listener of [...listeners]) listener()
    },
  }
}

export type InlineReferencePiece =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'reference'; readonly id: string; readonly start: number; readonly end: number; readonly text: string; readonly render: () => ReactNode }

const reportOnce = createReportOnce('@dshfiles/chat inline references')

/**
 * Split one text run into plain text and claimed references. Every provider offered this surface proposes ranges;
 * conflicts resolve by priority (higher first), then earlier start, then longer match, then registration order, and a
 * range overlapping an accepted one is dropped. A provider whose matcher throws is skipped for this run.
 */
const segment = (text: string, items: readonly InlineReference[], context: InlineReferenceContext): readonly InlineReferencePiece[] => {
  if (text === '') return []
  const candidates: { readonly item: InlineReference; readonly order: number; readonly span: InlineReferenceSpan }[] = []
  items.forEach((item, order) => {
    if (!item.surfaces.includes(context.surface)) return
    let spans: readonly InlineReferenceSpan[]
    try {
      spans = item.find(text, context)
    } catch (error) {
      reportOnce(`${item.id}:match`, `matcher ${item.id} failed; its references render as plain text.`, error)
      return
    }
    for (const span of spans) {
      if (!Number.isInteger(span.start) || !Number.isInteger(span.end) || span.start < 0 || span.end > text.length || span.start >= span.end) continue
      candidates.push({ item, order, span })
    }
  })
  if (candidates.length === 0) return [{ kind: 'text', text }]
  candidates.sort(
    (left, right) =>
      right.item.priority - left.item.priority ||
      left.span.start - right.span.start ||
      right.span.end - right.span.start - (left.span.end - left.span.start) ||
      left.order - right.order,
  )
  const accepted: (typeof candidates)[number][] = []
  for (const candidate of candidates) {
    if (accepted.some(taken => taken.span.start < candidate.span.end && candidate.span.start < taken.span.end)) continue
    accepted.push(candidate)
  }
  accepted.sort((left, right) => left.span.start - right.span.start)
  const pieces: InlineReferencePiece[] = []
  let offset = 0
  for (const { item, span } of accepted) {
    if (span.start > offset) pieces.push({ kind: 'text', text: text.slice(offset, span.start) })
    pieces.push({ kind: 'reference', id: item.id, start: span.start, end: span.end, text: text.slice(span.start, span.end), render: span.render })
    offset = span.end
  }
  if (offset < text.length) pieces.push({ kind: 'text', text: text.slice(offset) })
  return pieces
}

/** A provider's renderer that throws shows the text as written instead of taking the message down. */
interface ReferenceBoundaryState {
  readonly failed: boolean
}

class ReferenceBoundary extends Component<{ readonly id: string; readonly text: string; readonly children: ReactNode }, ReferenceBoundaryState> {
  override state = { failed: false }
  static getDerivedStateFromError(): ReferenceBoundaryState {
    return { failed: true }
  }
  override componentDidCatch(error: unknown, _info: ErrorInfo): void {
    reportOnce(`${this.props.id}:render`, `renderer ${this.props.id} failed; the reference renders as plain text.`, error)
  }
  override render(): ReactNode {
    return this.state.failed ? this.props.text : this.props.children
  }
}

const renderPieces = (pieces: readonly InlineReferencePiece[]): ReactNode[] =>
  pieces.map(piece => {
    if (piece.kind === 'text') return piece.text
    let rendered: ReactNode
    try {
      rendered = piece.render()
    } catch (error) {
      reportOnce(`${piece.id}:render`, `renderer ${piece.id} failed; the reference renders as plain text.`, error)
      rendered = piece.text
    }
    return (
      <ReferenceBoundary key={`${piece.id}:${String(piece.start)}`} id={piece.id} text={piece.text}>
        {rendered}
      </ReferenceBoundary>
    )
  })

/** Elements whose text is never a reference: blocks of code, links, controls, and math. */
const SKIPPED = new Set(['pre', 'a', 'button', 'kbd', 'samp', 'script', 'style', 'textarea', 'svg', 'math', 'input', 'select'])
/** Elements that start a new block: the text before a run does not leak across them. */
const BLOCKS = new Set(['p', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'td', 'th', 'blockquote', 'div', 'ul', 'ol', 'table', 'tr', 'section'])

export interface TransformState {
  readonly items: readonly InlineReference[]
  readonly scope: InlineReferenceScopeValue
  /** The providers' vocabulary versions the cache was built for; a change starts a new state and cache. */
  readonly vocabulary: string
  /** Transformed block elements by identity: a streaming message's frozen blocks keep theirs, so React skips them. */
  readonly cache: WeakMap<object, ReactNode>
}

type ElementProps = { readonly children?: ReactNode; readonly dangerouslySetInnerHTML?: unknown }

const isBlock = (node: ReactNode): boolean => isValidElement(node) && typeof node.type === 'string' && BLOCKS.has(node.type)

const textOf = (node: ReactNode): string => {
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (isValidElement<ElementProps>(node)) return textOf(node.props.children)
  return ''
}

const transformChildren = (children: ReactNode, surface: InlineReferenceSurface, state: TransformState): ReactNode => {
  const list: readonly ReactNode[] = Array.isArray(children) ? children : [children]
  let before = ''
  let changed = false
  const next = list.map((child, index) => {
    if (typeof child === 'string') {
      const pieces = segment(child, state.items, { sessionId: state.scope.sessionId, cwd: state.scope.cwd, surface, before })
      before += child
      if (pieces.length === 1 && pieces[0]?.kind === 'text') return child
      changed = true
      return Array.isArray(children) ? <Fragment key={`inline-reference:${String(index)}`}>{renderPieces(pieces)}</Fragment> : renderPieces(pieces)
    }
    const transformed = transformNode(child, surface, before, state)
    before = isBlock(child) ? '' : before + textOf(child)
    if (transformed !== child) changed = true
    return transformed
  })
  if (!changed) return children
  return Array.isArray(children) ? next : next[0]
}

const transformNode = (node: ReactNode, surface: InlineReferenceSurface, before: string, state: TransformState): ReactNode => {
  if (!isValidElement<ElementProps>(node)) return node
  const type = node.type
  if (type !== Fragment && typeof type !== 'string') return node
  if (typeof type === 'string' && SKIPPED.has(type)) return node
  if (node.props.dangerouslySetInnerHTML !== undefined || node.props.children === undefined) return node
  const block = typeof type === 'string' && BLOCKS.has(type)
  if (block) {
    const cached = state.cache.get(node)
    if (cached !== undefined) return cached
  }
  const childSurface: InlineReferenceSurface = type === 'code' ? 'code' : surface
  // Inline code is offered its own text with the block text before it; everything else restarts at a block.
  const children =
    type === 'code' && typeof node.props.children === 'string'
      ? transformCode(node.props.children, before, state)
      : transformChildren(node.props.children, childSurface, state)
  const result = children === node.props.children ? node : cloneElement(node, undefined, ...(Array.isArray(children) ? children : [children]))
  if (block) state.cache.set(node, result)
  return result
}

const transformCode = (text: string, before: string, state: TransformState): ReactNode => {
  const pieces = segment(text, state.items, { sessionId: state.scope.sessionId, cwd: state.scope.cwd, surface: 'code', before })
  if (pieces.length === 1 && pieces[0]?.kind === 'text') return text
  return renderPieces(pieces)
}

export interface InlineReferenceScopeValue {
  readonly sessionId: string | undefined
  readonly cwd: string | undefined
}

const OUTSIDE_SESSION: InlineReferenceScopeValue = { sessionId: undefined, cwd: undefined }
const ScopeContext = createContext<InlineReferenceScopeValue>(OUTSIDE_SESSION)

/** The Session a subtree of rendered messages belongs to; Chat provides it around its transcript. */
export const InlineReferenceScope = (props: { readonly sessionId: string; readonly cwd: string | undefined; readonly children: ReactNode }): ReactNode => {
  const value = useMemo(() => ({ sessionId: props.sessionId, cwd: props.cwd }), [props.sessionId, props.cwd])
  return <ScopeContext.Provider value={value}>{props.children}</ScopeContext.Provider>
}

const NO_VOCABULARY = (): (() => void) => () => {}

const vocabularyOf = (items: readonly InlineReference[]): string => items.map(item => String(item.vocabulary?.get() ?? 0)).join(',')

/** One string that changes whenever any provider's vocabulary does, so the external-store snapshot stays stable. */
const useVocabularyVersion = (items: readonly InlineReference[]): string => {
  const subscribe = useMemo(() => {
    const sources = items.flatMap(item => (item.vocabulary === undefined ? [] : [item.vocabulary]))
    if (sources.length === 0) return NO_VOCABULARY
    return (listener: () => void): (() => void) => {
      const stops = sources.map(source => source.subscribe(listener))
      return () => {
        for (const stop of stops) stop()
      }
    }
  }, [items])
  const snapshot = (): string => vocabularyOf(items)
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

/** The providers, Session scope and block cache for one rendering component. */
const useTransformState = (): TransformState => {
  const scope = useContext(ScopeContext)
  const items = useRegistry(InlineReferences)
  const version = useVocabularyVersion(items)
  // A new state and cache whenever any input of a match changes; otherwise a re-render reuses every transformed block.
  return useMemo(() => ({ items, scope, vocabulary: version, cache: new WeakMap<object, ReactNode>() }), [items, scope, version])
}

/** Fresh transform state over explicit providers; a caller keeps it while its inputs stay the same. */
const createState = (items: readonly InlineReference[], scope: InlineReferenceScopeValue = OUTSIDE_SESSION): TransformState => ({
  items,
  scope,
  vocabulary: vocabularyOf(items),
  cache: new WeakMap(),
})

/** Apply providers to a rendered Markdown tree; reuse one state across renders to keep the block cache. */
const transform = (tree: ReactNode, state: TransformState): ReactNode => (state.items.length === 0 ? tree : transformNode(tree, 'prose', '', state))

/** A plain text run (a summary line) with inline references applied. */
export const InlineReferenceText = (props: { readonly text: string; readonly surface: InlineReferenceSurface }): ReactNode => {
  const state = useTransformState()
  if (state.items.length === 0) return props.text
  const pieces = segment(props.text, state.items, { sessionId: state.scope.sessionId, cwd: state.scope.cwd, surface: props.surface, before: '' })
  return renderPieces(pieces)
}

export class InlineReferenceModel {
  static readonly define = define
  static readonly vocabulary = createVocabulary
  static readonly segment = segment
  static readonly transform = transform
  static readonly state = createState
  static readonly useState = useTransformState
  /** Segment one run and render it, the way Chat does; for a provider's own tests. */
  static readonly renderText = (text: string, items: readonly InlineReference[], context: InlineReferenceContext): ReactNode[] =>
    renderPieces(segment(text, items, context))
}
