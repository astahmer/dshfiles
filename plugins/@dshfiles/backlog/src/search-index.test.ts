import { setFlagsFromString } from 'node:v8'
import { runInNewContext } from 'node:vm'

import { describe, expect, it } from '@effect/vitest'
import { Context, Effect, Layer } from 'effect'
import { TestClock } from 'effect/testing'
import { describe as plainDescribe, it as plainIt } from 'vitest'

import type { BacklogItem } from './item.js'
import { BacklogSearch } from './search.js'
import { BacklogSearchIndex } from './search-index.js'
import { BacklogStore } from './store.js'
import { backlogStoreLayer } from './test-support.js'

const DAY_MS = 86_400_000

/** A small deterministic generator, so a failing parity case reproduces. */
const seeded = (seed: number) => {
  let state = seed
  return (): number => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648
    return state / 2_147_483_648
  }
}

const words = ['composer', 'chips', 'paste', 'deploy', 'jj', 'rebase', 'Ünïcode', 'flaky', 'test', 'token', '429', 'merge', 'crm', 'Kanban', 'db', 'x']
const kinds = ['task', 'bug', 'idea', 'note', 'question'] as const
const statuses = ['inbox', 'todo', 'doing', 'done', 'dropped'] as const

const corpus = (count: number, random: () => number): BacklogItem[] => {
  const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)] ?? (list[0] as T)
  const phrase = (length: number) => Array.from({ length }, () => pick(words)).join(' ')
  return Array.from({ length: count }, (_, index) => {
    const id = index + 1
    const title = phrase(1 + Math.floor(random() * 4))
    return {
      id,
      title,
      body: random() < 0.6 ? phrase(Math.floor(random() * 12)) : '',
      kind: pick(kinds),
      status: pick(statuses),
      project: random() < 0.5 ? `/work/${pick(words).toLowerCase()}` : null,
      tags: random() < 0.4 ? [pick(words).toLowerCase()] : [],
      links: random() < 0.3 ? [{ type: 'thread', target: `session-${pick(words)}` }] : [],
      attachments: [],
      actors: [{ id: random() < 0.3 ? 'agent:session-a' : 'user', role: 'owner' }],
      pinned: false,
      humanFields: [],
      createdAt: 0,
      lastActivityAt: Math.floor(random() * 40) * DAY_MS,
      events: [
        { at: 0, actor: 'user', kind: 'created', detail: title },
        ...(random() < 0.4 ? [{ at: 1, actor: 'user', kind: 'commented' as const, detail: phrase(6) }] : []),
      ],
    } satisfies BacklogItem
  })
}

/** The ranking the store applies: score, then activity, then id. */
const rank = (items: readonly BacklogItem[], raw: string, now: number) => {
  const query = BacklogSearch.parse(raw)
  return items
    .flatMap(item => {
      const match = BacklogSearch.score(item, query, now)
      return match === null ? [] : [{ item, match }]
    })
    .sort((left, right) => right.match.score - left.match.score || right.item.lastActivityAt - left.item.lastActivityAt || right.item.id - left.item.id)
    .map(entry => ({ id: entry.item.id, score: entry.match.score, fields: entry.match.fields, snippet: entry.match.snippet }))
}

const indexed = (index: BacklogSearchIndex, items: readonly BacklogItem[], raw: string, now: number) => {
  index.sync(new Map(items.map(item => [item.id, item])))
  const candidates = index.candidates(BacklogSearch.parse(raw).terms)
  return rank(candidates === null ? items : items.filter(item => candidates.has(item.id)), raw, now)
}

const queriesFor = (items: readonly BacklogItem[], random: () => number): string[] => {
  const slices = items.slice(0, 40).flatMap(item => {
    const start = Math.floor(random() * item.title.length)
    return [item.title.slice(start, start + 2 + Math.floor(random() * 6)).toLowerCase(), `b:${String(item.id)}`, String(item.id)]
  })
  return [
    ...slices,
    ...words.map(word => word.toLowerCase()),
    'compo chips',
    '"paste deploy"',
    'kind:bug token',
    'status:doing #crm',
    'is:blocked merge',
    'project:jj rebase',
    'by:agent flaky',
    'has:thread session',
    'updated:<7d test',
    'updated:>30d',
    'nothing-matches-this',
    'ünï',
    'x db',
    '',
  ]
}

