import { mkdirSync, mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import * as Schema from 'effect/Schema'
import { AcpRequestFailed, AcpRpc } from './acp-rpc.js'
import type { AgyLaunch, AntigravityProcessesPromise } from './antigravity-processes.js'
import type { UsageCard } from './api.js'
import { withSpan } from '@dshfiles/dshx/tracing'
import { AiAccountsSchema } from './effect-schema.js'
import { ShellCommand } from './shell-command.js'
import { ProviderUsageModel, type UsageWindow } from './usage.js'

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

export type AntigravityQuotaReading =
  | { readonly status: 'ok'; readonly windows: readonly UsageWindow[] }
  | { readonly status: 'unauthenticated'; readonly detail: string }
  | { readonly status: 'error'; readonly detail: string }

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

const usageBucketSchema = Schema.Struct({
  id: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
  window: Schema.optional(Schema.String),
  remaining_fraction: Schema.Number.check(Schema.isFinite()),
  reset_time: Schema.optional(Schema.String),
})

const usageGroupSchema = Schema.Struct({
  name: Schema.String,
  buckets: Schema.Array(usageBucketSchema),
})

const usageCommandOutputSchema = Schema.Struct({
  status: Schema.String,
  error: Schema.optional(Schema.String),
  command: Schema.optional(
    Schema.Struct({
      name: Schema.String,
      data: Schema.optional(Schema.Struct({ groups: Schema.Array(usageGroupSchema) })),
    }),
  ),
})

const MAX_USAGE_WINDOWS = 6
const USAGE_PROBE_TIMEOUT_MS = 15_000

const windowOrder = (window: string | undefined): number => {
  if (window === '5h') return 0
  if (window === 'weekly') return 1
  return 2
}

const shortGroupName = (name: string): string =>
  name
    .trim()
    .replace(/\s+models$/iu, '')
    .replace(/\s+and\s+/iu, ' / ')

const percentFromFraction = (fraction: number): number => Math.max(0, Math.min(100, Math.round(fraction * 1000) / 10))

const parseResetTime = (value: string | undefined): number | null => {
  if (value === undefined || value.trim() === '') return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

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
  static cliEnvironment = (input: { readonly environment: NodeJS.ProcessEnv; readonly home: string }): AgyLaunch['env'] => {
    const environment: Record<string, string> = {}
    for (const [name, value] of Object.entries(input.environment)) {
      // An API key in the environment would make `agy` bill the Gemini API instead of the plan the login carries.
      if (value !== undefined && name !== 'GEMINI_API_KEY' && name !== 'GOOGLE_API_KEY') environment[name] = value
    }
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
  static describe = (input: {
    readonly home: string
    readonly processes: AntigravityProcessesPromise
    readonly executable?: string
    readonly now?: number
  }): Promise<AntigravityAccountDescription> => {
    const now = input.now ?? Date.now()
    const cached = describeCache.get(input.home)
    if (cached !== undefined && cached.expiresAt > now) return cached.description
    const description = AntigravityAccountModel.probe(input)
    describeCache.set(input.home, { expiresAt: now + DESCRIPTION_TTL_MS, description })
    void AntigravityAccountModel.shortenFailure({ home: input.home, description, now })
    return description
  }

  /**
   * The account's quota card, combining the cached plan from `describe` with live five-hour and weekly buckets from
   * `agy -p /usage --output-format json` (which runs locally with zero turns and zero token spend).
   */
  static readUsage = async (input: {
    readonly describe: () => Promise<AntigravityAccountDescription>
    readonly readQuota?: (() => Promise<AntigravityQuotaReading>) | undefined
    readonly onAuthenticated?: (() => void) | undefined
  }): Promise<UsageCard> => {
    const description = await input.describe()
    if (!description.signedIn) return ProviderUsageModel.emptyUsage('unauthenticated', description.detail)
    input.onAuthenticated?.()
    if (input.readQuota === undefined) {
      return {
        ...ProviderUsageModel.emptyUsage('unsupported', 'Antigravity shows its five-hour and weekly limits only inside the CLI: run `agy` and type /usage.'),
        plan: description.plan ?? null,
      }
    }
    const quota = await input.readQuota()
    if (quota.status === 'unauthenticated') return ProviderUsageModel.emptyUsage('unauthenticated', quota.detail)
    if (quota.status === 'error') return { ...ProviderUsageModel.emptyUsage('error', quota.detail), plan: description.plan ?? null }
    return {
      status: 'ok',
      message: null,
      identity: null,
      plan: description.plan ?? null,
      windows: [...quota.windows],
      bankedResets: 0,
      bankedResetExpiries: [],
    }
  }

  /** Parse the JSON output of `agy -p /usage --output-format json` into quota windows. */
  static parseUsageOutput = (stdout: string, home: string): AntigravityQuotaReading => {
    const lines = stdout
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.startsWith('{'))
    const rawLine = lines.at(-1)
    if (rawLine === undefined) return { status: 'error', detail: 'Antigravity CLI returned no JSON for /usage.' }
    let parsedJson: unknown
    try {
      parsedJson = JSON.parse(rawLine)
    } catch {
      return { status: 'error', detail: 'Antigravity CLI returned unreadable JSON for /usage.' }
    }
    const decoded = AiAccountsSchema.decodeResult(usageCommandOutputSchema, parsedJson)
    if (decoded._tag !== 'Success') return { status: 'error', detail: 'Antigravity CLI returned an unsupported /usage payload.' }
    const output = decoded.success
    if (output.status !== 'SUCCESS' || output.command?.name !== 'usage' || output.command.data === undefined) {
      const error = output.error?.trim() ?? ''
      if (/auth/iu.test(error)) {
        return {
          status: 'unauthenticated',
          detail: `Antigravity CLI is not signed in for this account. Run: ${AntigravityAccountModel.loginHint(home)}`,
        }
      }
      return { status: 'error', detail: error === '' ? 'Antigravity CLI could not read /usage.' : error }
    }
    const windows: UsageWindow[] = []
    const seen = new Set<string>()
    for (const group of output.command.data.groups) {
      const groupName = shortGroupName(group.name)
      const buckets = [...group.buckets].sort((left, right) => windowOrder(left.window) - windowOrder(right.window))
      for (const bucket of buckets) {
        if (windows.length >= MAX_USAGE_WINDOWS) break
        const windowName = bucket.window?.trim() ?? ''
        const fallbackName = bucket.name?.trim() ?? ''
        const rawLabel = windowName !== '' ? `${groupName} ${windowName}` : fallbackName !== '' ? fallbackName : groupName
        const label = rawLabel.slice(0, 32)
        if (label === '' || seen.has(label)) continue
        seen.add(label)
        windows.push({
          label,
          percentRemaining: percentFromFraction(bucket.remaining_fraction),
          resetsAt: parseResetTime(bucket.reset_time),
        })
      }
      if (windows.length >= MAX_USAGE_WINDOWS) break
    }
    return { status: 'ok', windows }
  }

  /**
   * Read the account's live quota buckets with `agy -p /usage --output-format json`. Runs locally with zero turns and
   * zero token usage; aborts immediately if `agy` prompts for interactive sign-in.
   */
  static probeUsage = (input: {
    readonly home: string
    readonly processes: AntigravityProcessesPromise
    readonly executable?: string
    readonly signal?: AbortSignal | undefined
  }): Promise<AntigravityQuotaReading> =>
    withSpan('antigravity usage', { kind: 'client', attributes: { 'process.executable.name': ANTIGRAVITY_EXECUTABLE } }, async span => {
      if (input.signal?.aborted) return { status: 'error', detail: 'Antigravity usage read was cancelled.' }
      const directory = mkdtempSync(join(tmpdir(), 'dsh-agy-usage-'))
      const lines: string[] = []
      let stderr = ''
      let settled = false
      let resolveResult: (reading: AntigravityQuotaReading) => void = () => undefined
      const done = new Promise<AntigravityQuotaReading>(resolve => {
        resolveResult = resolve
      })
      const finish = (reading: AntigravityQuotaReading): void => {
        if (settled) return
        settled = true
        resolveResult(reading)
      }
      const running = input.processes.launch({
        executable: input.executable ?? ANTIGRAVITY_EXECUTABLE,
        args: ['-p', '/usage', '--output-format', 'json'],
        cwd: directory,
        env: AntigravityAccountModel.cliEnvironment({ environment: process.env, home: input.home }),
        onLine: line => {
          lines.push(line)
          if (/authentication required/iu.test(line)) {
            finish({
              status: 'unauthenticated',
              detail: `Antigravity CLI is not signed in for this account. Run: ${AntigravityAccountModel.loginHint(input.home)}`,
            })
          }
        },
        onStderr: text => {
          stderr = `${stderr}${text}`.slice(-2_000)
          if (/authentication required/iu.test(stderr)) {
            finish({
              status: 'unauthenticated',
              detail: `Antigravity CLI is not signed in for this account. Run: ${AntigravityAccountModel.loginHint(input.home)}`,
            })
          }
        },
        onEnd: outcome => {
          if (outcome.kind === 'failed') {
            finish({
              status: 'error',
              detail: outcome.missing
                ? `Antigravity CLI (agy) is not installed on the Host. Install it with: ${ANTIGRAVITY_INSTALL_HINT}`
                : `Antigravity CLI could not read usage: ${outcome.message}`,
            })
            return
          }
          const parsed = AntigravityAccountModel.parseUsageOutput(lines.join('\n'), input.home)
          if (parsed.status === 'ok') {
            finish(parsed)
            return
          }
          if (outcome.code !== 0 && parsed.status === 'error' && stderr.trim() !== '') {
            finish({ status: 'error', detail: `Antigravity CLI /usage failed: ${stderr.trim().slice(0, 200)}` })
            return
          }
          finish(parsed)
        },
      })
      const cancelTimeout = input.processes.after(USAGE_PROBE_TIMEOUT_MS, () => {
        finish({ status: 'error', detail: `Antigravity CLI did not answer /usage within ${String(USAGE_PROBE_TIMEOUT_MS / 1000)} s.` })
      })
      const onAbort = (): void => {
        finish({ status: 'error', detail: 'Antigravity usage read was cancelled.' })
      }
      input.signal?.addEventListener('abort', onAbort, { once: true })
      try {
        const result = await done
        span.setAttribute('antigravity.usage.status', result.status)
        if (result.status === 'ok') span.setAttribute('antigravity.usage.windows', result.windows.length)
        return result
      } finally {
        cancelTimeout()
        input.signal?.removeEventListener('abort', onAbort)
        await running.stop()
        await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }).catch(() => undefined)
      }
    })

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
  static probe = (input: {
    readonly home: string
    readonly processes: AntigravityProcessesPromise
    readonly executable?: string
  }): Promise<AntigravityAccountDescription> =>
    withSpan('antigravity describe', { kind: 'client', attributes: { 'process.executable.name': ANTIGRAVITY_EXECUTABLE } }, async span => {
      const directory = mkdtempSync(join(tmpdir(), 'dsh-agy-probe-'))
      const geminiDir = join(directory, 'gemini')
      mkdirSync(geminiDir, { recursive: true })
      // The handlers run only once agy writes, after `rpc` below exists.
      const running = input.processes.launch({
        executable: input.executable ?? ANTIGRAVITY_EXECUTABLE,
        args: ['acp', '--gemini-dir', geminiDir, '--disable-telemetry'],
        cwd: directory,
        env: AntigravityAccountModel.cliEnvironment({ environment: process.env, home: input.home }),
        onLine: line => rpc.accept(line),
        onStderr: () => undefined,
        onEnd: outcome => rpc.close(new Error(outcome.kind === 'failed' && outcome.missing ? 'ENOENT: agy is not installed' : 'agy exited before it answered')),
      })
      const rpc = new AcpRpc({ send: line => running.send(line), onNotification: () => undefined, onRequest: () => undefined })
      const cancelTimeout = input.processes.after(PROBE_TIMEOUT_MS, () => rpc.close(new Error(`no answer within ${String(PROBE_TIMEOUT_MS / 1000)} s`)))
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
        cancelTimeout()
        rpc.close(new Error('probe finished'))
        await running.stop()
        await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }).catch(() => undefined)
      }
    })
}
