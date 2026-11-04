import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ShellTranslate } from './native/locales.js'
import type { PluginSettingsPage } from './plugin-settings.js'
import { SettingsForm } from './schema-form/settings-form.js'

/**
 * One plugin's settings: its title, description and every visible field. Nested under an entry that already has a
 * heading (a section with merged plugin settings), the title becomes a subheading. The scope line is read-only: no
 * plugin setting stores per-project or per-thread values today, so the page says where it applies instead of offering
 * a control it cannot honour.
 */
export const PluginSettingsPageView = (props: {
  readonly page: PluginSettingsPage
  readonly form: ConfigForm<unknown>
  readonly t: ShellTranslate
  readonly focusPath?: readonly string[]
  readonly nested?: boolean
}): JSX.Element => (
  <section aria-label={props.page.title} className="dshx-root dshx:flex dshx:max-w-[760px] dshx:flex-col dshx:gap-1" data-settings-page={props.page.ns}>
    {props.nested === true ? (
      <h3 className="dshx:m-0 dshx:text-[15px] dshx:font-semibold dshx:text-foreground">{props.page.title}</h3>
    ) : (
      <h2 className="dshx:m-0 dshx:text-[18px] dshx:font-semibold dshx:text-foreground">{props.page.title}</h2>
    )}
    {props.page.description !== '' && <p className="dshx:m-0 dshx:text-[13px] dshx:text-muted-foreground">{props.page.description}</p>}
    {props.nested !== true && <p className="dshx:m-0 dshx:text-[12px] dshx:text-muted-foreground/80">{props.t('entry.scope')}</p>}
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
