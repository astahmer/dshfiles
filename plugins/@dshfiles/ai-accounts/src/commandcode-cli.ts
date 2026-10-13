import { createHash, randomUUID } from 'node:crypto'
import {
  createAssistantMessageEventStream,
  getCurrentSystemPrompt,
  getCurrentTools,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type JsonObject,
  type Message,
  type Model,
  type SimpleStreamOptions,
  type StopReason,
  type TranscriptContext,
} from '@earendil-works/pi-ai'
import { z } from 'zod'

/**
 * The Command Code CLI transport: `POST /alpha/generate`, the endpoint the
 * official `command-code` CLI talks to and the only one a Go plan may use (its
 * Provider API answers `403 upgrade_required`).
 *
 * Ported from @mars-sea/dsh-commandcode-provider 0.12.3 (MIT, Copyright (c) 2026
 * Mars-Sea), which incorporates pi-commandcode-provider (MIT, Copyright (c) 2025
 * Pat Woz); see ../NOTICE. Reimplemented against pi-ai's event stream rather
 * than DSH's chunk protocol, and trimmed to what the endpoint requires.
 *
 * Wire facts, measured against api.commandcode.ai on 2026-10-11:
 * - `x-command-code-version` is the only required client header. Without it the
 *   gateway answers `403 upgrade_required` ("CLI is out of date"); the CLI's
 *   other headers (`x-cli-environment`, `x-project-slug`, `x-taste-learning`,
 *   `x-co-flag`) change nothing and are not sent.
 * - `config` (all ten fields) and `memory` are required body fields; `taste`,
 *   `skills` and `permissionMode` are not, so they are left out.
 * - The response is newline-delimited JSON in the AI SDK stream-part shape
 *   (`text-delta`, `reasoning-delta`, `tool-call`, `finish`, `error`).
 * - The gateway prepends its own system prompt to every request.
 */

/** The CLI release whose wire this matches; the gateway refuses releases below its floor. */
const COMMAND_CODE_CLI_VERSION = '1.74.1'

/** The gateway rejects longer tool-call ids, which another provider's history can carry. */
const MAX_WIRE_TOOL_CALL_ID_LENGTH = 64

const THREAD_ID_NAMESPACE = Buffer.from('6ba7b8119dad11d180b400c04fd430c8', 'hex')
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type WirePart =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'image'; readonly image: string; readonly mimeType: string }
  | { readonly type: 'reasoning'; readonly text: string }
  | { readonly type: 'tool-call'; readonly toolCallId: string; readonly toolName: string; readonly input: JsonObject }

interface WireToolResult {
  readonly type: 'tool-result'
  readonly toolCallId: string
  readonly toolName: string
  readonly output: { readonly type: 'text' | 'error-text'; readonly value: string }
}

type WireMessage =
  | { readonly role: 'user'; readonly content: readonly WirePart[] }
  | { readonly role: 'assistant'; readonly content: readonly WirePart[] }
  | { readonly role: 'tool'; readonly content: readonly WireToolResult[] }

const streamPartSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text-delta'), text: z.string().default('') }),
  z.object({ type: z.literal('reasoning-delta'), text: z.string().default('') }),
  z.object({
    type: z.literal('tool-call'),
    toolCallId: z.string().optional(),
    toolName: z.string().default(''),
    input: z.record(z.string(), z.json()).optional(),
  }),
  z.object({ type: z.literal('cache-write-tokens'), cacheWriteTokens: z.number().nonnegative().optional() }),
  z.object({
    type: z.literal('finish'),
    finishReason: z.string().optional(),
    totalUsage: z
      .object({
        inputTokens: z.number().optional(),
        outputTokens: z.number().optional(),
        reasoningTokens: z.number().optional(),
        inputTokenDetails: z
          .object({ noCacheTokens: z.number().optional(), cacheReadTokens: z.number().optional(), cacheWriteTokens: z.number().optional() })
          .optional(),
      })
      .optional(),
  }),
  z.object({ type: z.literal('error'), error: z.unknown().optional(), message: z.string().optional() }),
])

const errorBodySchema = z.object({
  error: z.union([z.string(), z.object({ code: z.string().optional(), message: z.string().optional() })]),
})

