import type { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bootModelsRow } from './fixture.ts'

vi.mock('../src/native/ModelsSection.tsx', () => ({ ModelsSection: () => null }))
vi.mock('../src/native/DeepSeekOnboardingDialog.tsx', () => ({ DeepSeekOnboardingDialog: () => null }))
vi.mock('../src/native/WelcomeNotice.tsx', () => ({ WelcomeNotice: () => null }))

const contexts: Context[] = []
beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

/** Boot the row and load the page from a surface that keeps showing it, as the Models section does. */
const shownPage = async () => {
  const row = await bootModelsRow()
  contexts.push(row.ctx)
  const face = row.modelsFace()
  const hide = face.hooks.snapshot!.subscribe(() => undefined)
  const loaded = face.controller.load()
  await vi.advanceTimersByTimeAsync(10)
  await loaded
  return { ...row, face, hide }
}

const hostWrite = (emit: (event: string, payload?: string) => void): void => {
  emit('settings/document-updated', 'llm-deepseek')
  emit('settings/document-updated', 'llm-deepseek')
  emit('credentials/reference-updated', 'DEEPSEEK_API_KEY')
  emit('credentials/record-updated', 'DEEPSEEK_API_KEY')
}

describe('Models store refresh', () => {
  it('re-reads the provider directory once for a burst of Host change events', async () => {
    const page = await shownPage()
    expect(page.listProviders).toHaveBeenCalledTimes(1)
    hostWrite(page.emit)
    await vi.advanceTimersByTimeAsync(60)
    expect(page.listProviders).toHaveBeenCalledTimes(2)
    expect(page.listConfigurableProviders).toHaveBeenCalledTimes(2)
  })

  it('re-reads once for one write whose events arrive spread over more than one window', async () => {
    const page = await shownPage()
    for (let event = 0; event < 4; event += 1) {
      page.emit('settings/document-updated', 'llm-deepseek')
      await vi.advanceTimersByTimeAsync(40)
    }
    await vi.advanceTimersByTimeAsync(60)
    expect(page.listProviders).toHaveBeenCalledTimes(2)
  })

  it('reads nothing while no surface shows the page, then once when one shows it again', async () => {
    const page = await shownPage()
    page.hide()
    hostWrite(page.emit)
    page.emit('llm/adapters-updated')
    await vi.advanceTimersByTimeAsync(200)
    expect(page.listProviders).toHaveBeenCalledTimes(1)

    page.face.hooks.snapshot!.subscribe(() => undefined)
    await vi.advanceTimersByTimeAsync(60)
    expect(page.listProviders).toHaveBeenCalledTimes(2)
  })

  it('ignores settings changes outside every provider namespace', async () => {
    const page = await shownPage()
    page.emit('settings/document-updated', 'thread-sidebar')
    page.emit('settings/document-updated', 'agent-preset-registry')
    await vi.advanceTimersByTimeAsync(60)
    expect(page.listProviders).toHaveBeenCalledTimes(1)
  })

  it('does not mark an unloaded page stale, so its first load is its only read', async () => {
    const row = await bootModelsRow()
    contexts.push(row.ctx)
    row.emit('llm/adapters-updated')
    await vi.advanceTimersByTimeAsync(60)
    const face = row.modelsFace()
    face.hooks.snapshot!.subscribe(() => undefined)
    void face.controller.load()
    await vi.advanceTimersByTimeAsync(60)
    expect(row.listProviders).toHaveBeenCalledTimes(1)
  })

  it('does not reload when a surface shows a page that saw no change', async () => {
    const page = await shownPage()
    page.hide()
    page.face.hooks.snapshot!.subscribe(() => undefined)
    await vi.advanceTimersByTimeAsync(60)
    expect(page.listProviders).toHaveBeenCalledTimes(1)
  })
})
