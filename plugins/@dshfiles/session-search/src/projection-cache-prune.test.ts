import { mkdtempSync, mkdirSync, utimesSync, writeFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { pruneProjectionCache } from './projection-cache-prune.js'

const scratch = (): string => {
  const root = join(mkdtempSync(join(tmpdir(), 'projcache-')), 'sessions')
  mkdirSync(root, { recursive: true })
  return root
}

const record = (root: string, name: string, ageMs: number, now: number): void => {
  const path = join(root, name)
  writeFileSync(path, '{"version":7,"record":{}}')
  const seconds = (now - ageMs) / 1000
  utimesSync(path, seconds, seconds)
}

describe('the projection cache prune', () => {
  it('drops a record idle past the window and keeps a fresh one', () => {
    const root = scratch()
    const now = Date.now()
    record(root, 'stale.json', 20 * 24 * 60 * 60 * 1000, now)
    record(root, 'fresh.json', 60 * 60 * 1000, now)
    expect(pruneProjectionCache({ now, root })).toBe(1)
    expect(readdirSync(root)).toEqual(['fresh.json'])
  })

  it('keeps everything when the directory is missing', () => {
    expect(pruneProjectionCache({ now: Date.now(), root: join(tmpdir(), 'no-such-projcache-dir') })).toBe(0)
  })
})
