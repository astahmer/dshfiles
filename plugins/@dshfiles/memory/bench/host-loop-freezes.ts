#!/usr/bin/env node
/**
 * Host-loop freeze replay bench. Reads the **live session corpus and index read-only**, replays the index backlog it
 * currently has into a throwaway index copy, and measures what one content search does to the event loop.
 *
 * Safety: the live corpus and the live index are only ever opened for reading. Every write goes to `--run-dir`, which
 * must live under the temporary directory and must not overlap the live DSH home.
 *
 * Run with: pnpm --dir plugins/@dshfiles/memory bench:freezes -- --run-dir /private/tmp/dsh-freeze-bench/r1
 */
import { spawn } from 'node:child_process'
import { copyFile, mkdir, open, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { homedir, loadavg, tmpdir } from 'node:os'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

import { Context } from '@deepseek-ai/cordis'
import SqliteSessionQueryEngine from '@deepseek-ai/dsh-session-query-sqlite'

import { decodeJson, jsonObjectSchema } from '@dshfiles/dshx/json'

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite')

const LOG_NAME = /^session(?:\.v(\d+))?\.jsonl(?:\.zstd)?$/
const HEADER_BYTES = 64 * 1024
const LAG_SAMPLE_MS = 25
const LAG_BUDGET_MS = 250

const parseArguments = argv => {
  const options = {
    corpus: join(homedir(), '.dsh', 'sessions'),
    index: join(homedir(), '.dsh', 'plugins', 'session-query-sqlite', 'index.sqlite'),
    runDir: join(tmpdir(), 'dsh-freeze-bench', 'run'),
    out: undefined,
    scenarios: ['S1', 'S2', 'S3', 'S4', 'S6'],
    liveCount: 18,
    liveSourceMb: 30,
    restartSessions: 20,
    query: 'the',
    keystrokes: 12,
    keystrokeGapMs: 200,
  }
  const flags = new Map()
  const argv2 = argv.filter(argument => argument !== '--')
  for (let position = 0; position < argv2.length; position += 2) flags.set(argv2[position], argv2[position + 1])
  if (flags.has('--corpus')) options.corpus = resolve(flags.get('--corpus') ?? '')
  if (flags.has('--index')) options.index = resolve(flags.get('--index') ?? '')
  if (flags.has('--run-dir')) options.runDir = resolve(flags.get('--run-dir') ?? '')
  if (flags.has('--out')) options.out = resolve(flags.get('--out') ?? '')
  if (flags.has('--live')) options.liveCount = Number(flags.get('--live'))
  if (flags.has('--live-source-mb')) options.liveSourceMb = Number(flags.get('--live-source-mb'))
  if (flags.has('--restart-sessions')) options.restartSessions = Number(flags.get('--restart-sessions'))
  if (flags.has('--query')) options.query = flags.get('--query') ?? options.query
  if (flags.has('--scenarios'))
    options.scenarios = String(flags.get('--scenarios') ?? '')
      .split(',')
      .filter(Boolean)
  if (flags.has('--keystrokes')) options.keystrokes = Number(flags.get('--keystrokes'))
  if (flags.has('--keystroke-gap-ms')) options.keystrokeGapMs = Number(flags.get('--keystroke-gap-ms'))
  return options
}

const isWithin = (parent, child) => {
  const path = relative(resolve(parent), resolve(child))
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path))
}

const TEMP_ROOTS = [tmpdir(), '/tmp', '/private/tmp']

const assertSafeRunDir = runDir => {
  const home = resolve(process.env.DSH_LIVE_HOME ?? join(homedir(), '.dsh'))
  if (!TEMP_ROOTS.some(root => isWithin(root, runDir))) throw new Error(`refusing to write outside ${TEMP_ROOTS.join(', ')}: ${runDir}`)
  if (isWithin(home, runDir) || isWithin(runDir, home)) throw new Error(`refusing a run directory inside the live DSH home: ${runDir}`)
}

const listDirectories = async path =>
  (await readdir(path, { withFileTypes: true }).catch(() => [])).filter(entry => entry.isDirectory()).map(entry => join(path, entry.name))

