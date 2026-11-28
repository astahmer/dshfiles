import { isAbsolute, join } from 'node:path'
import { homedir } from 'node:os'
import type { ThinkingLevelMap } from '@earendil-works/pi-ai'
import { vibeBridge, type UsageCard, type VibeBridge } from './api.js'
import type { CredentialValueResolver } from './credentials.js'
import { MistralAccountModel } from './mistral-account.js'
import { ShellCommand } from './shell-command.js'

/**
 * Mistral Vibe through the official `vibe` CLI, with the login `vibe --setup` stored.
 *
 * A Mistral plan bills two separate included buckets: the API credit, which every plain API-key request draws
 * (`/v1/chat/completions`, the `mistral` kind), and the Vibe & Studio allowance, which only the Vibe CLI itself draws.
 * An account of this kind therefore publishes a route that runs `vibe` per DSH step instead of sending HTTP, so a
 * thread can spend the allowance the API route cannot reach. The CLI keeps its own model catalog (below), its own
 * reasoning levels and its own usage report; DSH reads them rather than guessing.
 */

export const VIBE_KIND = 'vibe'

const VIBE_LOGIN_HINT = 'vibe --setup   # choose Launch browser and sign in with your Mistral plan, then retry this route'
/** A model Vibe 3.1.5 lists locally (`$VIBE_HOME/model_catalog_cache.json`, `vibe --model`), with its own aliases. */
interface VibeModelEntry {
  readonly id: string
  /** The names `vibe --model` also accepts for this model. */
  readonly aliases: readonly string[]
  readonly name: string
  /** The thinking levels the CLI's catalog offers this model; empty means the model has none. */
  readonly thinking: readonly string[]
  readonly contextWindow: number
  readonly vision: boolean
}

const VIBE_CATALOG: readonly VibeModelEntry[] = [
  {
    id: 'mistral-large-4-0',
    aliases: ['mistral-large-4', 'mistral-large-4-0-3'],
    name: 'Mistral Large 4',
    thinking: ['low', 'medium', 'high'],
    contextWindow: 1_048_576,
    vision: true,
  },
  {
    id: 'mistral-medium-latest',
    aliases: ['mistral-medium', 'mistral-medium-3.5', 'mistral-vibe-cli-latest'],
    name: 'Mistral Medium 3.5',
    thinking: ['high'],
    contextWindow: 262_144,
    vision: true,
  },
  {
    id: 'zai-glm-5-3',
    aliases: ['glm-5-3', 'zai-glm-5', 'zai-glm-latest'],
    name: 'GLM 5.3 (Mistral Hosted)',
    thinking: ['low', 'high', 'max'],
    contextWindow: 1_048_576,
    vision: false,
  },
  {
    id: 'zai-glm-5-3-flash',
    aliases: ['zai-glm-5-3-flash-vibe-free'],
    name: 'GLM 5.3 Flash (Mistral Hosted)',
    thinking: ['low', 'high', 'max'],
    contextWindow: 1_048_576,
    vision: true,
  },
  {
    id: 'deepseek-v4-1-flash-1017',
    aliases: [],
    name: 'DeepSeek V4.1 Flash',
    thinking: ['low', 'high', 'max'],
    contextWindow: 1_048_576,
    vision: true,
  },
]

/** A `--model` value Vibe's catalog knows: the id itself or one of its aliases. */
const canonicalModelId = (value: string): string => {
  const trimmed = value.trim()
  const entry = VIBE_CATALOG.find(candidate => candidate.id === trimmed || candidate.aliases.includes(trimmed))
  return entry?.id ?? trimmed
}

/** Vibe's own level names, as `--thinking` takes them; a level the model does not list is left out. */
const thinkingLevelMap = (levels: readonly string[]): ThinkingLevelMap => {
  const offered = (level: string): string | null => (levels.includes(level) ? level : null)
  return {
    off: offered('off'),
    minimal: null,
    low: offered('low'),
    medium: offered('medium'),
    high: offered('high'),
    xhigh: offered('xhigh'),
    max: offered('max'),
  }
}

