import type { InputTriggerCandidate, InputTriggerSource } from '@dshfiles/input-trigger/client'
import { z } from 'zod'

import type { BacklogSummaryView } from './api.js'
import { BacklogItems } from './item.js'
import { formatBacklogMention } from './backlog-mention-text.js'

const MENTION_SCOPE = /^(thread|t|file|f|skill|mcp|backlog|b):/iu
/** Plain `@` shows a few items next to threads and files; `@b:` lists the backlog alone. */
const MIXED_LIMIT = 5
const SCOPED_LIMIT = 40

const refSchema = z.object({ id: z.number().int().positive(), title: z.string().max(BacklogItems.maxTitleChars) }).strict()

const decodeRef = (ref: string): z.infer<typeof refSchema> | null => {
  try {
    const parsed = refSchema.safeParse(JSON.parse(ref))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/** The text after `@b:`/`@backlog:`, the whole query for plain `@`, or undefined while another source's scope is typed. */
const scopedQuery = (query: string): { readonly text: string; readonly scoped: boolean } | undefined => {
  const scope = MENTION_SCOPE.exec(query)?.[1]?.toLowerCase()
  if (scope === undefined) return { text: query, scoped: false }
  return scope === 'b' || scope === 'backlog' ? { text: query.slice(scope.length + 1), scoped: true } : undefined
}

const candidateOf = (item: BacklogSummaryView, section: string): InputTriggerCandidate => ({
  name: `b:${String(item.id)}`,
  label: item.title,
  description: `${item.kind} · ${item.status}`,
  section,
  value: JSON.stringify({ id: item.id, title: item.title }),
})

/**
 * `@` mentions of backlog items. A sent chip reads `b:<id>`, so the Host's thread signal links the thread and starts
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
      insert: { source: 'backlog', ref: JSON.stringify(ref), label: `b:${String(ref.id)} ${ref.title}`, clipboardText: `b:${String(ref.id)} ${ref.title}` },
    }
  },
  codec: {
    clipboardText(ref) {
      const value = decodeRef(ref)
      return value === null ? 'Backlog item' : `b:${String(value.id)} ${value.title}`
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