const currentLog = async sessionDirectory => {
  let best
  for (const name of await readdir(sessionDirectory).catch(() => [])) {
    const match = LOG_NAME.exec(name)
    if (match === null) continue
    const version = Number(match[1] ?? 0)
    if (best === undefined || version > best.version) best = { path: join(sessionDirectory, name), version }
  }
  return best?.path
}

/** The revision format the installed backend stores (`dev:ino:size:mtimeNs:ctimeNs`). */
const revisionOfStat = info => `${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`

/** The header is the first line the writer emits, so it lives inside the log's first Zstandard frame. */
const readHeaderLine = async path => {
  const handle = await open(path, 'r')
  try {
    const buffer = Buffer.alloc(HEADER_BYTES)
    const { bytesRead } = await handle.read(buffer, 0, HEADER_BYTES, 0)
    const view = buffer.subarray(0, bytesRead)
    const { frames } = scanZstdFrames(view)
    const first = frames[0]
    if (first === undefined) throw new Error(`no complete Zstandard frame in the first ${HEADER_BYTES} bytes of ${path}`)
    const text = zstdDecompressSync(view.subarray(first.start, first.end)).toString('utf8')
    const newline = text.indexOf('\n')
    return decodeJson(jsonObjectSchema, newline < 0 ? text : text.slice(0, newline))
  } finally {
    await handle.close()
  }
}

const ZSTD_MAGIC = 4247762216

/**
 * Locate the concatenated Zstandard frames of a session log. The installed persistence owns this container format, so
 * the bench mirrors its structural scan instead of handing the whole file to a one-shot decoder that stops at the
 * first frame.
 */
const scanZstdFrames = buffer => {
  const frames = []
  let offset = 0
  while (offset < buffer.length) {
    // oxlint-disable-next-line antislop/no-passthrough-variable -- The frame start stays fixed while `offset` walks the frame.
    const start = offset
    if (buffer.length - offset < 4 || buffer.readUInt32LE(offset) !== ZSTD_MAGIC) return { frames, tornStart: start }
    offset += 4
    if (offset === buffer.length) return { frames, tornStart: start }
    const descriptor = buffer.readUInt8(offset)
    offset += 1
    if ((descriptor & 24) !== 0) throw new Error(`corrupt session log: reserved frame-header bit at byte ${offset - 1}`)
    const contentSizeFlag = descriptor >>> 6
    const singleSegment = (descriptor & 32) !== 0
    const checksum = (descriptor & 4) !== 0
    const dictionaryFlag = descriptor & 3
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes
    if (buffer.length - offset < remainingHeaderBytes) return { frames, tornStart: start }
    offset += remainingHeaderBytes
    for (;;) {
      if (buffer.length - offset < 3) return { frames, tornStart: start }
      const blockHeader = buffer.readUIntLE(offset, 3)
      offset += 3
      const lastBlock = (blockHeader & 1) !== 0
      const blockType = (blockHeader >>> 1) & 3
      const blockSize = blockHeader >>> 3
      if (blockType === 3) throw new Error(`corrupt session log: reserved block type at byte ${offset - 3}`)
      const payloadBytes = blockType === 1 ? 1 : blockSize
      if (buffer.length - offset < payloadBytes) return { frames, tornStart: start }
      offset += payloadBytes
      if (lastBlock) break
    }
    if (checksum) {
      if (buffer.length - offset < 4) return { frames, tornStart: start }
      offset += 4
    }
    frames.push({ start, end: offset })
  }
  return { frames }
}

/** `record` receives how long the cold read spent in I/O, frame decoding, and JSON parsing. */
const parseLog = async (path, record) => {
  const startedAt = Date.now()
  const buffer = await readFile(path)
  const readMs = Date.now() - startedAt
  const scanStartedAt = Date.now()
  const { frames } = scanZstdFrames(buffer)
  const scanMs = Date.now() - scanStartedAt
  const decodeStartedAt = Date.now()
  const decoded = []
  for (const frame of frames) decoded.push(zstdDecompressSync(buffer.subarray(frame.start, frame.end)))
  const plain = Buffer.concat(decoded).toString('utf8')
  const decodeMs = Date.now() - decodeStartedAt
  const parseStartedAt = Date.now()
  const lines = plain.split('\n')
  const header = decodeJson(jsonObjectSchema, lines[0] ?? '{}')
  const events = []
  for (const line of lines.slice(1)) {
    if (line.length === 0) continue
    try {
      events.push(decodeJson(jsonObjectSchema, line))
    } catch {
      break
    }
  }
  record?.({
    at: startedAt,
    doneAt: Date.now(),
    readMs,
    scanMs,
    decodeMs,
    parseMs: Date.now() - parseStartedAt,
    frames: frames.length,
    compressedBytes: buffer.length,
    decodedBytes: plain.length,
  })
  return { header, events }
}

