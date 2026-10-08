import { describe, expect, it } from 'vitest'
import { buildFileTree, splitFilePath } from './file-tree.ts'
import { parseGitPatch } from './patch-view.ts'
import { decodePreferences, legacyPreferences } from './preferences.ts'
import { descendantCommitIds, emptyAncestorCandidates, sourceControlGroups } from './source-control.ts'

const commit = (letter: string): string => letter.repeat(40)

const revision = (
  letter: string,
  parents: readonly string[],
  options: { workingCopy?: boolean; immutable?: boolean; empty?: boolean; description?: string } = {},
) => ({
  commitId: commit(letter),
  parents: parents.map(commit),
  workingCopy: options.workingCopy ?? false,
  immutable: options.immutable ?? false,
  empty: options.empty ?? false,
  description: options.description ?? '',
})

describe('full diff patch parsing', () => {
  it('numbers rows and counts the unmodified lines between hunks', () => {
    const patch = [
      'diff --git a/.changeset/config.json b/.changeset/config.json',
      'index 1..2 100644',
      '--- a/.changeset/config.json',
      '+++ b/.changeset/config.json',
      '@@ -8,4 +8,4 @@',
      ' ],',
      '-"linked": []',
      '+"linked": ["x"]',
      ' "access": "public",',
      '@@ -20,2 +20,3 @@',
      ' a',
      '+b',
      ' c',
      'diff --git a/dir with space/new file.txt b/dir with space/new file.txt',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/dir with space/new file.txt',
      '@@ -0,0 +1 @@',
      '+hello',
      '\\ No newline at end of file',
      'diff --git a/gone.txt b/gone.txt',
      'deleted file mode 100644',
      '--- a/gone.txt',
      '+++ /dev/null',
      '@@ -1 +0,0 @@',
      '-bye',
    ].join('\n')
    const [modified, added, deleted] = parseGitPatch(patch)
    expect(modified?.status).toBe('M')
    expect(modified?.hunks.map(hunk => hunk.unmodifiedBefore)).toEqual([7, 8])
    expect(modified?.hunks[0]?.rows.slice(1, 3)).toEqual([
      { kind: 'deletion', oldLine: 9, newLine: null, text: '"linked": []' },
      { kind: 'addition', oldLine: null, newLine: 9, text: '"linked": ["x"]' },
    ])
    expect(added).toMatchObject({ path: 'dir with space/new file.txt', status: 'A', previousPath: null })
    expect(added?.hunks[0]).toEqual({ unmodifiedBefore: 0, rows: [{ kind: 'addition', oldLine: null, newLine: 1, text: 'hello' }] })
    expect(deleted).toMatchObject({ path: 'gone.txt', status: 'D' })
  })

  it('reports renames and binary files without hunks', () => {
    const [renamed, binary] = parseGitPatch(
      [
        'diff --git a/old.ts b/new.ts',
        'similarity index 100%',
        'rename from old.ts',
        'rename to new.ts',
        'diff --git a/logo.png b/logo.png',
        'Binary files a/logo.png and b/logo.png differ',
      ].join('\n'),
    )
    expect(renamed).toMatchObject({ path: 'new.ts', previousPath: 'old.ts', status: 'R', hunks: [] })
    expect(binary).toMatchObject({ path: 'logo.png', binary: true })
  })
})

describe('changed file tree', () => {
  it('nests folders before files with descendant counts', () => {
    const tree = buildFileTree([
      { path: 'packages/b/package.json' },
      { path: 'README.md' },
      { path: 'packages/a/package.json' },
      { path: '.changeset/config.json' },
    ])
    expect(tree.map(node => [node.name, node.fileCount])).toEqual([
      ['.changeset', 1],
      ['packages', 2],
      ['README.md', 1],
    ])
    expect(tree[1]?.children.map(node => node.name)).toEqual(['a', 'b'])
    expect(splitFilePath('src/ui/button.tsx')).toEqual({ name: 'button.tsx', directory: 'src/ui' })
  })
})

describe('source control groups', () => {
  const revisions = [
    revision('d', ['c'], { workingCopy: true }),
    revision('c', ['b'], { empty: true }),
    revision('b', ['a'], { empty: true, description: 'kept placeholder' }),
    revision('a', [], { immutable: true, empty: true }),
  ]

  it('walks @ through @-N with parent and child links', () => {
    const groups = sourceControlGroups(revisions, 2)
    expect(groups.map(group => [group.depth, group.revision.commitId])).toEqual([
      [0, commit('d')],
      [1, commit('c')],
      [2, commit('b')],
    ])
    expect(groups[1]?.child?.commitId).toBe(commit('d'))
    expect(groups[1]?.parent?.commitId).toBe(commit('b'))
    expect(groups[0]?.child).toBeNull()
  })

  it('only offers undescribed mutable empty ancestors for cleanup', () => {
    expect(emptyAncestorCandidates(revisions).map(row => row.commitId)).toEqual([commit('c')])
  })

  it('moves a revision together with its descendants', () => {
    expect([...descendantCommitIds(revisions, commit('b'))].sort()).toEqual([commit('b'), commit('c'), commit('d')])
  })
})

describe('preferences', () => {
  it('keeps valid fields when another stored field is stale', () => {
    const preferences = decodePreferences({ ancestorCount: 99, fileView: 'flat', defaultView: 'source' })
    expect(preferences.ancestorCount).toBe(5)
    expect(preferences.fileView).toBe('flat')
    expect(preferences.defaultView).toBe('source')
    expect(decodePreferences(null).fileView).toBe('tree')
  })

  it('migrates only the legacy local values that differ from defaults', () => {
    expect(legacyPreferences(JSON.stringify({ mineOnly: true, fileView: 'tree', ancestorCount: 8 })).changed).toEqual(['ancestorCount', 'mineOnly'])
    expect(legacyPreferences('not json').changed).toEqual([])
    expect(legacyPreferences(null).changed).toEqual([])
  })
})
