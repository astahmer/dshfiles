import type { JevQuestion } from '@dshfiles/jev'
import { Effect, Option, Schema } from 'effect'

import { BacklogItems, type BacklogItem, type BacklogKind, type BacklogProposal, type BacklogStatus } from './item.js'
import { BacklogReference } from './backlog-reference.js'

const MAX_CANDIDATES = 5
const MAX_CORRECTIONS = 5
const DUPLICATE_THRESHOLD = 0.7

export type TriageQuestion = JevQuestion

/** One Jev yes/no question; it answers with a probability. */
export type JevAsk = (request: { readonly question: TriageQuestion; readonly text: string }) => Effect.Effect<number, unknown>

/** Jev answers one yes/no question with a probability; the model returns raw text. Either may be absent. */
export interface TriageServices {
  readonly jev?: JevAsk | undefined
  readonly complete?: ((request: { readonly system: string; readonly input: string }) => Effect.Effect<string, unknown>) | undefined
}

export interface TriageCorrection {
  readonly title: string
  readonly suggested: string
  readonly chosen: string
}

const actionable: TriageQuestion = {
  name: 'triage-actionable',
  instructions:
    'Is `content` work someone should do (a task, a change to make) or a problem someone should fix (a bug report, something broken or wrong), rather than a note, a tip or a reference to keep?',
  criteria: { true: 'Work to do or a problem to fix, including a bug report', false: 'A note, tip, fact, link or thought to keep' },
}

const sameWork = (existing: string): TriageQuestion => ({
  name: 'triage-duplicate',
  instructions: `Does \`content\` describe the same piece of work as this existing backlog item: "${existing.slice(0, 300)}"?`,
  criteria: { true: 'The same work, a restatement or a subset of it', false: 'Different work, even if related' },
})

const resolvesItem: TriageQuestion = {
  name: 'thread-resolution',
  instructions:
    'Does `content` (a backlog item followed by the last reply of the thread working on it) show that the reply finished the work the item describes, so the item can be marked done?',
  criteria: {
    true: 'The reply says the work is finished, landed, fixed or otherwise resolved',
    false: 'The reply only answers a question, reports progress, asks something back or leaves work to do',
  },
}

const RESOLUTION_THRESHOLD = 0.5

const modelAnswerSchema = Schema.Struct({
  kind: Schema.optionalKey(BacklogItems.kindSchema),
  title: Schema.optionalKey(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(BacklogItems.maxTitleChars))),
  tags: Schema.optionalKey(Schema.Array(Schema.String.check(Schema.isMaxLength(60))).check(Schema.isMaxLength(20))),
  duplicateOf: Schema.optionalKey(Schema.NullOr(Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)))),
  confidence: Schema.Number.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(1)),
  reason: Schema.String.check(Schema.isMaxLength(500)),
})

/** A decoded answer with the leniency the fields carry: a field the model got wrong reads as absent, not as a failed answer. */
interface ModelAnswer {
  readonly kind?: BacklogKind | undefined
  readonly title?: string | undefined
  readonly tags?: readonly string[] | undefined
  readonly duplicateOf?: number | null | undefined
  readonly confidence: number
  readonly reason: string
}

/** The model's JSON, before any field is validated: a malformed field must not cost the fields that did decode. */
const rawAnswerSchema = Schema.Struct({
  kind: Schema.optionalKey(Schema.Unknown),
  title: Schema.optionalKey(Schema.Unknown),
  tags: Schema.optionalKey(Schema.Unknown),
  duplicateOf: Schema.optionalKey(Schema.Unknown),
  confidence: Schema.optionalKey(Schema.Unknown),
  reason: Schema.optionalKey(Schema.Unknown),
})

const tokensOf = (text: string): Set<string> =>
  new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter(token => token.length > 2),
  )

