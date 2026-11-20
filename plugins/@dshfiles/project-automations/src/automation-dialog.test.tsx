// @vitest-environment jsdom

import { PluginQueryProvider, QueryClient } from '@dshfiles/plugin-ui/query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AutomationView } from './automations-api.js'
import { AutomationDialog } from './automation-dialog.js'
import { AutomationFormModel, type AutomationForm, type CheckoutDestination } from './automation-form.js'

afterEach(cleanup)

// jsdom has no ResizeObserver; Radix measures popovers and toggle groups with it.
globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
// jsdom has no scrollIntoView; cmdk scrolls the active option into view.
Element.prototype.scrollIntoView ??= function scrollIntoView(): void {}

const projects = [{ projectId: 'project-1', title: 'sample', path: '/tmp/sample' }]

const repository: CheckoutDestination = { vcs: 'jj', mainBookmark: 'main', bookmarks: ['main', 'feature'], remoteBookmarks: ['feature@origin'] }

const renderDialog = (
  initial: AutomationForm = AutomationFormModel.empty({ projectId: 'project-1', timeZone: 'Europe/Paris' }),
  loadDestination?: (projectId: string) => Promise<CheckoutDestination | null>,
) => {
  const onSubmit = vi.fn<(form: AutomationForm) => void>()
  render(
    <PluginQueryProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AutomationDialog
        open
        editing={false}
        initial={initial}
        projects={projects}
        threads={[{ sessionId: 'session-target', title: 'Daily digest' }]}
        loadDestination={loadDestination}
        pending={false}
        error={null}
        onOpenChange={() => undefined}
        onSubmit={onSubmit}
      />
    </PluginQueryProvider>,
  )
  return { onSubmit }
}

const submitted = async (onSubmit: ReturnType<typeof renderDialog>['onSubmit']) => {
  fireEvent.click(screen.getByRole('button', { name: 'Create automation' }))
  await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
  const form = onSubmit.mock.calls[0]?.[0]
  if (form === undefined) throw new Error('the dialog submitted no form')
  return AutomationFormModel.toDraft(form, undefined)
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
      destination: { kind: 'new-thread' },
      trigger: { kind: 'schedule', timing: { kind: 'daily', time: '09:00', timeZone: 'Europe/Paris' } },
    })
  })

  it('shows the saved workspace choice of a new thread and submits it unchanged', async () => {
    const loadDestination = vi.fn((_projectId: string) => Promise.resolve(repository))
    const { onSubmit } = renderDialog(
      { ...AutomationFormModel.empty({ projectId: 'project-1', timeZone: 'UTC' }), title: 'T', prompt: 'P', checkout: 'own:feature@origin' },
      loadDestination,
    )
    const picker = await screen.findByRole('combobox', { name: 'Thread workspace' })
    await waitFor(() => expect(picker.textContent).toContain('feature@origin'))
    expect(loadDestination).toHaveBeenCalledWith('project-1')
    expect((await submitted(onSubmit)).destination).toEqual({ kind: 'new-thread', isolate: true, base: 'feature@origin' })
  })

  it('picks a new workspace from a bookmark in the workspace picker', async () => {
    const { onSubmit } = renderDialog({ ...AutomationFormModel.empty({ projectId: 'project-1', timeZone: 'UTC' }), title: 'T', prompt: 'P' }, () =>
      Promise.resolve(repository),
    )
    const picker = await screen.findByRole('combobox', { name: 'Thread workspace' })
    await waitFor(() => expect(picker.textContent).toContain('Project checkout'))
    fireEvent.click(picker)
    fireEvent.click(await screen.findByRole('option', { name: /^feature\s*New workspace$/u }))
    await waitFor(() => expect(picker.textContent).toContain('feature'))
    expect((await submitted(onSubmit)).destination).toEqual({ kind: 'new-thread', isolate: true, base: 'feature' })
  })

  it('hides the workspace picker for a project outside a repository and runs in the checkout', async () => {
    const loadDestination = vi.fn((_projectId: string) => Promise.resolve(null))
    const { onSubmit } = renderDialog({ ...AutomationFormModel.empty({ projectId: 'project-1', timeZone: 'UTC' }), title: 'T', prompt: 'P' }, loadDestination)
    await waitFor(() => expect(loadDestination).toHaveBeenCalled())
    await waitFor(() => expect(screen.queryByRole('combobox', { name: 'Thread workspace' })).toBeNull())
    expect((await submitted(onSubmit)).destination).toEqual({ kind: 'new-thread' })
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

  it('keeps a new thread’s workspace choice across the draft and back, and lists the New thread row’s choices', () => {
    const base = { ...AutomationFormModel.empty({ projectId: 'p', timeZone: 'UTC' }), title: 'T', prompt: 'P' }
    expect(base.checkout).toBe('in-place')
    expect(AutomationFormModel.toDraft(base, undefined).destination).toEqual({ kind: 'new-thread' })
    expect(AutomationFormModel.toDraft({ ...base, checkout: 'own' }, undefined).destination).toEqual({ kind: 'new-thread', isolate: true })
    expect(AutomationFormModel.toDraft({ ...base, checkout: 'own:feature' }, undefined).destination).toEqual({
      kind: 'new-thread',
      isolate: true,
      base: 'feature',
    })
    // A thread posting into an existing one has no workspace of its own to choose.
    expect(AutomationFormModel.toDraft({ ...base, checkout: 'own:feature', destinationKind: 'existing-thread', sessionId: 's' }, undefined).destination).toEqual({
      kind: 'existing-thread',
      sessionId: 's',
    })

    const view: AutomationView = {
      id: 'auto_abcdefgh',
      title: 'T',
      enabled: true,
      projectId: 'p',
      prompt: 'P',
      trigger: { kind: 'schedule', timing: { kind: 'every', everySeconds: 3600 }, nextRunAt: null },
      destination: { kind: 'new-thread', isolate: true, base: 'feature@origin' },
      createdAt: 0,
      updatedAt: 0,
      projectTitle: 'p',
      schedule: null,
      webhookPath: null,
      webhookUrl: null,
      lastRun: null,
    }
    expect(AutomationFormModel.of(view, 'UTC').checkout).toBe('own:feature@origin')
    expect(AutomationFormModel.of({ ...view, destination: { kind: 'new-thread', isolate: true } }, 'UTC').checkout).toBe('own')
    const { destination: _, ...legacy } = view
    expect(AutomationFormModel.of(legacy, 'UTC').checkout).toBe('in-place')

    expect(AutomationFormModel.checkoutOptions(repository, 'in-place').map(option => option.value)).toEqual([
      'in-place',
      'own',
      'own:feature',
      'own:feature@origin',
    ])
    // A saved bookmark the repository no longer lists stays selectable, so editing keeps it until the user changes it.
    expect(AutomationFormModel.checkoutOptions(repository, 'own:gone').at(-1)).toMatchObject({ value: 'own:gone', label: 'gone' })
  })
})
