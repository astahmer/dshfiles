import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ShellTranslate } from './native/locales.js'
import type { PluginSettingsPage } from './plugin-settings.js'
import { SettingsForm } from './schema-form/settings-form.js'

/** One plugin's settings page: its title, description and every visible field. */
export const PluginSettingsPageView = (props: {
  readonly page: PluginSettingsPage
  readonly form: ConfigForm<unknown>
  readonly t: ShellTranslate
  readonly focusPath?: readonly string[]
}): JSX.Element => (
  <section aria-label={props.page.title} className="dshx-root dshx:flex dshx:max-w-[760px] dshx:flex-col dshx:gap-1">
    <h2 className="dshx:m-0 dshx:text-[18px] dshx:font-semibold dshx:text-foreground">{props.page.title}</h2>
    {props.page.description !== '' && <p className="dshx:m-0 dshx:text-[13px] dshx:text-muted-foreground">{props.page.description}</p>}
    <code className="dshx:font-mono dshx:text-[11px] dshx:text-muted-foreground/80">{props.page.ns}</code>
    <div className="dshx:mt-3">
      <SettingsForm
        fields={props.page.fields}
        form={props.form}
        namespace={props.page.ns}
        t={props.t}
        {...(props.focusPath === undefined ? {} : { focusPath: props.focusPath })}
      />
    </div>
  </section>
)
