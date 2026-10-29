export interface ProcessRow {
  readonly pid: number
  readonly ppid: number
  readonly startedAt: number
  readonly command: string
}

export interface ListeningSocket {
  readonly pid: number
  readonly address: string
  readonly port: number
}

export interface KnownSession {
  readonly sessionId: string
  readonly cwd: string | null
}

export interface LiveJob {
  readonly id: string
  readonly label: string
  readonly owner: string | null
  readonly startedAt: number
}

export type Attribution = 'job' | 'workspace'

export interface DevServer {
  readonly pid: number
  readonly startedAt: number
  readonly name: string
  readonly command: string
  readonly cwd: string
  readonly ports: { readonly address: string; readonly port: number; readonly url: string }[]
  readonly sessionIds: string[]
  readonly attribution: Attribution
  readonly jobId: string | null
}

const PS_LINE = /^\s*(\d+)\s+(\d+)\s+(\w{3}\s+\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(.*)$/
const LSOF_ADDRESS = /^(.*):(\d+)$/
const SS_LINE = /^\S+\s+\d+\s+\d+\s+(\S+):(\d+)\s+\S+\s+users:\((.*)\)\s*$/
const SS_PID = /pid=(\d+)/g
const SHELL_WRAPPER = /^(?:\S*\/)?(?:ba|z|da)?sh\s+-l?c\s+/
const JOB_START_SLACK_MS = 2_000
const MAX_COMMAND = 200
const LOOPBACK_OR_ANY = new Set(['*', '0.0.0.0', '::', '127.0.0.1', '::1', 'localhost'])

const bareAddress = (address: string): string => address.replace(/^\[(.*)\]$/, '$1')

/** `ps -o pid=,ppid=,lstart=,args=` under LC_ALL=C. */
const parsePs = (text: string): ProcessRow[] =>
  text.split('\n').flatMap(line => {
    const match = PS_LINE.exec(line)
    if (match === null) return []
    const startedAt = Date.parse(match[3] ?? '')
    if (Number.isNaN(startedAt)) return []
    return [{ pid: Number(match[1]), ppid: Number(match[2]), startedAt, command: (match[4] ?? '').trim() }]
  })

/** `lsof -nP -iTCP -sTCP:LISTEN -F pn`: a `p<pid>` line, then one `n<address>:<port>` line per socket. */
const parseLsofListeners = (text: string): ListeningSocket[] => {
  const sockets: ListeningSocket[] = []
  let pid: number | undefined
  for (const line of text.split('\n')) {
    if (line.startsWith('p')) pid = Number(line.slice(1))
    if (!line.startsWith('n') || pid === undefined) continue
    const match = LSOF_ADDRESS.exec(line.slice(1))
    if (match === null) continue
    sockets.push({ pid, address: bareAddress(match[1] ?? ''), port: Number(match[2]) })
  }
  return sockets
}

/** `ss -ltnpH`: one line per listening socket with every owning pid in `users:(...)`. */
const parseSsListeners = (text: string): ListeningSocket[] =>
  text.split('\n').flatMap(line => {
    const match = SS_LINE.exec(line.trim())
    if (match === null) return []
    const address = bareAddress(match[1] ?? '')
    const port = Number(match[2])
    return [...(match[3] ?? '').matchAll(SS_PID)].map(pidMatch => ({ pid: Number(pidMatch[1]), address, port }))
  })

const unwrapShell = (command: string): string => command.replace(SHELL_WRAPPER, '').replace(/^['"]/, '')

const shortName = (command: string): string => {
  const executable = unwrapShell(command).split(/\s+/)[0] ?? ''
  return executable.split('/').at(-1) ?? executable
}

const withTilde = (path: string, home: string): string => (home !== '' && path.startsWith(home) ? `~${path.slice(home.length)}` : path)

const urlFor = (address: string, port: number): string => {
  if (LOOPBACK_OR_ANY.has(address)) return `http://localhost:${String(port)}/`
  return address.includes(':') ? `http://[${address}]:${String(port)}/` : `http://${address}:${String(port)}/`
}

const isInside = (path: string, root: string): boolean => path === root || path.startsWith(root.endsWith('/') ? root : `${root}/`)

/** The process this Host spawned that the pid descends from, if any. */
const hostChildOf = (pid: number, byPid: ReadonlyMap<number, ProcessRow>, hostPid: number): ProcessRow | undefined => {
  let current = byPid.get(pid)
  for (let depth = 0; current !== undefined && depth < 64; depth++) {
    if (current.ppid === hostPid) return current
    current = byPid.get(current.ppid)
  }
  return undefined
}

const matchJob = (root: ProcessRow, jobs: readonly LiveJob[]): LiveJob | undefined => {
  const near = jobs.filter(job => job.owner !== null && Math.abs(job.startedAt - root.startedAt) <= JOB_START_SLACK_MS)
  const command = unwrapShell(root.command)
  const labelled = near.find(job => {
    const label = job.label.trim().split('\n')[0]?.slice(0, 40) ?? ''
    return label.length > 0 && (command.startsWith(label) || label.startsWith(command.slice(0, 40)))
  })
  if (labelled !== undefined) return labelled
  return near.length === 1 ? near[0] : undefined
}

/** Sessions whose working directory is the deepest one containing `cwd`; several when threads share a checkout. */
const sessionsByWorkspace = (cwd: string, sessions: readonly KnownSession[]): string[] => {
  let deepest = -1
  let matched: string[] = []
  for (const session of sessions) {
    if (session.cwd === null || !isInside(cwd, session.cwd)) continue
    if (session.cwd.length > deepest) {
      deepest = session.cwd.length
      matched = [session.sessionId]
    } else if (session.cwd.length === deepest) matched.push(session.sessionId)
  }
  return matched
}

/**
 * Pairs listening sockets with the thread that started them: through the live job a Host child belongs to first,
 * else through the thread whose working directory holds the process. The Host and its ancestors are never listed, and
 * a socket no thread accounts for is left out.
 */
const attributeDevServers = (input: {
  readonly sockets: readonly ListeningSocket[]
  readonly rows: readonly ProcessRow[]
  readonly cwds: ReadonlyMap<number, string>
  readonly hostPid: number
  readonly home: string
  readonly sessions: readonly KnownSession[]
  readonly jobs: readonly LiveJob[]
}): DevServer[] => {
  const byPid = new Map(input.rows.map(row => [row.pid, row]))
  const excluded = new Set<number>()
  for (let pid = input.hostPid; pid > 1 && !excluded.has(pid) && excluded.size < 64; pid = byPid.get(pid)?.ppid ?? 1) excluded.add(pid)
  const socketsByPid = new Map<number, ListeningSocket[]>()
  for (const socket of input.sockets) {
    if (excluded.has(socket.pid)) continue
    const list = socketsByPid.get(socket.pid) ?? []
    if (!list.some(existing => existing.port === socket.port && existing.address === socket.address)) list.push(socket)
    socketsByPid.set(socket.pid, list)
  }
  const servers: DevServer[] = []
  for (const [pid, sockets] of socketsByPid) {
    const row = byPid.get(pid)
    if (row === undefined) continue
    const cwd = input.cwds.get(pid) ?? ''
    const root = hostChildOf(pid, byPid, input.hostPid)
    const job = root === undefined ? undefined : matchJob(root, input.jobs)
    const jobOwner = job?.owner ?? null
    const sessionIds = jobOwner !== null ? [jobOwner] : cwd === '' ? [] : sessionsByWorkspace(cwd, input.sessions)
    if (sessionIds.length === 0) continue
    const ports = sockets
      .toSorted((left, right) => left.port - right.port)
      .filter((socket, index, sorted) => index === 0 || sorted[index - 1]?.port !== socket.port)
      .map(socket => ({ address: socket.address, port: socket.port, url: urlFor(socket.address, socket.port) }))
    servers.push({
      pid,
      startedAt: row.startedAt,
      name: shortName(row.command),
      command: withTilde(unwrapShell(row.command), input.home).slice(0, MAX_COMMAND),
      cwd: withTilde(cwd, input.home),
      ports,
      sessionIds,
      attribution: job === undefined ? 'workspace' : 'job',
      jobId: job?.id ?? null,
    })
  }
  return servers.toSorted((left, right) => (left.ports[0]?.port ?? 0) - (right.ports[0]?.port ?? 0))
}

export class DevServers {
  static readonly parsePs = parsePs
  static readonly parseLsofListeners = parseLsofListeners
  static readonly parseSsListeners = parseSsListeners
  static readonly attribute = attributeDevServers
}
