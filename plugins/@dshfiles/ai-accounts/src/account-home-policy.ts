import { homedir } from 'node:os'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { accountRouteSlugSchema } from './account-draft.js'
import type { AccountDraft } from './api.js'
import { CodexHomeModel, type CodexHomeLayout } from './codex-home.js'

// Trusted Host configuration, captured once just like the account store itself.
const STORE_PATH = resolve(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'plugins', 'ai-accounts', 'accounts.json')

/** One ownership/layout policy for store observation, provider routes and login filesystem checks. No store dependency. */
export class AccountHomePolicy {
  /** Cleanup owns a root only while no explicitly selected home is that root or one of its descendants. */
  static containsConfiguredHome = (root: string, configured: string): boolean => {
    if (configured.trim() === '') return false
    const expanded = configured.startsWith('~/') ? join(CodexHomeModel.accountHome(), configured.slice(2)) : configured
    const path = resolve(expanded)
    const owned = resolve(root)
    return path === owned || path.startsWith(`${owned}${sep}`)
  }

  static readonly filePath = (): string => STORE_PATH

  /** Lexical ownership only; filesystem writers must separately refuse symlinks before touching credentials. */
  static readonly isManagedSetupHome = (path: string, kind: 'codex' | 'claude'): boolean => {
    if (kind !== 'codex' && kind !== 'claude') return false
    const ownedRoot = resolve(dirname(STORE_PATH), 'homes')
    if (path !== resolve(path) || dirname(path) !== ownedRoot || !path.startsWith(`${ownedRoot}${sep}`)) return false
    const instanceId = basename(path)
    const prefix = `${kind}_work_`
    return accountRouteSlugSchema.safeParse(instanceId).success && instanceId.startsWith(prefix) && /^[a-f0-9]{32}$/u.test(instanceId.slice(prefix.length))
  }

  static readonly codexLayoutFor = (profile: Pick<AccountDraft, 'homePath' | 'shadowHomePath' | 'instanceId'>, shadowRoot: string): CodexHomeLayout => {
    const privateHome = resolve(dirname(STORE_PATH), 'homes', profile.instanceId)
    // Only valid generated ids and the exact store-owned pair bypass legacy containment/overlay.
    // A scratch DSH_HOME can live outside the OS home without seeding the user's real Codex auth.
    if (
      accountRouteSlugSchema.safeParse(profile.instanceId).success &&
      profile.instanceId === basename(privateHome) &&
      AccountHomePolicy.isManagedSetupHome(profile.homePath, 'codex') &&
      profile.homePath === privateHome &&
      profile.shadowHomePath === privateHome
    ) {
      return { mode: 'direct', sharedHomePath: privateHome, effectiveHomePath: privateHome }
    }
    return CodexHomeModel.resolveLayout({
      homePath: profile.homePath,
      shadowHomePath: profile.shadowHomePath.trim().length > 0 ? profile.shadowHomePath : join(shadowRoot.replace(/\/$/u, ''), profile.instanceId),
    })
  }
}
