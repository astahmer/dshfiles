import { randomUUID } from 'node:crypto'
import { chmod, lstat, mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { z } from 'zod'
import {
  hostDirectorySchema,
  hostRecordSchema,
  runtimeOriginPort,
  runtimeRecordSchema,
  type HostDirectory,
  type HostRecord,
  type RuntimeRecord,
} from './records.js'

const dataDirectory = (): string => join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'plugins', 'multi-host')
const directoryPath = (): string => join(dataDirectory(), 'directory.json')

const emptyDirectory = (): HostDirectory => ({ schemaVersion: 2, hosts: [], runtimes: [], retiredPorts: [] })

const completeRuntimePorts = (directory: HostDirectory): HostDirectory => {
  const occupied = new Set(directory.retiredPorts)
  const runtimes = [...directory.runtimes]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map(runtime => {
      const originPort = runtime.originPort ?? runtimeOriginPort(runtime.id, [...occupied])
      occupied.add(originPort)
      return { ...runtime, originPort }
    })
  return { ...directory, runtimes }
}

const secureDataPath = async (filePath: string): Promise<void> => {
  const parent = dirname(filePath)
  try {
    const parentFacts = await lstat(parent)
    if (!parentFacts.isDirectory()) throw new DirectoryStoreError('directory-path-invalid', 'The multi-host data directory is not a private directory.')
    await chmod(parent, 0o700)
  } catch (error) {
    if (error instanceof DirectoryStoreError) throw error
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return
    throw new DirectoryStoreError('directory-unreadable', 'The multi-host data directory could not be secured.')
  }
  try {
    const fileFacts = await lstat(filePath)
    if (!fileFacts.isFile()) throw new DirectoryStoreError('directory-path-invalid', 'The multi-host directory file is not a regular file.')
    await chmod(filePath, 0o600)
  } catch (error) {
    if (error instanceof DirectoryStoreError) throw error
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return
    throw new DirectoryStoreError('directory-unreadable', 'The multi-host directory file could not be secured.')
  }
}

const legacyDirectorySchema = z.object({
  schemaVersion: z.literal(1),
  hosts: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      connector: z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('local'), launchUrl: z.string().min(1) }),
        z.object({ kind: z.literal('ssh'), sshTarget: z.string().min(1), remoteHome: z.string().min(1), unit: z.string().min(1) }),
      ]),
      expected: z.object({ homeLeaf: z.string().min(1), profile: z.string().min(1) }),
      createdAt: z.string().min(10),
    }),
  ),
})

export class DirectoryStoreError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'DirectoryStoreError'
  }
}

let writeTail: Promise<void> = Promise.resolve()

export const pluginDataPath = (fileName: string): string => join(dataDirectory(), fileName)
export const runtimeHomeLeaf = (): string => basename(process.env.DSH_HOME ?? join(homedir(), '.dsh'))

