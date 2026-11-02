import { Schema } from 'effect'

/** A decoded object keeps the keys it does not declare: the browser copy drops one field, not the whole shape. */
const passthrough = <S extends Schema.StructWithRest.Objects>(schema: S) => Schema.StructWithRest(schema, [Schema.Record(Schema.String, Schema.Unknown)])

const replayStateSchema = passthrough(Schema.Struct({ blocks: Schema.optional(Schema.Array(Schema.Unknown)) }))
const withReplayStateSchema = passthrough(Schema.Struct({ replayState: Schema.optional(replayStateSchema) }))
const assistantDataSchema = passthrough(
  Schema.Struct({
    message: Schema.optional(passthrough(Schema.Struct({ source: Schema.optional(withReplayStateSchema) }))),
    stream: Schema.optional(Schema.Array(passthrough(Schema.Struct({ chunk: Schema.optional(withReplayStateSchema) })))),
  }),
)

type WithReplayState = Schema.Schema.Type<typeof withReplayStateSchema>

/**
 * The browser copy of a Session event. An assistant event carries the provider's replay state twice (on the message
 * source and on its stream chunks), and its per-block entries hold thinking signatures: 65 % of the bytes of one
 * 26 MB opening window. Only the Host replays a provider response, from its own log, so the browser copy keeps the
 * response-level part (ids, native stop reason) and drops the per-block part.
 */
export class BrowserEvent {
  private static readonly assistantTypes: ReadonlySet<string> = new Set(['assistant/message', 'assistant/attempt'])

  static of<Event extends { readonly type: string; readonly data: unknown }>(event: Event): Event {
    if (!BrowserEvent.assistantTypes.has(event.type)) return event
    const parsed = Schema.decodeUnknownResult(assistantDataSchema)(event.data)
    if (parsed._tag === 'Failure') return event
    const { message, stream } = parsed.success
    const carriesBlocks = message?.source?.replayState?.blocks !== undefined || (stream ?? []).some(entry => entry.chunk?.replayState?.blocks !== undefined)
    if (!carriesBlocks) return event
    // The Host freezes Session events, so the browser copy is a new object rather than an edit.
    const keptMessage = message === undefined || message.source === undefined ? message : { ...message, source: BrowserEvent.withoutBlocks(message.source) }
    const keptStream = stream?.map(entry => (entry.chunk === undefined ? entry : { ...entry, chunk: BrowserEvent.withoutBlocks(entry.chunk) }))
    const data = keptMessage === undefined ? parsed.success : { ...parsed.success, message: keptMessage }
    const published = keptStream === undefined ? data : { ...data, stream: keptStream }
    return { ...event, data: published }
  }

  private static withoutBlocks(holder: WithReplayState): WithReplayState {
    if (holder.replayState?.blocks === undefined) return holder
    const { blocks: _blocks, ...replayState } = holder.replayState
    return { ...holder, replayState }
  }
}
