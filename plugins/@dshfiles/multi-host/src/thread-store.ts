import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename } from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod'
import { pluginDataPath } from './store.js'

/** A thread this manager started on another runtime: where it lives, so the local UI can list and reopen it. */
const remoteThreadSchema = z
  .object({
    runtimeId: z.string().min(1).max(64),
    sessionId: z.string().min(1).max(256),
    cwd: z.string().max(4096),
    title: z.string().max(512),
    createdAt: z.string().datetime(),
  })
  .strict()
const threadFileSchema = z.object({ schemaVersion: z.literal(1), threads: z.array(remoteThreadSchema).max(1000) }).strict()

export type RemoteThread = z.infer<typeof remoteThreadSchema>

const threadsPath = (): string => pluginDataPath('threads.json')
let writeTail: Promise<unknown> = Promise.resolve()

const readThreads = async (): Promise<RemoteThread[]> => {
  const raw = await readFile(threadsPath(), 'utf8').catch(() => undefined)
  if (raw === undefined) return []
  try {
    const parsed = threadFileSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data.threads : []
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

export const listRemoteThreads = async (): Promise<readonly RemoteThread[]> => {
  await writeTail
  return readThreads()
}

export const recordRemoteThread = (thread: RemoteThread): Promise<RemoteThread> =>
  update(threads => ({
    next: [...threads.filter(item => !(item.runtimeId === thread.runtimeId && item.sessionId === thread.sessionId)), remoteThreadSchema.parse(thread)],
    result: thread,
  }))

export const forgetRemoteThreads = (match: { readonly runtimeId: string; readonly sessionId?: string }): Promise<number> =>
  update(threads => {
    const next = threads.filter(item => item.runtimeId !== match.runtimeId || (match.sessionId !== undefined && item.sessionId !== match.sessionId))
    return { next, result: threads.length - next.length }
  })
