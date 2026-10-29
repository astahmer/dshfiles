import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { describe, expect, it } from 'vitest'
import type { UndoHistoryRecord } from './undo-history.js'
import { createUndoService } from './undo-service.js'

const memoryTable = (): KvTable<string, UndoHistoryRecord> => {
  const rows = new Map<string, UndoHistoryRecord>()
  return {
    get: key => rows.get(key),
    entries: () => rows.entries(),
    keys: () => rows.keys(),
    get size() {
      return rows.size
    },
    put: async (key, value) => {
      rows.set(key, value)
    },
    delete: async key => rows.delete(key),
    update: async (key, change) => {
      const current = rows.get(key)
      if (current === undefined) throw new Error(`missing row ${key}`)
      const next = change(current)
      rows.set(key, next)
      return next
    },
  }
}

/** A workspace whose "files" are one string; snapshots are numbered copies of it, as a VCS provider would keep. */
const workspace = (initial: string) => {
  const state = { files: initial, snapshots: new Map<string, string>() }
  const take = (): string => {
    const id = `snap-${String(state.snapshots.size + 1)}`
    state.snapshots.set(id, state.files)
    return id
  }
  return {
    state,
    files: {
      snapshot: async () => ({ provider: '@test/vcs', snapshot: take() }),
      restore: async (input: { readonly snapshot: string }) => {
        const previous = take()
        state.files = state.snapshots.get(input.snapshot) ?? state.files
        return previous
      },
    },
  }
}

const sessionsFake = () => {
  const state = { running: new Set<string>(), archived: new Set<string>(), forks: [] as { sessionId: string; atSeq: number }[], failFork: false }
  return {
    state,
    sessions: {
      running: async (sessionId: string) => state.running.has(sessionId),
      fork: async (input: { readonly sessionId: string; readonly atSeq: number }) => {
        if (state.failFork) throw new Error('fork refused')
        state.forks.push(input)
        return `fork-${String(state.forks.length)}`
      },
      copyModel: async () => undefined,
      archive: async (sessionId: string) => {
        state.archived.add(sessionId)
      },
      unarchive: async (sessionId: string) => {
        state.archived.delete(sessionId)
      },
    },
  }
}

const setup = () => {
  const files = workspace('v0')
  const sessions = sessionsFake()
  const service = createUndoService({ table: memoryTable(), files: files.files, sessions: sessions.sessions, now: () => 1 })
  return { files, sessions, service }
}

describe('session undo', () => {
  it('undoes the last turn into a fork cut before it with its files restored, and redoes it', async () => {
    const { files, sessions, service } = setup()
    await service.turnStarted({ sessionId: 's1', turn: 1, forkAtSeq: 4, cwd: '/repo' })
    await service.promptEntered({ sessionId: 's1', turn: 1, text: 'add a feature' })
    await service.promptEntered({ sessionId: 's1', turn: 1, text: 'a later message of the same turn' })
    files.state.files = 'v1'
    await service.turnStarted({ sessionId: 's1', turn: 2, forkAtSeq: 20, cwd: '/repo' })
    files.state.files = 'v2'

    expect(service.history('s1').checkpoints.map(checkpoint => [checkpoint.turn, checkpoint.prompt, checkpoint.files])).toEqual([
      [1, 'add a feature', true],
      [2, '', true],
    ])

    const undone = await service.undo('s1')
    expect(undone).toEqual({ sessionId: 'fork-1', filesRestored: true, prompt: '' })
    expect(files.state.files).toBe('v1')
    expect(sessions.state.forks).toEqual([{ sessionId: 's1', atSeq: 20 }])
    expect(sessions.state.archived).toEqual(new Set(['s1']))
    expect(service.history('fork-1')).toEqual({ checkpoints: [{ turn: 1, prompt: 'add a feature', at: 1, files: true }], redoTo: 's1' })

    const again = await service.undo('fork-1')
    expect(files.state.files).toBe('v0')
    expect(sessions.state.forks.at(-1)).toEqual({ sessionId: 'fork-1', atSeq: 4 })

    expect(await service.redo(again.sessionId)).toEqual({ sessionId: 'fork-1', filesRestored: true })
    expect(files.state.files).toBe('v1')
    expect(await service.redo('fork-1')).toEqual({ sessionId: 's1', filesRestored: true })
    expect(files.state.files).toBe('v2')
    expect(sessions.state.archived.has('s1')).toBe(false)
    expect(sessions.state.archived.has('fork-1')).toBe(true)
    await expect(service.redo('fork-1')).rejects.toThrow('nothing to redo')
  })

  it('refuses while the thread runs, and with nothing recorded', async () => {
    const { sessions, service } = setup()
    await expect(service.undo('s1')).rejects.toThrow('no turn to undo')
    await service.turnStarted({ sessionId: 's1', turn: 1, forkAtSeq: 4, cwd: '/repo' })
    sessions.state.running.add('s1')
    await expect(service.undo('s1')).rejects.toThrow('still running')
  })

  it('a new turn in the fork drops its redo', async () => {
    const { service } = setup()
    await service.turnStarted({ sessionId: 's1', turn: 1, forkAtSeq: 4, cwd: '/repo' })
    const { sessionId } = await service.undo('s1')
    await service.turnStarted({ sessionId, turn: 1, forkAtSeq: 4, cwd: '/repo' })
    expect(service.history(sessionId).redoTo).toBeNull()
  })

  it('puts the files back when the conversation cannot be forked', async () => {
    const { files, sessions, service } = setup()
    await service.turnStarted({ sessionId: 's1', turn: 1, forkAtSeq: 4, cwd: '/repo' })
    files.state.files = 'v1'
    sessions.state.failFork = true
    await expect(service.undo('s1')).rejects.toThrow('fork refused')
    expect(files.state.files).toBe('v1')
    expect(sessions.state.archived.size).toBe(0)
  })

  it('records a turn without files when no provider claims the folder, and holds tool calls until the snapshot is taken', async () => {
    const sessions = sessionsFake()
    let release: () => void = () => undefined
    const gate = new Promise<void>(resolve => {
      release = resolve
    })
    const service = createUndoService({
      table: memoryTable(),
      now: () => 1,
      sessions: sessions.sessions,
      files: {
        snapshot: async () => {
          await gate
          return null
        },
        restore: async () => 'unused',
      },
    })
    void service.turnStarted({ sessionId: 's1', turn: 1, forkAtSeq: 4, cwd: '/scratch' })
    let ready = false
    const waiting = service.whenReady('s1').then(() => {
      ready = true
    })
    await Promise.resolve()
    expect(ready).toBe(false)
    release()
    await waiting
    expect(service.history('s1').checkpoints[0]?.files).toBe(false)
    expect(await service.undo('s1')).toMatchObject({ filesRestored: false })
  })
})
