import { chmod, copyFile, lstat, mkdir, readFile, readdir, readlink, rm, symlink, writeFile } from 'node:fs/promises'
import { userInfo } from 'node:os'
import { join, resolve, sep } from 'node:path'

/**
 * Codex home layout, ported from T3 Code's `CodexHomeLayout.ts`.
 *
 * A shadow home is an auth overlay: `CODEX_HOME` points at the shadow, every
 * non-private entry is a symlink back into the shared home, and `auth.json`
 * stays a real per-account file. Sessions, skills, plugins and config stay
 * shared, so a second account costs one login rather than a second workspace.
 */

const SHARED_DIRECTORIES = ['sessions', 'archived_sessions', 'sqlite', 'shell_snapshots', 'worktrees', 'skills', 'plugins', 'cache', 'logs'] as const

const PRIVATE_ENTRIES: ReadonlySet<string> = new Set(['auth.json', 'models_cache.json'])
const SHADOW_LOCAL_ENTRIES: ReadonlySet<string> = new Set(['log', 'memories', 'tmp'])

type LinkState = { readonly tag: 'missing' } | { readonly tag: 'notSymlink' } | { readonly tag: 'symlink'; readonly target: string }

export interface CodexHomeInput {
  readonly homePath?: string
  readonly shadowHomePath?: string
}

export interface CodexHomeLayout {
  readonly mode: 'direct' | 'authOverlay'
  readonly sharedHomePath: string
  readonly effectiveHomePath: string
}

export class CodexHomeError extends Error {}

/**
 * The OS account's home, not `$HOME`: an isolated host (scratch `HOME`/`DSH_HOME`) must still reach the user's real
 * Codex logins, and the containment guard must not move with an environment variable.
 */
export const codexAccountHome = (): string => userInfo().homedir

const expandHome = (value: string): string => (value.startsWith('~/') ? join(codexAccountHome(), value.slice(2)) : value)

/** Codex homes hold credentials, so a configured path may never leave the user's home. */
const containedHome = (value: string): string => {
  const path = resolve(expandHome(value))
  const owner = codexAccountHome()
  if (path === owner || !path.startsWith(`${owner}${sep}`)) {
    throw new CodexHomeError(`Codex home '${path}' must be a directory inside '${owner}'.`)
  }
  return path
}

export const resolveCodexHomeLayout = (input: CodexHomeInput): CodexHomeLayout => {
  const configured = input.homePath?.trim() ?? ''
  const shared = containedHome(configured.length > 0 ? configured : join(codexAccountHome(), '.codex'))
  const shadow = input.shadowHomePath?.trim() ?? ''
  if (shadow.length === 0) {
    return { mode: 'direct', sharedHomePath: shared, effectiveHomePath: shared }
  }
  const effective = containedHome(shadow)
  if (effective === shared) {
    throw new CodexHomeError(`Shadow home '${effective}' must differ from the shared Codex home '${shared}'.`)
  }
  return { mode: 'authOverlay', sharedHomePath: shared, effectiveHomePath: effective }
}

const readLinkState = async (path: string): Promise<LinkState> => {
  try {
    const stats = await lstat(path)
    if (!stats.isSymbolicLink()) return { tag: 'notSymlink' }
    return { tag: 'symlink', target: await readlink(path) }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return { tag: 'missing' }
    if (code === 'EINVAL') return { tag: 'notSymlink' }
    throw error
  }
}

const ensureSymlink = async (sharedHomePath: string, effectiveHomePath: string, entryName: string): Promise<void> => {
  const target = join(sharedHomePath, entryName)
  const link = join(effectiveHomePath, entryName)
  const state = await readLinkState(link)
  if (state.tag === 'notSymlink') {
    await rm(link, { recursive: true, force: true })
    await symlink(target, link)
    return
  }
  if (state.tag === 'missing') {
    await symlink(target, link)
    return
  }
  if (resolve(link, '..', state.target) !== target) {
    await rm(link, { force: true })
    await symlink(target, link)
  }
}

/**
 * Guarantee the shadow home owns a real `auth.json`.
 *
 * A first-run shadow has none, and Codex resolves credentials from `$CODEX_HOME`,
 * so it must be seeded from the shared home before a login writes its own. An
 * existing file is never overwritten, and a symlink is refused outright: that is
 * exactly the "two accounts silently sharing one login" failure this layout
 * exists to prevent.
 */
