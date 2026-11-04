import { Context, Effect, FileSystem, Layer, Option, Path, Schema, Semaphore, SubscriptionRef } from 'effect'
import { join } from 'node:path'
import { accountDraftSchema, accountsFileSchema, type AccountDraft, type AccountOrderDirection, type AccountProfile, type AccountsFile } from './api.js'

import { AiAccountsSchema } from './effect-schema.js'
import { CodexHomeModel, describeCodexAuth, materializeCodexShadowHome, CodexHomeError } from './codex-home.js'
import { DEFAULT_DISTRIBUTION, type AccountStatus } from './account-pool.js'
import { CredentialModel, type CredentialValueResolver } from './credentials.js'
import { KIND_LABEL } from './account-labels.js'
import { ClaudeAccountModel, claudeAccountService } from './claude-account.js'
import { DEFAULT_COMMANDCODE_KEY_ENV } from './commandcode-provider.js'
import { readCommandCodeKey } from './commandcode-usage.js'
import { CURSOR_LOGIN_HINT, readCursorToken } from './cursor-account.js'
import { MISTRAL_LOGIN_HINT, MistralAccountModel } from './mistral-account.js'
import { AccountOrderModel } from './account-order-model.js'
import { type AccountReorder, type CreateSetupAccountInput } from './api.js'
import { AccountConflict, AccountOrderRejected, AccountStoreWriteFailed } from './errors.js'
import { AccountDraftModel } from './account-draft.js'
import { AccountHomePolicy } from './account-home-policy.js'

/**
 * Account profiles on disk.
 *
 * Profiles live in their own file rather than the profile patch: the page edits
 * them constantly, and a JSON document keeps account state out of the reviewed
 * patch while the route that serves models stays declarative there. Only account
 * *identity and layout* is stored — never a token, and never `auth.json` content,
 * which stays inside each Codex home where its owner put it.
 */

const DEFAULT_SHADOW_ROOT = join(CodexHomeModel.accountHome(), '.codex-dshx')

/** Stored shape: only what a user may author or toggle. */
export interface AccountStoreFile {
  readonly distribution: AccountsFile['distribution']
  readonly cooldownMs: number
  readonly shadowRoot: string
  readonly accounts: readonly AccountDraft[]
}

const emptyFile = (): AccountStoreFile => ({
  distribution: DEFAULT_DISTRIBUTION,
  cooldownMs: 300_000,
  shadowRoot: DEFAULT_SHADOW_ROOT,
  accounts: [],
})

/** The store schema: drafts on disk, observed fields added on read. */
const storeFileSchema = Schema.Struct({
  ...accountsFileSchema.fields,
  accounts: AiAccountsSchema.list(accountDraftSchema, 64),
})

const layoutFor = (profile: AccountDraft, file: AccountStoreFile) => AccountHomePolicy.codexLayoutFor(profile, file.shadowRoot)

const defaultName = (draft: AccountDraft): string =>
  draft.displayName.trim().length > 0 ? draft.displayName.trim() : `${KIND_LABEL[draft.kind]} (${draft.instanceId})`

const profileState = (facts: { readonly enabled: boolean; readonly cooling: boolean; readonly signedIn: boolean }): AccountProfile['state'] => {
  if (!facts.enabled) return 'disabled'
  if (facts.cooling) return 'cooling'
  return facts.signedIn ? 'healthy' : 'unconfigured'
}

const observed = (
  draft: AccountDraft,
  facts: Pick<AccountProfile, 'signedIn' | 'identity' | 'plan' | 'loginHint' | 'detail'> & { readonly cooling: boolean },
): AccountProfile => ({
  ...draft,
  displayName: defaultName(draft),
  mode: 'direct',
  signedIn: facts.signedIn,
  identity: facts.identity,
  plan: facts.plan,
  state: profileState({ enabled: draft.enabled, cooling: facts.cooling, signedIn: facts.signedIn }),
  loginHint: facts.loginHint,
  detail: facts.detail,
})

/**
 * Observed fields for one stored profile: whether it holds a login, the identity
 * it presents, and how its Codex home is arranged. Never a credential.
 */
