import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import type { ApiCaller } from '@dshfiles/dshx/api'
import { Api, DshxPlugin } from '@dshfiles/dshx/effect'
import { Effect } from 'effect'

import { memoryApi, type PanelThread } from './api.ts'
import { Digester } from './digester.ts'
import { Embedder } from './embedder.ts'
import { InvalidDateFilter, MemoryStoreFailed, NoteNoLongerValid } from './errors.ts'
import { memoryLayer } from './memory-layer.ts'
import { memoryReferenceKey } from './memory-reference.ts'
import { MemoryRepo, type NoteCategory } from './memory-repo.ts'
import { memoryUsage, panelNote, panelThread } from './panel.ts'
import { ProjectPaths } from './project-path.ts'
import { Recall, type Caller } from './recall.ts'
import { memorySettings } from './settings.ts'
import { renderUsageSummary, snapshotOf } from './usage-summary.ts'
import { WorkspaceScripts } from './workspace-scripts.ts'
import { workspaceScriptsApi } from './workspace-scripts-api.ts'

const dayMs = 86_400_000

const noteCategories: readonly NoteCategory[] = ['user', 'feedback', 'project', 'reference']

/** The panel sends every filter field; an empty string means "any". */
const emptyToUndefined = (value: string): string | undefined => (value.trim() === '' ? undefined : value)

/** The calling thread for memory's agent tools; a Client or plugin caller searches as no particular thread. */
const callerOf = (caller: ApiCaller): Caller => {
  if (caller.kind === 'agent' && caller.sessionId !== undefined) return { id: caller.sessionId, session: { header: { id: caller.sessionId, cwd: caller.cwd } } }
  const id = caller.kind === 'plugin' ? `api:${caller.packageId}` : 'api:client'
  return { id, session: { header: { id } } }
}

/** `YYYY-MM-DD` (a whole UTC day) or an ISO 8601 timestamp; anything else is refused rather than silently ignored. */
const instant = (value: string | undefined, endOfDay: boolean) => {
  if (value === undefined || value.trim().length === 0) return Effect.succeed(undefined)
  const text = value.trim()
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(text)
  const parsed = dateOnly ? Date.parse(`${text}T00:00:00.000Z`) : Date.parse(text)
  if (!Number.isFinite(parsed)) return Effect.fail(new InvalidDateFilter({ value }))
  return Effect.succeed(dateOnly && endOfDay ? parsed + dayMs - 1 : parsed)
}

const noteFilter = (input: { readonly project: string; readonly scope: string; readonly type: string; readonly query: string; readonly thread: string }) => ({
  project: emptyToUndefined(input.project),
  scope: emptyToUndefined(input.scope),
  category: noteCategories.find(category => category === input.type),
  query: emptyToUndefined(input.query),
  thread: emptyToUndefined(input.thread),
})

/** A note version read back after a write; the write and the read share one store, so absence is a store bug. */
const recordOf = (id: number) =>
  Effect.gen(function* () {
    const repo = yield* MemoryRepo
    const record = (yield* repo.noteHistory(id)).find(note => note.id === id)
    if (record === undefined) return yield* new MemoryStoreFailed({})
    return panelNote(record)
  })

const normalized = Effect.flatMap(ProjectPaths, paths => paths.ready)

const threads = Effect.fn('memory threads')(function* (input: { readonly project: string; readonly includeUndigested?: boolean | undefined }) {
  const repo = yield* MemoryRepo
  const recall = yield* Recall
  yield* normalized
  const project = emptyToUndefined(input.project)
  const stored = (yield* repo.listThreads({ project, limit: 500 })).map(panelThread)
  if (input.includeUndigested !== true) return stored
  const digested = new Set(stored.map(thread => thread.id))
  const sessions: PanelThread[] = (yield* recall.threadRecords)
    .filter(record => !digested.has(record.sessionId))
    .filter(record => project === undefined || record.project === project)
    .map(record => ({
      id: record.sessionId,
      project: record.project,
      title: record.title.length === 0 ? '(untitled thread)' : record.title,
      decision: '',
      digest: '',
      source: null,
      updatedAt: record.updatedAt,
      createdAt: record.createdAt,
      digestedAt: null,
      digested: false,
      events: null,
      lastSeq: 0,
      citations: 0,
    }))
  return [...stored, ...sessions].sort((left, right) => right.updatedAt - left.updatedAt).slice(0, 500)
})

const preview = Effect.fn('memory preview')(function* (input: { readonly id: string; readonly range?: string | undefined }) {
  const repo = yield* MemoryRepo
  const summary = yield* (yield* Recall).read(input)
  const key = memoryReferenceKey(input)
  const missing = { kind: 'missing' as const, id: input.id, summary, note: null, thread: null }
  if (key?.kind === 'excerpt') return { kind: 'excerpt' as const, id: input.id, summary, note: null, thread: null }
  if (key?.kind === 'note') {
    const note = (yield* repo.noteHistory(key.noteId)).find(record => record.valid && record.id === key.noteId)
    return note === undefined ? missing : { kind: 'note' as const, id: input.id, summary, note: panelNote(note), thread: null }
  }
  if (key?.kind === 'digest') {
    const thread = yield* repo.thread(key.threadKey)
    return thread === undefined ? missing : { kind: 'digest' as const, id: input.id, summary, note: null, thread: panelThread(thread) }
  }
  return missing
})

