import { Context } from '@deepseek-ai/cordis'
import type { ComponentType } from 'react'
import { vi } from 'vitest'
import { apply, inject } from '../src/native/index.js'

interface Observable {
  readonly subscribe: (listener: () => void) => () => void
  readonly getSnapshot: () => { readonly apiKeyConfigured: boolean }
}

interface Face {
  readonly hooks: { readonly webSearchCard: Observable }
}

interface Entry {
  readonly component: ComponentType<never>
  readonly inject: (() => Face) | undefined
}

/** One settings section the page edits: ready, writable, and republished when `publish` replaces its value. */
const settingsSection = (value: Record<string, string>) => {
  const listeners = new Set<() => void>()
  let snapshot = { status: 'ready' as const, value, base: value, user: {}, revision: 1, writable: true }
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    mutate: async () => true,
    set: async () => true,
    unset: async () => true,
    publish: () => {
      snapshot = { ...snapshot, revision: snapshot.revision + 1 }
      for (const listener of [...listeners]) listener()
    },
  }
}

/** Boot the forked row against typed fakes; credential reads answer after `answerMs`, like a network round trip. */
export const bootWebSearchRow = async ({ answerMs = 5 }: { readonly answerMs?: number } = {}) => {
  const ctx = new Context()
  const events = new Map<string, Set<(ref: string) => void>>()
  const entries = new Map<string, Entry>()
  const describeCredentials = vi.fn(
    (refs: readonly string[]) =>
      new Promise(resolve =>
        setTimeout(() => resolve({ ok: true, value: Object.fromEntries(refs.map(ref => [ref, { configured: true, writable: true }])) }), answerMs),
      ),
  )
  const sections = {
    web: settingsSection({ searchProvider: 'deepseek-official', fetchProvider: 'http' }),
    'web-search-deepseek': settingsSection({}),
    'web-deepseek-api': settingsSection({}),
  }
  ctx.provide('slots', {
    register: (options: { name: string; id: string; inject?: () => Face }, component: ComponentType<never>) => {
      entries.set(`${options.name}:${options.id}`, { component, inject: options.inject })
      return () => entries.delete(`${options.name}:${options.id}`)
    },
    inject: (_name: string, install: () => () => void) => install(),
  })
  ctx.provide('locale', { register: () => () => {}, bind: () => (key: string) => key })
  ctx.provide('remote', {
    $on: (event: string, listener: (ref: string) => void) => {
      const listeners = events.get(event) ?? new Set()
      listeners.add(listener)
      events.set(event, listeners)
      return () => listeners.delete(listener)
    },
    credentials: { describe: describeCredentials, set: vi.fn(async () => ({ ok: true, value: undefined })) },
  })
  ctx.provide('remote.credentials', {})
  ctx.provide('configForms', {
    get: (namespace: keyof typeof sections) => sections[namespace],
    whileServed: (_namespaces: readonly string[], install: () => () => void) => install(),
  })
  await ctx.plugin({ inject: [...inject], apply }).await()
  const emit = (event: string, ref: string): void => {
    for (const listener of events.get(event) ?? []) listener(ref)
  }
  const card = (): Observable => {
    const face = entries.get('plugins.item:web-search')?.inject?.()
    if (face === undefined) throw new Error('Web search page is not registered')
    return face.hooks.webSearchCard
  }
  return { ctx, entries, emit, card, sections, describeCredentials }
}
