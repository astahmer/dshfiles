import { describe, expect, it } from 'vitest'
import { projectChecksConfigSchema, ProjectChecksModel } from './core.js'
import { ProjectChecksReceiptModel, storedReceiptSchema, type StoredReceipt } from './store.js'

describe('trusted project actions', () => {
  it('requires absolute trusted roots and unique action ids', () => {
    const action = {
      id: 'test',
      label: 'Test',
      command: 'pnpm',
      root: '/work/project',
    }

    expect(projectChecksConfigSchema.safeParse({ actions: [action, action] }).success).toBe(false)
    expect(projectChecksConfigSchema.safeParse({ actions: [{ ...action, root: 'project' }] }).success).toBe(false)
    expect(projectChecksConfigSchema.parse({ actions: [action] }).actions[0]?.timeoutMs).toBe(60_000)
    expect(projectChecksConfigSchema.parse(undefined).actions).toEqual([])
  })

  it('trims old receipts per session while preserving the newest rows', () => {
    const rows: Array<readonly [string, StoredReceipt]> = Array.from({ length: 5 }, (_, index) => {
      const receipt: StoredReceipt = {
        id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
        sessionId: 'session-a',
        actionId: 'test',
        label: 'Test',
        status: 'passed',
        failure: null,
        startedAt: index,
        finishedAt: index,
        durationMs: 0,
        exitCode: 0,
        sourceRevision: null,
        verificationTurn: null,
        automatic: false,
        attempt: 0,
      }
      return [`key-${index}`, receipt]
    })

    expect(ProjectChecksReceiptModel.trimRows(rows, 'session-a', 3, 10)).toEqual(['key-1', 'key-0'])
  })

  it('reads legacy receipts and bounds newer-first backfill to retained evidence', () => {
    const legacy: StoredReceipt = {
      id: '00000000-0000-4000-8000-000000000000',
      sessionId: 'session-a',
      actionId: 'unit-check',
      label: 'Unit check',
      status: 'passed',
      failure: null,
      startedAt: 1,
      finishedAt: 1,
      durationMs: 0,
      exitCode: 0,
      sourceRevision: null,
      verificationTurn: null,
      automatic: false,
      attempt: 0,
    }
    expect(storedReceiptSchema.parse(legacy)).toEqual(legacy)

    const rows: Array<readonly [string, StoredReceipt]> = Array.from({ length: 2_001 }, (_, index) => {
      const receipt: StoredReceipt = {
        ...legacy,
        id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
        startedAt: index,
        finishedAt: index,
      }
      return [`key-${String(index)}`, receipt]
    })
    const replay = ProjectChecksReceiptModel.after(rows, 0, 2_001)
    expect(replay).toHaveLength(2_000)
    expect(replay[0]?.finishedAt).toBe(1)
    expect(replay[replay.length - 1]?.finishedAt).toBe(2_000)
    expect(ProjectChecksReceiptModel.after(rows, 2_000, 2_000)).toEqual([])
  })

  it('allows a session directory under its trusted root and rejects sibling traversal', () => {
    expect(ProjectChecksModel.isWithinRoot('/work/project', '/work/project/packages/app')).toBe(true)
    expect(ProjectChecksModel.isWithinRoot('/work/project', '/work/project-elsewhere')).toBe(false)
    expect(ProjectChecksModel.isWithinRoot('/work/project', '/work/project/../secrets')).toBe(false)
    expect(ProjectChecksModel.isWithinRoot('relative/project', '/work/project')).toBe(false)
  })

  it('marks check receipts stale when the working-copy revision changes', () => {
    expect(ProjectChecksModel.receiptFreshness('revision-a', 'revision-a')).toBe('current')
    expect(ProjectChecksModel.receiptFreshness('revision-a', 'revision-b')).toBe('stale')
    expect(ProjectChecksModel.receiptFreshness(null, 'revision-b')).toBe('unknown')
  })

  it('bounds completion feedback and names the attempt limit', () => {
    const prompt = ProjectChecksModel.verificationPrompt(
      Array.from({ length: 10 }, (_, index) => ({ label: `check-${index}`, status: 'failed' as const, exitCode: 1, failure: null })),
      2,
      2,
    )
    expect(prompt).toContain('check-0 (failed, exit 1), check-1 (failed, exit 1)')
    expect(prompt).toContain('and 4 more')
    expect(prompt).toContain('Attempt 2 of 2')
    expect(prompt).not.toContain('check-9')
  })

  describe('peer execution configuration', () => {
    const action = { id: 'test', label: 'Test', command: 'pnpm', args: ['test'], root: '/work/project' }
    const remote = {
      id: 'm1',
      sshTarget: 'm1-perso',
      gitRemote: 'm1',
      workspace: '/Users/peer/dev/project-check',
    }

    it('defaults every action to local execution and keeps the load floor', () => {
      const config = projectChecksConfigSchema.parse({ actions: [action] })
      expect(config.actions[0]?.execution).toEqual({ target: 'local', onRemoteFailure: 'local' })
      expect(config.remotes).toEqual([])
      expect(config.load).toEqual({ localMemoryFloorMb: 4_096, remoteCooldownMs: 60_000 })
      expect(projectChecksConfigSchema.parse({ remotes: [remote] }).remotes[0]?.peerRemote).toBe('origin')
    })

    it('rejects duplicate remote ids, relative workspaces and unknown remote references', () => {
      expect(projectChecksConfigSchema.safeParse({ remotes: [remote, remote] }).success).toBe(false)
      expect(projectChecksConfigSchema.safeParse({ remotes: [{ ...remote, workspace: 'relative/path' }] }).success).toBe(false)
      expect(projectChecksConfigSchema.safeParse({ remotes: [{ ...remote, sshTarget: '-o ProxyCommand=evil' }] }).success).toBe(false)
      expect(
        projectChecksConfigSchema.safeParse({
          actions: [{ ...action, execution: { target: 'remote', remote: 'missing' } }],
          remotes: [remote],
        }).success,
      ).toBe(false)
    })

    it('requires an enabled remote for a hard remote target but allows auto without one', () => {
      expect(projectChecksConfigSchema.safeParse({ actions: [{ ...action, execution: { target: 'remote' } }] }).success).toBe(false)
      expect(
        projectChecksConfigSchema.safeParse({ actions: [{ ...action, execution: { target: 'remote' } }], remotes: [{ ...remote, enabled: false }] }).success,
      ).toBe(false)
      expect(projectChecksConfigSchema.safeParse({ actions: [{ ...action, execution: { target: 'remote' } }], remotes: [remote] }).success).toBe(true)
      expect(projectChecksConfigSchema.safeParse({ actions: [{ ...action, execution: { target: 'auto' } }] }).success).toBe(true)
    })

    it('keeps install detection configurable per remote', () => {
      const parsed = projectChecksConfigSchema.parse({
        remotes: [{ ...remote, install: { command: ['pnpm', 'install', '--frozen-lockfile'] } }],
      })
      expect(parsed.remotes[0]?.install).toEqual({
        command: ['pnpm', 'install', '--frozen-lockfile'],
        whenPaths: ['pnpm-lock.yaml', 'pnpm-workspace.yaml'],
        timeoutMs: 300_000,
      })
      expect(projectChecksConfigSchema.safeParse({ remotes: [{ ...remote, install: { command: [] } }] }).success).toBe(false)
    })
  })
})
