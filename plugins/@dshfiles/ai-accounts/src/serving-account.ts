import type { Context } from '@deepseek-ai/cordis'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { defineDomain } from '@deepseek-ai/dsh-storage-domain'
import {
  accountAttemptSchema,
  successfulAccountSchema,
  type AccountAttempt,
  type ServingAccountSnapshot,
  type SuccessfulAccount,
} from './serving-account-api.js'

export const SERVING_ACCOUNT_RETENTION_MS = 90 * 86_400_000
export const MAX_SERVING_ACCOUNT_SESSIONS = 2000
export const servingAccountDomain = defineDomain({
  name: 'ai_accounts_serving',
  version: 1,
  layout: 'per-record',
  invalidRecords: 'backup-and-skip',
  tables: { successful: { valueSchema: successfulAccountSchema, __key: 'sessionId' } },
})

/** Cohesive attribution policies; the service factory below owns injected storage and lifecycle. */
export class ServingAccountModel {
  static pruneKeys = (entries: Iterable<readonly [string, SuccessfulAccount]>, now: number): string[] =>
    [...entries]
      .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
      .flatMap(([key, value], index) => (index >= MAX_SERVING_ACCOUNT_SESSIONS || value.updatedAt < now - SERVING_ACCOUNT_RETENTION_MS ? [key] : []))

  /** The routing decision is not attribution until the matching main request reaches the wire. */
  static startRequest = (
    service: ServingAccountService,
    options: Pick<GenerateOptions, 'sessionId' | 'purpose' | 'provider' | 'model'>,
    active: { readonly provider: string; readonly model: string; readonly turn: number; readonly step: number } | undefined,
    accountId: string,
    actualProvider: string | undefined,
  ): AccountAttempt | undefined => {
    if (
      options.purpose !== undefined ||
      options.sessionId === undefined ||
      actualProvider === undefined ||
      active?.provider !== options.provider ||
      active.model !== options.model
    )
      return undefined
    return service.start({ sessionId: options.sessionId, accountId, provider: actualProvider, model: options.model, turn: active.turn, step: active.step })
  }

  /** Require usage and a successful terminal finish, matching pool credit semantics; failures never become last-used. */
  static async *observe(chunks: AsyncIterable<StreamChunk>, service: ServingAccountService, attempt: AccountAttempt): AsyncIterable<StreamChunk> {
    let usageSeen = false
    let finished = false
    try {
      for await (const chunk of chunks) {
        if (chunk.type === 'usage') usageSeen = true
        if (chunk.type === 'finish') {
          finished = true
          service.finish(attempt, usageSeen && chunk.reason.kind !== 'error')
        }
        yield chunk
      }
    } finally {
      if (!finished) service.finish(attempt, false)
    }
  }
}

/** Owns only routing metadata. Attempts never touch disk; writes are serialized and cannot fail inference. */
export const createServingAccountService = (ctx: Context, now: () => number = Date.now) => {
  const facility = ctx.get('storageDomain')
  // Keep the inferred domain schema instead of using the facility's diagnostic/untyped get().
  const open = () => facility?.open(servingAccountDomain)
  let domainPromise: ReturnType<typeof open>
  const domain = () => {
    domainPromise ??= open()
    return domainPromise
  }
  const attempts = new Map<string, AccountAttempt>()
  let queue = Promise.resolve()
  const enqueue = (work: () => Promise<void>) => {
    queue = queue.then(work).catch(() => ctx.logger.warn('ai-accounts: serving account metadata storage failed'))
  }
  const prune = async () => {
    const store = await domain()
    if (store === undefined) return
    for (const key of ServingAccountModel.pruneKeys(store.table('successful').entries(), now())) await store.table('successful').delete(key)
  }
  enqueue(prune)
  const start = (route: Omit<AccountAttempt, 'startedAt' | 'updatedAt' | 'status'>): AccountAttempt => {
    const at = now()
    const attempt = accountAttemptSchema.parse({ ...route, startedAt: at, updatedAt: at, status: 'attempting' })
    attempts.set(route.sessionId, attempt)
    return attempt
  }
  const finish = (attempt: AccountAttempt, succeeded: boolean): void => {
    // A late completion from a cancelled/previous step cannot overwrite a newer attempt.
    if (attempts.get(attempt.sessionId) !== attempt) return
    const updated = { ...attempt, updatedAt: now(), status: succeeded ? ('succeeded' as const) : ('failed' as const) }
    attempts.set(attempt.sessionId, updated)
    if (!succeeded) return
    const successful = successfulAccountSchema.parse(updated)
    enqueue(async () => {
      const store = await domain()
      await store?.table('successful').put(successful.sessionId, successful)
      await prune()
    })
  }
  const read = async (sessionId: string): Promise<ServingAccountSnapshot> => {
    await queue
    const store = await domain()
    const successful = store?.table('successful').get(sessionId)
    return {
      sessionId,
      currentAttempt: attempts.get(sessionId) ?? null,
      lastSuccessful: successful !== undefined && successful.updatedAt >= now() - SERVING_ACCOUNT_RETENTION_MS ? successful : null,
    }
  }
  const clear = (sessionId: string) => {
    attempts.delete(sessionId)
  }
  const forget = (sessionId: string): void => {
    attempts.delete(sessionId)
    enqueue(async () => {
      const store = await domain()
      await store?.table('successful').delete(sessionId)
    })
  }
  const close = async () => {
    attempts.clear()
    await queue
    await (await domainPromise)?.close()
  }
  return { start, finish, read, clear, forget, close }
}
export type ServingAccountService = ReturnType<typeof createServingAccountService>
