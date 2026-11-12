/**
 * Chat's reading layer over the native Markdown renderer's output (productivity pass Q1). It runs after the
 * inline-reference and code-fence transforms and never changes what the native renderer parsed:
 *
 * - The native root is a `div` with a hashed CSS-module class, so Chat marks it `data-dsh-markdown` and styles prose
 *   through that stable hook (measure, rhythm, headings) instead of a class name a core bump may change.
 * - Every native code card is handed to {@link CodeFold} (no-wrap by default, a wrap toggle with a hanging indent, a
 *   fold after 24 lines). A fence a code-fence renderer claimed is already that renderer's element and is left alone.
 * - File references become quiet chips (T1.3): an inline-code file mention the native resolver linked shows
 *   `name.ts:24` instead of the whole path, with its parent folder only when two references in the message share a
 *   name; the full path stays in the button's title. A Markdown file link keeps its author's text and is marked
 *   `data-file-chip="link"` for the same muted style.
 * - GitHub alerts (`> [!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]`) render as callouts in the status
 *   trios (T1.6): the quote is marked `data-callout`, the marker becomes a titled line with an icon.
 * - A top-level `<details>` … `</details>` pair becomes a closed disclosure (T1.6). The native renderer shows raw HTML as
 *   literal text and never puts it in the DOM; Chat reads only the two tags and the `<summary>` text and wraps the
 *   Markdown blocks between them, so no author HTML reaches the page.
 *
 * Like the other transforms, transformed elements are cached by identity, so a streaming message's frozen blocks keep
 * their element and React skips them.
 */
import { cloneElement, createElement, Fragment, isValidElement, useMemo, type JSXElementConstructor, type ReactElement, type ReactNode } from 'react'
import { InfoIcon, LightbulbIcon, MessageSquareWarningIcon, OctagonAlertIcon, TriangleAlertIcon, type LucideIcon } from '@dshfiles/plugin-ui/icons'
import { CodeFold, type FoldableCodeBlockProps } from './code-fold.js'

/** Which Chat surface rendered the Markdown: an assistant answer, or other transcript Markdown (reasoning, summaries). */
export type MarkdownSurface = 'answer' | 'fenced'

type ElementProps = { readonly children?: ReactNode; readonly dangerouslySetInnerHTML?: unknown; readonly 'data-dsh-markdown'?: MarkdownSurface }

/** Elements a code card never sits inside: links, controls, math, inline code, a code block's own `pre`. */
const SKIPPED = new Set(['a', 'button', 'code', 'kbd', 'samp', 'script', 'style', 'textarea', 'svg', 'math', 'input', 'select', 'pre'])

export interface MarkdownProseState {
  /** The component the native renderer draws a fence with (`CodeBlock`); only its identity is compared. */
  readonly codeBlock: JSXElementConstructor<never>
  /** Transformed elements by identity; replaced when the message's file names change. */
  cache: WeakMap<object, ReactNode>
  /** File names more than one reference in the message shares, joined; the cache belongs to this value. */
  collisions: string
}

const createState = (codeBlock: JSXElementConstructor<never>): MarkdownProseState => ({ codeBlock, cache: new WeakMap(), collisions: '' })

