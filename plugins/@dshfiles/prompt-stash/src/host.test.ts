import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import type { SavedDraft } from './draft-store.js'
import type { SavedPrompt } from './library.js'
import { draftMutationSchema, draftSnapshotSchema, promptStashMutationSchema, promptStashStateSchema } from './library-api.js'

/**
 * Wiring check for the Host half: the built bundle serves the shared prompt
 * library and draft stash through its API, over the storage-domain tables it
 * declares. The store unit test covers the record logic; this proves the
 * plugin opens the domain, registers the contract and writes rows.
 */

interface BuiltPlugin {
  readonly apply: (ctx: Context) => Promise<void> | void
}

const builtEntry = new URL('../dist/index.js', import.meta.url).href

interface FetchRoute {
  readonly path: string
  readonly methods: readonly string[]
  readonly requestBody: string
  readonly fetch: (request: Request) => Promise<Response>
}

interface DomainSpec {
  readonly name: string
  readonly version: number
  readonly tables: Record<string, { readonly valueSchema: z.ZodType }>
}

const serverResponseSchema = z.object({
  type: z.literal('server-response'),
  rpcId: z.string(),
  result: z.object({ ok: z.literal(true), value: z.object({ version: z.number(), output: z.unknown() }) }),
})

const prompt = (index: number): SavedPrompt => ({
  id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
  revision: `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
  title: `Prompt ${index}`,
  text: `Text ${index}`,
  updatedAt: 1_700_000_000_000 + index,
})

const draft = (): SavedDraft => ({
  id: '30000000-0000-4000-8000-000000000001',
  title: 'Planning prompt',
  text: 'Draft body to keep',
  createdAt: '2026-10-05T12:00:00.000Z',
  updatedAt: '2026-10-05T12:00:00.000Z',
})

const memoryTable = <Value extends { readonly id: string }>(rows: Map<string, Value>) => ({
  get: (key: string) => rows.get(key),
  entries: () => rows.entries(),
  keys: () => rows.keys(),
  get size() {
    return rows.size
  },
  put: async (key: string, value: Value) => {
    rows.set(key, value)
  },
  delete: async (key: string) => rows.delete(key),
  update: async (key: string, change: (current: Value) => Value) => {
    const current = rows.get(key)
    if (current === undefined) throw new Error('missing row')
    const next = change(current)
    rows.set(key, next)
    return next
  },
})

const startHarness = async () => {
  const plugin: BuiltPlugin = await import(builtEntry)
  const prompts = new Map<string, SavedPrompt>()
  const drafts = new Map<string, SavedDraft>()
  const routes = new Map<string, FetchRoute>()
  const disposers: (() => void)[] = []
  const opened: DomainSpec[] = []
  let closed = 0

  const connection = {
    fetch: {
      register: (route: FetchRoute) => {
        routes.set(route.path, route)
        return async () => {
          routes.delete(route.path)
        }
      },
    },
  }
  const storageDomain = {
    open: async (spec: DomainSpec) => {
      opened.push(spec)
      return {
        table: (name: string) => (name === 'prompts' ? memoryTable(prompts) : memoryTable(drafts)),
        close: async () => {
          closed += 1
        },
      }
    },
  }
  const tools = { register: () => () => undefined }
  const context = {
    on: () => undefined,
    once: () => undefined,
    emit: () => undefined,
    parallel: () => undefined,
    serial: () => undefined,
    bail: () => undefined,
    waterfall: () => undefined,
    effect: (callback: () => (() => void) | undefined) => {
      const disposer = callback()
      if (disposer !== undefined) disposers.push(disposer)
    },
    get: (name: string) => {
      switch (name) {
        case 'storageDomain':
          return storageDomain
        case 'connection':
          return connection
        case 'tools':
          return tools
        default:
          return undefined
      }
    },
    inject: () => undefined,
    settings: {
      configure: () => () => undefined,
      describe: () => [],
      update: async () => undefined,
      replace: async () => undefined,
    },
  }
  // SAFETY: the built Host bundle reads only the Cordis members this stub supplies.
  const asHostContext = (value: typeof context): Context => value as unknown as Context
  await plugin.apply(asHostContext(context))

  const call = async <Output>(request: { readonly method: string; readonly schema: z.ZodType<Output>; readonly input?: object }): Promise<Output> => {
    const route = [...routes.values()].find(candidate => candidate.path.endsWith(`/${request.method}`))
    if (route === undefined) throw new Error(`No route was registered for ${request.method}.`)
    const response = await route.fetch(
      new Request(`http://dsh.test${route.path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'client-request',
          rpcId: crypto.randomUUID(),
          method: route.path.split('/').slice(2).join('/'),
          payload: { version: 1, input: request.input },
        }),
      }),
    )
    expect(response.status).toBe(200)
    const parsed = serverResponseSchema.parse(await response.json())
    return request.schema.parse(parsed.result.value.output)
  }

  return {
    prompts,
    drafts,
    opened,
    call,
    closed: () => closed,
    disposeAll: async () => {
      for (const dispose of disposers.reverse()) await dispose()
    },
  }
}

