import { mkdir, writeFile } from 'node:fs/promises'
import { constants, zstdCompressSync } from 'node:zlib'
import { appendFile } from 'node:fs/promises'
import { withoutUndefined } from '../src/optional-fields.js'
import type { JsonValue } from '../src/protocol.js'

/**
 * Write a session log the way the JSONL persistence backend does: a header frame followed by one checksummed,
 * independently decodable Zstandard frame per batch. Tests need that container, because a one-shot decoder stops at the
 * first frame and would silently prove nothing about resume.
 */
export const writeSessionLog = async (input: {
  readonly directory: string
  readonly exchanges: number
  readonly sessionId?: string
  readonly framePerEvent?: boolean
}): Promise<string> => {
  const { directory, exchanges } = input
  await mkdir(directory, { recursive: true })
  const id = input.sessionId ?? directory.slice(directory.lastIndexOf('/') + 1)
  const compress = (text: string): Buffer => zstdCompressSync(Buffer.from(text, 'utf8'), { params: { [constants.ZSTD_c_checksumFlag]: 1 } })
  let seq = -1
  let time = 1_700_000_000_000
  const lines: string[] = [
    `${JSON.stringify({ type: 'session', version: 4, id, createdAt: time, cwd: '/dev/dshfiles', isSeeded: false, delegationDepth: 0, agentPreset: 'standard' })}\n`,
  ]
  const next = (type: string, data: JsonValue, surfaceOp?: string): void => {
    seq += 1
    time += 1_000
    lines.push(`${JSON.stringify(withoutUndefined({ type, seq, time, data, surfaceOp }))}\n`)
  }
  for (let index = 1; index <= exchanges; index += 1) {
    next('turn/start', { turn: index })
    next(
      'user/message',
      {
        id: `msg-${String(index)}`,
        role: 'user',
        content: [{ type: 'text', text: `exchange ${String(index)} about the retry storm` }],
        source: { kind: 'user' },
      },
      'append',
    )
    next(
      'assistant/message',
      {
        turn: index,
        step: 1,
        message: {
          id: `answer-${String(index)}`,
          role: 'assistant',
          content: [{ type: 'text', text: `capped the retry storm in exchange ${String(index)}` }],
          source: { provider: 'fake', model: 'fake-model' },
        },
        stream: [],
      },
      'append',
    )
    next('turn/end', { turn: index, reason: { kind: 'completed' } })
  }
  const perEvent = input.framePerEvent ?? true
  const frames: Buffer[] = [compress(lines[0] ?? '')]
  let batch = ''
  for (const line of lines.slice(1)) {
    batch += line
    if (perEvent) {
      frames.push(compress(batch))
      batch = ''
    }
  }
  if (batch.length > 0) frames.push(compress(batch))
  const path = `${directory}/session.v4.jsonl.zstd`
  await writeFile(path, Buffer.concat(frames))
  return path
}

/** Append one committed event as a new frame, the way the persistence writer appends a batch. */
export const appendSessionLogEvent = async (
  path: string,
  event: { readonly type: string; readonly seq: number; readonly time: number; readonly data: JsonValue },
): Promise<void> => {
  const frame = zstdCompressSync(Buffer.from(`${JSON.stringify(event)}\n`, 'utf8'), { params: { [constants.ZSTD_c_checksumFlag]: 1 } })
  await appendFile(path, frame)
}