const vibeHome = (env: NodeJS.ProcessEnv = process.env): string => {
  const configured = env['VIBE_HOME']?.trim() ?? ''
  return configured !== '' && isAbsolute(configured) ? configured : join(homedir(), '.vibe')
}

/** The VIBE_HOME a route runs with: the account's own folder, or the Host user's default Vibe profile. */
const resolveHome = (homePath: string): string => {
  const trimmed = homePath.trim()
  if (trimmed === '') return vibeHome()
  if (trimmed === '~') return homedir()
  if (trimmed.startsWith('~/')) return join(homedir(), trimmed.slice(2))
  return trimmed
}

/**
 * Vibe's own key, read where the CLI stores it, for the account status and the quota read. The route itself never uses
 * this value: `vibe` authenticates with its login inside the process it spawns.
 */
const readLogin = async (home: string): Promise<string> => MistralAccountModel.readVibeKey({ directory: home })

export class VibeAccountModel {
  static readonly loginHint = VIBE_LOGIN_HINT
  /** The stored bridge, or the default for an account that never chose one. */
  static readonly bridge = (value: VibeBridge | undefined): VibeBridge => vibeBridge(value)
  /** `vibe --setup` as the user types it for this account's VIBE_HOME. */
  static readonly command = (home: string): string => {
    const resolved = resolveHome(home)
    return resolved === vibeHome() ? 'vibe --setup' : ShellCommand.withEnvironment('VIBE_HOME', resolved, 'vibe --setup')
  }

  /**
   * The environment a Vibe process runs with: the account's VIBE_HOME, and no inherited API key, which the CLI would
   * bill as API credit instead of drawing the Vibe & Studio allowance the login pays. Its `.env` and keyring stay
   * untouched, since that signed-in session is what these routes exist for.
   */
  static readonly cliEnvironment = (input: { readonly environment: NodeJS.ProcessEnv; readonly home: string }): Readonly<Record<string, string>> => {
    const env: NodeJS.ProcessEnv = { ...input.environment, VIBE_HOME: resolveHome(input.home) }
    delete env['MISTRAL_API_KEY']
    delete env['VIBE_CWD']
    return Object.fromEntries(Object.entries(env).flatMap(([key, value]) => (value === undefined ? [] : [[key, value]])))
  }
  static readonly models = VIBE_CATALOG
  static readonly resolveHome = resolveHome
  static readonly canonicalModelId = canonicalModelId
  static readonly thinkingLevelMap = thinkingLevelMap

  /** Whether this account's VIBE_HOME holds the login `vibe --setup` stored. */
  static readonly signedIn = async (homePath: string, readCliKey?: () => Promise<string>): Promise<boolean> =>
    (readCliKey === undefined ? await readLogin(resolveHome(homePath)) : await readCliKey()).length > 0

  /**
   * Only the Vibe & Studio allowance governs the CLI route. A missing allowance is `unsupported`, never an API-credit
   * fallback or a guessed percentage.
   */
  static readonly readUsage = async (input: {
    readonly homePath: string
    readonly signal?: AbortSignal | undefined
    readonly onAuthenticated?: (() => void) | undefined
    readonly resolveCredential?: CredentialValueResolver | undefined
    readonly readCliKey?: (() => Promise<string>) | undefined
  }): Promise<UsageCard> => {
    const home = resolveHome(input.homePath)
    return MistralAccountModel.readUsage({
      kind: 'vibe',
      keyEnv: '',
      authSource: 'cli',
      resolveCredential: input.resolveCredential,
      onAuthenticated: input.onAuthenticated,
      signal: input.signal,
      readCliKey: input.readCliKey ?? (() => readLogin(home)),
    })
  }
}