describe('prompt-stash Host wiring', () => {
  it('opens the declared domain and serves the shared prompt library', async () => {
    const harness = await startHarness()

    expect(harness.opened).toHaveLength(1)
    expect(harness.opened[0]?.name).toBe('prompt_stash')
    expect(Object.keys(harness.opened[0]?.tables ?? {}).sort()).toEqual(['drafts', 'prompts'])
    expect((await harness.call({ method: 'state', schema: promptStashStateSchema })).prompts).toEqual([])

    const saved = await harness.call({
      method: 'save',
      input: { prompt: prompt(1), expectedRevision: null },
      schema: promptStashMutationSchema,
    })
    expect(saved.kind).toBe('applied')
    expect(harness.prompts.has(prompt(1).id)).toBe(true)

    const state = await harness.call({ method: 'state', schema: promptStashStateSchema })
    expect(state.prompts.map(item => item.id)).toEqual([prompt(1).id])

    await harness.disposeAll()
    expect(harness.closed()).toBe(1)
  })

  it('rejects a stale prompt write and removes a stored prompt', async () => {
    const harness = await startHarness()
    await harness.call({ method: 'save', input: { prompt: prompt(1), expectedRevision: null }, schema: promptStashMutationSchema })

    const stale = await harness.call({
      method: 'save',
      input: { prompt: prompt(1), expectedRevision: '20000000-0000-4000-8000-000000000009' },
      schema: promptStashMutationSchema,
    })
    expect(stale.kind).toBe('conflict')
    expect(harness.prompts.get(prompt(1).id)?.revision).toBe(prompt(1).revision)

    const removed = await harness.call({
      method: 'remove',
      input: { id: prompt(1).id, expectedRevision: prompt(1).revision },
      schema: promptStashMutationSchema,
    })
    expect(removed.kind).toBe('applied')
    expect(harness.prompts.has(prompt(1).id)).toBe(false)
    await harness.disposeAll()
  })

  it('serves saved drafts through the same Host store', async () => {
    const harness = await startHarness()

    expect((await harness.call({ method: 'drafts', schema: draftSnapshotSchema })).drafts).toEqual([])

    const outcome = await harness.call({
      method: 'saveDraft',
      input: { draft: { id: draft().id, title: draft().title, text: draft().text, now: draft().createdAt } },
      schema: draftMutationSchema,
    })
    expect(outcome.kind).toBe('applied')
    expect(harness.drafts.get(draft().id)?.title).toBe(draft().title)

    const removed = await harness.call({ method: 'removeDraft', input: { id: draft().id }, schema: draftSnapshotSchema })
    expect(removed.drafts).toEqual([])
    await harness.disposeAll()
  })
})
