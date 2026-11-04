// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AutomationDialog } from './automation-dialog.js'
import { AutomationFormModel, type AutomationForm } from './automation-form.js'

afterEach(cleanup)

// jsdom has no ResizeObserver; Radix measures popovers and toggle groups with it.
globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

const projects = [{ projectId: 'project-1', title: 'sample', path: '/tmp/sample' }]

const renderDialog = (initial: AutomationForm = AutomationFormModel.empty({ projectId: 'project-1', timeZone: 'Europe/Paris' })) => {
  const onSubmit = vi.fn<(form: AutomationForm) => void>()
  render(
    <AutomationDialog
      open
      editing={false}
      initial={initial}
      projects={projects}
      pending={false}
      error={null}
      onOpenChange={() => undefined}
      onSubmit={onSubmit}
    />,
  )
  return { onSubmit }
}

describe('automation dialog', () => {
  it('renders the schedule form and submits a daily automation', async () => {
    const { onSubmit } = renderDialog()
    const dialog = await screen.findByRole('dialog', { name: 'New automation' })
    expect(dialog).toBeTruthy()
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Morning triage' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Prompt' }), { target: { value: 'Triage new issues.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create automation' }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    const form = onSubmit.mock.calls[0]?.[0]
    if (form === undefined) throw new Error('the dialog submitted no form')
    expect(AutomationFormModel.toDraft(form, undefined)).toEqual({
      title: 'Morning triage',
      projectId: 'project-1',
      prompt: 'Triage new issues.',
      enabled: true,
      trigger: { kind: 'schedule', timing: { kind: 'daily', time: '09:00', timeZone: 'Europe/Paris' } },
    })
  })

  it('refuses a webhook without a secret reference and says how to fix it', async () => {
    const { onSubmit } = renderDialog({
      ...AutomationFormModel.empty({ projectId: 'project-1', timeZone: 'UTC' }),
      title: 'CI',
      prompt: 'p',
      triggerKind: 'webhook',
    })
    expect(await screen.findByRole('textbox', { name: 'Signing secret' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Create automation' }))
    expect((await screen.findByRole('alert')).textContent).toContain('secret:ALIAS')
    expect(onSubmit).not.toHaveBeenCalled()
  })
})

describe('automation form model', () => {
  it('turns a weekly, cron, every and webhook form into the API draft and back', () => {
    const base = { ...AutomationFormModel.empty({ projectId: 'p', timeZone: 'UTC' }), title: ' T ', prompt: ' P ' }
    expect(AutomationFormModel.toDraft({ ...base, timingKind: 'weekly', weekdays: ['5', '1'] }, 'auto_abcdefgh').trigger).toEqual({
      kind: 'schedule',
      timing: { kind: 'weekly', time: '09:00', timeZone: 'UTC', weekdays: [1, 5] },
    })
    expect(AutomationFormModel.toDraft({ ...base, timingKind: 'cron', cron: ' 0  9 * * 1-5 ' }, undefined).trigger).toEqual({
      kind: 'schedule',
      timing: { kind: 'cron', expression: '0 9 * * 1-5', timeZone: 'UTC' },
    })
    expect(AutomationFormModel.toDraft({ ...base, timingKind: 'every', everyMinutes: '15' }, undefined).trigger).toEqual({
      kind: 'schedule',
      timing: { kind: 'every', everySeconds: 900 },
    })
    const webhook = AutomationFormModel.toDraft(
      { ...base, triggerKind: 'webhook', secretRef: ' secret:HOOK ', ratePerMinute: '500', provider: 'p', model: 'm' },
      undefined,
    )
    expect(webhook).toMatchObject({
      title: 'T',
      prompt: 'P',
      model: { provider: 'p', model: 'm' },
      trigger: { kind: 'webhook', secretRef: 'secret:HOOK', ratePerMinute: 120 },
    })
    expect(AutomationFormModel.curlExample('http://h/automations/webhook/auto_x')).toContain('x-dsh-signature: sha256=$sig')
  })
})
