import { execFile } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { DshPlatformLaunchUrl } from './client.js'

const runFile = promisify(execFile)

const MAX_OUTPUT_BYTES = 8 * 1024 * 1024
const OPERATION_SCAN_LIMIT = 400
/** Below this, mtime differences are filesystem noise rather than a real rebuild. */
const MTIME_SLACK_MS = 1_000

const OPERATION_LOG_TEMPLATE = 'self.id().short() ++ "\\t" ++ self.time().start() ++ "\\n"'
/** Every field carries a tag: an untagged empty bookmarks list or description would shift the lines under each other. */
const REVISION_TEMPLATE = 'separate("\\n", "c" ++ change_id.short(), "k" ++ commit_id.short(), "b" ++ bookmarks.join(" "), "d" ++ description.first_line())'

export interface LiveInstanceRevision {
  readonly changeId: string
  readonly commitId: string
  readonly bookmarks: readonly string[]
  readonly description: string
}

export interface StaleBundle {
  readonly name: string
  readonly builtAt: number
  readonly sourcesAt: number
  /** `sources-newer`: an edit was never built. `built-after-start`: the running Host predates the current `dist/`. */
  readonly reason: 'sources-newer' | 'built-after-start'
}

export interface LiveInstanceFacts {
  readonly pid: number
  readonly port: number
  readonly profile: string | null
  readonly startedAt: number
  readonly uptimeMs: number
  readonly command: string
  readonly directory: string
  /** The `@deepseek-ai/dsh` version this process actually runs, which the Host API does not expose. */
  readonly dshVersion: string | null
  /** The checkout revision DSH was launched on, read back from the jj operation log at `startedAt`. */
  readonly startRevision: LiveInstanceRevision | null
  readonly currentRevision: LiveInstanceRevision | null
  readonly staleBundles: readonly StaleBundle[]
}

export interface BundleTimes {
  readonly name: string
  readonly builtAt: number | undefined
  readonly sourcesAt: number | undefined
}

const command = async (file: string, args: readonly string[], cwd?: string): Promise<string | undefined> => {
  try {
    const options = cwd === undefined ? { maxBuffer: MAX_OUTPUT_BYTES } : { cwd, maxBuffer: MAX_OUTPUT_BYTES }
    const { stdout } = await runFile(file, [...args], options)
    return stdout
  } catch {
    return undefined
  }
}

const lines = (output: string | undefined): readonly string[] =>
  output === undefined
    ? []
    : output
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0)

/** `ps -o lstart=` prints `Sun Oct 18 03:30:32 2026`; anything unparseable is no fact at all. */
const parseStartTime = (output: string | undefined): number | undefined => {
  const value = output?.trim()
  if (value === undefined || value === '') return undefined
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

/** jj prints `2026-10-18 03:35:24.660 +02:00`; ISO needs a `T` separator and no space before the offset. */
const parseJjTimestamp = (value: string): number | undefined => {
  const normalized = value.trim().replace(' ', 'T').replace(' ', '')
  const parsed = Date.parse(normalized)
  return Number.isFinite(parsed) ? parsed : undefined
}

/** The installed `@deepseek-ai/dsh` package root inside a `dsh` command line, however pnpm laid the store out. */
const dshPackageRoot = (commandLine: string): string | undefined => /(.*node_modules\/@deepseek-ai\/dsh)\/lib\/bin\.js/.exec(commandLine)?.[1]

const dshVersionOf = (commandLine: string): string | null => {
  const root = dshPackageRoot(commandLine)
  if (root === undefined) return null
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    const version = typeof parsed === 'object' && parsed !== null && 'version' in parsed ? parsed.version : undefined
    return typeof version === 'string' ? version : null
  } catch {
    return null
  }
}

const parseRevision = (output: string | undefined): LiveInstanceRevision | undefined => {
  const field = (tag: string): string | undefined => {
    for (const line of (output ?? '').split('\n')) if (line.startsWith(tag)) return line.slice(tag.length)
    return undefined
  }
  const changeId = field('c')
  const commitId = field('k')
  if (changeId === undefined || commitId === undefined) return undefined
  return {
    changeId,
    commitId,
    bookmarks: (field('b') ?? '').split(' ').filter(value => value.length > 0),
    description: field('d') ?? '',
  }
}

