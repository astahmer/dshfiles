import { basename } from 'node:path'

import { Utf8 } from '@dshfiles/optmem-core'
import { Effect } from 'effect'

import { ThreadDigestRules } from './digest.ts'
import { MemoryGuidance } from './guidance.ts'
import { MemoryRepo, type Note, type StoredThread } from './memory-repo.ts'

const day = (time: number): string => new Date(time).toISOString().slice(0, 10)

/** `{{` would be read as a prompt variable by DSH's prompt interpolation; the section also opts out of it. */
const neutralize = (text: string): string => text.replaceAll('{{', '{ {').replaceAll('}}', '} }')

const noteLine = (note: Note): string =>
  `- n:${note.id} [${note.category}${note.scope === 'repo' ? '' : `, ${note.scope}`}${note.confidence === 'inferred' ? ', inferred' : ''}] ${Utf8.clip(note.text.replace(/\s+/g, ' '), 220)}`

const threadLine = (thread: StoredThread): string =>
  `- ${day(thread.updatedAt)} t:${ThreadDigestRules.shortId(thread.id)} ${Utf8.clip(`${thread.title} — ${thread.decision}`, 200)}`

/** The text of a block from its entries, cut to the byte budget; notes never take more than half when threads exist. */
const renderBlock = (input: {
  readonly project: string
  readonly budgetBytes: number
  readonly notes: readonly Note[]
  readonly own: readonly StoredThread[]
  readonly others: readonly StoredThread[]
}): string => {
  if (input.notes.length === 0 && input.own.length === 0 && input.others.length === 0) return ''
  const lines = [MemoryGuidance.blockInstruction]
  let used = Utf8.byteLength(MemoryGuidance.blockInstruction)
  const add = (line: string): void => {
    const bytes = Utf8.byteLength(line) + 1
    if (used + bytes > input.budgetBytes) return
    lines.push(line)
    used += bytes
  }
  /** Adds a heading and as many entries as fit, within `share` bytes of what is left, so notes cannot crowd out every thread pointer. */
  const group = (heading: string, entries: readonly string[], share = Number.POSITIVE_INFINITY): void => {
    const limit = Math.min(input.budgetBytes, used + share)
    const fitting: string[] = []
    let bytes = Utf8.byteLength(heading) + 1
    for (const entry of entries) {
      if (used + bytes + Utf8.byteLength(entry) + 1 > limit) break
      fitting.push(entry)
      bytes += Utf8.byteLength(entry) + 1
    }
    if (fitting.length === 0) return
    add(heading)
    for (const entry of fitting) add(entry)
  }
  group('Notes:', input.notes.map(noteLine), input.own.length + input.others.length === 0 ? Number.POSITIVE_INFINITY : (input.budgetBytes - used) / 2)
  group(`Threads in ${basename(input.project) || input.project}:`, input.own.map(threadLine))
  const otherProjects = [...new Set(input.others.map(thread => thread.project))]
  for (const project of otherProjects)
    group(`Threads in ${basename(project) || project}:`, input.others.filter(thread => thread.project === project).map(threadLine))
  return neutralize(lines.join('\n'))
}

/**
 * The start block: a fixed instruction, then pointers ranked by citations and recency and grouped by project, cut to a
 * byte budget. It depends only on the store and the project, never on the thread, so every thread of a project gets
 * the same bytes until memory changes and the provider's prefix cache spans threads.
 */
export const renderStartBlock = Effect.fn('memory render start block')(function* (input: {
  readonly project: string
  readonly budgetBytes: number
  readonly crossProject: boolean
  /** Unused and uncited entries older than this drop out of the block (they stay searchable). */
  readonly staleDays: number
  /** The note scope of the agent that started this thread, when one did; its notes join global ones. */
  readonly agentScope?: string | null | undefined
  /** False when the recall gate decided this thread does not need pointers to earlier threads. */
  readonly withThreads?: boolean | undefined
}) {
  const repo = yield* MemoryRepo
  const agentScope = input.agentScope ?? null
  const notes = yield* repo.blockNotes({ project: input.project, limit: 12, ...(agentScope !== null && { scopes: [agentScope] }) })
  const own = input.withThreads === false ? [] : yield* repo.blockThreads({ projects: [input.project], limit: 12, staleDays: input.staleDays })
  const others =
    input.withThreads === false || !input.crossProject
      ? []
      : (yield* repo.blockThreads({ excludeProjects: [input.project], limit: 6, staleDays: input.staleDays })).filter(thread => thread.uses > 0)
  return renderBlock({ project: input.project, budgetBytes: input.budgetBytes, notes, own, others })
})
