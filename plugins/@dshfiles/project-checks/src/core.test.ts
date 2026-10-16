import { describe, expect, it } from 'vitest'
import { isWithinRoot, projectChecksConfigSchema, receiptFreshness, verificationPrompt } from './core.js'
import { receiptsAfter, storedReceiptSchema, trimReceiptRows, type StoredReceipt } from './store.js'

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

    expect(trimReceiptRows(rows, 'session-a', 3, 10)).toEqual(['key-1', 'key-0'])
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
    const replay = receiptsAfter(rows, 0, 2_001)
    expect(replay).toHaveLength(2_000)
    expect(replay[0]?.finishedAt).toBe(1)
    expect(replay[replay.length - 1]?.finishedAt).toBe(2_000)
    expect(receiptsAfter(rows, 2_000, 2_000)).toEqual([])
  })

  it('allows a session directory under its trusted root and rejects sibling traversal', () => {
    expect(isWithinRoot('/work/project', '/work/project/packages/app')).toBe(true)
    expect(isWithinRoot('/work/project', '/work/project-elsewhere')).toBe(false)
    expect(isWithinRoot('/work/project', '/work/project/../secrets')).toBe(false)
    expect(isWithinRoot('relative/project', '/work/project')).toBe(false)
  })

  it('marks check receipts stale when the working-copy revision changes', () => {
    expect(receiptFreshness('revision-a', 'revision-a')).toBe('current')
    expect(receiptFreshness('revision-a', 'revision-b')).toBe('stale')
    expect(receiptFreshness(null, 'revision-b')).toBe('unknown')
  })

  it('bounds completion feedback and names the attempt limit', () => {
    const prompt = verificationPrompt(
      Array.from({ length: 10 }, (_, index) => ({ label: `check-${index}`, status: 'failed' as const, exitCode: 1, failure: null })),
      2,
      2,
    )
    expect(prompt).toContain('check-0 (failed, exit 1), check-1 (failed, exit 1)')
    expect(prompt).toContain('and 4 more')
    expect(prompt).toContain('Attempt 2 of 2')
    expect(prompt).not.toContain('check-9')
  })
})