const memoryHandlers = Api.handlers(memoryApi, {
  search: (input, call) => Recall.use(recall => recall.search(callerOf(call.caller), input)).pipe(Effect.map(summary => ({ summary }))),
  findThreads: (input, call) =>
    Effect.gen(function* () {
      const recall = yield* Recall
      return yield* recall.findThreads(callerOf(call.caller), {
        ...input,
        createdFrom: yield* instant(input.createdFrom, false),
        createdTo: yield* instant(input.createdTo, true),
      })
    }),
  relatedThreads: (input, call) => Recall.use(recall => recall.relatedThreads(callerOf(call.caller), input)),
  read: (input, call) => Recall.use(recall => recall.read(input, callerOf(call.caller))).pipe(Effect.map(summary => ({ summary }))),
  preview,
  note: (input, call) => Recall.use(recall => recall.note(callerOf(call.caller), input)).pipe(Effect.map(summary => ({ summary }))),
  usage: input => memoryUsage(input.days ?? 30),
  usageSummary: input => Effect.map(memoryUsage(input.days ?? 30), usage => ({ summary: renderUsageSummary(snapshotOf(usage, input.days ?? 30)) })),
  projects: () =>
    Effect.andThen(
      normalized,
      Effect.map(
        MemoryRepo.use(repo => repo.projects),
        projects => [...projects],
      ),
    ),
  startBlock: input => Recall.use(recall => recall.previewStartBlock(input.cwd, input.scope)),
  notes: input =>
    Effect.andThen(
      normalized,
      Effect.map(
        MemoryRepo.use(repo => repo.listNotes({ ...noteFilter(input), includeInvalid: input.includeInvalid, limit: 500 })),
        notes => notes.map(panelNote),
      ),
    ),
  panelNotes: input =>
    Effect.andThen(
      normalized,
      Effect.map(
        MemoryRepo.use(repo => repo.listNotes({ ...noteFilter(input), includeInvalid: input.includeInvalid, includeArchived: true, limit: 500 })),
        notes => notes.map(panelNote),
      ),
    ),
  reviewNotes: (input, call) =>
    Recall.use(recall => recall.reviewNotes(callerOf(call.caller), { project: emptyToUndefined(input.project), afterId: input.afterId, limit: input.limit })),
  noteCounts: input =>
    Effect.andThen(
      normalized,
      MemoryRepo.use(repo => repo.noteStatusCounts(emptyToUndefined(input.project))),
    ),
  createNote: input =>
    Effect.gen(function* () {
      yield* normalized
      const saved = yield* (yield* MemoryRepo).addNote({
        project: input.project,
        text: input.text,
        category: input.type,
        scope: input.scope,
        confidence: input.confidence,
        sourceThread: null,
        sourceSeq: null,
        origin: 'panel',
      })
      yield* (yield* Embedder).embedMissingInBackground
      return yield* recordOf(saved.note.id)
    }),
  noteHistory: input =>
    Effect.map(
      MemoryRepo.use(repo => repo.noteHistory(input.id)),
      history => history.filter(note => note.archivedAt === null).map(panelNote),
    ),
  panelNoteHistory: input =>
    Effect.map(
      MemoryRepo.use(repo => repo.noteHistory(input.id)),
      history => history.map(panelNote),
    ),
  editNote: input =>
    Effect.gen(function* () {
      const updated = yield* (yield* MemoryRepo).updateNote({
        id: input.id,
        text: input.text,
        category: input.type,
        scope: input.scope,
        reason: input.reason || 'edited in the Memory panel',
        sourceThread: null,
        sourceSeq: null,
        origin: 'panel',
      })
      if (updated === undefined) return yield* new NoteNoLongerValid({ id: input.id })
      return yield* recordOf(updated.id)
    }),
  forgetNote: input =>
    Effect.map(
      MemoryRepo.use(repo => repo.forgetNote({ id: input.id, reason: input.reason || 'removed in the Memory panel' })),
      forgotten => ({ forgotten }),
    ),
  archiveNote: input =>
    Effect.map(
      MemoryRepo.use(repo => repo.archiveNote(input.id)),
      archived => ({ archived }),
    ),
  restoreNote: input =>
    Effect.map(
      MemoryRepo.use(repo => repo.restoreNote(input.id)),
      restored => ({ restored }),
    ),
  citations: input =>
    Effect.map(
      MemoryRepo.use(repo =>
        repo.recentCitations({
          limit: 100,
          thread: input.thread === undefined || input.thread.length === 0 ? undefined : input.thread,
          ref: input.ref === undefined || input.ref.length === 0 ? undefined : input.ref,
        }),
      ),
      citations => [...citations],
    ),
  rateCitation: input =>
    Effect.map(
      MemoryRepo.use(repo => repo.rateCitation({ id: input.id, rating: input.rating })),
      rated => ({ rated }),
    ),
  threads,
  threadDetail: input => Recall.use(recall => recall.threadDetail(input.id)),
  redigest: input =>
    Effect.map(
      Digester.use(digester => digester.digest(input.id)),
      outcome => ({ outcome }),
    ),
})

export default DshxPlugin.make({
  name: '@dshfiles/memory',
  settings: [memorySettings],
  layer: memoryLayer(dshHomePath('plugins', 'memory', 'memory.db')),
  apis: [Api.bind(memoryApi, memoryHandlers), Api.bind(workspaceScriptsApi, { scripts: input => WorkspaceScripts.use(scripts => scripts.forCwd(input.cwd)) })],
})
