import {
  emptyCategoryBytes,
  type MemoryPressure,
  type MemorySnapshot,
  type ProcessCategory,
  type ProcessTree,
  type WorkspaceGroup,
  type WorkspaceThread,
} from './types.js'

export interface ProcessRow {
  readonly pid: number
  readonly ppid: number
  readonly rssKb: number
  readonly startedAt: number
  readonly command: string
}

export interface KnownWorkspace {
  readonly path: string
  readonly title: string
}

export interface KnownSession {
  readonly sessionId: string
  readonly cwd: string | null
  readonly running: boolean
  readonly updatedAt: number | null
  readonly title: string | null
}

export interface LiveJob {
  readonly id: string
  readonly label: string
  readonly owner: string | null
  readonly startedAt: number
}

export interface SnapshotInput {
  readonly rows: readonly ProcessRow[]
  readonly cwds: ReadonlyMap<number, string>
  readonly hostPid: number
  readonly home: string
  readonly now: number
  readonly workspaces: readonly KnownWorkspace[]
  readonly sessions: readonly KnownSession[]
  readonly jobs: readonly LiveJob[]
  readonly pressure: MemoryPressure
  readonly systemBytes: number
}

interface ResolvedGroup {
  readonly key: string
  readonly title: string
  readonly path: string
  readonly kind: WorkspaceGroup['kind']
  readonly project: string | null
}

// `Mon Oct 19 14:02:03 2026`: what `ps -o lstart` prints under LC_ALL=C on macOS and Linux.
const PS_LINE = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\w{3}\s+\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(.*)$/
// Orphans living in these trees are apps and system agents, never something a thread started.
const SYSTEM_PREFIXES = ['/Applications/', '/System/', '/Library/', '/usr/libexec/', '/usr/sbin/', '/sbin/', '/private/var/', '/opt/homebrew/Caskroom/']
const ADOPTER = /^(?:\S*\/)?(?:systemd|init|tini|dumb-init|launchd)(?:\s+--user)?\s*$/
const SHELL_WRAPPER = /^(?:\S*\/)?(?:ba|z|da)?sh\s+-l?c\s+/
const RUNTIMES = new Set(['node', 'bun', 'deno', 'python', 'python3', 'ruby', 'java', 'tsx', 'npx', 'pnpm', 'fnm', 'comma', ','])
const RUNTIME_VERBS = new Set(['exec', 'run', 'x', 'dlx'])
const GENERIC_SCRIPTS = new Set(['bin', 'cli', 'index', 'main'])
const GENERIC_DIRECTORIES = new Set(['lib', 'dist', 'bin', 'src', 'cli', 'build', 'out'])
const SUBCOMMAND = /^[a-z][\w:-]{0,23}$/i
const JOB_LABEL_PREFIX = 80
const JOB_START_SLACK_MS = 3_000
const JOB_START_UNIQUE_MS = 1_500
const MAX_THREADS = 20
const MAX_TREES = 200
const MAX_COMMAND = 400

const CATEGORY_RULES: readonly (readonly [ProcessCategory, RegExp])[] = [
  ['dsh', /\/dsh\/lib\/bin\.js|\bdshx\b|@deepseek-ai\/dsh/],
  ['tests', /\bvitest\b|\bplaywright\b|\bjest\b|\bmocha\b|\bcucumber\b|chrome-headless|headless_shell|\bchromium\b/],
  ['build', /\btsc\b|\btsgo\b|\bturbo\b|\besbuild\b|\brollup\b|\boxlint\b|\boxfmt\b|\bbiome\b|\beslint\b|\bswc\b|\bcargo\b|\brustc\b|\bvite\s+build\b|\bnix\b/],
  ['dev-server', /\bvite\b|\bnext\b|\bwebpack\b|\bstorybook\b|\bnodemon\b|\bwrangler\b|\bastro\b|\bremix\b|\bwatch\b|\bdev\b|\bserve\b/],
  ['services', /\bpostgres\b|\bredis-server\b|\brabbitmq\b|\bmysqld\b|\bdocker\b|\btemporal\b|\bminio\b/],
]

const isUnder = (path: string, root: string): boolean => path === root || path.startsWith(`${root}/`)

const dirname = (path: string): string => path.slice(0, Math.max(0, path.lastIndexOf('/')))
const basename = (path: string): string => path.slice(path.lastIndexOf('/') + 1)

