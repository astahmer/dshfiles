import type { Page } from '@playwright/test'
import { startFakeCommandCode as startFakeServer, type FakeCommandCode } from '../../packages/dshx/src/scratch/fake-command-code.js'

export type { FakeChatRequest, FakeCommandCode } from '../../packages/dshx/src/scratch/fake-command-code.js'

const fakes = new WeakMap<Page, FakeCommandCode>()

export const startFakeCommandCode = async (page: Page): Promise<FakeCommandCode> => {
  const fake = await startFakeServer()
  fakes.set(page, fake)
  return fake
}

export const fakeCommandCodeFor = (page: Page): FakeCommandCode => {
  const fake = fakes.get(page)
  if (fake === undefined) throw new Error('The fake Command Code server was not started for this scenario.')
  return fake
}

export const stopFakeCommandCode = async (page: Page): Promise<void> => {
  const fake = fakes.get(page)
  if (fake === undefined) return
  fakes.delete(page)
  await fake.close()
}
