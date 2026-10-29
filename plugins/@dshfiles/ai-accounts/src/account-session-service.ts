import { spawn } from 'node:child_process'
import { pluginAttributes, withSpan } from '@dshfiles/dshx/tracing'
import { constants, type Stats } from 'node:fs'
import { access, lstat, realpath, writeFile } from 'node:fs/promises'
import { delimiter, dirname, join } from 'node:path'
import { AccountCredentialHomeWork } from './account-credential-home-work.js'
import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { AccountDraft } from './api.js'
import type { AccountStoreFile } from './account-store.js'
import type { AccountSessionCapability } from './account-session-api.js'
import { AccountHomePolicy } from './account-home-policy.js'
import { ClaudeAccountModel, claudeAccountService } from './claude-account.js'
import { CodexHomeModel, type CodexHomeLayout } from './codex-home.js'
import { createCodexLoginFiles } from './codex-login-files.js'
import { CODEX_LOGIN_EXECUTABLE } from './codex-login-process.js'

const BUSY = 'Finish or close the active account connection or sign-in before signing out. No pending sign-in was cancelled.'
const EXTERNAL = 'This credential is an external environment or Secret Catalog reference. Update its source manually; DSH cannot sign it out.'
const FAILURE = 'Could not sign out this account. Check its credential source and retry. Its saved profile was preserved.'
const ENVIRONMENT_KEYS = [
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'SYSTEMROOT',
  'TMPDIR',
  'TEMP',
  'LANG',
  'LC_ALL',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'NODE_EXTRA_CA_CERTS',
] as const

type SessionCredentials = Pick<CredentialProvider, 'describe' | 'unset' | 'describeRecord'>
export interface AccountLogoutCommand {
  readonly executable: typeof CODEX_LOGIN_EXECUTABLE | 'claude'
  readonly args: readonly string[]
  readonly home: string
  readonly env: NodeJS.ProcessEnv
}
export type RunAccountLogout = (command: AccountLogoutCommand) => Promise<number | null>

/** No shell, input, stdout, stderr or caller-selected executable. Never installs a CLI. */
export class AccountLogoutProcess {
  static readonly run: RunAccountLogout = command =>
    new Promise((resolve, reject) => {
      const child = spawn(command.executable, [...command.args], {
        cwd: command.home,
        env: command.env,
        shell: false,
        windowsHide: true,
        detached: process.platform !== 'win32',
        stdio: 'ignore',
      })
      let failed = false
      const timer = setTimeout(() => {
        failed = true
        if (process.platform !== 'win32' && child.pid !== undefined) {
          try {
            process.kill(-child.pid, 'SIGKILL')
          } catch {
            child.kill('SIGKILL')
          }
        } else child.kill('SIGKILL')
      }, 15_000)
      timer.unref()
      child.once('error', () => {
        failed = true
      })
      child.once('close', code => {
        clearTimeout(timer)
        if (failed) reject(new Error(FAILURE))
        else resolve(code)
      })
    })

  static readonly environment = (environment: NodeJS.ProcessEnv, kind: 'codex' | 'claude', home: string): NodeJS.ProcessEnv => {
    const env: NodeJS.ProcessEnv = { NO_COLOR: '1', TERM: 'dumb' }
    for (const key of ENVIRONMENT_KEYS) if (environment[key] !== undefined) env[key] = environment[key]
    // Never resolve a CLI from the selected credential directory through an empty/relative PATH segment.
    env.PATH = (environment.PATH ?? '')
      .split(delimiter)
      .filter(path => path.startsWith('/'))
      .join(delimiter)
    if (kind === 'claude') return ClaudeAccountModel.cliEnvironment({ environment: env, configDir: home })
    env['CODEX_HOME'] = home
    return env
  }
}

export interface AccountSessionFiles {
  validateCodex(layout: CodexHomeLayout): Promise<void>
  finishCodexLogout(layout: CodexHomeLayout): Promise<void>
  validateClaude(home: string): Promise<void>
  isClaudeSignedIn(home: string): Promise<boolean>
}

