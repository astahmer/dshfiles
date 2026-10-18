#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { z } from 'zod'
import { HarnessAudit } from './self-improve-harness.ts'
import { ImprovementLedger, type AddInput, type LedgerEntry, type UpdateInput } from './self-improve-ledger.ts'
import { SessionLogs, type SessionLogRef } from './self-improve-log.ts'
import { SessionMiner, type MineReport, type SessionFacts } from './self-improve-mine.ts'

/**
 * `/self-improve`'s deterministic half: mine real Session logs into ranked
 * evidence, validate the parts of the harness this repository owns, and keep
 * the improvement ledger.
 *
 * The skill body drives the judgement; this CLI only produces facts and never
 * edits the repository.
 */

const REPO_ROOT = resolve(import.meta.dirname, '..')
const USAGE = `Usage: node scripts/self-improve.ts <command> [--key=value]

  mine      Scan Session logs into ranked candidate signals
            --scope=all|tools|memory|skills|ux|infra|agent  (default all)
            --since=14d|30d|7d|all|<ISO date>                (default 14d)
            --sessions=<n>     newest n Sessions only
            --projects=<a,b>   Session project directory substrings
            --dsh-home=<path>  default $DSH_HOME or ~/.dsh
            --cache=<path>     default output/self-improve/cache.json
            --no-cache         ignore and do not write the cache
            --out=<dir>        default output/self-improve
            --top=<n>          signals in stdout (default 25)
            --json             machine-readable report instead of markdown
            --quiet            write files, print nothing

  validate  Deterministic checks on skills and always-on instructions
            --json

  ledger    list|add|update|show|path
            --ledger=<path>    default plans/self-improve/ledger.jsonl
            list   [--status=<s>] [--json]
            add    --from=<report.json> --signal=<signal id> [--title=] [--category=] [--confidence=] [--hypothesis=] [--root-cause=] [--reopen=<new evidence>]
            add    --key=<key> --evidence-file=<json> [--title=] [--category=] [--confidence=]   (a finding with no Session evidence)
            update --id=<id> --note=<text> [--status=] [--root-cause=] [--hypothesis=] [--reopen-when=] [--revision=] [--regression=] [--experiment-file=<json>]
            show   --id=<id>
            path
`

interface Options {
  readonly command: string
  readonly action: string
  readonly flags: ReadonlyMap<string, string>
}

const parseOptions = (argv: readonly string[]): Options => {
  const positional: string[] = []
  const flags = new Map<string, string>()
  for (const argument of argv) {
    if (!argument.startsWith('--')) {
      positional.push(argument)
      continue
    }
    const separator = argument.indexOf('=')
    if (separator < 0) flags.set(argument.slice(2), 'true')
    else flags.set(argument.slice(2, separator), argument.slice(separator + 1))
  }
  return { command: positional[0] ?? 'help', action: positional[1] ?? 'list', flags }
}

const dshHome = (flags: ReadonlyMap<string, string>): string => flags.get('dsh-home') ?? process.env['DSH_HOME'] ?? join(homedir(), '.dsh')

const mapPool = async <Item, Result>(items: readonly Item[], width: number, worker: (item: Item) => Promise<Result>): Promise<Result[]> => {
  const results: Result[] = new Array<Result>(items.length)
  let next = 0
  const run = async (): Promise<void> => {
    for (;;) {
      const index = next++
      const item = items[index]
      if (item === undefined) return
      results[index] = await worker(item)
    }
  }
  await Promise.all(Array.from({ length: Math.min(width, items.length) }, run))
  return results
}

const cacheSchema = z.object({
  version: z.number(),
  entries: z.record(z.string(), z.object({ size: z.number(), mtimeMs: z.number(), facts: SessionMiner.factsSchema })),
})
type Cache = z.infer<typeof cacheSchema>

const emptyCache = (): Cache => ({ version: SessionMiner.EXTRACTOR_VERSION, entries: {} })

const loadCache = async (path: string | undefined): Promise<Cache> => {
  if (path === undefined) return emptyCache()
  const text = await readFile(path, 'utf8').catch(() => undefined)
  if (text === undefined) return emptyCache()
  const parsed = SessionLogs.decodeJsonSafe(cacheSchema, text)
  if (parsed === undefined || parsed.version !== SessionMiner.EXTRACTOR_VERSION) return emptyCache()
  return parsed
}

