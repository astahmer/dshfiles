import { createHash, randomInt } from 'node:crypto'

import { BacklogReference } from './backlog-reference.js'

const ALPHABET = BacklogReference.shortAlphabet
const FOUR_CHAR_SPACE = ALPHABET.length ** 4
/** Aliases grow to five characters once a fifth of the four-character space is taken, so a random draw rarely collides. */
const GROW_AT = Math.floor(FOUR_CHAR_SPACE / 5)
const hasLetter = /[a-z]/u

const draw = (length: number, pick: (bound: number) => number): string => Array.from({ length }, () => ALPHABET[pick(ALPHABET.length)] ?? '0').join('')

/**
 * A random short alias no item holds: 4 lowercase Crockford base32 characters with at least one letter (an all-digit
 * draw would read as a legacy `b:<n>`), 5 once a fifth of the 4-character space is used. Fixed for the item's life.
 */
const mint = (input: { readonly taken: Pick<ReadonlySet<string>, 'size' | 'has'>; readonly pick?: (bound: number) => number }): string => {
  const pick = input.pick ?? randomInt
  const length = input.taken.size >= GROW_AT ? 5 : 4
  for (;;) {
    const candidate = draw(length, pick)
    if (hasLetter.test(candidate) && !input.taken.has(candidate)) return candidate
  }
}

/** A pick that every Host repeats for the same seed: bytes of `sha256(seed:n)`, so a derived alias needs no coordination. */
const seededPick = (seed: string): ((bound: number) => number) => {
  const state = { block: 0, offset: 0, bytes: createHash('sha256').update(`${seed}:0`).digest() }
  return bound => {
    if (state.offset >= state.bytes.length) {
      state.block += 1
      state.offset = 0
      state.bytes = createHash('sha256')
        .update(`${seed}:${String(state.block)}`)
        .digest()
    }
    const byte = state.bytes[state.offset] ?? 0
    state.offset += 1
    return byte % bound
  }
}

/**
 * A 5-character alias every Host derives from the same seed (an item id): what an item shows on a Host that cannot use
 * its original ref, so all those Hosts agree on it without exchanging anything.
 */
const derived = (input: { readonly seed: string; readonly taken: Pick<ReadonlySet<string>, 'has'> }): string => {
  const pick = seededPick(input.seed)
  for (;;) {
    const candidate = draw(5, pick)
    if (hasLetter.test(candidate) && !input.taken.has(candidate)) return candidate
  }
}

export class ShortAlias {
  static readonly mint = mint
  static readonly derived = derived
  static readonly seededPick = seededPick
  static readonly growAt = GROW_AT
}
