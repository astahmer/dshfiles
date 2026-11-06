import { describe, expect, test } from 'vitest'
import { TurnWalkthroughModel } from './turn-walkthrough-model.js'

describe('TurnWalkthroughModel.groups', () => {
  test('groups files by folder below the folder they share, in first-edit order', () => {
    const groups = TurnWalkthroughModel.groups([
      { path: '/repo/plugins/a/src/one.ts', added: 10, removed: 2 },
      { path: '/repo/plugins/a/README.md', added: 3, removed: 0 },
      { path: '/repo/plugins/a/src/two.ts', added: 1, removed: 1 },
    ])
    expect(groups.map(group => ({ directory: group.directory, files: group.files.map(file => file.name), summary: group.summary }))).toEqual([
      { directory: 'src', files: ['one.ts', 'two.ts'], summary: 'Edited 2 files · +11 −3' },
      { directory: 'a', files: ['README.md'], summary: 'Edited 1 file · +3 −0' },
    ])
    expect(groups[0]?.files.map(file => file.path)).toEqual(['/repo/plugins/a/src/one.ts', '/repo/plugins/a/src/two.ts'])
  })

  test('names a lone relative file by its root and leaves line counts out when none were counted', () => {
    expect(TurnWalkthroughModel.groups([{ path: 'notes.md', added: 0, removed: 0 }])).toEqual([
      { directory: '.', files: [{ path: 'notes.md', name: 'notes.md', added: 0, removed: 0 }], added: 0, removed: 0, summary: 'Edited 1 file' },
    ])
  })

  test('addresses the native per-turn review', () => {
    expect(TurnWalkthroughModel.changesAddress({ sessionId: 'session-a/b', seq: 42, turn: 3 })).toBe('dsh-resource://changes-review/session/session-a%2Fb/42/3')
  })
})