const observe = async (
  draft: AccountDraft,
  file: AccountStoreFile,
  status: AccountStatus | undefined,
  resolveCredential?: CredentialValueResolver,
  isCopilotSignedIn?: (instanceId: string) => Promise<boolean>,
): Promise<AccountProfile> => {
  const cooling = status?.state === 'cooling'
  const resolveKey = async (name: string): Promise<string> => (resolveCredential === undefined ? CredentialModel.readKeyFromEnv(name) : resolveCredential(name))
  if (draft.kind === 'opencode-go') {
    const hasKey = (await resolveKey(draft.apiKeyEnv)).length > 0
    return observed(draft, {
      cooling,
      signedIn: hasKey,
      identity: null,
      plan: null,
      loginHint:
        draft.apiKeyEnv.trim().length > 0
          ? `Export ${draft.apiKeyEnv.trim()} before using this account.`
          : 'Set an API key environment variable for this account.',
      detail: null,
    })
  }
  if (draft.kind === 'commandcode') {
    const hasKey = (await readCommandCodeKey(draft.apiKeyEnv, resolveCredential, draft.authSource)).length > 0
    return observed(draft, {
      cooling,
      signedIn: hasKey,
      identity: null,
      plan: null,
      loginHint: `cmd login   # or export ${draft.apiKeyEnv.trim() === '' ? DEFAULT_COMMANDCODE_KEY_ENV : draft.apiKeyEnv.trim()}`,
      detail: null,
    })
  }
  if (draft.kind === 'mistral') {
    const hasKey = (await MistralAccountModel.readKey(draft.apiKeyEnv, resolveCredential, draft.authSource)).length > 0
    return observed(draft, {
      cooling,
      signedIn: hasKey,
      identity: null,
      plan: null,
      loginHint: MISTRAL_LOGIN_HINT,
      detail: null,
    })
  }
  if (draft.kind === 'claude') {
    const configDir = ClaudeAccountModel.resolveClaudeConfigDir(draft.homePath)
    const auth = await claudeAccountService.describeAuth({ configDir, keyEnv: draft.apiKeyEnv, now: Date.now(), resolveCredential })
    return observed(draft, {
      cooling,
      signedIn: auth.signedIn,
      identity: auth.identity ?? null,
      plan: auth.plan ?? null,
      loginHint: ClaudeAccountModel.claudeLoginHint(configDir),
      detail: auth.detail ?? null,
    })
  }
  if (draft.kind === 'github-copilot') {
    const signedIn = await (isCopilotSignedIn?.(draft.instanceId) ?? Promise.resolve(false))
    return observed(draft, {
      cooling,
      signedIn,
      identity: null,
      plan: null,
      loginHint: 'Sign in with GitHub to connect Copilot.',
      detail: null,
    })
  }
  if (draft.kind === 'cursor') {
    const token = await readCursorToken(draft.apiKeyEnv, resolveCredential, draft.authSource)
    return observed(draft, {
      cooling: false,
      signedIn: token !== undefined,
      identity: null,
      plan: null,
      loginHint: CURSOR_LOGIN_HINT,
      detail: 'Cursor sessions run through the Cursor Agent runtime; this account tracks identity and quota only.',
    })
  }

  let layout
  try {
    layout = layoutFor(draft, file)
  } catch (error) {
    if (!(error instanceof CodexHomeError)) throw error
    return {
      ...draft,
      displayName: defaultName(draft),
      mode: 'direct',
      signedIn: false,
      identity: null,
      plan: null,
      state: draft.enabled ? 'unconfigured' : 'disabled',
      loginHint: '',
      detail: error.message,
    }
  }
  let auth
  try {
    auth = await describeCodexAuth(layout)
  } catch (error) {
    auth = { signedIn: false, identity: undefined, plan: undefined, error: String(error) }
  }
  return {
    ...draft,
    displayName: defaultName(draft),
    mode: layout.mode,
    signedIn: auth.signedIn,
    identity: auth.identity ?? null,
    plan: auth.plan ?? null,
    state: profileState({ enabled: draft.enabled, cooling, signedIn: auth.signedIn }),
    loginHint: CodexHomeModel.loginHint(layout),
    detail: auth.error ?? null,
  }
}

/** The page and tool share profiles joined with live health and login state. */
const buildAccountsFile = async (
  file: AccountStoreFile,
  statuses: readonly AccountStatus[],
  resolveCredential?: CredentialValueResolver,
  isCopilotSignedIn?: (instanceId: string) => Promise<boolean>,
): Promise<AccountsFile> => ({
  ...file,
  accounts: await Promise.all(
    file.accounts.map(async draft => {
      const status = statuses.find(candidate => candidate.id === draft.instanceId)
      return observe(draft, file, status, resolveCredential, isCopilotSignedIn)
    }),
  ),
})

