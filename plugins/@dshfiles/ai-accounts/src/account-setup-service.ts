import * as Schema from 'effect/Schema'
import { AccountDraftModel } from './account-draft.js'
import { AccountConnectionMethodModel } from './account-connection-method.js'
import { AccountHomePolicy } from './account-home-policy.js'
import { joiningOf, statusOf, transition, type SetupPhase } from './account-setup-phase.js'
import {
  accountDraftSchema,
  configureAccountConnectionInputSchema,
  prepareAccountConnectionInputSchema,
  type AccountConnectionMethod,
  type ConfigureAccountConnectionInput,
  type AccountConnectionSnapshot,
  type AccountDraft,
  type AccountProfile,
  type PrepareAccountConnectionInput,
} from './api.js'
import type { AccountStorePromise } from './account-store-promise.js'
import type { CredentialValueResolver } from './credentials.js'

interface Operation {
  readonly operationId: string
  readonly requestKey: string
  readonly expiresAt: number
  readonly existing: AccountDraft | undefined
  readonly allocated: AccountDraft | undefined
  observed: AccountProfile | undefined
  method: AccountConnectionMethod
  shadowRoot: string
  readonly controller: AbortController
  draft: AccountDraft
  phase: SetupPhase
  key: string | undefined
  keyReference: string | undefined
}

export interface SetupVerificationInput {
  readonly method: AccountConnectionMethod
  readonly account: AccountProfile
  readonly shadowRoot: string
  readonly signal: AbortSignal
  readonly resolveCredential: CredentialValueResolver
}

/** Start the work one microtask later, so the operation's phase is set before the task can read it. */
const defer = <T>(run: () => Promise<T>): Promise<T> => Promise.resolve().then(run)

