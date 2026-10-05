import { z } from 'zod'

export const MAX_RECENT_PROMPTS = 20
export const MAX_RECENT_SCAN_NODES = 1_000

const MAX_RECENT_PROMPT_TEXT_LENGTH = 20_000

const chatNodeSchema = z
  .object({
    kind: z.string().max(100),
    id: z.string().min(1).max(500),
    target: z.literal('chat'),
    anchorSeq: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    data: z.unknown(),
  })
  .passthrough()

const userMessageSchema = z
  .object({
    kind: z.literal('user'),
    seq: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    time: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    content: z.array(z.unknown()).max(1_000),
    source: z.object({ kind: z.literal('user') }).passthrough(),
  })
  .passthrough()

const textBlockSchema = z
  .object({
    type: z.literal('text'),
    text: z.string(),
  })
  .passthrough()

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
    const nodeResult = chatNodeSchema.safeParse(untrustedNode)
    if (!nodeResult.success || nodeResult.data.kind !== 'user') continue

    const messageResult = userMessageSchema.safeParse(nodeResult.data.data)
    if (!messageResult.success || messageResult.data.seq !== nodeResult.data.anchorSeq) continue

    let text = ''
    let oversized = false
    for (const block of messageResult.data.content) {
      const textResult = textBlockSchema.safeParse(block)
      if (!textResult.success) continue
      if (text.length + textResult.data.text.length > MAX_RECENT_PROMPT_TEXT_LENGTH) {
        oversized = true
        break
      }
      text += textResult.data.text
    }

    if (oversized || text.trim().length === 0) continue

    const id = nodeResult.data.id + ':' + messageResult.data.seq
    if (seen.has(id)) continue
    seen.add(id)
    prompts.push(
      Object.freeze({
        id,
        seq: messageResult.data.seq,
        time: messageResult.data.time,
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
