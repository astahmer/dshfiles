import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { DeepSeekOnboardingDialog } from '../src/native/DeepSeekOnboardingDialog.tsx'
import { ModelsSection } from '../src/native/ModelsSection.tsx'
import { WelcomeNotice } from '../src/native/WelcomeNotice.tsx'
import { bootModelsRow } from './fixture.ts'

// Registration tests render no platform-module UI; the scratch journey drives the native components.
vi.mock('../src/native/ModelsSection.tsx', () => ({ ModelsSection: () => null }))
vi.mock('../src/native/DeepSeekOnboardingDialog.tsx', () => ({ DeepSeekOnboardingDialog: () => null }))
vi.mock('../src/native/WelcomeNotice.tsx', () => ({ WelcomeNotice: () => null }))

const contexts: Context[] = []
afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

describe('whole native Loader row', () => {
  it('registers the Models section and both onboarding steps', async () => {
    const row = await bootModelsRow()
    contexts.push(row.ctx)
    expect(row.entries.get('settings.section:models')?.component).toBe(ModelsSection)
    expect(row.entries.get('settings.onboarding:deepseek-official')?.component).toBe(DeepSeekOnboardingDialog)
    expect(row.entries.get('settings.onboarding:welcome-notice')?.component).toBe(WelcomeNotice)
  })

  it('reads nothing until a surface loads the page', async () => {
    const row = await bootModelsRow()
    contexts.push(row.ctx)
    row.emit('settings/document-updated', 'llm-deepseek')
    expect(row.listProviders).not.toHaveBeenCalled()
  })
})
