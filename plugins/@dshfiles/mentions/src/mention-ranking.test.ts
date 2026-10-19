import { describe, expect, it } from 'vitest'
import { MentionRanking, type FileEntry, type ThreadEntry } from './mention-ranking.js'

const now = Date.UTC(2026, 9, 14, 12)
const minutes = (count: number): number => now - count * 60_000
const file = (path: string, hostRank: number): FileEntry => ({ kind: 'file', path, hostRank })
const thread = (title: string, updatedAt: number, sameWorkspace = true, sameProject = sameWorkspace): ThreadEntry => ({
  kind: 'thread',
  title,
  updatedAt,
  sameWorkspace,
  sameProject,
})
const names = (entries: readonly (FileEntry | ThreadEntry)[]): string[] => entries.map(MentionRanking.nameOf)

describe('MentionRanking.parseQuery', () => {
  it('reads the long and short scope prefixes and keeps what was typed', () => {
    expect(MentionRanking.parseQuery('thread:auth')).toEqual({ scope: 'thread', text: 'auth', prefix: 'thread:' })
    expect(MentionRanking.parseQuery('T:auth')).toEqual({ scope: 'thread', text: 'auth', prefix: 'T:' })
    expect(MentionRanking.parseQuery('f:src/')).toEqual({ scope: 'file', text: 'src/', prefix: 'f:' })
    expect(MentionRanking.parseQuery('file:')).toEqual({ scope: 'file', text: '', prefix: 'file:' })
    expect(MentionRanking.parseQuery('readme')).toEqual({ scope: 'all', text: 'readme', prefix: '' })
    expect(MentionRanking.parseQuery('skill:rev')).toEqual({ scope: 'skill', text: 'rev', prefix: 'skill:' })
    expect(MentionRanking.parseQuery('b:paste')).toEqual({ scope: 'backlog', text: 'paste', prefix: 'b:' })
    expect(MentionRanking.parseQuery('MCP:figma')).toEqual({ scope: 'mcp', text: 'figma', prefix: 'MCP:' })
  })
})

describe('MentionRanking.rank', () => {
  it('puts an exact thread title above a fuzzy file match', () => {
    const ranked = MentionRanking.rank({
      text: 'deploy',
      entries: [file('scripts/deploy-helpers/index.ts', 0), file('docs/d-e-p-l-o-y.md', 1), thread('Deploy', minutes(60 * 24 * 10))],
      now,
    })
    expect(names(ranked)).toEqual(['Deploy', 'index.ts', 'd-e-p-l-o-y.md'])
  })

  it('treats an exact basename stem as exact, ahead of a thread that only starts with the query', () => {
    const ranked = MentionRanking.rank({ text: 'readme', entries: [thread('readme cleanup', minutes(5)), file('README.md', 0)], now })
    expect(names(ranked)).toEqual(['README.md', 'readme cleanup'])
  })

  it('interleaves files and threads of the same tier instead of listing one kind first', () => {
    const ranked = MentionRanking.rank({
      text: '',
      entries: [file('a.ts', 0), file('b.ts', 1), file('c.ts', 2), thread('one', minutes(120)), thread('two', minutes(180))],
      now,
    })
    expect(names(ranked)).toEqual(['a.ts', 'one', 'b.ts', 'two', 'c.ts'])
  })

  it('ranks a thread from the last hour above files, and an old thread below them', () => {
    const ranked = MentionRanking.rank({
      text: '',
      entries: [file('a.ts', 0), thread('old', minutes(60 * 24 * 40)), thread('fresh', minutes(5))],
      now,
    })
    expect(names(ranked)).toEqual(['fresh', 'a.ts', 'old'])
  })

  it('breaks a recency tie by workspace, then project affinity', () => {
    const ranked = MentionRanking.rank({
      text: 'fix',
      entries: [
        thread('fix elsewhere', minutes(10), false, false),
        thread('fix sibling project', minutes(20), false, true),
        thread('fix here', minutes(30), true, true),
      ],
      now,
    })
    expect(names(ranked)).toEqual(['fix here', 'fix sibling project', 'fix elsewhere'])
  })

  it('caps the menu and ranks 500 entries in well under a frame', () => {
    const entries = [
      ...Array.from({ length: 250 }, (_, index) => file(`src/module-${index}/file-${index}.ts`, index)),
      ...Array.from({ length: 250 }, (_, index) => thread(`thread about module ${index}`, minutes(index * 7), index % 2 === 0)),
    ]
    const startedAt = performance.now()
    const ranked = MentionRanking.rank({ text: 'module-1', entries, now })
    const elapsed = performance.now() - startedAt
    expect(ranked).toHaveLength(MentionRanking.limit)
    expect(elapsed).toBeLessThan(16)
  })
})
