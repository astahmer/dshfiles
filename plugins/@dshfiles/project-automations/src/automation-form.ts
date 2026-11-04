import type { AutomationDraft, AutomationView } from './automations-api.js'
import type { Timing } from './schedule.js'

export type TriggerKind = 'schedule' | 'webhook'
export type TimingKind = 'cron' | 'daily' | 'weekly' | 'every'

/** The dialog's flat draft: every field is text the user edits; `toDraft` builds the API input from it. */
export interface AutomationForm {
  readonly title: string
  readonly projectId: string
  readonly prompt: string
  readonly agentPreset: string
  readonly provider: string
  readonly model: string
  readonly enabled: boolean
  readonly triggerKind: TriggerKind
  readonly timingKind: TimingKind
  readonly cron: string
  readonly time: string
  readonly weekdays: readonly string[]
  readonly everyMinutes: string
  readonly timeZone: string
  readonly secretRef: string
  readonly ratePerMinute: string
}

/**
 * The first thing to fix in the form, as one sentence the dialog shows; undefined when it can be sent. The Host checks
 * the schedule again (zone, cron fields, DST) and answers with its own message.
 */
export const automationFormProblem = (form: AutomationForm): string | undefined => {
  if (form.title.trim() === '') return 'Give the automation a name.'
  if (form.projectId === '') return 'Choose the project its threads start in.'
  if (form.prompt.trim() === '') return 'Write the prompt each thread starts with.'
  if ((form.provider.trim() === '') !== (form.model.trim() === '')) return 'Give both a provider and a model, or neither to use the default model.'
  if (form.triggerKind === 'webhook') {
    if (!/^secret:[A-Za-z_][A-Za-z0-9_-]*(?:@[A-Za-z0-9_-]+)?$/u.test(form.secretRef.trim()))
      return 'Pick the webhook signing secret from the vault: it must read secret:ALIAS.'
    return undefined
  }
  if (form.timingKind !== 'every' && form.timeZone.trim() === '') return 'A time zone is required, such as Europe/Paris or UTC.'
  if (form.timingKind === 'cron' && form.cron.trim().split(/\s+/u).length !== 5)
    return 'A cron expression has five fields: minute hour day-of-month month day-of-week.'
  if ((form.timingKind === 'daily' || form.timingKind === 'weekly') && !/^\d{2}:\d{2}$/u.test(form.time.trim())) return 'Give the time as HH:mm, such as 09:00.'
  if (form.timingKind === 'weekly' && form.weekdays.length === 0) return 'Pick at least one weekday.'
  if (form.timingKind === 'every' && !(Number(form.everyMinutes) >= 1)) return 'Run at most once a minute: give 1 or more minutes.'
  return undefined
}

export const browserTimeZone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    return 'UTC'
  }
}

export class AutomationFormModel {
  static empty(input: { readonly projectId: string; readonly timeZone: string }): AutomationForm {
    return {
      title: '',
      projectId: input.projectId,
      prompt: '',
      agentPreset: '',
      provider: '',
      model: '',
      enabled: true,
      triggerKind: 'schedule',
      timingKind: 'daily',
      cron: '0 9 * * 1-5',
      time: '09:00',
      weekdays: ['1', '2', '3', '4', '5'],
      everyMinutes: '60',
      timeZone: input.timeZone,
      secretRef: '',
      ratePerMinute: '10',
    }
  }

  /** The form for editing a saved automation: its own values over the defaults of an empty one. */
  static of(view: AutomationView, timeZone: string): AutomationForm {
    const base = AutomationFormModel.empty({ projectId: view.projectId, timeZone })
    const common = {
      ...base,
      title: view.title,
      prompt: view.prompt,
      agentPreset: view.agentPreset ?? '',
      provider: view.model?.provider ?? '',
      model: view.model?.model ?? '',
      enabled: view.enabled,
    }
    if (view.trigger.kind === 'webhook')
      return { ...common, triggerKind: 'webhook', secretRef: view.trigger.secretRef, ratePerMinute: String(view.trigger.ratePerMinute) }
    const timing = view.trigger.timing
    switch (timing.kind) {
      case 'cron':
        return { ...common, timingKind: 'cron', cron: timing.expression, timeZone: timing.timeZone }
      case 'daily':
        return { ...common, timingKind: 'daily', time: timing.time.slice(0, 5), timeZone: timing.timeZone }
      case 'weekly':
        return { ...common, timingKind: 'weekly', time: timing.time.slice(0, 5), timeZone: timing.timeZone, weekdays: timing.weekdays.map(String) }
      case 'every':
        return { ...common, timingKind: 'every', everyMinutes: String(Math.max(1, Math.round(timing.everySeconds / 60))) }
    }
  }

  static timing(form: AutomationForm): Timing {
    const timeZone = form.timeZone.trim()
    switch (form.timingKind) {
      case 'cron':
        return { kind: 'cron', expression: form.cron.trim().replace(/\s+/gu, ' '), timeZone }
      case 'daily':
        return { kind: 'daily', time: form.time.trim(), timeZone }
      case 'weekly':
        return { kind: 'weekly', time: form.time.trim(), timeZone, weekdays: form.weekdays.map(Number).toSorted((a, b) => a - b) }
      case 'every':
        return { kind: 'every', everySeconds: Math.round(Number(form.everyMinutes) * 60) }
    }
  }

  static toDraft(form: AutomationForm, id: string | undefined): AutomationDraft {
    const trigger: AutomationDraft['trigger'] =
      form.triggerKind === 'webhook'
        ? { kind: 'webhook', secretRef: form.secretRef.trim(), ratePerMinute: Math.min(120, Math.max(1, Math.round(Number(form.ratePerMinute) || 10))) }
        : { kind: 'schedule', timing: AutomationFormModel.timing(form) }
    let draft: AutomationDraft = { title: form.title.trim(), projectId: form.projectId, prompt: form.prompt.trim(), enabled: form.enabled, trigger }
    // Blank optional fields are left out, so the Host keeps its default agent preset and model.
    if (id !== undefined) draft = { ...draft, id }
    if (form.agentPreset.trim() !== '') draft = { ...draft, agentPreset: form.agentPreset.trim() }
    if (form.provider.trim() !== '' && form.model.trim() !== '') draft = { ...draft, model: { provider: form.provider.trim(), model: form.model.trim() } }
    return draft
  }

  /** A shell command that signs and sends a test request, so the user can check the webhook end to end. */
  static curlExample(url: string): string {
    return [
      `body='{"hello":"world"}'`,
      'ts=$(date +%s)',
      `sig=$(printf '%s.%s' "$ts" "$body" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" | sed 's/^.* //')`,
      `curl -X POST -H 'content-type: application/json' -H "x-dsh-timestamp: $ts" -H "x-dsh-signature: sha256=$sig" --data "$body" '${url}'`,
    ].join('\n')
  }
}
