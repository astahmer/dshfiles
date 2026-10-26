import { errorMessage } from '@dshfiles/plugin-ui/query'
import { Alert, AlertDescription } from '@dshfiles/plugin-ui/components/ui/alert'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@dshfiles/plugin-ui/components/ui/dialog'
import { revalidateLogic, useAppForm } from '@dshfiles/plugin-ui/form'
import { useState } from 'react'
import { z } from 'zod'
import {
  alertComparatorSchema,
  alertKindSchema,
  alertRuleDraftSchema,
  alertSeveritySchema,
  type AlertKind,
  type AlertRule,
  type AlertRuleDraft,
} from './alert-types.js'
import type { TracesAlertsKey, TracesAlertsTranslate } from './alerts-locale.js'

const percentileValues = ['50', '90', '95', '99'] as const

/** `key=value` (or `key=*`) from the attribute field; empty is no attribute filter, anything else is invalid. */
const parseAttribute = (text: string): AlertRuleDraft['filter']['attribute'] | undefined => {
  const trimmed = text.trim()
  if (trimmed === '') return null
  const separator = trimmed.indexOf('=')
  if (separator <= 0) return undefined
  const key = trimmed.slice(0, separator).trim()
  return /^[\w.:/-]{1,128}$/.test(key) ? { key, value: trimmed.slice(separator + 1).trim() } : undefined
}

const ruleFormSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    kind: alertKindSchema,
    service: z.string().max(256),
    operation: z.string().max(256),
    attribute: z
      .string()
      .max(640)
      .refine(text => parseAttribute(text) !== undefined, 'Use key=value, or key=* for any value.'),
    windowMinutes: z
      .string()
      .regex(/^\d+$/, 'Whole minutes.')
      .refine(text => Number(text) >= 1 && Number(text) <= 1_440, 'Use 1 to 1,440 minutes.'),
    threshold: z.string().refine(text => text.trim() !== '' && Number.isFinite(Number(text)) && Number(text) >= 0, 'A number of at least 0.'),
    comparator: alertComparatorSchema,
    percentile: z.enum(percentileValues),
    minSamples: z
      .string()
      .regex(/^\d+$/, 'A whole number.')
      .refine(text => Number(text) >= 1, 'At least 1.'),
    severity: alertSeveritySchema,
    enabled: z.boolean(),
    notify: z.boolean(),
    markThreads: z.boolean(),
  })
  .superRefine((value, context) => {
    if (value.kind === 'error-rate' && Number(value.threshold) > 1)
      context.addIssue({ code: 'custom', path: ['threshold'], message: 'An error rate is a share from 0 to 1.' })
  })

type RuleFormValues = z.infer<typeof ruleFormSchema>

const PERCENTILE_OF = { '50': 50, '90': 90, '95': 95, '99': 99 } satisfies Record<RuleFormValues['percentile'], AlertRuleDraft['percentile']>

const percentileOf = (text: RuleFormValues['percentile']): AlertRuleDraft['percentile'] => PERCENTILE_OF[text]

const toDraft = (values: RuleFormValues, id: string | undefined): AlertRuleDraft => {
  const draft = alertRuleDraftSchema.parse({
    name: values.name.trim(),
    kind: values.kind,
    filter: {
      service: values.service.trim() === '' ? null : values.service.trim(),
      operation: values.operation.trim() === '' ? null : values.operation.trim(),
      attribute: parseAttribute(values.attribute) ?? null,
    },
    windowMinutes: Number(values.windowMinutes),
    threshold: Number(values.threshold),
    comparator: values.kind === 'duration' ? 'above' : values.comparator,
    percentile: percentileOf(values.percentile),
    minSamples: Number(values.minSamples),
    severity: values.severity,
    enabled: values.enabled,
    notify: values.notify,
    markThreads: values.markThreads,
  })
  if (id !== undefined) draft.id = id
  return draft
}

const valuesOf = (rule: AlertRule | null): RuleFormValues => ({
  name: rule?.name ?? '',
  kind: rule?.kind ?? 'error-rate',
  service: rule?.filter.service ?? '',
  operation: rule?.filter.operation ?? '',
  attribute: rule?.filter.attribute === null || rule === null ? '' : `${rule.filter.attribute.key}=${rule.filter.attribute.value}`,
  windowMinutes: String(rule?.windowMinutes ?? 10),
  threshold: String(rule?.threshold ?? 0.2),
  comparator: rule?.comparator ?? 'above',
  percentile: rule === null ? '95' : (percentileValues.find(value => value === String(rule.percentile)) ?? '95'),
  minSamples: String(rule?.minSamples ?? 5),
  severity: rule?.severity ?? 'warning',
  enabled: rule?.enabled ?? true,
  notify: rule?.notify ?? true,
  markThreads: rule?.markThreads ?? false,
})

const KIND_LABELS = {
  'error-rate': 'kindErrorRate',
  latency: 'kindLatency',
  throughput: 'kindThroughput',
  'span-count': 'kindSpanCount',
  duration: 'kindDuration',
} satisfies Record<AlertKind, TracesAlertsKey>

const THRESHOLD_HINTS = {
  'error-rate': 'thresholdErrorRate',
  latency: 'thresholdMs',
  throughput: 'thresholdThroughput',
  'span-count': 'thresholdCount',
  duration: 'thresholdMs',
} satisfies Record<AlertKind, TracesAlertsKey>

export class AlertRuleLabels {
  static readonly kind = (kind: AlertKind, t: TracesAlertsTranslate): string => t(KIND_LABELS[kind])
}

