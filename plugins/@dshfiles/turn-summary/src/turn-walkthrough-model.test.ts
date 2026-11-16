import { describe, expect, test } from 'vitest'
import { TurnWalkthroughModel } from './turn-walkthrough-model.js'

describe('TurnWalkthroughModel.groups', () => {
  test('groups files by folder below the folder they share, in first-edit order', () => {
    const groups = TurnWalkthroughModel.groups([
      { path: '/repo/plugins/a/src/one.ts', added: 10, removed: 2 },
      { path: '/repo/plugins/a/README.md', added: 3, removed: 0 },
      { path: '/repo/plugins/a/src/two.ts', added: 1, removed: 1 },
    ])
    expect(
      groups.map(group => ({
        directory: group.directory,
        files: group.files.map(file => ({ path: file.path, fullPath: file.fullPath })),
        summary: group.summary,
      })),
    ).toEqual([
      {
        directory: 'src',
        files: [
          { path: 'one.ts', fullPath: '/repo/plugins/a/src/one.ts' },
          { path: 'two.ts', fullPath: '/repo/plugins/a/src/two.ts' },
        ],
        summary: '+11 −3',
      },
      { directory: 'a', files: [{ path: 'README.md', fullPath: '/repo/plugins/a/README.md' }], summary: '' },
    ])
  })

  test('names a lone relative file by its root and leaves line counts out when none were counted', () => {
    expect(TurnWalkthroughModel.groups([{ path: 'notes.md', added: 0, removed: 0 }])).toEqual([
      { directory: '.', files: [{ path: 'notes.md', fullPath: 'notes.md', added: 0, removed: 0 }], added: 0, removed: 0, summary: '' },
    ])
  })

  test('never restates the file count the card header and the chips already give', () => {
    const groups = TurnWalkthroughModel.groups([
      { path: 'src/auth/session.ts', added: 5, removed: 3 },
      { path: 'tests/session.test.ts', added: 5, removed: 0 },
    ])
    expect(groups.map(group => group.summary)).toEqual(['', ''])
    for (const group of groups) expect(group.summary).not.toMatch(/Edited|file/)
  })

  test('is offered only where it says more than the file chips', () => {
    const file = (path: string) => ({ path, added: 1, removed: 0 })
    // One file, or a few files of one folder: the chips already say all of it.
    expect(TurnWalkthroughModel.addsDetail([file('notes/walkthrough.md')], 4)).toBe(false)
    expect(TurnWalkthroughModel.addsDetail([file('src/a.ts'), file('src/b.ts')], 4)).toBe(false)
    // Several folders, or more files than there are chips.
    expect(TurnWalkthroughModel.addsDetail([file('src/auth/session.ts'), file('tests/session.test.ts')], 4)).toBe(true)
    expect(
      TurnWalkthroughModel.addsDetail(
        ['a', 'b', 'c', 'd', 'e'].map(name => file(`src/${name}.ts`)),
        4,
      ),
    ).toBe(true)
  })

  test('addresses the native per-turn review', () => {
    expect(TurnWalkthroughModel.changesAddress({ sessionId: 'session-a/b', seq: 42, turn: 3 })).toBe('dsh-resource://changes-review/session/session-a%2Fb/42/3')
  })
})
