import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { pruneStores } from './index-eviction.js'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const store = (stateRoot: string, name: string, root: string | undefined) => {
  const directory = join(stateRoot, name)
  mkdirSync(directory, { recursive: true })
  if (root !== undefined) writeFileSync(join(directory, 'root.txt'), root)
  return directory
}

it('drops a store whose root is gone and keeps the rest', () => {
  const stateRoot = mkdtempSync(join(tmpdir(), 'fff-prune-'))
  roots.push(stateRoot)
  const live = mkdtempSync(join(tmpdir(), 'fff-live-'))
  roots.push(live)
  store(stateRoot, 'aaaaaaaaaaaaaaaa', live)
  store(stateRoot, 'bbbbbbbbbbbbbbbb', join(live, 'deleted-workspace'))
  store(stateRoot, 'cccccccccccccccc', undefined)

  expect(pruneStores(stateRoot)).toBe(1)
  expect(readdirSync(stateRoot).sort()).toEqual(['aaaaaaaaaaaaaaaa', 'cccccccccccccccc'])
})
