import { Context } from '@deepseek-ai/cordis'
import type { ComponentType } from 'react'
import { vi } from 'vitest'
import { apply, inject } from '../src/native/index.ts'

interface Face {
  readonly hooks: Readonly<Record<string, { subscribe: (listener: () => void) => () => void; getSnapshot: () => { status: string } }>>
}

interface Entry {
  readonly component: ComponentType<never>
  readonly inject: (() => Face) | undefined
}

const answered = <Value>(value: Value) => ({ ok: true as const, value })

/**
 * Boot the forked row against typed fakes of the services it injects. Host reads answer after `answerMs`, like a
 * network round trip, so reads issued in one burst overlap.
 */
export const bootModelsRow = async ({ answerMs = 5 }: { readonly answerMs?: number } = {}) => {
  const ctx = new Context()
  const later = <Value>(value: Value): Promise<Value> => new Promise(resolve => setTimeout(() => resolve(value), answerMs))
  const events = new Map<string, Set<(payload?: string) => void>>()
  const entries = new Map<string, Entry>()
  const listProviders = vi.fn(() => later(answered([])))
  const listConfigurableProviders = vi.fn(() => later(answered([])))
  const describeCredentials = vi.fn(() => later(answered({})))
  const modelCatalog = vi.fn(() => later(answered({ default: { provider: 'p', model: 'm' }, routableProviders: [], groups: [], failures: [] })))
  ctx.provide('slots', {
    register: (options: { name: string; id: string; inject?: () => Face }, component: ComponentType<never>) => {
      entries.set(`${options.name}:${options.id}`, { component, inject: options.inject })
      return () => entries.delete(`${options.name}:${options.id}`)
    },
    inject: (_name: string, install: () => () => void) => install(),
  })
  ctx.provide('locale', { register: () => () => {}, bind: () => (key: string) => key })
  ctx.provide('remote', {
    $on: (event: string, listener: (payload?: string) => void) => {
      const listeners = events.get(event) ?? new Set()
      listeners.add(listener)
      events.set(event, listeners)
      return () => listeners.delete(listener)
    },
    llm: { listProviders, listConfigurableProviders },
    credentials: { describe: describeCredentials },
    session: { modelCatalog },
    settings: {},
  })
  for (const name of ['remote.credentials', 'remote.llm', 'remote.settings', 'remote.session']) ctx.provide(name, {})
  ctx.provide('configForms', {
    describe: () => ({
      ensure: async () => undefined,
      getSnapshot: () => ({ view: { writable: true, namespaces: [] }, error: null }),
    }),
    get: () => ({ subscribe: () => () => {}, getSnapshot: () => ({ status: 'idle' }) }),
  })
  ctx.provide('settingsSchema', {})
  await ctx.plugin({ inject: [...inject], apply }).await()
  const emit = (event: string, payload?: string): void => {
    for (const listener of events.get(event) ?? []) listener(payload)
  }
  const modelsFace = (): Face => {
    const face = entries.get('settings.section:models')?.inject?.()
    if (face === undefined) throw new Error('Models section is not registered')
    return face
  }
  return { ctx, entries, emit, modelsFace, listProviders, listConfigurableProviders, describeCredentials, modelCatalog }
}
