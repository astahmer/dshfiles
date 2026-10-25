import { execFile } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { withSpan } from '@dshfiles/dshx/tracing'

/** Private subprocess result: never returned from account APIs or included in an error. */
export type ClaudeAuthStatusRunner = (input: {
  readonly environment: NodeJS.ProcessEnv
  readonly signal: AbortSignal
}) => Promise<{ readonly exitCode: number; readonly stdout: string }>

const failure = (): Error => new Error('The official Claude CLI did not confirm an authenticated configuration.')
const statusSchema = z.object({ loggedIn: z.literal(true), authMethod: z.string().optional() })

const runStatus: ClaudeAuthStatusRunner = input =>
  withSpan('claude auth status', { kind: 'client', attributes: { 'process.executable.name': 'claude' } }, async span => {
    // Match native inference: no project/user setting sources and a neutral disposable working directory.
    const directory = mkdtempSync(join(tmpdir(), 'dsh-claude-status-'))
    try {
      return await new Promise<{ readonly exitCode: number; readonly stdout: string }>((resolve, reject) => {
        // No shell, credential argv, inherited stdio, auto-install, or DSH-owned login/refresh implementation.
        execFile(
          'claude',
          ['--setting-sources', '', 'auth', 'status', '--json'],
          {
            cwd: directory,
            env: input.environment,
            signal: input.signal,
            timeout: 5_000,
            killSignal: 'SIGKILL',
            maxBuffer: 64 * 1024,
            encoding: 'utf8',
            windowsHide: true,
          },
          (error, stdout) => {
            if (error !== null) reject(failure())
            else {
              span.setAttribute('process.exit.code', 0)
              resolve({ exitCode: 0, stdout })
            }
          },
        )
      })
    } finally {
      // Only this exact freshly-created temporary directory, never the account configuration directory.
      rmSync(directory, { recursive: true, force: true })
    }
  })

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
    const environment = { ...(input.environment ?? process.env) }
    delete environment['ANTHROPIC_API_KEY']
    delete environment['ANTHROPIC_AUTH_TOKEN']
    environment['CLAUDE_CONFIG_DIR'] = input.configDir
    const cancelled = new Promise<never>((_resolve, reject) => {
      rejectCancelled = () => reject(failure())
      controller.signal.addEventListener('abort', rejectCancelled, { once: true })
    })
    const result = await Promise.race([(input.run ?? runStatus)({ environment, signal: controller.signal }), cancelled])
    controller.signal.throwIfAborted()
    if (result.exitCode !== 0) throw failure()
    const parsed = statusSchema.safeParse(JSON.parse(result.stdout))
    if (!parsed.success) throw failure()
  } catch {
    throw failure()
  } finally {
    clearTimeout(timer)
    input.signal.removeEventListener('abort', abort)
    if (rejectCancelled !== undefined) controller.signal.removeEventListener('abort', rejectCancelled)
  }
}