/** Open items sharing the most words with this one: what a duplicate check and the model see as context. */
const candidatesFor = (item: BacklogItem, others: readonly BacklogItem[]): BacklogItem[] => {
  const own = tokensOf(`${item.title} ${item.body}`)
  return others
    .filter(other => other.id !== item.id && other.status !== 'done' && other.status !== 'dropped')
    .map(other => ({ other, shared: [...tokensOf(other.title)].filter(token => own.has(token)).length }))
    .filter(entry => entry.shared >= 2)
    .sort((left, right) => right.shared - left.shared || right.other.lastActivityAt - left.other.lastActivityAt)
    .slice(0, MAX_CANDIDATES)
    .map(entry => entry.other)
}

/**
 * Labelled examples from the user's own fixes: an item whose triage set a field the user later changed by hand.
 * Derived from the event log on every run, so nothing extra is stored.
 */
const correctionsFrom = (items: readonly BacklogItem[]): TriageCorrection[] =>
  items
    .flatMap(item => {
      const applied = item.events.findLast(event => event.kind === 'triaged' && event.actor === 'system' && event.detail.startsWith('applied '))
      if (applied === undefined) return []
      const corrected = item.events.find(
        event => event.at > applied.at && event.actor === 'user' && (event.kind === 'moved' || (event.kind === 'edited' && /\bkind\b/.test(event.detail))),
      )
      if (corrected === undefined) return []
      return [{ title: item.title, suggested: applied.detail.slice('applied '.length), chosen: `kind ${item.kind}, status ${item.status}` }]
    })
    .slice(-MAX_CORRECTIONS)

const systemPrompt = `You triage one backlog item for a developer's personal backlog.
Answer with one JSON object and nothing else:
{"kind": "task"|"bug"|"idea"|"note"|"question", "title": string, "tags": string[], "duplicateOf": number|null, "confidence": number, "reason": string}
- kind: task = work to do, bug = something broken, idea = possible future work, note = knowledge to keep, question = needs an answer.
- Do not change the item's status. Captures start in inbox; the user chooses when to move them.
- title: a short, clear title; keep the author's wording when it is already clear.
- tags: at most 3 lowercase single-word topics; reuse tags from similar items.
- duplicateOf: the number after "id" of a similar item describing the same work, else null.
- confidence: 0..1, how sure you are of the whole answer.
- reason: one short sentence.`

const modelInput = (item: BacklogItem, candidates: readonly BacklogItem[], corrections: readonly TriageCorrection[]): string =>
  [
    `Item ${BacklogReference.labelOf(item)} (currently kind ${item.kind}, status ${item.status}, tags ${item.tags.join(', ') || 'none'}):`,
    item.title,
    item.body.slice(0, 2_000),
    candidates.length === 0
      ? ''
      : `\nSimilar items:\n${candidates.map(other => `- id ${String(other.id)} (${BacklogReference.labelOf(other)}) [${other.kind}, ${other.status}, #${other.tags.join(' #')}] ${other.title}`).join('\n')}`,
    corrections.length === 0
      ? ''
      : `\nThe user corrected earlier triage like this:\n${corrections.map(entry => `- "${entry.title}": suggested ${entry.suggested}; user chose ${entry.chosen}`).join('\n')}`,
  ]
    .filter(Boolean)
    .join('\n')

const parseModelAnswer = (text: string): ModelAnswer | undefined => {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) return undefined
  const raw = Option.getOrNull(Schema.decodeUnknownOption(Schema.fromJsonString(rawAnswerSchema))(text.slice(start, end + 1)))
  if (raw === null) return undefined
  const fields = modelAnswerSchema.fields
  return {
    kind: Option.getOrElse(Schema.decodeUnknownOption(fields.kind)(raw.kind), () => undefined),
    title: Option.getOrElse(Schema.decodeUnknownOption(fields.title)(raw.title), () => undefined),
    tags: Option.getOrElse(Schema.decodeUnknownOption(fields.tags)(raw.tags), () => undefined),
    duplicateOf: Option.getOrElse(Schema.decodeUnknownOption(fields.duplicateOf)(raw.duplicateOf), () => undefined),
    confidence: Option.getOrElse(Schema.decodeUnknownOption(fields.confidence)(raw.confidence), () => 0.5),
    reason: Option.getOrElse(Schema.decodeUnknownOption(fields.reason)(raw.reason), () => ''),
  }
}

