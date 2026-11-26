import { identityToneIndex } from '@dshfiles/plugin-ui/components/palette-picker'
import { useEffect, useSyncExternalStore } from 'react'

/**
 * The colour of an agent mention in the draft: the identity slot the agent chose in the Agents registry, else the slot
 * its handle hashes to (the shared project-tone hash), the same one the agent's sent-message chip paints. The chip
 * renders inside a Lexical decorator with no dshx API context, so the client entry installs one registry read here
 * and every chip of every draft shares it; without the agents plugin the read fails and chips keep the hashed slot.
 */
type Load = () => Promise<ReadonlyMap<string, number> | null>

/** Long enough that typing never re-reads, short enough that a colour saved in the Agents panel shows on the next chip. */
const STALE_MS = 30_000

let load: Load | undefined
let chosen: ReadonlyMap<string, number> = new Map()
let readAt = Number.NEGATIVE_INFINITY
let reading: Promise<void> | undefined
const listeners = new Set<() => void>()

const publish = (next: ReadonlyMap<string, number>): void => {
  const same = next.size === chosen.size && [...next].every(([handle, slot]) => chosen.get(handle) === slot)
  if (same) return
  chosen = next
  for (const listener of listeners) listener()
}

/** One registry read; an answer that lands after its loader was uninstalled or replaced is dropped. */
const startRead = (read: Load): void => {
  readAt = Date.now()
  reading = read()
    .then(
      next => {
        if (next !== null && load === read) publish(next)
      },
      () => undefined,
    )
    .finally(() => {
      reading = undefined
    })
}

/** Start one registry read unless one is running or the last answer is still fresh. */
const refresh = (): void => {
  if (load === undefined || reading !== undefined || Date.now() - readAt < STALE_MS) return
  startRead(load)
}

const install = (next: Load): (() => void) => {
  load = next
  readAt = Number.NEGATIVE_INFINITY
  return () => {
    if (load !== next) return
    load = undefined
    reading = undefined
    publish(new Map())
  }
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const slotOf = (handle: string): number => chosen.get(handle) ?? identityToneIndex(handle)

/** The slot one agent chip paints; mounting a chip asks for a fresh read when the last one is stale. */
const useSlot = (handle: string): number => {
  useEffect(refresh, [handle])
  return useSyncExternalStore(subscribe, () => slotOf(handle))
}

export class AgentChipTone {
  static readonly install = install
  static readonly slotOf = slotOf
  static readonly useSlot = useSlot
}
