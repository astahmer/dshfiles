import { execFile } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as Schema from 'effect/Schema'
import { withSpan } from '@dshfiles/dshx/tracing'
import { ClaudeAccountModel } from './claude-account.js'
import { AiAccountsSchema } from './effect-schema.js'

/** Private subprocess result: never returned from account APIs or included in an error. */
export type ClaudeAuthStatusRunner = (input: {
  readonly environment: NodeJS.ProcessEnv
  readonly signal: AbortSignal
}) => Promise<{ readonly exitCode: number; readonly stdout: string }>

/** Runs the fixed status command; `claude` is the only executable and the args are not a parameter. */
export type ClaudeAuthStatusExec = (
  input: { readonly args: readonly string[]; readonly cwd: string; readonly environment: NodeJS.ProcessEnv; readonly signal: AbortSignal },
  callback: (error: Error | null, stdout: string) => void,
) => void

/** What the status check needs from the outside world; the Host passes the real ones, a test its own. */
export interface ClaudeAuthStatusDeps {
  readonly exec?: ClaudeAuthStatusExec
  /** Create the neutral working directory the command runs in. */
  readonly makeNeutralDirectory?: () => string
  readonly removeDirectory?: (path: string) => void
}

const failure = (): Error => new Error('The official Claude CLI did not confirm an authenticated configuration.')
const statusSchema = Schema.Struct({ loggedIn: Schema.Literal(true), authMethod: Schema.optional(Schema.String) })

const STATUS_ARGS = ['--setting-sources', '', 'auth', 'status', '--json'] as const

const defaultExec: ClaudeAuthStatusExec = (input, callback) =>
  void execFile(
    'claude',
    [...input.args],
    {
      cwd: input.cwd,
      env: input.environment,
      signal: input.signal,
      timeout: 5_000,
      killSignal: 'SIGKILL',
      maxBuffer: 64 * 1024,
      encoding: 'utf8',
      windowsHide: true,
    },
    (error, stdout) => callback(error, stdout),
  )

/** The official CLI owns the authenticated-configuration check; this only runs its fixed status command. */
export const createClaudeAuthStatusRunner = (deps: ClaudeAuthStatusDeps = {}): ClaudeAuthStatusRunner => {
  const exec = deps.exec ?? defaultExec
  const makeNeutralDirectory = deps.makeNeutralDirectory ?? (() => mkdtempSync(join(tmpdir(), 'dsh-claude-status-')))
  const removeDirectory = deps.removeDirectory ?? (path => rmSync(path, { recursive: true, force: true }))
  return input =>
    withSpan('claude auth status', { kind: 'client', attributes: { 'process.executable.name': 'claude' } }, async span => {
      // Match native inference: no project/user setting sources and a neutral disposable working directory.
      const cwd = makeNeutralDirectory()
      try {
        return await new Promise<{ readonly exitCode: number; readonly stdout: string }>((resolve, reject) => {
          exec({ args: STATUS_ARGS, cwd, environment: input.environment, signal: input.signal }, (error, stdout) => {
            if (error !== null) reject(failure())
            else {
              span.setAttribute('process.exit.code', 0)
              resolve({ exitCode: 0, stdout })
            }
          })
        })
      } finally {
        // Only this exact freshly-created temporary directory, never the account configuration directory.
        removeDirectory(cwd)
      }
    })
}

const defaultRunner = createClaudeAuthStatusRunner()

/**
 * The official CLI owns this authenticated-configuration check. It is NOT remote token validation or quota proof.
 * It deliberately preserves the native Claude CLI environment semantics for existing CLI connections.
 */
export const verifyClaudeAuthStatus = async (input: {
  readonly configDir: string
  readonly signal: AbortSignal
  readonly environment?: NodeJS.ProcessEnv
  readonly run?: ClaudeAuthStatusRunner
}): Promise<void> => {
  const controller = new AbortController()
  const abort = (): void => controller.abort()
  input.signal.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(abort, 5_000)
  let rejectCancelled: (() => void) | undefined
  try {
    input.signal.throwIfAborted()
    const environment = ClaudeAccountModel.cliEnvironment({ environment: input.environment ?? process.env, configDir: input.configDir })
    delete environment['ANTHROPIC_API_KEY']
    delete environment['ANTHROPIC_AUTH_TOKEN']
    const cancelled = new Promise<never>((_resolve, reject) => {
      rejectCancelled = () => reject(failure())
      controller.signal.addEventListener('abort', rejectCancelled, { once: true })
    })
    const result = await Promise.race([(input.run ?? defaultRunner)({ environment, signal: controller.signal }), cancelled])
    controller.signal.throwIfAborted()
    if (result.exitCode !== 0) throw failure()
    const parsed = AiAccountsSchema.decodeResult(statusSchema, JSON.parse(result.stdout))
    if (parsed._tag !== 'Success') throw failure()
  } catch {
    throw failure()
  } finally {
    clearTimeout(timer)
    input.signal.removeEventListener('abort', abort)
    if (rejectCancelled !== undefined) controller.signal.removeEventListener('abort', rejectCancelled)
  }
}
