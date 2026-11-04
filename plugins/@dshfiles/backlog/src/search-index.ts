import type { BacklogItem } from './item.js'
import { BacklogSearch } from './search.js'

/** Terms shorter than one gram cannot narrow anything; they fall back to scanning the candidates the other terms left. */
const GRAM = 3

const gramsOf = (text: string): Set<string> => {
  const grams = new Set<string>()
  for (let index = 0; index + GRAM <= text.length; index += 1) grams.add(text.slice(index, index + GRAM))
  return grams
}

/** Every gram of every text the scorer reads for this item, lowercased the way the scorer compares them. */
const itemGrams = (item: BacklogItem): Set<string> => {
  const grams = new Set<string>()
  for (const [, texts] of BacklogSearch.sourcesOf(item)) for (const text of texts) for (const gram of gramsOf(text.toLowerCase())) grams.add(gram)
  return grams
}

/**
 * A trigram full-text index in front of the token scorer. It only narrows: the scorer still decides whether and how
 * well an item matches, so ranking is unchanged. Every free-text term is a substring of some field text, so each of
 * its trigrams is in that item's gram set; intersecting the posting lists of every trigram of every term therefore
 * keeps every item the scorer could match and drops most that it could not.
 *
 * Items are immutable records replaced on each write, so `sync` re-indexes only the items whose object changed.
 */
export class BacklogSearchIndex {
  readonly #postings = new Map<string, Set<number>>()
  readonly #indexed = new Map<number, { readonly item: BacklogItem; readonly grams: ReadonlySet<string> }>()
  #syncedRecords: ReadonlyMap<number, BacklogItem> | null = null

  /** Brings the index level with one snapshot of the store; a snapshot already synced costs nothing. */
  sync(records: ReadonlyMap<number, BacklogItem>): void {
    if (records === this.#syncedRecords) return
    for (const [id, entry] of this.#indexed) if (records.get(id) !== entry.item) this.#remove(id)
    for (const [id, item] of records) if (!this.#indexed.has(id)) this.#add(id, item)
    this.#syncedRecords = records
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
        else for (const id of result) if (!posting.has(id)) result.delete(id)
        if (result.size === 0) return result
      }
    }
    return result
  }

  get size(): number {
    return this.#indexed.size
  }

  #add(id: number, item: BacklogItem): void {
    const grams = itemGrams(item)
    for (const gram of grams) {
      const posting = this.#postings.get(gram)
      if (posting === undefined) this.#postings.set(gram, new Set([id]))
      else posting.add(id)
    }
    this.#indexed.set(id, { item, grams })
  }

  #remove(id: number): void {
    const entry = this.#indexed.get(id)
    if (entry === undefined) return
    for (const gram of entry.grams) {
      const posting = this.#postings.get(gram)
      posting?.delete(id)
      if (posting?.size === 0) this.#postings.delete(gram)
    }
    this.#indexed.delete(id)
  }
}
