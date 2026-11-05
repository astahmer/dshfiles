import type { InputTriggerCandidate, InputTriggerSource } from '@dshfiles/input-trigger/client'
import { Option, Schema } from 'effect'

import type { BacklogSummaryView } from './api.js'
import { BacklogReference } from './backlog-reference.js'
import { BacklogItems } from './item.js'
import { formatBacklogMention } from './backlog-mention-text.js'

const MENTION_SCOPE = /^(thread|t|file|f|skill|mcp|backlog|b):/iu
/** Plain `@` shows a few items next to threads and files; `@b:` lists the backlog alone. */
const MIXED_LIMIT = 5
const SCOPED_LIMIT = 40

const titleSchema = Schema.String.check(Schema.isMaxLength(BacklogItems.maxTitleChars))
/** A chip picked before short aliases carries the legacy number as `id`; it still reads as that item's ref. */
const refSchema = Schema.Union([
  Schema.Struct({ ref: Schema.String, title: titleSchema }),
  Schema.Struct({ id: Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)), title: titleSchema }),
])

const decodeRef = (value: string): { readonly ref: string; readonly title: string } | null => {
  const decoded = Option.getOrNull(Schema.decodeUnknownOption(Schema.fromJsonString(refSchema))(value))
  if (decoded === null) return null
  const ref = BacklogReference.parse('ref' in decoded ? decoded.ref : String(decoded.id))
  return ref === undefined ? null : { ref, title: decoded.title }
}

/** The text after `@b:`/`@backlog:`, the whole query for plain `@`, or undefined while another source's scope is typed. */
const scopedQuery = (query: string): { readonly text: string; readonly scoped: boolean } | undefined => {
  const scope = MENTION_SCOPE.exec(query)?.[1]?.toLowerCase()
  if (scope === undefined) return { text: query, scoped: false }
  return scope === 'b' || scope === 'backlog' ? { text: query.slice(scope.length + 1), scoped: true } : undefined
}

const candidateOf = (item: BacklogSummaryView, section: string): InputTriggerCandidate => ({
  name: BacklogReference.labelOf(item),
  label: item.title,
  description: `${item.kind} · ${item.status}`,
  section,
  value: JSON.stringify({ ref: BacklogReference.refOf(item), title: item.title }),
})

/**
 * `@` mentions of backlog items. A sent chip reads `b:<ref>`, so the Host's thread signal links the thread and starts
 * the item exactly as if the user had typed the reference.
 */
const createSource = (options: {
  readonly search: (query: string, limit: number, signal: AbortSignal) => Promise<readonly BacklogSummaryView[]>
  readonly section: string
}): InputTriggerSource => ({
  trigger: '@',
  name: 'backlog',
  order: 30,
  showGroupTitle: false,
  async candidates(_session, request) {
    const query = scopedQuery(request.query)
    if (query === undefined || request.quoted === true || (!query.scoped && query.text.trim() === '')) return []
    try {
      const items = await options.search(query.text, query.scoped ? SCOPED_LIMIT : MIXED_LIMIT, request.signal)
      return items.map(item => candidateOf(item, options.section))
    } catch {
      return []
    }
  },
  onPick({ candidate }) {
    const ref = decodeRef(candidate.value ?? '')
    if (ref === null) return undefined
    return {
      insert: {
        source: 'backlog',
        ref: JSON.stringify(ref),
        label: `${BacklogReference.label(ref.ref)} ${ref.title}`,
        clipboardText: `${BacklogReference.label(ref.ref)} ${ref.title}`,
      },
    }
  },
  codec: {
    clipboardText(ref) {
      const value = decodeRef(ref)
      return value === null ? 'Backlog item' : `${BacklogReference.label(value.ref)} ${value.title}`
    },
    async serialize(ref, signal) {
      signal.throwIfAborted()
      const value = decodeRef(ref)
      if (value === null) throw new Error('Backlog reference is invalid.')
      return formatBacklogMention(value)
    },
  },
})

export class BacklogMentions {
  static readonly createSource = createSource
  static readonly scopedQuery = scopedQuery
}
