import { z } from 'zod'

import { BacklogItems, type BacklogItem, type BacklogProposal } from './item.js'

const MAX_CANDIDATES = 5
const MAX_CORRECTIONS = 5
const DUPLICATE_THRESHOLD = 0.7

export interface TriageQuestion {
  readonly instructions: string
  readonly criteria: { readonly true: string; readonly false: string }
}

/** Jev answers one yes/no question with a probability; the model returns raw text. Either may be absent. */
export interface TriageServices {
  readonly jev?: ((request: { readonly question: TriageQuestion; readonly text: string }) => Promise<number>) | undefined
  readonly complete?: ((request: { readonly system: string; readonly input: string }) => Promise<string>) | undefined
}

export interface TriageCorrection {
  readonly title: string
  readonly suggested: string
  readonly chosen: string
}

const actionable: TriageQuestion = {
  instructions:
    'Is `content` an actionable piece of work someone should do (a task, a fix, a change to make), rather than a note, an observation or a reference to keep?',
  criteria: { true: 'Describes work to do', false: 'A note, fact, observation, link or thought to keep' },
}

const sameWork = (existing: string): TriageQuestion => ({
  instructions: `Does \`content\` describe the same piece of work as this existing backlog item: "${existing.slice(0, 300)}"?`,
  criteria: { true: 'The same work, a restatement or a subset of it', false: 'Different work, even if related' },
})

const modelAnswerSchema = z.object({
  kind: BacklogItems.kindSchema.optional().catch(undefined),
  status: BacklogItems.statusSchema.optional().catch(undefined),
  title: z.string().min(1).max(BacklogItems.maxTitleChars).optional().catch(undefined),
  tags: z.array(z.string().max(60)).max(20).optional().catch(undefined),
  duplicateOf: z.number().int().positive().nullable().optional().catch(undefined),
  confidence: z.number().min(0).max(1).catch(0.5),
  reason: z.string().max(500).catch(''),
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
{"kind": "task"|"bug"|"idea"|"note"|"question", "status": "todo"|"doing"|"done"|"dropped", "title": string, "tags": string[], "duplicateOf": number|null, "confidence": number, "reason": string}
- kind: task = work to do, bug = something broken, idea = possible future work, note = knowledge to keep, question = needs an answer.
- status: usually "todo"; "done" only when the text says it already happened.
- title: a short, clear title; keep the author's wording when it is already clear.
- tags: at most 3 lowercase single-word topics; reuse tags from similar items.
- duplicateOf: the id of a similar item describing the same work, else null.
- confidence: 0..1, how sure you are of the whole answer.
- reason: one short sentence.`

const modelInput = (item: BacklogItem, candidates: readonly BacklogItem[], corrections: readonly TriageCorrection[]): string =>
  [
    `Item b:${String(item.id)} (currently kind ${item.kind}, status ${item.status}, tags ${item.tags.join(', ') || 'none'}):`,
    item.title,
    item.body.slice(0, 2_000),
    candidates.length === 0
      ? ''
      : `\nSimilar items:\n${candidates.map(other => `- b:${String(other.id)} [${other.kind}, ${other.status}, #${other.tags.join(' #')}] ${other.title}`).join('\n')}`,
    corrections.length === 0
      ? ''
      : `\nThe user corrected earlier triage like this:\n${corrections.map(entry => `- "${entry.title}": suggested ${entry.suggested}; user chose ${entry.chosen}`).join('\n')}`,
  ]
    .filter(Boolean)
    .join('\n')

const parseModelAnswer = (text: string): z.infer<typeof modelAnswerSchema> | undefined => {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) return undefined
  try {
    const parsed = modelAnswerSchema.safeParse(JSON.parse(text.slice(start, end + 1)))
    return parsed.success ? parsed.data : undefined
  } catch {
    return undefined
  }
}

/** Keeps only what differs from the item, so an empty proposal means triage agrees with what is there. */
const changesOnly = (item: BacklogItem, proposal: BacklogProposal): BacklogProposal | null => {
  const trimmed: BacklogProposal = { confidence: proposal.confidence, reason: proposal.reason, source: proposal.source, at: proposal.at }
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
 * One triage pass: Jev settles the cheap yes/no questions (actionable? same work as the closest item?), the model
 * proposes the full shape when one is configured. A failing service is skipped, never fatal.
 */
const run = async (request: {
  readonly item: BacklogItem
  readonly others: readonly BacklogItem[]
  readonly services: TriageServices
  readonly now: number
}): Promise<BacklogProposal | null> => {
  const item = request.item
  const candidates = candidatesFor(item, request.others)
  const text = `${item.title}\n${item.body}`.trim()
  let fromJev: BacklogProposal | undefined
  if (request.services.jev !== undefined) {
    const ask = request.services.jev
    const probability = await ask({ question: actionable, text }).catch(() => undefined)
    const closest = candidates[0]
    const duplicate = closest === undefined ? undefined : await ask({ question: sameWork(closest.title), text }).catch(() => undefined)
    if (probability !== undefined) {
      const isWork = probability >= 0.5
      fromJev = {
        status: 'todo',
        confidence: Math.max(probability, 1 - probability),
        reason: isWork ? 'Reads as work to do.' : 'Reads as something to keep, not work to do.',
        source: 'jev',
        at: request.now,
      }
      if (!isWork && item.kind === 'task') fromJev.kind = 'note'
      if (closest !== undefined && duplicate !== undefined && duplicate >= DUPLICATE_THRESHOLD) fromJev.duplicateOf = closest.id
    }
  }
  let fromModel: BacklogProposal | undefined
  if (request.services.complete !== undefined) {
    const answer = await request.services
      .complete({ system: systemPrompt, input: modelInput(item, candidates, correctionsFrom(request.others)) })
      .then(parseModelAnswer)
      .catch(() => undefined)
    if (answer !== undefined) {
      const model: BacklogProposal = { confidence: answer.confidence, reason: answer.reason, source: 'model', at: request.now }
      if (answer.kind !== undefined) model.kind = answer.kind
      if (answer.status !== undefined) model.status = answer.status
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
  return changesOnly(item, {
    ...fromJev,
    ...fromModel,
    duplicateOf: fromModel.duplicateOf ?? fromJev.duplicateOf,
    confidence: agree ? Math.max(fromModel.confidence, fromJev.confidence) : Math.min(fromModel.confidence, fromJev.confidence),
    source: 'jev+model',
  })
}

/** "kind bug, status todo, tags a b, duplicate of b:3" — the wording events and the peek share. */
const describe = (proposal: Pick<BacklogProposal, 'kind' | 'status' | 'title' | 'tags' | 'duplicateOf'>): string =>
  [
    proposal.kind === undefined ? '' : `kind ${proposal.kind}`,
    proposal.status === undefined ? '' : `status ${proposal.status}`,
    proposal.title === undefined ? '' : `title "${proposal.title}"`,
    proposal.tags === undefined ? '' : `tags ${proposal.tags.join(' ')}`,
    proposal.duplicateOf === undefined ? '' : `duplicate of b:${String(proposal.duplicateOf)}`,
  ]
    .filter(Boolean)
    .join(', ')

export class BacklogTriage {
  static readonly run = run
  static readonly describe = describe
  static readonly candidatesFor = candidatesFor
  static readonly correctionsFrom = correctionsFrom
  static readonly parseModelAnswer = parseModelAnswer
}