const scanCorpus = async root => {
  const entries = []
  for (const project of await listDirectories(root)) {
    for (const sessionDirectory of await listDirectories(project)) {
      const log = await currentLog(sessionDirectory)
      if (log === undefined) continue
      const info = await stat(log, { bigint: true })
      entries.push({ id: basename(sessionDirectory), log, revision: revisionOfStat(info), size: Number(info.size), mtimeMs: Number(info.mtimeMs) })
    }
  }
  return entries.sort((left, right) => left.id.localeCompare(right.id))
}

const indexCounts = path => {
  const database = new DatabaseSync(path, { readOnly: true })
  try {
    return {
      sessions: Number(database.prepare('SELECT count(*) AS count FROM persisted_sessions').get().count),
      documents: Number(database.prepare('SELECT count(*) AS count FROM persisted_docs').get().count),
      generation: Number(database.prepare('SELECT global_generation AS value FROM search_state WHERE singleton = 1').get().value),
    }
  } finally {
    database.close()
  }
}

const indexRevisions = path => {
  const database = new DatabaseSync(path, { readOnly: true })
  try {
    return new Map(
      database
        .prepare('SELECT id, revision FROM persisted_sessions')
        .all()
        .map(row => [row.id, row.revision]),
    )
  } finally {
    database.close()
  }
}

/** Copy the live index, then rewrite revisions so the copy holds exactly the state a scenario needs. */
const prepareIndexCopy = async ({ sourceIndex, destination, corpus, headers, behind, mode }) => {
  await copyFile(sourceIndex, destination)
  const database = new DatabaseSync(destination)
  try {
    const update = database.prepare('UPDATE persisted_sessions SET revision = ? WHERE id = ?')
    const remove = database.prepare('DELETE FROM persisted_sessions WHERE id = ?')
    const insert = database.prepare(`INSERT OR REPLACE INTO persisted_sessions
      (id, version, created_at, cwd, parent_session, seed_length, delegation_depth, agent_preset, revision, generation)
      VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`)
    const generation = Number(database.prepare('SELECT global_generation AS value FROM search_state WHERE singleton = 1').get().value)
    database.exec('BEGIN IMMEDIATE')
    for (const entry of corpus) {
      if (mode === 'warm') {
        const header = headers.get(entry.id)
        insert.run(
          entry.id,
          header.version ?? 4,
          header.createdAt,
          header.cwd ?? null,
          header.parentSession ?? null,
          header.delegationDepth ?? 0,
          header.agentPreset ?? null,
          entry.revision,
          generation,
        )
        continue
      }
      update.run(behind.has(entry.id) ? `replayed-backlog:${entry.id}` : entry.revision, entry.id)
    }
    const known = new Set(corpus.map(entry => entry.id))
    for (const row of database.prepare('SELECT id FROM persisted_sessions').all()) if (!known.has(row.id)) remove.run(row.id)
    database.exec('COMMIT')
  } finally {
    database.close()
  }
}

const markBehind = (path, ids) => {
  const database = new DatabaseSync(path)
  try {
    const update = database.prepare('UPDATE persisted_sessions SET revision = ? WHERE id = ?')
    database.exec('BEGIN IMMEDIATE')
    for (const id of ids) update.run(`replayed-backlog:${id}`, id)
    database.exec('COMMIT')
  } finally {
    database.close()
  }
}

