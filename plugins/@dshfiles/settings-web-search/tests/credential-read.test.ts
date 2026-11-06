import type { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bootWebSearchRow } from './fixture.ts'

vi.mock('../src/native/WebSearchCard.tsx', () => ({ WebSearchCard: () => null }))
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => import('./form-model-stub.ts'))

const contexts: Context[] = []
beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

const booted = async () => {
  const row = await bootWebSearchRow()
  contexts.push(row.ctx)
  return row
}

/** One settings describe republishes every scope the page reads. */
const describeSettings = (sections: Awaited<ReturnType<typeof bootWebSearchRow>>['sections']): void => {
  for (const section of Object.values(sections)) section.publish()
}

describe('Web search credential reads', () => {
  it('reads nothing at boot or on settings changes until the page shows', async () => {
    const row = await booted()
    describeSettings(row.sections)
    describeSettings(row.sections)
    await vi.advanceTimersByTimeAsync(200)
    expect(row.describeCredentials).not.toHaveBeenCalled()
  })

  it('reads the credential once when the page shows', async () => {
    const row = await booted()
    const card = row.card()
    card.subscribe(() => undefined)
    await vi.advanceTimersByTimeAsync(10)
    expect(row.describeCredentials).toHaveBeenCalledTimes(1)
    expect(card.getSnapshot().apiKeyConfigured).toBe(true)
  })

  it('reads once for a settings describe that republishes all three scopes', async () => {
    const row = await booted()
    row.card().subscribe(() => undefined)
    await vi.advanceTimersByTimeAsync(10)
    describeSettings(row.sections)
    await vi.advanceTimersByTimeAsync(60)
    expect(row.describeCredentials).toHaveBeenCalledTimes(2)
  })

  it('waits while hidden and reads once when shown again', async () => {
    const row = await booted()
    const hide = row.card().subscribe(() => undefined)
    await vi.advanceTimersByTimeAsync(10)
    hide()
    describeSettings(row.sections)
    row.emit('credentials/reference-updated', 'DEEPSEEK_API_KEY')
    await vi.advanceTimersByTimeAsync(200)
    expect(row.describeCredentials).toHaveBeenCalledTimes(1)
    row.card().subscribe(() => undefined)
    await vi.advanceTimersByTimeAsync(10)
    expect(row.describeCredentials).toHaveBeenCalledTimes(2)
  })
})
