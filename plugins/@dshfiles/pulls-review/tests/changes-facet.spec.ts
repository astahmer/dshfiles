import { describe, expect, it } from 'vitest'
import { ChangesScopeModel } from '../src/changes-scope.js'
import { LandCardModel } from '../src/land-readiness.js'
import { ReviewedMarksModel } from '../src/reviewed.js'
import { TurnChangesModel } from '../src/turn-changes.js'

describe('ChangesScopeModel', () => {
  it('maps each scope to the revisions it compares', () => {
    expect(ChangesScopeModel.base('thread', 'main')).toBe('fork_point("main" | @)')
    expect(ChangesScopeModel.base('thread', 'feature/x')).toBe('fork_point("feature/x" | @)')
    expect(ChangesScopeModel.base('uncommitted', 'main')).toBe('@-')
    expect(ChangesScopeModel.base('target', 'trunk')).toBe('trunk')
    expect(ChangesScopeModel.base('turn', 'main')).toBeUndefined()
    expect(ChangesScopeModel.label('target', 'main')).toBe('vs main')
  })

  it('reads the turn card address the native review tab would open', () => {
    expect(ChangesScopeModel.parseTurnAddress('dsh-resource://changes-review/session/session-a%2Fb/42/3')).toEqual({ sessionId: 'session-a/b', seq: 42, turn: 3 })
    expect(ChangesScopeModel.parseTurnAddress('dsh-resource://changes-review/session/s/x/3')).toBeUndefined()
    expect(ChangesScopeModel.parseTurnAddress('dsh-resource://file/session/s/a.ts')).toBeUndefined()
    expect(ChangesScopeModel.turnAddressPattern).toBe('dsh-resource://changes-review/**')
  })

  it('decodes opener requests and picks a default scope', () => {
    expect(ChangesScopeModel.decodeRequest({ scope: 'turn', seq: 4, turn: 2 })).toEqual({ scope: 'turn', seq: 4, turn: 2 })
    expect(ChangesScopeModel.decodeRequest({ scope: 'nope' })).toBeUndefined()
    expect(ChangesScopeModel.decodeRequest(undefined)).toBeUndefined()
    expect(ChangesScopeModel.defaultScope({ isolated: true, hasTurn: true })).toBe('thread')
    expect(ChangesScopeModel.defaultScope({ isolated: false, hasTurn: true })).toBe('turn')
    expect(ChangesScopeModel.defaultScope({ isolated: false, hasTurn: false })).toBe('uncommitted')
  })
})

describe('TurnChangesModel', () => {
  it('lists the turns that changed files from the thread events', () => {
    const entries = [
      { type: 'event', event: { type: 'user/message', seq: 1, data: {} } },
      { type: 'event', event: { type: 'workspace/changes', seq: 7, data: { turn: 1 } } },
      { type: 'pending' },
      { type: 'event', event: { type: 'workspace/changes', seq: 12, data: { turn: 2 } } },
      { type: 'event', event: { type: 'workspace/changes', seq: 13, data: { turn: 0 } } },
    ]
    expect(TurnChangesModel.events(entries)).toEqual([
      { seq: 7, turn: 1 },
      { seq: 12, turn: 2 },
    ])
  })

  it('renders one turn comparison as a git patch', () => {
    const diff = TurnChangesModel.decodeDiff({
      kind: 'text',
      path: 'src/a.ts',
      display: 'src/a.ts',
      before: false,
      after: true,
      coarse: false,
      hunks: [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: 2, lines: ['+one', '+two'] }],
    })
    expect(diff).toBeDefined()
    expect(TurnChangesModel.patchOf(diff ?? { kind: 'binary', path: '', display: '' })).toBe(
      'diff --git a/src/a.ts b/src/a.ts\nnew file mode 100644\n--- /dev/null\n+++ b/src/a.ts\n@@ -0,0 +1,2 @@\n+one\n+two\n',
    )
    expect(TurnChangesModel.patchOf({ kind: 'binary', path: 'x.png', display: 'x.png' })).toBe('')
    expect(TurnChangesModel.decodeSummary({ error: 'gone' })).toBeUndefined()
    expect(TurnChangesModel.summaryUrl('a b', 3)).toBe('api/changes.summary?sessionId=a+b&seq=3')
    expect(TurnChangesModel.diffUrl('s', 3, 1)).toBe('api/changes.diff?sessionId=s&seq=3&index=1')
  })
})

