import { describe, expect, it } from 'vitest'
import { ReferenceGraphModel } from './reference-graph.js'
import type { JjRun } from './revision-reads.js'

const COMMIT = 'a'.repeat(40)
const DEFAULT_COMMIT = 'b'.repeat(40)
const CHANGE = 'kzyxwvutsrqp'

interface Runner {
  readonly run: JjRun
  readonly calls: (readonly string[])[]
}

const runner = (): Runner => {
  const calls: (readonly string[])[] = []
  const run: JjRun = async args => {
    calls.push(args)
    if (args.join(' ').includes('separate(')) return { stdout: `${COMMIT}\n${CHANGE}\nBase fixture\n`, truncated: false }
    if (args.includes('workspace')) return { stdout: 'default\nthread-a\n', truncated: false }
    if (args.includes('default@')) return { stdout: `${DEFAULT_COMMIT}\n`, truncated: false }
    return { stdout: `${CHANGE.slice(0, 8)} > main  ${COMMIT.slice(0, 8)}\n`, truncated: false }
  }
  return { run, calls }
}

describe('reference graph', () => {
  it('brackets the reference with its neighbourhood and the landmarks a reader compares against', () => {
    const revset = ReferenceGraphModel.revset({ reference: '"main"', hasDefaultWorkspace: true })
    expect(revset).toContain('("main")')
    expect(revset).toContain('ancestors("main", 4)')
    expect(revset).toContain('descendants("main", 4)')
    expect(revset).toContain('present(main@origin)')
    expect(revset).toContain('default@')
    expect(ReferenceGraphModel.revset({ reference: '"main"', hasDefaultWorkspace: false })).not.toContain('default@')
  })

  it('marks the referenced revision and the working copy in each row', () => {
    const template = ReferenceGraphModel.template({ commitId: COMMIT, defaultCommitId: DEFAULT_COMMIT })
    expect(template).toContain(`if(commit_id.short(64) == "${COMMIT}", ">", " ")`)
    expect(template).toContain('if(current_working_copy, "@", " ")')
    expect(template).toContain('default@')
  })

  it('reads one bounded graph and reports the revision the reference resolved to', async () => {
    const { run, calls } = runner()
    const result = await ReferenceGraphModel.read({ run, reference: 'main' })

    expect(result).toMatchObject({ label: 'main', commitId: COMMIT, changeId: CHANGE, description: 'Base fixture' })
    expect(result.graph).toContain('> main')
    const graphCall = calls.at(-1) ?? []
    expect(graphCall).toContain('--ignore-working-copy')
    expect(graphCall.join(' ')).toContain('default@')
  })

  it('returns the listed rows and the revisions joining them for a lane graph', async () => {
    const elided = 'c'.repeat(40)
    const revision = (commitId: string, parents: readonly string[]) =>
      JSON.stringify({
        commitId,
        changeId: 'f'.repeat(32),
        shortestChangeId: 'kz',
        description: 'First line\nbody',
        author: 'a',
        authorTime: '2026-10-23T00:00:00Z',
        parents,
        bookmarks: [],
        localBookmarks: [],
        tags: [],
        workspaces: [],
        workingCopy: false,
        mine: true,
        immutable: false,
        divergent: false,
        empty: false,
        conflict: false,
        changeOffset: 0,
        evolved: false,
      })
    const calls: (readonly string[])[] = []
    const run: JjRun = async args => {
      calls.push(args)
      const joined = args.join(' ')
      if (joined.includes('separate(')) return { stdout: `${COMMIT}\n${CHANGE}\nBase\n`, truncated: false }
      if (args.includes('workspace')) return { stdout: 'thread-a\n', truncated: false }
      if (joined.includes('connected('))
        return { stdout: [revision(COMMIT, [elided]), revision(elided, [DEFAULT_COMMIT]), revision(DEFAULT_COMMIT, [])].join('\n'), truncated: false }
      if (joined.includes('commit_id ++ "\\n"')) return { stdout: `${COMMIT}\n${DEFAULT_COMMIT}\n`, truncated: false }
      return { stdout: '', truncated: false }
    }
    const result = await ReferenceGraphModel.read({ run, reference: 'main' })

    expect(result.listedCommitIds).toEqual([COMMIT, DEFAULT_COMMIT])
    expect(result.revisions.map(row => row.commitId)).toEqual([COMMIT, elided, DEFAULT_COMMIT])
    expect(result.revisions[0]?.description).toBe('First line')
    expect(calls.find(call => call.join(' ').includes('connected('))?.join(' ')).toContain(`connected(${COMMIT} | ${DEFAULT_COMMIT})`)
  })

  it('refuses a reference that is not a revision or a bookmark name', async () => {
    const { run } = runner()
    await expect(ReferenceGraphModel.read({ run, reference: 'main; rm -rf /' })).rejects.toThrow()
  })

  it('refuses a truncated read instead of showing a partial graph', async () => {
    const run: JjRun = async args => (args.join(' ').includes('separate(') ? { stdout: '', truncated: true } : { stdout: '', truncated: false })
    await expect(ReferenceGraphModel.read({ run, reference: 'main' })).rejects.toThrow(/bounded output limit/u)
  })
})
