import { Combobox } from '@dshfiles/plugin-ui/components/ui/combobox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@dshfiles/plugin-ui/components/ui/dialog'
import { Field, FieldDescription, FieldLabel } from '@dshfiles/plugin-ui/components/ui/field'
import { ToggleGroup, ToggleGroupItem } from '@dshfiles/plugin-ui/components/ui/toggle-group'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { revalidateLogic, useAppForm } from '@dshfiles/plugin-ui/form'
import { useId } from 'react'
import { automationFormProblem, type AutomationForm } from './automation-form.js'

export interface ProjectChoice {
  readonly projectId: string
  readonly title: string
  readonly path: string
}

const WEEKDAYS = [
  ['1', 'Mon'],
  ['2', 'Tue'],
  ['3', 'Wed'],
  ['4', 'Thu'],
  ['5', 'Fri'],
  ['6', 'Sat'],
  ['7', 'Sun'],
] as const

/**
 * Create or edit one automation. The Host validates the schedule (time zone, cron, DST) and the template again and
 * answers with what to fix; that message is shown under the form.
 */
export const AutomationDialog = (props: {
  readonly open: boolean
  readonly editing: boolean
  readonly initial: AutomationForm
  readonly projects: readonly ProjectChoice[]
  readonly pending: boolean
  readonly error: string | null
  readonly onOpenChange: (open: boolean) => void
  readonly onSubmit: (form: AutomationForm) => void
}): JSX.Element => {
  const projectLabel = useId()
  const weekdaysLabel = useId()
  const form = useAppForm({
    defaultValues: props.initial,
    validationLogic: revalidateLogic(),
    validators: { onDynamic: ({ value }) => automationFormProblem(value) },
    onSubmit: ({ value }) => props.onSubmit(value),
  })
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="dshx-root dshx:max-h-[90vh] dshx:overflow-y-auto dshx:sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{props.editing ? 'Edit automation' : 'New automation'}</DialogTitle>
          <DialogDescription>Each run starts a new thread in the project with this prompt.</DialogDescription>
        </DialogHeader>
        <form
          aria-label="Automation"
          className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-4"
          onSubmit={event => {
            event.preventDefault()
            void form.handleSubmit()
          }}
        >
          <form.AppField name="title">{field => <field.TextField label="Name" required />}</form.AppField>
          <form.Field name="projectId">
            {field => (
              <Field>
                <FieldLabel id={projectLabel}>Project</FieldLabel>
                <Combobox
                  label="Project"
                  matchTriggerWidth
                  value={field.state.value}
                  placeholder="Choose a project"
                  emptyLabel="No registered project. Open a folder in DSH first."
                  options={props.projects.map(project => ({
                    value: project.projectId,
                    label: project.title,
                    description: project.path,
                    keywords: [project.path],
                  }))}
                  onValueChange={value => field.handleChange(value)}
                />
              </Field>
            )}
          </form.Field>
          <form.AppField name="triggerKind">
            {field => (
              <field.SelectField
                label="Trigger"
                options={[
                  { value: 'schedule', label: 'Schedule' },
                  { value: 'webhook', label: 'Webhook' },
                ]}
              />
            )}
          </form.AppField>
          <form.Subscribe selector={state => [state.values.triggerKind, state.values.timingKind] as const}>
            {([triggerKind, timingKind]) =>
              triggerKind === 'webhook' ? (
                <>
                  <form.Field name="secretRef">
                    {field => (
                      <Field>
                        <FieldLabel htmlFor={`${field.name}-input`}>Signing secret</FieldLabel>
                        <input
                          id={`${field.name}-input`}
                          data-secret-input="reference"
                          className="dshx:h-9 dshx:w-full dshx:rounded-md dshx:border dshx:border-input dshx:bg-transparent dshx:px-3 dshx:font-mono! dshx:text-sm"
                          placeholder="secret:WEBHOOK_SECRET"
                          value={field.state.value}
                          onBlur={field.handleBlur}
                          onChange={event => field.handleChange(event.currentTarget.value)}
                        />
                        <FieldDescription>
                          A global Secret Catalog alias. DSH stores only this reference and reads the value on the Host for each request.
                        </FieldDescription>
                      </Field>
                    )}
                  </form.Field>
                  <form.AppField name="ratePerMinute">{field => <field.TextField label="Requests per minute" />}</form.AppField>
                </>
              ) : (
                <>
                  <form.AppField name="timingKind">
                    {field => (
                      <field.SelectField
                        label="Repeat"
                        options={[
                          { value: 'daily', label: 'Every day' },
                          { value: 'weekly', label: 'On weekdays' },
                          { value: 'cron', label: 'Cron expression' },
                          { value: 'every', label: 'Every few minutes' },
                        ]}
                      />
                    )}
                  </form.AppField>
                  {timingKind === 'cron' ? (
                    <form.AppField name="cron">{field => <field.TextField label="Cron expression" monospace placeholder="0 9 * * 1-5" />}</form.AppField>
                  ) : null}
                  {timingKind === 'daily' || timingKind === 'weekly' ? (
                    <form.AppField name="time">{field => <field.TextField label="Time (HH:mm)" placeholder="09:00" />}</form.AppField>
                  ) : null}
                  {timingKind === 'weekly' ? (
                    <form.Field name="weekdays">
                      {field => (
                        <Field>
                          <FieldLabel id={weekdaysLabel}>Weekdays</FieldLabel>
                          <ToggleGroup
                            aria-labelledby={weekdaysLabel}
                            type="multiple"
                            variant="outline"
                            size="sm"
                            value={[...field.state.value]}
                            onValueChange={value => field.handleChange(value)}
                          >
                            {WEEKDAYS.map(([value, label]) => (
                              <ToggleGroupItem key={value} value={value} aria-label={label}>
                                {label}
                              </ToggleGroupItem>
                            ))}
                          </ToggleGroup>
                        </Field>
                      )}
                    </form.Field>
                  ) : null}
                  {timingKind === 'every' ? (
                    <form.AppField name="everyMinutes">{field => <field.TextField label="Every (minutes)" placeholder="60" />}</form.AppField>
                  ) : (
                    <form.AppField name="timeZone">{field => <field.TextField label="Time zone (IANA)" placeholder="Europe/Paris" />}</form.AppField>
                  )}
                </>
              )
            }
          </form.Subscribe>
          <form.AppField name="prompt">
            {field => (
              <field.TextAreaField
                label="Prompt"
                required
                rows={5}
                placeholder="Review open pull requests and summarize what needs attention."
                description="A webhook prompt may read the request with {{body.path.to.field}} and {{headers.name}}; inserted values are marked as untrusted data."
              />
            )}
          </form.AppField>
          <div className="dshx:grid dshx:grid-cols-3 dshx:gap-3 dshx:max-sm:grid-cols-1">
            <form.AppField name="agentPreset">{field => <field.TextField label="Agent preset (optional)" />}</form.AppField>
            <form.AppField name="provider">{field => <field.TextField label="Provider (optional)" />}</form.AppField>
            <form.AppField name="model">{field => <field.TextField label="Model (optional)" />}</form.AppField>
          </div>
          <form.AppField name="enabled">
            {field => <field.SwitchField label="Enabled" description="A paused automation never starts a thread." />}
          </form.AppField>
          <form.Subscribe selector={state => state.errors}>
            {errors => {
              const messages = [...new Set([...errors.filter(error => typeof error === 'string'), ...(props.error === null ? [] : [props.error])])]
              return messages.length === 0 ? null : (
                <p role="alert" className="dshx:m-0 dshx:text-sm dshx:text-destructive">
                  {messages.join(' ')}
                </p>
              )
            }}
          </form.Subscribe>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => props.onOpenChange(false)}>
              Cancel
            </Button>
            <form.AppForm>
              <form.SubmitButton disabled={props.pending}>{props.editing ? 'Save automation' : 'Create automation'}</form.SubmitButton>
            </form.AppForm>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