describe('LandCardModel', () => {
  const revision = (description: string, conflict = false) => ({ description, conflict })

  it('enables Land only for described, conflict-free work of an idle thread', () => {
    const thread = { canRebase: true, behind: true, behindCount: 2, unlanded: [revision('feat: a'), revision('fix: b')] }
    expect(LandCardModel.readiness({ thread, threadBusy: false, pending: false })).toMatchObject({ canLand: true, canQueue: false, reason: undefined })
    expect(LandCardModel.readiness({ thread, threadBusy: false, pending: true }).canLand).toBe(false)
    expect(LandCardModel.behindText(thread, 'main')).toBe('Behind main by 2; Land moves this work onto its tip')
  })

  it('names the reason Land is disabled and offers queueing for a busy thread', () => {
    const busy = LandCardModel.readiness({ thread: { canRebase: true, behind: false, unlanded: [revision('feat: a')] }, threadBusy: true, pending: false })
    expect(busy).toMatchObject({ canLand: false, canQueue: true })
    expect(busy.reason).toContain('Land when idle')
    const undescribed = LandCardModel.readiness({ thread: { canRebase: true, behind: false, unlanded: [revision('  ')] }, threadBusy: false, pending: false })
    expect(undescribed).toMatchObject({ canLand: false, canQueue: false, undescribed: 1, reason: 'Describe every revision first.' })
    const conflicted = LandCardModel.readiness({ thread: { canRebase: false, behind: false, unlanded: [revision('a', true)] }, threadBusy: false, pending: false })
    expect(conflicted).toMatchObject({ canLand: false, canQueue: false, conflicts: 1, reason: 'Resolve the conflicts first.' })
    expect(LandCardModel.readiness({ thread: null, threadBusy: false, pending: false }).canLand).toBe(false)
    expect(LandCardModel.behindText({ behind: false, unlanded: [] }, 'main')).toBe('Up to date with main')
  })

  it('summarizes the latest receipt of each check', () => {
    expect(LandCardModel.checks([])).toBeUndefined()
    expect(
      LandCardModel.checks([
        { label: 'typecheck', status: 'failed', freshness: 'current' },
        { label: 'typecheck', status: 'passed', freshness: 'stale' },
        { label: 'test', status: 'passed', freshness: 'current' },
      ]),
    ).toEqual({ status: 'failed', text: 'Checks: typecheck did not pass' })
    expect(LandCardModel.checks([{ label: 'test', status: 'passed', freshness: 'current' }])).toEqual({ status: 'done', text: 'Checks passed (test)' })
  })
})

describe('ReviewedMarksModel.migrationTargets', () => {
  it('turns the old reviewed record into diff-viewed range targets', () => {
    const record = {
      [ReviewedMarksModel.keyOf('/repo/ws', 'main', 'abc123')]: ['a.ts', 'b.ts'],
      broken: ['c.ts'],
      [ReviewedMarksModel.keyOf('/repo/ws', '', 'abc123')]: ['d.ts'],
    }
    expect(ReviewedMarksModel.migrationTargets(record)).toEqual([
      { kind: 'range', workspacePath: '/repo/ws', base: 'main', head: 'abc123', path: 'a.ts' },
      { kind: 'range', workspacePath: '/repo/ws', base: 'main', head: 'abc123', path: 'b.ts' },
    ])
  })
})
