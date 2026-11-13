import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import { useEffect, useRef } from 'react'

/**
 * Phone back navigation (Android back gesture, a browser Back): every phone level that has an in-app way back — a
 * stack screen with Back, the thread-panel sheet — is one history layer. A layer keeps the current history entry
 * tagged with its depth: going deeper pushes one entry, a browser Back onto a shallower entry pops the layer once,
 * and an in-app Back consumes the entry it pushed. Layers share `history.state`, each under its own key, so the
 * sheet and the stack never undo each other's entries.
 */

/** A layer about to call `history.back()` for its own bookkeeping announces it, so no layer reads that as the user's Back. */
export const PHONE_HISTORY_SELF_POP_EVENT = 'dshfiles:phone-history-self-pop'
/** Every layer's tag lives under this one key of `history.state`. */
const ENTRY_KEY = 'dshfilesPhoneHistory'

/** Each layer's depth by key, and the layer that pushed the entry: only it may consume that entry with `history.back()`. */
const PhoneHistoryEntry = Schema.Struct({
  depths: Schema.Record(Schema.String, Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  owner: Schema.optional(Schema.String),
})
export type PhoneHistoryEntry = typeof PhoneHistoryEntry.Type

const UNTAGGED: PhoneHistoryEntry = { depths: {} }
const decodeEntry = Schema.decodeUnknownOption(PhoneHistoryEntry)

/**
 * - `push`: the layer went deeper than the entry says; add one entry.
 * - `pop`: the user's Back landed on a shallower entry; the layer goes back one level.
 * - `back`: the layer went shallower than the entry it pushed; consume that entry.
 * - `replace`: the entry is deeper than the layer but another layer pushed it; rewrite the tag in place.
 */
export type PhoneHistoryStep = 'none' | 'push' | 'pop' | 'back' | 'replace'

export const PhoneHistoryModel = {
  step: (input: { readonly depth: number; readonly entryDepth: number; readonly popped: boolean; readonly ownsEntry: boolean }): PhoneHistoryStep => {
    if (input.entryDepth === input.depth) return 'none'
    if (input.entryDepth < input.depth) return input.popped ? 'pop' : 'push'
    return input.ownsEntry ? 'back' : 'replace'
  },
  /** The depth an entry records for one layer; an untagged entry is the bottom of every layer. */
  entryDepth: (entry: PhoneHistoryEntry, key: string): number => entry.depths[key] ?? 0,
  owns: (entry: PhoneHistoryEntry, key: string): boolean => entry.owner === key,
  /** The entry with this layer's depth, keeping every other layer's tag; `owner` marks this layer as its pusher. */
  tag: (input: { readonly entry: PhoneHistoryEntry; readonly key: string; readonly depth: number; readonly owner: boolean }): PhoneHistoryEntry => {
    const depths = { ...input.entry.depths, [input.key]: input.depth }
    if (input.owner) return { depths, owner: input.key }
    return input.entry.owner === undefined ? { depths } : { depths, owner: input.entry.owner }
  },
} as const

const readEntry = (): PhoneHistoryEntry => Option.getOrElse(decodeEntry(window.history.state?.[ENTRY_KEY]), () => UNTAGGED)

/** The current `history.state` with the entry under its key, keeping any state DSH itself keeps there. */
const withEntry = (entry: PhoneHistoryEntry): object => {
  const state = window.history.state
  return typeof state === 'object' && state !== null ? { ...state, [ENTRY_KEY]: entry } : { [ENTRY_KEY]: entry }
}

/**
 * Keep one phone layer in step with the browser history while `enabled`. `pop` goes back one level of the layer;
 * `baseUrl` rewrites the URL of the entry left below a push (the stack drops the thread from the list's entry, so
 * Back onto the list never reopens a thread).
 */
export const usePhoneHistoryLayer = (input: {
  readonly key: string
  readonly depth: number
  readonly enabled: boolean
  readonly pop: () => void
  readonly baseUrl?: (href: string) => string
}): void => {
  const latest = useRef(input)
  latest.current = input
  const selfPops = useRef(0)
  const sync = useRef((popped: boolean): void => {
    const { key, depth, baseUrl } = latest.current
    const entry = readEntry()
    const step = PhoneHistoryModel.step({ depth, entryDepth: PhoneHistoryModel.entryDepth(entry, key), popped, ownsEntry: PhoneHistoryModel.owns(entry, key) })
    if (step === 'pop') {
      latest.current.pop()
      return
    }
    if (step === 'back') {
      window.dispatchEvent(new Event(PHONE_HISTORY_SELF_POP_EVENT))
      window.history.back()
      return
    }
    if (step === 'replace') {
      window.history.replaceState(withEntry(PhoneHistoryModel.tag({ entry, key, depth, owner: false })), '', window.location.href)
      return
    }
    if (step !== 'push') return
    const href = window.location.href
    const base = baseUrl?.(href)
    if (base !== undefined && base !== href) window.history.replaceState(window.history.state, '', base)
    window.history.pushState(withEntry(PhoneHistoryModel.tag({ entry, key, depth, owner: true })), '', href)
  })
  useEffect(() => {
    if (!input.enabled) return
    selfPops.current = 0
    const onSelfPop = (): void => {
      selfPops.current += 1
    }
    const onPopState = (): void => {
      const popped = selfPops.current === 0
      if (!popped) selfPops.current -= 1
      sync.current(popped)
    }
    window.addEventListener(PHONE_HISTORY_SELF_POP_EVENT, onSelfPop)
    window.addEventListener('popstate', onPopState)
    return () => {
      window.removeEventListener(PHONE_HISTORY_SELF_POP_EVENT, onSelfPop)
      window.removeEventListener('popstate', onPopState)
    }
  }, [input.enabled])
  useEffect(() => {
    if (input.enabled) sync.current(false)
  }, [input.enabled, input.depth])
}
