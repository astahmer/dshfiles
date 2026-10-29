import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { References, type Reference } from './references.js'

const memoryTable = <Value>(): KvTable<string, Value> => {
  const rows = new Map<string, Value>()
  return {
    get: key => rows.get(key),
    entries: () => rows.entries(),
    keys: () => rows.keys(),
    get size() {
      return rows.size
    },
    put: async (key, value) => {
      rows.set(key, value)
    },
    delete: async key => rows.delete(key),
    update: async (key, change) => {
      const current = rows.get(key)
      if (current === undefined) throw new Error(`missing row ${key}`)
      const next = change(current)
      rows.set(key, next)
      return next
    },
  }
}

const reference = (name: string, path = `/refs/${name}`): Reference => ({
  name,
  kind: 'directory',
  source: path,
  ref: null,
  path,
  description: null,
  createdAt: 1,
})

describe('References', () => {
  it('tells a git URL from a directory and refuses a relative path', () => {
    expect(References.kindOf('https://github.com/anomalyco/opencode.git')).toBe('git')
    expect(References.kindOf('git@github.com:anomalyco/opencode.git')).toBe('git')
    expect(References.kindOf('file:///srv/repo')).toBe('git')
    expect(References.kindOf('/Users/me/docs')).toBe('directory')
    expect(References.kindOf('~/docs')).toBe('directory')
    expect(References.kindOf('docs')).toBeUndefined()
  })

  it('attaches per Session, keeps the order, and detaches everywhere when a reference is removed', async () => {
    const store = References.store({ references: memoryTable(), attachments: memoryTable() })
    await store.save(reference('docs'))
    await store.save(reference('api'))
    await store.attach('session-a', 'docs')
    await store.attach('session-a', 'api')
    await store.attach('session-a', 'docs')
    await store.attach('session-b', 'docs')

    expect(store.attached('session-a').map(entry => entry.name)).toEqual(['docs', 'api'])
    expect(store.attached('session-c')).toEqual([])

    expect(await store.remove('docs')).toBe(true)
    expect(store.attached('session-a').map(entry => entry.name)).toEqual(['api'])
    expect(store.attached('session-b')).toEqual([])
    expect(await store.detach('session-a', 'docs')).toBe(false)
    expect(await store.detach('session-a', 'api')).toBe(true)
    expect(store.list().map(entry => entry.name)).toEqual(['api'])
  })

  it('names each attached reference with its path and origin, and nothing when none is attached', () => {
    expect(References.promptText([])).toBe('')
    const text = References.promptText([
      reference('docs'),
      {
        ...reference('opencode', '/home/.dsh/references/opencode'),
        kind: 'git',
        source: 'https://github.com/anomalyco/opencode',
        ref: 'dev',
        description: 'v2 source',
      },
    ])
    expect(text).toContain('- docs: /refs/docs')
    expect(text).toContain('- opencode: /home/.dsh/references/opencode (clone of https://github.com/anomalyco/opencode at dev) — v2 source')
    expect(text).toContain('never edit them')
  })
})

describe('References.prepare against real git and folders', () => {
  let root: string

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'references-')))
  })

  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('reads a directory in place and refuses one that does not exist', async () => {
    const prepared = await References.prepare({ name: 'docs', source: root, clonesDirectory: join(root, 'clones') })
    expect(prepared).toMatchObject({ kind: 'directory', path: root, ref: null })
    expect(existsSync(join(root, 'clones'))).toBe(false)
    await expect(References.prepare({ name: 'docs', source: join(root, 'missing'), clonesDirectory: join(root, 'clones') })).rejects.toThrow(
      'is not a directory',
    )
    await expect(References.prepare({ name: 'docs', source: root, ref: 'main', clonesDirectory: join(root, 'clones') })).rejects.toThrow('Only a git reference')
  })

  it('shallow-clones a git URL at a ref into the clones directory, replacing an earlier clone', async () => {
    using recorder = recordSpans()
    const origin = join(root, 'origin')
    execFileSync('git', ['init', '-q', '-b', 'main', origin])
    writeFileSync(join(origin, 'README.md'), 'v1\n')
    execFileSync('git', ['-C', origin, 'add', '.'])
    execFileSync('git', ['-C', origin, '-c', 'user.name=T', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'v1'])
    execFileSync('git', ['-C', origin, 'branch', 'release'])

    const clones = join(root, 'clones')
    const prepared = await References.prepare({ name: 'origin', source: `file://${origin}`, ref: 'release', clonesDirectory: clones })
    expect(prepared).toMatchObject({ kind: 'git', ref: 'release', path: join(clones, 'origin') })
    expect(readFileSync(join(clones, 'origin', 'README.md'), 'utf8')).toBe('v1\n')
    expect(recorder.span('git clone').status.code).not.toBe('error')

    await expect(References.prepare({ name: 'origin', source: `file://${origin}`, ref: 'missing', clonesDirectory: clones })).rejects.toThrow(
      'git clone failed',
    )
  })
})
