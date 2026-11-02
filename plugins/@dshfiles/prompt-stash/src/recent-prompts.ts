import * as Schema from 'effect/Schema'

export const MAX_RECENT_PROMPTS = 20
export const MAX_RECENT_SCAN_NODES = 1_000

const MAX_RECENT_PROMPT_TEXT_LENGTH = 20_000

const boundedCount = Schema.Number.check(
  Schema.isFinite(),
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(0),
  Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER),
)

const chatNodeSchema = Schema.StructWithRest(
  Schema.Struct({
    kind: Schema.String.check(Schema.isMaxLength(100)),
    id: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(500)),
    target: Schema.Literal('chat'),
    anchorSeq: boundedCount,
    data: Schema.Unknown,
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
)

const userMessageSchema = Schema.StructWithRest(
  Schema.Struct({
    kind: Schema.Literal('user'),
    seq: boundedCount,
    time: boundedCount,
    content: Schema.Array(Schema.Unknown).check(Schema.isMaxLength(1_000)),
    source: Schema.StructWithRest(Schema.Struct({ kind: Schema.Literal('user') }), [Schema.Record(Schema.String, Schema.Unknown)]),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
)

const textBlockSchema = Schema.StructWithRest(Schema.Struct({ type: Schema.Literal('text'), text: Schema.String }), [
  Schema.Record(Schema.String, Schema.Unknown),
])

export interface RecentPrompt {
  readonly id: string
  readonly seq: number
  readonly time: number
  readonly text: string
}

export const projectRecentPrompts = (newestFirstNodes: Iterable<unknown>): readonly RecentPrompt[] => {
  const prompts: RecentPrompt[] = []
  const seen = new Set<string>()

  for (const untrustedNode of newestFirstNodes) {
    const nodeResult = Schema.decodeUnknownResult(chatNodeSchema)(untrustedNode)
    if (nodeResult._tag !== 'Success' || nodeResult.success.kind !== 'user') continue

    const messageResult = Schema.decodeUnknownResult(userMessageSchema)(nodeResult.success.data)
    if (messageResult._tag !== 'Success' || messageResult.success.seq !== nodeResult.success.anchorSeq) continue

    const textBlocks = messageResult.success.content.map(block => Schema.decodeUnknownResult(textBlockSchema)(block))

    const text = textBlocks.flatMap(result => (result._tag === 'Success' ? [result.success.text] : [])).join('')
    if (text.length > MAX_RECENT_PROMPT_TEXT_LENGTH || text.trim().length === 0) continue

    const id = nodeResult.success.id + ':' + messageResult.success.seq
    if (seen.has(id)) continue
    seen.add(id)
    prompts.push(
      Object.freeze({
        id,
        seq: messageResult.success.seq,
        time: messageResult.success.time,
        text,
      }),
    )
    if (prompts.length === MAX_RECENT_PROMPTS) break
  }

  return Object.freeze(prompts)
}

export const areRecentPromptsEqual = (left: readonly RecentPrompt[], right: readonly RecentPrompt[]): boolean => {
  if (left.length !== right.length) return false

  return left.every((prompt, index) => {
    const other = right[index]
    return other !== undefined && prompt.id === other.id && prompt.seq === other.seq && prompt.time === other.time && prompt.text === other.text
  })
}
