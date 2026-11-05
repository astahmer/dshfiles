import { Schema } from 'effect'

/**
 * Atlassian Document Format (ADF) ↔ markdown, for issue descriptions, comments and textarea custom fields.
 * https://developer.atlassian.com/cloud/jira/platform/apis/document/structure/
 *
 * The markdown side covers what the backlog writes: paragraphs, headings, bullet and ordered lists (nested), code
 * blocks, blockquotes, rules, hard breaks, and bold, italic, strikethrough, inline code and links. Any other node
 * (a table, a panel, a mention, media) degrades to its text and is reported, so a caller can refuse to overwrite it.
 */

export interface AdfMark {
  readonly type: string
  readonly attrs?: Schema.JsonObject | undefined
}

export interface AdfNode {
  readonly version?: number | undefined
  readonly type: string
  readonly text?: string | undefined
  readonly attrs?: Schema.JsonObject | undefined
  readonly marks?: readonly AdfMark[] | undefined
  readonly content?: readonly AdfNode[] | undefined
}

const markSchema = Schema.Struct({
  type: Schema.String,
  attrs: Schema.optional(Schema.Record(Schema.String, Schema.Json)),
})

const nodeSchema: Schema.Codec<AdfNode> = Schema.Struct({
  version: Schema.optional(Schema.Number),
  type: Schema.String,
  text: Schema.optional(Schema.String),
  attrs: Schema.optional(Schema.Record(Schema.String, Schema.Json)),
  marks: Schema.optional(Schema.Array(markSchema)),
  content: Schema.optional(Schema.Array(Schema.suspend((): Schema.Codec<AdfNode> => nodeSchema))),
})

/** What a markdown render of a document is, and which node or mark types it could only keep as text. */
export interface AdfRender {
  readonly markdown: string
  readonly unsupported: readonly string[]
}

const blockTypes = new Set(['doc', 'paragraph', 'heading', 'bulletList', 'orderedList', 'listItem', 'codeBlock', 'blockquote', 'rule'])
const inlineTypes = new Set(['text', 'hardBreak'])
const markTypes = ['link', 'strong', 'em', 'strike', 'code'] as const
type MarkType = (typeof markTypes)[number]

const isMarkType = (type: string): type is MarkType => markTypes.some(known => known === type)
const stringAttr = (attrs: AdfNode['attrs'], key: string): string | undefined => {
  const value = attrs?.[key]
  return typeof value === 'string' ? value : undefined
}
const numberAttr = (attrs: AdfNode['attrs'], key: string): number | undefined => {
  const value = attrs?.[key]
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined
}