plainDescribe('search index parity', () => {
  plainIt('ranks exactly like a full scan for every query over a generated corpus', () => {
    const random = seeded(7)
    const items = corpus(400, random)
    const index = new BacklogSearchIndex()
    const now = 40 * DAY_MS
    for (const query of queriesFor(items, random)) expect(indexed(index, items, query, now), query).toEqual(rank(items, query, now))
    // The index has to narrow to be worth keeping: a selective pair of terms leaves a fraction of the corpus to score.
    expect(index.candidates(['kanban', 'rebase'])?.size ?? items.length).toBeLessThan(items.length / 2)
  })

  plainIt('keeps parity after items are edited, added and removed', () => {
    const random = seeded(11)
    let items = corpus(120, random)
    const index = new BacklogSearchIndex()
    const queries = queriesFor(items, random)
    for (const query of queries) expect(indexed(index, items, query, 0), query).toEqual(rank(items, query, 0))
    items = items
      .filter(item => item.id % 7 !== 0)
      .map(item => (item.id % 5 === 0 ? { ...item, title: `${item.title} renamed zebra`, body: 'quagga stripes' } : item))
    items = [...items, ...corpus(10, random).map(item => ({ ...item, id: item.id + 1000, title: `zebra ${item.title}` }))]
    for (const query of [...queries, 'zebra', 'quagga', 'renamed']) expect(indexed(index, items, query, 0), query).toEqual(rank(items, query, 0))
    expect(index.size).toBe(items.length)
  })

  plainIt('narrows only on terms long enough to carry a trigram', () => {
    const index = new BacklogSearchIndex()
    index.sync(new Map(corpus(20, seeded(3)).map(item => [item.id, item])))
    expect(index.candidates(['db'])).toBeNull()
    expect(index.candidates([])).toBeNull()
    expect(index.candidates(['no-such-text'])?.size).toBe(0)
  })
})

plainDescribe('search index heap', () => {
  plainIt('stays within a small multiple of the text it indexes', () => {
    setFlagsFromString('--expose-gc')
    const collect = runInNewContext('gc') as () => void
    const random = seeded(5)
    const alphabet = 'abcdefghijklmnopqrstuvwxyzeeeaaoottiinnss0123456789-_/.:'
    const vocabulary = Array.from({ length: 12_000 }, () =>
      Array.from({ length: 3 + Math.floor(random() * 9) }, () => alphabet[Math.floor(random() * alphabet.length)]).join(''),
    )
    const prose = (length: number) => {
      const parts: string[] = []
      for (let size = 0; size < length; ) {
        const word = vocabulary[Math.floor(vocabulary.length * random() ** 2.5)] ?? ''
        parts.push(word)
        size += word.length + 1
      }
      return parts.join(' ')
    }
    const items = corpus(200, random).map(item => ({ ...item, body: prose(2_400), events: [{ at: 0, actor: 'user', kind: 'created' as const, detail: prose(700) }] }))
    const textLength = items.reduce((total, item) => total + item.body.length + (item.events[0]?.detail.length ?? 0), 0)
    const records = new Map(items.map(item => [item.id, item]))
    collect()
    const before = process.memoryUsage().heapUsed
    const index = new BacklogSearchIndex()
    index.sync(records)
    collect()
    // A Set per gram plus a gram set per item took ~70x the text; ascending id arrays take ~11x.
    expect((process.memoryUsage().heapUsed - before) / textLength).toBeLessThan(20)
    expect(index.size).toBe(items.length)
  })
})

const openStore = () => Effect.map(Layer.build(backlogStoreLayer()), context => Context.get(context, BacklogStore))
const user = { kind: 'user' } as const

describe('store search index', () => {
  it.effect('finds an item by its edited text and no longer by the text it lost', () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(0)
      const store = yield* openStore()
      yield* store.capture({ text: 'Composer drops chips on paste', actor: user })
      yield* store.capture({ text: 'Weekly digest of dormant items', actor: user })
      expect((yield* store.list({ query: 'chips' })).items.map(item => item.id)).toEqual([1])

      yield* store.update({ id: 1, title: 'Composer loses pills', actor: user })
      expect((yield* store.list({ query: 'pills' })).items.map(item => item.id)).toEqual([1])
      // The original capture is still searchable text, as before the index.
      expect((yield* store.list({ query: 'chips' })).items.map(item => [item.id, item.match?.fields])).toEqual([[1, ['capture']]])
      yield* store.comment({ id: 2, text: 'archive after a fortnight', actor: user })
      expect((yield* store.list({ query: 'fortnight' })).items.map(item => item.id)).toEqual([2])
    }).pipe(Effect.scoped),
  )
})