export class AccountSessionFilePolicy {
  /** File ownership is Host-derived, never caller-provided. Readable directories are allowed; other-user writes are not. */
  static readonly assertOwned = (stat: Pick<Stats, 'uid' | 'mode'>): void => {
    const uid = process.getuid?.()
    if (uid === undefined || stat.uid !== uid || (stat.mode & 0o022) !== 0) throw new Error(FAILURE)
  }
}
const assertRealDirectory = async (path: string): Promise<void> => {
  const stat = await lstat(path)
  if ((await realpath(path)) !== path || !stat.isDirectory()) throw new Error(FAILURE)
  AccountSessionFilePolicy.assertOwned(stat)
  // An attacker-writable ancestor can replace even a private selected directory. Root-owned sticky /tmp is safe for owned children.
  for (let parent = dirname(path); ; parent = dirname(parent)) {
    const ancestor = await lstat(parent)
    const uid = process.getuid?.()
    const trustedOwner = uid !== undefined && (ancestor.uid === uid || ancestor.uid === 0)
    const stickyRoot = ancestor.uid === 0 && (ancestor.mode & 0o1000) !== 0
    if (!ancestor.isDirectory() || !trustedOwner || ((ancestor.mode & 0o022) !== 0 && !stickyRoot)) throw new Error(FAILURE)
    if (dirname(parent) === parent) break
  }
}
const assertPrivateFile = async (path: string): Promise<void> => {
  try {
    const stat = await lstat(path)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error(FAILURE)
    AccountSessionFilePolicy.assertOwned(stat)
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
  }
}
export const createAccountSessionFiles = (): AccountSessionFiles => {
  const codex = createCodexLoginFiles(path => AccountHomePolicy.isManagedSetupHome(path, 'codex'))
  return {
    validateCodex: async layout => {
      await assertRealDirectory(layout.effectiveHomePath)
      await assertPrivateFile(join(layout.effectiveHomePath, 'auth.json'))
      await codex.auth(layout)
    },
    finishCodexLogout: async layout => {
      await assertRealDirectory(layout.effectiveHomePath)
      await assertPrivateFile(join(layout.effectiveHomePath, 'auth.json'))
      await codex.auth(layout)
      // A missing overlay auth file would be seeded from the shared login on the next inference.
      // Exclusive creation cannot overwrite a concurrently saved credential. Never touch the shared home.
      try {
        await writeFile(join(layout.effectiveHomePath, 'auth.json'), '{}\n', { flag: 'wx', mode: 0o600 })
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error
      }
      await assertRealDirectory(layout.effectiveHomePath)
      await assertPrivateFile(join(layout.effectiveHomePath, 'auth.json'))
      if ((await codex.auth(layout)).hasCredential) throw new Error(FAILURE)
    },
    validateClaude: async home => {
      await assertRealDirectory(home)
      await assertPrivateFile(join(home, '.credentials.json'))
      const configuration = home === ClaudeAccountModel.resolveClaudeConfigDir('') ? join(dirname(home), '.claude.json') : join(home, '.claude.json')
      await assertPrivateFile(configuration)
    },
    isClaudeSignedIn: async home => (await claudeAccountService.describeAuth({ configDir: home, keyEnv: '', now: Date.now() })).signedIn,
  }
}

const executableAvailable = async (executable: string, environment: NodeJS.ProcessEnv): Promise<boolean> => {
  for (const directory of (environment.PATH ?? '').split(delimiter).filter(path => path.startsWith('/'))) {
    try {
      await access(join(directory, executable), constants.X_OK)
      return true
    } catch {
      /* Try the next trusted PATH entry. */
    }
  }
  return false
}

type LogoutPlan =
  | { readonly kind: 'codex'; readonly layout: CodexHomeLayout; readonly scope: string }
  | { readonly kind: 'claude'; readonly home: string; readonly scope: string }
  | { readonly kind: 'key'; readonly reference: string; readonly scope: string }
  | { readonly kind: 'copilot'; readonly scope: string }

type PlanResult = { readonly plan: LogoutPlan } | { readonly reason: string }

