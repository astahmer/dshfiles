import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { PluginApiError } from '@dshfiles/dshx/api'
import { UndoHistory, type UndoHistoryRecord } from './undo-history.js'

export interface UndoFiles {
  /** Snapshot the workspace through the provider that claims it; null when none does. */
  snapshot(cwd: string): Promise<{ readonly provider: string; readonly snapshot: string } | null>
  /** Restore a snapshot and return one of the files as they were just before. */
  restore(input: { readonly provider: string; readonly cwd: string; readonly snapshot: string }): Promise<string>
}

export interface UndoSessions {
  running(sessionId: string): Promise<boolean>
  fork(input: { readonly sessionId: string; readonly atSeq: number }): Promise<string>
  copyModel(input: { readonly from: string; readonly to: string }): Promise<void>
  archive(sessionId: string): Promise<void>
  unarchive(sessionId: string): Promise<void>
}

/**
 * Undo forks the conversation back before the last turn and restores that turn's file snapshot; redo restores the
 * files the undo replaced and brings the original thread back. Each turn's snapshot finishes before any of its tool
 * calls run (`whenReady`), so a checkpoint never already contains the turn's own edits.
 */
export const createUndoService = (deps: {
  readonly table: KvTable<string, UndoHistoryRecord>
  readonly files: UndoFiles
  readonly sessions: UndoSessions
  readonly now: () => number
}) => {
  const pending = new Map<string, Promise<void>>()
  const prompts = new Map<string, { readonly turn: number; readonly text: string }>()
  const record = (sessionId: string): UndoHistoryRecord => deps.table.get(sessionId) ?? UndoHistory.empty(sessionId)

  const refuseWhileRunning = async (sessionId: string, verb: string): Promise<void> => {
    if (await deps.sessions.running(sessionId)) {
      throw new PluginApiError(`This thread is still running; stop it or wait for its turn to end, then ${verb} again.`, { code: 'running' })
    }
  }

  return {
    turnStarted: (input: { readonly sessionId: string; readonly turn: number; readonly forkAtSeq: number; readonly cwd: string }): Promise<void> => {
      const work = (async () => {
        const taken = await deps.files.snapshot(input.cwd).catch(() => null)
        const prompt = prompts.get(input.sessionId)
        await deps.table.put(
          input.sessionId,
          UndoHistory.withCheckpoint(record(input.sessionId), {
            turn: input.turn,
            forkAtSeq: input.forkAtSeq,
            cwd: input.cwd,
            provider: taken?.provider ?? null,
            snapshot: taken?.snapshot ?? null,
            prompt: prompt?.turn === input.turn ? prompt.text : '',
            at: deps.now(),
          }),
        )
      })()
      pending.set(input.sessionId, work)
      void work.finally(() => {
        if (pending.get(input.sessionId) === work) pending.delete(input.sessionId)
      })
      return work
    },

    promptEntered: async (input: { readonly sessionId: string; readonly turn: number; readonly text: string }): Promise<void> => {
      if (prompts.get(input.sessionId)?.turn === input.turn) return
      prompts.set(input.sessionId, { turn: input.turn, text: input.text })
      const current = deps.table.get(input.sessionId)
      if (current !== undefined && current.checkpoints.some(checkpoint => checkpoint.turn === input.turn)) {
        await deps.table.put(input.sessionId, UndoHistory.withPrompt(current, input.turn, input.text))
      }
    },

    whenReady: (sessionId: string): Promise<void> => pending.get(sessionId)?.catch(() => undefined) ?? Promise.resolve(),

    history: (sessionId: string) => {
      const current = record(sessionId)
      return {
        checkpoints: current.checkpoints.map(checkpoint => ({
          turn: checkpoint.turn,
          prompt: checkpoint.prompt,
          at: checkpoint.at,
          files: checkpoint.snapshot !== null,
        })),
        redoTo: current.redo?.sessionId ?? null,
      }
    },

    undo: async (sessionId: string) => {
      await refuseWhileRunning(sessionId, 'undo')
      const source = record(sessionId)
      const undone = source.checkpoints.at(-1)
      if (undone === undefined)
        throw new PluginApiError('There is no turn to undo in this thread since this plugin started recording it.', { code: 'nothing-to-undo' })
      const previous =
        undone.provider === null || undone.snapshot === null
          ? null
          : await deps.files.restore({ provider: undone.provider, cwd: undone.cwd, snapshot: undone.snapshot })
      let forkId: string
      try {
        forkId = await deps.sessions.fork({ sessionId, atSeq: undone.forkAtSeq })
      } catch (error) {
        if (previous !== null && undone.provider !== null) await deps.files.restore({ provider: undone.provider, cwd: undone.cwd, snapshot: previous })
        throw error
      }
      await deps.table.put(forkId, UndoHistory.forked({ source, forkId, undone, previous }))
      await deps.sessions.copyModel({ from: sessionId, to: forkId }).catch(() => undefined)
      await deps.sessions.archive(sessionId).catch(() => undefined)
      return { sessionId: forkId, filesRestored: previous !== null, prompt: undone.prompt }
    },

    redo: async (sessionId: string) => {
      const current = record(sessionId)
      if (current.redo === null) {
        throw new PluginApiError('There is nothing to redo: this thread is not an undo, or it ran a new turn since.', { code: 'nothing-to-redo' })
      }
      await refuseWhileRunning(sessionId, 'redo')
      const redo = current.redo
      if (redo.provider !== null && redo.snapshot !== null) await deps.files.restore({ provider: redo.provider, cwd: redo.cwd, snapshot: redo.snapshot })
      await deps.table.put(sessionId, { ...current, redo: null })
      await deps.sessions.unarchive(redo.sessionId).catch(() => undefined)
      await deps.sessions.archive(sessionId).catch(() => undefined)
      return { sessionId: redo.sessionId, filesRestored: redo.snapshot !== null }
    },
  }
}

export type UndoService = ReturnType<typeof createUndoService>
