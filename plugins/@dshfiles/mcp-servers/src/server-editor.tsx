import { ChevronRightIcon, PlusIcon, SaveIcon } from '@dshfiles/plugin-ui/icons'
import { Alert, AlertDescription } from '@dshfiles/plugin-ui/components/ui/alert'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@dshfiles/plugin-ui/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@dshfiles/plugin-ui/components/ui/collapsible'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@dshfiles/plugin-ui/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@dshfiles/plugin-ui/components/ui/select'
import { revalidateLogic, useAppForm } from '@dshfiles/plugin-ui/form'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import type { ReactNode } from 'react'
import type { ServerDraft } from './api.js'
import type { McpServersTranslate } from './locales.js'
import { McpServerFormModel, type ServerFormValues } from './server-form.js'

export interface ServerEditorProps {
  readonly t: McpServersTranslate
  readonly defaultValues: ServerFormValues
  readonly onSave: (draft: ServerDraft) => Promise<void>
  readonly onCancel: (() => void) | undefined
  readonly hint?: string
  /** Renders the fields without the surrounding card, for the custom-server dialog. */
  readonly bare?: boolean
}

const filledControls =
  'dshx:[&_[data-slot=input]]:h-9 dshx:[&_[data-slot=input]]:border-transparent dshx:[&_[data-slot=input]]:bg-muted dshx:[&_[data-slot=input]]:shadow-none dshx:[&_[data-slot=textarea]]:border-transparent dshx:[&_[data-slot=textarea]]:bg-muted dshx:[&_[data-slot=textarea]]:shadow-none'

const placeholderOnlyLabels = 'dshx:[&_[data-slot=field-label]]:sr-only'

const Disclosure = (props: { readonly label: string; readonly defaultOpen: boolean; readonly children: ReactNode }): JSX.Element => (
  <Collapsible className="dshx:flex dshx:flex-col dshx:gap-3" defaultOpen={props.defaultOpen}>
    <CollapsibleTrigger className="dshx:group dshx:flex dshx:w-fit dshx:items-center dshx:gap-1.5 dshx:rounded-sm dshx:text-sm dshx:text-muted-foreground dshx:outline-none dshx:hover:text-foreground dshx:focus-visible:ring-[3px] dshx:focus-visible:ring-ring/50">
      <ChevronRightIcon className="dshx:size-3.5 dshx:transition-transform dshx:group-data-[state=open]:rotate-90" />
      {props.label}
    </CollapsibleTrigger>
    <CollapsibleContent className="dshx:flex dshx:flex-col dshx:gap-4 dshx:pl-5">{props.children}</CollapsibleContent>
  </Collapsible>
)

