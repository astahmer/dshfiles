import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { HostEvents } from '@dshfiles/dshx/effect'
import { Context, Effect, HashMap, Layer, Option, Ref } from 'effect'

import { ThreadDigestRules } from './digest.ts'
import { Digester } from './digester.ts'
import { MemorySettingsTag } from './embedder.ts'
import { MemoryRepo } from './memory-repo.ts'

const citationPattern = /memory:\s*((?:`?[tn]:[\w-]+(?:#\d+)?`?)(?:\s*[,;]\s*`?[tn]:[\w-]+(?:#\d+)?`?)*)/gi

export const citedIds = (text: string): readonly string[] =>
  [...text.matchAll(citationPattern)].flatMap(match => (match[1] ?? '').split(/[,;]/).map(id => id.replace(/[`\s]/g, '').replace(/#\d+$/, '').toLowerCase()))

/** How long after a citation a correction still counts against it. */
const correctionWindowMs = 30 * 60_000

/** A reply revising an earlier statement; a heuristic, labelled as such in the panel. */
const selfCorrection =
  /\b(?:i was wrong|that was wrong|correction:|let me correct|actually,? (?:it|the|that)|turns out|is (?:outdated|stale|no longer (?:true|the case|accurate)))\b/i

const textOf = (blocks: readonly { readonly type: string; readonly text?: string }[]): string =>
  blocks.flatMap(block => (block.type === 'text' && block.text !== undefined ? [block.text] : [])).join('\n')

export type UserMessage = { readonly seq: number; readonly text: string }

/**
 * What memory learns from live Session events: digests wait for a thread to go idle, citations of memory ids are
 * counted, and the latest user message of each thread is kept so a note can name the message it came from.
 */
export class SessionActivity extends Context.Service<
  SessionActivity,
  {
    readonly handle: (session: { readonly id: string }, event: SessionEvent) => Effect.Effect<void>
    readonly lastUserMessage: (sessionId: string) => Effect.Effect<Option.Option<UserMessage>>
  }
>()('@dshfiles/memory/SessionActivity') {
  static readonly layer = Layer.effect(
    SessionActivity,
    Effect.gen(function* () {
      const settings = yield* MemorySettingsTag
      const repo = yield* MemoryRepo
      const digester = yield* Digester
      const lastUser = yield* Ref.make(HashMap.empty<string, UserMessage>())

      const recordCitations = Effect.fn('memory record citations')(function* (sessionId: string, cited: readonly string[]) {
        yield* repo.markCited({ thread: sessionId, cited, sinceMs: 3_600_000 })
        for (const id of new Set(cited)) {
          yield* repo.bump('citations')
          if (id.startsWith('n:')) {
            yield* repo.recordUse({ kind: 'note', id: Number(id.slice(2)) }, sessionId)
            continue
          }
          const thread = yield* repo.thread(id.slice(2))
          if (thread !== undefined) yield* repo.recordUse({ kind: 'thread', id: thread.id }, sessionId)
        }
      })

      const handle = (session: { readonly id: string }, event: SessionEvent) =>
        Effect.gen(function* () {
          if (!(yield* settings.get).enabled) return
          if (event.type === 'turn/start') return yield* digester.cancel(session.id)
          if (event.type === 'turn/end') return yield* digester.schedule(session.id)
          if (event.type === 'user/message' && event.data.source.kind === 'user') {
            const text = textOf(event.data.content)
            const message: UserMessage = { seq: event.seq, text }
            yield* Ref.update(lastUser, entries => HashMap.set(entries, session.id, message))
            // Heuristic: the user corrects an answer that cited memory.
            if (ThreadDigestRules.flagSignal(text) === 'correction') yield* repo.flagCitations({ thread: session.id, by: 'user', sinceMs: correctionWindowMs })
            return
          }
          if (event.type !== 'assistant/message') return
          const text = textOf(event.data.message.content)
          const cited = citedIds(text)
          // Heuristic: a later reply revises what an earlier reply took from memory.
          if (cited.length === 0) {
            if (selfCorrection.test(text)) yield* repo.flagCitations({ thread: session.id, by: 'agent', sinceMs: correctionWindowMs })
            return
          }
          yield* recordCitations(session.id, cited)
        }).pipe(Effect.catchCause(cause => Effect.logWarning('memory: recording session activity failed', cause)))

      yield* HostEvents.on('session/event', handle)

      return SessionActivity.of({
        handle,
        lastUserMessage: sessionId => Effect.map(Ref.get(lastUser), HashMap.get(sessionId)),
      })
    }),
  )
}