/** Backslash-escapes what the inline parser would read as markup. */
const escapeText = (text: string): string => text.replace(/[\\`*_~[\]]/gu, character => `\\${character}`)

/** A line the block parser would read as a heading, quote, list item, rule or fence gets its marker escaped. */
const escapeLineStart = (line: string): string => {
  if (/^#{1,6}(\s|$)/u.test(line) || /^>/u.test(line) || /^[-+](\s|$)/u.test(line) || rulePattern.test(line)) return `\\${line}`
  const ordered = /^(\d{1,9})([.)])(\s|$)/u.exec(line)
  if (ordered?.[1] !== undefined) return `${ordered[1]}\\${line.slice(ordered[1].length)}`
  return line
}

/** The text a node holds once its structure is dropped: what an unsupported node degrades to. */
const plainTextOf = (node: AdfNode): string => {
  if (node.type === 'text') return node.text ?? ''
  if (node.type === 'hardBreak') return '\n'
  if (node.type === 'mention' || node.type === 'emoji' || node.type === 'status')
    return stringAttr(node.attrs, 'text') ?? stringAttr(node.attrs, 'shortName') ?? ''
  if (node.type === 'inlineCard' || node.type === 'blockCard') return stringAttr(node.attrs, 'url') ?? ''
  if (node.type === 'date') {
    const timestamp = Number(stringAttr(node.attrs, 'timestamp'))
    return Number.isFinite(timestamp) ? new Date(timestamp).toISOString().slice(0, 10) : ''
  }
  return (node.content ?? []).map(plainTextOf).join('')
}

interface RenderState {
  readonly unsupported: Set<string>
}

const sameMark = (left: AdfMark, right: AdfMark): boolean => left.type === right.type && stringAttr(left.attrs, 'href') === stringAttr(right.attrs, 'href')

/**
 * Inline nodes as markdown. Marks wrap maximal runs of neighbours that share them, outermost first (link, bold,
 * italic, strikethrough, then inline code), so `**a _b_**` renders from two text nodes without `****`.
 */
const renderInline = (nodes: readonly AdfNode[], state: RenderState, order: readonly MarkType[] = markTypes): string => {
  const markOf = (node: AdfNode, type: MarkType): AdfMark | undefined => node.marks?.find(mark => mark.type === type)
  const [type, ...rest] = order
  if (type === undefined)
    return nodes
      .map(node => {
        if (node.type === 'hardBreak') return '\n'
        if (node.type === 'text') return escapeText(node.text ?? '')
        state.unsupported.add(node.type)
        return escapeText(plainTextOf(node))
      })
      .join('')
  let output = ''
  for (let index = 0; index < nodes.length;) {
    const node = nodes[index]
    if (node === undefined) break
    const mark = markOf(node, type)
    if (mark === undefined || node.type !== 'text') {
      let plainEnd = index + 1
      for (let next = nodes[plainEnd]; next !== undefined && (next.type !== 'text' || markOf(next, type) === undefined); next = nodes[plainEnd]) plainEnd += 1
      output += renderInline(nodes.slice(index, plainEnd), state, rest)
      index = plainEnd
      continue
    }
    let end = index + 1
    for (let next = nodes[end]; next !== undefined && next.type === 'text'; next = nodes[end]) {
      const nextMark = markOf(next, type)
      if (nextMark === undefined || !sameMark(mark, nextMark)) break
      end += 1
    }
    const inner = nodes.slice(index, end)
    if (type === 'code') output += `\`${inner.map(part => part.text ?? '').join('')}\``
    else {
      const body = renderInline(inner, state, rest)
      const href = (stringAttr(mark.attrs, 'href') ?? '').replace(/[()\s]/gu, character => encodeURIComponent(character))
      const wrapped = { link: `[${body}](${href})`, strong: `**${body}**`, em: `_${body}_`, strike: `~~${body}~~` } as const
      output += wrapped[type]
    }
    index = end
  }
  return output
}

const reportMarks = (nodes: readonly AdfNode[], state: RenderState): void => {
  for (const node of nodes) {
    if (!inlineTypes.has(node.type)) state.unsupported.add(node.type)
    for (const mark of node.marks ?? []) if (!isMarkType(mark.type)) state.unsupported.add(mark.type)
  }
}

const paragraphText = (nodes: readonly AdfNode[], state: RenderState): string => {
  reportMarks(nodes, state)
  return renderInline(nodes, state).split('\n').map(escapeLineStart).join('\n')
}

const indent = (text: string, width: number): string =>
  text
    .split('\n')
    .map(line => (line === '' ? '' : `${' '.repeat(width)}${line}`))
    .join('\n')

const renderListItem = (item: AdfNode, marker: string, state: RenderState): string => {
  const blocks = (item.content ?? []).map((block, index) => ({ block, text: renderBlock(block, state), index }))
  const [first, ...rest] = blocks
  const head =
    first === undefined
      ? ''
      : first.block.type === 'paragraph'
        ? first.text.replace(/\n(?=.)/gu, `\n${' '.repeat(marker.length)}`)
        : `\n${indent(first.text, marker.length)}`
  const tail = rest.map(entry => `${entry.block.type === 'paragraph' ? '\n\n' : '\n'}${indent(entry.text, marker.length)}`).join('')
  return `${marker}${head}${tail}`
}

