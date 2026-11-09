import type { BacklogItem } from './item.js'
import { BacklogSearch } from './search.js'

/** Terms shorter than one gram cannot narrow anything; they fall back to scanning the candidates the other terms left. */
const GRAM = 3

const gramsOf = (text: string): Set<string> => {
  const grams = new Set<string>()
  for (let index = 0; index + GRAM <= text.length; index += 1) grams.add(text.slice(index, index + GRAM))
  return grams
}

/** Calls `visit` with every gram of every text the scorer reads for this item, lowercased the way the scorer compares them. */
const forEachItemGram = (item: BacklogItem, visit: (gram: string) => void): void => {
  for (const [, texts] of BacklogSearch.sourcesOf(item))
    for (const text of texts) {
      const lower = text.toLowerCase()
      for (let index = 0; index + GRAM <= lower.length; index += 1) visit(lower.slice(index, index + GRAM))
    }
}

/** Where `id` sits in an ascending posting, or where it would be inserted. */
const positionOf = (posting: readonly number[], id: number): number => {
  let low = 0
  let high = posting.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if ((posting[middle] ?? 0) < id) low = middle + 1
    else high = middle
  }
  return low
}

const holds = (posting: readonly number[], id: number): boolean => posting[positionOf(posting, id)] === id

/**
 * A trigram full-text index in front of the token scorer. It only narrows: the scorer still decides whether and how
 * well an item matches, so ranking is unchanged. Every free-text term is a substring of some field text, so each of
 * its trigrams is in that item's gram set; intersecting the posting lists of every trigram of every term therefore
 * keeps every item the scorer could match and drops most that it could not.
 *
 * Items are immutable records replaced on each write, so `sync` re-indexes only the items whose object changed. A posting
 * is an ascending array of item ids and no per-item gram set is kept: removal recomputes the grams of the indexed item.
 */
export class BacklogSearchIndex {
  readonly #postings = new Map<string, number[]>()
  readonly #indexed = new Map<number, BacklogItem>()
  #syncedRecords: ReadonlyMap<number, BacklogItem> | null = null

  /** Brings the index level with one snapshot of the store; a snapshot already synced costs nothing. */
  sync(records: ReadonlyMap<number, BacklogItem>): void {
    if (records === this.#syncedRecords) return
    for (const [id, item] of this.#indexed) if (records.get(id) !== item) this.#remove(id, item)
    for (const [id, item] of records) if (!this.#indexed.has(id)) this.#add(id, item)
    this.#syncedRecords = records
  }

  /** Whether any term is long enough to narrow; until a search has one, the index is never built. */
  static narrows(terms: readonly string[]): boolean {
    return terms.some(term => term.length >= GRAM)
  }

  /**
   * The ids that may match every term, or null when no term is long enough to narrow (the caller then scores every
   * item, exactly as before the index).
   */
  candidates(terms: readonly string[]): ReadonlySet<number> | null {
    let result: Set<number> | null = null
    for (const term of terms) {
      if (term.length < GRAM) continue
      for (const gram of gramsOf(term)) {
        const posting = this.#postings.get(gram)
        if (posting === undefined) return new Set()
        if (result === null) result = new Set(posting)
        else for (const id of result) if (!holds(posting, id)) result.delete(id)
        if (result.size === 0) return result
      }
    }
    return result
  }

  get size(): number {
    return this.#indexed.size
  }

  #add(id: number, item: BacklogItem): void {
    forEachItemGram(item, gram => {
      const posting = this.#postings.get(gram)
      if (posting === undefined) return void this.#postings.set(gram, [id])
      const last = posting.at(-1) ?? 0
      if (last === id) return
      if (last < id) return void posting.push(id)
      const position = positionOf(posting, id)
      if (posting[position] !== id) posting.splice(position, 0, id)
    })
    this.#indexed.set(id, item)
  }

  #remove(id: number, item: BacklogItem): void {
    forEachItemGram(item, gram => {
      const posting = this.#postings.get(gram)
      if (posting === undefined) return
      const position = positionOf(posting, id)
      if (posting[position] !== id) return
      if (posting.length === 1) this.#postings.delete(gram)
      else posting.splice(position, 1)
    })
    this.#indexed.delete(id)
  }
}
