import { createHash } from 'node:crypto'
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync, renameSync } from 'node:fs'
import { chmod, lstat, mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { z } from 'zod'
import { CodexHomeModel, type CodexHomeLayout } from './codex-home.js'

export interface LoginAuthSnapshot {
  readonly fingerprint: string | null
  readonly signedIn: boolean
  readonly hasCredential: boolean
}

/** Explicit filesystem seam: tests never touch the user's actual Codex credentials. */
export interface CodexLoginFiles {
  prepare(layout: CodexHomeLayout): Promise<void>
  auth(layout: CodexHomeLayout): Promise<LoginAuthSnapshot>
  stage(layout: CodexHomeLayout): Promise<CodexHomeLayout>
  /** Synchronous compare-and-adopt: cancellation cannot interleave between the final guard and rename. */
  adopt(stage: CodexHomeLayout, target: CodexHomeLayout, expected: string | null): boolean
  cleanup(stage: CodexHomeLayout): Promise<void>
}

const MAX_AUTH_BYTES = 64 * 1024
const storedAuth = z.object({
  auth_mode: z.literal('chatgpt').optional(),
  tokens: z.object({ access_token: z.string().min(1), refresh_token: z.string().min(1) }),
})

/** Reject symlinked ancestors as well as a symlinked shadow/auth file. No shared-home seeding. */
const assertRealDirectory = async (path: string): Promise<void> => {
  try {
    if ((await realpath(path)) !== path || !(await lstat(path)).isDirectory()) throw new Error('Unsafe Codex login home')
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
    const parent = dirname(path)
    if (parent === path) throw new Error('Unsafe Codex login home')
    await assertRealDirectory(parent)
  }
}

type ManagedSetupHomePolicy = (path: string) => boolean
const isStagingName = (path: string): boolean => /^\.dsh-login-[A-Za-z0-9]{6}$/u.test(basename(path))

const validateLayout = (layout: CodexHomeLayout, isManagedSetupHome: ManagedSetupHomePolicy): void => {
  if (layout.mode === 'direct') {
    const shared = layout.sharedHomePath
    const effective = layout.effectiveHomePath
    const canonical = resolve(shared) === shared && resolve(effective) === effective
    const targetOrStage = effective === shared || (dirname(effective) === shared && isStagingName(effective))
    if (canonical && targetOrStage && isManagedSetupHome(shared)) return
    throw new Error('A trusted Host-managed private Codex home is required')
  }
  // Manually configured overlays retain the existing global user-home containment guard.
  const validated = CodexHomeModel.resolveLayout({ homePath: layout.sharedHomePath, shadowHomePath: layout.effectiveHomePath })
  if (layout.mode !== 'authOverlay' || validated.effectiveHomePath !== resolve(layout.effectiveHomePath))
    throw new Error('A private Codex shadow home is required')
}

const snapshot = (layout: CodexHomeLayout, isManagedSetupHome: ManagedSetupHomePolicy): LoginAuthSnapshot => {
  validateLayout(layout, isManagedSetupHome)
  if (realpathSync(layout.effectiveHomePath) !== layout.effectiveHomePath) throw new Error('Unsafe Codex login home')
  let fd: number
  try {
    fd = openSync(join(layout.effectiveHomePath, 'auth.json'), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return { fingerprint: null, signedIn: false, hasCredential: false }
    throw error
  }
  try {
    const stat = fstatSync(fd)
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > MAX_AUTH_BYTES) throw new Error('Unsafe Codex auth file')
    const bytes = Buffer.alloc(MAX_AUTH_BYTES + 1)
    const count = readSync(fd, bytes, 0, bytes.length, 0)
    if (count > MAX_AUTH_BYTES) throw new Error('Oversized Codex auth file')
    const raw = bytes.subarray(0, count)
    let signedIn = false
    let hasCredential = raw.toString('utf8').trim().length > 0
    try {
      const parsed: unknown = JSON.parse(raw.toString('utf8'))
      signedIn = storedAuth.safeParse(parsed).success
      // The pre-existing materializer creates {} for unsigned accounts. Do not demand replacement consent for that.
      if (z.object({}).strict().safeParse(parsed).success) hasCredential = false
    } catch {
      /* Malformed CLI-owned auth is not a successful login and still requires replacement consent. */
    }
    return { fingerprint: createHash('sha256').update(raw).digest('hex'), signedIn, hasCredential }
  } finally {
    closeSync(fd)
  }
}

/** Move, never rewrite tokens. Only the Host may supply its account store's exact managed-root policy. */
export const createCodexLoginFiles = (isManagedSetupHome: ManagedSetupHomePolicy = () => false): CodexLoginFiles => ({
  prepare: async layout => {
    validateLayout(layout, isManagedSetupHome)
    if (layout.mode === 'direct' && layout.effectiveHomePath !== layout.sharedHomePath) throw new Error('A managed account target is required')
    const home = layout.effectiveHomePath
    await assertRealDirectory(home)
    await mkdir(home, { recursive: true, mode: 0o700 })
    await assertRealDirectory(home)
    await chmod(home, 0o700)
    snapshot(layout, isManagedSetupHome) // Refuse symlinks/hardlinks/non-files before any subprocess starts.
  },
  auth: async layout => snapshot(layout, isManagedSetupHome),
  stage: async layout => {
    validateLayout(layout, isManagedSetupHome)
    if (layout.mode === 'direct' && layout.effectiveHomePath !== layout.sharedHomePath) throw new Error('A managed account target is required')
    await assertRealDirectory(layout.effectiveHomePath)
    const effectiveHomePath = await mkdtemp(join(layout.effectiveHomePath, '.dsh-login-'))
    await chmod(effectiveHomePath, 0o700)
    return { ...layout, effectiveHomePath }
  },
  adopt: (stage, target, expected) => {
    if (dirname(stage.effectiveHomePath) !== target.effectiveHomePath || !stage.effectiveHomePath.startsWith(join(target.effectiveHomePath, '.dsh-login-')))
      throw new Error('Unsafe Codex login staging home')
    if (snapshot(target, isManagedSetupHome).fingerprint !== expected) return false
    if (!snapshot(stage, isManagedSetupHome).signedIn) throw new Error('Codex did not save ChatGPT credentials')
    const source = join(stage.effectiveHomePath, 'auth.json')
    if ((lstatSync(source).mode & 0o077) !== 0) throw new Error('Codex auth file must be private')
    renameSync(source, join(target.effectiveHomePath, 'auth.json'))
    return true
  },
  cleanup: async stage => {
    validateLayout(stage, isManagedSetupHome)
    const path = stage.effectiveHomePath
    if (!path.startsWith(join(dirname(path), '.dsh-login-'))) throw new Error('Unsafe Codex login cleanup path')
    await assertRealDirectory(path)
    await rm(path, { recursive: true, force: true })
  },
})

/** Standalone/legacy callers cannot opt arbitrary direct homes into the managed-root exception. */
export const codexLoginFiles = createCodexLoginFiles()