const startLagProbe = () => {
  const samples = []
  let previous = process.hrtime.bigint()
  const timer = setInterval(() => {
    const now = process.hrtime.bigint()
    samples.push(Number(now - previous) / 1e6)
    previous = now
  }, LAG_SAMPLE_MS)
  return {
    stop: () => {
      clearInterval(timer)
      const gaps = samples.filter(gap => gap > LAG_SAMPLE_MS * 1.5)
      const sorted = [...gaps].sort((left, right) => left - right)
      const percentile = fraction => (sorted.length === 0 ? 0 : Number(sorted[Math.max(0, Math.ceil(fraction * sorted.length) - 1)].toFixed(1)))
      return {
        samples: samples.length,
        sumMs: Number(samples.reduce((total, gap) => total + gap, 0).toFixed(1)),
        maxGapMs: samples.length === 0 ? 0 : Number(Math.max(...samples).toFixed(1)),
        p99GapMs: percentile(0.99),
        gapsOverBudget: gaps.filter(gap => gap > LAG_BUDGET_MS).length,
        overBudget: gaps.some(gap => gap > LAG_BUDGET_MS),
      }
    },
  }
}

/**
 * A second process pings a unix socket the bench serves. Its own timers can never be starved by the bench's work, so
 * the gap between its pings is the Host-stall number a user would feel.
 */
const PINGER_SOURCE = `
const net = require('node:net')
const path = process.argv[1]
const gaps = []
const rtts = []
let previous = Date.now()
const tick = () => {
  const startedAt = Date.now()
  const now = Date.now()
  gaps.push(now - previous)
  previous = now
  const socket = net.connect(path)
  socket.on('data', () => {})
  socket.on('close', () => rtts.push(Date.now() - startedAt))
  socket.on('error', () => {})
}
const timer = setInterval(tick, 25)
process.on('SIGTERM', () => {
  clearInterval(timer)
  const sorted = [...gaps].sort((left, right) => left - right)
  const percentile = fraction => (sorted.length === 0 ? 0 : sorted[Math.max(0, Math.ceil(fraction * sorted.length) - 1)])
  process.stdout.write(JSON.stringify({
    samples: gaps.length,
    sumMs: gaps.reduce((total, gap) => total + gap, 0),
    maxGapMs: sorted.length === 0 ? 0 : sorted[sorted.length - 1],
    p99GapMs: percentile(0.99),
    gapsOverBudget: gaps.filter(gap => gap > 250).length,
    maxRttMs: rtts.length === 0 ? 0 : Math.max(...rtts),
  }) + '\\n')
  process.exit(0)
})
`

const startExternalProbe = async socketPath => {
  await rm(socketPath, { force: true })
  const server = createServer(socket => {
    socket.on('error', () => undefined)
    socket.end('pong')
  })
  await new Promise(resolve => server.listen(socketPath, resolve))
  const child = spawn(process.execPath, ['-e', PINGER_SOURCE, socketPath], { stdio: ['ignore', 'pipe', 'inherit'] })
  let output = ''
  child.stdout.on('data', chunk => {
    output += chunk
  })
  return {
    stop: async () => {
      child.kill('SIGTERM')
      await new Promise(resolve => child.once('exit', resolve))
      await new Promise(resolve => server.close(resolve))
      await rm(socketPath, { force: true })
      try {
        return decodeJson(jsonObjectSchema, output)
      } catch {
        return { error: 'the external probe produced no reading' }
      }
    },
  }
}

const buildPersistence = ({ corpus, headers, timings }) => ({
  list: async () => corpus.map(entry => ({ header: headers.get(entry.id), revision: entry.revision })),
  open: async sessionId => {
    const entry = corpus.find(candidate => candidate.id === sessionId)
    if (entry === undefined) throw new Error(`unknown session ${sessionId}`)
    const parsed = await parseLog(entry.log, timing => timings.push({ id: sessionId, compressedBytes: entry.size, ...timing }))
    return {
      id: entry.id,
      header: parsed.header,
      inheritedEventCount: 0,
      read: async () => ({ events: parsed.events, eventState: 'shared-frozen' }),
      close: async () => undefined,
    }
  },
})

const bootEngine = async ({ indexPath, corpus, headers, liveSessions, timings }) => {
  const context = new Context()
  context.provide('sessions', { list: () => liveSessions, get: id => liveSessions.find(session => session.header.id === id) })
  context.provide('sessionPersistence', buildPersistence({ corpus, headers, timings }))
  const fiber = await context.plugin(SqliteSessionQueryEngine, { path: indexPath, openAt: 'first-search' })
  return {
    search: (query, signal) => context.sessionQuery.searchSessions({ query, limit: 5 }, signal === undefined ? undefined : { signal }),
    close: async () => fiber.dispose(),
  }
}

