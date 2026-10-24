import { terminateManagedProcess } from '@dshfiles/dshx/host'
import { withSpan } from '@dshfiles/dshx/tracing'
import type { SubprocessHandle, SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'

export type LocalProcessStatus = 'not-configured' | 'starting' | 'running' | 'exited' | 'stopping' | 'stopped' | 'stop-unconfirmed'

export interface LocalCommand {
  readonly command: string
  readonly args: readonly string[]
  readonly cwd: string
}

/** Host-owned process wrapper; no command runs in the browser or through a shell. */
export class ManagedLocalCommand {
  private currentStatus: LocalProcessStatus = 'starting'
  private stopping: Promise<void> | undefined

  private constructor(private readonly handle: SubprocessHandle) {
    void handle.done.then(
      () => this.noteExit(),
      () => this.noteExit(),
    )
    handle.stdout?.on('error', () => undefined)
    handle.stderr?.on('error', () => undefined)
    handle.stdout?.resume()
    handle.stderr?.resume()
  }

  /** One `mcp server start` span for resolving and spawning the command; the running server is not a span. */
  static start(
    runtime: Pick<SubprocessRuntime, 'resolveExecutable' | 'spawn'>,
    command: LocalCommand,
    env: Readonly<Record<string, string>>,
  ): Promise<ManagedLocalCommand> {
    return withSpan('mcp server start', { kind: 'client', attributes: { 'dshx.mcp-servers.argument_count': command.args.length } }, async () => {
      const executable = await runtime.resolveExecutable(command.command, env)
      const handle = runtime.spawn({
        argv: [executable, ...command.args],
        cwd: command.cwd,
        env: { ...env },
        stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
        graceMs: 5_000,
      })
      return new ManagedLocalCommand(handle)
    })
  }

  get status(): LocalProcessStatus {
    return this.currentStatus
  }

  markRunning(): void {
    if (this.currentStatus === 'starting') this.currentStatus = 'running'
  }

  stop(): Promise<void> {
    if (this.currentStatus === 'stopped') return Promise.resolve()
    if (this.stopping !== undefined) return this.stopping
    this.currentStatus = 'stopping'
    const stopping = this.stopRange().finally(() => {
      if (this.stopping === stopping) this.stopping = undefined
    })
    this.stopping = stopping
    return stopping
  }

  private async stopRange(): Promise<void> {
    try {
      const empty = await terminateManagedProcess({ handle: this.handle, timeoutMs: 10_000 })
      this.currentStatus = empty ? 'stopped' : 'stop-unconfirmed'
    } catch {
      this.currentStatus = 'stop-unconfirmed'
    }
  }

  private noteExit(): void {
    if (this.currentStatus !== 'stopping' && this.currentStatus !== 'stopped') {
      this.currentStatus = 'exited'
    }
  }
}
