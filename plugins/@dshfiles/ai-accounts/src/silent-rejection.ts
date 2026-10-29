import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'

/**
 * OpenCode Go answers some malformed requests with HTTP 400 and a body that holds only `{"model": …}`; the OpenAI SDK
 * then reports "400 status code (no body)", which names nothing. Probed against deepseek-v4.1-flash: two tools with
 * the same name and a tool result whose call is missing both get that answer, while tool schemas carrying `$schema`,
 * `minLength`/`maxLength`, empty `properties` or optional fields (strict or not) are accepted.
 */
const SILENT_REJECTION = /\(no body\)/

const duplicateToolNames = (options: GenerateOptions): readonly string[] => {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const tool of options.tools ?? []) {
    if (seen.has(tool.name)) duplicates.add(tool.name)
    seen.add(tool.name)
  }
  return [...duplicates]
}

const unansweredResultIds = (options: GenerateOptions): readonly string[] => {
  const calls = new Set<string>()
  const orphans: string[] = []
  for (const message of options.messages) {
    if (message.role === 'assistant') for (const block of message.content) if (block.type === 'tool-call') calls.add(block.id)
    if (message.role === 'tool' && !calls.has(message.toolCallId)) orphans.push(message.toolCallId)
  }
  return orphans
}

/** The request part a silent 400 most likely refers to, or the request's shape when no known cause is present. */
const describeSilentRejection = (options: GenerateOptions): string => {
  const duplicates = duplicateToolNames(options)
  if (duplicates.length > 0) return `the request declares these tools more than once: ${duplicates.join(', ')}`
  const orphans = unansweredResultIds(options)
  if (orphans.length > 0) return `tool results answer calls no earlier assistant message made: ${orphans.join(', ')}`
  const lastAdditions = options.toolHistory?.updates.at(-1)?.additions.map(tool => tool.name) ?? []
  return [
    `no known cause found in ${options.messages.length} messages and ${options.tools?.length ?? 0} tools`,
    ...(lastAdditions.length > 0 ? [`the latest tool update added ${lastAdditions.join(', ')}`] : []),
  ].join('; ')
}

/** Rewrites a "(no body)" provider failure so the turn error says what in the request was likely rejected. */
export async function* explainSilentRejections(chunks: AsyncIterable<StreamChunk>, options: GenerateOptions): AsyncIterable<StreamChunk> {
  for await (const chunk of chunks) {
    if (chunk.type !== 'finish' || chunk.reason.kind !== 'error' || !SILENT_REJECTION.test(chunk.reason.failure.message)) {
      yield chunk
      continue
    }
    const failure = chunk.reason.failure
    yield {
      ...chunk,
      reason: {
        ...chunk.reason,
        failure: { ...failure, message: `${failure.message}: ${options.provider} gave no reason; ${describeSilentRejection(options)}.` },
      },
    }
  }
}
