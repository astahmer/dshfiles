import assert from 'node:assert/strict'
import { test } from 'vitest'
import type { SavedPrompt } from './library.js'
import { PromptStashModel } from './store.js'

const prompt = (index: number, updatedAt = index): SavedPrompt => ({
  id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
  revision: `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
  title: `Prompt ${index}`,
  text: `Text ${index}`,
  updatedAt,
})

const memoryTable = <Value extends { readonly id: string }>(initial: readonly Value[] = []) => {
  const rows = new Map<string, Value>(initial.map(value => [value.id, value]))
  return {
    rows,
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
  }
}

const emptyStore = (now: () => number) => {
  const prompts = memoryTable<SavedPrompt>()
  return { prompts, store: PromptStashModel.createStore({ prompts, now }) }
}

test('saves prompts durably, newest edit first, with a monotone revision', async () => {
  const { prompts, store } = emptyStore(() => 5_000)

  const first = await store.save({ prompt: prompt(1, 1_000), expectedRevision: null })
  assert.deepEqual(first, { kind: 'applied', revision: 5_001, prompts: [prompt(1, 1_000)] })

  const second = await store.save({ prompt: prompt(2, 2_000), expectedRevision: null })
  assert.equal(second.revision, 5_002)
  await store.flush()

  assert.deepEqual(
    store.snapshot().prompts.map(item => item.id),
    [prompt(2).id, prompt(1).id],
  )
  assert.deepEqual([...prompts.rows.keys()].sort(), [prompt(1).id, prompt(2).id])
})

test('refuses to overwrite a prompt another writer changed', async () => {
  const { prompts, store } = emptyStore(() => 6_000)
  await store.save({ prompt: prompt(1, 1_000), expectedRevision: null })

  const stale = await store.save({ prompt: prompt(1, 9_000), expectedRevision: '20000000-0000-4000-8000-000000000001' })
  assert.equal(stale.kind, 'conflict')
  assert.equal(stale.prompts[0]?.updatedAt, 1_000)
  assert.equal(prompts.rows.get(prompt(1).id)?.updatedAt, 1_000)

  const applied = await store.save({ prompt: prompt(1, 9_000), expectedRevision: prompt(1).revision })
  assert.equal(applied.kind, 'applied')
  await store.flush()
  assert.equal(prompts.rows.get(prompt(1).id)?.updatedAt, 9_000)
})

test('stops at the library limit instead of dropping a stored prompt', async () => {
  const { store } = emptyStore(() => 7_000)
  for (let index = 1; index <= 50; index += 1) {
    assert.equal((await store.save({ prompt: prompt(index), expectedRevision: null })).kind, 'applied')
  }

  const overLimit = await store.save({ prompt: prompt(51), expectedRevision: null })
  assert.equal(overLimit.kind, 'limit')
  assert.equal(overLimit.prompts.length, 50)
})

test('orders equally recent prompts by identity for a stable list', () => {
  assert.deepEqual(
    PromptStashModel.orderPrompts([prompt(2, 5), prompt(1, 5)]).map(item => item.id),
    [prompt(1).id, prompt(2).id],
  )
})