/** The proposal as it is built up, before the readonly contract type accepts only the fields that changed. */
type ProposalDraft = {
  kind?: BacklogKind
  status?: BacklogStatus
  title?: string
  tags?: readonly string[]
  duplicateOf?: number
  confidence: number
  reason: string
  source: BacklogProposal['source']
  origin?: 'thread'
  at: number
}

/** Keeps only what differs from the item, so an empty proposal means triage agrees with what is there. */
const changesOnly = (item: BacklogItem, proposal: BacklogProposal): BacklogProposal | null => {
  const trimmed: ProposalDraft = { confidence: proposal.confidence, reason: proposal.reason, source: proposal.source, at: proposal.at }
  if (proposal.kind !== undefined && proposal.kind !== item.kind) trimmed.kind = proposal.kind
  if (proposal.status !== undefined && proposal.status !== item.status) trimmed.status = proposal.status
  if (proposal.title !== undefined && proposal.title.trim() !== item.title) trimmed.title = proposal.title.trim()
  const newTags = proposal.tags?.map(tag => tag.toLowerCase().replace(/^#/, '')).filter(tag => tag !== '' && !item.tags.includes(tag)) ?? []
  if (newTags.length > 0) trimmed.tags = [...item.tags, ...newTags]
  if (proposal.duplicateOf !== undefined && proposal.duplicateOf !== item.id) trimmed.duplicateOf = proposal.duplicateOf
  const changed = ['kind', 'status', 'title', 'tags', 'duplicateOf'].some(field => field in trimmed)
  return changed ? trimmed : null
}

/**
 * One triage pass: use the model for the full shape when configured; otherwise Jev answers actionable and duplicate questions. A failing service is skipped, never fatal.
 */
const skipFailure = <A>(effect: Effect.Effect<A, unknown>): Effect.Effect<A | undefined> =>
  Effect.catch(effect, error => Effect.as(Effect.logDebug('backlog triage: a service failed, skipping it', error), undefined))

const run = Effect.fn('backlog triage run')(function* (request: {
  readonly item: BacklogItem
  readonly others: readonly BacklogItem[]
  readonly services: TriageServices
  readonly now: number
}) {
  const item = request.item
  const candidates = candidatesFor(item, request.others)
  const text = `${item.title}\n${item.body}`.trim()
  let fromJev: BacklogProposal | undefined
  if (request.services.jev !== undefined && request.services.complete === undefined) {
    const ask = request.services.jev
    const probability = item.kind === 'task' && !item.humanFields.includes('kind') ? yield* skipFailure(ask({ question: actionable, text })) : undefined
    const closest = candidates[0]
    const duplicate = closest === undefined ? undefined : yield* skipFailure(ask({ question: sameWork(closest.title), text }))
    if (probability !== undefined || (closest !== undefined && duplicate !== undefined)) {
      const isWork = probability === undefined || probability >= 0.5
      const jev: ProposalDraft = {
        confidence: probability === undefined ? (duplicate ?? 0) : Math.max(probability, 1 - probability),
        reason: probability === undefined ? 'May duplicate an existing item.' : isWork ? 'Reads as work to do.' : 'Reads as something to keep, not work to do.',
        source: 'jev',
        at: request.now,
      }
      if (probability !== undefined && !isWork && item.kind === 'task') jev.kind = 'note'
      if (closest !== undefined && duplicate !== undefined && duplicate >= DUPLICATE_THRESHOLD) jev.duplicateOf = closest.id
      fromJev = jev
    }
  }
  let fromModel: BacklogProposal | undefined
  if (request.services.complete !== undefined) {
    const raw = yield* skipFailure(request.services.complete({ system: systemPrompt, input: modelInput(item, candidates, correctionsFrom(request.others)) }))
    const answer = raw === undefined ? undefined : parseModelAnswer(raw)
    if (answer !== undefined) {
      const model: ProposalDraft = { confidence: answer.confidence, reason: answer.reason, source: 'model', at: request.now }
      if (answer.kind !== undefined) model.kind = answer.kind
      if (answer.title !== undefined) model.title = answer.title
      if (answer.tags !== undefined) model.tags = answer.tags
      const duplicate = candidates.find(candidate => candidate.id === answer.duplicateOf)
      if (duplicate !== undefined) model.duplicateOf = duplicate.id
      fromModel = model
    }
  }
  if (fromJev === undefined && fromModel === undefined) return null
  if (fromModel === undefined) return fromJev === undefined ? null : changesOnly(item, fromJev)
  if (fromJev === undefined) return changesOnly(item, fromModel)
  // Agreement between two independent judges raises confidence; disagreement on the kind keeps the model's answer but lowers it.
  const agree = (fromModel.kind ?? item.kind) === (fromJev.kind ?? item.kind)
  const both: ProposalDraft = {
    ...fromJev,
    ...fromModel,
    confidence: agree ? Math.max(fromModel.confidence, fromJev.confidence) : Math.min(fromModel.confidence, fromJev.confidence),
    source: 'jev+model',
  }
  const duplicateOf = fromModel.duplicateOf ?? fromJev.duplicateOf
  if (duplicateOf !== undefined) both.duplicateOf = duplicateOf
  return changesOnly(item, both)
})

/**
 * One Jev question about a finished thread, asked when `threadResolution` is on: a reply that reads as resolution leaves
 * a `done` suggestion on the item, which the user accepts or dismisses. Jev missing or failing proposes nothing.
 */
const resolveThread = Effect.fn('backlog triage resolve thread')(function* (request: {
  readonly item: Pick<BacklogItem, 'title' | 'body'>
  readonly reply: string
  readonly jev: JevAsk
  readonly now: number
}) {
  const text = `Backlog item: ${request.item.title}\n${request.item.body.slice(0, 2_000)}\n\nThread reply:\n${request.reply.slice(0, 4_000)}`
  const probability = yield* skipFailure(request.jev({ question: resolvesItem, text }))
  if (probability === undefined || probability < RESOLUTION_THRESHOLD) return null
  const proposal: BacklogProposal = {
    status: 'done',
    confidence: probability,
    reason: "The thread's last reply says the work is done.",
    source: 'jev',
    origin: 'thread',
    at: request.now,
  }
  return proposal
})

/**
 * "kind bug, status todo, tags a b, duplicate of b:3" — the wording events and the peek share. `refOf` names the
 * duplicate by its ref when the caller can look it up; otherwise its id stands in.
 */
const describe = (
  proposal: Pick<BacklogProposal, 'kind' | 'status' | 'title' | 'tags' | 'duplicateOf'>,
  refOf: (id: number) => string | undefined = () => undefined,
): string =>
  [
    proposal.kind === undefined ? '' : `kind ${proposal.kind}`,
    proposal.status === undefined ? '' : `status ${proposal.status}`,
    proposal.title === undefined ? '' : `title "${proposal.title}"`,
    proposal.tags === undefined ? '' : `tags ${proposal.tags.join(' ')}`,
    proposal.duplicateOf === undefined ? '' : `duplicate of b:${refOf(proposal.duplicateOf) ?? String(proposal.duplicateOf)}`,
  ]
    .filter(Boolean)
    .join(', ')

export class BacklogTriage {
  static readonly run = run
  static readonly resolveThread = resolveThread
  static readonly describe = describe
  static readonly candidatesFor = candidatesFor
  static readonly correctionsFrom = correctionsFrom
  static readonly parseModelAnswer = parseModelAnswer
}
