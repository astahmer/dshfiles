import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { revalidateLogic, useAppForm } from '@dshfiles/plugin-ui/form'
import type { ServerDraft } from './api.js'
import type { McpServersTranslate } from './locales.js'
import { parseServerForm, serverFormSchema, type ServerFormValues } from './server-form.js'
import styles from './manager.module.css'

export interface ServerEditorProps {
  readonly t: McpServersTranslate
  readonly defaultValues: ServerFormValues
  readonly onSave: (draft: ServerDraft) => Promise<unknown>
  readonly onCancel: () => void
}

export const ServerEditor = (props: ServerEditorProps): JSX.Element => {
  const t = props.t
  const form = useAppForm({
    defaultValues: props.defaultValues,
    validationLogic: revalidateLogic(),
    validators: { onDynamic: serverFormSchema },
    onSubmit: async ({ value }) => {
      const parsed = parseServerForm(value)
      if (parsed.success) await props.onSave(parsed.draft)
    },
  })
  return (
    <form
      aria-label={props.defaultValues.id ? t('edit') : t('add')}
      className={styles.editor}
      noValidate
      onSubmit={event => {
        event.preventDefault()
        void form.handleSubmit()
      }}
    >
      <h2>{props.defaultValues.id ? t('edit') : t('add')}</h2>
      <div className={styles.formGrid}>
        <form.AppField name="name">{field => <field.TextField label={t('name')} required />}</form.AppField>
        <form.AppField name="serverName">{field => <field.TextField description={t('serverNameHint')} label={t('serverName')} required />}</form.AppField>
        <form.AppField name="transport">
          {field => (
            <field.SelectField
              label={t('transport')}
              options={[
                { value: 'streamable-http', label: t('http') },
                { value: 'stdio', label: t('stdio') },
              ]}
            />
          )}
        </form.AppField>
        <form.Subscribe selector={state => [state.values.transport, state.values.localStart] as const}>
          {([transport, localStart]) =>
            transport === 'streamable-http' ? (
              <>
                <form.AppField name="url">
                  {field => <field.TextField label={t('endpoint')} placeholder="https://example.com/mcp" required type="url" />}
                </form.AppField>
                <div className={styles.wide}>
                  <form.AppField name="headerRefs">
                    {field => <field.TextAreaField label={t('headerRefs')} monospace placeholder={'{\n  "Authorization": "FIGMA_TOKEN"\n}'} />}
                  </form.AppField>
                </div>
                <div className={styles.wide}>
                  <form.AppField name="localStart">{field => <field.CheckboxField label={t('localStart')} />}</form.AppField>
                </div>
                {localStart ? (
                  <>
                    <div className={styles.wide}>
                      <form.AppField name="startCommandLine">
                        {field => <field.TextField label={t('command')} placeholder="npx -y @example/local-proxy" required />}
                      </form.AppField>
                    </div>
                    <form.AppField name="startCwd">{field => <field.TextField label={t('cwd')} placeholder="/absolute/path" />}</form.AppField>
                    <div className={styles.wide}>
                      <form.AppField name="startEnvRefs">
                        {field => <field.TextAreaField label={t('localEnvRefs')} monospace placeholder={'{\n  "ACCESS_TOKEN": "LOCAL_PROXY_TOKEN"\n}'} />}
                      </form.AppField>
                    </div>
                  </>
                ) : null}
              </>
            ) : (
              <>
                <div className={styles.wide}>
                  <form.AppField name="commandLine">
                    {field => <field.TextField label={t('command')} placeholder={'npx -y @example/mcp-server "an argument"'} required />}
                  </form.AppField>
                </div>
                <form.AppField name="cwd">{field => <field.TextField label={t('cwd')} />}</form.AppField>
                <div className={styles.wide}>
                  <form.AppField name="envRefs">
                    {field => <field.TextAreaField label={t('envRefs')} monospace placeholder={'{\n  "API_TOKEN": "EXAMPLE_TOKEN"\n}'} />}
                  </form.AppField>
                </div>
              </>
            )
          }
        </form.Subscribe>
      </div>
      <p className={styles.hint}>{t('referencesHint')}</p>
      <div className={styles.formActions}>
        <Button onClick={props.onCancel} type="button" variant="outline">
          {t('cancel')}
        </Button>
        <form.AppForm>
          <form.SubmitButton>{t('save')}</form.SubmitButton>
        </form.AppForm>
      </div>
    </form>
  )
}