/** A file reference as written: a path with an optional `:24`, `:24:3`, `#L24` or `#L24-L30` line suffix. */
const FILE_REFERENCE = /^(.*?)(?::(\d+)(?:[:-]\d+)?|#L(\d+)(?:-L?\d+)?)?$/

export interface FileReferenceParts {
  readonly path: string
  readonly line: string | undefined
}

const parseFileReference = (value: string): FileReferenceParts => {
  const match = FILE_REFERENCE.exec(value.trim())
  const path = match?.[1] ?? value
  return { path: path === '' ? value : path, line: match?.[2] ?? match?.[3] }
}

const segments = (path: string): readonly string[] => path.split(/[\\/]/).filter(segment => segment !== '')

const basename = (path: string): string => segments(path).at(-1) ?? path

/**
 * The chip text for one file reference: `name.ts:24`, or `parent/name.ts:24` when `colliding` names its file name.
 * @param value - the reference exactly as written.
 * @param colliding - file names another reference in the same message also uses.
 */
const fileChipLabel = (value: string, colliding: ReadonlySet<string>): string => {
  const { path, line } = parseFileReference(value)
  const parts = segments(path)
  const name = parts.at(-1) ?? path
  const shown = colliding.has(name) && parts.length > 1 ? `${parts.at(-2) ?? ''}/${name}` : name
  return line === undefined ? shown : `${shown}:${line}`
}

type MentionButtonProps = { readonly children?: ReactNode; readonly title?: unknown; readonly onClick?: unknown }

/** The native inline-code file mention: `<code><button title onClick>{icon}{value}</button></code>`. */
const mentionValue = (node: ReactElement<ElementProps>): { readonly button: ReactElement<MentionButtonProps>; readonly value: string } | undefined => {
  const child = node.props.children
  if (!isValidElement<MentionButtonProps>(child) || child.type !== 'button' || typeof child.props.onClick !== 'function') return undefined
  const parts = Array.isArray(child.props.children) ? (child.props.children as readonly ReactNode[]) : [child.props.children]
  const value = parts.at(-1)
  return typeof value === 'string' ? { button: child, value } : undefined
}

/** A native Markdown file link (`[text](path#L24)` with an opener): a component element carrying `file.path`. */
const isFileLink = (node: ReactElement): boolean => {
  if (typeof node.type === 'string' || node.type === Fragment) return false
  const file = (node.props as { readonly file?: { readonly path?: unknown } }).file
  return typeof file?.path === 'string'
}

/** GitHub alert kinds and how Chat shows them; the tone picks a status trio in `ui-styles`' `transcript.css`. */
const CALLOUTS: Readonly<Record<string, { readonly title: string; readonly Icon: LucideIcon }>> = {
  note: { title: 'Note', Icon: InfoIcon },
  tip: { title: 'Tip', Icon: LightbulbIcon },
  important: { title: 'Important', Icon: MessageSquareWarningIcon },
  warning: { title: 'Warning', Icon: TriangleAlertIcon },
  caution: { title: 'Caution', Icon: OctagonAlertIcon },
}

const CALLOUT_MARKER = /^\s*\[!(note|tip|important|warning|caution)\][ \t]*(?:\r?\n)?/i

/** The callout a blockquote opens with, and the quote's children with the marker taken out. */
const calloutOf = (node: ReactElement<ElementProps>): { readonly kind: string; readonly children: readonly ReactNode[] } | undefined => {
  const children = Array.isArray(node.props.children) ? (node.props.children as readonly ReactNode[]) : [node.props.children]
  const index = children.findIndex(child => isValidElement(child))
  const first = children[index]
  if (!isValidElement<ElementProps>(first) || first.type !== 'p') return undefined
  const runs = Array.isArray(first.props.children) ? (first.props.children as readonly ReactNode[]) : [first.props.children]
  const head = runs[0]
  if (typeof head !== 'string') return undefined
  const match = CALLOUT_MARKER.exec(head)
  const kind = match?.[1]?.toLowerCase()
  if (match === null || kind === undefined) return undefined
  const rest = [head.slice(match[0].length), ...runs.slice(1)].filter(run => run !== '')
  const paragraph = rest.length === 0 ? null : cloneElement(first, undefined, ...rest)
  return { kind, children: [...children.slice(0, index), ...(paragraph === null ? [] : [paragraph]), ...children.slice(index + 1)] }
}

const renderCallout = (node: ReactElement<ElementProps>, kind: string, children: readonly ReactNode[]): ReactNode => {
  const callout = CALLOUTS[kind] ?? CALLOUTS.note
  if (callout === undefined) return node
  const title = createElement(
    'p',
    { key: 'callout-title', 'data-callout-title': '' },
    createElement(callout.Icon, { size: 14, strokeWidth: 1.75, 'aria-hidden': true }),
    callout.title,
  )
  return cloneElement(node as ReactElement<Record<string, unknown>>, { 'data-callout': kind }, title, ...children)
}

const DETAILS_OPEN = /^\s*<details(\s+open)?\s*>\s*(?:<summary>([\s\S]*?)<\/summary>)?([\s\S]*)$/i
const SUMMARY = /^\s*<summary>([\s\S]*?)<\/summary>\s*$/i
const DETAILS_CLOSE = /^\s*<\/details>\s*$/i

interface DetailsFrame {
  readonly opening: string
  readonly open: boolean
  summary: string | undefined
  readonly children: ReactNode[]
}

/** Strip the few inline tags a summary line may carry; everything else stays text. */
const summaryText = (value: string): string => value.replace(/<\/?(?:b|strong|em|i|code)>/gi, '').trim()

/**
 * Wrap the top-level blocks between a raw `<details>` and `</details>` in a closed disclosure. The native renderer
 * hands raw HTML blocks over as plain strings; an unmatched opening tag keeps rendering as the text it was.
 */
const wrapDetails = (children: readonly ReactNode[]): readonly ReactNode[] => {
  if (!children.some(child => typeof child === 'string' && child.includes('<details'))) return children
  const out: ReactNode[] = []
  const stack: DetailsFrame[] = []
  const target = (): ReactNode[] => stack.at(-1)?.children ?? out
  let count = 0
  for (const child of children) {
    if (typeof child === 'string') {
      const opening = DETAILS_OPEN.exec(child)
      if (opening !== null) {
        const remainder = (opening[3] ?? '').trim()
        const closes = remainder.endsWith('</details>')
        const body = closes ? remainder.slice(0, -'</details>'.length).trim() : remainder
        const frame: DetailsFrame = {
          opening: child,
          open: opening[1] !== undefined,
          summary: opening[2],
          children: body === '' ? [] : [createElement('p', { key: 'body' }, body)],
        }
        if (closes) {
          count += 1
          target().push(detailsElement(frame, count))
        } else stack.push(frame)
        continue
      }
      const frame = stack.at(-1)
      const summary = SUMMARY.exec(child)
      if (frame !== undefined && frame.summary === undefined && summary !== null) {
        frame.summary = summary[1]
        continue
      }
      if (frame !== undefined && DETAILS_CLOSE.test(child)) {
        stack.pop()
        count += 1
        target().push(detailsElement(frame, count))
        continue
      }
    }
    target().push(child)
  }
  // An opening tag without its closing one (a reply still streaming, or a stray tag) stays the text it was.
  for (const frame of stack) out.push(frame.opening, ...frame.children)
  return out
}

const detailsElement = (frame: DetailsFrame, index: number): ReactNode =>
  createElement(
    'details',
    { key: `details:${String(index)}`, 'data-md-details': '', open: frame.open || undefined },
    createElement('summary', { key: 'summary' }, summaryText(frame.summary ?? '') || 'Details'),
    ...frame.children,
  )

/** Every file path the message references, so colliding names can be told apart. */
const collectPaths = (node: ReactNode, into: string[]): void => {
  if (Array.isArray(node)) {
    for (const child of node as readonly ReactNode[]) collectPaths(child, into)
    return
  }
  if (!isValidElement<ElementProps>(node)) return
  if (node.type === 'code') {
    const mention = mentionValue(node)
    if (mention !== undefined) into.push(parseFileReference(mention.value).path)
    return
  }
  if (isFileLink(node)) {
    into.push(String((node.props as { readonly file: { readonly path: string } }).file.path))
    return
  }
  if (typeof node.type === 'string' && SKIPPED.has(node.type)) return
  collectPaths(node.props.children, into)
}

const collisionsOf = (tree: ReactNode): string => {
  const paths: string[] = []
  collectPaths(tree, paths)
  const byName = new Map<string, Set<string>>()
  for (const path of paths) byName.set(basename(path), (byName.get(basename(path)) ?? new Set()).add(path))
  return [...byName]
    .filter(([, distinct]) => distinct.size > 1)
    .map(([name]) => name)
    .sort()
    .join('\n')
}

/** Punctuation that belongs to the reference before it: a chip is one box, so a line could otherwise break before it. */
const TRAILING_PUNCTUATION = /^[,.;:!?)\]]+/

