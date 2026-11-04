import { Effect } from 'effect'
import { Ssh, shellQuote } from './ssh.js'

export interface RemoteExecResult {
  readonly ok: boolean
  readonly code: number | null
  readonly stdout: string
  readonly stderr: string
  readonly timedOut: boolean
  readonly durationMs: number
}

/** One remote command in one directory; the caller's command is never split, only quoted as a whole. */
const buildRemoteExecCommand = ({ command, cwd }: { readonly command: string; readonly cwd: string | undefined }): string =>
  cwd === undefined ? command : `cd ${shellQuote(cwd)} && ${command}`

const runRemoteExec = Effect.fnUntraced(function* (input: {
  readonly sshTarget: string
  readonly command: string
  readonly cwd?: string | undefined
  readonly timeoutMs?: number | undefined
}) {
  const ssh = yield* Ssh
  const result = yield* ssh.run({
    sshTarget: input.sshTarget,
    command: buildRemoteExecCommand({ command: input.command, cwd: input.cwd }),
    timeout: input.timeoutMs ?? 30_000,
  })
  return {
    ok: result.code === 0 && !result.timedOut,
    code: result.code,
    stdout: result.stdout.slice(-64_000),
    stderr: result.stderr.slice(-16_000),
    timedOut: result.timedOut,
    durationMs: result.durationMs,
  } satisfies RemoteExecResult
})

export class RemoteExec {
  static readonly buildCommand = buildRemoteExecCommand
  static readonly run = runRemoteExec
}
