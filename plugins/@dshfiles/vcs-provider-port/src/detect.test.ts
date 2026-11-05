import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { Effect, Layer } from 'effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { VcsDetector } from './detect.ts'

const detect = (target: string) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const detector = yield* VcsDetector
      return { detected: yield* detector.detect(target), kind: yield* detector.kindOf(target) }
    }).pipe(Effect.provide(VcsDetector.layer.pipe(Layer.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer))))),
  )

describe('VcsDetector', () => {
  let root: string

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'vcs-detector-')))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('prefers jj in a colocated checkout, picks git for a git-only one, and reads the nearest marker', async () => {
    mkdirSync(join(root, 'colocated', '.jj'), { recursive: true })
    mkdirSync(join(root, 'colocated', '.git'))
    mkdirSync(join(root, 'plain', '.git', 'objects'), { recursive: true })
    mkdirSync(join(root, 'plain', 'src', 'deep'), { recursive: true })
    // A git worktree's `.git` is a file pointing at the main repository.
    mkdirSync(join(root, 'worktree'))
    writeFileSync(join(root, 'worktree', '.git'), 'gitdir: ../plain/.git/worktrees/worktree\n')

    expect(await detect(join(root, 'colocated'))).toEqual({ detected: 'jj', kind: 'jj' })
    expect(await detect(join(root, 'plain', 'src', 'deep'))).toEqual({ detected: 'git', kind: 'git' })
    expect(await detect(join(root, 'worktree'))).toEqual({ detected: 'git', kind: 'git' })
  })

  it('routes a plain git worktree of a colocated jj repository to jj, but one of a git-only repository to git', async () => {
    mkdirSync(join(root, 'colocated', '.jj'), { recursive: true })
    mkdirSync(join(root, 'colocated', '.git', 'worktrees', 'side'), { recursive: true })
    writeFileSync(join(root, 'colocated', '.git', 'worktrees', 'side', 'commondir'), '../..\n')
    mkdirSync(join(root, 'side'))
    writeFileSync(join(root, 'side', '.git'), `gitdir: ${join(root, 'colocated', '.git', 'worktrees', 'side')}\n`)
    mkdirSync(join(root, 'plain', '.git', 'worktrees', 'other'), { recursive: true })
    writeFileSync(join(root, 'plain', '.git', 'worktrees', 'other', 'commondir'), '../..\n')
    mkdirSync(join(root, 'other', 'src'), { recursive: true })
    writeFileSync(join(root, 'other', '.git'), 'gitdir: ../plain/.git/worktrees/other\n')

    expect(await detect(join(root, 'side'))).toEqual({ detected: 'jj', kind: 'jj' })
    expect(await detect(join(root, 'other', 'src'))).toEqual({ detected: 'git', kind: 'git' })
  })

  it('resolves symlinks before walking, so a link into a colocated repository reads as jj', async () => {
    mkdirSync(join(root, 'colocated', '.jj'), { recursive: true })
    mkdirSync(join(root, 'colocated', '.git'))
    mkdirSync(join(root, 'colocated', 'src'))
    mkdirSync(join(root, 'elsewhere', '.git'), { recursive: true })
    symlinkSync(join(root, 'colocated', 'src'), join(root, 'elsewhere', 'link'))

    expect(await detect(join(root, 'elsewhere', 'link'))).toEqual({ detected: 'jj', kind: 'jj' })
    expect(await detect(join(root, 'elsewhere', 'link', 'not-yet-created'))).toEqual({ detected: 'jj', kind: 'jj' })
  })

  it('reads a folder outside any repository, or one deleted meanwhile, as jj so its errors stay unchanged', async () => {
    expect(await detect(join(root, 'missing', 'thread-abcdef'))).toEqual({ detected: undefined, kind: 'jj' })
  })
})
