import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BundleWatch, type BundleRead, type BundleWatcher } from './bundle-watcher.js'

const bundleIn = (root: string, name: string): string => {
  mkdirSync(join(root, name, 'dist'), { recursive: true })
  const path = join(root, name, 'dist', 'client.js')
  writeFileSync(path, 'window.x = 1\n')
  return path
}

const recorder = () => {
  const reads: (readonly [string, BundleRead])[] = []
  let notify: (() => void) | undefined
  return {
    reads,
    onRead: (id: string, read: BundleRead) => {
      reads.push([id, read])
      notify?.()
    },
    until: (predicate: () => boolean, timeoutMs = 3_000): Promise<void> =>
      new Promise((resolve, reject) => {
        if (predicate()) return resolve()
        const timeout = setTimeout(() => reject(new Error(`timed out; reads: ${JSON.stringify(reads.map(([id, read]) => [id, read.kind]))}`)), timeoutMs)
        notify = () => {
          if (!predicate()) return
          clearTimeout(timeout)
          notify = undefined
          resolve()
        }
      }),
  }
}

let watcher: BundleWatcher | undefined
afterEach(() => watcher?.dispose())

describe('bundle watcher', () => {
  it('reads only the rewritten bundle after a directory event, without polling idle bundles', async () => {
    const root = mkdtempSync(join(tmpdir(), 'hmr-gate-watch-'))
    const a = bundleIn(root, 'a')
    const b = bundleIn(root, 'b')
    const record = recorder()
    watcher = BundleWatch.create({ onRead: record.onRead, settleMs: 20, safetyPollMs: 60_000, fallbackPollMs: 60_000 })
    watcher.sync(
      new Map([
        ['a', a],
        ['b', b],
      ]),
    )

    // FSEvents may still deliver the fixture's own writes; let them land, then require silence while idle.
    await new Promise(resolve => setTimeout(resolve, 300))
    record.reads.length = 0
    await new Promise(resolve => setTimeout(resolve, 300))
    expect(record.reads).toEqual([])

    writeFileSync(a, 'window.x = 2\n// longer\n')
    await record.until(() => record.reads.some(([id]) => id === 'a'))
    const read = record.reads.find(([id]) => id === 'a')?.[1]
    expect(read?.kind === 'stat' ? read.stat.size : -1).toBe('window.x = 2\n// longer\n'.length)
    expect(record.reads.every(([id]) => id === 'a')).toBe(true)
  })

  it('falls back to polling a removed bundle directory and resumes when a clean build recreates it', async () => {
    const root = mkdtempSync(join(tmpdir(), 'hmr-gate-watch-'))
    const a = bundleIn(root, 'a')
    const record = recorder()
    watcher = BundleWatch.create({ onRead: record.onRead, settleMs: 20, safetyPollMs: 60_000, fallbackPollMs: 50 })
    watcher.sync(new Map([['a', a]]))

    rmSync(join(root, 'a', 'dist'), { recursive: true })
    await record.until(() => record.reads.some(([, read]) => read.kind === 'error'))

    bundleIn(root, 'a')
    await record.until(() => record.reads.at(-1)?.[1].kind === 'stat')

    const before = record.reads.length
    writeFileSync(a, 'window.x = 3\n')
    await record.until(() => record.reads.length > before && record.reads.at(-1)?.[1].kind === 'stat')
  })

  it('reads every bundle on the safety poll and stops after dispose', async () => {
    const root = mkdtempSync(join(tmpdir(), 'hmr-gate-watch-'))
    const a = bundleIn(root, 'a')
    const b = bundleIn(root, 'b')
    const record = recorder()
    watcher = BundleWatch.create({ onRead: record.onRead, settleMs: 10, safetyPollMs: 60, fallbackPollMs: 60_000 })
    watcher.sync(
      new Map([
        ['a', a],
        ['b', b],
      ]),
    )
    await record.until(() => new Set(record.reads.map(([id]) => id)).size === 2)

    watcher.dispose()
    const count = record.reads.length
    await new Promise(resolve => setTimeout(resolve, 200))
    expect(record.reads.length).toBe(count)
  })
})
