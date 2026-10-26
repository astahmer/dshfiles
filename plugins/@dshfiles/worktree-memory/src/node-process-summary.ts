import type { ProcessRow } from './process-table.js'
import type { NodeProcessSample, NodeProcessSummary } from './types.js'

const MAX_ORIGINS = 100
const MAX_SAMPLES = 5

const NODE_PROCESS_NAMES: readonly (readonly [RegExp, string])[] = [
  [/\/@deepseek-ai\/dsh\/lib\/bin\.js(?:\s|$)/i, 'DSH Host'],
  [/\/typescript\/lib\/tsserver\.js(?:\s|$)/i, 'TypeScript server'],
  [/\/typescript\/lib\/tsc\.js(?:\s|$)/i, 'TypeScript compiler'],
  [/\/tailwindcss-language-server(?:\s|$)/i, 'Tailwind CSS server'],
  [/\/vtsls\.js(?:\s|$)/i, 'vtsls language server'],
  [/\/eslintServer\.js(?:\s|$)/i, 'ESLint language server'],
  [/\/vite\/bin\/vite\.js(?:\s|$)/i, 'Vite'],
  [/\/vitest\/vitest\.mjs(?:\s|$)/i, 'Vitest'],
  [/\/esbuild(?:\/bin)?\/esbuild(?:\s|$)/i, 'esbuild service'],
]

interface NodeProcessInput {
  readonly rows: readonly ProcessRow[]
  readonly cwds: ReadonlyMap<number, string>
  readonly home: string
}

interface NodeProcessAccumulator {
  readonly id: string
  readonly name: string
  readonly source: string | null
  readonly cwd: string | null
  processCount: number
  rssBytes: number
  readonly samples: NodeProcessSample[]
}

const firstToken = (command: string): string => {
  const match = /^(?:"([^"]+)"|'([^']+)'|(\S+))/.exec(command.trimStart())
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? ''
}

const basename = (path: string): string => path.slice(path.lastIndexOf('/') + 1)

const isNodeProcess = (row: ProcessRow): boolean => {
  const executable = basename(firstToken(row.command))
  return executable === 'node' || executable === 'nodejs'
}

const nodeProcessName = (command: string): string => {
  for (const [pattern, name] of NODE_PROCESS_NAMES) if (pattern.test(command)) return name
  return 'Node process'
}

const appName = (command: string): string | null => /(?:^|\/)([^/]+)\.app\/Contents\/MacOS(?:\/|$)/.exec(command)?.[1] ?? null

const executableName = (command: string): string => {
  const name = basename(firstToken(command))
  return name.length === 0 ? 'Unknown parent' : name.slice(0, 120)
}

const processSource = (input: { readonly row: ProcessRow; readonly rowsByPid: ReadonlyMap<number, ProcessRow> }): string | null => {
  const immediateParentCommand = input.rowsByPid.get(input.row.ppid)?.command
  let ancestor = input.rowsByPid.get(input.row.ppid)
  const visited = new Set([input.row.pid])
  for (let depth = 0; ancestor !== undefined && depth < 32; depth += 1) {
    if (visited.has(ancestor.pid)) break
    visited.add(ancestor.pid)
    const application = appName(ancestor.command)
    if (application !== null) return application.slice(0, 120)
    ancestor = input.rowsByPid.get(ancestor.ppid)
  }
  return immediateParentCommand === undefined ? null : executableName(immediateParentCommand)
}

const displayCwd = (input: { readonly cwd: string | undefined; readonly home: string }): string | null => {
  if (input.cwd === undefined) return null
  if (input.cwd === input.home) return '~'
  const homePrefix = `${input.home.replace(/\/$/, '')}/`
  const displayed = input.cwd.startsWith(homePrefix) ? `~${input.cwd.slice(homePrefix.length - 1)}` : input.cwd
  return displayed.slice(0, 1024)
}

const compareText = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0)

export const nodeProcessCwdPids = (input: { readonly rows: readonly ProcessRow[]; readonly limit: number }): number[] =>
  input.rows
    .filter(isNodeProcess)
    .toSorted((left, right) => right.rssKb - left.rssKb || left.pid - right.pid)
    .slice(0, Math.max(0, input.limit))
    .map(row => row.pid)

export const summarizeNodeProcesses = (input: NodeProcessInput): NodeProcessSummary => {
  const nodeRows = input.rows.filter(isNodeProcess)
  const rowsByPid = new Map(input.rows.map(row => [row.pid, row]))
  const origins = new Map<string, NodeProcessAccumulator>()

  for (const row of nodeRows) {
    const name = nodeProcessName(row.command)
    const source = processSource({ row, rowsByPid })
    const cwd = displayCwd({ cwd: input.cwds.get(row.pid), home: input.home })
    const id = JSON.stringify([name, source, cwd])
    const rssBytes = row.rssKb * 1024
    const sample = { pid: row.pid, rssBytes }
    const existing = origins.get(id)
    if (existing === undefined) {
      origins.set(id, { id, name, source, cwd, processCount: 1, rssBytes, samples: [sample] })
      continue
    }
    existing.processCount += 1
    existing.rssBytes += rssBytes
    existing.samples.push(sample)
  }

  const sortedOrigins = [...origins.values()].toSorted((left, right) => right.rssBytes - left.rssBytes || compareText(left.id, right.id))
  return {
    processCount: nodeRows.length,
    rssBytes: nodeRows.reduce((total, row) => total + row.rssKb * 1024, 0),
    truncated: sortedOrigins.length > MAX_ORIGINS,
    origins: sortedOrigins.slice(0, MAX_ORIGINS).map(origin => ({
      name: origin.name,
      source: origin.source,
      cwd: origin.cwd,
      processCount: origin.processCount,
      rssBytes: origin.rssBytes,
      samples: origin.samples.toSorted((left, right) => right.rssBytes - left.rssBytes || left.pid - right.pid).slice(0, MAX_SAMPLES),
    })),
  }
}
