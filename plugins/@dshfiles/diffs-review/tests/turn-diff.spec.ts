import { describe, expect, it } from 'vitest'
import { TurnDiffModel } from '../src/turn-diff.js'

const SUMMARY = {
  turn: 3,
  cwd: '/work/thread',
  total: 3,
  added: 1,
  deleted: 0,
  files: [
    { path: 'docs/screenshots/hero.png', display: 'docs/screenshots/hero.png', added: 0, deleted: 0, binary: true },
    { path: 'src/app.ts', display: 'src/app.ts', added: 1, deleted: 0 },
    { path: 'dist/app.wasm', display: 'dist/app.wasm', added: 0, deleted: 0, binary: true },
  ],
}

const TEXT_DIFF = {
  kind: 'text',
  path: 'src/app.ts',
  display: 'src/app.ts',
  before: true,
  after: true,
  coarse: false,
  hunks: [{ oldStart: 1, oldLines: 0, newStart: 1, newLines: 1, lines: ['+x'] }],
}

const fetchJson = async (url: string) => (url.startsWith('api/changes.summary') ? SUMMARY : TEXT_DIFF)

describe('a turn in the Changes facet', () => {
  it('shows a changed binary image by its current version instead of dropping it', async () => {
    const diff = await TurnDiffModel.read({ sessionId: 'session-1', seq: 7, cwd: undefined, signal: new AbortController().signal, fetchJson })
    expect(diff.images).toEqual([
      {
        path: 'docs/screenshots/hero.png',
        after: { url: 'api/diffs-review.image?path=%2Fwork%2Fthread&file=docs%2Fscreenshots%2Fhero.png&revision=working-copy', label: 'Current' },
      },
    ])
    expect(diff.patch).toContain('diff --git a/src/app.ts b/src/app.ts')
    expect(diff.patch).not.toContain('hero.png')
  })

  it('falls back to the thread folder when the summary names none, and previews nothing without one', async () => {
    const { cwd: _cwd, ...withoutCwd } = SUMMARY
    const read = (cwd: string | undefined) =>
      TurnDiffModel.read({
        sessionId: 's',
        seq: 1,
        cwd,
        signal: new AbortController().signal,
        fetchJson: async url => (url.startsWith('api/changes.summary') ? withoutCwd : TEXT_DIFF),
      })
    expect((await read('/elsewhere')).images[0]?.after?.url).toContain('path=%2Felsewhere')
    expect((await read(undefined)).images).toEqual([])
  })
})
