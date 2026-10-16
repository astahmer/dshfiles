import { describe, expect, it } from 'vitest'
import { chatReferenceDisplay, chatReferenceFromCode, resolveChatReference } from './chat-reference.js'

describe('chat reference tokens', () => {
  const read = (value: string, bookmarks: readonly string[] = ['main', 'feature/topic-1']) => chatReferenceFromCode({ value, bookmarks })

  it('recognizes revision-shaped tokens and repository bookmark names', () => {
    expect(read('94526da8')).toEqual({ value: '94526da8', kind: 'revision' })
    expect(read('mqwtxuwwymro')).toEqual({ value: 'mqwtxuwwymro', kind: 'revision' })
    expect(read('main')).toEqual({ value: 'main', kind: 'bookmark' })
    expect(read('feature/topic-1')).toEqual({ value: 'feature/topic-1', kind: 'bookmark' })
  })

  it('never links ordinary inline code or text that is not one safe token', () => {
    expect(read('')).toBeUndefined()
    expect(read('two words')).toBeUndefined()
    expect(read('dead')).toBeUndefined()
    expect(read('pnpm')).toBeUndefined()
    expect(read('main()')).toBeUndefined()
    expect(read('release', [])).toBeUndefined()
    expect(read('  main  ')).toEqual({ value: 'main', kind: 'bookmark' })
  })

  it('treats an explicit jj: token as a reference without asking the repository', () => {
    expect(read('jj:main', [])).toEqual({ value: 'main', kind: 'bookmark' })
    expect(read('jj:release-2026.10', [])).toEqual({ value: 'release-2026.10', kind: 'bookmark' })
    expect(read('jj:94526da8', [])).toEqual({ value: '94526da8', kind: 'revision' })
    expect(read('jj:mqwtxuwwymro', [])).toEqual({ value: 'mqwtxuwwymro', kind: 'revision' })
    expect(read(' jj:main ')).toEqual({ value: 'main', kind: 'bookmark' })
    expect(read('jj:', [])).toBeUndefined()
    expect(read('jj:two words', [])).toBeUndefined()
  })

  it('reads the displayed form of a prefixed token and hides the prefix', () => {
    expect(chatReferenceFromCode({ value: 'main', bookmarks: [], prefixed: true })).toEqual({ value: 'main', kind: 'bookmark' })
    expect(chatReferenceFromCode({ value: '94526da8', bookmarks: [], prefixed: true })).toEqual({ value: '94526da8', kind: 'revision' })
    expect(chatReferenceFromCode({ value: 'release-2026.10', bookmarks: [], prefixed: true })).toEqual({ value: 'release-2026.10', kind: 'bookmark' })
    expect(chatReferenceDisplay('jj:main')).toBe('main')
    expect(chatReferenceDisplay(' jj:94526da8 ')).toBe('94526da8')
    expect(chatReferenceDisplay('main')).toBe('main')
  })

  it('resolves only a unique revision prefix or exact bookmark', () => {
    const revisions = [
      { commitId: 'a1b2c3d4', changeId: 'e5f6g7', bookmarks: ['main'], localBookmarks: ['main'] },
      { commitId: 'a1b2c3e5', changeId: 'e5f6g8', bookmarks: [], localBookmarks: [] },
    ]
    expect(resolveChatReference({ reference: { value: 'a1b2c3d4', kind: 'revision' }, revisions })).toEqual(revisions[0])
    expect(resolveChatReference({ reference: { value: 'a1b2', kind: 'revision' }, revisions })).toBeUndefined()
    expect(resolveChatReference({ reference: { value: 'main', kind: 'bookmark' }, revisions })).toEqual(revisions[0])
    expect(resolveChatReference({ reference: { value: 'missing', kind: 'bookmark' }, revisions })).toBeUndefined()
  })
})
