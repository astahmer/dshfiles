import type { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WebSearchCard } from '../src/native/WebSearchCard.tsx'
import { bootWebSearchRow } from './fixture.ts'

// Registration tests render no platform-module UI; the scratch journey drives the native card.
vi.mock('../src/native/WebSearchCard.tsx', () => ({ WebSearchCard: () => null }))
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => import('./form-model-stub.ts'))

const contexts: Context[] = []
afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

describe('whole native Loader row', () => {
  it('registers the Web search plugin page', async () => {
    const row = await bootWebSearchRow()
    contexts.push(row.ctx)
    expect(row.entries.get('plugins.item:web-search')?.component).toBe(WebSearchCard)
  })
})
