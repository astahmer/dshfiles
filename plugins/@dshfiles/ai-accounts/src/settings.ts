import Schema from '@deepseek-ai/schemastery'
import { defineSettings } from '@dshfiles/dshx/settings'

/**
 * Preferences for the accounts page and its quota surfaces. Account profiles
 * stay in the accounts file and the history schedule in the usage domain; this
 * namespace only holds how the Client behaves.
 */
export const aiAccountsSettings = defineSettings({
  namespace: 'ai-accounts',
  schema: Schema.object({
    /** `auto` writes each edit after a short pause; `manual` keeps Save and Revert. */
    saveMode: Schema.union(['auto', 'manual']).default('auto'),
    /** Pause after the last keystroke before an automatic save. */
    autoSaveDelayMs: Schema.natural().min(200).max(10_000).default(800),
    /** How often open quota surfaces ask the Host for fresh usage. */
    usageRefreshSeconds: Schema.natural().min(15).max(3_600).default(60),
    /** The compact usage button in the sidebar footer. */
    footerButton: Schema.boolean().default(true),
    /** The draggable usage tab pinned to a window edge. */
    edgeWidget: Schema.boolean().default(true),
    /** Show the accounts block on Settings › Models. */
    modelsPageAccounts: Schema.boolean().default(true),
  }),
  applies: 'live',
})

export type SaveMode = 'auto' | 'manual'

export const DEFAULT_CLIENT_SETTINGS = {
  saveMode: 'auto',
  autoSaveDelayMs: 800,
  usageRefreshSeconds: 60,
  footerButton: true,
  edgeWidget: true,
  modelsPageAccounts: true,
} as const satisfies {
  readonly saveMode: SaveMode
  readonly autoSaveDelayMs: number
  readonly usageRefreshSeconds: number
  readonly footerButton: boolean
  readonly edgeWidget: boolean
  readonly modelsPageAccounts: boolean
}
