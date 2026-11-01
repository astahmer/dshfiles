import { randomUUID } from 'node:crypto'
import * as Schema from 'effect/Schema'
import * as Result from 'effect/Result'
import { join } from 'node:path'
import { dshHome } from './dsh-home.js'
import { JsonFile } from './json-file.js'
import { JsonText } from './json-text.js'
import { SchemaHelpers } from './schema-helpers.js'

/**
 * Why a thread needs a resume: `restart` is a managed restart that captured its
 * running Agents before exiting, `interrupted` is a turn that was still open
 * when a previous Host process stopped without that capture (a crash, a kill,
 * or a shutdown timeout).
 */
export type RecoveryReason = 'restart' | 'interrupted'

const sessionIdSchema = Schema.String.check(Schema.isMinLength(1)).check(Schema.isMaxLength(256))
const MAX_RECOVERY_ENTRIES = 5000
const DEFAULT_RECOVERY_REASON: RecoveryReason = 'restart'

const recoveryEntrySchema = SchemaHelpers.strictStruct(
  Schema.Struct({
    sessionId: sessionIdSchema,
    requestId: Schema.String.check(Schema.isUUID()),
    interruptedAt: Schema.Number.check(Schema.isFinite()).check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(0)),
    reason: SchemaHelpers.withDecodedDefault(Schema.Literals(['restart', 'interrupted']), () => DEFAULT_RECOVERY_REASON),
  }),
)

const persistedRecoverySchema = SchemaHelpers.strictStruct(
  Schema.Struct({ version: Schema.Literal(2), entries: Schema.Array(recoveryEntrySchema).check(Schema.isMaxLength(MAX_RECOVERY_ENTRIES)) }),
)

/** A v1 file predates the reason field, and every entry it holds came from a managed restart. */
const legacyRecoverySchema = SchemaHelpers.strictStruct(
  Schema.Struct({
    version: Schema.Literal(1),
    entries: Schema.Array(
      SchemaHelpers.strictStruct(
        Schema.Struct({
          sessionId: sessionIdSchema,
          requestId: Schema.String.check(Schema.isUUID()),
          interruptedAt: Schema.Number.check(Schema.isFinite()).check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(0)),
        }),
      ),
    ).check(Schema.isMaxLength(MAX_RECOVERY_ENTRIES)),
  }),
)

export type RestartRecoveryEntry = Schema.Schema.Type<typeof recoveryEntrySchema>

export interface RestartRecoveryStore {
  list(): Promise<RestartRecoveryEntry[]>
  record(sessionIds: readonly string[], reason: RecoveryReason): Promise<void>
  remove(sessionIds: ReadonlySet<string>): Promise<void>
  dismiss(sessionId: string): Promise<void>
  complete(sessionId: string): Promise<void>
}

export const activeRestartSessionIds = (agents: readonly { readonly id: string; readonly status: string }[]): string[] => [
  ...new Set(agents.filter(agent => agent.status === 'running').map(agent => agent.id)),
]

export const createRestartRecoveryStore = (
  options: { readonly home?: string; readonly now?: () => number; readonly requestId?: () => string } = {},
): RestartRecoveryStore => {
  const path = join(dshHome(options.home), 'runtime', 'thread-sidebar-recoveries.json')
  const now = options.now ?? Date.now
  const requestId = options.requestId ?? randomUUID
  const transact = JsonFile.transaction()

  const read = async (): Promise<RestartRecoveryEntry[]> => {
    const contents = await JsonFile.readText({ path, missing: '{"version":2,"entries":[]}' })
    const current = JsonText.decodeEffect(persistedRecoverySchema, contents)
    if (current === undefined) throw new Error('Restart recovery state is unreadable.')
    if (Result.isSuccess(current)) return [...current.success.entries]
    const legacy = JsonText.decodeEffect(legacyRecoverySchema, contents)
    if (legacy !== undefined && Result.isSuccess(legacy)) return legacy.success.entries.map(entry => ({ ...entry, reason: 'restart' as const }))
    throw new Error('Restart recovery state is invalid.')
  }

  const write = (entries: readonly RestartRecoveryEntry[]): Promise<void> => JsonFile.write({ path, text: `${JSON.stringify({ version: 2, entries })}\n` })

  const remove = (sessionIds: ReadonlySet<string>): Promise<void> =>
    transact(async () => {
      const entries = await read()
      const next = entries.filter(entry => !sessionIds.has(entry.sessionId))
      if (next.length !== entries.length) await write(next)
    })

  return {
    list: (): Promise<RestartRecoveryEntry[]> => transact(read),
    record: (sessionIds: readonly string[], reason: RecoveryReason): Promise<void> =>
      transact(async () => {
        const entries = await read()
        const known = new Set(entries.map(entry => entry.sessionId))
        const next = [...entries]
        for (const sessionId of new Set(sessionIds)) {
          if (sessionId.length === 0 || sessionId.length > 256 || known.has(sessionId)) continue
          next.push({ sessionId, requestId: requestId(), interruptedAt: now(), reason })
        }
        if (next.length !== entries.length) await write(next.slice(-MAX_RECOVERY_ENTRIES))
      }),
    remove,
    dismiss: (sessionId: string): Promise<void> => remove(new Set([sessionId])),
    complete: (sessionId: string): Promise<void> => remove(new Set([sessionId])),
  }
}