const CATEGORY_BY_SCOPE = new Map<string, string>([
  ['all', ''],
  ['tools', 'tools'],
  ['memory', 'memory'],
  ['skills', 'skills'],
  ['ux', 'ux'],
  ['infra', 'infra'],
  ['agent', 'agent'],
])

const mine = async (flags: ReadonlyMap<string, string>): Promise<number> => {
  const now = Date.now()
  const scope = flags.get('scope') ?? 'all'
  const since = flags.get('since') ?? '14d'
  const outDirectory = flags.get('out') ?? join(REPO_ROOT, 'output/self-improve')
  const cachePath = flags.get('no-cache') === 'true' ? undefined : (flags.get('cache') ?? join(outDirectory, 'cache.json'))
  const sinceMs = SessionLogs.parseSince(since, now)
  const projects = (flags.get('projects') ?? '').split(',').filter(value => value.length > 0)
  const sessionLimit = flags.get('sessions') === undefined ? Number.POSITIVE_INFINITY : Number(flags.get('sessions'))

  const discovered = await SessionLogs.discover(join(dshHome(flags), 'sessions'))
  const inWindow = discovered
    .filter(ref => sinceMs === undefined || ref.mtimeMs >= sinceMs)
    .filter(ref => projects.length === 0 || projects.some(project => ref.project.includes(project)))
    .sort((left, right) => right.mtimeMs - left.mtimeMs)
  const selected = inWindow.slice(0, sessionLimit === 0 ? inWindow.length : sessionLimit)
  const skippedBySince = discovered.length - inWindow.length

  const cache = await loadCache(cachePath)
  let reused = 0
  let failed = 0
  const extracted = await mapPool(selected, 8, async (ref: SessionLogRef): Promise<SessionFacts | undefined> => {
    const cached = cache.entries[ref.path]
    if (cached !== undefined && cached.size === ref.size && cached.mtimeMs === ref.mtimeMs) {
      reused += 1
      return cached.facts
    }
    const facts = await SessionMiner.extract(ref).catch(error => {
      failed += 1
      process.stderr.write(`self-improve: could not read ${ref.path}: ${String(error)}\n`)
      return undefined
    })
    if (facts !== undefined) cache.entries[ref.path] = { size: ref.size, mtimeMs: ref.mtimeMs, facts }
    return facts
  })
  const facts = extracted.filter((entry): entry is SessionFacts => entry !== undefined)

  const wanted = CATEGORY_BY_SCOPE.get(scope) ?? ''
  const signals = SessionMiner.aggregate(facts, now).filter(signal => wanted === '' || signal.category === wanted)
  const notes: string[] = [
    `Extractor version ${String(SessionMiner.EXTRACTOR_VERSION)}; a signal is a candidate, not a diagnosis.`,
    'Correction themes are lexical matches on human messages; open every one before treating it as pushback.',
    'Occurrence counts for tool errors are capped at 40 distinct signatures per Session, so a very noisy Session is understated rather than overstated.',
    `Unreadable logs: ${String(failed)}.`,
  ]
  if (cachePath !== undefined) notes.push(`Cache: ${cachePath} (${String(reused)} of ${String(selected.length)} Sessions reused).`)

  const report: MineReport = {
    generatedAt: now,
    extractorVersion: SessionMiner.EXTRACTOR_VERSION,
    scope,
    since,
    until: now,
    coverage: {
      discovered: discovered.length,
      analyzed: facts.length,
      reusedFromCache: reused,
      skippedBySince,
      failed,
      projects: new Set(facts.map(entry => entry.project)).size,
      totalToolCalls: facts.reduce((total, entry) => total + entry.toolCallCount, 0),
      totalToolErrors: facts.reduce((total, entry) => total + entry.toolErrorCount, 0),
      totalTurns: facts.reduce((total, entry) => total + entry.turns, 0),
      totalCorrections: facts.reduce((total, entry) => total + entry.corrections, 0),
    },
    signals,
    notes,
  }

  await mkdir(outDirectory, { recursive: true })
  const stamp = new Date(now).toISOString().replace(/[:.]/g, '-')
  const jsonPath = join(outDirectory, `report-${stamp}.json`)
  const markdownPath = join(outDirectory, `report-${stamp}.md`)
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`)
  await writeFile(markdownPath, SessionMiner.render(report))
  if (cachePath !== undefined) {
    await mkdir(resolve(cachePath, '..'), { recursive: true })
    await writeFile(cachePath, JSON.stringify(cache))
  }

  if (flags.get('quiet') !== 'true') {
    // `--json` keeps stdout a single parseable document; the artifact paths go to stderr.
    if (flags.get('json') === 'true') {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
      process.stderr.write(`report: ${jsonPath}\n`)
    } else {
      const top = Number(flags.get('top') ?? '25')
      process.stdout.write(SessionMiner.render({ ...report, signals: report.signals.slice(0, top) }))
      process.stdout.write(`\nreport: ${jsonPath}\n`)
    }
  }
  return 0
}

const validate = async (flags: ReadonlyMap<string, string>): Promise<number> => {
  const agentsHome = process.env['DSH_AGENTS_HOME'] ?? join(homedir(), '.agents')
  const skillRoots: readonly string[] = [join(REPO_ROOT, '.agents/skills'), join(agentsHome, 'skills')]
  // The harness loads its own home's AGENTS.md too; a dead path there costs every Session, in every repository.
  const alwaysOnPaths: readonly string[] = [join(REPO_ROOT, 'AGENTS.md'), join(agentsHome, 'AGENTS.md'), join(dshHome(flags), 'AGENTS.md')]
  const validation = await HarnessAudit.validate({ root: REPO_ROOT, skillRoots, alwaysOnPaths })
  if (flags.get('json') === 'true') process.stdout.write(`${JSON.stringify(validation, null, 2)}\n`)
  else process.stdout.write(HarnessAudit.render(validation))
  return validation.findings.some(finding => finding.severity === 'error') ? 1 : 0
}

const ledgerPathOf = (flags: ReadonlyMap<string, string>): string => flags.get('ledger') ?? join(REPO_ROOT, 'plans/self-improve/ledger.jsonl')

const signalEvidence = (
  evidence: readonly { readonly sessionId: string; readonly seq: number; readonly time: number; readonly excerpt: string }[],
): LedgerEntry['evidence'] => evidence.map(entry => ({ sessionId: entry.sessionId, seq: entry.seq, time: entry.time, excerpt: entry.excerpt }))

const evidenceFileSchema = z.array(
  z.object({ sessionId: z.string().optional(), seq: z.number().optional(), time: z.number(), excerpt: z.string(), ref: z.string().optional() }),
)

const reportSchema = z.object({
  signals: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      category: z.string(),
      confidence: z.enum(['high', 'medium', 'low']),
      evidence: z.array(z.object({ sessionId: z.string(), project: z.string(), seq: z.number(), time: z.number(), excerpt: z.string() })),
    }),
  ),
})

const confidenceSchema = z.enum(['high', 'medium', 'low'])
const statusSchema = z.enum(ImprovementLedger.STATUSES)

const ledgerAdd = async (flags: ReadonlyMap<string, string>): Promise<number> => {
  const path = ledgerPathOf(flags)
  const reportPath = flags.get('from')
  const signalId = flags.get('signal')
  const evidencePath = flags.get('evidence-file')
  const report = reportPath === undefined ? undefined : SessionLogs.decodeJson(reportSchema, await readFile(reportPath, 'utf8'))
  const signal = report?.signals.find(candidate => candidate.id === signalId)
  if (signal === undefined && evidencePath === undefined) {
    process.stderr.write(
      'self-improve: ledger add needs --from=<report.json> --signal=<signal id>, or --key=<key> --evidence-file=<json> for a non-Session finding\n',
    )
    return 2
  }
  const key = flags.get('key')
  if (signal === undefined && key === undefined) {
    process.stderr.write('self-improve: ledger add with --evidence-file also needs --key=<stable dedup key>\n')
    return 2
  }
  const evidence = evidencePath === undefined ? undefined : SessionLogs.decodeJson(evidenceFileSchema, await readFile(evidencePath, 'utf8'))
  const confidenceFlag = flags.get('confidence')
  const input: AddInput = {
    key: signal?.id ?? key ?? '',
    title: flags.get('title') ?? signal?.title ?? '',
    category: flags.get('category') ?? signal?.category ?? 'harness',
    confidence: confidenceFlag === undefined ? (signal?.confidence ?? 'medium') : confidenceSchema.parse(confidenceFlag),
    signalIds: signal === undefined ? [] : [signal.id],
    evidence: signal === undefined ? (evidence ?? []) : signalEvidence(signal.evidence),
    now: Date.now(),
  }
  const rootCause = flags.get('root-cause')
  const hypothesis = flags.get('hypothesis')
  const reopen = flags.get('reopen')
  if (rootCause !== undefined) input.rootCause = rootCause
  if (hypothesis !== undefined) input.hypothesis = hypothesis
  if (reopen !== undefined) input.reopenReason = reopen
  const entries = await ImprovementLedger.read(path)
  const outcome = ImprovementLedger.add({ entries, input })
  if (outcome.kind === 'refused') {
    process.stderr.write(`self-improve: ${outcome.reason}\n`)
    return 1
  }
  if (outcome.kind === 'duplicate') {
    process.stdout.write(`already tracked as ${outcome.entry.id} (${outcome.entry.status}, ${String(outcome.entry.attempts)} reopen attempt(s))\n`)
    return 0
  }
  if (outcome.kind === 'reopened') entries[entries.findIndex(entry => entry.id === outcome.entry.id)] = outcome.entry
  else entries.push(outcome.entry)
  await ImprovementLedger.write(path, entries)
  process.stdout.write(`${outcome.kind}: ${outcome.entry.id}\n`)
  return 0
}

const ledgerUpdate = async (flags: ReadonlyMap<string, string>): Promise<number> => {
  const path = ledgerPathOf(flags)
  const id = flags.get('id')
  const note = flags.get('note')
  if (id === undefined || note === undefined) {
    process.stderr.write('self-improve: ledger update needs --id=<id> and --note=<text>\n')
    return 2
  }
  const entries = await ImprovementLedger.read(path)
  const experimentPath = flags.get('experiment-file')
  const statusFlag = flags.get('status')
  const rootCause = flags.get('root-cause')
  const hypothesis = flags.get('hypothesis')
  const reopenWhen = flags.get('reopen-when')
  const revision = flags.get('revision')
  const regression = flags.get('regression')
  const candidate = flags.get('candidate')
  const experiment = experimentPath === undefined ? undefined : ImprovementLedger.parseExperiment(await readFile(experimentPath, 'utf8'))
  const input: UpdateInput = { id, note, now: Date.now() }
  if (statusFlag !== undefined) input.status = statusSchema.parse(statusFlag)
  if (rootCause !== undefined) input.rootCause = rootCause
  if (hypothesis !== undefined) input.hypothesis = hypothesis
  if (reopenWhen !== undefined) input.reopenWhen = reopenWhen
  if (revision !== undefined) input.revision = revision
  if (regression !== undefined) input.regression = regression
  if (candidate !== undefined) input.candidate = { summary: candidate, status: 'proposed' }
  if (experiment !== undefined) input.experiment = experiment
  const outcome = ImprovementLedger.update({ entries, input })
  if (outcome.kind === 'missing') {
    process.stderr.write(`self-improve: no ledger entry ${id}\n`)
    return 1
  }
  await ImprovementLedger.write(path, entries)
  process.stdout.write(`${outcome.entry.id} → ${outcome.entry.status}\n`)
  return 0
}

const ledger = async (options: Options): Promise<number> => {
  const flags = options.flags
  const path = ledgerPathOf(flags)
  if (options.action === 'path') {
    process.stdout.write(`${path}\n`)
    return 0
  }
  if (options.action === 'add') return ledgerAdd(flags)
  if (options.action === 'update') return ledgerUpdate(flags)
  const entries = await ImprovementLedger.read(path)
  if (options.action === 'show') {
    const id = flags.get('id')
    const entry = entries.find(candidate => candidate.id === id)
    if (entry === undefined) {
      process.stderr.write(`self-improve: no ledger entry ${id ?? '<missing --id>'}\n`)
      return 1
    }
    process.stdout.write(`${JSON.stringify(entry, null, 2)}\n`)
    return 0
  }
  const status = flags.get('status')
  const filtered = status === undefined ? entries : entries.filter(entry => entry.status === status)
  if (flags.get('json') === 'true') process.stdout.write(`${JSON.stringify(filtered, null, 2)}\n`)
  else process.stdout.write(ImprovementLedger.render(filtered))
  return 0
}

export const run = async (argv: readonly string[]): Promise<number> => {
  const options = parseOptions(argv)
  switch (options.command) {
    case 'mine':
      return mine(options.flags)
    case 'validate':
      return validate(options.flags)
    case 'ledger':
      return ledger(options)
    default:
      process.stdout.write(USAGE)
      return options.command === 'help' ? 0 : 2
  }
}

if (process.argv[1]?.endsWith('self-improve.ts') === true) process.exitCode = await run(process.argv.slice(2))