/**
 * The CLI keys prompt caching and analytics by a UUID thread id; DSH session ids
 * are `session-<uuid>`, so a non-UUID id gets a stable UUIDv5.
 */
const threadIdFor = (sessionId: string | undefined): string => {
  if (sessionId === undefined || sessionId === '') return randomUUID()
  if (UUID_PATTERN.test(sessionId)) return sessionId
  const digest = createHash('sha1').update(THREAD_ID_NAMESPACE).update('dsh-commandcode-provider/session/').update(sessionId).digest()
  digest[6] = ((digest[6] ?? 0) & 0x0f) | 0x50
  digest[8] = ((digest[8] ?? 0) & 0x3f) | 0x80
  const hex = digest.toString('hex', 0, 16)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

const resultText = (content: readonly { readonly type: string; readonly text?: string }[]): string =>
  content
    .filter(block => block.type === 'text')
    .map(block => block.text ?? '')
    .join('\n')

/**
 * pi-ai's transcript as the CLI's AI SDK messages. Only a tool call with its
 * result (and the reverse) is sent, since an unanswered call is refused. The
 * gateway takes no images inside a tool result, so they follow it in a user
 * message that names the call they came from.
 */
const toWireMessages = (messages: readonly Message[]): WireMessage[] => {
  const callIds = new Set<string>()
  const resultIds = new Set<string>()
  const toolNames = new Map<string, string>()
  for (const message of messages) {
    if (message.role === 'toolResult') resultIds.add(message.toolCallId)
    if (message.role !== 'assistant') continue
    for (const block of message.content) {
      if (block.type !== 'toolCall') continue
      callIds.add(block.id)
      toolNames.set(block.id, block.name)
    }
  }
  const paired = new Set([...callIds].filter(id => resultIds.has(id)))
  const wireIds = new Map<string, string>()
  for (const id of paired) if (id.length <= MAX_WIRE_TOOL_CALL_ID_LENGTH) wireIds.set(id, id)
  let alias = 1
  for (const id of paired) {
    if (wireIds.has(id)) continue
    while ([...wireIds.values()].includes(`cc-${alias}`)) alias += 1
    wireIds.set(id, `cc-${alias}`)
  }

  const out: WireMessage[] = []
  const carried: WireMessage[] = []
  const flushCarried = (): void => {
    out.push(...carried)
    carried.length = 0
  }
  for (const message of messages) {
    if (message.role === 'system') continue
    if (message.role === 'user') {
      flushCarried()
      const parts: WirePart[] =
        typeof message.content === 'string'
          ? [{ type: 'text', text: message.content }]
          : message.content.map(block =>
              block.type === 'text'
                ? { type: 'text', text: block.text }
                : { type: 'image', image: `data:${block.mimeType};base64,${block.data}`, mimeType: block.mimeType },
            )
      if (parts.length > 0) out.push({ role: 'user', content: parts })
      continue
    }
    if (message.role === 'assistant') {
      flushCarried()
      if (message.stopReason === 'error' || message.stopReason === 'aborted') continue
      const parts: WirePart[] = []
      for (const block of message.content) {
        if (block.type === 'text' && block.text.length > 0) parts.push({ type: 'text', text: block.text })
        if (block.type === 'thinking' && block.redacted !== true && block.thinking.length > 0) parts.push({ type: 'reasoning', text: block.thinking })
        if (block.type === 'toolCall' && paired.has(block.id)) {
          parts.push({ type: 'tool-call', toolCallId: wireIds.get(block.id) ?? block.id, toolName: block.name, input: block.arguments })
        }
      }
      if (parts.length > 0) out.push({ role: 'assistant', content: parts })
      continue
    }
    if (!paired.has(message.toolCallId)) continue
    const wireId = wireIds.get(message.toolCallId) ?? message.toolCallId
    const images = message.content.flatMap(block => (block.type === 'image' ? [block] : []))
    const text = resultText(message.content)
    out.push({
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: wireId,
          toolName: toolNames.get(message.toolCallId) || message.toolName || 'unknown',
          output: { type: message.isError ? 'error-text' : 'text', value: text || (images.length > 0 ? '(image returned; see the attached image)' : '') },
        },
      ],
    })
    if (images.length > 0) {
      carried.push({
        role: 'user',
        content: [
          { type: 'text', text: `Attached image(s) from tool result (${wireId}):` },
          ...images.map(image => ({ type: 'image' as const, image: `data:${image.mimeType};base64,${image.data}`, mimeType: image.mimeType })),
        ],
      })
    }
  }
  flushCarried()
  return out
}