const renderBlock = (node: AdfNode, state: RenderState): string => {
  switch (node.type) {
    case 'paragraph':
      return paragraphText(node.content ?? [], state)
    case 'heading': {
      const level = Math.min(6, Math.max(1, numberAttr(node.attrs, 'level') ?? 1))
      return `${'#'.repeat(level)} ${renderInline(node.content ?? [], state).replace(/\n/gu, ' ')}`
    }
    case 'bulletList':
      return (node.content ?? []).map(item => renderListItem(item, '- ', state)).join('\n')
    case 'orderedList': {
      const start = numberAttr(node.attrs, 'order') ?? 1
      return (node.content ?? []).map((item, index) => renderListItem(item, `${String(start + index)}. `, state)).join('\n')
    }
    case 'codeBlock': {
      const code = (node.content ?? []).map(part => part.text ?? '').join('')
      const longest = Math.max(0, ...(code.match(/`+/gu) ?? []).map(run => run.length))
      const fence = '`'.repeat(Math.max(3, longest + 1))
      return `${fence}${stringAttr(node.attrs, 'language') ?? ''}\n${code}\n${fence}`
    }
    case 'blockquote':
      return renderBlocks(node.content ?? [], state)
        .split('\n')
        .map(line => (line === '' ? '>' : `> ${line}`))
        .join('\n')
    case 'rule':
      return '---'
    default: {
      state.unsupported.add(node.type)
      if (
        node.content === undefined ||
        node.content.every(child => inlineTypes.has(child.type) || (child.content === undefined && !blockTypes.has(child.type)))
      )
        return escapeLineStart(escapeText(plainTextOf(node)))
      return renderBlocks(node.content, state)
    }
  }
}

const renderBlocks = (nodes: readonly AdfNode[], state: RenderState): string =>
  nodes
    .map(node => renderBlock(node, state))
    .filter(text => text !== '')
    .join('\n\n')

/** A document (or null, Jira's empty description) as markdown, and the node types only kept as text. */
const toMarkdown = (document: AdfNode | null | undefined): AdfRender => {
  const state: RenderState = { unsupported: new Set() }
  const markdown = document === null || document === undefined ? '' : renderBlocks(document.content ?? [], state)
  return { markdown, unsupported: [...state.unsupported].sort() }
}

// ── markdown → ADF ──────────────────────────────────────────────────────────

const text = (value: string, marks: readonly AdfMark[]): AdfNode => (marks.length === 0 ? { type: 'text', text: value } : { type: 'text', text: value, marks })

const isPunctuation = (character: string | undefined): boolean => character !== undefined && /[!-/:-@[-`{-~]/u.test(character)
const isWordCharacter = (character: string | undefined): boolean => character !== undefined && /[\p{L}\p{N}]/u.test(character)

/** The index of the closing delimiter, skipping escapes; -1 when there is none. */
const closingOf = (source: string, from: number, delimiter: string): number => {
  for (let index = from; index < source.length; index += 1) {
    if (source[index] === '\\') {
      index += 1
      continue
    }
    if (source.startsWith(delimiter, index)) return index
  }
  return -1
}

/** The `]` closing a link label opened before `from`, nested brackets balanced; -1 when there is none. */
const labelEnd = (source: string, from: number): number => {
  let depth = 0
  for (let index = from; index < source.length; index += 1) {
    const character = source[index]
    if (character === '\\') index += 1
    else if (character === '[') depth += 1
    else if (character === ']') {
      if (depth === 0) return index
      depth -= 1
    }
  }
  return -1
}

const parseInline = (source: string, marks: readonly AdfMark[] = []): AdfNode[] => {
  const nodes: AdfNode[] = []
  let buffer = ''
  const flush = () => {
    if (buffer !== '') nodes.push(text(buffer, marks))
    buffer = ''
  }
  const wrapped = (delimiter: string, type: string, index: number): number => {
    const close = closingOf(source, index + delimiter.length, delimiter)
    if (close <= index + delimiter.length) return -1
    flush()
    nodes.push(...parseInline(source.slice(index + delimiter.length, close), [...marks, { type }]))
    return close + delimiter.length
  }
  for (let index = 0; index < source.length;) {
    const character = source[index]
    if (character === '\n') {
      flush()
      nodes.push({ type: 'hardBreak' })
      index += 1
      continue
    }
    if (character === '\\' && isPunctuation(source[index + 1])) {
      buffer += source[index + 1]
      index += 2
      continue
    }
    if (character === '`') {
      const close = source.indexOf('`', index + 1)
      if (close > index + 1) {
        flush()
        nodes.push(text(source.slice(index + 1, close), [...marks, { type: 'code' }]))
        index = close + 1
        continue
      }
    }
    if (source.startsWith('**', index)) {
      const next = wrapped('**', 'strong', index)
      if (next !== -1) {
        index = next
        continue
      }
    }
    if (source.startsWith('~~', index)) {
      const next = wrapped('~~', 'strike', index)
      if (next !== -1) {
        index = next
        continue
      }
    }
    if ((character === '_' && !isWordCharacter(source[index - 1])) || (character === '*' && source[index + 1] !== '*')) {
      const close = closingOf(source, index + 1, character)
      if (close > index + 1 && (character === '*' || !isWordCharacter(source[close + 1]))) {
        flush()
        nodes.push(...parseInline(source.slice(index + 1, close), [...marks, { type: 'em' }]))
        index = close + 1
        continue
      }
    }
    if (character === '[') {
      const end = labelEnd(source, index + 1)
      const target = end === -1 ? null : /^\(([^()\s]+)\)/u.exec(source.slice(end + 1))
      if (end !== -1 && target?.[1] !== undefined) {
        flush()
        const href = target[1].replace(/%2[89]|%20|%0[9AD]/giu, encoded => decodeURIComponent(encoded))
        nodes.push(...parseInline(source.slice(index + 1, end), [...marks, { type: 'link', attrs: { href } }]))
        index = end + 1 + target[0].length
        continue
      }
    }
    buffer += character
    index += 1
  }
  flush()
  return nodes.reduce<AdfNode[]>((merged, node) => {
    const previous = merged[merged.length - 1]
    if (
      previous?.type === 'text' &&
      node.type === 'text' &&
      JSON.stringify(previous.marks ?? []) === JSON.stringify(node.marks ?? []) &&
      previous.text !== undefined &&
      node.text !== undefined
    ) {
      merged[merged.length - 1] = text(previous.text + node.text, previous.marks ?? [])
      return merged
    }
    merged.push(node)
    return merged
  }, [])
}

const fencePattern = /^(`{3,})\s*([\w+#.-]*)\s*$/u
const headingPattern = /^(#{1,6})\s+(.*?)\s*#*\s*$/u
const rulePattern = /^ {0,3}([-*_])( *\1){2,}\s*$/u
const listPattern = /^( *)([-*+]|\d{1,9}[.)])( +|$)(.*)$/u

const indentOf = (line: string): number => line.length - line.trimStart().length

const startsBlock = (line: string): boolean =>
  fencePattern.test(line) || headingPattern.test(line) || rulePattern.test(line) || line.startsWith('>') || listPattern.test(line)

/** One list starting at `start`: its items' lines dedented and parsed as blocks, and the line after it. */
const parseList = (lines: readonly string[], start: number) => {
  const first = listPattern.exec(lines[start] ?? '')
  const baseIndent = first?.[1]?.length ?? 0
  const ordered = /\d/u.test(first?.[2] ?? '')
  const items: AdfNode[] = []
  let index = start
  while (index < lines.length) {
    const match = listPattern.exec(lines[index] ?? '')
    if (match === null || (match[1]?.length ?? 0) !== baseIndent || /\d/u.test(match[2] ?? '') !== ordered) break
    const column = baseIndent + (match[2]?.length ?? 1) + Math.max(1, match[3]?.length ?? 1)
    const body = [match[4] ?? '']
    index += 1
    while (index < lines.length) {
      const line = lines[index] ?? ''
      if (line.trim() === '') {
        const following = lines.slice(index + 1).find(candidate => candidate.trim() !== '')
        if (following === undefined || indentOf(following) <= baseIndent) break
        body.push('')
        index += 1
        continue
      }
      if (indentOf(line) <= baseIndent) break
      body.push(line.slice(Math.min(indentOf(line), column)))
      index += 1
    }
    const content = parseBlocks(body)
    items.push({ type: 'listItem', content: content.length === 0 ? [{ type: 'paragraph', content: [] }] : content })
  }
  const start1 = Number(first?.[2]?.replace(/[.)]/u, '') ?? '1')
  const node: AdfNode = ordered
    ? { type: 'orderedList', ...(start1 !== 1 && { attrs: { order: start1 } }), content: items }
    : { type: 'bulletList', content: items }
  return { node, next: index }
}

const parseBlocks = (lines: readonly string[]): AdfNode[] => {
  const blocks: AdfNode[] = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index] ?? ''
    if (line.trim() === '') {
      index += 1
      continue
    }
    const fence = fencePattern.exec(line)
    if (fence?.[1] !== undefined) {
      const close = lines.findIndex(
        (candidate, position) => position > index && candidate.trim().startsWith(fence[1] ?? '```') && candidate.trim().replace(/`/gu, '') === '',
      )
      const end = close === -1 ? lines.length : close
      const code = lines.slice(index + 1, end).join('\n')
      blocks.push({
        type: 'codeBlock',
        ...(fence[2] !== undefined && fence[2] !== '' && { attrs: { language: fence[2] } }),
        content: code === '' ? [] : [{ type: 'text', text: code }],
      })
      index = end + 1
      continue
    }
    const heading = headingPattern.exec(line)
    if (heading?.[1] !== undefined) {
      blocks.push({ type: 'heading', attrs: { level: heading[1].length }, content: parseInline(heading[2] ?? '') })
      index += 1
      continue
    }
    if (rulePattern.test(line)) {
      blocks.push({ type: 'rule' })
      index += 1
      continue
    }
    if (line.startsWith('>')) {
      const quoted: string[] = []
      while (index < lines.length && (lines[index] ?? '').startsWith('>')) {
        quoted.push((lines[index] ?? '').replace(/^> ?/u, ''))
        index += 1
      }
      blocks.push({ type: 'blockquote', content: parseBlocks(quoted) })
      continue
    }
    if (listPattern.test(line)) {
      const list = parseList(lines, index)
      blocks.push(list.node)
      index = list.next
      continue
    }
    const paragraph: string[] = []
    while (index < lines.length && (lines[index] ?? '').trim() !== '' && (paragraph.length === 0 || !startsBlock(lines[index] ?? ''))) {
      paragraph.push((lines[index] ?? '').replace(/(\\| {2,})$/u, ''))
      index += 1
    }
    blocks.push({ type: 'paragraph', content: parseInline(paragraph.join('\n')) })
  }
  return blocks
}

/** Markdown as an ADF document. */
const fromMarkdown = (markdown: string): AdfNode => ({
  version: 1,
  type: 'doc',
  content: parseBlocks(markdown.replace(/\r\n?/gu, '\n').split('\n')),
})

/** Markdown the way it reads back after a trip through ADF: what to compare before writing, so equivalent text is never re-sent. */
const normalise = (markdown: string): string => toMarkdown(fromMarkdown(markdown)).markdown

export class JiraAdf {
  static readonly nodeSchema = nodeSchema
  static readonly toMarkdown = toMarkdown
  static readonly fromMarkdown = fromMarkdown
  static readonly normalise = normalise
}