const readDirectoryFromDisk = async (): Promise<HostDirectory> => {
  let raw: string
  await secureDataPath(directoryPath())
  try {
    raw = await readFile(directoryPath(), 'utf8')
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      await secureDataPath(join(dataDirectory(), 'hosts.json'))
      try {
        raw = await readFile(join(dataDirectory(), 'hosts.json'), 'utf8')
      } catch (legacyError) {
        if (legacyError instanceof Error && 'code' in legacyError && legacyError.code === 'ENOENT') return emptyDirectory()
        throw new DirectoryStoreError('directory-unreadable', 'The multi-host directory could not be read.')
      }
    } else {
      throw new DirectoryStoreError('directory-unreadable', 'The multi-host directory could not be read.')
    }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new DirectoryStoreError('directory-corrupt', 'The multi-host directory contains invalid JSON and was left untouched.')
  }

  const current = hostDirectorySchema.safeParse(parsed)
  if (current.success) return completeRuntimePorts(current.data)

  const legacy = legacyDirectorySchema.safeParse(parsed)
  if (legacy.success) {
    const hosts: HostRecord[] = []
    const runtimes: RuntimeRecord[] = []
    for (const oldHost of legacy.data.hosts) {
      hosts.push(
        hostRecordSchema.parse({
          schemaVersion: 2,
          id: oldHost.id,
          name: oldHost.name,
          connector: oldHost.connector.kind === 'local' ? { kind: 'local' } : { kind: 'ssh', sshTarget: oldHost.connector.sshTarget },
          createdAt: oldHost.createdAt,
        }),
      )
      const locator =
        oldHost.connector.kind === 'local'
          ? { kind: 'local' as const, launchUrl: oldHost.connector.launchUrl }
          : { kind: 'ssh' as const, remoteHome: oldHost.connector.remoteHome, unit: oldHost.connector.unit }
      runtimes.push(
        runtimeRecordSchema.parse({
          schemaVersion: 2,
          id: randomUUID(),
          hostId: oldHost.id,
          name: oldHost.name,
          locator,
          identity: null,
          createdAt: oldHost.createdAt,
        }),
      )
    }
    return completeRuntimePorts(hostDirectorySchema.parse({ schemaVersion: 2, hosts, runtimes }))
  }

  throw new DirectoryStoreError('directory-version-unsupported', 'The multi-host directory has an unsupported schema and was left untouched.')
}

export const readDirectory = async (): Promise<HostDirectory> => {
  await writeTail
  return readDirectoryFromDisk()
}

export const listHosts = async (): Promise<readonly HostRecord[]> => (await readDirectory()).hosts
export const listRuntimes = async (hostId?: string): Promise<readonly RuntimeRecord[]> => {
  const runtimes = (await readDirectory()).runtimes
  return hostId === undefined ? runtimes : runtimes.filter(runtime => runtime.hostId === hostId)
}

export const findHost = async (id: string): Promise<HostRecord | undefined> => (await readDirectory()).hosts.find(host => host.id === id)
export const findRuntime = async (id: string): Promise<RuntimeRecord | undefined> => (await readDirectory()).runtimes.find(runtime => runtime.id === id)

const transact = async <Result>(update: (current: HostDirectory) => { readonly next: HostDirectory; readonly result: Result }): Promise<Result> => {
  const operation = writeTail.then(async () => {
    const current = await readDirectoryFromDisk()
    const { next, result } = update(current)
    if (next !== current) await writeDirectory(next)
    return result
  })
  writeTail = operation.then(
    () => undefined,
    () => undefined,
  )
  return operation
}

export const upsertHost = async (input: HostRecord): Promise<HostRecord> => {
  const record = hostRecordSchema.parse(input)
  return transact(current => {
    const hosts = current.hosts.filter(host => host.id !== record.id)
    hosts.push(record)
    for (const runtime of current.runtimes.filter(item => item.hostId === record.id)) {
      if (runtime.locator.kind !== record.connector.kind) {
        throw new DirectoryStoreError('host-connector-in-use', 'The host connector cannot change while registered runtimes use it.')
      }
    }
    const next = hostDirectorySchema.parse({
      schemaVersion: 2,
      hosts: hosts.sort((left, right) => left.id.localeCompare(right.id)),
      runtimes: current.runtimes,
      retiredPorts: current.retiredPorts,
    })
    return { next, result: record }
  })
}