/** The ten `config` fields are required; they describe a workspace the CLI would have, so none of ours is sent. */
const requestBody = (model: Model<string>, context: TranscriptContext, options: SimpleStreamOptions | undefined) => {
  const reasoningEffort = options?.reasoning === undefined ? undefined : model.thinkingLevelMap?.[options.reasoning]
  const system = getCurrentSystemPrompt(context.messages)
  return {
    config: {
      workingDir: '.',
      date: new Date().toISOString().slice(0, 10),
      environment: `${process.platform}-${process.arch}`,
      structure: [],
      isGitRepo: false,
      currentBranch: '',
      mainBranch: '',
      gitStatus: '',
      recentCommits: [],
    },
    memory: null,
    params: {
      model: model.id,
      messages: toWireMessages(context.messages),
      tools: getCurrentTools(context.messages).map(tool => ({
        type: 'function',
        name: tool.name,
        description: tool.description,
        input_schema: tool.parameters,
      })),
      system: system === '' ? '' : [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      max_tokens: options?.maxTokens ?? model.maxTokens,
      stream: true,
      ...(options?.temperature === undefined ? {} : { temperature: options.temperature }),
      ...(typeof reasoningEffort === 'string' ? { reasoning_effort: reasoningEffort } : {}),
    },
    threadId: threadIdFor(options?.sessionId),
  }
}

const stopReasonFor = (finishReason: string | undefined): Extract<StopReason, 'stop' | 'length' | 'toolUse'> => {
  if (finishReason === 'tool-calls' || finishReason === 'tool_calls' || finishReason === 'tool_use') return 'toolUse'
  if (finishReason === 'length' || finishReason === 'max_tokens' || finishReason === 'max-tokens' || finishReason === 'max_output_tokens') return 'length'
  return 'stop'
}

/** The message leads with the status code so DSH classifies it (429 rate limit, 5xx server, 401/403 auth). */
const httpFailure = (status: number, body: string): string => {
  let detail = body.slice(0, 500)
  try {
    const parsed = errorBodySchema.safeParse(JSON.parse(body))
    if (parsed.success)
      detail = typeof parsed.data.error === 'string' ? parsed.data.error : [parsed.data.error.code, parsed.data.error.message].filter(Boolean).join(': ')
  } catch {
    // A non-JSON body is reported as text.
  }
  return `${String(status)} Command Code /alpha/generate: ${detail}`
}

const streamErrorText = (error: unknown, message: string | undefined): string => {
  if (typeof error === 'string') return error
  const parsed = z.object({ message: z.string(), statusCode: z.number().optional() }).safeParse(error)
  if (parsed.success) return parsed.data.statusCode === undefined ? parsed.data.message : `${String(parsed.data.statusCode)} ${parsed.data.message}`
  return message ?? 'Command Code stream error'
}

export const streamCommandCodeCli = (input: {
  readonly root: string
  readonly model: Model<string>
  readonly context: TranscriptContext
  readonly options?: SimpleStreamOptions
}): AssistantMessageEventStream => {
  const { model, options } = input
  const stream = createAssistantMessageEventStream()
  const output: AssistantMessage = {
    role: 'assistant',
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: 'stop',
    timestamp: Date.now(),
  }
  const fail = (reason: 'error' | 'aborted', message: string): void => {
    output.stopReason = reason
    output.errorMessage = message
    stream.push({ type: 'error', reason, error: output })
    stream.end(output)
  }

  void (async () => {
    const apiKey = options?.apiKey ?? ''
    if (apiKey === '') return fail('error', 'Command Code has no API key: export the account key variable or run `cmd login`.')
    const headers: Record<string, string> = {}
    for (const [name, value] of Object.entries(options?.headers ?? {})) if (value !== null) headers[name] = value
    const response = await (options?.fetch ?? fetch)(`${input.root}/alpha/generate`, {
      method: 'POST',
      headers: {
        ...headers,
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
        'x-command-code-version': COMMAND_CODE_CLI_VERSION,
      },
      body: JSON.stringify(requestBody(model, input.context, options)),
      signal: options?.signal,
    })
    if (!response.ok || response.body === null) return fail('error', httpFailure(response.status, await response.text()))
    stream.push({ type: 'start', partial: output })

    let openIndex = -1
    let cacheWrite: number | undefined
    const closeOpen = (): void => {
      const block = output.content[openIndex]
      if (block?.type === 'text') stream.push({ type: 'text_end', contentIndex: openIndex, content: block.text, partial: output })
      if (block?.type === 'thinking') stream.push({ type: 'thinking_end', contentIndex: openIndex, content: block.thinking, partial: output })
      openIndex = -1
    }
    const handle = (line: string): boolean => {
      const trimmed = line.trim().replace(/^data:\s*/, '')
      if (trimmed === '' || trimmed === '[DONE]') return false
      let raw: unknown
      try {
        raw = JSON.parse(trimmed)
      } catch {
        return false
      }
      const parsed = streamPartSchema.safeParse(raw)
      if (!parsed.success) return false
      const part = parsed.data
      switch (part.type) {
        case 'text-delta': {
          if (output.content[openIndex]?.type !== 'text') {
            closeOpen()
            openIndex = output.content.push({ type: 'text', text: '' }) - 1
            stream.push({ type: 'text_start', contentIndex: openIndex, partial: output })
          }
          const block = output.content[openIndex]
          if (block?.type === 'text') block.text += part.text
          stream.push({ type: 'text_delta', contentIndex: openIndex, delta: part.text, partial: output })
          return false
        }
        case 'reasoning-delta': {
          if (output.content[openIndex]?.type !== 'thinking') {
            closeOpen()
            openIndex = output.content.push({ type: 'thinking', thinking: '' }) - 1
            stream.push({ type: 'thinking_start', contentIndex: openIndex, partial: output })
          }
          const block = output.content[openIndex]
          if (block?.type === 'thinking') block.thinking += part.text
          stream.push({ type: 'thinking_delta', contentIndex: openIndex, delta: part.text, partial: output })
          return false
        }
        case 'tool-call': {
          closeOpen()
          const toolCall = { type: 'toolCall' as const, id: part.toolCallId ?? randomUUID(), name: part.toolName, arguments: part.input ?? {} }
          const index = output.content.push(toolCall) - 1
          stream.push({ type: 'toolcall_start', contentIndex: index, partial: output })
          stream.push({ type: 'toolcall_delta', contentIndex: index, delta: JSON.stringify(toolCall.arguments), partial: output })
          stream.push({ type: 'toolcall_end', contentIndex: index, toolCall, partial: output })
          return false
        }
        case 'cache-write-tokens':
          cacheWrite = part.cacheWriteTokens
          return false
        case 'finish': {
          closeOpen()
          const usage = part.totalUsage
          const cacheRead = usage?.inputTokenDetails?.cacheReadTokens ?? 0
          const reportedWrite = usage?.inputTokenDetails?.cacheWriteTokens ?? 0
          const written = reportedWrite === 0 && cacheWrite !== undefined ? cacheWrite : reportedWrite
          output.usage = {
            input: usage?.inputTokenDetails?.noCacheTokens ?? Math.max(0, (usage?.inputTokens ?? 0) - cacheRead - written),
            output: usage?.outputTokens ?? 0,
            cacheRead,
            cacheWrite: written,
            ...(usage?.reasoningTokens === undefined ? {} : { reasoning: usage.reasoningTokens }),
            totalTokens: (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0),
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          }
          const reason = stopReasonFor(part.finishReason)
          output.stopReason = reason
          if (part.finishReason !== undefined) output.rawStopReason = part.finishReason
          stream.push({ type: 'done', reason, message: output })
          stream.end(output)
          return true
        }
        case 'error':
          closeOpen()
          fail('error', streamErrorText(part.error, part.message))
          return true
      }
    }

    const decoder = new TextDecoder()
    let buffer = ''
    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) if (handle(line)) return
    }
    if (handle(buffer + decoder.decode())) return
    fail('error', 'Command Code stream ended without a finish event')
  })().catch((error: unknown) => {
    if (options?.signal?.aborted === true) return fail('aborted', 'Command Code request aborted')
    fail('error', `Command Code network error: ${error instanceof Error ? error.message : String(error)}`)
  })
  return stream
}