/** Reuse the established home rules without materializing, copying or reading authentication. */
const connectionMetadata = (draft: AccountDraft, shadowRoot: string): Pick<AccountProfile, 'mode' | 'loginHint'> => {
  if (draft.kind === 'codex') {
    const layout = AccountHomePolicy.codexLayoutFor(draft, shadowRoot)
    return { mode: layout.mode, loginHint: CodexHomeModel.loginHint(layout) }
  }
  if (draft.kind === 'claude')
    return { mode: 'direct', loginHint: ClaudeAccountModel.claudeLoginHint(ClaudeAccountModel.resolveClaudeConfigDir(draft.homePath)) }
  return {
    mode: 'direct',
    loginHint: draft.kind === 'commandcode' ? 'cmd login' : draft.kind === 'cursor' ? CURSOR_LOGIN_HINT : draft.kind === 'mistral' ? MISTRAL_LOGIN_HINT : '',
  }
}

/**
 * Creating the shadow home first lets Codex write auth data into the home
 * when users follow the login command shown by the page.
 */
const readAccountIdentity = async (
  file: AccountStoreFile,
  instanceId: string,
): Promise<{ readonly instanceId: string; readonly email: string | null; readonly plan: string | null; readonly signedIn: boolean }> => {
  const draft = file.accounts.find(account => account.instanceId === instanceId)
  if (draft === undefined || draft.kind !== 'codex') return { instanceId, email: null, plan: null, signedIn: false }
  const layout = layoutFor(draft, file)
  await materializeCodexShadowHome(layout).catch(() => undefined)
  const auth = await describeCodexAuth(layout)
  return { instanceId, email: auth.identity ?? null, plan: auth.plan ?? null, signedIn: auth.signedIn }
}

/** Reads of the stored profiles that observe homes and credentials but never write the accounts file. */
export class AccountProfilesModel {
  static readonly buildAccountsFile = buildAccountsFile
  static readonly connectionMetadata = connectionMetadata
  static readonly readAccountIdentity = readAccountIdentity
  static readonly layoutFor = layoutFor
}

const decodeStoreText = Schema.decodeUnknownOption(Schema.fromJsonString(storeFileSchema))
const validateStoreFile = Schema.decodeUnknownEffect(storeFileSchema)

export interface ConnectionCommit {
  readonly draft: AccountDraft
  readonly existing: AccountDraft | undefined
  readonly claimCommit: () => boolean
  readonly didCommit: () => void
  readonly beforeCommit?: Effect.Effect<void>
}

const sameConnection = (current: AccountDraft, existing: AccountDraft): boolean =>
  current.kind === existing.kind &&
  current.homePath === existing.homePath &&
  current.shadowHomePath === existing.shadowHomePath &&
  current.apiKeyEnv === existing.apiKeyEnv &&
  current.authSource === existing.authSource &&
  current.apiBaseUrl === existing.apiBaseUrl

const committedProfile = (current: AccountDraft, draft: AccountDraft): AccountDraft => {
  const { authSource: _currentAuthSource, ...currentWithoutAuthSource } = current
  // Optional ownership must be absent, not an own undefined: the committed
  // profile is returned over the strict JSON API before any disk round-trip.
  const committed: AccountDraft = {
    ...currentWithoutAuthSource,
    enabled: true,
    homePath: draft.homePath,
    shadowHomePath: draft.shadowHomePath,
    apiKeyEnv: draft.apiKeyEnv,
    apiBaseUrl: draft.apiBaseUrl,
  }
  return draft.authSource === undefined ? committed : { ...committed, authSource: draft.authSource }
}

const reorderedAccounts = (file: AccountStoreFile, input: AccountReorder) => {
  const rejection = AccountOrderModel.rejection(file.accounts, input)
  return rejection === undefined
    ? Effect.succeed(AccountOrderModel.reorder(file.accounts, input))
    : Effect.fail(new AccountOrderRejected({ reason: rejection }))
}

/**
 * The accounts file: one in-memory snapshot read at activation, every edit a serialized read-modify-write that
 * publishes atomically (temporary file, owner-only mode, rename) and then updates the snapshot.
 */
