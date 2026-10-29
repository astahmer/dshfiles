import { mkdir, readFile, rename, writeFile, chmod } from 'node:fs/promises'
import { readFileSync, renameSync } from 'node:fs'
import { z } from 'zod'
import { dirname, join } from 'node:path'
import { accountDraftSchema, accountsFileSchema, type AccountDraft, type AccountOrderDirection, type AccountProfile, type AccountsFile } from './api.js'
import { CodexHomeModel, describeCodexAuth, materializeCodexShadowHome, CodexHomeError } from './codex-home.js'
import { DEFAULT_DISTRIBUTION, type AccountStatus } from './account-pool.js'
import { CredentialModel, type CredentialValueResolver } from './credentials.js'
import { KIND_LABEL } from './account-labels.js'
import { ClaudeAccountModel, claudeAccountService } from './claude-account.js'
import { DEFAULT_COMMANDCODE_KEY_ENV } from './commandcode-provider.js'
import { readCommandCodeKey } from './commandcode-usage.js'
import { CURSOR_LOGIN_HINT, readCursorToken } from './cursor-account.js'
import { AccountWriteQueue } from './account-write-queue.js'
import { AccountOrderModel } from './account-order-model.js'
import { createSetupAccountInputSchema, type AccountReorder, type CreateSetupAccountInput } from './api.js'
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

const STORE_PATH = AccountHomePolicy.filePath()

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
const storeFileSchema = accountsFileSchema.extend({
  accounts: z.array(accountDraftSchema).max(64),
})

