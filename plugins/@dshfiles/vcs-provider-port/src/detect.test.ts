import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
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

  it('reads a folder outside any repository, or one deleted meanwhile, as jj so its errors stay unchanged', async () => {
    expect(await detect(join(root, 'missing', 'thread-abcdef'))).toEqual({ detected: undefined, kind: 'jj' })
  })
})
