import { readlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-subprocess'
import { withSpan } from '@dshfiles/dshx/tracing'
import { DevServers, type DevServer, type KnownSession, type LiveJob, type ProcessRow } from './dev-servers.js'

const PROBE_TIMEOUT_MS = 10_000
const SESSIONS_TIMEOUT_MS = 2_500
const PROBE_TTL_MS = 3_000
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024
const MAX_CWD_PROBES = 200

export type Exec = (command: string, args: readonly string[]) => Promise<string>

export interface DevServerProbe {
  readonly supported: boolean
  readonly servers: readonly DevServer[]
}

/** Runs one read-only probe command through the Host subprocess service. */
const contextExec =
  (context: Context): Exec =>
  async (command, args) => {
    const signal = AbortSignal.timeout(PROBE_TIMEOUT_MS)
    const executable = await context.subprocess.resolveExecutable(command, undefined, signal)
    const handle = context.subprocess.spawn({
      argv: [executable, ...args],
      cwd: homedir(),
      env: { ...process.env, LC_ALL: 'C' },
      stdio: { stdin: 'ignore', stdout: { maxBytes: MAX_OUTPUT_BYTES }, stderr: { maxBytes: 64 * 1024 } },
      graceMs: 500,
      signal,
    })
    // lsof exits 1 when nothing matches; its stdout is still the answer.
    await handle.done.catch(() => undefined)
    return handle.collected.stdout?.readFrom(0)?.text ?? ''
  }

const traced =
  (exec: Exec): Exec =>
  (command, args) =>
    withSpan('preview port-probe', { kind: 'client', attributes: { 'process.executable.name': command } }, () => exec(command, args))

const uid = (): string => String(process.getuid?.() ?? 0)

const readProcessTable = async (exec: Exec): Promise<ProcessRow[]> =>
  DevServers.parsePs(await exec('ps', ['-ww', '-x', '-U', uid(), '-o', 'pid=,ppid=,lstart=,args=']))

const readCwds = async (input: { readonly exec: Exec; readonly platform: NodeJS.Platform; readonly pids: readonly number[] }): Promise<Map<number, string>> => {
  const cwds = new Map<number, string>()
  const probed = input.pids.slice(0, MAX_CWD_PROBES)
  if (probed.length === 0) return cwds
  if (input.platform === 'linux') {
    await Promise.all(
      probed.map(pid =>
        readlink(`/proc/${String(pid)}/cwd`).then(
          cwd => cwds.set(pid, cwd),
          () => undefined,
        ),
      ),
    )
    return cwds
  }
  let current: number | undefined
  for (const line of (await input.exec('lsof', ['-a', '-d', 'cwd', '-F', 'pn', '-p', probed.join(',')])).split('\n')) {
    if (line.startsWith('p')) current = Number(line.slice(1))
    else if (line.startsWith('n') && current !== undefined) cwds.set(current, line.slice(1))
  }
  return cwds
}

const contextSessions = async (context: Context): Promise<KnownSession[]> => {
  const controller = context.get('sessionController')
  if (controller === undefined) return []
  const listed = await controller.list({}, AbortSignal.timeout(SESSIONS_TIMEOUT_MS)).catch(() => undefined)
  return (listed?.items ?? []).map(summary => ({ sessionId: summary.sessionId, cwd: summary.cwd ?? null }))
}

/** One probe serves every caller within a few seconds, so several open threads polling cost one lsof. */
const createDevServerProbe = (input: {
  readonly exec: Exec
  readonly platform: NodeJS.Platform
  readonly hostPid: number
  readonly sessions: () => Promise<readonly KnownSession[]>
  readonly jobs: () => readonly LiveJob[]
}) => {
  const exec = traced(input.exec)
  const probe = async (): Promise<DevServerProbe> => {
    if (input.platform !== 'darwin' && input.platform !== 'linux') return { supported: false, servers: [] }
    const [sockets, rows, sessions] = await Promise.all([
      input.platform === 'linux'
        ? exec('ss', ['-ltnpH']).then(DevServers.parseSsListeners)
        : exec('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-a', '-u', uid(), '-F', 'pn']).then(DevServers.parseLsofListeners),
      readProcessTable(exec),
      input.sessions(),
    ])
    const cwds = await readCwds({ exec, platform: input.platform, pids: [...new Set(sockets.map(socket => socket.pid))] })
    return { supported: true, servers: DevServers.attribute({ sockets, rows, cwds, hostPid: input.hostPid, home: homedir(), sessions, jobs: input.jobs() }) }
  }
  let cached: { readonly at: number; readonly result: Promise<DevServerProbe> } | undefined
  return {
    exec,
    read: (fresh: boolean): Promise<DevServerProbe> => {
      const now = Date.now()
      if (!fresh && cached !== undefined && now - cached.at < PROBE_TTL_MS) return cached.result
      const result = probe()
      cached = { at: now, result }
      result.catch(() => {
        if (cached?.result === result) cached = undefined
      })
      return result
    },
    invalidate: () => {
      cached = undefined
    },
  }
}

export class DevServerProbes {
  static readonly contextExec = contextExec
  static readonly contextSessions = contextSessions
  static readonly readProcessTable = readProcessTable
  static readonly create = createDevServerProbe
}