export class AccountStore extends Context.Service<
  AccountStore,
  {
    readonly filePath: string
    /** The file as last read or written; synchronous Cordis hooks read it with `SubscriptionRef.getUnsafe`. */
    readonly snapshot: SubscriptionRef.SubscriptionRef<AccountStoreFile>
    /** Re-read the file so external edits count; missing or unreadable storage yields defaults. */
    readonly read: Effect.Effect<AccountStoreFile>
    readonly write: (next: AccountStoreFile) => Effect.Effect<AccountStoreFile, AccountStoreWriteFailed>
    readonly upsertAccount: (
      draft: AccountDraft,
      previousInstanceId?: string,
      requireExisting?: boolean,
    ) => Effect.Effect<AccountStoreFile, AccountConflict | AccountStoreWriteFailed>
    readonly removeAccount: (instanceId: string) => Effect.Effect<AccountStoreFile, AccountStoreWriteFailed>
    readonly moveAccount: (instanceId: string, direction: AccountOrderDirection) => Effect.Effect<AccountStoreFile, AccountConflict | AccountStoreWriteFailed>
    readonly reorderAccount: (input: AccountReorder) => Effect.Effect<AccountStoreFile, AccountOrderRejected | AccountStoreWriteFailed>
    readonly setDistribution: (distribution: AccountsFile['distribution']) => Effect.Effect<AccountStoreFile, AccountStoreWriteFailed>
    /** Allocate metadata only. The Host lifecycle, not the durable store, owns unconnected candidates. */
    readonly createSetupAccount: (
      input: CreateSetupAccountInput,
    ) => Effect.Effect<{ readonly instanceId: string; readonly draft: AccountDraft; readonly file: AccountStoreFile }, AccountConflict>
    /** Publish a verified operation once, under the same lock as every settings write. */
    readonly commitConnection: (input: ConnectionCommit) => Effect.Effect<AccountStoreFile, AccountConflict | AccountStoreWriteFailed>
  }
