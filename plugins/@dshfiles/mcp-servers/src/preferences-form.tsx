import { Alert, AlertDescription } from '@dshfiles/plugin-ui/components/ui/alert'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@dshfiles/plugin-ui/components/ui/card'
import { revalidateLogic, useAppForm } from '@dshfiles/plugin-ui/form'
import { z } from 'zod'
import { preferencesInputSchema, type ManagerPreferences } from './api.js'
import type { McpServersTranslate } from './locales.js'
import { useSavePreferences } from './server-queries.js'

/** The timeout is typed as text in its field and saved as a whole number of seconds. */
const preferencesFormSchema = preferencesInputSchema.extend({ toolCallTimeoutSeconds: z.string().regex(/^\d+$/) }).superRefine((value, context) => {
  const seconds = Number(value.toolCallTimeoutSeconds)
  if (seconds < 5 || seconds > 600) context.addIssue({ code: 'custom', path: ['toolCallTimeoutSeconds'], message: 'Use 5 to 600 seconds.' })
})

export const PreferencesForm = (props: { readonly t: McpServersTranslate; readonly preferences: ManagerPreferences }): JSX.Element => {
  const t = props.t
  const save = useSavePreferences()
  const form = useAppForm({
    defaultValues: { ...props.preferences, toolCallTimeoutSeconds: String(props.preferences.toolCallTimeoutSeconds) },
    validationLogic: revalidateLogic(),
    validators: { onDynamic: preferencesFormSchema },
    onSubmit: async ({ value }) => {
      await save.mutateAsync({ ...value, toolCallTimeoutSeconds: Number(value.toolCallTimeoutSeconds) }).catch(() => undefined)
    },
  })
  return (
    <section aria-labelledby="mcp-preferences">
      <Card>
        <form
          className="dshx:flex dshx:flex-col dshx:gap-4"
          onSubmit={event => {
            event.preventDefault()
            void form.handleSubmit()
          }}
        >
          <CardHeader>
            <CardTitle id="mcp-preferences">{t('preferences')}</CardTitle>
          </CardHeader>
          <CardContent className="dshx:flex dshx:flex-col dshx:gap-4">
            <form.AppField name="connectOnStartup">
              {field => <field.SwitchField description={t('connectOnStartupHint')} label={t('connectOnStartup')} />}
            </form.AppField>
            <form.AppField name="registrySearch">
              {field => <field.SwitchField description={t('registrySearchHint')} label={t('registrySearch')} />}
            </form.AppField>
            <form.AppField name="toolCallTimeoutSeconds">
              {field => <field.TextField description={t('toolCallTimeoutHint')} label={t('toolCallTimeout')} required type="number" />}
            </form.AppField>
            <form.AppField name="oauthClientName">
              {field => <field.TextField description={t('oauthClientNameHint')} label={t('oauthClientName')} required />}
            </form.AppField>
            {save.isError ? (
              <Alert variant="destructive">
                <AlertDescription>{t('error')}</AlertDescription>
              </Alert>
            ) : null}
          </CardContent>
          <CardFooter className="dshx:flex dshx:items-center dshx:gap-3">
            <form.AppForm>
              <form.SubmitButton>{t('savePreferences')}</form.SubmitButton>
            </form.AppForm>
            {save.isSuccess ? (
              <span className="dshx:text-xs dshx:text-muted-foreground" role="status">
                {t('preferencesSaved')}
              </span>
            ) : null}
          </CardFooter>
        </form>
      </Card>
    </section>
  )
}