const isChip = (node: ReactNode): node is ReactElement => isValidElement<Record<string, unknown>>(node) && node.props['data-file-chip'] !== undefined

/** Keep a chip and the punctuation right after it on one line (`pricing.ts:2,` never wraps before the comma). */
const glueChipPunctuation = (children: readonly ReactNode[]): ReactNode[] => {
  const glued: ReactNode[] = []
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index]
    const next = children[index + 1]
    const punctuation = typeof next === 'string' ? TRAILING_PUNCTUATION.exec(next)?.[0] : undefined
    if (!isChip(child) || punctuation === undefined || typeof next !== 'string') {
      glued.push(child)
      continue
    }
    glued.push(createElement('span', { key: `chip:${String(index)}`, 'data-chip-keep': '' }, child, punctuation))
    if (next.length > punctuation.length) glued.push(next.slice(punctuation.length))
    index += 1
  }
  return glued
}

const transformChildren = (children: ReactNode, state: MarkdownProseState): ReactNode => {
  if (!Array.isArray(children)) return transformNode(children, state)
  let changed = false
  const next = children.map((child: ReactNode) => {
    const transformed = transformNode(child, state)
    if (transformed !== child) changed = true
    return transformed
  })
  if (!changed) return children
  return next.some(isChip) ? glueChipPunctuation(next) : next
}