const ensurePrivateAuth = async (sharedHomePath: string, effectiveHomePath: string): Promise<void> => {
  const privatePath = join(effectiveHomePath, 'auth.json')
  const state = await readLinkState(privatePath)
  if (state.tag === 'symlink') {
    throw new CodexHomeError(`'auth.json' in the shadow home '${effectiveHomePath}' is a symlink; each account needs its own real file.`)
  }
  if (state.tag === 'notSymlink') return
  try {
    await copyFile(join(sharedHomePath, 'auth.json'), privatePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    await writeFile(privatePath, '{}\n', { mode: 0o600 })
  }
}

/**
 * Create or repair the overlay. Idempotent, so an overlay interrupted during a
 * login heals on the next request instead of needing manual cleanup.
 */
export const materializeCodexShadowHome = async (layout: CodexHomeLayout): Promise<CodexHomeLayout> => {
  if (layout.mode !== 'authOverlay') return layout
  const { sharedHomePath, effectiveHomePath } = layout
  await mkdir(effectiveHomePath, { recursive: true })
  await chmod(effectiveHomePath, 0o700)

  const sharedEntries = new Set<string>(SHARED_DIRECTORIES)
  let names: string[]
  try {
    names = await readdir(sharedHomePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    await mkdir(sharedHomePath, { recursive: true })
    names = []
  }
  for (const name of names) {
    if (PRIVATE_ENTRIES.has(name) || SHADOW_LOCAL_ENTRIES.has(name)) continue
    sharedEntries.add(name)
  }

  for (const entryName of sharedEntries) {
    await mkdir(join(sharedHomePath, entryName), { recursive: true }).catch(() => undefined)
    await ensureSymlink(sharedHomePath, effectiveHomePath, entryName)
  }
  await ensurePrivateAuth(sharedHomePath, effectiveHomePath)
  return layout
}

/** The command that writes the next login for this instance. */
export const codexLoginHint = (layout: CodexHomeLayout): string => `CODEX_HOME="${layout.effectiveHomePath}" codex login`

export const authJsonPath = (layout: CodexHomeLayout): string => join(layout.effectiveHomePath, 'auth.json')

export interface CodexAuthView {
  readonly path: string
  readonly signedIn: boolean
  /** The signed-in email, when the id token carries one. Never an internal id. */
  readonly identity: string | undefined
  readonly plan: string | undefined
  readonly error: string | undefined
}

export const decodeJwtPayload = (token: string): Record<string, unknown> | undefined => {
  const segment = token.split('.')[1]
  if (segment === undefined) return undefined
  try {
    return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as Record<string, unknown>
  } catch {
    return undefined
  }
}

const readString = (value: unknown): string | undefined => (typeof value === 'string' && value.length > 0 ? value : undefined)

/**
 * A label for a signed-in account when the id token carries no email.
 *
 * Codex's own id token often has a `user_id` and nothing else identifying, so
 * the plan plus the tail of the user id is what a person can recognise. The full
 * id stays out of the page and the agent tool.
 */
const labelFromUserId = (userId: string, plan: string | undefined): string => `${plan === undefined ? 'ChatGPT' : `ChatGPT ${plan}`} ·${userId.slice(-4)}`

/** Account identity read from Codex's own id token. Never the access token. */
export const describeCodexAuth = async (layout: CodexHomeLayout): Promise<CodexAuthView> => {
  const path = authJsonPath(layout)
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch {
    return { path, signedIn: false, identity: undefined, plan: undefined, error: undefined }
  }
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>
  } catch {
    return {
      path,
      signedIn: false,
      identity: undefined,
      plan: undefined,
      error: 'auth.json is not valid JSON',
    }
  }
  const tokens = (parsed.tokens ?? {}) as Record<string, unknown>
  const claims = typeof tokens.id_token === 'string' ? decodeJwtPayload(tokens.id_token) : undefined
  const profile = (claims?.['https://api.openai.com/profile'] ?? {}) as Record<string, unknown>
  const auth = (claims?.['https://api.openai.com/auth'] ?? {}) as Record<string, unknown>
  const plan = readString(parsed.chatgpt_plan_type) ?? readString(auth.chatgpt_plan_type)
  const userId = readString(auth.user_id) ?? readString(auth.chatgpt_user_id)
  return {
    path,
    signedIn: readString(tokens.access_token) !== undefined,
    identity: readString(profile.email) ?? (userId === undefined ? undefined : labelFromUserId(userId, plan)),
    plan,
    error: undefined,
  }
}