/** Injection seams make tests credential-free; production only uses supported CLI / credential-provider operations. */
export const createAccountSessionService = (input: {
  readonly readAccounts: () => Promise<AccountStoreFile>
  readonly credentials: SessionCredentials | undefined
  readonly copilot: { readonly writable: (id: string) => Promise<boolean>; readonly signOut: (id: string) => Promise<void> }
  readonly isBusy: (account: AccountDraft) => boolean
  readonly onSignedOut: (account: AccountDraft) => Promise<void>
  readonly environment?: NodeJS.ProcessEnv
  readonly files?: AccountSessionFiles
  readonly run?: RunAccountLogout
  readonly executableAvailable?: (executable: string, environment: NodeJS.ProcessEnv) => Promise<boolean>
}) => {
  const environment = input.environment ?? process.env
  const files = input.files ?? createAccountSessionFiles()
  const run = input.run ?? AccountLogoutProcess.run
  const available = input.executableAvailable ?? executableAvailable
  const plan = async (account: AccountDraft, file: AccountStoreFile): Promise<PlanResult> => {
    if (input.isBusy(account)) return { reason: BUSY }
    if (account.kind === 'claude' && environment.CLAUDE_CODE_OAUTH_TOKEN?.trim())
      return {
        reason: 'The Host supplies CLAUDE_CODE_OAUTH_TOKEN externally. Remove or update that environment source manually; CLI logout cannot sign it out.',
      }
    if (account.kind === 'github-copilot') {
      if (!(await input.copilot.writable(account.instanceId))) return { reason: 'The account-owned Copilot credential store is unavailable or read-only.' }
      return { plan: { kind: 'copilot', scope: 'The DSH-owned GitHub Copilot credential for this account only.' } }
    }
    if (account.kind === 'codex') {
      try {
        const layout = AccountHomePolicy.codexLayoutFor(account, file.shadowRoot)
        const home = layout.effectiveHomePath
        if (
          home === join(CodexHomeModel.accountHome(), '.codex') ||
          file.accounts.some(other => {
            if (other.instanceId === account.instanceId || other.kind !== 'codex') return false
            const otherLayout = AccountHomePolicy.codexLayoutFor(other, file.shadowRoot)
            return home === otherLayout.effectiveHomePath || home === otherLayout.sharedHomePath
          })
        )
          return { reason: 'This Codex credential home is shared. Sign out manually in the owning CLI; DSH will not change another profile’s login.' }
        if (await AccountCredentialHomeWork.isBusy(home))
          return { reason: 'This Codex credential home is busy with an active credential read, refresh or sign-out. Wait for it to finish and retry.' }
        await files.validateCodex(layout)
        if (!(await available(CODEX_LOGIN_EXECUTABLE, environment)))
          return { reason: 'The official Codex CLI is not installed on the Host. Sign out is unavailable; DSH does not install it automatically.' }
        return { plan: { kind: 'codex', layout, scope: `The private Codex file credential at ${home}. Shared Codex credentials are preserved.` } }
      } catch {
        return { reason: 'A validated private Codex credential home is required. Unsafe or unreadable paths cannot be signed out here.' }
      }
    }
    const reference = account.apiKeyEnv.trim()
    if (reference !== '' && account.authSource !== 'cli') {
      if (!/^CONNECTION_[A-F0-9]{32}_API_KEY$/u.test(reference) || input.credentials === undefined || account.authSource !== 'reference')
        return { reason: EXTERNAL }
      if (file.accounts.some(other => other.instanceId !== account.instanceId && other.apiKeyEnv === reference))
        return { reason: 'This credential reference is shared by several accounts. Update its source manually.' }
      const info = await input.credentials.describe(credentialRef(reference))
      if (!info.writable || (info.configured && info.source !== 'file') || environment[reference]?.trim()) return { reason: EXTERNAL }
      // Claude falls back to its CLI login after unsetting a key; never claim that clearing just one source signs it out.
      if (account.kind === 'claude') {
        const home = ClaudeAccountModel.resolveClaudeConfigDir(account.homePath)
        if (await files.isClaudeSignedIn(home))
          return { reason: 'This account also has a Claude CLI login. Sign out that login manually before removing its saved key.' }
      }
      return {
        plan: { kind: 'key', reference, scope: `Only the private DSH-stored credential ${reference}. The external vault and environment are not changed.` },
      }
    }
    if (account.kind === 'claude') {
      const home = ClaudeAccountModel.resolveClaudeConfigDir(account.homePath)
      if (
        file.accounts.some(
          other => other.instanceId !== account.instanceId && other.kind === 'claude' && ClaudeAccountModel.resolveClaudeConfigDir(other.homePath) === home,
        )
      )
        return { reason: 'This Claude configuration directory is shared by several accounts. Sign out manually in the owning CLI.' }
      try {
        await files.validateClaude(home)
      } catch {
        return { reason: 'A real, non-symlinked Claude configuration directory is required for sign out.' }
      }
      if (!(await available('claude', environment))) return { reason: 'The official Claude CLI is not installed on the Host. Sign out is unavailable.' }
      return {
        plan: {
          kind: 'claude',
          home,
          scope: `The Claude Code login in ${home}, including its CLI-owned credential store. Other configuration directories are not changed.`,
        },
      }
    }
    if (account.kind === 'commandcode' || account.kind === 'cursor')
      return {
        reason: `${account.kind === 'cursor' ? 'Cursor Agent' : 'Command Code'} currently uses a shared global CLI login. Run ${account.kind === 'cursor' ? 'cursor-agent logout' : 'cmd logout'} manually; DSH cannot safely scope that command to this profile.`,
      }
    return { reason: EXTERNAL }
  }
  const capability = async (instanceId: string): Promise<AccountSessionCapability> => {
    try {
      const file = await input.readAccounts()
      const account = file.accounts.find(candidate => candidate.instanceId === instanceId)
      if (account === undefined) return { instanceId, available: false, reason: 'This saved account is no longer available.', credentialScope: null }
      const result = await plan(account, file)
      if ('reason' in result) return { instanceId, available: false, reason: result.reason, credentialScope: null }
      return { instanceId, available: true, reason: null, credentialScope: result.plan.scope }
    } catch {
      return { instanceId, available: false, reason: 'Sign-out capability could not be checked. No credential was changed.', credentialScope: null }
    }
  }
  return {
    capability,
    signOut: (request: { readonly instanceId: string; readonly confirm: true }): Promise<{ signedOut: true }> =>
      withSpan('account sign out', { attributes: pluginAttributes({ plugin: 'ai-accounts', attributes: { operation: 'sign-out' } }) }, async span => {
        if (request.confirm !== true) throw new Error('Explicit sign-out confirmation is required.')
        const file = await input.readAccounts().catch(() => {
          throw new Error(FAILURE)
        })
        const account = file.accounts.find(candidate => candidate.instanceId === request.instanceId)
        if (account === undefined) throw new Error('This saved account is no longer available.')
        const result = await plan(account, file).catch((): PlanResult => ({ reason: FAILURE }))
        if ('reason' in result) throw new Error(result.reason)
        if (input.isBusy(account)) throw new Error(BUSY)
        const selected = result.plan
        span.setAttributes(pluginAttributes({ plugin: 'ai-accounts', attributes: { provider: account.kind, credential_store: selected.kind } }))
        try {
          if (selected.kind === 'copilot') await input.copilot.signOut(account.instanceId)
          else if (selected.kind === 'key') {
            if (input.credentials === undefined) throw new Error(FAILURE)
            await input.credentials.unset(credentialRef(selected.reference))
            if ((await input.credentials.describe(credentialRef(selected.reference))).configured) throw new Error(FAILURE)
          } else {
            const home = selected.kind === 'codex' ? selected.layout.effectiveHomePath : selected.home
            await AccountCredentialHomeWork.run(home, async () => {
              if (selected.kind === 'codex') await files.validateCodex(selected.layout)
              else await files.validateClaude(home)
              if (input.isBusy(account)) throw new Error(BUSY)
              const code = await run({
                executable: selected.kind === 'codex' ? CODEX_LOGIN_EXECUTABLE : 'claude',
                args: selected.kind === 'codex' ? ['-c', 'cli_auth_credentials_store="file"', 'logout'] : ['auth', 'logout'],
                home,
                env: AccountLogoutProcess.environment(environment, selected.kind, home),
              })
              if (code !== 0) throw new Error(FAILURE)
              if (selected.kind === 'codex') await files.finishCodexLogout(selected.layout)
              else {
                await files.validateClaude(home)
                if (await files.isClaudeSignedIn(home)) throw new Error(FAILURE)
              }
            })
          }
        } catch {
          throw new Error(FAILURE)
        }
        await input.onSignedOut(account)
        return { signedOut: true }
      }),
  }
}
export type AccountSessionService = ReturnType<typeof createAccountSessionService>
