import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import { ComposerContextHost } from './composer-context-host.js'

type DirectRun = Parameters<typeof ComposerContextHost.read>[1]

const head = JSON.stringify({ changeId: 'abcdefgh', commitId: 'a'.repeat(40), bookmarks: [], empty: true, conflict: false, description: 'wip' })

/** Serve the exact outputs the composer's templates produce, including plain remote-bookmark lines. */
const fakeRun = (): DirectRun => async (_ctx, cwd, args) => {
  const joined = args.join(' ')
  if (joined === 'workspace root') return { stdout: `${cwd}\n`, truncated: false }
  if (joined.includes('changeId')) return { stdout: `${head}\n`, truncated: false }
  if (joined.includes('heads(::@- & bookmarks())')) return { stdout: '["main"]\n', truncated: false }
  if (joined.includes('remote_bookmarks()')) return { stdout: 'main@origin\ndsh-check/one@m1\n', truncated: false }
  if (joined.includes('workspace list')) return { stdout: '"default"\n', truncated: false }
  if (joined.includes('bookmark list')) return { stdout: '"main"\n', truncated: false }
  if (joined.includes(' diff ')) {
    return { stdout: joined.includes('--stat') ? '0 files changed, 0 insertions(+), 0 deletions(-)\n' : '', truncated: false }
  }
  if (joined.includes('commit_id')) return { stdout: `${'b'.repeat(40)}\n`, truncated: false }
  if (joined.includes('bookmarks(exact:"main")')) return { stdout: '["main"]\n', truncated: false }
  return { stdout: '', truncated: false }
}

describe('composer context host', () => {
  it('decodes remote bookmarks from their plain template lines', async () => {
    const result = await ComposerContextHost.read(
      { input: { cwd: process.cwd(), base: { kind: 'bookmark', name: 'main' } }, ctx: {} as never, signal: undefined },
      fakeRun(),
    )
    assert.deepEqual(result.repository?.remoteBookmarks, [
      { name: 'main', remote: 'origin' },
      { name: 'dsh-check/one', remote: 'm1' },
    ])
  })
})
