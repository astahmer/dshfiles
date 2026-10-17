import { basename } from 'node:path'

import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { digestSession, type SessionDigest } from '@dshfiles/dshx/platform/session-digest'
import { Redaction, Utf8 } from '@dshfiles/optmem-core'

import type { IndexedMessage, ThreadDigest } from './store.ts'

export type ThreadHeader = {
  readonly id: string
  readonly cwd?: string | undefined
  readonly parentSession?: string | undefined
  readonly origin?: string | undefined
}

/** `flagged`: a classifier (Jev) found a durable signal the phrasing heuristics did not name. */
export type Signal = { readonly seq: number; readonly kind: 'correction' | 'decision' | 'preference' | 'flagged'; readonly text: string }

export type ThreadMaterial = {
  /** Undefined for a blank or trivial thread, which gets no digest. */
  readonly digest: ThreadDigest | undefined
  /** True when the thread has no trail of its own (final message, todos, goal, revisions, signals) and only a model can digest it. */
  readonly needsModel: boolean
  /** Chronological user and assistant text, bounded, for the model fallback. */
  readonly transcript: string
  readonly messages: readonly IndexedMessage[]
  readonly signals: readonly Signal[]
  readonly lastSeq: number
}

const digestBytes = 1_800
const userPromptBytes = 220
const signalBytes = 260
const outcomeBytes = 600
const transcriptBytes = 12_000
const indexedMessageBytes = 16_000