/** `lsof -Fn` prints one `p<pid>` record per process; the first is the listener. */
const parseListenerPid = (output: string | undefined): number | undefined => {
  for (const line of lines(output)) {
    if (!line.startsWith('p')) continue
    const pid = Number(line.slice(1))
    if (Number.isSafeInteger(pid) && pid > 0) return pid
  }
  return undefined
}

/** `lsof -a -d cwd -p <pid> -Fn` prints an `fcwd` record followed by its `n<path>`. */
const parseCwd = (output: string | undefined): string | undefined => {
  let inCwd = false
  for (const line of lines(output)) {
    if (line.startsWith('f')) {
      inCwd = line.slice(1) === 'cwd'
      continue
    }
    if (inCwd && line.startsWith('n')) return line.slice(1)
  }
  return undefined
}

const parseProfile = (commandLine: string): string | null => {
  const explicit = /--profile[= ](\S+)/.exec(commandLine)
  if (explicit?.[1] !== undefined) return explicit[1]
  return /(^|\s)web(\s|$)/.test(commandLine) ? 'web' : null
}

/** The newest operation at or before `startedAt`, from an `op log` page printed newest first. */
const operationBefore = (output: string | undefined, startedAt: number): string | undefined => {
  for (const line of (output ?? '').split('\n')) {
    const [id, timestamp] = line.split('\t')
    if (id === undefined || id === '' || timestamp === undefined) continue
    const at = parseJjTimestamp(timestamp)
    if (at === undefined) continue
    if (at <= startedAt) return id
  }
  return undefined
}

/** `plugins/@dshfiles/*` with `dist/` older than `src/`, or a `dist/` the running Host cannot have loaded. */
const staleBundles = (entries: readonly BundleTimes[], startedAt: number): readonly StaleBundle[] => {
  const stale: StaleBundle[] = []
  for (const entry of entries) {
    if (entry.builtAt === undefined) continue
    if (entry.sourcesAt !== undefined && entry.sourcesAt > entry.builtAt + MTIME_SLACK_MS) {
      stale.push({ name: entry.name, builtAt: entry.builtAt, sourcesAt: entry.sourcesAt, reason: 'sources-newer' })
      continue
    }
    if (entry.builtAt > startedAt + MTIME_SLACK_MS)
      stale.push({ name: entry.name, builtAt: entry.builtAt, sourcesAt: entry.sourcesAt ?? 0, reason: 'built-after-start' })
  }
  return stale
}

export class LiveInstanceModel {
  static readonly parseStartTime = parseStartTime
  static readonly parseRevision = parseRevision
  static readonly parseListenerPid = parseListenerPid
  static readonly parseCwd = parseCwd
  static readonly parseProfile = parseProfile
  static readonly parseJjTimestamp = parseJjTimestamp
  static readonly operationBefore = operationBefore
  static readonly staleBundles = staleBundles
}

const jjBinary = (): string | undefined => {
  const candidates = [
    process.env.DSHX_JJ?.trim(),
    join(homedir(), '.nix-profile', 'bin', 'jj'),
    '/run/current-system/sw/bin/jj',
    '/nix/var/nix/profiles/default/bin/jj',
  ].filter((candidate): candidate is string => candidate !== undefined && candidate !== '')
  return candidates.find(candidate => existsSync(candidate))
}

/**
 * Every jj read passes `--ignore-working-copy`: this inspects someone else's checkout and must never snapshot it.
 */
const readRevision = async (binary: string, directory: string, operationId?: string): Promise<LiveInstanceRevision | undefined> =>
  parseRevision(
    await command(
      binary,
      ['--ignore-working-copy', 'log', '--no-graph', ...(operationId === undefined ? [] : ['--at-operation', operationId]), '-r', '@', '-T', REVISION_TEMPLATE],
      directory,
    ),
  )

const newestMtime = (directory: string): number | undefined => {
  let newest: number | undefined
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.turbo') continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      const nested = newestMtime(path)
      if (nested !== undefined && (newest === undefined || nested > newest)) newest = nested
      continue
    }
    const modified = statSync(path).mtimeMs
    if (newest === undefined || modified > newest) newest = modified
  }
  return newest
}