export class ProcessTable {
  static parsePs(text: string): ProcessRow[] {
    const rows: ProcessRow[] = []
    for (const line of text.split('\n')) {
      const match = PS_LINE.exec(line)
      if (match === null) continue
      const startedAt = Date.parse(match[4] ?? '')
      if (Number.isNaN(startedAt)) continue
      rows.push({ pid: Number(match[1]), ppid: Number(match[2]), rssKb: Number(match[3]), startedAt, command: (match[5] ?? '').trim() })
    }
    return rows
  }

  /** Processes whose working directory decides where their tree belongs: this Host's children and init's user orphans. */
  static candidates(input: { readonly rows: readonly ProcessRow[]; readonly hostPid: number }) {
    const hostChildren: number[] = []
    const orphans: number[] = []
    const byPid = new Map(input.rows.map(row => [row.pid, row]))
    // A supervisor that launched this Host is itself an orphan inside a workspace; it must never read as stoppable.
    const ancestors = new Set<number>()
    for (let pid = input.hostPid; pid > 1 && !ancestors.has(pid) && ancestors.size < 64; pid = byPid.get(pid)?.ppid ?? 1) ancestors.add(pid)
    for (const row of input.rows) {
      if (row.ppid === input.hostPid) hostChildren.push(row.pid)
      else if (
        ProcessTable.isAdopter(byPid.get(row.ppid), row.ppid) &&
        !ancestors.has(row.pid) &&
        !SYSTEM_PREFIXES.some(prefix => row.command.startsWith(prefix))
      )
        orphans.push(row.pid)
    }
    return { hostChildren, orphans }
  }

  /** Init adopts orphans, unless a subreaper such as `systemd --user` on a Linux desktop is closer. */
  private static isAdopter(parent: ProcessRow | undefined, ppid: number): boolean {
    return ppid === 1 || (parent !== undefined && ADOPTER.test(parent.command))
  }

  /** The tree rooted at `rootPid`, children before parents, so a stop never leaves a parent to respawn a killed child. */
  static treePids(rows: readonly ProcessRow[], rootPid: number): number[] {
    const children = ProcessTable.childrenByParent(rows)
    const ordered: number[] = []
    const visit = (pid: number, depth: number): void => {
      if (depth > 64) return
      for (const child of children.get(pid) ?? []) visit(child.pid, depth + 1)
      ordered.push(pid)
    }
    visit(rootPid, 0)
    return ordered
  }

