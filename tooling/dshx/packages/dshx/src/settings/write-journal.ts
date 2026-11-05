import * as Schema from 'effect/Schema'
import { decodeJsonSafe } from '../json.js'

/**
 * A Host settings write takes about two seconds and the official form runs them one at a time, so a page reload right
 * after a few edits drops every write still waiting in the browser. Each write is recorded in browser storage until it
 * settles; the next page replays what never settled, once the namespace is writable again.
 */
const STORAGE_KEY = 'dshx:settings.pending-writes.v1'

const pendingOpSchema = Schema.Union([
  Schema.Struct({ op: Schema.Literal('set'), path: Schema.Array(Schema.String), value: Schema.MutableJson }),
  Schema.Struct({ op: Schema.Literal('unset'), path: Schema.Array(Schema.String) }),
])

const pendingWriteSchema = Schema.Struct({ id: Schema.String, namespace: Schema.String, ops: Schema.Array(pendingOpSchema) })

const pendingWritesSchema = Schema.Array(pendingWriteSchema)

/** One field edit as callers give it; values are checked as JSON before they are recorded. */
export type SettingsWriteOp =
  | { readonly op: 'set'; readonly path: readonly string[]; readonly value: unknown }
  | { readonly op: 'unset'; readonly path: readonly string[] }

type WireOp = { op: 'set'; path: string[]; value: Schema.MutableJson } | { op: 'unset'; path: string[] }

type PendingWrite = typeof pendingWriteSchema.Type

/** The official form surface a journal wraps: `ConfigForm` and dshx's own scopes both fit it. */
export interface JournalSettingsForm {
  getSnapshot(): { readonly status: 'loading' | 'ready' | 'unavailable'; readonly writable: boolean }
  subscribe(listener: () => void): () => void
  mutate(ops: WireOp[], expectedRevision?: number): Promise<boolean>
}

export interface JournaledSettingsForm {
  set(field: string, value: unknown): Promise<boolean>
  unset(field: string): Promise<boolean>
  mutate(ops: readonly SettingsWriteOp[], expectedRevision?: number): Promise<boolean>
}

interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

const storage = (): StorageLike | undefined => {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}

const readAll = (): readonly PendingWrite[] => {
  const raw = storage()?.getItem(STORAGE_KEY) ?? null
  if (raw === null) return []
  try {
    const decoded = decodeJsonSafe(pendingWritesSchema, raw)
    return decoded._tag === 'Success' ? decoded.success : []
  } catch {
    return []
  }
}

const writeAll = (writes: readonly PendingWrite[]): void => {
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify(writes))
  } catch {
    // Full or blocked storage only loses the reload safety net; the write itself still goes to the Host.
  }
}

const record = (write: PendingWrite): void => writeAll([...readAll(), write])

const forget = (id: string): void => writeAll(readAll().filter(write => write.id !== id))

/** Pages that replayed a namespace already; every plugin bundles dshx, so the set lives on the page. */
declare global {
  var __dshxReplayedSettingsNamespacesV1: Set<string> | undefined
}

const replayedNamespaces = (): Set<string> => {
  globalThis.__dshxReplayedSettingsNamespacesV1 ??= new Set()
  return globalThis.__dshxReplayedSettingsNamespacesV1
}

const toJson = (value: unknown): Schema.MutableJson => {
  const decoded = Schema.decodeUnknownResult(Schema.MutableJson)(value)
  if (decoded._tag === 'Failure') throw new TypeError('Settings values must be JSON.')
  return decoded.success
}

const toWire = (ops: readonly SettingsWriteOp[]): WireOp[] =>
  ops.map((op): WireOp => (op.op === 'set' ? { op: 'set', path: [...op.path], value: toJson(op.value) } : { op: 'unset', path: [...op.path] }))

const journaled = (namespace: string, form: JournalSettingsForm, ops: readonly SettingsWriteOp[], expectedRevision?: number): Promise<boolean> => {
  let wire: WireOp[]
  try {
    wire = toWire(ops)
  } catch (error) {
    return Promise.reject(error)
  }
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  record({ id, namespace, ops: wire })
  return form.mutate(wire, expectedRevision).finally(() => forget(id))
}

/** Replays this namespace's unsettled writes from an earlier page as one mutation, once it is ready and writable. */
const replayWhenWritable = (namespace: string, form: JournalSettingsForm): void => {
  if (replayedNamespaces().has(namespace)) return
  const replay = (): boolean => {
    const snapshot = form.getSnapshot()
    if (snapshot.status !== 'ready' || !snapshot.writable) return false
    replayedNamespaces().add(namespace)
    const left = readAll().filter(write => write.namespace === namespace)
    if (left.length === 0) return true
    writeAll(readAll().filter(write => write.namespace !== namespace))
    void journaled(
      namespace,
      form,
      left.flatMap(write => write.ops),
    ).catch(() => undefined)
    return true
  }
  if (replay()) return
  const unsubscribe = form.subscribe(() => {
    if (replay()) unsubscribe()
  })
}

/** Wrap one namespace's form so writes a page unload cuts off are written again on the next load. */
const journalSettingsWrites = (namespace: string, form: JournalSettingsForm): JournaledSettingsForm => {
  replayWhenWritable(namespace, form)
  return {
    set: (field, value) => journaled(namespace, form, [{ op: 'set', path: [field], value }]),
    unset: field => journaled(namespace, form, [{ op: 'unset', path: [field] }]),
    mutate: (ops, expectedRevision) => journaled(namespace, form, ops, expectedRevision),
  }
}

export class SettingsWriteJournal {
  static readonly wrap = journalSettingsWrites
  static readonly storageKey = STORAGE_KEY
}
