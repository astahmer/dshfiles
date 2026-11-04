import { Buffer } from 'node:buffer'
import { Duration, Effect, Option, Stream } from 'effect'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'
import type { ProjectOriginsInput } from './api.js'
import { HostDirectory } from './host-directory.js'
import { Ssh, shellQuote } from './ssh.js'

type OriginRequest = { readonly kind: 'local'; readonly path: string } | { readonly kind: 'remote'; readonly runtimeId: string; readonly path: string }
type OriginCacheEntry = { readonly origin: string | null; readonly expiresAt: number }
type RemoteHostGroup = { readonly sshTarget: string; readonly pathsByRuntime: Map<string, Set<string>> }

const cacheDurationMs = 5 * 60_000
const maxCacheEntries = 20_000
const localOutputLimitBytes = 16_384
const remoteOutputLimitBytes = 4 * 1024 * 1024
const originCache = new Map<string, OriginCacheEntry>()

const cacheKey = (request: OriginRequest): string => JSON.stringify([request.kind, request.kind === 'remote' ? request.runtimeId : '', request.path])

const cachedOrigin = (request: OriginRequest): string | null | undefined => {
  const key = cacheKey(request)
  const cached = originCache.get(key)
  if (cached === undefined) return undefined
  if (cached.expiresAt > Date.now()) return cached.origin
  originCache.delete(key)
  return undefined
}

const cacheOrigin = (request: OriginRequest, origin: string | null): void => {
  const now = Date.now()
  for (const [key, value] of originCache) if (value.expiresAt <= now) originCache.delete(key)
  while (originCache.size >= maxCacheEntries) {
    const oldest = originCache.keys().next().value
    if (oldest === undefined) break
    originCache.delete(oldest)
  }
  originCache.set(cacheKey(request), { origin, expiresAt: now + cacheDurationMs })
}

const normalizedRepositoryPath = (value: string): string | null => {
  let path = value.replace(/^\/+/, '').replace(/\/+$/u, '')
  if (path.toLowerCase().endsWith('.git')) path = path.slice(0, -4).replace(/\/+$/u, '')
  return path.length === 0 || path.includes('\0') ? null : path
}

export const normalizeProjectOrigin = (value: string): string | null => {
  const origin = value.trim()
  if (origin.length === 0 || origin.length > 4096) return null

  let host: string
  let repositoryPath: string
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//u.test(origin)) {
    let url: URL
    try {
      url = new URL(origin)
    } catch {
      return null
    }
    if (!['http:', 'https:', 'ssh:', 'git:'].includes(url.protocol) || url.host.length === 0) return null
    host = url.host.toLowerCase()
    repositoryPath = url.pathname
  } else {
    const match = /^(?:[^@/]+@)?([A-Za-z0-9._-]+):(.+)$/u.exec(origin)
    if (match === null) return null
    host = match[1]?.toLowerCase() ?? ''
    repositoryPath = match[2] ?? ''
  }

  const path = normalizedRepositoryPath(repositoryPath)
  if (host.length === 0 || path === null) return null
  const normalized = `${host}/${path}`
  return normalized.length <= 4096 ? normalized : null
}

const readLocalOrigin = (path: string) =>
  Effect.scoped(
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const handle = yield* spawner.spawn(ChildProcess.make('git', ['-C', path, 'config', '--get', 'remote.origin.url'], { stdin: 'ignore', stderr: 'ignore' }))
      const [output, exitCode] = yield* Effect.all(
        [
          Stream.runFoldEffect(
            handle.stdout,
            () => ({ chunks: new Array<Uint8Array>(), bytes: 0, exceeded: false }),
            (state, chunk) => {
              if (state.exceeded) return Effect.succeed(state)
              const bytes = state.bytes + chunk.byteLength
              if (bytes > localOutputLimitBytes) return Effect.succeed({ ...state, exceeded: true })
              return Effect.succeed({ chunks: [...state.chunks, chunk], bytes, exceeded: false })
            },
          ),
          handle.exitCode,
        ],
        { concurrency: 'unbounded' },
      )
      if (exitCode !== 0 || output.exceeded) return null
      return normalizeProjectOrigin(Buffer.concat(output.chunks).toString('utf8'))
    }),
  ).pipe(
    Effect.timeoutOrElse({ duration: Duration.seconds(10), orElse: () => Effect.succeed(null) }),
    Effect.catch(() => Effect.succeed(null)),
  )

const remoteOriginCommand = (paths: readonly string[]): string =>
  `for path in ${paths.map(shellQuote).join(' ')}; do origin=$(git -C "$path" config --get remote.origin.url 2>/dev/null || true); printf '%s\\t%s\\n' "$path" "$origin"; done`

const remoteOrigins = (input: { readonly sshTarget: string; readonly paths: readonly string[] }) =>
  Ssh.use(ssh =>
    ssh.run({
      sshTarget: input.sshTarget,
      command: remoteOriginCommand(input.paths),
      timeout: Duration.seconds(30),
      maxOutputBytes: remoteOutputLimitBytes,
    }),
  ).pipe(Effect.option)