/** Live sessions are approximated from a few real logs cycled to `count`: the cost tracks the live event volume. */
const liveSessionsFrom = async ({ corpus, count, sourceMb }) => {
  if (count <= 0) return []
  const sources = []
  let bytes = 0
  for (const entry of [...corpus].sort((left, right) => right.mtimeMs - left.mtimeMs)) {
    if (sources.length >= 3 || bytes + entry.size > sourceMb * 1024 * 1024) continue
    const parsed = await parseLog(entry.log).catch(() => undefined)
    if (parsed === undefined) continue
    sources.push(parsed)
    bytes += entry.size
  }
  if (sources.length === 0) return []
  return Array.from({ length: count }, (_value, index) => {
    const source = sources[index % sources.length]
    return {
      header: { ...source.header, id: `${source.header.id}-live-${index}` },
      inheritedEventCount: 0,
      snapshotEvents: () => source.events,
    }
  })
}

const runScenario = async ({ name, description, index, runDir, work }) => {
  const before = indexCounts(index)
  const probe = startLagProbe()
  const external = await startExternalProbe(join(runDir, 'probe.sock'))
  const startedAt = Date.now()
  const detail = await work()
  const workMs = Date.now() - startedAt
  // A starved timer callback is still pending when the awaited work resolves; the continuation runs in the microtask
  // queue first, so the probes must let one macrotask turn pass before they are stopped or the longest stall is lost.
  await new Promise(resolve => setTimeout(resolve, 500))
  const lag = probe.stop()
  const externalLag = await external.stop()
  const after = indexCounts(index)
  const result = {
    name,
    description,
    wallMs: workMs,
    drainMs: Date.now() - startedAt - workMs,
    lag,
    externalLag,
    index: {
      sessionsIndexed: after.sessions - before.sessions,
      documentsIndexed: after.documents - before.documents,
      generations: after.generation - before.generation,
    },
    detail,
  }
  console.log(`\n${JSON.stringify(result, null, 2)}`)
  return result
}

const abortedSearch = (engine, query, gapMs) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), gapMs)
  return engine
    .search(query, controller.signal)
    .then(() => 'done')
    .catch(error => `aborted: ${error instanceof Error ? error.message : String(error)}`)
    .finally(() => clearTimeout(timer))
}