  static snapshot(input: SnapshotInput): MemorySnapshot {
    const byPid = new Map(input.rows.map(row => [row.pid, row]))
    const groups = new Map<string, ResolvedGroup & { trees: ProcessTree[] }>()
    const { hostChildren, orphans } = ProcessTable.candidates(input)
    const runningSessionIds = new Set(input.sessions.filter(session => session.running).map(session => session.sessionId))
    const jobsByRoot = ProcessTable.matchJobs(
      hostChildren.flatMap(pid => {
        const root = byPid.get(pid)
        return root === undefined ? [] : [root]
      }),
      input.jobs,
    )

    const addTree = (rootPid: number, origin: 'host' | 'detached'): void => {
      const root = byPid.get(rootPid)
      const cwd = input.cwds.get(rootPid)
      if (root === undefined) return
      const resolved = cwd === undefined ? undefined : ProcessTable.resolveGroup(cwd, input.workspaces)
      if (resolved === undefined && origin === 'detached') return
      const group: ResolvedGroup = resolved ?? { key: '__elsewhere__', title: '', path: '', kind: 'elsewhere', project: null }
      const members = ProcessTable.treePids(input.rows, rootPid).flatMap(pid => {
        const row = byPid.get(pid)
        return row === undefined ? [] : [row]
      })
      const heaviest = members.reduce((best, row) => (row.rssKb > best.rssKb ? row : best), root)
      const job = origin === 'host' ? jobsByRoot.get(root.pid) : undefined
      const tree: ProcessTree = {
        pid: root.pid,
        startedAt: root.startedAt,
        name: ProcessTable.shortName(heaviest.command),
        command: ProcessTable.withTilde(ProcessTable.unwrapShell(root.command), input.home).slice(0, MAX_COMMAND),
        cwd: ProcessTable.withTilde(cwd ?? '', input.home),
        bytes: members.reduce((sum, row) => sum + row.rssKb * 1024, 0),
        processCount: members.length,
        origin: job === undefined ? origin : 'job',
        category: ProcessTable.classify(members.map(row => row.command).join('\n'), heaviest.command),
        jobId: job?.id ?? null,
        sessionId: job?.owner ?? null,
        ownerRunning: job !== undefined && job.owner !== null && runningSessionIds.has(job.owner),
      }
      const existing = groups.get(group.key)
      if (existing === undefined) groups.set(group.key, { ...group, trees: [tree] })
      else existing.trees.push(tree)
    }
    for (const pid of hostChildren) addTree(pid, 'host')
    for (const pid of orphans) addTree(pid, 'detached')

    const threadsByGroup = new Map<string, WorkspaceThread[]>()
    for (const session of input.sessions) {
      if (session.cwd === null) continue
      const resolved = ProcessTable.resolveGroup(session.cwd, input.workspaces)
      if (resolved === undefined || !groups.has(resolved.key)) continue
      const list = threadsByGroup.get(resolved.key) ?? []
      list.push({ sessionId: session.sessionId, title: session.title, running: session.running, updatedAt: session.updatedAt })
      threadsByGroup.set(resolved.key, list)
    }

    const categoryBytes = emptyCategoryBytes()
    const finished: WorkspaceGroup[] = [...groups.values()].map(group => {
      const trees = group.trees.toSorted((left, right) => right.bytes - left.bytes)
      for (const tree of trees) categoryBytes[tree.category] += tree.bytes
      const detached = trees.filter(tree => tree.origin === 'detached')
      const threads = (threadsByGroup.get(group.key) ?? []).toSorted(
        (left, right) => Number(right.running) - Number(left.running) || (right.updatedAt ?? 0) - (left.updatedAt ?? 0),
      )
      return {
        key: group.key,
        title: group.title,
        path: group.path,
        kind: group.kind,
        project: group.project,
        bytes: trees.reduce((sum, tree) => sum + tree.bytes, 0),
        detachedBytes: detached.reduce((sum, tree) => sum + tree.bytes, 0),
        detachedCount: detached.length,
        threadCount: threads.length,
        threads: threads.slice(0, MAX_THREADS),
        trees: trees.slice(0, MAX_TREES),
      }
    })
    const sorted = finished.toSorted((left, right) => Number(left.kind === 'elsewhere') - Number(right.kind === 'elsewhere') || right.bytes - left.bytes)
    return {
      takenAt: input.now,
      supported: true,
      pressure: input.pressure,
      systemBytes: input.systemBytes,
      hostBytes: (byPid.get(input.hostPid)?.rssKb ?? 0) * 1024,
      trackedBytes: sorted.reduce((sum, group) => sum + group.bytes, 0),
      detachedBytes: sorted.reduce((sum, group) => sum + group.detachedBytes, 0),
      detachedCount: sorted.reduce((sum, group) => sum + group.detachedCount, 0),
      categoryBytes,
      groups: sorted,
    }
  }

  /**
   * The workspace a working directory belongs to: the deepest registered workspace containing it, else a jj sibling
   * checkout of one (`<repo>-<name>` or `<repo>-threads/<name>`), which is where unregistered thread workspaces live.
   */
  static resolveGroup(cwd: string, workspaces: readonly KnownWorkspace[]): ResolvedGroup | undefined {
    const registered = workspaces.filter(workspace => isUnder(cwd, workspace.path)).toSorted((left, right) => right.path.length - left.path.length)[0]
    if (registered !== undefined) {
      const owner = ProcessTable.siblingOwner(registered.path, workspaces)
      return owner === undefined
        ? { key: registered.path, title: registered.title, path: registered.path, kind: 'project', project: null }
        : { key: registered.path, title: registered.title, path: registered.path, kind: 'workspace', project: owner.title }
    }
    for (const workspace of workspaces) {
      const parent = dirname(workspace.path)
      const threadsRoot = `${workspace.path}-threads/`
      if (cwd.startsWith(threadsRoot)) {
        const path = threadsRoot + (cwd.slice(threadsRoot.length).split('/')[0] ?? '')
        return { key: path, title: basename(path), path, kind: 'workspace', project: workspace.title }
      }
      if (cwd.startsWith(`${workspace.path}-`)) {
        const path = `${parent}/${cwd.slice(parent.length + 1).split('/')[0] ?? ''}`
        return { key: path, title: basename(path), path, kind: 'workspace', project: workspace.title }
      }
    }
    return undefined
  }

