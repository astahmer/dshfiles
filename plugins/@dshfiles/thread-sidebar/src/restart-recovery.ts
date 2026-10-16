import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { z } from 'zod'
import { JsonText } from './json-text.js'

const persistedRecoverySchema = z
  .object({
    version: z.literal(1),
    entries: z
      .array(
        z
          .object({
            sessionId: z.string().min(1).max(256),
            requestId: z.string().uuid(),
            interruptedAt: z.number().int().nonnegative(),
          })
          .strict(),
      )
      .max(5000),
  })
  .strict()

export type RestartRecoveryEntry = z.infer<typeof persistedRecoverySchema>['entries'][number]

const recoveryFilePath = (home: string): string => join(resolve(home), 'runtime', 'thread-sidebar-recoveries.json')

export const activeRestartSessionIds = (agents: readonly { readonly id: string; readonly status: string }[]): string[] => [
  ...new Set(agents.filter(agent => agent.status === 'running').map(agent => agent.id)),
]

export const createRestartRecoveryStore = (options: { readonly home?: string; readonly now?: () => number; readonly requestId?: () => string } = {}) => {
  const path = recoveryFilePath(options.home?.trim() || join(homedir(), '.dsh'))
  const now = options.now ?? Date.now
  const requestId = options.requestId ?? randomUUID
  let queue = Promise.resolve()

  const transact = <Value>(operation: () => Promise<Value>): Promise<Value> => {
    const next = queue.then(operation, operation)
    queue = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }

  const read = async (): Promise<RestartRecoveryEntry[]> => {
    const contents = await readFile(path, 'utf8').catch(error => {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return '{"version":1,"entries":[]}'
      throw error
    })
    const parsed = JsonText.decode(persistedRecoverySchema, contents)
    if (parsed === undefined || !parsed.success) throw new Error('Restart recovery state is invalid.')
    return parsed.data.entries
  }

  const write = async (entries: readonly RestartRecoveryEntry[]): Promise<void> => {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 })
    const temporaryPath = `${path}.${randomUUID()}.tmp`
    try {
      await writeFile(temporaryPath, `${JSON.stringify({ version: 1, entries })}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
      await rename(temporaryPath, path)
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined)
      throw error
    }
  }

  const remove = (sessionIds: ReadonlySet<string>): Promise<void> =>
    transact(async () => {
      const entries = await read()
      const next = entries.filter(entry => !sessionIds.has(entry.sessionId))
      if (next.length !== entries.length) await write(next)
    })

  return {
    list: (): Promise<RestartRecoveryEntry[]> => transact(read),
    record: (sessionIds: readonly string[]): Promise<void> =>
      transact(async () => {
        const entries = await read()
        const known = new Set(entries.map(entry => entry.sessionId))
        const next = [...entries]
        for (const sessionId of new Set(sessionIds)) {
          if (sessionId.length === 0 || sessionId.length > 256 || known.has(sessionId)) continue
          next.push({ sessionId, requestId: requestId(), interruptedAt: now() })
        }
        if (next.length !== entries.length) await write(next.slice(-5000))
      }),
    remove,
    dismiss: (sessionId: string): Promise<void> => remove(new Set([sessionId])),
    complete: (sessionId: string): Promise<void> => remove(new Set([sessionId])),
  }
}
