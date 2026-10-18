import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod'
import { SessionLogs } from './self-improve-log.ts'

/**
 * The durable self-improvement ledger: one JSONL record per opportunity, so a
 * later run recognises what was already tried instead of rediscovering it.
 *
 * A rejected or regressed entry is closed: reopening it needs an explicit
 * reason, which is recorded. An opportunity with no evidence is not storable —
 * an invented attribution would poison every later run.
 */

const LEDGER_STATUSES = ['proposed', 'investigating', 'implemented', 'validated', 'rejected', 'regressed', 'deferred'] as const

/**
 * Evidence is either a Session event (`sessionId` + `seq`) or a repository
 * artifact (`ref`) such as a file a deterministic check flagged. One of the two
 * is required: an entry with no provenance is not storable.
 */
const evidenceSchema = z
  .object({
    sessionId: z.string().optional(),
    seq: z.number().optional(),
    time: z.number(),
    excerpt: z.string(),
    ref: z.string().optional(),
    note: z.string().optional(),
  })
  .refine(evidence => evidence.sessionId !== undefined || evidence.ref !== undefined, { message: 'evidence needs a sessionId or a ref' })

const experimentSchema = z.object({
  hypothesis: z.string(),
  baseline: z.string(),
  metric: z.string(),
  before: z.string(),
  after: z.string().optional(),
  conditions: z.string(),
  verdict: z.enum(['helped', 'hurt', 'no-observed-effect', 'confounded', 'pending']),
  artifact: z.string().optional(),
})

const candidateSchema = z.object({
  summary: z.string(),
  status: z.enum(['proposed', 'implemented', 'rejected']),
  revision: z.string().optional(),
})

const historySchema = z.object({ at: z.number(), status: z.string(), note: z.string() })

const ledgerEntrySchema = z.object({
  id: z.string(),
  key: z.string(),
  title: z.string(),
  category: z.string(),
  status: z.enum(LEDGER_STATUSES),
  confidence: z.enum(['high', 'medium', 'low']),
  signalIds: z.array(z.string()),
  evidence: z.array(evidenceSchema).min(1),
  rootCause: z.string().optional(),
  hypothesis: z.string().optional(),
  candidates: z.array(candidateSchema),
  experiments: z.array(experimentSchema),
  revisions: z.array(z.string()),
  regressions: z.array(z.string()),
  attempts: z.number().int().nonnegative(),
  reopenWhen: z.string().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
  history: z.array(historySchema),
})

export type LedgerEntry = z.infer<typeof ledgerEntrySchema>

const OPEN_STATUSES: ReadonlySet<string> = new Set(['proposed', 'investigating', 'deferred'])

const readLedger = async (path: string): Promise<LedgerEntry[]> => {
  const text = await readFile(path, 'utf8').catch(() => '')
  const entries: LedgerEntry[] = []
  for (const line of text.split('\n')) {
    if (line.trim().length === 0) continue
    const parsed = SessionLogs.decodeJsonSafe(ledgerEntrySchema, line)
    if (parsed !== undefined) entries.push(parsed)
  }
  return entries
}

const writeLedger = async (path: string, entries: readonly LedgerEntry[]): Promise<void> => {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, entries.map(entry => JSON.stringify(entry)).join('\n') + (entries.length === 0 ? '' : '\n'))
}

/** Stable, human-readable id: the run date plus a short hash of the dedup key. */
const entryId = ({ key, now, taken }: { readonly key: string; readonly now: number; readonly taken: ReadonlySet<string> }): string => {
  const day = new Date(now).toISOString().slice(0, 10)
  const base = `si-${day}-${key
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
    .toLowerCase()}`
  let id = base
  let suffix = 2
  while (taken.has(id)) {
    id = `${base}-${String(suffix)}`
    suffix += 1
  }
  return id
}

export interface AddInput {
  key: string
  title: string
  category: string
  confidence: LedgerEntry['confidence']
  signalIds: readonly string[]
  evidence: LedgerEntry['evidence']
  rootCause?: string
  hypothesis?: string
  reopenWhen?: string
  now: number
  reopenReason?: string
}

export type AddOutcome =
  | { readonly kind: 'added'; readonly entry: LedgerEntry }
  | { readonly kind: 'duplicate'; readonly entry: LedgerEntry }
  | { readonly kind: 'reopened'; readonly entry: LedgerEntry }
  | { readonly kind: 'refused'; readonly reason: string }

/**
 * Adds an opportunity, or refuses when the same key is already known. A closed
 * entry (rejected/regressed/validated) reopens only with an explicit reason and
 * keeps its earlier evidence and experiment history.
 */
