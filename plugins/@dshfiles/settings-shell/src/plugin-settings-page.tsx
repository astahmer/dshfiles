import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import { ToggleGroup, ToggleGroupItem } from '@dshfiles/plugin-ui/components/ui/toggle-group'
import { createContext, useContext, useState, type ReactNode } from 'react'
import type { ShellTranslate } from './native/locales.js'
import type { PluginSettingsPage } from './plugin-settings.js'
import { SettingsForm } from './schema-form/settings-form.js'
import { SettingsJsonEditor } from './schema-form/settings-json-editor.js'

type PageView = 'form' | 'json'

const PageViewMemory = createContext<Map<string, PageView> | undefined>(undefined)

/**
 * The view each plugin page of one Settings instance last showed, so a page reopened from search or a link keeps it. Each
 * instance (the stage page, a docked hub) provides its own map.
 */
export const PageViewMemoryProvider = (props: { readonly children: ReactNode }): JSX.Element => {
  const [memory] = useState(() => new Map<string, PageView>())
  return <PageViewMemory.Provider value={memory}>{props.children}</PageViewMemory.Provider>
}

/**
 * One plugin's settings: its title, description and every visible field, as the form or as its overrides in JSON.
 * Nested under an entry that already has a heading (a section with merged plugin settings), the title becomes a
 * subheading. The scope line is read-only: no plugin setting stores per-project or per-thread values today, so the page
 * says where it applies instead of offering a control it cannot honour. The JSON editor stays mounted while the form
 * shows, so switching views keeps an unsaved draft. A focused field opens in the view showing: the form scrolls to its
 * row, the JSON editor selects its key.
 */
export const PluginSettingsPageView = (props: {
  readonly page: PluginSettingsPage
  readonly form: ConfigForm<unknown>
  readonly t: ShellTranslate
  readonly focusPath?: readonly string[]
  readonly nested?: boolean
  /** The plugin entry behind the page, drawn under its scope line. */
  readonly entry?: ReactNode
}): JSX.Element => {
  const memory = useContext(PageViewMemory)
  const [view, setView] = useState<PageView>(() => memory?.get(props.page.ns) ?? 'form')
  const [jsonOpened, setJsonOpened] = useState(view === 'json')
  const show = (next: PageView): void => {
    setView(next)
    memory?.set(props.page.ns, next)
    if (next === 'json') setJsonOpened(true)
  }
  return (
    <section aria-label={props.page.title} className="dshx-root dshx:flex dshx:max-w-[760px] dshx:flex-col dshx:gap-1" data-settings-page={props.page.ns}>
      <div className="dshx:flex dshx:items-start dshx:justify-between dshx:gap-3">
        {props.nested === true ? (
          <h3 className="dshx:m-0 dshx:min-w-0 dshx:text-base dshx:font-semibold dshx:text-foreground">{props.page.title}</h3>
        ) : (
          <h2 className="dshx:m-0 dshx:min-w-0 dshx:text-title dshx:font-semibold dshx:text-foreground">{props.page.title}</h2>
        )}
        <ToggleGroup
          aria-label={props.t('view.label')}
          onValueChange={next => {
            if (next === 'form' || next === 'json') show(next)
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
      {props.page.description !== '' && <p className="dshx:m-0 dshx:text-sm dshx:text-muted-foreground">{props.page.description}</p>}
      {props.nested !== true && <p className="dshx:m-0 dshx:text-xs dshx:text-muted-foreground/80">{props.t('entry.scope')}</p>}
      {props.entry}
      <div className="dshx:mt-3" hidden={view !== 'form'}>
        <SettingsForm
          fields={props.page.fields}
          form={props.form}
          namespace={props.page.ns}
          t={props.t}
          {...(props.focusPath === undefined || view !== 'form' ? {} : { focusPath: props.focusPath })}
        />
      </div>
      {jsonOpened && (
        <div className="dshx:mt-3" hidden={view !== 'json'}>
          <SettingsJsonEditor
            fields={props.page.fields}
            form={props.form}
            namespace={props.page.ns}
            t={props.t}
            {...(props.focusPath === undefined || view !== 'json' ? {} : { focusPath: props.focusPath })}
          />
        </div>
      )}
    </section>
  )
}