/** Create or edit one rule; `rule` null opens an empty form with conservative defaults. */
export const AlertRuleDialog = (props: {
  readonly open: boolean
  readonly rule: AlertRule | null
  readonly onOpenChange: (open: boolean) => void
  readonly onSave: (draft: AlertRuleDraft) => Promise<AlertRule>
  readonly t: TracesAlertsTranslate
}): JSX.Element => {
  const t = props.t
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="dshx-root dshx:max-h-[90vh] dshx:overflow-y-auto dshx:sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{props.rule === null ? t('createRuleTitle') : t('editRuleTitle')}</DialogTitle>
          <DialogDescription>{t('ruleFormDescription')}</DialogDescription>
        </DialogHeader>
        {props.open ? <AlertRuleForm key={props.rule?.id ?? 'new'} {...props} /> : null}
      </DialogContent>
    </Dialog>
  )
}

const AlertRuleForm = (props: {
  readonly rule: AlertRule | null
  readonly onOpenChange: (open: boolean) => void
  readonly onSave: (draft: AlertRuleDraft) => Promise<AlertRule>
  readonly t: TracesAlertsTranslate
}): JSX.Element => {
  const t = props.t
  const [saveError, setSaveError] = useState<string | null>(null)
  const form = useAppForm({
    defaultValues: valuesOf(props.rule),
    validationLogic: revalidateLogic(),
    validators: { onDynamic: ruleFormSchema },
    onSubmit: async ({ value }) => {
      setSaveError(null)
      try {
        await props.onSave(toDraft(value, props.rule?.id))
        props.onOpenChange(false)
      } catch (error) {
        setSaveError(errorMessage(error, t('saveFailed')))
      }
    },
  })
  return (
    <form
      className="dshx:flex dshx:flex-col dshx:gap-4"
      aria-label={props.rule === null ? t('createRuleTitle') : t('editRuleTitle')}
      onSubmit={event => {
        event.preventDefault()
        void form.handleSubmit()
      }}
    >
      <form.AppField name="name">{field => <field.TextField label={t('ruleName')} required />}</form.AppField>
      <div className="dshx:grid dshx:grid-cols-2 dshx:gap-3 dshx:@max-pane-narrow:grid-cols-1">
        <form.AppField name="kind">
          {field => (
            <field.SelectField label={t('kind')} options={alertKindSchema.options.map(kind => ({ value: kind, label: AlertRuleLabels.kind(kind, t) }))} />
          )}
        </form.AppField>
        <form.AppField name="severity">
          {field => (
            <field.SelectField
              label={t('severity')}
              options={[
                { value: 'info', label: t('severityInfo') },
                { value: 'warning', label: t('severityWarning') },
                { value: 'critical', label: t('severityCritical') },
              ]}
            />
          )}
        </form.AppField>
      </div>
      <form.AppField name="operation">
        {field => <field.TextField label={t('filterOperation')} description={t('filterOperationHint')} monospace />}
      </form.AppField>
      <div className="dshx:grid dshx:grid-cols-2 dshx:gap-3 dshx:@max-pane-narrow:grid-cols-1">
        <form.AppField name="service">{field => <field.TextField label={t('filterService')} description={t('filterServiceHint')} monospace />}</form.AppField>
        <form.AppField name="attribute">
          {field => <field.TextField label={t('filterAttribute')} description={t('filterAttributeHint')} placeholder="key=value" monospace />}
        </form.AppField>
      </div>
      <form.Subscribe selector={state => state.values.kind}>
        {kind => (
          <div className="dshx:grid dshx:grid-cols-2 dshx:gap-3 dshx:@max-pane-narrow:grid-cols-1">
            <form.AppField name="threshold">
              {field => <field.TextField label={t('threshold')} description={t(THRESHOLD_HINTS[kind])} type="number" required />}
            </form.AppField>
            <form.AppField name="windowMinutes">{field => <field.TextField label={t('windowMinutes')} type="number" required />}</form.AppField>
            {kind === 'duration' ? null : (
              <form.AppField name="comparator">
                {field => (
                  <field.SelectField
                    label={t('comparator')}
                    options={[
                      { value: 'above', label: t('above') },
                      { value: 'below', label: t('below') },
                    ]}
                  />
                )}
              </form.AppField>
            )}
            {kind === 'latency' ? (
              <form.AppField name="percentile">
                {field => <field.SelectField label={t('percentile')} options={percentileValues.map(value => ({ value, label: `p${value}` }))} />}
              </form.AppField>
            ) : null}
            {kind === 'error-rate' || kind === 'latency' ? (
              <form.AppField name="minSamples">
                {field => <field.TextField label={t('minSamples')} description={t('minSamplesHint')} type="number" required />}
              </form.AppField>
            ) : null}
          </div>
        )}
      </form.Subscribe>
      <div className="dshx:flex dshx:flex-col dshx:gap-3">
        <form.AppField name="enabled">{field => <field.SwitchField label={t('enabled')} />}</form.AppField>
        <form.AppField name="notify">{field => <field.SwitchField label={t('notify')} description={t('notifyHint')} />}</form.AppField>
        <form.AppField name="markThreads">{field => <field.SwitchField label={t('markThreads')} description={t('markThreadsHint')} />}</form.AppField>
      </div>
      {saveError === null ? null : (
        <Alert variant="destructive">
          <AlertDescription>{saveError}</AlertDescription>
        </Alert>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => props.onOpenChange(false)}>
          {t('cancel')}
        </Button>
        <form.AppForm>
          <form.SubmitButton>{t('saveRule')}</form.SubmitButton>
        </form.AppForm>
      </DialogFooter>
    </form>
  )
}
