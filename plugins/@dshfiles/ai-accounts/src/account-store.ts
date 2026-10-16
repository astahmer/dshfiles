import { mkdir, readFile, rename, writeFile, chmod } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { z } from 'zod'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { accountDraftSchema, accountsFileSchema, type AccountDraft, type AccountOrderDirection, type AccountProfile, type AccountsFile } from './api.js'
import { CodexHomeModel, describeCodexAuth, materializeCodexShadowHome, CodexHomeError } from './codex-home.js'
import { DEFAULT_DISTRIBUTION, type AccountStatus } from './account-pool.js'
import { CredentialModel, type CredentialValueResolver } from './credentials.js'
import { KIND_LABEL } from './account-labels.js'
import { ClaudeAccountModel, claudeAccountService } from './claude-account.js'
import { DEFAULT_COMMANDCODE_KEY_ENV } from './commandcode-provider.js'
import { readCommandCodeKey } from './commandcode-usage.js'
import { CURSOR_LOGIN_HINT, readCursorToken } from './cursor-account.js'

/**
 * Account profiles on disk.
 *
 * Profiles live in their own file rather than the profile patch: the page edits
 * them constantly, and a JSON document keeps account state out of the reviewed
 * patch while the route that serves models stays declarative there. Only account
 * *identity and layout* is stored — never a token, and never `auth.json` content,
 * which stays inside each Codex home where its owner put it.
 */

const STORE_PATH = resolve(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'plugins', 'ai-accounts', 'accounts.json')

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

export class AccountStoreModel {
  static readonly filePath = (): string => STORE_PATH
  static readonly codexLayoutFor = (profile: Pick<AccountDraft, 'homePath' | 'shadowHomePath' | 'instanceId'>, shadowRoot: string) =>
    CodexHomeModel.resolveLayout({
      homePath: profile.homePath,
      shadowHomePath: profile.shadowHomePath.trim().length > 0 ? profile.shadowHomePath : join(shadowRoot.replace(/\/$/u, ''), profile.instanceId),
    })
}

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
  chmod,
}

const layoutFor = (profile: AccountDraft, file: AccountStoreFile) => AccountStoreModel.codexLayoutFor(profile, file.shadowRoot)

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
    const hasKey = (await readCommandCodeKey(draft.apiKeyEnv, resolveCredential)).length > 0
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
    const token = await readCursorToken(draft.apiKeyEnv, resolveCredential)
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
    loginHint: `CODEX_HOME="${layout.effectiveHomePath}" codex login`,
    detail: auth.error ?? null,
  }
}

const createAccountStoreService = (dependencies: { readonly filePath: string; readonly fileSystem: AccountStoreFileSystem }) => {
  let cachedRaw: string | undefined

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
  const writeAccountFile = async (next: AccountStoreFile): Promise<AccountStoreFile> => {
    const validated = storeFileSchema.parse(next)
    await dependencies.fileSystem.makeDirectory(dirname(dependencies.filePath))
    const temporary = `${dependencies.filePath}.${process.pid}.tmp`
    await dependencies.fileSystem.writeText(temporary, `${JSON.stringify(validated, null, 2)}\n`)
    await dependencies.fileSystem.rename(temporary, dependencies.filePath)
    await dependencies.fileSystem.chmod(dependencies.filePath, 0o600)
    return validated
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

  /** Create or update a profile; a rename replaces the previous id in place. */
  const upsertAccount = async (draft: AccountDraft, previousInstanceId?: string): Promise<AccountStoreFile> => {
    const file = await readAccountFile()
    const replaced = previousInstanceId ?? draft.instanceId
    if (replaced !== draft.instanceId && file.accounts.some(existing => existing.instanceId === draft.instanceId)) {
      throw new Error(`An account named '${draft.instanceId}' already exists.`)
    }
    const position = file.accounts.findIndex(existing => existing.instanceId === replaced)
    const normalized: AccountDraft = { ...draft, displayName: defaultName(draft) }
    if (normalized.kind === 'codex') {
      await materializeCodexShadowHome(layoutFor(normalized, file)).catch(() => undefined)
    }
    const accounts = position === -1 ? [...file.accounts, normalized] : file.accounts.map((existing, index) => (index === position ? normalized : existing))
    return writeAccountFile({ ...file, accounts })
  }

  const removeAccount = async (instanceId: string): Promise<AccountStoreFile> => {
    const file = await readAccountFile()
    return writeAccountFile({ ...file, accounts: file.accounts.filter(account => account.instanceId !== instanceId) })
  }

  const moveAccount = async (instanceId: string, direction: AccountOrderDirection): Promise<AccountStoreFile> => {
    const file = await readAccountFile()
    const currentIndex = file.accounts.findIndex(account => account.instanceId === instanceId)
    const current = file.accounts[currentIndex]
    if (current === undefined) throw new Error(`Account '${instanceId}' is no longer available.`)

    const indexesInGroup = file.accounts.flatMap((account, index) => (account.kind === current.kind ? [index] : []))
    const positionInGroup = indexesInGroup.indexOf(currentIndex)
    const nextIndex = indexesInGroup[positionInGroup + (direction === 'earlier' ? -1 : 1)]
    if (nextIndex === undefined) return file
    const next = file.accounts[nextIndex]
    if (next === undefined) return file

    const accounts = [...file.accounts]
    accounts[currentIndex] = next
    accounts[nextIndex] = current
    return writeAccountFile({ ...file, accounts })
  }

  const setDistribution = async (distribution: AccountsFile['distribution']): Promise<AccountStoreFile> => {
    const file = await readAccountFile()
    return writeAccountFile({ ...file, distribution })
  }

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
    upsertAccount,
    removeAccount,
    moveAccount,
    setDistribution,
    readAccountIdentity,
  }
}

export const accountStoreService = createAccountStoreService({ filePath: STORE_PATH, fileSystem: nodeAccountStoreFileSystem })
