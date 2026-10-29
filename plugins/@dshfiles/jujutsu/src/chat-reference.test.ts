import { QueryClient } from '@dshfiles/plugin-ui/query'
import { describe, expect, it } from 'vitest'
import { ChatReferenceModel, chatReferenceQueryKeys } from './chat-reference.js'

describe('chat reference tokens', () => {
  const read = (value: string, bookmarks: readonly string[] = ['main', 'feature/topic-1']) => ChatReferenceModel.fromCode({ value, bookmarks })

  it('keeps local-title and full-preview query identities separate', () => {
    const preview = { cwd: '/repo', reference: { value: 'main' }, anchor: { left: 0, top: 0, width: 1, height: 1 } }
    const title = { sessionId: 'session-a', cwd: '/repo', reference: { value: 'main' } }

    expect(chatReferenceQueryKeys.localTitle(preview.cwd, preview.reference.value)).toEqual(chatReferenceQueryKeys.localTitle(title.cwd, title.reference.value))
    expect(chatReferenceQueryKeys.localTitle('/repo', 'main')).not.toEqual(chatReferenceQueryKeys.search('/repo', 'main'))
    expect(chatReferenceQueryKeys.localTitle('/repo', 'main')).not.toEqual(chatReferenceQueryKeys.localTitle('/other', 'main'))
    expect(chatReferenceQueryKeys.localTitle('/repo', 'main')).not.toEqual(chatReferenceQueryKeys.localTitle('/repo', 'release'))
  })

  it('keys a repository batch by its path set, not its order', () => {
    expect(chatReferenceQueryKeys.repositories(['/a', '/b'])).toEqual(chatReferenceQueryKeys.repositories(['/b', '/a']))
    expect(chatReferenceQueryKeys.repositories(['/a', '/b'])).not.toEqual(chatReferenceQueryKeys.repositories(['/a']))
  })

  it('deduplicates local-title reads and caches repository registration', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    let localTitleCalls = 0
    let searchCalls = 0
    let registrationCalls = 0
    const title = await queryClient.fetchQuery({
      queryKey: chatReferenceQueryKeys.localTitle('/repo', 'main'),
      queryFn: async () => {
        localTitleCalls += 1
        return 'graph'
      },
      staleTime: 30_000,
    })
    const repeatedTitle = await queryClient.fetchQuery({
      queryKey: chatReferenceQueryKeys.localTitle('/repo', 'main'),
      queryFn: async () => {
        localTitleCalls += 1
        return 'graph'
      },
      staleTime: 30_000,
    })
    await queryClient.fetchQuery({
      queryKey: chatReferenceQueryKeys.search('/repo', 'main'),
      queryFn: async () => {
        searchCalls += 1
        return [title]
      },
      staleTime: 30_000,
    })
    await queryClient.fetchQuery({
      queryKey: chatReferenceQueryKeys.repository('/repo'),
      queryFn: async () => {
        registrationCalls += 1
        return { repoId: 'repo', root: '/repo' }
      },
      staleTime: 30_000,
    })
    await queryClient.fetchQuery({
      queryKey: chatReferenceQueryKeys.repository('/repo'),
      queryFn: async () => {
        registrationCalls += 1
        return { repoId: 'repo', root: '/repo' }
      },
      staleTime: 30_000,
    })

    expect(repeatedTitle).toBe(title)
    expect(localTitleCalls).toBe(1)
    expect(searchCalls).toBe(1)
    expect(registrationCalls).toBe(1)
    queryClient.clear()
  })

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
    expect(ChatReferenceModel.fromCode({ value: 'main', bookmarks: [], prefixed: true })).toEqual({ value: 'main', kind: 'bookmark' })
    expect(ChatReferenceModel.fromCode({ value: '94526da8', bookmarks: [], prefixed: true })).toEqual({ value: '94526da8', kind: 'revision' })
    expect(ChatReferenceModel.fromCode({ value: 'release-2026.10', bookmarks: [], prefixed: true })).toEqual({ value: 'release-2026.10', kind: 'bookmark' })
    expect(ChatReferenceModel.display('jj:main')).toBe('main')
    expect(ChatReferenceModel.display(' jj:94526da8 ')).toBe('94526da8')
    expect(ChatReferenceModel.display('main')).toBe('main')
  })

  it('normalizes and truncates revision descriptions for chat link labels', () => {
    expect(ChatReferenceModel.titleLabel({ title: '  Fix  stale\nworkspaces  ', fallback: 'main' })).toBe('Fix stale workspaces')
    expect(ChatReferenceModel.titleLabel({ title: ' '.repeat(4), fallback: 'main' })).toBe('main')
    const title = ChatReferenceModel.titleLabel({ title: 'a'.repeat(80), fallback: 'main' })
    expect(title).toHaveLength(52)
    expect(title.endsWith('…')).toBe(true)
    expect(ChatReferenceModel.titleLabel({ title: `${'a'.repeat(50)}🦖ending`, fallback: 'main' })).toBe(`${'a'.repeat(50)}🦖…`)
  })

  it('selects a repository match only when there is exactly one', () => {
    const local = { root: '/repo-a' }
    const foreign = { root: '/repo-b' }
    expect(ChatReferenceModel.uniqueMatch([])).toBeUndefined()
    expect(ChatReferenceModel.uniqueMatch([foreign])).toBe(foreign)
    expect(ChatReferenceModel.uniqueMatch([local, foreign])).toBeUndefined()
  })

  it('resolves only a unique revision prefix or exact bookmark', () => {
    const revisions = [
      { commitId: 'a1b2c3d4', changeId: 'e5f6g7', bookmarks: ['main'], localBookmarks: ['main'] },
      { commitId: 'a1b2c3e5', changeId: 'e5f6g8', bookmarks: [], localBookmarks: [] },
    ]
    expect(ChatReferenceModel.resolve({ reference: { value: 'a1b2c3d4', kind: 'revision' }, revisions })).toEqual(revisions[0])
    expect(ChatReferenceModel.resolve({ reference: { value: 'a1b2', kind: 'revision' }, revisions })).toBeUndefined()
    expect(ChatReferenceModel.resolve({ reference: { value: 'main', kind: 'bookmark' }, revisions })).toEqual(revisions[0])
    expect(ChatReferenceModel.resolve({ reference: { value: 'missing', kind: 'bookmark' }, revisions })).toBeUndefined()
  })
})