const parseRemoteOutput = (output: string, paths: ReadonlySet<string>): ReadonlyMap<string, string | null> => {
  const origins = new Map<string, string | null>()
  for (const line of output.split(/\r?\n/u)) {
    const separator = line.indexOf('\t')
    if (separator < 0) continue
    const path = line.slice(0, separator)
    if (!paths.has(path)) continue
    origins.set(path, normalizeProjectOrigin(line.slice(separator + 1)))
  }
  return origins
}

const addPath = (pathsByRuntime: Map<string, Set<string>>, runtimeId: string, path: string): void => {
  const paths = pathsByRuntime.get(runtimeId) ?? new Set<string>()
  paths.add(path)
  pathsByRuntime.set(runtimeId, paths)
}

export const readProjectOrigins = Effect.fn('multi-host project origins')(function* (input: ProjectOriginsInput) {
  const requests: OriginRequest[] = [
    ...input.localPaths.map((path): OriginRequest => ({ kind: 'local', path })),
    ...input.remote.flatMap(runtime => runtime.paths.map((path): OriginRequest => ({ kind: 'remote', runtimeId: runtime.runtimeId, path }))),
  ]
  const localReads = new Map<string, OriginRequest>()
  const pendingRemote = new Map<string, Set<string>>()

  for (const request of requests) {
    if (cachedOrigin(request) !== undefined) continue
    if (request.kind === 'local') {
      localReads.set(cacheKey(request), request)
      continue
    }
    const paths = pendingRemote.get(request.runtimeId) ?? new Set<string>()
    paths.add(request.path)
    pendingRemote.set(request.runtimeId, paths)
  }

  if (localReads.size > 0) {
    yield* Effect.forEach(
      [...localReads.values()],
      request => readLocalOrigin(request.path).pipe(Effect.tap(origin => Effect.sync(() => cacheOrigin(request, origin)))),
      { concurrency: 8 },
    )
  }

  if (pendingRemote.size > 0) {
    const directory = yield* HostDirectory
    const targets = yield* Effect.forEach(
      [...pendingRemote.entries()],
      ([runtimeId, paths]) =>
        Effect.gen(function* () {
          const runtime = yield* directory.findRuntime(runtimeId)
          const host = runtime === undefined ? undefined : yield* directory.findHost(runtime.hostId)
          return { runtimeId, paths, host }
        }),
      { concurrency: 8 },
    )
    const localRemoteReads = new Map<string, OriginRequest>()
    const remoteHosts = new Map<string, RemoteHostGroup>()

    for (const target of targets) {
      if (target.host === undefined) {
        for (const path of target.paths) cacheOrigin({ kind: 'remote', runtimeId: target.runtimeId, path }, null)
        continue
      }
      if (target.host.connector.kind === 'local') {
        for (const path of target.paths) {
          const request: OriginRequest = { kind: 'remote', runtimeId: target.runtimeId, path }
          localRemoteReads.set(cacheKey(request), request)
        }
        continue
      }
      const group = remoteHosts.get(target.host.connector.sshTarget) ?? {
        sshTarget: target.host.connector.sshTarget,
        pathsByRuntime: new Map<string, Set<string>>(),
      }
      for (const path of target.paths) addPath(group.pathsByRuntime, target.runtimeId, path)
      remoteHosts.set(group.sshTarget, group)
    }

    if (localRemoteReads.size > 0) {
      yield* Effect.forEach(
        [...localRemoteReads.values()],
        request => readLocalOrigin(request.path).pipe(Effect.tap(origin => Effect.sync(() => cacheOrigin(request, origin)))),
        { concurrency: 8 },
      )
    }

    yield* Effect.forEach(
      [...remoteHosts.values()],
      group =>
        Effect.gen(function* () {
          const paths = [...new Set([...group.pathsByRuntime.values()].flatMap(values => [...values]))].sort()
          const result = yield* remoteOrigins({ sshTarget: group.sshTarget, paths })
          const valid = Option.isSome(result) && result.value.code === 0 && !result.value.timedOut && !result.value.outputExceeded
          const pathOrigins = valid ? parseRemoteOutput(result.value.stdout, new Set(paths)) : new Map<string, string | null>()
          for (const [runtimeId, runtimePaths] of group.pathsByRuntime) {
            for (const path of runtimePaths) {
              const request: OriginRequest = { kind: 'remote', runtimeId, path }
              cacheOrigin(request, pathOrigins.get(path) ?? null)
            }
          }
        }),
      { concurrency: 4 },
    )
  }

  return {
    origins: requests.map(request => ({
      kind: request.kind,
      ...(request.kind === 'remote' && { runtimeId: request.runtimeId }),
      path: request.path,
      origin: cachedOrigin(request) ?? null,
    })),
  }
})