const parseJson = (raw: string): unknown => {
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

interface AccountStoreFileSystem {
  readText(path: string): Promise<string>
  readTextSync(path: string): string
  makeDirectory(path: string): Promise<void>
  writeText(path: string, content: string): Promise<void>
  rename(source: string, target: string): Promise<void>
  renameSync(source: string, target: string): void
  chmod(path: string, mode: number): Promise<void>
}

const nodeAccountStoreFileSystem: AccountStoreFileSystem = {
  readText: path => readFile(path, 'utf8'),
  readTextSync: path => readFileSync(path, 'utf8'),
  makeDirectory: async path => {
    await mkdir(path, { recursive: true })
  },
  writeText: (path, content) => writeFile(path, content, 'utf8'),
  rename,
  renameSync,
  chmod,
}

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

const createAccountStoreService = (dependencies: { readonly filePath: string; readonly fileSystem: AccountStoreFileSystem }) => {
  let cachedRaw: string | undefined
  // Serialize the entire read-modify-write, not just rename: all Host callers share this store.
  const mutate = AccountWriteQueue.create()

  /** Load the file into the cache so activation can read it synchronously. */
  const primeAccountFile = (): AccountStoreFile => {
    try {
      cachedRaw = dependencies.fileSystem.readTextSync(dependencies.filePath)
    } catch {
      cachedRaw = undefined
    }
    return readAccountFileSync()
  }

  /**
   * Cordis activates synchronously, so boot reads cached bytes if primed and
   * defaults otherwise. Later requests re-read the file and see external edits.
   */
  const readAccountFileSync = (): AccountStoreFile => {
    if (cachedRaw === undefined) return emptyFile()
    const result = storeFileSchema.safeParse(parseJson(cachedRaw))
    return result.success ? result.data : emptyFile()
  }

  /** Missing or unreadable storage yields defaults so first run remains usable. */
  const readAccountFile = async (): Promise<AccountStoreFile> => {
    let raw: string
    try {
      raw = await dependencies.fileSystem.readText(dependencies.filePath)
    } catch {
      return emptyFile()
    }
    cachedRaw = raw
    const result = storeFileSchema.safeParse(parseJson(raw))
    return result.success ? result.data : emptyFile()
  }

  /** Replace the stored profiles atomically and private to this user. */
  const persistAccountFile = async (next: AccountStoreFile, claimCommit?: () => boolean, didCommit?: () => void): Promise<AccountStoreFile> => {
    const validated = storeFileSchema.parse(next)
    await dependencies.fileSystem.makeDirectory(dirname(dependencies.filePath))
    const temporary = `${dependencies.filePath}.${process.pid}.tmp`
    await dependencies.fileSystem.writeText(temporary, `${JSON.stringify(validated, null, 2)}\n`)
    await dependencies.fileSystem.chmod(temporary, 0o600)
    if (claimCommit === undefined) await dependencies.fileSystem.rename(temporary, dependencies.filePath)
    else {
      // Cancellation cannot interleave between the final operation fence and publication.
      if (!claimCommit()) throw new Error('This account connection is no longer active.')
      dependencies.fileSystem.renameSync(temporary, dependencies.filePath)
      didCommit?.()
    }
    cachedRaw = `${JSON.stringify(validated, null, 2)}\n`
    return validated
  }

  const writeAccountFile = (next: AccountStoreFile): Promise<AccountStoreFile> => mutate(() => persistAccountFile(next))

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

  /** Allocate metadata only. The Host lifecycle, not the durable store, owns unconnected candidates. */
  const createSetupAccount = async (
    input: CreateSetupAccountInput,
  ): Promise<{ readonly instanceId: string; readonly draft: AccountDraft; readonly file: AccountStoreFile }> => {
    const request = createSetupAccountInputSchema.parse(input)
    const instanceId = `${request.kind}_work_${request.requestId.replaceAll('-', '').toLowerCase()}`
    const file = await readAccountFile()
    if (file.accounts.some(account => account.instanceId === instanceId)) throw new Error('This account identity is already saved.')
    const generated = AccountDraftModel.newAccountDraft({ kind: request.kind, existing: file.accounts })
    const privateHome = join(dirname(dependencies.filePath), 'homes', instanceId)
    const draft: AccountDraft = {
      ...generated,
      instanceId,
      enabled: false,
      homePath: request.kind === 'codex' || request.kind === 'claude' ? privateHome : generated.homePath,
      shadowHomePath: request.kind === 'codex' ? privateHome : generated.shadowHomePath,
      apiKeyEnv: generated.apiKeyEnv === '' ? '' : AccountDraftModel.suggestedApiKeyRef(instanceId),
    }
    return { instanceId, draft, file }
  }

  /** Reuse the established home rules without materializing, copying or reading authentication. */
  const connectionMetadata = (draft: AccountDraft, shadowRoot: string): Pick<AccountProfile, 'mode' | 'loginHint'> => {
    if (draft.kind === 'codex') {
      const layout = AccountHomePolicy.codexLayoutFor(draft, shadowRoot)
      return { mode: layout.mode, loginHint: CodexHomeModel.loginHint(layout) }
    }
    if (draft.kind === 'claude')
      return { mode: 'direct', loginHint: ClaudeAccountModel.claudeLoginHint(ClaudeAccountModel.resolveClaudeConfigDir(draft.homePath)) }
    return { mode: 'direct', loginHint: draft.kind === 'commandcode' ? 'cmd login' : draft.kind === 'cursor' ? CURSOR_LOGIN_HINT : '' }
  }

  /** Publish a verified operation once, under the same queue as every settings write. */
  const commitConnection = (input: {
    readonly draft: AccountDraft
    readonly existing: AccountDraft | undefined
    readonly claimCommit: () => boolean
    readonly didCommit: () => void
    readonly beforeCommit?: () => Promise<void>
  }): Promise<AccountStoreFile> =>
    mutate(async () => {
      const file = await readAccountFile()
      const current = file.accounts.find(account => account.instanceId === input.draft.instanceId)
      if (input.existing === undefined) {
        if (current !== undefined) throw new Error('This account identity is already saved.')
        await input.beforeCommit?.()
        return persistAccountFile({ ...file, accounts: [...file.accounts, { ...input.draft, enabled: true }] }, input.claimCommit, input.didCommit)
      }
      if (current === undefined) throw new Error('This saved account was removed.')
      if (
        current.kind !== input.existing.kind ||
        current.homePath !== input.existing.homePath ||
        current.shadowHomePath !== input.existing.shadowHomePath ||
        current.apiKeyEnv !== input.existing.apiKeyEnv ||
        current.authSource !== input.existing.authSource ||
        current.apiBaseUrl !== input.existing.apiBaseUrl
      )
        throw new Error('The saved account connection settings changed. Start again.')
      const next: AccountDraft = {
        ...current,
        enabled: true,
        homePath: input.draft.homePath,
        shadowHomePath: input.draft.shadowHomePath,
        apiKeyEnv: input.draft.apiKeyEnv,
        authSource: input.draft.authSource,
        apiBaseUrl: input.draft.apiBaseUrl,
      }
      // Optional ownership must be absent, not an own undefined: the committed
      // profile is returned over the strict JSON API before any disk round-trip.
      if (next.authSource === undefined) delete next.authSource
      await input.beforeCommit?.()
      return persistAccountFile({ ...file, accounts: file.accounts.map(account => (account === current ? next : account)) }, input.claimCommit, input.didCommit)
    })

  /** Create or update a profile; a rename replaces the previous id in place. */
  const upsertAccount = (draft: AccountDraft, previousInstanceId?: string, requireExisting = false): Promise<AccountStoreFile> =>
    mutate(async () => {
      const file = await readAccountFile()
      const replaced = previousInstanceId ?? draft.instanceId
      if (replaced !== draft.instanceId && file.accounts.some(existing => existing.instanceId === draft.instanceId)) {
        throw new Error(`An account named '${draft.instanceId}' already exists.`)
      }
      const position = file.accounts.findIndex(existing => existing.instanceId === replaced)
      if (requireExisting && position === -1) throw new Error('Connect a new account before saving its settings; this saved account no longer exists.')
      const normalized: AccountDraft = { ...draft, displayName: defaultName(draft) }
      if (normalized.kind === 'codex') {
        await materializeCodexShadowHome(layoutFor(normalized, file)).catch(() => undefined)
      }
      const accounts = position === -1 ? [...file.accounts, normalized] : file.accounts.map((existing, index) => (index === position ? normalized : existing))
      return persistAccountFile({ ...file, accounts })
    })

  const removeAccount = (instanceId: string): Promise<AccountStoreFile> =>
    mutate(async () => {
      const file = await readAccountFile()
      return persistAccountFile({ ...file, accounts: file.accounts.filter(account => account.instanceId !== instanceId) })
    })

  const reorderAccount = (input: AccountReorder): Promise<AccountStoreFile> =>
    mutate(async () => {
      const file = await readAccountFile()
      const accounts = AccountOrderModel.reorder(file.accounts, input)
      if (accounts.every((account, index) => account === file.accounts[index])) return file
      return persistAccountFile({ ...file, accounts })
    })

  const moveAccount = (instanceId: string, direction: AccountOrderDirection): Promise<AccountStoreFile> =>
    mutate(async () => {
      const file = await readAccountFile()
      const current = file.accounts.find(account => account.instanceId === instanceId)
      if (current === undefined) throw new Error(`Account '${instanceId}' is no longer available.`)
      const group = file.accounts.filter(account => account.kind === current.kind)
      const target = group[group.indexOf(current) + (direction === 'earlier' ? -1 : 1)]
      if (target === undefined) return file
      const accounts = AccountOrderModel.reorder(file.accounts, {
        instanceId,
        targetInstanceId: target.instanceId,
        placement: direction === 'earlier' ? 'before' : 'after',
      })
      return persistAccountFile({ ...file, accounts })
    })

  const setDistribution = (distribution: AccountsFile['distribution']): Promise<AccountStoreFile> =>
    mutate(async () => {
      const file = await readAccountFile()
      return persistAccountFile({ ...file, distribution })
    })

  /**
   * Creating the shadow home first lets Codex write auth data into the home
   * when users follow the login command shown by the page.
   */
  const readAccountIdentity = async (
    instanceId: string,
  ): Promise<{
    readonly instanceId: string
    readonly email: string | null
    readonly plan: string | null
    readonly signedIn: boolean
  }> => {
    const file = await readAccountFile()
    const draft = file.accounts.find(account => account.instanceId === instanceId)
    if (draft === undefined || draft.kind !== 'codex') {
      return { instanceId, email: null, plan: null, signedIn: false }
    }
    const layout = layoutFor(draft, file)
    await materializeCodexShadowHome(layout).catch(() => undefined)
    const auth = await describeCodexAuth(layout)
    return {
      instanceId,
      email: auth.identity ?? null,
      plan: auth.plan ?? null,
      signedIn: auth.signedIn,
    }
  }

  return {
    primeAccountFile,
    readAccountFileSync,
    readAccountFile,
    writeAccountFile,
    buildAccountsFile,
    createSetupAccount,
    connectionMetadata,
    commitConnection,
    upsertAccount,
    removeAccount,
    moveAccount,
    reorderAccount,
    setDistribution,
    readAccountIdentity,
  }
}

export const accountStoreService = createAccountStoreService({ filePath: STORE_PATH, fileSystem: nodeAccountStoreFileSystem })
