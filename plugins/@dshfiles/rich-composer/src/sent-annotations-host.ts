/** Host side of the sent-annotation history: durable per-session records in the plugin's key-value store. */
import type { Context } from '@deepseek-ai/cordis'
import { pluginStorage } from '@dshfiles/dshx/host'
import { HostContext } from '@dshfiles/dshx/effect'
import { Effect, Option } from 'effect'
import * as Schema from 'effect/Schema'
import { SENT_ANNOTATION_LIMIT, SentAnnotationSchema, type SentAnnotation } from './sent-annotations-api.ts'

/** One plugin namespace keeps every rich-composer record; sent histents live under this key prefix. */
export const SENT_ANNOTATIONS_NAMESPACE = '@dshfiles/rich-composer'

const KEY_PREFIX = 'sent-annotations/'

const StoredAnnotations = Schema.Array(SentAnnotationSchema)

const keyOf = (sessionId: string): string => `${KEY_PREFIX}${sessionId}`

/** Next sequence id for one session; the store is the only writer, so the highest stored id plus one is exact. */
export const nextAnnotationId = (annotations: readonly SentAnnotation[]): number =>
  annotations.reduce((highest, annotation) => Math.max(highest, annotation.id), 0) + 1

/** Keep the newest records when a session exceeds its bound; the oldest annotations drop first. */
const capped = (annotations: readonly SentAnnotation[]): readonly SentAnnotation[] => annotations.slice(-SENT_ANNOTATION_LIMIT)

/**
 * Read one session's history; an unreadable record reads as empty so a broken store never hides the transcript.
 * @param ctx - Host plugin context.
 * @param sessionId - thread whose history to read.
 * @returns the stored annotations, oldest first.
 */
export const readSentAnnotations = async (ctx: Context, sessionId: string): Promise<readonly SentAnnotation[]> => {
  const stored = await pluginStorage(ctx, SENT_ANNOTATIONS_NAMESPACE)
    .get(keyOf(sessionId))
    .catch(() => undefined)
  if (stored === undefined) return []
  const decoded = Schema.decodeUnknownOption(StoredAnnotations)(stored.value)
  return Option.isSome(decoded) ? decoded.value : []
}

const writeSentAnnotations = async (ctx: Context, sessionId: string, annotations: readonly SentAnnotation[]): Promise<void> => {
  await pluginStorage(ctx, SENT_ANNOTATIONS_NAMESPACE).set(keyOf(sessionId), capped(annotations))
}

/** The Host API handlers; every one reads the plugin's own store, then writes the modified list. */
export const sentAnnotationHandlers = {
  list: (input: { readonly sessionId: string }) =>
    Effect.gen(function* () {
      const host = yield* HostContext
      const annotations = yield* Effect.promise(() => readSentAnnotations(host.ctx, input.sessionId))
      return { annotations }
    }),
  add: (input: { readonly sessionId: string; readonly text: string; readonly comment: string; readonly source: string }) =>
    Effect.gen(function* () {
      const host = yield* HostContext
      const annotation = yield* Effect.promise(async () => {
        const stored = await readSentAnnotations(host.ctx, input.sessionId)
        const added: SentAnnotation = {
          id: nextAnnotationId(stored),
          text: input.text,
          comment: input.comment,
          source: input.source,
          sentAt: Date.now(),
        }
        await writeSentAnnotations(host.ctx, input.sessionId, [...stored, added])
        return added
      })
      return { annotation }
    }),
  setComment: (input: { readonly sessionId: string; readonly id: number; readonly comment: string }) =>
    Effect.gen(function* () {
      const host = yield* HostContext
      const updated = yield* Effect.promise(async () => {
        const stored = await readSentAnnotations(host.ctx, input.sessionId)
        if (!stored.some(annotation => annotation.id === input.id)) return false
        await writeSentAnnotations(
          host.ctx,
          input.sessionId,
          stored.map(annotation => (annotation.id === input.id ? { ...annotation, comment: input.comment } : annotation)),
        )
        return true
      })
      return { updated }
    }),
  remove: (input: { readonly sessionId: string; readonly id: number }) =>
    Effect.gen(function* () {
      const host = yield* HostContext
      const removed = yield* Effect.promise(async () => {
        const stored = await readSentAnnotations(host.ctx, input.sessionId)
        const remaining = stored.filter(annotation => annotation.id !== input.id)
        if (remaining.length === stored.length) return false
        await writeSentAnnotations(host.ctx, input.sessionId, remaining)
        return true
      })
      return { removed }
    }),
}
