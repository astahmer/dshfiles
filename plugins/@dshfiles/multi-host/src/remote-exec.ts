import { SshConnector, shellQuote } from './connectors/ssh.js'

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

const runRemoteExec = async ({
  sshTarget,
  command,
  cwd,
  timeoutMs = 30_000,
  signal,
}: {
  readonly sshTarget: string
  readonly command: string
  readonly cwd?: string | undefined
  readonly timeoutMs?: number | undefined
  readonly signal?: AbortSignal | undefined
}): Promise<RemoteExecResult> => {
  const result = await SshConnector.run({ sshTarget, command: buildRemoteExecCommand({ command, cwd }), timeoutMs, signal })
  return {
    ok: result.code === 0 && !result.timedOut,
    code: result.code,
    stdout: result.stdout.slice(-64_000),
    stderr: result.stderr.slice(-16_000),
    timedOut: result.timedOut,
    durationMs: result.durationMs,
  }
}

export class RemoteExec {
  static readonly buildCommand = buildRemoteExecCommand
  static readonly run = runRemoteExec
}