const builtAt = (packageDirectory: string): number | undefined => {
  const artifacts = ['client.js', 'index.js'].map(name => join(packageDirectory, 'dist', name)).filter(path => existsSync(path))
  if (artifacts.length === 0) return undefined
  return Math.min(...artifacts.map(path => statSync(path).mtimeMs))
}

const ownedBundleTimes = (checkout: string): readonly BundleTimes[] => {
  const root = join(checkout, 'plugins', '@dshfiles')
  if (!existsSync(root)) return []
  return readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => {
      const packageDirectory = join(root, entry.name)
      const sources = join(packageDirectory, 'src')
      return {
        name: `@dshfiles/${entry.name}`,
        builtAt: builtAt(packageDirectory),
        sourcesAt: existsSync(sources) ? newestMtime(sources) : undefined,
      }
    })
}

const listenerPid = async (port: number): Promise<number | undefined> => {
  if (process.platform === 'darwin') return parseListenerPid(await command('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fn']))
  const sockets = await command('ss', ['-ltnpH'])
  const match = new RegExp(`:${port}\\s.*pid=(\\d+)`).exec(sockets ?? '')
  if (match?.[1] !== undefined) return Number(match[1])
  const processes = await command('ps', ['-Ao', 'pid=,command='])
  for (const line of lines(processes)) {
    if (!line.includes('dsh') || !new RegExp(`--port[= ]${port}(\\s|$)`).test(line)) continue
    const pid = Number(line.trim().split(' ')[0])
    if (Number.isSafeInteger(pid) && pid > 0) return pid
  }
  return undefined
}

const processDirectory = async (pid: number): Promise<string | undefined> => {
  if (process.platform === 'darwin') return parseCwd(await command('lsof', ['-a', '-d', 'cwd', '-p', String(pid), '-Fn']))
  try {
    const { readlink } = await import('node:fs/promises')
    return await readlink(`/proc/${pid}/cwd`)
  } catch {
    return undefined
  }
}

const inspect = async (launchUrl: string | undefined, now: number): Promise<LiveInstanceFacts | undefined> => {
  if (launchUrl === undefined) return undefined
  let origin: string
  try {
    origin = DshPlatformLaunchUrl.loopbackLaunchUrl(launchUrl).origin
  } catch {
    return undefined
  }
  const port = Number(new URL(origin).port)
  if (!Number.isSafeInteger(port) || port <= 0) return undefined
  const pid = await listenerPid(port)
  if (pid === undefined) return undefined
  const [startOutput, commandOutput, directory] = await Promise.all([
    command('ps', ['-o', 'lstart=', '-p', String(pid)]),
    command('ps', ['-o', 'command=', '-p', String(pid)]),
    processDirectory(pid),
  ])
  const startedAt = parseStartTime(startOutput) ?? now
  const binary = directory === undefined ? undefined : jjBinary()
  const operationId =
    binary === undefined || directory === undefined
      ? undefined
      : operationBefore(
          await command(
            binary,
            ['--ignore-working-copy', 'op', 'log', '--no-graph', '-n', String(OPERATION_SCAN_LIMIT), '-T', OPERATION_LOG_TEMPLATE],
            directory,
          ),
          startedAt,
        )
  const [startRevision, currentRevision] = await Promise.all([
    binary === undefined || directory === undefined || operationId === undefined ? undefined : readRevision(binary, directory, operationId),
    binary === undefined || directory === undefined ? undefined : readRevision(binary, directory),
  ])
  return {
    pid,
    port,
    profile: parseProfile(commandOutput ?? ''),
    startedAt,
    uptimeMs: Math.max(0, now - startedAt),
    command: (commandOutput ?? '').trim().slice(0, 512),
    directory: directory ?? '',
    startRevision: startRevision ?? null,
    currentRevision: currentRevision ?? null,
    staleBundles: staleBundles(directory === undefined ? [] : ownedBundleTimes(directory), startedAt),
  }
}

/** Facts about the DSH process that serves `launchUrl`, or `undefined` when it cannot be identified. */
export const inspectLiveInstance = async (input: { readonly launchUrl: string | undefined; readonly now?: number }): Promise<LiveInstanceFacts | undefined> =>
  inspect(input.launchUrl, input.now ?? Date.now())