const transformNode = (node: ReactNode, state: MarkdownProseState): ReactNode => {
  if (!isValidElement<ElementProps>(node)) return node
  const cached = state.cache.get(node)
  if (cached !== undefined) return cached
  if (node.type === state.codeBlock) {
    const block = node as ReactElement<FoldableCodeBlockProps>
    const result = createElement(CodeFold, { key: node.key, block })
    state.cache.set(node, result)
    return result
  }
  if (node.type === 'code') {
    const mention = mentionValue(node)
    if (mention === undefined) return node
    const colliding = new Set(state.collisions === '' ? [] : state.collisions.split('\n'))
    const parts = Array.isArray(mention.button.props.children) ? (mention.button.props.children as readonly ReactNode[]) : []
    const button = cloneElement(mention.button, undefined, ...parts.slice(0, -1), fileChipLabel(mention.value, colliding))
    const result = cloneElement(node as ReactElement<Record<string, unknown>>, { 'data-file-chip': 'mention' }, button)
    state.cache.set(node, result)
    return result
  }
  if (isFileLink(node)) {
    const result = createElement('span', { key: node.key, 'data-file-chip': 'link' }, node)
    state.cache.set(node, result)
    return result
  }
  if (node.type === 'blockquote') {
    const callout = calloutOf(node)
    if (callout !== undefined) {
      const children = callout.children.map(child => transformNode(child, state))
      const result = renderCallout(node, callout.kind, children)
      state.cache.set(node, result)
      return result
    }
  }
  const type = node.type
  if (type !== Fragment && typeof type !== 'string') return node
  if (typeof type === 'string' && SKIPPED.has(type)) return node
  if (node.props.dangerouslySetInnerHTML !== undefined || node.props.children === undefined) return node
  const children = transformChildren(node.props.children, state)
  const result = children === node.props.children ? node : cloneElement(node, undefined, ...(Array.isArray(children) ? children : [children]))
  state.cache.set(node, result)
  return result
}

/** Apply the reading layer to a rendered Markdown tree and mark its root for `surface`. */
const transform = (tree: ReactNode, state: MarkdownProseState, surface: MarkdownSurface): ReactNode => {
  if (!isValidElement<ElementProps>(tree) || typeof tree.type !== 'string') return tree
  const collisions = collisionsOf(tree.props.children)
  if (collisions !== state.collisions) {
    state.collisions = collisions
    state.cache = new WeakMap()
  }
  const rootChildren = Array.isArray(tree.props.children) ? wrapDetails(tree.props.children as readonly ReactNode[]) : tree.props.children
  const children = rootChildren === undefined ? undefined : transformChildren(rootChildren, state)
  const props = { 'data-dsh-markdown': surface }
  return children === undefined || (children === tree.props.children && rootChildren === tree.props.children)
    ? cloneElement(tree, props)
    : cloneElement(tree, props, ...(Array.isArray(children) ? children : [children]))
}

/** One state per rendering component, rebuilt only when the native code card component changes. */
const useProseState = (codeBlock: JSXElementConstructor<never>): MarkdownProseState => useMemo(() => createState(codeBlock), [codeBlock])

export class MarkdownProse {
  static readonly state = createState
  static readonly fileChipLabel = fileChipLabel
  static readonly parseFileReference = parseFileReference
  static readonly transform = transform
  static readonly useState = useProseState
}