const tokenizedUrl = /([?&#](?:token|access_token|key|api_key|auth|sig|signature)=)[^\s&#"')]+/gi

/** A cheap pass: known credential shapes, bearer tokens, `key=value` secrets and tokenized URLs. */
export const redact = (text: string): string => Redaction.redact(text, []).text.replace(tokenizedUrl, '$1[REDACTED]')

const oneLine = (text: string, bytes: number): string => Utf8.clip(text.replace(/\s+/g, ' ').trim(), bytes)

/** Phrasings of a user correcting the agent, deciding, or stating a lasting preference (English and French). */
const signalPatterns: readonly { readonly kind: Exclude<Signal['kind'], 'flagged'>; readonly pattern: RegExp }[] = [
  {
    kind: 'correction',
    pattern:
      /^(?:no|nope|wrong|not quite|actually|stop|wait|non|pas ça|en fait)\b|\b(?:that'?s (?:wrong|incorrect|not (?:it|right|what))|not what i (?:asked|meant|want)|you (?:misread|misunderstood|broke)|i said|i told you|don'?t do that|c'est faux|ce n'est pas)\b/i,
  },
  {
    kind: 'decision',
    pattern:
      /\b(?:let'?s (?:go with|use|keep|drop|do)|we(?:'ll| will) (?:go with|use|keep)|decided|decision|go with|ship it|on part sur|on garde|on choisit)\b/i,
  },
  {
    kind: 'preference',
    pattern:
      /\b(?:always|never|i prefer|prefer|from now on|i (?:don'?t )?want you to|make sure (?:to|you)|please (?:always|never)|toujours|jamais|je préfère|désormais)\b/i,
  },
]

const flagSignal = (text: string): Exclude<Signal['kind'], 'flagged'> | undefined => {
  // Long pastes (logs, documents) are material, not something the user said to the agent.
  if (Utf8.byteLength(text) > 1_500) return undefined
  return signalPatterns.find(({ pattern }) => pattern.test(text))?.kind
}

const textOf = (content: readonly ContentBlock[]): string =>
  content
    .flatMap(block => (block.type === 'text' ? [block.text] : []))
    .join('\n')
    .trim()

const day = (time: number): string => new Date(time).toISOString().slice(0, 10)

const shortId = (sessionId: string): string => sessionId.replace(/^session-/, '').slice(0, 8)

const firstSentence = (text: string): string => {
  const line = text.split('\n').find(candidate => /[\p{L}\p{N}]/u.test(candidate)) ?? ''
  const sentence = /^(.+?[.!?])(?:\s|$)/u.exec(line.replace(/^[#>*\-\s]+/, ''))?.[1] ?? line
  return oneLine(sentence.replace(/[*_`]/g, ''), 160)
}

/**
 * The deterministic part of memory: one pass over a thread's DSH log yields its digest (no model call), the user and
 * assistant text to index, and the user's flagged corrections, decisions and preferences. The digest follows a
 * chronological task history: what the user asked, in their words, kept apart from what the agent produced.
 */
const readThread = (input: {
  readonly header: ThreadHeader
  readonly project: string
  readonly events: readonly SessionEvent[]
  readonly inheritedEventCount?: number
  readonly now: number
  /** Extra signals from an optional classifier (Jev), merged with the heuristics. */
  readonly extraSignals?: readonly Signal[] | undefined
}): ThreadMaterial => {
  const own = input.events.slice(input.inheritedEventCount ?? 0)
  const records = own.map(event => ({ type: 'event' as const, event }))
  const header = { sessionId: input.header.id, updatedAt: input.now, running: false, blank: false, agentAvailable: false } as const
  const summary: SessionDigest = digestSession({
    summary: input.header.cwd === undefined ? header : { ...header, cwd: input.header.cwd },
    records,
    now: input.now,
  })
  const prompts: { seq: number; text: string }[] = []
  const messages: IndexedMessage[] = []
  const signals: Signal[] = []
  const transcript: string[] = []
  let lastTime = 0
  for (const event of own) {
    lastTime = Math.max(lastTime, event.time ?? 0)
    if (event.type === 'user/message') {
      if (event.data.source.kind !== 'user') continue
      const text = redact(textOf(event.data.content))
      if (text.length === 0) continue
      prompts.push({ seq: event.seq, text })
      messages.push({ seq: event.seq, role: 'user', text: Utf8.clip(text, indexedMessageBytes), at: event.time ?? input.now })
      transcript.push(`[user #${event.seq}] ${Utf8.clip(text, 1_500)}`)
      const kind = flagSignal(text)
      if (kind !== undefined) signals.push({ seq: event.seq, kind, text: oneLine(text, signalBytes) })
    }
    if (event.type === 'assistant/message') {
      const text = redact(textOf(event.data.message.content))
      if (text.length === 0) continue
      messages.push({ seq: event.seq, role: 'assistant', text: Utf8.clip(text, indexedMessageBytes), at: event.time ?? input.now })
      transcript.push(`[assistant #${event.seq}] ${Utf8.clip(text, 1_500)}`)
    }
  }
  for (const extra of input.extraSignals ?? []) if (!signals.some(signal => signal.seq === extra.seq)) signals.push(extra)
  signals.sort((left, right) => left.seq - right.seq)
  const lastSeq = own.at(-1)?.seq ?? -1
  const outcome = summary.lastAssistantText === undefined ? '' : redact(summary.lastAssistantText.text)
  const revisions = summary.revisions.flatMap(revision => (revision.status === 'ok' && revision.message !== undefined ? [redact(revision.message)] : []))
  const userText = prompts.reduce((total, prompt) => total + prompt.text.length, 0)
  const trivial = prompts.length === 0 || (prompts.length === 1 && summary.toolCallCount === 0 && userText + outcome.length < 200)
  const empty = { needsModel: false, transcript: '', messages, signals, lastSeq }
  if (trivial) return { digest: undefined, ...empty }
  const hasTrail = Utf8.byteLength(outcome) >= 80 || revisions.length > 0 || summary.todos.length > 0 || summary.goal !== undefined || signals.length > 0
  const title = oneLine(redact(summary.title ?? prompts[0]?.text ?? 'Untitled thread'), 100)
  const openTodos = summary.todos.filter(todo => todo.status !== 'completed' && todo.status !== 'cancelled')
  const status =
    summary.lastTurnEnd?.kind === 'error'
      ? `last turn failed: ${oneLine(summary.lastTurnEnd.error ?? 'unknown error', 160)}`
      : openTodos.length > 0
        ? `unfinished, ${openTodos.length} open todo(s); treat open work as possibly stale`
        : 'completed'
  const askedLimit = 6
  const asked = prompts.length <= askedLimit ? prompts : [...prompts.slice(0, askedLimit - 2), ...prompts.slice(-2)]
  const lines = [
    `${title} — ${basename(input.project) || input.project}, ${day(lastTime || input.now)} (thread ${shortId(input.header.id)})`,
    `Status: ${status}`,
    'User asked (chronological):',
    ...asked.map((prompt, index) => `${index + 1}. ${oneLine(prompt.text, userPromptBytes)}`),
    ...(prompts.length > asked.length ? [`(${prompts.length - asked.length} more requests; memory_read with a range shows them)`] : []),
    ...(signals.length === 0 ? [] : ['User said (verbatim):', ...signals.slice(-5).map(signal => `- [${signal.kind}] "${signal.text}" (#${signal.seq})`)]),
    ...(summary.goal === undefined
      ? []
      : [`Goal: ${oneLine(redact(summary.goal.objective), 200)}${summary.goal.phase === undefined ? '' : ` (${summary.goal.phase})`}`]),
    ...(revisions.length === 0
      ? []
      : [
          `Revisions: ${revisions
            .slice(-5)
            .map(message => oneLine(message, 160))
            .join(' | ')}`,
        ]),
    ...(summary.todos.length === 0
      ? []
      : [
          `Todos: ${summary.todos.map(todo => `[${todo.status === 'completed' ? 'x' : todo.status === 'cancelled' ? '-' : ' '}] ${oneLine(redact(todo.content), 80)}`).join('; ')}`,
        ]),
    ...(summary.filesChanged.length === 0
      ? []
      : [
          `Files changed: ${summary.filesChanged
            .slice(0, 8)
            .map(file => file.path)
            .join(', ')}`,
        ]),
    ...(outcome.length === 0 ? [] : [`Agent's last answer: ${Utf8.clip(outcome.replace(/\n{2,}/g, '\n'), outcomeBytes)}`]),
  ]
  const decision = revisions.at(-1) !== undefined ? oneLine(revisions.at(-1)?.split('\n')[0] ?? '', 160) : outcome.length > 0 ? firstSentence(outcome) : title
  return {
    digest: {
      id: input.header.id,
      project: input.project,
      parent: input.header.origin === 'subagent' ? (input.header.parentSession ?? 'unknown') : null,
      title,
      decision,
      digest: Utf8.clip(lines.join('\n'), digestBytes),
      source: 'trail',
      lastSeq,
      updatedAt: lastTime || input.now,
    },
    needsModel: !hasTrail,
    transcript: Utf8.boundHeadTail(transcript.join('\n'), transcriptBytes).text,
    messages,
    signals,
    lastSeq,
  }
}

export class ThreadDigestRules {
  static readonly redact = redact
  static readonly flagSignal = flagSignal
  static readonly shortId = shortId
  static readonly readThread = readThread
}