export const upsertRuntime = async (input: RuntimeRecord): Promise<RuntimeRecord> => {
  const record = runtimeRecordSchema.parse(input)
  return transact(current => {
    const host = current.hosts.find(candidate => candidate.id === record.hostId)
    if (host === undefined) throw new DirectoryStoreError('host-not-found', `No recorded host ${record.hostId}.`)
    if (host.connector.kind !== record.locator.kind)
      throw new DirectoryStoreError('connector-kind-mismatch', 'The runtime locator does not match its host connector.')
    const previous = current.runtimes.find(runtime => runtime.id === record.id)
    const normalized: RuntimeRecord = {
      ...record,
      originPort:
        record.originPort ??
        previous?.originPort ??
        runtimeOriginPort(record.id, [
          ...current.retiredPorts,
          ...current.runtimes.filter(runtime => runtime.id !== record.id).flatMap(runtime => (runtime.originPort === undefined ? [] : [runtime.originPort])),
        ]),
    }
    const runtimes = current.runtimes.filter(runtime => runtime.id !== record.id)
    runtimes.push(normalized)
    const next = hostDirectorySchema.parse({
      schemaVersion: 2,
      hosts: current.hosts,
      runtimes: runtimes.sort((left, right) => left.id.localeCompare(right.id)),
      retiredPorts: current.retiredPorts,
    })
    return { next, result: normalized }
  })
}

export const updateRuntimeLastSeen = async (id: string, lastSeenAt: string): Promise<void> => {
  await transact(current => {
    const runtime = current.runtimes.find(candidate => candidate.id === id)
    if (runtime === undefined) throw new DirectoryStoreError('runtime-not-found', `No recorded runtime ${id}.`)
    const runtimes = current.runtimes.map(candidate => (candidate.id === id ? { ...candidate, lastSeenAt } : candidate))
    const next = hostDirectorySchema.parse({ schemaVersion: 2, hosts: current.hosts, runtimes })
    return { next, result: undefined }
  })
}

export const removeRuntime = async (id: string): Promise<boolean> =>
  transact(current => {
    const removed = current.runtimes.find(runtime => runtime.id === id)
    if (removed === undefined) return { next: current, result: false }
    const retiredPorts =
      removed.originPort === undefined || current.retiredPorts.includes(removed.originPort)
        ? current.retiredPorts
        : [...current.retiredPorts, removed.originPort]
    return { next: { schemaVersion: 2, hosts: current.hosts, runtimes: current.runtimes.filter(runtime => runtime.id !== id), retiredPorts }, result: true }
  })

export const removeHost = async (id: string, removeDirectory: boolean): Promise<boolean> =>
  transact(current => {
    if (!current.hosts.some(host => host.id === id)) return { next: current, result: false }
    const runtimes = current.runtimes.filter(runtime => runtime.hostId === id)
    if (runtimes.length > 0 && !removeDirectory) {
      throw new DirectoryStoreError(
        'host-has-runtimes',
        'The host still has runtime references; use --directory-only to remove those references. Remote data is retained.',
      )
    }
    return {
      next: {
        schemaVersion: 2,
        hosts: current.hosts.filter(host => host.id !== id),
        runtimes: removeDirectory ? current.runtimes.filter(runtime => runtime.hostId !== id) : current.runtimes,
        retiredPorts: removeDirectory
          ? [...new Set([...current.retiredPorts, ...runtimes.flatMap(runtime => (runtime.originPort === undefined ? [] : [runtime.originPort]))])]
          : current.retiredPorts,
      },
      result: true,
    }
  })

const writeDirectory = async (next: HostDirectory): Promise<void> => {
  const path = directoryPath()
  const parent = dirname(path)
  await mkdir(parent, { recursive: true, mode: 0o700 })
  await chmod(parent, 0o700)
  const temporary = join(parent, `directory.${process.pid}.${randomUUID()}.tmp`)
  const body = `${JSON.stringify(next, null, 2)}\n`
  const file = await open(temporary, 'wx', 0o600)
  try {
    await file.writeFile(body, 'utf8')
    await file.sync()
  } catch {
    await file.close().catch(() => undefined)
    await rm(temporary, { force: true })
    throw new DirectoryStoreError('directory-write-failed', 'The multi-host directory could not be written to its private temporary file.')
  }
  await file.close()
  try {
    await rename(temporary, path)
    await chmod(path, 0o600)
    await rm(join(parent, 'hosts.json'), { force: true })
  } catch {
    await rm(temporary, { force: true })
    throw new DirectoryStoreError('directory-write-failed', 'The multi-host directory could not be committed atomically.')
  }
}
