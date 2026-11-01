import { randomUUID } from 'node:crypto'
import * as Schema from 'effect/Schema'
import { mkdir, open, readFile, rename } from 'node:fs/promises'
import { dirname } from 'node:path'
import { dateTimeString, decodeStrict, safeDecodeStrict } from './schema.js'
import { HostDirectoryStore } from './store.js'

/** A thread this manager started on another runtime: where it lives, so the local UI can list and reopen it. */
const remoteThreadSchema = Schema.Struct({
  runtimeId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64)),
  sessionId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
  cwd: Schema.String.check(Schema.isMaxLength(4096)),
  title: Schema.String.check(Schema.isMaxLength(512)),
  createdAt: dateTimeString,
})
const threadFileSchema = Schema.Struct({ schemaVersion: Schema.Literal(1), threads: Schema.Array(remoteThreadSchema).check(Schema.isMaxLength(1000)) })

export type RemoteThread = Schema.Schema.Type<typeof remoteThreadSchema>

const threadsPath = (): string => HostDirectoryStore.pluginDataPath('threads.json')
let writeTail: Promise<unknown> = Promise.resolve()

const readThreads = async (): Promise<RemoteThread[]> => {
  const raw = await readFile(threadsPath(), 'utf8').catch(() => undefined)
  if (raw === undefined) return []
  try {
    const parsed = safeDecodeStrict(threadFileSchema, JSON.parse(raw))
    return parsed.success ? [...parsed.data.threads] : []
  } catch {
    return []
  }
}

const writeThreads = async (threads: readonly RemoteThread[]): Promise<void> => {
  const path = threadsPath()
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  const file = await open(temporary, 'wx', 0o600)
  try {
    await file.writeFile(`${JSON.stringify({ schemaVersion: 1, threads }, null, 2)}\n`, 'utf8')
  } finally {
    await file.close()
  }
  await rename(temporary, path)
}

const update = <Result>(change: (threads: RemoteThread[]) => { readonly next: RemoteThread[]; readonly result: Result }): Promise<Result> => {
  const operation = writeTail.then(async () => {
    const { next, result } = change(await readThreads())
    await writeThreads(next.slice(-1000))
    return result
  })
  writeTail = operation.catch(() => undefined)
  return operation
}

const listRemoteThreads = async (): Promise<readonly RemoteThread[]> => {
  await writeTail
  return readThreads()
}

const recordRemoteThread = (thread: RemoteThread): Promise<RemoteThread> =>
  update(threads => ({
    next: [...threads.filter(item => !(item.runtimeId === thread.runtimeId && item.sessionId === thread.sessionId)), decodeStrict(remoteThreadSchema, thread)],
    result: thread,
  }))

const forgetRemoteThreads = (match: { readonly runtimeId: string; readonly sessionId?: string | undefined }): Promise<number> =>
  update(threads => {
    const next = threads.filter(item => item.runtimeId !== match.runtimeId || (match.sessionId !== undefined && item.sessionId !== match.sessionId))
    return { next, result: threads.length - next.length }
  })

export class RemoteThreadStore {
  static readonly list = listRemoteThreads
  static readonly record = recordRemoteThread
  static readonly forget = forgetRemoteThreads
}