const main = async () => {
  const options = parseArguments(process.argv.slice(2))
  assertSafeRunDir(options.runDir)
  await mkdir(options.runDir, { recursive: true })

  const corpus = await scanCorpus(options.corpus)
  const headers = new Map()
  for (const entry of corpus) headers.set(entry.id, await readHeaderLine(entry.log))

  const liveIndexRevisions = indexRevisions(options.index)
  const behind = new Set(corpus.filter(entry => liveIndexRevisions.get(entry.id) !== entry.revision).map(entry => entry.id))
  const missing = corpus.filter(entry => !liveIndexRevisions.has(entry.id))
  const summary = {
    corpus: { sessions: corpus.length, bytes: corpus.reduce((total, entry) => total + entry.size, 0) },
    liveIndex: indexCounts(options.index),
    backlog: {
      changedSessions: behind.size,
      changedBytes: corpus.filter(entry => behind.has(entry.id)).reduce((total, entry) => total + entry.size, 0),
      neverIndexed: missing.length,
      neverIndexedBytes: missing.reduce((total, entry) => total + entry.size, 0),
    },
  }
  console.log(JSON.stringify(summary, null, 2))

  const results = {
    startedAt: new Date().toISOString(),
    runDir: options.runDir,
    corpusRoot: options.corpus,
    sourceIndex: options.index,
    loadAverage: loadavg(),
    summary,
    scenarios: [],
  }

  const prepare = async (label, mode) => {
    const path = join(options.runDir, `index-${label}.sqlite`)
    await prepareIndexCopy({ sourceIndex: options.index, destination: path, corpus, headers, behind, mode })
    return path
  }

  const runWithEngine = async ({ name, description, index, liveSessions, work }) => {
    const timings = []
    const engine = await bootEngine({ indexPath: index, corpus, headers, liveSessions, timings })
    try {
      const result = await runScenario({ name, description, index, runDir: options.runDir, work: () => work(engine) })
      const sum = pick => timings.reduce((total, entry) => total + (entry[pick] ?? 0), 0)
      let betweenReadsMs = 0
      for (let position = 1; position < timings.length; position += 1) betweenReadsMs += (timings[position].at ?? 0) - (timings[position - 1].doneAt ?? 0)
      return {
        ...result,
        coldReads: {
          count: timings.length,
          compressedMB: Number((sum('compressedBytes') / 1048576).toFixed(1)),
          decodedMB: Number((sum('decodedBytes') / 1048576).toFixed(1)),
          frames: sum('frames'),
          ioMs: sum('readMs'),
          scanMs: sum('scanMs'),
          decodeMs: sum('decodeMs'),
          synchronousParseMs: sum('parseMs'),
          betweenReadsMs,
          slowest: [...timings].sort((left, right) => right.decodeMs + right.parseMs - (left.decodeMs + left.parseMs)).slice(0, 5),
        },
      }
    } finally {
      await engine.close()
    }
  }

  const attempt = async (name, run) => {
    try {
      results.scenarios.push(await run())
    } catch (error) {
      results.scenarios.push({ name, failed: error instanceof Error ? error.message : String(error) })
    }
  }

  if (options.scenarios.includes('S1')) {
    const index = await prepare('s1', 'replay')
    await attempt('S1 cold catch-up', () =>
      runWithEngine({
        name: 'S1 cold catch-up',
        description: 'one search, no abort, with the replayed live backlog',
        index,
        liveSessions: [],
        work: async engine => ({ items: (await engine.search(options.query)).items.length }),
      }),
    )
  }

  if (options.scenarios.includes('S2')) {
    const index = await prepare('s2', 'replay')
    await attempt('S2 typing burst', () =>
      runWithEngine({
        name: 'S2 typing burst',
        description: `${options.keystrokes} searches aborted after ${options.keystrokeGapMs} ms, then one settled search`,
        index,
        liveSessions: [],
        work: async engine => {
          const outcomes = []
          for (let round = 0; round < options.keystrokes; round += 1)
            outcomes.push(await abortedSearch(engine, `${options.query} ${round}`, options.keystrokeGapMs))
          return { outcomes, items: (await engine.search(options.query)).items.length }
        },
      }),
    )
  }

  if (options.scenarios.includes('S3')) {
    const index = await prepare('warm', 'warm')
    const liveSessions = await liveSessionsFrom({ corpus, count: options.liveCount, sourceMb: options.liveSourceMb })
    await attempt('S3 warm search', () =>
      runWithEngine({
        name: 'S3 warm search',
        description: `warm index, ${liveSessions.length} live sessions`,
        index,
        liveSessions,
        work: async engine => ({ items: (await engine.search(options.query)).items.length }),
      }),
    )
  }

  if (options.scenarios.includes('S4')) {
    const largest = [...corpus].sort((left, right) => right.size - left.size)[0]
    const index = await prepare('warm', 'warm')
    if (largest !== undefined) markBehind(index, [largest.id])
    await attempt('S4 giant log changed', () =>
      runWithEngine({
        name: 'S4 giant log changed',
        description: `one changed log (${largest?.size ?? 0} bytes compressed) on an otherwise warm index`,
        index,
        liveSessions: [],
        work: async engine => ({ items: (await engine.search(options.query)).items.length }),
      }),
    )
  }

  if (options.scenarios.includes('S6')) {
    // A restart leaves the sessions that were live when the process stopped unindexed; their logs are the newest ones.
    const newest = [...corpus].sort((left, right) => right.mtimeMs - left.mtimeMs).slice(0, options.restartSessions)
    const index = await prepare('restart', 'warm')
    markBehind(
      index,
      newest.map(entry => entry.id),
    )
    await attempt('S6 restart catch-up', () =>
      runWithEngine({
        name: 'S6 restart catch-up',
        description: `warm index, ${newest.length} sessions that were live before a restart`,
        index,
        liveSessions: [],
        work: async engine => ({
          items: (await engine.search(options.query)).items.length,
          sessions: newest.map(entry => ({ id: entry.id, mb: Number((entry.size / 1048576).toFixed(2)) })),
        }),
      }),
    )
  }

  results.finishedAt = new Date().toISOString()
  const outputPath = options.out ?? join(options.runDir, `results-${Date.now()}.json`)
  await writeFile(outputPath, JSON.stringify(results, null, 2))
  console.log(`results: ${outputPath}`)
}

await main()
