import { describe, expect, it } from 'vitest'
import { ComposerContextModel, composerBaseFromSetting } from './composer-context-core.js'
import { decodePreferences } from './preferences.js'

describe('composer base setting', () => {
  it('defaults composer preferences to main while preserving configured bases', () => {
    expect(decodePreferences({}).composerBarBase).toBe('main')
    expect(decodePreferences({ composerBarBase: 'release' }).composerBarBase).toBe('release')
  })

  it('maps the settings string to a base and back', () => {
    expect(composerBaseFromSetting('parent')).toEqual({ kind: 'parent' })
    expect(composerBaseFromSetting('trunk')).toEqual({ kind: 'trunk' })
    expect(composerBaseFromSetting('feat/x')).toEqual({ kind: 'bookmark', name: 'feat/x' })
    expect(ComposerContextModel.composerBaseSetting({ kind: 'bookmark', name: 'feat/x' })).toBe('feat/x')
  })

  it('defaults to main for empty, missing or revset-injecting values', () => {
    expect(composerBaseFromSetting('')).toEqual({ kind: 'bookmark', name: 'main' })
    expect(composerBaseFromSetting(undefined)).toEqual({ kind: 'bookmark', name: 'main' })
    expect(composerBaseFromSetting('main") | all()')).toEqual({ kind: 'bookmark', name: 'main' })
  })

  it('compares the parent as the working-copy change and other bases from their fork point', () => {
    expect(ComposerContextModel.composerDiffRange({ kind: 'parent' })).toEqual(['-r', '@'])
    expect(ComposerContextModel.composerDiffRange({ kind: 'trunk' })).toEqual(['--from', 'fork_point(trunk() | @)', '--to', '@'])
    expect(ComposerContextModel.composerDiffRange({ kind: 'bookmark', name: 'feat/x' })).toEqual([
      '--from',
      'fork_point(bookmarks(exact:"feat/x") | @)',
      '--to',
      '@',
    ])
  })

  it('counts exact revisions on either side of a selected base', () => {
    expect(ComposerContextModel.revisionCountRevsets('abc123')).toEqual({ ahead: '::@ ~ ::abc123', behind: '::abc123 ~ ::@' })
    expect(ComposerContextModel.parseRevisionCount('xxx', false)).toBe(3)
    expect(ComposerContextModel.parseRevisionCount('', false)).toBe(0)
    expect(ComposerContextModel.parseRevisionCount('xx', true)).toBeNull()
    expect(ComposerContextModel.parseRevisionCount('x?x', false)).toBeNull()
    expect(ComposerContextModel.revisionSummary({ baseLabel: 'main', baseFound: true, counts: { ahead: 0, behind: 0 } })).toBe('Up to date with main')
    expect(ComposerContextModel.revisionSummary({ baseLabel: 'main', baseFound: true, counts: { ahead: 1, behind: 0 } })).toBe('1 revision ahead of main')
    expect(ComposerContextModel.revisionSummary({ baseLabel: 'main', baseFound: true, counts: { ahead: 2, behind: 1 } })).toBe(
      '2 revisions ahead of main · 1 revision behind main',
    )
    expect(ComposerContextModel.revisionSummary({ baseLabel: 'main', baseFound: false, counts: null })).toBe('main unavailable')
    expect(ComposerContextModel.revisionSummary({ baseLabel: 'main', baseFound: true, counts: null })).toBe('Revision count unavailable')
  })
})

describe('parseStatTotals', () => {
  it('reads the summary line of jj diff --stat', () => {
    const stdout = 'src/a.ts | 12 +++++++++---\nsrc/b.ts |  2 --\n2 files changed, 9 insertions(+), 5 deletions(-)\n'
    expect(ComposerContextModel.parseStatTotals(stdout)).toEqual({ files: 2, additions: 9, deletions: 5 })
  })

  it('handles singular forms and omitted counts', () => {
    expect(ComposerContextModel.parseStatTotals('a | 1 +\n1 file changed, 1 insertion(+), 0 deletions(-)')).toEqual({ files: 1, additions: 1, deletions: 0 })
    expect(ComposerContextModel.parseStatTotals('0 files changed, 0 insertions(+), 0 deletions(-)\n')).toEqual({ files: 0, additions: 0, deletions: 0 })
    expect(ComposerContextModel.parseStatTotals('a | 1 -\n1 file changed, 1 deletion(-)')).toEqual({ files: 1, additions: 0, deletions: 1 })
  })

  it('returns null without a summary line', () => {
    expect(ComposerContextModel.parseStatTotals('src/a.ts | 12 +++++++++---\n')).toBeNull()
  })
})

describe('parsePatchFileStats', () => {
  it('counts hunk lines per file, ignoring header lines that look like changes', () => {
    const patch = [
      'diff --git a/src/a.ts b/src/a.ts',
      'index 1111111..2222222 100644',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1,3 +1,3 @@',
      ' keep',
      '--- removed line that starts with dashes',
      '+++ added line that starts with pluses',
      '+added',
      'diff --git a/old.txt b/old.txt',
      'deleted file mode 100644',
      '--- a/old.txt',
      '+++ /dev/null',
      '@@ -1,2 +0,0 @@',
      '-one',
      '-two',
      'diff --git a/new file.txt b/new file.txt',
      'new file mode 100644',
      '--- /dev/null',
      '+++ "b/new file.txt"',
      '@@ -0,0 +1 @@',
      '+hello',
    ].join('\n')
    expect(ComposerContextModel.parsePatchFileStats(patch)).toEqual([
      { path: 'src/a.ts', additions: 2, deletions: 1 },
      { path: 'old.txt', additions: 0, deletions: 2 },
      { path: 'new file.txt', additions: 1, deletions: 0 },
    ])
  })
})
