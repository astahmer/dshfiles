import { spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import * as Schema from 'effect/Schema'
import { AcpRequestFailed, AcpRpc } from './acp-rpc.js'
import type { UsageCard } from './api.js'
import { withSpan } from '@dshfiles/dshx/tracing'
import { AiAccountsSchema } from './effect-schema.js'
import { ShellCommand } from './shell-command.js'
import { ProviderUsageModel } from './usage.js'

/**
 * Antigravity (Google AI plan) accounts.
 *
 * Google serves its individual plans (free, AI Pro, AI Ultra) to coding agents only through its own Antigravity CLI,
 * `agy`; Gemini CLI stopped serving them on 2026-06-18. DSH never reads or reuses the CLI's sign-in: it runs `agy acp`,
 * the Agent Client Protocol server Google documents for editors, and lets that process talk to Google. The login lives
 * under the account's home (`~/.gemini` by default), written by `agy acp --login`.
 */

export const ANTIGRAVITY_KIND = 'antigravity'
export const ANTIGRAVITY_EXECUTABLE = 'agy'
export const ANTIGRAVITY_INSTALL_HINT = 'curl -fsSL https://antigravity.google/cli/install.sh | bash'
/** Placeholder credential for pi-ai: `agy` authenticates with its own login, so the route never sends an HTTP token. */
export const ANTIGRAVITY_CLI_TOKEN = 'antigravity-cli-login'

/** ACP's thought levels in increasing order; `agy` offers a model only some of them. */
export const ANTIGRAVITY_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
export type AntigravityLevel = (typeof ANTIGRAVITY_LEVELS)[number]

export interface AntigravityModelEntry {
  readonly id: string
  readonly name: string
  /** Thought levels `agy` accepts for this model, in increasing order. */
  readonly levels: readonly AntigravityLevel[]
}

export type AntigravityAccountDescription =
  | {
      readonly signedIn: true
      /** The plan `agy` reports, e.g. "Google AI Pro" or "Antigravity Starter Quota". */
      readonly plan: string | undefined
      readonly models: readonly AntigravityModelEntry[]
    }
  | { readonly signedIn: false; readonly detail: string }

const configOptionSchema = Schema.Struct({
  id: Schema.String,
  currentValue: Schema.optional(Schema.Unknown),
  options: Schema.optional(Schema.Array(Schema.Struct({ value: Schema.String, name: Schema.optional(Schema.String) }))),
})
export const configOptionsSchema = Schema.Array(configOptionSchema)
export type AcpConfigOptions = typeof configOptionsSchema.Type

const newSessionSchema = Schema.Struct({
  sessionId: Schema.String,
  configOptions: Schema.optional(configOptionsSchema),
  _meta: Schema.optional(
    Schema.Struct({
      antigravity: Schema.optional(Schema.Struct({ tier: Schema.optional(Schema.Struct({ name: Schema.optional(Schema.String) })) })),
    }),
  ),
})
const configUpdateSchema = Schema.Struct({ configOptions: configOptionsSchema })

const isLevel = (value: string): value is AntigravityLevel => ANTIGRAVITY_LEVELS.some(level => level === value)

/** How long one account description is reused before `agy` is asked again; a failure is retried sooner. */
const DESCRIPTION_TTL_MS = 10 * 60_000
const FAILURE_TTL_MS = 30_000
const PROBE_TIMEOUT_MS = 60_000

const expandHome = (value: string): string => (value === '~' ? homedir() : value.startsWith('~/') ? join(homedir(), value.slice(2)) : value)

/** Reports a probe that could not start or finish as the user's next step, never as a raw spawn error. */
const probeFailure = (error: unknown, home: string): string => {
  if (error instanceof AcpRequestFailed && /auth/iu.test(error.message))
    return `Antigravity CLI is not signed in for this account. Run: ${AntigravityAccountModel.loginHint(home)}`
  const message = error instanceof Error ? error.message : String(error)
  if (/ENOENT/u.test(message)) return `Antigravity CLI (agy) is not installed on the Host. Install it with: ${ANTIGRAVITY_INSTALL_HINT}`
  return `Antigravity CLI could not describe this account: ${message}`
}

const describeCache = new Map<string, { readonly expiresAt: number; readonly description: Promise<AntigravityAccountDescription> }>()

export class AntigravityAccountModel {
  /** The values one select option offers, such as every model id or every thought level. */
  static optionValues = (options: AcpConfigOptions | undefined, id: string): readonly string[] =>
    options?.find(option => option.id === id)?.options?.map(choice => choice.value) ?? []

  /** The thought levels the selected model accepts. */
  static levelsOf = (options: AcpConfigOptions | undefined): readonly AntigravityLevel[] =>
    AntigravityAccountModel.optionValues(options, 'thought_level').filter(isLevel)

  /** Stop `child` and resolve once it has exited, or after a grace period if it ignores the signal. */
  static stopChild = (child: ChildProcess): Promise<void> =>
    new Promise(resolve => {
      if (child.exitCode !== null || child.signalCode !== null) {
        resolve()
        return
      }
      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        resolve()
      }, 5_000)
      timer.unref()
      child.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
      child.kill()
    })

  /** The HOME `agy` runs with for this account; empty means the Host user's own home and its `~/.gemini` login. */
  static resolveHome = (homePath: string): string => {
    const trimmed = homePath.trim()
    return trimmed === '' ? homedir() : resolve(expandHome(trimmed))
  }

  /** `agy` with `args`, as the user types it for this account's home. */
  static command = (home: string, args = ''): string => {
    const command = args === '' ? ANTIGRAVITY_EXECUTABLE : `${ANTIGRAVITY_EXECUTABLE} ${args}`
    return home === homedir() ? command : ShellCommand.withEnvironment('HOME', home, command)
  }

  static loginHint = (home: string): string => AntigravityAccountModel.command(home, 'acp --login')

  /** `agy` finds its login under `$HOME/.gemini`, so a separate account is a separate HOME. */
  static cliEnvironment = (input: { readonly environment: NodeJS.ProcessEnv; readonly home: string }): NodeJS.ProcessEnv => {
    const environment = { ...input.environment }
    // An API key in the environment would make `agy` bill the Gemini API instead of the plan the login carries.
    delete environment['GEMINI_API_KEY']
    delete environment['GOOGLE_API_KEY']
    if (input.home !== homedir()) environment['HOME'] = input.home
    return environment
  }

  /** The thought level `agy` accepts closest to the one asked for: that level, else the highest one below it, else the lowest. */
  static clampLevel = (requested: AntigravityLevel, offered: readonly AntigravityLevel[]): AntigravityLevel | undefined => {
    if (offered.includes(requested)) return requested
    const rank = ANTIGRAVITY_LEVELS.indexOf(requested)
    return [...offered].reverse().find(level => ANTIGRAVITY_LEVELS.indexOf(level) < rank) ?? offered[0]
  }

  /** Sign-in state, plan and models of the login under `home`, cached for a while per home. */
  static describe = (input: { readonly home: string; readonly executable?: string; readonly now?: number }): Promise<AntigravityAccountDescription> => {
    const now = input.now ?? Date.now()
    const cached = describeCache.get(input.home)
    if (cached !== undefined && cached.expiresAt > now) return cached.description
    const description = AntigravityAccountModel.probe(input)
    describeCache.set(input.home, { expiresAt: now + DESCRIPTION_TTL_MS, description })
    void AntigravityAccountModel.shortenFailure({ home: input.home, description, now })
    return description
  }

  /**
   * The account's quota card. `agy` shows its plan's five-hour and weekly windows only in its own `/usage` panel, and
   * ACP does not expose them, so the card names the plan and says where to look rather than inventing a percentage.
   */
  static readUsage = async (input: {
    readonly home: string
    readonly executable?: string
    readonly onAuthenticated?: (() => void) | undefined
  }): Promise<UsageCard> => {
    const description = await AntigravityAccountModel.describe(input)
    if (!description.signedIn) return ProviderUsageModel.emptyUsage('unauthenticated', description.detail)
    input.onAuthenticated?.()
    return {
      ...ProviderUsageModel.emptyUsage('unsupported', 'Antigravity shows its five-hour and weekly limits only inside the CLI: run `agy` and type /usage.'),
      plan: description.plan ?? null,
    }
  }

  /** A failed description is asked again sooner than a successful one, since a sign-in usually follows it. */
  private static shortenFailure = async (input: {
    readonly home: string
    readonly description: Promise<AntigravityAccountDescription>
    readonly now: number
  }): Promise<void> => {
    const result = await input.description
    if (!result.signedIn && describeCache.get(input.home)?.description === input.description)
      describeCache.set(input.home, { expiresAt: input.now + FAILURE_TTL_MS, description: input.description })
  }

  /** Forget a cached description, after a sign-in or sign-out. */
  static forget = (home: string): void => {
    describeCache.delete(home)
  }

  /**
   * Open one ACP session in a scratch folder and read what `agy` offers: the plan, every model, and each model's thought
   * levels (they change with the selected model). Nothing is prompted, so no quota is spent.
   */
  static probe = (input: { readonly home: string; readonly executable?: string }): Promise<AntigravityAccountDescription> =>
    withSpan('antigravity describe', { kind: 'client', attributes: { 'process.executable.name': ANTIGRAVITY_EXECUTABLE } }, async span => {
      const directory = mkdtempSync(join(tmpdir(), 'dsh-agy-probe-'))
      const geminiDir = join(directory, 'gemini')
      mkdirSync(geminiDir, { recursive: true })
      const child = spawn(input.executable ?? ANTIGRAVITY_EXECUTABLE, ['acp', '--gemini-dir', geminiDir, '--disable-telemetry'], {
        cwd: directory,
        env: AntigravityAccountModel.cliEnvironment({ environment: process.env, home: input.home }),
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      const rpc = new AcpRpc({ from: child.stdout, to: child.stdin, onNotification: () => undefined, onRequest: () => undefined })
      const timer = setTimeout(() => rpc.close(new Error(`no answer within ${String(PROBE_TIMEOUT_MS / 1000)} s`)), PROBE_TIMEOUT_MS)
      timer.unref()
      child.on('error', error => rpc.close(error))
      child.on('exit', code => rpc.close(new Error(`agy exited with ${String(code)}`)))
      try {
        await rpc.request('initialize', {
          protocolVersion: 1,
          clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
          clientInfo: { name: 'dsh', version: '1' },
        })
        const created = AiAccountsSchema.decodeResult(newSessionSchema, await rpc.request('session/new', { cwd: directory, mcpServers: [] }))
        if (created._tag !== 'Success') return { signedIn: false, detail: 'Antigravity CLI answered session/new with an unexpected shape.' }
        const session = created.success
        const modelChoices = session.configOptions?.find(option => option.id === 'model')?.options ?? []
        const models: AntigravityModelEntry[] = []
        for (const choice of modelChoices) {
          const updated = AiAccountsSchema.decodeResult(
            configUpdateSchema,
            await rpc.request('session/set_config_option', { sessionId: session.sessionId, configId: 'model', value: choice.value }),
          )
          models.push({
            id: choice.value,
            name: choice.name ?? choice.value,
            levels: updated._tag === 'Success' ? AntigravityAccountModel.levelsOf(updated.success.configOptions) : [],
          })
        }
        span.setAttribute('antigravity.models', models.length)
        return { signedIn: true, plan: session._meta?.antigravity?.tier?.name, models }
      } catch (error) {
        span.setAttribute('antigravity.signed_in', false)
        return { signedIn: false, detail: probeFailure(error, input.home) }
      } finally {
        clearTimeout(timer)
        rpc.close(new Error('probe finished'))
        await AntigravityAccountModel.stopChild(child)
        // `agy` and its worker may still be flushing into the folder as they exit.
        await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }).catch(() => undefined)
      }
    })
}
