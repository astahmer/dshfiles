import type { RuntimeDriverHistory, RuntimeDriverHistoryMessage, RuntimeDriverHistoryOmission } from '@deepseek-ai/dsh-agent'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

const MAX_HISTORY_MESSAGES = 80
const MAX_HISTORY_CHARACTERS = 32_000
const MAX_OMISSION_RANGES = 512

type OmissionReason = RuntimeDriverHistoryOmission['reason']

const omissionReasons = {
  agentContext: 'agent-context',
  attachment: 'attachment',
  privateContent: 'private-content',
  toolState: 'tool-state',
  historyBudget: 'history-budget',
} satisfies Record<string, OmissionReason>

export const projectRuntimeDriverHistory = (events: readonly SessionEvent[]): RuntimeDriverHistory => {
  const messages: RuntimeDriverHistoryMessage[] = []
  const omissions: RuntimeDriverHistoryOmission[] = []
  let characters = 0
  let omittedCount = 0
  let omissionIndexComplete = true
  let messageLimitReached = false

  const omit = (seq: number, reason: OmissionReason): void => {
    omittedCount += 1
    const lastIndex = omissions.length - 1
    const last = omissions[lastIndex]
    if (last !== undefined && last.reason === reason && seq + 1 === last.fromSeq) {
      omissions[lastIndex] = { ...last, fromSeq: seq, count: last.count + 1 }
      return
    }
    if (omissions.length >= MAX_OMISSION_RANGES) {
      omissionIndexComplete = false
      return
    }
    omissions.push({ fromSeq: seq, throughSeq: seq, reason, count: 1 })
  }

  const keep = (seq: number, speaker: RuntimeDriverHistoryMessage['speaker'], parts: readonly string[]): void => {
    if (parts.length === 0) return
    if (messageLimitReached || messages.length >= MAX_HISTORY_MESSAGES) {
      messageLimitReached = true
      omit(seq, omissionReasons.historyBudget)
      return
    }
    const messageCharacters = parts.reduce((total, part) => total + part.length, 0)
    if (characters + messageCharacters > MAX_HISTORY_CHARACTERS) {
      omit(seq, omissionReasons.historyBudget)
      return
    }
    characters += messageCharacters
    messages.push(Object.freeze({ seq, speaker, parts: Object.freeze([...parts]) }))
  }

  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event === undefined) continue
    if (event.type === 'user/message') {
      if (event.data.source.kind !== 'user') {
        omit(event.seq, omissionReasons.agentContext)
        continue
      }
      const parts: string[] = []
      let hasAttachment = false
      for (const block of event.data.content) {
        if (block.type === 'text') parts.push(block.text)
        else hasAttachment = true
      }
      if (hasAttachment) omit(event.seq, omissionReasons.attachment)
      keep(event.seq, 'user', parts)
      continue
    }
    if (event.type === 'assistant/message') {
      const parts: string[] = []
      let hasPrivateContent = false
      for (const block of event.data.message.content) {
        if (block.type === 'text') parts.push(block.text)
        else hasPrivateContent = true
      }
      if (hasPrivateContent) omit(event.seq, omissionReasons.privateContent)
      keep(event.seq, 'assistant', parts)
      continue
    }
    if (event.type === 'assistant/attempt') {
      omit(event.seq, omissionReasons.privateContent)
      continue
    }
    if (event.type === 'tool/call' || event.type === 'tool/result') {
      omit(event.seq, omissionReasons.toolState)
    }
  }

  return Object.freeze({
    throughSeq: events.at(-1)?.seq ?? -1,
    messages: Object.freeze(messages.reverse()),
    omissions: Object.freeze(omissions.reverse()),
    omittedCount,
    omissionIndexComplete,
  })
}
