import { describe, expect, it, vi } from 'vitest'

import { createThreadContentSearch } from './thread-content-source.js'

const memoryApi = { owner: '@dshfiles/memory', id: 'dshfiles-memory', version: 1, methods: [{ name: 'findThreads' }] }
const signal = new AbortController().signal

const search = (options: {
  readonly apis?: readonly (typeof memoryApi)[]
  readonly finder?: (input: unknown, options?: { readonly signal?: AbortSignal }) => Promise<unknown>
  readonly native?: (query: string, signal: AbortSignal) => Promise<readonly { readonly sessionId: string; readonly snippet: string }[]>
}) =>
  createThreadContentSearch({
    listApis: async () => options.apis ?? [],
    callFinder: async (_api, input, _signal) => (options.finder === undefined ? undefined : options.finder(input)),
    native: options.native ?? (async () => [{ sessionId: 'native-1', snippet: 'from DSH' }]),
  })

describe('the palette thread-content source', () => {
  it('answers from the memory finder when the Host serves it', async () => {
    const native = vi.fn(async () => [{ sessionId: 'native-1', snippet: 'from DSH' }])
    const source = search({
      apis: [memoryApi],
      finder: async () => ({ hits: [{ sessionId: 'session-a', snippet: 'baseline findings' }], notes: [], degraded: [] }),
      native,
    })
    expect(await source('baseline', signal)).toEqual([{ sessionId: 'session-a', snippet: 'baseline findings' }])
    expect(native).not.toHaveBeenCalled()
  })

  it('carries the title and workspace a finder hit names, so an unlisted thread still renders', async () => {
    const source = search({
      apis: [memoryApi],
      finder: async () => ({
        hits: [
          {
            sessionId: 'session-b',
            snippet: 'retarget the palette',
            title: 'Retarget the palette finder',
            project: '/dev/other',
            cwd: '/dev/other',
            updatedAt: 1_700_000_000_000,
            extra: 'ignored',
          },
        ],
      }),
    })
    expect(await source('retarget', signal)).toEqual([
      {
        sessionId: 'session-b',
        snippet: 'retarget the palette',
        title: 'Retarget the palette finder',
        project: '/dev/other',
        cwd: '/dev/other',
        updatedAt: 1_700_000_000_000,
      },
    ])
  })

  it('excludes subagent hits from palette content results', async () => {
    const source = search({
      apis: [memoryApi],
      finder: async () => ({
        hits: [
          { sessionId: 'parent', snippet: 'top-level hit', title: 'Parent', parentSessionId: null, live: true, persisted: true },
          { sessionId: 'child', snippet: 'subagent hit', title: 'Child', parentSessionId: 'parent' },
        ],
      }),
    })
    expect(await source('query', signal)).toEqual([
      {
        sessionId: 'parent',
        snippet: 'top-level hit',
        title: 'Parent',
        project: undefined,
        cwd: undefined,
        updatedAt: undefined,
        live: true,
        persisted: true,
      },
    ])
  })

  it('discovers the API once and keeps using it', async () => {
    const listApis = vi.fn(async () => [memoryApi])
    const callFinder = vi.fn(async () => ({ hits: [] }))
    const source = createThreadContentSearch({ listApis, callFinder, native: async () => [] })
    await source('one', signal)
    await source('two', signal)
    expect(listApis).toHaveBeenCalledTimes(1)
    expect(callFinder).toHaveBeenCalledTimes(2)
  })

  it('falls back to DSH search when Memory is not installed', async () => {
    const source = search({ apis: [] })
    expect(await source('baseline', signal)).toEqual([{ sessionId: 'native-1', snippet: 'from DSH' }])
  })

  it('falls back when the finder fails or answers something else', async () => {
    const failing = search({ apis: [memoryApi], finder: async () => Promise.reject(new Error('unavailable')) })
    expect(await failing('baseline', signal)).toEqual([{ sessionId: 'native-1', snippet: 'from DSH' }])

    const reshaped = search({ apis: [memoryApi], finder: async () => ({ items: [] }) })
    expect(await reshaped('baseline', signal)).toEqual([{ sessionId: 'native-1', snippet: 'from DSH' }])
  })

  it('falls back when the registry itself is unavailable', async () => {
    const source = createThreadContentSearch({
      listApis: async () => Promise.reject(new Error('no registry')),
      callFinder: async () => undefined,
      native: async () => [{ sessionId: 'native-1', snippet: 'from DSH' }],
    })
    expect(await source('baseline', signal)).toEqual([{ sessionId: 'native-1', snippet: 'from DSH' }])
  })
})