export const ServerEditor = (props: ServerEditorProps): JSX.Element => {
  const t = props.t
  const values = props.defaultValues
  const isEdit = values.id !== ''
  const form = useAppForm({
    defaultValues: values,
    validationLogic: revalidateLogic(),
    validators: { onDynamic: McpServerFormModel.serverFormSchema },
    onSubmit: async ({ value }) => {
      const parsed = McpServerFormModel.parseServerForm(value)
      if (parsed.success) await props.onSave(parsed.draft)
    },
  })
  const transportLabels = { 'streamable-http': t('http'), stdio: t('stdio') } as const
  const nameListeners = {
    onChange: ({ value }: { readonly value: string }): void => {
      if (isEdit || form.getFieldMeta('serverName')?.isDirty === true) return
      form.setFieldValue('serverName', McpServerFormModel.serverNameFromTitle(value), { dontUpdateMeta: true })
    },
  }
  const serverNameField = (
    <form.AppField name="serverName">{field => <field.TextField description={t('serverNameHint')} label={t('serverName')} monospace required />}</form.AppField>
  )
  const transportSelect = (
    <form.AppField name="transport">
      {field => (
        <Select
          name={field.name}
          onValueChange={value => {
            const next = McpServerFormModel.serverTransports.find(transport => transport === value)
            if (next !== undefined) field.handleChange(next)
          }}
          value={field.state.value}
        >
          <SelectTrigger aria-label={t('transport')} className="dshx:h-9 dshx:min-w-44 dshx:@max-pane-narrow:w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end" position="popper">
            {McpServerFormModel.serverTransports.map(transport => (
              <SelectItem key={transport} value={transport}>
                {transportLabels[transport]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </form.AppField>
  )
  const fields = (
    <div className={cn('dshx:flex dshx:flex-col dshx:gap-4', filledControls)}>
      {props.hint === undefined ? null : (
        <Alert variant="info">
          <AlertDescription>{props.hint}</AlertDescription>
        </Alert>
      )}
      {props.bare === true ? <div className="dshx:flex dshx:justify-end">{transportSelect}</div> : null}
      <form.Subscribe selector={state => state.values.transport}>
        {transport =>
          transport === 'streamable-http' ? (
            <>
              <div className={cn('dshx:grid dshx:gap-4 dshx:@pane-compact:grid-cols-2', placeholderOnlyLabels)}>
                <form.AppField listeners={nameListeners} name="name">
                  {field => <field.TextField label={t('name')} placeholder={t('namePlaceholder')} required />}
                </form.AppField>
                <form.AppField name="url">
                  {field => <field.TextField label={t('endpoint')} placeholder="https://example.com/mcp" required type="url" />}
                </form.AppField>
              </div>
              <form.AppField name="oauth">{field => <field.CheckboxField label={t('useOAuth')} />}</form.AppField>
              <Disclosure defaultOpen={values.headerRefs !== '{}'} label={t('advancedHeaders')}>
                <form.AppField name="headerRefs">
                  {field => <field.TextAreaField label={t('headerRefs')} monospace placeholder={'{\n  "Authorization": "FIGMA_TOKEN"\n}'} />}
                </form.AppField>
                {serverNameField}
              </Disclosure>
              <Disclosure defaultOpen={values.localStart} label={t('optionalLocalStart')}>
                <form.AppField name="localStart">{field => <field.CheckboxField label={t('localStart')} />}</form.AppField>
                <form.Subscribe selector={state => state.values.localStart}>
                  {localStart =>
                    localStart ? (
                      <div className="dshx:grid dshx:gap-4 dshx:@pane-compact:grid-cols-2">
                        <form.AppField name="startCommandLine">
                          {field => <field.TextField label={t('command')} monospace placeholder="npx -y @example/local-proxy" required />}
                        </form.AppField>
                        <form.AppField name="startCwd">{field => <field.TextField label={t('cwd')} monospace placeholder="/absolute/path" />}</form.AppField>
                        <form.AppField name="startEnvRefs">
                          {field => (
                            <field.TextAreaField
                              className="dshx:@pane-compact:col-span-2"
                              label={t('localEnvRefs')}
                              monospace
                              placeholder={'{\n  "ACCESS_TOKEN": "LOCAL_PROXY_TOKEN"\n}'}
                            />
                          )}
                        </form.AppField>
                      </div>
                    ) : null
                  }
                </form.Subscribe>
              </Disclosure>
            </>
          ) : (
            <>
              <div className={cn('dshx:grid dshx:gap-4 dshx:@pane-compact:grid-cols-2', placeholderOnlyLabels)}>
                <form.AppField listeners={nameListeners} name="name">
                  {field => <field.TextField label={t('name')} placeholder={t('namePlaceholder')} required />}
                </form.AppField>
                <form.AppField name="commandLine">
                  {field => <field.TextField label={t('command')} monospace placeholder={'npx -y @example/mcp-server "an argument"'} required />}
                </form.AppField>
              </div>
              <Disclosure defaultOpen={values.cwd !== '' || values.envRefs !== '{}'} label={t('advancedEnvironment')}>
                <form.AppField name="cwd">{field => <field.TextField label={t('cwd')} monospace placeholder="/path/to/project" />}</form.AppField>
                <form.AppField name="envRefs">
                  {field => <field.TextAreaField label={t('envRefs')} monospace placeholder={'{\n  "API_TOKEN": "EXAMPLE_TOKEN"\n}'} />}
                </form.AppField>
              </Disclosure>
              <form.Subscribe selector={state => McpServerFormModel.inheritsHostWorkingDirectory(state.values)}>
                {inherits =>
                  inherits ? (
                    <Alert variant="warning">
                      <AlertDescription>{t('cwdWarning')}</AlertDescription>
                    </Alert>
                  ) : null
                }
              </form.Subscribe>
              <Disclosure defaultOpen={false} label={t('advancedIdentity')}>
                {serverNameField}
              </Disclosure>
            </>
          )
        }
      </form.Subscribe>
    </div>
  )
  const actions = (
    <>
      {props.onCancel ? (
        <Button onClick={props.onCancel} type="button" variant="ghost">
          {t('cancel')}
        </Button>
      ) : null}
      <form.AppForm>
        <form.SubmitButton>
          {isEdit ? <SaveIcon className="dshx:size-3.5" /> : <PlusIcon className="dshx:size-3.5" />}
          {isEdit ? t('save') : t('addServer')}
        </form.SubmitButton>
      </form.AppForm>
    </>
  )
  return (
    <form
      aria-label={isEdit ? t('edit') : t('add')}
      noValidate
      onSubmit={event => {
        event.preventDefault()
        void form.handleSubmit()
      }}
    >
      {props.bare === true ? (
        <div className="dshx:flex dshx:flex-col dshx:gap-4">
          {fields}
          <div className="dshx:flex dshx:justify-end dshx:gap-2">{actions}</div>
        </div>
      ) : (
        <Card>
          <CardHeader className="dshx:@max-pane-narrow:has-data-[slot=card-action]:grid-cols-1">
            <CardTitle className="dshx:text-sm">{isEdit ? `${t('edit')} · ${values.name}` : t('add')}</CardTitle>
            <CardDescription className="dshx:text-xs">{t('addCardDescription')}</CardDescription>
            <CardAction className="dshx:@max-pane-narrow:col-start-1 dshx:@max-pane-narrow:row-span-1 dshx:@max-pane-narrow:row-start-auto dshx:@max-pane-narrow:justify-self-stretch">
              {transportSelect}
            </CardAction>
          </CardHeader>
          <CardContent>{fields}</CardContent>
          <CardFooter className="dshx:justify-end dshx:gap-2">{actions}</CardFooter>
        </Card>
      )}
    </form>
  )
}

export const ServerEditorDialog = (props: {
  readonly t: McpServersTranslate
  readonly open: boolean
  readonly values: ServerFormValues
  readonly hint: string | undefined
  readonly onClose: () => void
  readonly onSave: (draft: ServerDraft) => Promise<void>
  readonly title?: string
  readonly description?: string
}): JSX.Element => (
  <Dialog
    onOpenChange={open => {
      if (!open) props.onClose()
    }}
    open={props.open}
  >
    <DialogContent className="dshx-root dshx:max-h-[85vh] dshx:overflow-y-auto dshx:sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>{props.title ?? props.t('customTitle')}</DialogTitle>
        <DialogDescription>{props.description ?? props.t('customSubtitle')}</DialogDescription>
      </DialogHeader>
      <ServerEditor
        bare
        defaultValues={props.values}
        onCancel={props.onClose}
        onSave={props.onSave}
        t={props.t}
        {...(props.hint === undefined ? {} : { hint: props.hint })}
      />
    </DialogContent>
  </Dialog>
)
