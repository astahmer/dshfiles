import { z } from 'zod'

const withReplayState = z.looseObject({ replayState: z.looseObject({ blocks: z.array(z.unknown()).optional() }).optional() })
const assistantData = z.looseObject({
  message: z.looseObject({ source: withReplayState.optional() }).optional(),
  stream: z.array(z.looseObject({ chunk: withReplayState.optional() })).optional(),
})

type WithReplayState = z.infer<typeof withReplayState>

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
    const parsed = assistantData.safeParse(event.data)
    if (!parsed.success) return event
    const { message, stream } = parsed.data
    const carriesBlocks = message?.source?.replayState?.blocks !== undefined || (stream ?? []).some(entry => entry.chunk?.replayState?.blocks !== undefined)
    if (!carriesBlocks) return event
    // The Host freezes Session events, so the browser copy is a new object rather than an edit.
    const data = { ...parsed.data }
    if (message?.source !== undefined) data.message = { ...message, source: BrowserEvent.withoutBlocks(message.source) }
    if (stream !== undefined)
      data.stream = stream.map(entry => (entry.chunk === undefined ? entry : { ...entry, chunk: BrowserEvent.withoutBlocks(entry.chunk) }))
    return { ...event, data }
  }

  private static withoutBlocks(holder: WithReplayState): WithReplayState {
    if (holder.replayState?.blocks === undefined) return holder
    const { blocks: _blocks, ...replayState } = holder.replayState
    return { ...holder, replayState }
  }
}
