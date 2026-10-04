import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { chmod } from 'node:fs/promises'
import { z } from 'zod'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import {
  accountDraftSchema,
  accountsFileSchema,
  type AccountDraft,
  type AccountProfile,
  type AccountsFile,
} from './api.js'
import {
  describeCodexAuth,
  materializeCodexShadowHome,
  CodexHomeError,
  resolveCodexHomeLayout,
} from './codex-home.js'
import { DEFAULT_DISTRIBUTION, type AccountStatus } from './account-pool.js'
import { readKeyFromEnv } from './credentials.js'

/**
 * Account profiles on disk.
 *
 * Profiles live in their own file rather than the profile patch: the page edits
 * them constantly, and a JSON document keeps account state out of the reviewed
 * patch while the route that serves models stays declarative there. Only account
 * *identity and layout* is stored — never a token, and never `auth.json` content,
 * which stays inside each Codex home where its owner put it.
 */

const STORE_PATH = join(
  process.env.DSH_HOME ?? join(homedir(), '.dsh'),
  'plugins',
  'ai-accounts',
  'accounts.json',
)

const DEFAULT_SHADOW_ROOT = join(homedir(), '.codex-dshx')

/** Stored shape: only what a user may author or toggle. */
interface AccountStoreFile {
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

/**
 * Read the stored profiles without blocking on I/O.
 *
 * Cordis activates a plugin synchronously, so the first read is the file's
 * cached bytes if they are already present and defaults otherwise. Every read
 * after that goes through {@link readAccountFile}, which re-reads from disk, so
 * an external edit is picked up on the next request.
 */
/** Load the file into the cache so activation can read it synchronously. */
export const primeAccountFile = async (): Promise<AccountStoreFile> => {
  try {
    cachedRaw = await readFile(STORE_PATH, 'utf8')
  } catch {
    cachedRaw = undefined
  }
  return readAccountFileSync()
}

export const readAccountFileSync = (): AccountStoreFile => {
  if (cachedRaw === undefined) return emptyFile()
  const result = storeFileSchema.safeParse(parseJson(cachedRaw))
  return result.success ? result.data : emptyFile()
}

/**
 * Read the stored profiles.
 *
 * A missing or unreadable file yields defaults rather than failing the page, so a
 * first run and a corrupted file both leave a usable Accounts page.
 */
export const readAccountFile = async (): Promise<AccountStoreFile> => {
  let raw: string
  try {
    raw = await readFile(STORE_PATH, 'utf8')
  } catch {
    return emptyFile()
  }
  cachedRaw = raw
  const result = storeFileSchema.safeParse(parseJson(raw))
  return result.success ? result.data : emptyFile()
}

let cachedRaw: string | undefined

const parseJson = (raw: string): unknown => {
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

/** Replace the stored profiles, atomically and private to this user. */
export const writeAccountFile = async (next: AccountStoreFile): Promise<AccountStoreFile> => {
  const validated = storeFileSchema.parse(next)
  await mkdir(dirname(STORE_PATH), { recursive: true })
  const temporary = `${STORE_PATH}.${process.pid}.tmp`
  await writeFile(temporary, `${JSON.stringify(validated, null, 2)}\n`, 'utf8')
  await rename(temporary, STORE_PATH)
  await chmod(STORE_PATH, 0o600)
  return validated
}

const expandHome = (value: string): string =>
  value.startsWith('~/') ? join(homedir(), value.slice(2)) : value

/** Derive an account's Codex homes, defaulting the shadow under the root. */
const layoutFor = (profile: AccountDraft, file: AccountStoreFile) =>
  resolveCodexHomeLayout({
    homePath: profile.homePath,
    shadowHomePath:
      profile.shadowHomePath.trim().length > 0
        ? profile.shadowHomePath
        : join(file.shadowRoot.replace(/\/$/, ''), profile.instanceId),
  })

const defaultName = (draft: AccountDraft): string =>
  draft.displayName.trim().length > 0
    ? draft.displayName.trim()
    : `${draft.kind === 'codex' ? 'Codex' : 'OpenCode Go'} (${draft.instanceId})`

/**
 * Observed fields for one stored profile: whether it holds a login, the identity
 * it presents, and how its Codex home is arranged. Never a credential.
 */
const observe = async (
  draft: AccountDraft,
  file: AccountStoreFile,
  status: AccountStatus | undefined,
): Promise<AccountProfile> => {
  if (draft.kind === 'opencode-go') {
    const hasKey =
readKeyFromEnv(draft.apiKeyEnv).length > 0
    return {
      ...draft,
      displayName: defaultName(draft),
      mode: 'direct',
      signedIn: hasKey,
      identity: null,
      plan: null,
      state: draft.enabled ? (hasKey ? 'healthy' : 'unconfigured') : 'disabled',
      loginHint:
        draft.apiKeyEnv.trim().length > 0
          ? `Export ${draft.apiKeyEnv.trim()} before using this account.`
          : 'Set an API key environment variable for this account.',
      detail: null,
    }
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
  const cooling = status?.state === 'cooling'
  return {
    ...draft,
    displayName: defaultName(draft),
    mode: layout.mode,
    signedIn: auth.signedIn,
    identity: auth.identity ?? null,
    plan: auth.plan ?? null,
    state: !draft.enabled
      ? 'disabled'
      : cooling
        ? 'cooling'
        : auth.signedIn
          ? 'healthy'
          : 'unconfigured',
    loginHint: `CODEX_HOME="${layout.effectiveHomePath}" codex login`,
    detail: auth.error ?? null,
  }
}

/**
 * The whole store as the page and the tool read it: stored profiles joined with
 * the pool's live health and each home's observed login.
 */
export const buildAccountsFile = async (
  file: AccountStoreFile,
  statuses: readonly AccountStatus[],
): Promise<AccountsFile> => ({
  ...file,
  accounts: await Promise.all(
    file.accounts.map(async draft => {
      const status = statuses.find(candidate => candidate.id === draft.instanceId)
      return observe(draft, file, status)
    }),
  ),
})

/** Create or update one profile, keyed by its instance id. */
export const upsertAccount = async (draft: AccountDraft): Promise<AccountStoreFile> => {
  const file = await readAccountFile()
  const accounts = file.accounts.filter(
    existing => existing.instanceId !== draft.instanceId,
  )
  const normalized: AccountDraft = { ...draft, displayName: defaultName(draft) }
  if (normalized.kind === 'codex') {
    // Materialize now so the login command points at a directory that exists.
    await materializeCodexShadowHome(layoutFor(normalized, file)).catch(() => undefined)
  }
  return writeAccountFile({ ...file, accounts: [...accounts, normalized] })
}

export const removeAccount = async (instanceId: string): Promise<AccountStoreFile> => {
  const file = await readAccountFile()
  return writeAccountFile({
    ...file,
    accounts: file.accounts.filter(account => account.instanceId !== instanceId),
  })
}

export const setDistribution = async (
  distribution: AccountsFile['distribution'],
): Promise<AccountStoreFile> => {
  const file = await readAccountFile()
  return writeAccountFile({ ...file, distribution })
}

/**
 * The identity one account currently presents.
 *
 * Creating the shadow home before reading is what makes the page useful during
 * first sign-in: Codex writes `auth.json` into `$CODEX_HOME`, so the directory
 * has to exist before the user runs the command the page shows them.
 */
export const readAccountIdentity = async (
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

export const storePath = (): string => resolve(STORE_PATH)
export const expandPath = expandHome