>()('@dshfiles/ai-accounts/AccountStore') {
  static readonly makeAt = Effect.fn('ai accounts store open')(function* (filePath: string) {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const lock = yield* Semaphore.make(1)

    const readFile = fs.readFileString(filePath).pipe(
      Effect.map(text => Option.getOrElse(decodeStoreText(text), emptyFile)),
      Effect.orElseSucceed(emptyFile),
    )
    const snapshot = yield* SubscriptionRef.make(yield* readFile)
    const read = readFile.pipe(Effect.tap(file => SubscriptionRef.set(snapshot, file)))

    const writeFailed = (cause: unknown) => new AccountStoreWriteFailed({ path: filePath, cause })

    /** Validate and write the next file beside the live one, owner-only; nothing is published yet. */
    const stage = Effect.fn('ai accounts store stage')(function* (next: AccountStoreFile) {
      yield* validateStoreFile(next).pipe(Effect.orDie)
      const temporary = `${filePath}.${process.pid}.tmp`
      yield* fs
        .makeDirectory(path.dirname(filePath), { recursive: true })
        .pipe(
          Effect.andThen(fs.writeFileString(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 })),
          Effect.andThen(fs.chmod(temporary, 0o600)),
          Effect.mapError(writeFailed),
        )
      return temporary
    })

    const publish = Effect.fn('ai accounts store publish')(function* (next: AccountStoreFile, temporary: string) {
      yield* fs.rename(temporary, filePath).pipe(Effect.mapError(writeFailed))
      yield* SubscriptionRef.set(snapshot, next)
      return next
    })

    const persist = (next: AccountStoreFile) => Effect.flatMap(stage(next), temporary => publish(next, temporary))

    /** A cancelled connection refuses itself after its last await and before publication. */
    const persistFenced = Effect.fn('ai accounts store publish connection')(function* (next: AccountStoreFile, fence: ConnectionCommit) {
      const temporary = yield* stage(next)
      if (!fence.claimCommit()) return yield* new AccountConflict({ instanceId: fence.draft.instanceId, reason: 'connection-inactive' })
      const published = yield* publish(next, temporary)
      fence.didCommit()
      return published
    })

    const serialized = lock.withPermit

    const upsertAccount = Effect.fn('ai accounts store upsert')(function* (draft: AccountDraft, previousInstanceId?: string, requireExisting = false) {
      const file = yield* read
      const replaced = previousInstanceId ?? draft.instanceId
      if (replaced !== draft.instanceId && file.accounts.some(existing => existing.instanceId === draft.instanceId))
        return yield* new AccountConflict({ instanceId: draft.instanceId, reason: 'name-taken' })
      const position = file.accounts.findIndex(existing => existing.instanceId === replaced)
      if (requireExisting && position === -1) return yield* new AccountConflict({ instanceId: replaced, reason: 'not-saved' })
      const normalized: AccountDraft = { ...draft, displayName: defaultName(draft) }
      const accounts = position === -1 ? [...file.accounts, normalized] : file.accounts.map((existing, index) => (index === position ? normalized : existing))
      return yield* persist({ ...file, accounts })
    })

    const moveAccount = Effect.fn('ai accounts store move')(function* (instanceId: string, direction: AccountOrderDirection) {
      const file = yield* read
      const current = file.accounts.find(account => account.instanceId === instanceId)
      if (current === undefined) return yield* new AccountConflict({ instanceId, reason: 'missing' })
      const group = file.accounts.filter(account => account.kind === current.kind)
      const target = group[group.indexOf(current) + (direction === 'earlier' ? -1 : 1)]
      if (target === undefined) return file
      const accounts = AccountOrderModel.reorder(file.accounts, {
        instanceId,
        targetInstanceId: target.instanceId,
        placement: direction === 'earlier' ? 'before' : 'after',
      })
      return yield* persist({ ...file, accounts })
    })

    const reorderAccount = Effect.fn('ai accounts store reorder')(function* (input: AccountReorder) {
      const file = yield* read
      const accounts = yield* reorderedAccounts(file, input)
      if (accounts.every((account, index) => account === file.accounts[index])) return file
      return yield* persist({ ...file, accounts })
    })

    const createSetupAccount = Effect.fn('ai accounts store allocate')(function* (input: CreateSetupAccountInput) {
      const instanceId = `${input.kind}_work_${input.requestId.replaceAll('-', '').toLowerCase()}`
      const file = yield* read
      if (file.accounts.some(account => account.instanceId === instanceId)) return yield* new AccountConflict({ instanceId, reason: 'identity-saved' })
      const generated = AccountDraftModel.newAccountDraft({ kind: input.kind, existing: file.accounts })
      const privateHome = path.join(path.dirname(filePath), 'homes', instanceId)
      const draft: AccountDraft = {
        ...generated,
        instanceId,
        enabled: false,
        homePath: input.kind === 'codex' || input.kind === 'claude' ? privateHome : generated.homePath,
        shadowHomePath: input.kind === 'codex' ? privateHome : generated.shadowHomePath,
        apiKeyEnv: generated.apiKeyEnv === '' ? '' : AccountDraftModel.suggestedApiKeyRef(instanceId),
      }
      return { instanceId, draft, file }
    })

    const commitConnection = Effect.fn('ai accounts store commit connection')(function* (input: ConnectionCommit) {
      const file = yield* read
      const instanceId = input.draft.instanceId
      const current = file.accounts.find(account => account.instanceId === instanceId)
      const beforeCommit = input.beforeCommit ?? Effect.void
      if (input.existing === undefined) {
        if (current !== undefined) return yield* new AccountConflict({ instanceId, reason: 'identity-saved' })
        yield* beforeCommit
        return yield* persistFenced({ ...file, accounts: [...file.accounts, { ...input.draft, enabled: true }] }, input)
      }
      if (current === undefined) return yield* new AccountConflict({ instanceId, reason: 'removed' })
      if (!sameConnection(current, input.existing)) return yield* new AccountConflict({ instanceId, reason: 'connection-changed' })
      const next = committedProfile(current, input.draft)
      yield* beforeCommit
      return yield* persistFenced({ ...file, accounts: file.accounts.map(account => (account === current ? next : account)) }, input)
    })

    return AccountStore.of({
      filePath,
      snapshot,
      read,
      write: next => serialized(persist(next)),
      upsertAccount: (draft, previousInstanceId, requireExisting) => serialized(upsertAccount(draft, previousInstanceId, requireExisting)),
      removeAccount: instanceId =>
        serialized(Effect.flatMap(read, file => persist({ ...file, accounts: file.accounts.filter(account => account.instanceId !== instanceId) }))),
      moveAccount: (instanceId, direction) => serialized(moveAccount(instanceId, direction)),
      reorderAccount: input => serialized(reorderAccount(input)),
      setDistribution: distribution => serialized(Effect.flatMap(read, file => persist({ ...file, distribution }))),
      createSetupAccount,
      commitConnection: input => serialized(commitConnection(input)),
    })
  })

  static readonly layer = Layer.effect(
    AccountStore,
    Effect.suspend(() => AccountStore.makeAt(AccountHomePolicy.filePath())),
  )
}
