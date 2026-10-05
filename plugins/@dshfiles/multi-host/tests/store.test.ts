import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DirectoryStoreError,
  findHost,
  findRuntime,
  listHosts,
  listRuntimes,
  readDirectory,
  removeHost,
  removeRuntime,
  upsertHost,
  upsertRuntime,
} from '../src/store.js'
import type { HostRecord, RuntimeRecord } from '../src/records.js'

const directories: string[] = []
let originalDshHome: string | undefined

beforeEach(() => {
  originalDshHome = process.env.DSH_HOME
})

afterEach(async () => {
  if (originalDshHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = originalDshHome
  const owned = directories.splice(0, directories.length)
  await Promise.all(owned.map(directory => rm(directory, { recursive: true, force: true })))
})

const inHome = async (): Promise<string> => {
  const home = await mkdtemp(join(tmpdir(), 'mh-store-'))
  directories.push(home)
  process.env.DSH_HOME = home
  return home
}

const buildHost = (id: string, connector: HostRecord['connector'] = { kind: 'local' }): HostRecord => ({
  schemaVersion: 2,
  id,
  name: `host ${id}`,
  connector,
  createdAt: '2026-10-05T00:00:00.000Z',
})

const buildRuntime = (hostId: string, id = '10000000-0000-4000-8000-000000000001'): RuntimeRecord => ({
  schemaVersion: 2,
  id,
  hostId,
  name: `runtime ${id}`,
  locator: { kind: 'local', launchUrl: 'http://127.0.0.1:3199/?token=token_value-123456' },
  identity: {
    protocolVersion: 1,
    runtimeId: id,
    profile: 'probe',
    homeLeaf: 'runtime-home',
    dshVersion: '0.2.0-rc.2',
    capabilities: ['workspace', 'session', 'agent'],
  },
  createdAt: '2026-10-05T00:00:00.000Z',
})

const dataPath = (home: string, filename: string): string => join(home, 'plugins', 'multi-host', filename)

describe('multi-host directory store', () => {
  test('upsert replaces by id and lists deterministic records', async () => {
    await inHome()
    await upsertHost(buildHost('beta'))
    await upsertHost(buildHost('alpha'))
    await upsertHost({ ...buildHost('alpha'), name: 'renamed alpha' })

    await expect(listHosts()).resolves.toEqual([{ ...buildHost('alpha'), name: 'renamed alpha' }, buildHost('beta')])
    await expect(findHost('missing')).resolves.toBeUndefined()
  })

  test('serializes concurrent writes without losing hosts', async () => {
    await inHome()
    await Promise.all(Array.from({ length: 24 }, (_, index) => upsertHost(buildHost(`host-${index}`))))
    const hosts = await listHosts()
    expect(hosts).toHaveLength(24)
    expect(hosts.map(host => host.id)).toEqual([...hosts.map(host => host.id)].sort())
  })

  test('keeps a runtime browser origin port stable across directory updates', async () => {
    await inHome()
    await upsertHost(buildHost('machine'))
    const first = await upsertRuntime(buildRuntime('machine'))
    const firstPort = first.originPort
    const updated = await upsertRuntime({ ...buildRuntime('machine'), name: 'renamed runtime' })
    expect(firstPort).toBeGreaterThanOrEqual(40_000)
    expect(updated.originPort).toBe(firstPort)
  })

  test('writes a private directory and credential file atomically', async () => {
    const home = await inHome()
    await upsertHost(buildHost('local'))
    await upsertRuntime(buildRuntime('local'))

    const directoryFacts = await stat(dataPath(home, 'directory.json'))
    const parentFacts = await stat(dataPath(home, ''))
    expect(directoryFacts.mode & 0o777).toBe(0o600)
    expect(parentFacts.mode & 0o777).toBe(0o700)
    const stored = await readFile(dataPath(home, 'directory.json'), 'utf8')
    expect(stored).toContain('token_value-123456')
    await expect(readdir(dataPath(home, ''))).resolves.toEqual(['directory.json'])
    await expect(readFile(dataPath(home, 'hosts.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  test('migrates the old hosts file on the next write without losing connector data', async () => {
    const home = await inHome()
    const storePath = dataPath(home, '')
    await mkdir(storePath, { recursive: true })
    await writeFile(
      dataPath(home, 'hosts.json'),
      JSON.stringify({
        schemaVersion: 1,
        hosts: [
          {
            id: 'old-local',
            name: 'Old local',
            connector: { kind: 'local', launchUrl: 'http://127.0.0.1:3080/?token=old_token_value123' },
            expected: { homeLeaf: 'old-home', profile: 'web' },
            createdAt: '2026-10-05T00:00:00.000Z',
          },
        ],
      }),
      'utf8',
    )

    const migrated = await readDirectory()
    expect(migrated.hosts).toEqual([{ ...buildHost('old-local'), name: 'Old local' }])
    expect(migrated.runtimes).toHaveLength(1)
    const legacy = await readFile(dataPath(home, 'hosts.json'), 'utf8')
    expect(legacy).toContain('old_token_value123')

    await upsertHost(buildHost('new-local'))
    await expect(readFile(dataPath(home, 'hosts.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    const current = await readDirectory()
    expect(current.schemaVersion).toBe(2)
    expect(current.hosts.map(host => host.id)).toEqual(['new-local', 'old-local'])
  })

  test('corrupt directory stays untouched and rejects writes instead of replacing user data', async () => {
    const home = await inHome()
    await mkdir(dataPath(home, ''), { recursive: true })
    const original = '{not json\n'
    await writeFile(dataPath(home, 'directory.json'), original, 'utf8')

    await expect(listHosts()).rejects.toMatchObject({ code: 'directory-corrupt' })
    await expect(upsertHost(buildHost('late'))).rejects.toBeInstanceOf(DirectoryStoreError)
    await expect(readFile(dataPath(home, 'directory.json'), 'utf8')).resolves.toBe(original)
  })

  test('refuses host removal while runtime references remain unless directory removal is explicit', async () => {
    await inHome()
    await upsertHost(buildHost('machine'))
    await upsertRuntime(buildRuntime('machine'))

    await expect(removeHost('machine', false)).rejects.toMatchObject({ code: 'host-has-runtimes' })
    await expect(removeHost('missing', true)).resolves.toBe(false)
    await expect(removeHost('machine', true)).resolves.toBe(true)
    await expect(listHosts()).resolves.toEqual([])
    await expect(listRuntimes()).resolves.toEqual([])
  })

  test('remove and lookup target exact ids', async () => {
    await inHome()
    await upsertHost(buildHost('machine'))
    const runtime = buildRuntime('machine')
    const storedRuntime = await upsertRuntime(runtime)
    await expect(findRuntime(runtime.id)).resolves.toEqual(storedRuntime)
    await expect(removeRuntime('unknown')).resolves.toBe(false)
    await expect(removeRuntime(runtime.id)).resolves.toBe(true)
    await expect(findRuntime(runtime.id)).resolves.toBeUndefined()
  })

  test('retires browser origin ports when runtimes are removed', async () => {
    await inHome()
    await upsertHost(buildHost('machine'))
    const first = await upsertRuntime(buildRuntime('machine'))
    const firstPort = first.originPort ?? 0
    expect(firstPort).toBeGreaterThanOrEqual(40_000)
    await expect(removeRuntime(first.id)).resolves.toBe(true)
    const second = buildRuntime('machine', '20000000-0000-4000-8000-000000000001')
    await expect(upsertRuntime({ ...second, originPort: firstPort })).rejects.toThrow('Duplicate runtime origin port')
    const registered = await upsertRuntime(second)
    expect(registered.originPort).not.toBe(firstPort)
    await expect(readDirectory()).resolves.toMatchObject({ retiredPorts: [firstPort] })
  })
})
