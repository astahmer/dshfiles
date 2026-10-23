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
    'Is `content` work someone should do (a task, a change to make) or a problem someone should fix (a bug report, something broken or wrong), rather than a note, a tip or a reference to keep?',
  criteria: { true: 'Work to do or a problem to fix, including a bug report', false: 'A note, tip, fact, link or thought to keep' },
}

const sameWork = (existing: string): TriageQuestion => ({
  instructions: `Does \`content\` describe the same piece of work as this existing backlog item: "${existing.slice(0, 300)}"?`,
  criteria: { true: 'The same work, a restatement or a subset of it', false: 'Different work, even if related' },
})

const resolvesItem: TriageQuestion = {
  instructions:
    'Does `content` (a backlog item followed by the last reply of the thread working on it) show that the reply finished the work the item describes, so the item can be marked done?',
  criteria: {
    true: 'The reply says the work is finished, landed, fixed or otherwise resolved',
    false: 'The reply only answers a question, reports progress, asks something back or leaves work to do',
  },
}

const RESOLUTION_THRESHOLD = 0.5

const modelAnswerSchema = z.object({
  kind: BacklogItems.kindSchema.optional().catch(undefined),
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
{"kind": "task"|"bug"|"idea"|"note"|"question", "title": string, "tags": string[], "duplicateOf": number|null, "confidence": number, "reason": string}
- kind: task = work to do, bug = something broken, idea = possible future work, note = knowledge to keep, question = needs an answer.
- Do not change the item's status. Captures start in inbox; the user chooses when to move them.
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
 * One triage pass: use the model for the full shape when configured; otherwise Jev answers actionable and duplicate questions. A failing service is skipped, never fatal.
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
  if (request.services.jev !== undefined && request.services.complete === undefined) {
    const ask = request.services.jev
    const probability =
      item.kind === 'task' && !item.humanFields.includes('kind') ? await ask({ question: actionable, text }).catch(() => undefined) : undefined
    const closest = candidates[0]
    const duplicate = closest === undefined ? undefined : await ask({ question: sameWork(closest.title), text }).catch(() => undefined)
    if (probability !== undefined || (closest !== undefined && duplicate !== undefined)) {
      const isWork = probability === undefined || probability >= 0.5
      fromJev = {
        confidence: probability === undefined ? (duplicate ?? 0) : Math.max(probability, 1 - probability),
        reason: probability === undefined ? 'May duplicate an existing item.' : isWork ? 'Reads as work to do.' : 'Reads as something to keep, not work to do.',
        source: 'jev',
        at: request.now,
      }
      if (probability !== undefined && !isWork && item.kind === 'task') fromJev.kind = 'note'
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

/**
 * One Jev question about a finished thread, asked when `threadResolution` is on: a reply that reads as resolution leaves
 * a `done` suggestion on the item, which the user accepts or dismisses. Jev missing or failing proposes nothing.
 */
const resolveThread = async (request: {
  readonly item: Pick<BacklogItem, 'title' | 'body'>
  readonly reply: string
  readonly jev: (request: { readonly question: TriageQuestion; readonly text: string }) => Promise<number>
  readonly now: number
}): Promise<BacklogProposal | null> => {
  const text = `Backlog item: ${request.item.title}\n${request.item.body.slice(0, 2_000)}\n\nThread reply:\n${request.reply.slice(0, 4_000)}`
  const probability = await request.jev({ question: resolvesItem, text }).catch(() => undefined)
  if (probability === undefined || probability < RESOLUTION_THRESHOLD) return null
  return {
    status: 'done',
    confidence: probability,
    reason: "The thread's last reply says the work is done.",
    source: 'jev',
    origin: 'thread',
    at: request.now,
  }
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
  static readonly resolveThread = resolveThread
  static readonly describe = describe
  static readonly candidatesFor = candidatesFor
  static readonly correctionsFrom = correctionsFrom
  static readonly parseModelAnswer = parseModelAnswer
}
