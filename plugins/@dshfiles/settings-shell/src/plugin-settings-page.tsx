import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import { ToggleGroup, ToggleGroupItem } from '@dshfiles/plugin-ui/components/ui/toggle-group'
import { useEffect, useState } from 'react'
import type { ShellTranslate } from './native/locales.js'
import type { PluginSettingsPage } from './plugin-settings.js'
import { SettingsForm } from './schema-form/settings-form.js'
import { SettingsJsonEditor } from './schema-form/settings-json-editor.js'

type PageView = 'form' | 'json'

/**
 * One plugin's settings: its title, description and every visible field, as the form or as its overrides in JSON.
 * Nested under an entry that already has a heading (a section with merged plugin settings), the title becomes a
 * subheading. The scope line is read-only: no plugin setting stores per-project or per-thread values today, so the page
 * says where it applies instead of offering a control it cannot honour. The JSON editor stays mounted while the form
 * shows, so switching views keeps an unsaved draft.
 */
export const PluginSettingsPageView = (props: {
  readonly page: PluginSettingsPage
  readonly form: ConfigForm<unknown>
  readonly t: ShellTranslate
  readonly focusPath?: readonly string[]
  readonly nested?: boolean
}): JSX.Element => {
  const [view, setView] = useState<PageView>('form')
  const [jsonOpened, setJsonOpened] = useState(false)
  const focusKey = props.focusPath?.join('.')
  useEffect(() => {
    if (focusKey !== undefined) setView('form')
  }, [focusKey])
  return (
    <section aria-label={props.page.title} className="dshx-root dshx:flex dshx:max-w-[760px] dshx:flex-col dshx:gap-1" data-settings-page={props.page.ns}>
      <div className="dshx:flex dshx:items-start dshx:justify-between dshx:gap-3">
        {props.nested === true ? (
          <h3 className="dshx:m-0 dshx:min-w-0 dshx:text-[15px] dshx:font-semibold dshx:text-foreground">{props.page.title}</h3>
        ) : (
          <h2 className="dshx:m-0 dshx:min-w-0 dshx:text-[18px] dshx:font-semibold dshx:text-foreground">{props.page.title}</h2>
        )}
        <ToggleGroup
          aria-label={props.t('view.label')}
          onValueChange={next => {
            if (next !== 'form' && next !== 'json') return
            setView(next)
            if (next === 'json') setJsonOpened(true)
          }}
          size="sm"
          type="single"
          value={view}
          variant="outline"
        >
          <ToggleGroupItem className="dshx:px-3" value="form">
            {props.t('view.form')}
          </ToggleGroupItem>
          <ToggleGroupItem className="dshx:px-3" value="json">
            {props.t('view.json')}
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      {props.page.description !== '' && <p className="dshx:m-0 dshx:text-[13px] dshx:text-muted-foreground">{props.page.description}</p>}
      {props.nested !== true && <p className="dshx:m-0 dshx:text-[12px] dshx:text-muted-foreground/80">{props.t('entry.scope')}</p>}
      <div className="dshx:mt-3" hidden={view !== 'form'}>
        <SettingsForm
          fields={props.page.fields}
          form={props.form}
          namespace={props.page.ns}
          t={props.t}
          {...(props.focusPath === undefined ? {} : { focusPath: props.focusPath })}
        />
      </div>
      {jsonOpened && (
        <div className="dshx:mt-3" hidden={view !== 'json'}>
          <SettingsJsonEditor fields={props.page.fields} form={props.form} namespace={props.page.ns} t={props.t} />
        </div>
      )}
    </section>
  )
}
