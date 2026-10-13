import type { MemoryStore, NoteCategory } from '../store.ts'

/**
 * Months of synthetic memory: digests and notes across projects, each with exact identifiers and topic vocabulary,
 * plus recall questions written two ways: with the exact identifier, and as a paraphrase without any shared rare word.
 */
const topics = [
  { words: 'consumer rebalance storm coordinator restart', paraphrase: 'readers kept reshuffling their partition ownership after the leader bounced' },
  { words: 'retention hours topic default override', paraphrase: 'how long messages are kept before being deleted on that queue' },
  { words: 'postgres migration index lock timeout', paraphrase: 'the schema change that blocked writes on the database table' },
  { words: 'oauth token refresh expiry login loop', paraphrase: 'users got bounced back to sign in because credentials went stale' },
  { words: 'webpack bundle size regression chunk split', paraphrase: 'the shipped javascript got much heavier after the build change' },
  { words: 'flaky test timeout retry ci pipeline', paraphrase: 'checks on the build server failed now and then for no real reason' },
  { words: 'kubernetes pod oom killed memory limit', paraphrase: 'the container was terminated for using too much ram' },
  { words: 'payment provider webhook signature mismatch', paraphrase: 'callbacks from the billing processor were rejected as not authentic' },
  { words: 'cache invalidation stale read redis ttl', paraphrase: 'people saw outdated values because the in-memory store kept old entries' },
  { words: 'rate limit 429 burst quota gateway', paraphrase: 'clients were throttled for sending too many requests at once' },
  { words: 'feature flag rollout percentage canary', paraphrase: 'we enabled the new behavior gradually for a slice of customers' },
  { words: 'csv export encoding utf8 bom excel', paraphrase: 'spreadsheet software showed garbled accents in the downloaded file' },
] as const

const people = ['Hannah Okafor', 'Priya Raman', 'Tomasz Wielki', 'Elin Moss', 'Luis Ortega', 'Mei Chen', 'Kofi Mensah', 'Sara Lindqvist']
const categories: readonly NoteCategory[] = ['feedback', 'project', 'user', 'reference']

/** Deterministic pseudo-random sequence, so every run seeds the same corpus. */
const random = (seed: number) => {
  let state = seed >>> 0
  return (): number => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0
    return state / 2 ** 32
  }
}

export type RecallQuestion = { readonly kind: 'exact' | 'paraphrase'; readonly query: string; readonly project: string; readonly expected: string }

export const seedSyntheticCorpus = (input: {
  readonly store: MemoryStore
  readonly items: number
  readonly projects: number
  readonly now: number
  readonly seed?: number
}) => {
  const next = random(input.seed ?? 7)
  const pick = <Item>(items: readonly Item[]): Item => {
    const item = items[Math.floor(next() * items.length)]
    if (item === undefined) throw new Error('cannot pick from an empty list')
    return item
  }
  const projects = Array.from({ length: input.projects }, (_, index) => `/work/project-${index}`)
  const questions: RecallQuestion[] = []
  for (let index = 0; index < input.items; index++) {
    const project = pick(projects)
    const topic = pick(topics)
    const person = pick(people)
    const identifier = `${['INC', 'PRJ', 'ACC', 'TKT'][index % 4]}-${10_000 + index}`
    const updatedAt = input.now - Math.floor(next() * 365) * 86_400_000
    if (index % 3 === 2) {
      const { note } = input.store.addNote({
        project,
        text: `${person} decided ${identifier}: ${topic.words.split(' ').slice(0, 3).join(' ')} handled with option ${index % 7}.`,
        category: pick(categories),
        scope: 'repo',
        confidence: 'stated',
        sourceThread: `session-${String(index).padStart(8, '0')}`,
        sourceSeq: null,
        origin: 'agent',
      })
      if (index % 50 === 2) questions.push({ kind: 'exact', query: identifier, project, expected: `n:${note.id}` })
      continue
    }
    const id = `session-${String(index).padStart(8, '0')}-0000-4000-8000-000000000000`
    input.store.putThread({
      id,
      project,
      parent: null,
      title: `${topic.words.split(' ').slice(0, 2).join(' ')} ${identifier}`,
      decision: `Resolved ${identifier} for ${person}.`,
      digest: [
        `Investigated ${identifier}: ${topic.words}.`,
        `User asked: 1. Look into ${topic.words.split(' ')[0]} problems reported by ${person}.`,
        `Revisions: fix(${topic.words.split(' ')[0]}): handle ${topic.words.split(' ').slice(1, 3).join(' ')} (${identifier})`,
        `Agent's last answer: ${identifier} is fixed; ${person} confirmed.`,
      ].join('\n'),
      source: 'trail',
      lastSeq: 40,
      updatedAt,
    })
    if (index % 50 === 0) questions.push({ kind: 'exact', query: `${identifier} ${topic.words.split(' ')[0]}`, project, expected: `t:${id}` })
    if (index % 50 === 1) questions.push({ kind: 'paraphrase', query: topic.paraphrase, project, expected: `topic:${topic.words}` })
  }
  return { projects, questions }
}