const addEntry = ({ entries, input }: { readonly entries: readonly LedgerEntry[]; readonly input: AddInput }): AddOutcome => {
  const existing = entries.find(entry => entry.key === input.key)
  if (existing !== undefined) {
    if (OPEN_STATUSES.has(existing.status)) return { kind: 'duplicate', entry: existing }
    if (input.reopenReason === undefined || input.reopenReason.trim().length === 0) {
      return { kind: 'refused', reason: `${existing.id} is ${existing.status}; pass --reopen "<new evidence>" to reopen it` }
    }
    return {
      kind: 'reopened',
      entry: {
        ...existing,
        status: 'proposed',
        attempts: existing.attempts + 1,
        evidence: [
          ...existing.evidence.filter(
            item => item.sessionId !== '' && !input.evidence.some(next => next.sessionId === item.sessionId && next.seq === item.seq),
          ),
          ...input.evidence,
        ].slice(-40),
        signalIds: [...new Set([...existing.signalIds, ...input.signalIds])],
        updatedAt: input.now,
        history: [...existing.history, { at: input.now, status: 'proposed', note: `reopened: ${input.reopenReason}` }],
      },
    }
  }
  const entry: LedgerEntry = {
    id: entryId({ key: input.key, now: input.now, taken: new Set(entries.map(item => item.id)) }),
    key: input.key,
    title: input.title,
    category: input.category,
    status: 'proposed',
    confidence: input.confidence,
    signalIds: [...input.signalIds],
    evidence: [...input.evidence],
    candidates: [],
    experiments: [],
    revisions: [],
    regressions: [],
    attempts: 0,
    createdAt: input.now,
    updatedAt: input.now,
    history: [
      {
        at: input.now,
        status: 'proposed',
        note: input.signalIds.length === 0 ? 'recorded from non-Session evidence' : `mined from ${String(input.signalIds.length)} signal(s)`,
      },
    ],
  }
  if (input.rootCause !== undefined) entry.rootCause = input.rootCause
  if (input.hypothesis !== undefined) entry.hypothesis = input.hypothesis
  if (input.reopenWhen !== undefined) entry.reopenWhen = input.reopenWhen
  return { kind: 'added', entry }
}

export interface UpdateInput {
  id: string
  status?: LedgerEntry['status']
  note: string
  rootCause?: string
  hypothesis?: string
  reopenWhen?: string
  revision?: string
  regression?: string
  candidate?: LedgerEntry['candidates'][number]
  experiment?: LedgerEntry['experiments'][number]
  now: number
}

export type UpdateOutcome = { readonly kind: 'updated'; readonly entry: LedgerEntry } | { readonly kind: 'missing' }

const updateEntry = ({ entries, input }: { readonly entries: LedgerEntry[]; readonly input: UpdateInput }): UpdateOutcome => {
  const index = entries.findIndex(entry => entry.id === input.id)
  const existing = entries[index]
  if (existing === undefined) return { kind: 'missing' }
  const status = input.status ?? existing.status
  const updated: LedgerEntry = {
    ...existing,
    status,
    updatedAt: input.now,
    rootCause: input.rootCause ?? existing.rootCause,
    hypothesis: input.hypothesis ?? existing.hypothesis,
    reopenWhen: input.reopenWhen ?? existing.reopenWhen,
    revisions: input.revision === undefined ? existing.revisions : [...new Set([...existing.revisions, input.revision])],
    regressions: input.regression === undefined ? existing.regressions : [...existing.regressions, input.regression],
    candidates: input.candidate === undefined ? existing.candidates : [...existing.candidates, input.candidate],
    experiments: input.experiment === undefined ? existing.experiments : [...existing.experiments, input.experiment],
    history: [...existing.history, { at: input.now, status, note: input.note }],
  }
  entries[index] = updated
  return { kind: 'updated', entry: updated }
}

const renderLedger = (entries: readonly LedgerEntry[]): string => {
  if (entries.length === 0) return 'No ledger entries yet.\n'
  const lines = [`| id | status | category | conf | attempts | title |`, `| --- | --- | --- | --- | --- | --- |`]
  for (const entry of entries) {
    lines.push(`| ${entry.id} | ${entry.status} | ${entry.category} | ${entry.confidence} | ${String(entry.attempts)} | ${entry.title.replace(/\|/g, '\\|')} |`)
  }
  return `${lines.join('\n')}\n`
}

/**
 * The durable self-improvement ledger: one JSONL record per opportunity, so a
 * later run recognises what was already tried instead of rediscovering it.
 */
export class ImprovementLedger {
  static readonly STATUSES = LEDGER_STATUSES
  static readonly read = readLedger
  static readonly write = writeLedger
  static readonly add = addEntry
  static readonly update = updateEntry
  static readonly render = renderLedger
  static readonly entryId = entryId
  static readonly parseExperiment = (text: string): LedgerEntry['experiments'][number] => SessionLogs.decodeJson(experimentSchema, text)
}