/** One bounded, ephemeral owner per Host. Nothing here is a saved account until commitConnection. */
export const createAccountSetupService = (input: {
  readonly store: Pick<AccountStorePromise, 'readAccountFile' | 'createSetupAccount' | 'commitConnection' | 'connectionMetadata'>
  readonly verify: (input: SetupVerificationInput) => Promise<unknown>
  readonly observeExisting?: (draft: AccountDraft) => Promise<AccountProfile | undefined>
  readonly resolveCredential: CredentialValueResolver
  readonly saveKey: (reference: string, owner: string, value: string, live: () => boolean) => Promise<void>
  readonly cleanupCandidate: (draft: AccountDraft) => Promise<void>
  readonly cancelLogin: (instanceId: string) => void
  readonly settleLogin?: (instanceId: string) => Promise<void>
  readonly adoptCredential?: (instanceId: string) => Promise<void>
  readonly onCommit: () => Promise<void>
  readonly now?: () => number
  readonly ttlMs?: number
  readonly maxOperations?: number
}) => {
  const operations = new Map<string, Operation>()
  const cancelled = new Map<string, number>()
  const reconnectOwners = new Map<string, string>()
  const preparations = new Map<string, Promise<AccountConnectionSnapshot>>()
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const cleanupTasks = new Set<Promise<void>>()
  const now = input.now ?? Date.now
  let disposed = false
  const live = (operation: Operation): boolean =>
    !disposed &&
    !operation.controller.signal.aborted &&
    operation.expiresAt > now() &&
    operation.phase.kind !== 'complete' &&
    operation.phase.kind !== 'discarded'
  const profile = (draft: AccountDraft, shadowRoot: string): AccountProfile => ({
    ...draft,
    ...input.store.connectionMetadata(draft, shadowRoot),
    signedIn: false,
    identity: null,
    plan: null,
    state: 'unconfigured',
    detail: null,
  })
  const snapshot = (operation: Operation): AccountConnectionSnapshot => {
    const status = statusOf(operation.phase)
    return {
      operationId: operation.operationId,
      instanceId: operation.draft.instanceId,
      status,
      method: operation.method,
      expiresAt: operation.expiresAt,
      account:
        status === 'discarded'
          ? null
          : {
              ...operation.observed,
              ...profile(operation.draft, operation.shadowRoot),
              identity: operation.observed?.identity ?? null,
              plan: operation.observed?.plan ?? null,
              signedIn: status === 'complete' || operation.observed?.signedIn === true,
              state: status === 'complete' ? 'healthy' : (operation.observed?.state ?? 'unconfigured'),
            },
    }
  }
  const releaseReconnect = (operation: Operation): void => {
    if (operation.existing !== undefined && reconnectOwners.get(operation.existing.instanceId) === operation.requestKey)
      reconnectOwners.delete(operation.existing.instanceId)
  }
  const cleanupResources = (operation: Operation): Promise<void> => {
    const phase = operation.phase
    if (phase.kind !== 'discarded') return Promise.resolve()
    if (phase.resourceCleanup !== undefined) return phase.resourceCleanup
    const task = (async () => {
      try {
        await input.settleLogin?.(operation.draft.instanceId)
        const allocated = operation.allocated
        const selectedOwnedDescendant =
          allocated !== undefined &&
          ((operation.draft.homePath !== allocated.homePath && AccountHomePolicy.containsConfiguredHome(allocated.homePath, operation.draft.homePath)) ||
            (operation.draft.shadowHomePath !== allocated.homePath &&
              AccountHomePolicy.containsConfiguredHome(allocated.homePath, operation.draft.shadowHomePath)))
        if (allocated !== undefined && !selectedOwnedDescendant) await input.cleanupCandidate(allocated)
      } finally {
        operation.phase = transition(operation.phase, { kind: 'cleaned' })
        releaseReconnect(operation)
      }
    })()
    operation.phase = { ...phase, resourceCleanup: task }
    return task
  }
  const cleanup = (operation: Operation): Promise<void> => {
    const phase = operation.phase
    if (phase.kind === 'discarded' && phase.cleanup !== undefined) return phase.cleanup
    const task = (async () => {
      // Join in-flight verification/commit before removing the operation's private staging.
      await joiningOf(phase)?.catch(() => undefined)
      await cleanupResources(operation)
    })()
    if (phase.kind === 'discarded') operation.phase = { ...phase, cleanup: task }
    cleanupTasks.add(task)
    void task.finally(() => cleanupTasks.delete(task)).catch(() => undefined)
    return task
  }
  const invalidate = (operation: Operation): void => {
    const discarded = transition(operation.phase, { kind: 'discard' })
    if (discarded === operation.phase) return
    // Must precede every await, including subprocess shutdown or credential cleanup.
    operation.phase = discarded
    operation.controller.abort()
    operation.key = undefined
    input.cancelLogin(operation.draft.instanceId)
    const timer = timers.get(operation.operationId)
    if (timer !== undefined) clearTimeout(timer)
    timers.delete(operation.operationId)
  }
  const get = (id: string): Operation => {
    id = id.toLowerCase()
    const operation = operations.get(id)
    if (operation === undefined) throw new Error('This account connection is no longer available. Start again.')
    if (operation.expiresAt <= now() && operation.phase.kind !== 'complete' && operation.phase.kind !== 'committing') {
      invalidate(operation)
      void cleanup(operation).catch(() => undefined)
    }
    return operation
  }
  const pending = (id: string): Operation => {
    const operation = get(id)
    if (!live(operation) || operation.phase.kind !== 'pending') throw new Error('This account connection is no longer editable.')
    return operation
  }
  const privateReference = (id: string): string => AccountDraftModel.suggestedApiKeyRef(`connection_${id.replaceAll('-', '')}`)
  const draftForMethod = (draft: AccountDraft, method: AccountConnectionMethod, id: string): AccountDraft => ({
    ...draft,
    apiKeyEnv: method === 'key' ? privateReference(id) : method === 'reference' ? draft.apiKeyEnv : '',
    ...((draft.kind === 'commandcode' || draft.kind === 'cursor' || draft.kind === 'opencode-go' || draft.kind === 'mistral') && {
      authSource: method === 'cli' ? ('cli' as const) : ('reference' as const),
    }),
  })
  const prepare = (raw: PrepareAccountConnectionInput): Promise<AccountConnectionSnapshot> => {
    const request = Schema.decodeUnknownSync(prepareAccountConnectionInputSchema)(raw)
    if (request.mode !== undefined) AccountConnectionMethodModel.assertAllowed(request.kind, request.mode)
    const requestKey = request.requestId.toLowerCase()
    const existing = preparations.get(requestKey)
    if (existing !== undefined)
      return existing.then(previous => {
        const operation = get(previous.operationId)
        if (operation.draft.kind !== request.kind || operation.existing?.instanceId !== request.existingInstanceId)
          throw new Error('This request identity belongs to another account connection.')
        return snapshot(operation)
      })
    const reservation = request.existingInstanceId
    if (reservation !== undefined) {
      const owner = reconnectOwners.get(reservation)
      if (owner !== undefined && owner !== requestKey) return Promise.reject(new Error('Another account connection is already active for this saved account.'))
      reconnectOwners.set(reservation, requestKey)
    }
    const expiresAt = now() + (input.ttlMs ?? 15 * 60_000)
    const task = (async () => {
      if (disposed) throw new Error('Account connections are unavailable.')
      // Terminal tombstones are retained until TTL; enforce a hard per-Host bound.
      for (const [id, operation] of operations)
        if (operation.expiresAt <= now() && (operation.phase.kind === 'complete' || (operation.phase.kind === 'discarded' && operation.phase.cleaned))) {
          operations.delete(id)
          preparations.delete(operation.requestKey)
        }
      for (const [id, expiry] of cancelled) if (expiry <= now() && !preparations.has(id)) cancelled.delete(id)
      const knownRequests = new Set([...preparations.keys(), ...[...operations.values()].map(operation => operation.requestKey)])
      if (knownRequests.size >= (input.maxOperations ?? 64)) throw new Error('Too many pending account connections. Close one and try again.')
      if (cancelled.has(requestKey)) throw new Error('This account connection was cancelled.')
      const file = await input.store.readAccountFile()
      const saved = request.existingInstanceId === undefined ? undefined : file.accounts.find(account => account.instanceId === request.existingInstanceId)
      if (request.existingInstanceId !== undefined && (saved === undefined || saved.kind !== request.kind))
        throw new Error('This saved account is no longer available.')
      const candidate = saved ?? (await input.store.createSetupAccount({ kind: request.kind, requestId: requestKey })).draft
      const observed = saved === undefined ? undefined : await input.observeExisting?.(saved)
      if (disposed || cancelled.has(requestKey) || now() >= expiresAt) throw new Error('Account connection cancelled or expired.')
      const method = request.mode ?? AccountConnectionMethodModel.defaultMethod(request.kind, saved)
      const draft = draftForMethod(candidate, method, requestKey)
      input.store.connectionMetadata(draft, file.shadowRoot)
      const operation: Operation = {
        operationId: requestKey,
        requestKey,
        expiresAt,
        existing: saved,
        allocated: saved === undefined ? candidate : undefined,
        observed,
        method,
        shadowRoot: file.shadowRoot,
        draft,
        phase: { kind: 'pending' },
        controller: new AbortController(),
        key: undefined,
        keyReference: undefined,
      }
      operations.set(requestKey, operation)
      const timer = setTimeout(
        () => {
          timers.delete(operation.operationId)
          if (operation.phase.kind === 'committing') return
          invalidate(operation)
          void cleanup(operation).catch(() => undefined)
        },
        Math.max(0, expiresAt - now()),
      )
      timer.unref()
      timers.set(requestKey, timer)
      return snapshot(operation)
    })()
    preparations.set(requestKey, task)
    void task.catch(() => {
      if (preparations.get(requestKey) === task) preparations.delete(requestKey)
      if (reservation !== undefined && reconnectOwners.get(reservation) === requestKey) reconnectOwners.delete(reservation)
    })
    return task
  }
  const stageKey = (id: string, value: string): AccountConnectionSnapshot => {
    const operation = pending(id)
    if (operation.method !== 'key') throw new Error('Choose the new-key connection method before staging a credential.')
    if (value.trim() === '' || value.length > 64 * 1024) throw new Error('A non-empty API key is required.')
    // Always allocate our own ref; never replace or delete the saved account's reference.
    const reference = privateReference(operation.operationId)
    operation.keyReference = reference
    operation.key = value.trim()
    operation.draft = { ...operation.draft, apiKeyEnv: reference }
    return snapshot(operation)
  }
  const complete = (id: string): Promise<AccountConnectionSnapshot> => {
    const operation = get(id)
    const phase = operation.phase
    if (phase.kind === 'complete') return Promise.resolve(snapshot(operation))
    if (phase.kind === 'verifying' || phase.kind === 'committing') return phase.completion
    if (!live(operation) || phase.kind !== 'pending')
      return Promise.reject(new Error('This account connection is no longer active or its configuration is changing.'))
    const task = defer(async () => {
      try {
        const file = await input.store.readAccountFile()
        if (!live(operation)) throw new Error('Account connection cancelled.')
        AccountConnectionMethodModel.assertAllowed(operation.draft.kind, operation.method)
        if ((operation.method === 'key' || operation.method === 'reference') && operation.draft.apiKeyEnv.trim() === '')
          throw new Error('A key reference is required for this connection method.')
        if (operation.method !== 'key' && operation.method !== 'reference' && operation.draft.apiKeyEnv !== '')
          throw new Error('This connection method does not use a key reference.')
        // Global CLI discovery is allowed only by an explicit CLI method; the verifier owns those reads.
        const account = profile(operation.draft, file.shadowRoot)
        const resolver: CredentialValueResolver = async reference =>
          reference === operation.keyReference && operation.key !== undefined ? operation.key : input.resolveCredential(reference)
        await input.verify({ method: operation.method, account, shadowRoot: file.shadowRoot, signal: operation.controller.signal, resolveCredential: resolver })
        if (!live(operation)) throw new Error('Account connection cancelled.')
        const committed = await input.store.commitConnection({
          draft: operation.draft,
          existing: operation.existing,
          beforeCommit: async () => {
            // Accepted commit runs inside the store queue, after checking latest account settings/removal.
            if (!live(operation)) throw new Error('Account connection cancelled.')
            operation.phase = transition(operation.phase, { kind: 'commit' })
            if (operation.method === 'device') await input.adoptCredential?.(operation.draft.instanceId)
            if (operation.key !== undefined && operation.keyReference !== undefined) {
              await input.saveKey(operation.keyReference, operation.operationId, operation.key, () => operation.phase.kind === 'committing')
              operation.key = undefined
            }
          },
          claimCommit: () => operation.phase.kind === 'committing',
          didCommit: () => {
            operation.phase = transition(operation.phase, { kind: 'committed' })
            releaseReconnect(operation)
          },
        })
        operation.key = undefined
        operation.draft = committed.accounts.find(account => account.instanceId === operation.draft.instanceId) ?? { ...operation.draft, enabled: true }
        if (
          operation.allocated !== undefined &&
          !AccountHomePolicy.containsConfiguredHome(operation.allocated.homePath, operation.draft.homePath) &&
          !AccountHomePolicy.containsConfiguredHome(operation.allocated.homePath, operation.draft.shadowHomePath)
        )
          await input.cleanupCandidate(operation.allocated)
        await input.onCommit()
        return snapshot(operation)
      } catch {
        // A successful atomic publication cannot be undone by a route refresh failure.
        if (operation.phase.kind === 'complete') return snapshot(operation)
        if (operation.phase.kind === 'committing') {
          operation.phase = transition(operation.phase, { kind: 'commitFailed' })
          throw new Error('Verified connection could not be saved. Retry completion; no account was published.')
        }
        invalidate(operation)
        await cleanupResources(operation)
        throw new Error('Account connection could not be verified. Start again; no account was saved.')
      }
    })
    operation.phase = transition(phase, { kind: 'verify', completion: task })
    return task
  }
  return {
    prepare,
    get: (id: string): AccountConnectionSnapshot => snapshot(get(id)),
    configure: (id: string, raw: Omit<ConfigureAccountConnectionInput, 'operationId'>): Promise<AccountConnectionSnapshot> => {
      const operation = pending(id)
      const configuration = Schema.decodeUnknownSync(configureAccountConnectionInputSchema)({ ...raw, operationId: operation.operationId })
      if (configuration.displayName !== undefined && operation.existing !== undefined) throw new Error('Edit saved account name from settings.')
      const method = configuration.mode ?? operation.method
      AccountConnectionMethodModel.assertAllowed(operation.draft.kind, method)
      if (
        (configuration.homePath !== undefined || configuration.shadowHomePath !== undefined) &&
        operation.draft.kind !== 'codex' &&
        operation.draft.kind !== 'claude'
      )
        throw new Error('This provider does not use a configured CLI home.')
      if (method === 'key' && configuration.apiKeyEnv !== undefined && configuration.apiKeyEnv !== privateReference(operation.operationId))
        throw new Error('Choose the reference method to use an existing credential reference.')
      if (method !== 'key' && method !== 'reference' && configuration.apiKeyEnv !== undefined && configuration.apiKeyEnv !== '')
        throw new Error('This connection method does not use a credential reference.')
      const methodChanged = method !== operation.method
      const base = draftForMethod(operation.draft, method, operation.operationId)
      const rebased = methodChanged && method === 'reference' ? { apiKeyEnv: operation.existing?.apiKeyEnv ?? '' } : {}
      const next = Schema.decodeUnknownSync(accountDraftSchema)({
        ...base,
        ...rebased,
        ...(configuration.displayName !== undefined && { displayName: configuration.displayName }),
        ...(configuration.homePath !== undefined && { homePath: configuration.homePath }),
        ...(configuration.shadowHomePath !== undefined && { shadowHomePath: configuration.shadowHomePath }),
        ...(configuration.apiKeyEnv !== undefined && { apiKeyEnv: configuration.apiKeyEnv }),
        ...(configuration.apiBaseUrl !== undefined && { apiBaseUrl: configuration.apiBaseUrl }),
      })
      const authChanged =
        methodChanged ||
        next.homePath !== operation.draft.homePath ||
        next.shadowHomePath !== operation.draft.shadowHomePath ||
        next.apiKeyEnv !== operation.draft.apiKeyEnv ||
        next.apiBaseUrl !== operation.draft.apiBaseUrl
      if (!authChanged) {
        // Metadata-only edits stay synchronous: preserve the active login, staged key and allocated resource ownership.
        operation.draft = { ...operation.draft, displayName: next.displayName }
        return Promise.resolve(snapshot(operation))
      }
      const keepStagedKey = !methodChanged && method === 'key' && next.apiKeyEnv === operation.keyReference
      // Exclude new login/complete/stage requests before the first await. Old login identity is invalidated synchronously.
      const task = defer(async () => {
        try {
          await input.settleLogin?.(operation.draft.instanceId)
          const file = await input.store.readAccountFile()
          if (!live(operation) || operations.get(operation.operationId) !== operation) throw new Error('Account connection cancelled during configuration.')
          input.store.connectionMetadata(next, file.shadowRoot)
          if (!keepStagedKey) {
            operation.key = undefined
            operation.keyReference = undefined
          }
          operation.observed = undefined
          operation.method = method
          operation.shadowRoot = file.shadowRoot
          operation.draft = next
          return snapshot(operation)
        } finally {
          operation.phase = transition(operation.phase, { kind: 'configured' })
        }
      })
      operation.phase = transition(operation.phase, { kind: 'configure', configuration: task })
      input.cancelLogin(operation.draft.instanceId)
      return task
    },
    stageKey,
    complete,
    discard: async (id: string): Promise<void> => {
      id = id.toLowerCase()
      // The request identity IS the operation identity, including before prepare has answered.
      if (!operations.has(id)) {
        for (const [key, expiry] of cancelled) if (expiry <= now() && !preparations.has(key)) cancelled.delete(key)
        if (cancelled.size >= (input.maxOperations ?? 64)) throw new Error('Too many cancelled connection requests.')
        cancelled.set(id, now() + (input.ttlMs ?? 15 * 60_000))
        return
      }
      const operation = get(id)
      if (operation.phase.kind === 'committing')
        throw new Error('This verified connection is already being saved; cancellation cannot undo an accepted commit.')
      if (operation.phase.kind === 'complete') throw new Error('This connection has already been saved. Remove the account explicitly instead.')
      invalidate(operation)
      await cleanup(operation)
    },
    canBeginLogin: (id: string, instanceId: string): boolean => {
      try {
        const operation = get(id)
        return operation.draft.instanceId === instanceId && live(operation) && operation.phase.kind === 'pending' && operation.method === 'device'
      } catch {
        return false
      }
    },
    candidates: (): readonly AccountDraft[] => [...operations.values()].filter(operation => live(operation)).map(operation => operation.draft),
    candidate: (id: string): AccountDraft | undefined =>
      [...operations.values()].find(operation => operation.draft.instanceId === id && live(operation))?.draft,
    dispose: (): void => {
      disposed = true
      for (const operation of operations.values()) {
        invalidate(operation)
        void cleanup(operation).catch(() => undefined)
      }
      for (const timer of timers.values()) clearTimeout(timer)
      timers.clear()
      preparations.clear()
    },
    settled: async (): Promise<void> => {
      await Promise.allSettled([...cleanupTasks])
    },
  }
}

export type AccountSetupService = ReturnType<typeof createAccountSetupService>
