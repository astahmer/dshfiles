import { ChevronRightIcon, PlusIcon } from '@dshfiles/plugin-ui/icons'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@dshfiles/plugin-ui/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@dshfiles/plugin-ui/components/ui/collapsible'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@dshfiles/plugin-ui/components/ui/select'
import { revalidateLogic, useAppForm } from '@dshfiles/plugin-ui/form'
import type { ReactNode } from 'react'
import type { ServerDraft } from './api.js'
import type { McpServersTranslate } from './locales.js'
import { parseServerForm, serverFormSchema, serverTransports, type ServerFormValues } from './server-form.js'

export interface ServerEditorProps {
  readonly t: McpServersTranslate
  readonly defaultValues: ServerFormValues
  readonly onSave: (draft: ServerDraft) => Promise<unknown>
  readonly onCancel: (() => void) | undefined
}

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
    validators: { onDynamic: serverFormSchema },
    onSubmit: async ({ value }) => {
      const parsed = parseServerForm(value)
      if (parsed.success) await props.onSave(parsed.draft)
    },
  })
  const transportLabels = { 'streamable-http': t('http'), stdio: t('stdio') } as const
  return (
    <form
      aria-label={isEdit ? t('edit') : t('add')}
      noValidate
      onSubmit={event => {
        event.preventDefault()
        void form.handleSubmit()
      }}
    >
      <Card>
        <CardHeader>
          <CardTitle className="dshx:text-sm">{isEdit ? `${t('edit')} · ${values.name}` : t('add')}</CardTitle>
          <CardDescription className="dshx:text-xs">{t('referencesHint')}</CardDescription>
          <CardAction>
            <form.AppField name="transport">
              {field => (
                <Select
                  name={field.name}
                  onValueChange={value => {
                    const next = serverTransports.find(transport => transport === value)
                    if (next !== undefined) field.handleChange(next)
                  }}
                  value={field.state.value}
                >
                  <SelectTrigger aria-label={t('transport')} className="dshx:min-w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent align="end" position="popper">
                    {serverTransports.map(transport => (
                      <SelectItem key={transport} value={transport}>
                        {transportLabels[transport]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </form.AppField>
          </CardAction>
        </CardHeader>
        <CardContent className="dshx:flex dshx:flex-col dshx:gap-4">
          <form.Subscribe selector={state => state.values.transport}>
            {transport =>
              transport === 'streamable-http' ? (
                <>
                  <div className="dshx:grid dshx:gap-4 dshx:md:grid-cols-2">
                    <form.AppField name="name">{field => <field.TextField label={t('name')} placeholder={t('custom')} required />}</form.AppField>
                    <form.AppField name="url">
                      {field => <field.TextField label={t('endpoint')} placeholder="https://example.com/mcp" required type="url" />}
                    </form.AppField>
                    <form.AppField name="serverName">
                      {field => <field.TextField description={t('serverNameHint')} label={t('serverName')} monospace required />}
                    </form.AppField>
                  </div>
                  <Disclosure defaultOpen={values.headerRefs !== '{}'} label={t('advancedHeaders')}>
                    <form.AppField name="headerRefs">
                      {field => <field.TextAreaField label={t('headerRefs')} monospace placeholder={'{\n  "Authorization": "FIGMA_TOKEN"\n}'} />}
                    </form.AppField>
                  </Disclosure>
                  <Disclosure defaultOpen={values.localStart} label={t('optionalLocalStart')}>
                    <form.AppField name="localStart">{field => <field.CheckboxField label={t('localStart')} />}</form.AppField>
                    <form.Subscribe selector={state => state.values.localStart}>
                      {localStart =>
                        localStart ? (
                          <div className="dshx:grid dshx:gap-4 dshx:md:grid-cols-2">
                            <form.AppField name="startCommandLine">
                              {field => <field.TextField label={t('command')} monospace placeholder="npx -y @example/local-proxy" required />}
                            </form.AppField>
                            <form.AppField name="startCwd">{field => <field.TextField label={t('cwd')} monospace placeholder="/absolute/path" />}</form.AppField>
                            <form.AppField name="startEnvRefs">
                              {field => (
                                <field.TextAreaField
                                  className="dshx:md:col-span-2"
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
                  <div className="dshx:grid dshx:gap-4 dshx:md:grid-cols-2">
                    <form.AppField name="name">{field => <field.TextField label={t('name')} placeholder={t('custom')} required />}</form.AppField>
                    <form.AppField name="commandLine">
                      {field => <field.TextField label={t('command')} monospace placeholder={'npx -y @example/mcp-server "an argument"'} required />}
                    </form.AppField>
                    <form.AppField name="serverName">
                      {field => <field.TextField description={t('serverNameHint')} label={t('serverName')} monospace required />}
                    </form.AppField>
                  </div>
                  <Disclosure defaultOpen={values.cwd !== '' || values.envRefs !== '{}'} label={t('advancedEnvironment')}>
                    <form.AppField name="cwd">{field => <field.TextField label={t('cwd')} monospace />}</form.AppField>
                    <form.AppField name="envRefs">
                      {field => <field.TextAreaField label={t('envRefs')} monospace placeholder={'{\n  "API_TOKEN": "EXAMPLE_TOKEN"\n}'} />}
                    </form.AppField>
                  </Disclosure>
                </>
              )
            }
          </form.Subscribe>
        </CardContent>
        <CardFooter className="dshx:justify-end dshx:gap-2">
          {props.onCancel ? (
            <Button onClick={props.onCancel} type="button" variant="ghost">
              {t('cancel')}
            </Button>
          ) : null}
          <form.AppForm>
            <form.SubmitButton>
              {isEdit ? (
                t('save')
              ) : (
                <>
                  <PlusIcon className="dshx:size-3.5" />
                  {t('addServer')}
                </>
              )}
            </form.SubmitButton>
          </form.AppForm>
        </CardFooter>
      </Card>
    </form>
  )
}
