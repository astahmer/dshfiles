import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session/types'
import { Utf8, type MemoryEventInput } from '@dshfiles/optmem-core'

export type CaptureHeader = Pick<SessionHeader, 'cwd' | 'parentSession' | 'origin'> & { readonly id: string }

export type CaptureSession = { readonly id: string; readonly header: CaptureHeader }

export type CapturePolicy = {
  readonly excludedTools: readonly string[]
  readonly excludedPaths: readonly string[]
  readonly captureSubagents: boolean
}

/**
 * User-role messages DSH logs include injected context (runtime context, workspace instructions, skill catalogs) and
 * compaction checkpoints. Those are derived text, not history, and capturing them echoes memory back into memory, so
 * only messages authored by a person, a goal round or another agent are kept.
 */
const capturedUserSources = new Set(['user', 'goal', 'agent-message', 'subagent-settled'])
const toolArgumentBytes = 2_048

const globToRegExp = (glob: string): RegExp => {
  let pattern = ''
  for (let index = 0; index < glob.length; index++) {
    const character = glob[index] ?? ''
    if (character === '*' && glob[index + 1] === '*') {
      const followedBySlash = glob[index + 2] === '/'
      pattern += followedBySlash ? '(?:.*/)?' : '.*'
      index += followedBySlash ? 2 : 1
    } else if (character === '*') pattern += '[^/]*'
    else if (character === '?') pattern += '[^/]'
    else pattern += character.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${pattern}$`)
}

const stringsIn = (value: unknown): readonly string[] => {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(stringsIn)
  if (typeof value === 'object' && value !== null) return Object.values(value).flatMap(stringsIn)
  return []
}

const parseArguments = (raw: string): unknown => {
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

const blockText = (blocks: readonly ContentBlock[]): string =>
  blocks
    .flatMap(block => {
      if (block.type === 'text') return [block.text]
      if (block.type === 'image') return ['[image]']
      if (block.type === 'file') return ['[file]']
      return []
    })
    .join('\n')
    .trim()

type OpenCall = { readonly name: string; readonly excluded: boolean }

/**
 * Turns committed DSH session events into memory events. Stateful only for open tool calls: a result carries just its
 * call id, so the call's name and exclusion decision are kept until the result arrives.
 */
export const createCapture = () => {
  const openCalls = new Map<string, Map<string, OpenCall>>()
  let compiledFor: readonly string[] = []
  let compiled: readonly RegExp[] = []

  const pathPatterns = (globs: readonly string[]): readonly RegExp[] => {
    if (globs !== compiledFor) {
      compiledFor = globs
      compiled = globs.map(globToRegExp)
    }
    return compiled
  }

  const namesExcludedPath = (rawArguments: string, policy: CapturePolicy): boolean => {
    const patterns = pathPatterns(policy.excludedPaths)
    if (patterns.length === 0) return false
    return stringsIn(parseArguments(rawArguments)).some(value => {
      const candidate = value.trim()
      if (!candidate.includes('/') && !candidate.startsWith('.')) return false
      return patterns.some(pattern => pattern.test(candidate) || pattern.test(`/${candidate}`))
    })
  }

  const openCall = (sessionId: string, callId: string, call: OpenCall): void => {
    const calls = openCalls.get(sessionId) ?? new Map<string, OpenCall>()
    calls.set(callId, call)
    openCalls.set(sessionId, calls)
  }

  const closeCall = (sessionId: string, callId: string): OpenCall | undefined => {
    const calls = openCalls.get(sessionId)
    const call = calls?.get(callId)
    calls?.delete(callId)
    if (calls?.size === 0) openCalls.delete(sessionId)
    return call
  }

  const toMemoryEvent = (request: {
    readonly session: CaptureSession
    readonly event: SessionEvent
    readonly projectId: string | null
    readonly policy: CapturePolicy
  }): MemoryEventInput | undefined => {
    const { session, event, policy } = request
    if (session.header.origin === 'subagent' && !policy.captureSubagents) return undefined
    const base = {
      eventKey: `dsh:${session.id}:${event.seq}`,
      harness: 'dsh',
      conversationId: session.id,
      projectId: request.projectId,
      parentConversationId: session.header.parentSession ?? null,
      createdAt: event.time,
    }
    switch (event.type) {
      case 'user/message': {
        if (!capturedUserSources.has(event.data.source.kind)) return undefined
        const text = blockText(event.data.content)
        if (text.length === 0) return undefined
        return { ...base, role: 'user', text, meta: { source: event.data.source.kind } }
      }
      case 'assistant/message': {
        const text = blockText(event.data.message.content)
        if (text.length === 0) return undefined
        return { ...base, role: 'assistant', text, meta: event.data.interrupted ? { interrupted: true } : undefined }
      }
      case 'tool/call': {
        const name = event.data.name
        const meta = { callId: event.data.callId }
        if (policy.excludedTools.includes(name)) {
          openCall(session.id, event.data.callId, { name, excluded: true })
          return { ...base, role: 'tool_call', toolName: name, text: `${name} [excluded tool]`, meta }
        }
        if (namesExcludedPath(event.data.arguments, policy)) {
          openCall(session.id, event.data.callId, { name, excluded: true })
          return { ...base, role: 'tool_call', toolName: name, text: `${name} [excluded: arguments name an excluded path]`, meta }
        }
        openCall(session.id, event.data.callId, { name, excluded: false })
        return { ...base, role: 'tool_call', toolName: name, text: `${name} ${Utf8.boundHeadTail(event.data.arguments, toolArgumentBytes).text}`, meta }
      }
      case 'tool/result': {
        const message = event.data.message
        const call = closeCall(session.id, message.toolCallId)
        const toolName = call?.name
        const meta = { callId: message.toolCallId, isError: message.isError === true }
        if (call?.excluded || (toolName !== undefined && policy.excludedTools.includes(toolName))) {
          return { ...base, role: 'tool_result', toolName, text: '[excluded tool output]', meta }
        }
        const text = blockText(message.content)
        return { ...base, role: 'tool_result', toolName, text: `${toolName ?? 'tool'} → ${text.length === 0 ? '[empty result]' : text}`, meta }
      }
      default:
        return undefined
    }
  }

  return { toMemoryEvent }
}

export type Capture = ReturnType<typeof createCapture>