  private static siblingOwner(path: string, workspaces: readonly KnownWorkspace[]): KnownWorkspace | undefined {
    return workspaces.find(workspace => workspace.path !== path && (path.startsWith(`${workspace.path}-threads/`) || path.startsWith(`${workspace.path}-`)))
  }

  private static withTilde(text: string, home: string): string {
    return home.length > 1 ? text.replaceAll(`${home}/`, '~/') : text
  }

  private static childrenByParent(rows: readonly ProcessRow[]): Map<number, ProcessRow[]> {
    const children = new Map<number, ProcessRow[]>()
    for (const row of rows) {
      if (row.pid === row.ppid) continue
      const list = children.get(row.ppid) ?? []
      list.push(row)
      children.set(row.ppid, list)
    }
    return children
  }

  /** `bash -c 'set -o pipefail\ncmd'` is how the Host runs a job; the label names `cmd`. */
  private static unwrapShell(command: string): string {
    return command
      .replace(SHELL_WRAPPER, '')
      .replaceAll('\\012', '\n')
      .replace(/^set -o pipefail\s*/, '')
      .trim()
  }

  /**
   * Pairs this Host's children with the live jobs that spawned them. A label prefix decides first, across every child,
   * so a job is never handed to a neighbour started in the same second; a job left over is matched on start time only
   * when exactly one unclaimed child started within a second of it.
   */
  private static matchJobs(roots: readonly ProcessRow[], jobs: readonly LiveJob[]): Map<number, LiveJob> {
    const claimed = new Map<number, LiveJob>()
    const unclaimed = new Map(jobs.map(job => [job.id, job]))
    for (const root of roots) {
      const command = ProcessTable.unwrapShell(root.command)
      const job = [...unclaimed.values()].find(candidate => {
        if (Math.abs(candidate.startedAt - root.startedAt) > JOB_START_SLACK_MS) return false
        const label = candidate.label.trim().split('\n')[0]?.slice(0, JOB_LABEL_PREFIX) ?? ''
        return label.length > 0 && (command.startsWith(label) || label.startsWith(command.slice(0, JOB_LABEL_PREFIX)))
      })
      if (job === undefined) continue
      claimed.set(root.pid, job)
      unclaimed.delete(job.id)
    }
    for (const job of unclaimed.values()) {
      const near = roots.filter(root => !claimed.has(root.pid) && Math.abs(job.startedAt - root.startedAt) <= JOB_START_UNIQUE_MS)
      const only = near.length === 1 ? near[0] : undefined
      if (only !== undefined) claimed.set(only.pid, job)
    }
    return claimed
  }

  private static classify(treeCommands: string, heaviest: string): ProcessCategory {
    const lowered = heaviest.toLowerCase()
    for (const [category, pattern] of CATEGORY_RULES) if (pattern.test(lowered)) return category
    const all = treeCommands.toLowerCase()
    for (const [category, pattern] of CATEGORY_RULES) if (pattern.test(all)) return category
    return 'other'
  }

  /** `node …/node_modules/vitest/vitest.mjs run` reads as `vitest run`, `…/dsh/lib/bin.js web` as `dsh web`. */
  static shortName(command: string): string {
    const tokens = ProcessTable.unwrapShell(command)
      .split(/\s+/)
      .filter(token => token.length > 0)
    let index = 0
    while (index < tokens.length - 1 && RUNTIMES.has(basename(tokens[index] ?? ''))) {
      index++
      while (index < tokens.length - 1 && ((tokens[index] ?? '').startsWith('-') || RUNTIME_VERBS.has(tokens[index] ?? ''))) index++
    }
    const script = tokens[index] ?? ''
    const segments = script.split('/')
    const modules = segments.lastIndexOf('node_modules')
    let name = basename(script).replace(/\.(?:m?js|cjs|ts|py)$/, '')
    if (modules >= 0) {
      const scoped = (segments[modules + 1] ?? '').startsWith('@')
      name = (scoped ? segments[modules + 2] : segments[modules + 1]) ?? name
    } else if (GENERIC_SCRIPTS.has(name)) {
      let directory = segments.length - 2
      while (directory > 0 && GENERIC_DIRECTORIES.has(segments[directory] ?? '')) directory--
      name = segments[directory] || name
    }
    const subcommand = tokens.slice(index + 1).find(token => SUBCOMMAND.test(token))
    return (subcommand === undefined ? name : `${name} ${subcommand}`).slice(0, 120)
  }
}
