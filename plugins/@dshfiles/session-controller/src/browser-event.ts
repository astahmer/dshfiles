import { Schema } from 'effect'

/** A decoded object keeps the keys it does not declare: the browser copy drops one field, not the whole shape. */
const passthrough = <S extends Schema.StructWithRest.Objects>(schema: S) => Schema.StructWithRest(schema, [Schema.Record(Schema.String, Schema.Unknown)])

const replayStateSchema = passthrough(Schema.Struct({ blocks: Schema.optional(Schema.Array(Schema.Unknown)) }))
const withReplayStateSchema = passthrough(Schema.Struct({ replayState: Schema.optional(replayStateSchema) }))
const assistantDataSchema = passthrough(
  Schema.Struct({
    message: Schema.optional(passthrough(Schema.Struct({ source: Schema.optional(withReplayStateSchema) }))),
    stream: Schema.optional(Schema.Array(Schema.Unknown)),
  }),
)

const textRunSchema = passthrough(Schema.Struct({
  type: Schema.Literals(['text-chunks', 'reasoning-chunks']),
  dt: Schema.Array(Schema.Number),
  texts: Schema.Array(Schema.String),
}))
const toolRunSchema = passthrough(Schema.Struct({
  type: Schema.Literal('tool-call-chunks'),
  dt: Schema.Array(Schema.Number),
  name: Schema.optional(Schema.String),
  args: Schema.Array(Schema.String),
}))
const chunkRecordSchema = passthrough(Schema.Struct({
  type: Schema.Literal('chunk'),
  chunk: passthrough(Schema.Struct({
    type: Schema.String,
    text: Schema.optional(Schema.String),
    argumentsDelta: Schema.optional(Schema.String),
    name: Schema.optional(Schema.String),
  })),
}))

type WithReplayState = Schema.Schema.Type<typeof withReplayStateSchema>

/**
 * The browser copy of a Session event. Two parts of a settled assistant event are bytes no browser reader needs:
 * 1. Provider replay state (thinking signatures) on the message source: only the Host replays a provider response.
 * 2. The recorded chunk stream, which repeats every text and argument of `message` (three times, with its block-end
 *    chunks): 39 % of a live 1.15 MB opening window. A live view got those chunks as assistant-stream frames already.
 *    The browser's one settled-stream reader that renders by default, Trajectory's first-token time
 *    (`assistantStreamFirstTokenTime`), reads only the record holding the first token, so the copy keeps that record
 *    trimmed to its first token.
 */
export class BrowserEvent {
  private static readonly assistantTypes: ReadonlySet<string> = new Set(['assistant/message', 'assistant/attempt'])

  static of<Event extends { readonly type: string; readonly data: unknown }>(event: Event): Event {
    if (!BrowserEvent.assistantTypes.has(event.type)) return event
    const parsed = Schema.decodeUnknownResult(assistantDataSchema)(event.data)
    if (parsed._tag === 'Failure') return event
    const { message, stream } = parsed.success
    const keptStream = stream === undefined ? undefined : BrowserEvent.firstTokenStream(stream)
    const carriesBlocks = message?.source?.replayState?.blocks !== undefined
    if (!carriesBlocks && keptStream === stream) return event
    // The Host freezes Session events, so the browser copy is a new object rather than an edit.
    const keptMessage = message === undefined || message.source === undefined ? message : { ...message, source: BrowserEvent.withoutBlocks(message.source) }
    const data = keptMessage === undefined ? parsed.success : { ...parsed.success, message: keptMessage }
    const published = keptStream === undefined ? data : { ...data, stream: keptStream }
    return { ...event, data: published }
  }

  private static withoutBlocks(holder: WithReplayState): WithReplayState {
    if (holder.replayState?.blocks === undefined) return holder
    const { blocks: _blocks, ...replayState } = holder.replayState
    return { ...holder, replayState }
  }

  /**
   * The record holding the stream's first token (dsh-llm `isTokenDelta`), trimmed to it; empty without one.
   * @returns `stream` itself when it already is that single untrimmed record.
   */
  private static firstTokenStream(stream: readonly unknown[]): readonly unknown[] {
    for (const record of stream) {
      const kept = BrowserEvent.firstTokenOf(record)
      if (kept === undefined) continue
      return stream.length === 1 && kept === record ? stream : [kept]
    }
    return stream.length === 0 ? stream : []
  }

  /** @returns `record` when its last member is the first token, a trimmed copy when later members follow it. */
  private static firstTokenOf(record: unknown): unknown {
    const text = Schema.decodeUnknownResult(textRunSchema)(record)
    if (text._tag === 'Success') return BrowserEvent.trimRun(record, text.success, 'texts', text.success.texts.findIndex(fragment => fragment !== ''))
    const tool = Schema.decodeUnknownResult(toolRunSchema)(record)
    if (tool._tag === 'Success') {
      const first = tool.success.name === undefined ? tool.success.args.findIndex(fragment => fragment !== '') : 0
      return BrowserEvent.trimRun(record, tool.success, 'args', first)
    }
    const raw = Schema.decodeUnknownResult(chunkRecordSchema)(record)
    if (raw._tag === 'Failure') return undefined
    const chunk = raw.success.chunk
    const token = chunk.type === 'text-delta' || chunk.type === 'reasoning-delta'
      ? (chunk.text ?? '') !== ''
      : chunk.type === 'tool-call-delta' && ((chunk.argumentsDelta ?? '') !== '' || chunk.name !== undefined)
    return token ? record : undefined
  }

  /** A run keeps its members through `first`; `dt` holds one gap per later member, so it keeps `first` gaps. */
  private static trimRun<Run extends Readonly<Record<'dt', readonly number[]>> & Readonly<Partial<Record<'texts' | 'args', readonly string[]>>>>(
    record: unknown,
    run: Run,
    key: 'texts' | 'args',
    first: number,
  ): unknown {
    const fragments = run[key] ?? []
    if (first < 0) return undefined
    if (first === fragments.length - 1) return record
    return { ...run, dt: run.dt.slice(0, first), [key]: fragments.slice(0, first + 1) }
  }
}
