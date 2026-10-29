// Trim a real DSH session log into a test fixture: keep only the events the usage fold reads, drop every prompt,
// answer, tool payload and error text, and re-encode them as independent Zstandard frames like the JSONL backend.
// Usage: node scripts/trim-session-fixture.mjs <session.vN.jsonl.zstd> <out.jsonl.zstd> [--cwd /home/user/dev/sample]
import { readFileSync, writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { constants, zstdCompressSync, zstdDecompressSync } from 'node:zlib'

const { values, positionals } = parseArgs({ allowPositionals: true, options: { cwd: { type: 'string', default: '/home/user/dev/sample' } } })
const [source, target] = positionals
if (source === undefined || target === undefined) throw new Error('usage: trim-session-fixture.mjs <in> <out> [--cwd <path>]')

const frames = buffer => {
  const ends = []
  let offset = 0
  while (offset < buffer.length) {
    let cursor = offset + 4
    const descriptor = buffer[cursor++]
    const contentSizeFlag = descriptor >>> 6
    const singleSegment = (descriptor & 0x20) !== 0
    const dictionaryFlag = descriptor & 3
    cursor += (singleSegment ? 0 : 1) + (dictionaryFlag === 3 ? 4 : dictionaryFlag) + (contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag)
    for (;;) {
      const header = buffer.readUIntLE(cursor, 3)
      cursor += 3
      cursor += ((header >>> 1) & 3) === 1 ? 1 : header >>> 3
      if (header & 1) break
    }
    if (descriptor & 4) cursor += 4
    ends.push([offset, cursor])
    offset = cursor
  }
  return ends
}

const buffer = readFileSync(source)
const records = frames(buffer).flatMap(([start, end]) =>
  zstdDecompressSync(buffer.subarray(start, end))
    .toString('utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line)),
)

const usage = value =>
  value === undefined
    ? undefined
    : Object.fromEntries(
        ['inputTokens', 'outputTokens', 'totalTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens']
          .filter(key => key in value)
          .map(key => [key, value[key]]),
      )
const reason = value =>
  value === undefined ? undefined : { kind: value.kind, ...(value.failure !== undefined && { failure: { message: 'redacted', code: value.failure.code } }) }
const stream = entries =>
  (entries ?? []).map(entry => ({
    type: entry.type,
    ...(entry.time !== undefined && { time: entry.time }),
    ...(entry.chunk !== undefined && {
      chunk: {
        type: entry.chunk.type,
        ...(entry.chunk.usage && { usage: usage(entry.chunk.usage) }),
        ...(entry.chunk.reason && { reason: reason(entry.chunk.reason) }),
      },
    }),
  }))

const trimData = (type, data) => {
  switch (type) {
    case 'request/header':
      return { header: { config: data.header.config }, reason: data.reason }
    case 'assistant/message':
    case 'assistant/attempt': {
      const source = data.message?.source
      return {
        turn: data.turn,
        step: data.step,
        ...(data.message !== undefined && {
          message: {
            role: 'assistant',
            content: [],
            id: data.message.id,
            source: {
              kind: source?.kind,
              provider: source?.provider,
              model: source?.model,
              ...(source?.replayState?.response?.stopReason && { replayState: { response: { stopReason: source.replayState.response.stopReason } } }),
            },
          },
        }),
        ...(data.usage !== undefined && { usage: usage(data.usage) }),
        stream: stream(data.stream),
      }
    }
    case 'turn/end':
      return {
        turn: data.turn,
        reason: { kind: data.reason?.kind, ...(data.reason?.error !== undefined && { error: { message: 'redacted', code: data.reason.error.code } }) },
      }
    case 'llm/retry':
      return { turn: data.turn, step: data.step, provider: data.provider, retry: data.retry, failure: { message: 'redacted', code: data.failure?.code } }
    case 'compaction/summary':
      return { compactionId: data.compactionId, provider: data.provider, model: data.model, usage: usage(data.usage) }
    case 'session/title-llm-request':
      return { titleProvider: data.titleProvider, route: data.route, maxTokens: data.maxTokens }
    case 'session/title':
      return { title: 'Sample thread', source: data.source?.kind === 'provider' ? { kind: 'provider' } : { kind: data.source?.kind } }
    default:
      return data
  }
}

const KEPT = new Set([
  'request/header',
  'request/context',
  'model/selection',
  'turn/start',
  'turn/end',
  'step/start',
  'step/end',
  'assistant/message',
  'assistant/attempt',
  'llm/retry',
  'llm/retry-started',
  'compaction/start',
  'compaction/summary',
  'compaction/end',
  'session/title-llm-request',
  'session/title',
])

const trimmed = records.flatMap(record => {
  if (record.type === 'session') {
    const { agentPreset: _preset, ...header } = record
    return [{ ...header, cwd: values.cwd, ...(header.parentSession !== undefined && { parentSession: 'session-parent' }) }]
  }
  if (!KEPT.has(record.type)) return []
  return [{ type: record.type, seq: record.seq, time: record.time, data: trimData(record.type, record.data ?? {}) }]
})

const checksum = { params: { [constants.ZSTD_c_checksumFlag]: 1 } }
const out = []
for (let index = 0; index < trimmed.length; index += 16)
  out.push(
    zstdCompressSync(
      `${trimmed
        .slice(index, index + 16)
        .map(record => JSON.stringify(record))
        .join('\n')}\n`,
      checksum,
    ),
  )
writeFileSync(target, Buffer.concat(out))
console.log(`${String(trimmed.length)} of ${String(records.length)} records, ${String(out.length)} frames`)
