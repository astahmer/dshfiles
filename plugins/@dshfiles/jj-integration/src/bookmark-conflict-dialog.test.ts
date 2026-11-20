import { describe, expect, it } from 'vitest'
import { keepRevisionLabel } from './bookmark-conflict-dialog.js'

describe('keepRevisionLabel', () => {
  it('asks for a revision while none is chosen', () => {
    expect(keepRevisionLabel({ bookmark: 'main', chosen: null })).toEqual({ key: 'chooseConflictRevision', values: undefined })
  })

  it('names the bookmark and the short id of the revision it will keep', () => {
    expect(keepRevisionLabel({ bookmark: 'main', chosen: 'a'.repeat(40) })).toEqual({
      key: 'keepBookmarkRevision',
      values: { bookmark: 'main', revision: 'a'.repeat(12) },
    })
  })
})
