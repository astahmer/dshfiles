import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { CompactionId, compactCheckpointSource } from '@deepseek-ai/dsh-compaction'
import { ToolCallId, createAssistantMessage, createToolResultMessage, createUserMessage, type ContentBlock } from '@deepseek-ai/dsh-llm'
import { SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session/types'
import { Utf8, type Summarizer } from '@dshfiles/optmem-core'

import type { CaptureHeader, CaptureSession } from '../capture.ts'
import { createOptmemRuntime, type HostServices, type SessionLogSource } from '../runtime.ts'
import type { OptmemSettings } from '../settings.ts'

/** Event shapes follow the committed DSH session log (dsh-session SessionEventMap), built with DSH's own constructors. */
export const createSessionFixture = (header: CaptureHeader) => {
  let seq = 0
  let time = 1_760_000_000_000
  const events: SessionEvent[] = []
  const next = <Event extends SessionEvent>(build: (base: { readonly seq: ReturnType<typeof SessionSeq>; readonly time: number }) => Event): Event => {
    const event = build({ seq: SessionSeq(seq++), time: (time += 1_000) })
    events.push(event)
    return event
  }
  const session: CaptureSession = { id: header.id, header }
  return {
    session,
    events,
    user: (text: string, kind: 'user' | 'compact-checkpoint' = 'user'): SessionEvent =>
      next(base => ({
        ...base,
        type: 'user/message',
        data: createUserMessage({
          content: [{ type: 'text', text }],
          source: kind === 'user' ? { kind: 'user' } : compactCheckpointSource(CompactionId('compaction-1')),
        }),
        surfaceOp: 'append',
      })),
    /** Injected context exactly as DSH logs it; these source kinds are declared in modules their packages do not export. */
    injected: (text: string, kind: 'runtime-context' | 'agent-instructions' | 'skill-catalog'): SessionEvent => {
      const event: SessionEvent = JSON.parse(
        JSON.stringify({
          type: 'user/message',
          seq: seq++,
          time: (time += 1_000),
          data: { id: `context-${seq}`, role: 'user', content: [{ type: 'text', text }], source: { kind } },
          surfaceOp: 'append',
        }),
      )
      events.push(event)
      return event
    },
    assistant: (content: ContentBlock[]): SessionEvent =>
      next(base => ({
        ...base,
        type: 'assistant/message',
        data: { turn: 1, step: 1, message: createAssistantMessage({ content, source: { provider: 'fake', model: 'fake-model' } }), stream: [] },
        surfaceOp: 'append',
      })),
    toolCall: (callId: string, name: string, args: unknown): SessionEvent =>
      next(base => ({ ...base, type: 'tool/call', data: { turn: 1, step: 1, callId: ToolCallId(callId), name, arguments: JSON.stringify(args) } })),
    toolResult: (callId: string, text: string): SessionEvent =>
      next(base => ({
        ...base,
        type: 'tool/result',
        data: { turn: 1, step: 1, message: createToolResultMessage({ callId: ToolCallId(callId), content: [{ type: 'text', text }], isError: false }) },
        surfaceOp: 'append',
      })),
    turnStart: (turn: number): SessionEvent => next(base => ({ ...base, type: 'turn/start', data: { turn } })),
    requestHeader: (provider: string, model: string): SessionEvent =>
      next(base => ({ ...base, type: 'request/header', data: { header: { config: { provider, model } }, reason: 'initial' } })),
  }
}

export const defaultSettings: OptmemSettings = {
  enabled: true,
  mode: 'compat',
  injectUpperBytes: 2_048,
  injectLowerBytes: 1_024,
  injectRefreshBytes: 0,
  viewUpperBytes: 16_000,
  viewLowerBytes: 8_000,
  maxNodeBytes: 512,
  summarizerProvider: '',
  summarizerModel: '',
  summarizerEffort: '',
  cheapModels: [],
  summarizerFallbacks: [],
  summarizerPaused: false,
  summarizerConcurrency: 2,
  summarizerTimeoutMs: 5_000,
  barrierMs: 1_000,
  toolResultCap: 4_096,
  excludedTools: [],
  excludedPaths: ['**/.env', '**/*.pem'],
  allowAllProjects: false,
  captureSubagents: true,
}

/** Deterministic stand-in for the summary model: keeps a squashed prefix within the budget. */
export const fakeSummarizer = (): Summarizer & { readonly calls: string[] } => {
  const calls: string[] = []
  return {
    calls,
    summarize: async request => {
      calls.push(request.kind)
      return { text: Utf8.clip(`${request.kind === 'leaf' ? 'L' : 'M'}: ${request.input.join(' / ').replace(/\s+/g, ' ')}`, request.maxBytes), model: 'fake' }
    },
  }
}

export const createTempHome = () => {
  const directory = mkdtempSync(join(tmpdir(), 'optmem-plugin-'))
  return { directory, cleanup: () => rmSync(directory, { recursive: true, force: true }) }
}

export const createTestRuntime = (request: {
  readonly databasePath: string
  readonly settings?: Partial<OptmemSettings>
  readonly workspaces?: Readonly<Record<string, string>>
  readonly sessionLogs?: SessionLogSource
  readonly summarizer?: Summarizer
  readonly requestMessagesHook?: boolean
}) => {
  let settings: OptmemSettings = { ...defaultSettings, ...request.settings }
  const warnings: string[] = []
  const services: HostServices = {
    has: () => true,
    requestMessagesHook: () => request.requestMessagesHook ?? false,
    workspaceId: async path => request.workspaces?.[path],
    sessionLogs: () => request.sessionLogs,
    createSummarizer: () => request.summarizer ?? fakeSummarizer(),
    summarizerRoute: () => ({ kind: 'ready', conversationId: 'fake', source: 'account', route: { provider: 'fake', model: 'fake', effort: undefined } }),
  }
  const runtime = createOptmemRuntime({
    services,
    databasePath: request.databasePath,
    settings: () => settings,
    logger: { warn: (message: string) => warnings.push(message), info: () => {} },
  })
  return {
    runtime,
    warnings,
    update: (patch: Partial<OptmemSettings>) => {
      settings = { ...settings, ...patch }
      return runtime.applySettings(settings)
    },
  }
}
