import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import { PAGE_FRAME_CLASS } from '@dshfiles/plugin-ui/components/page'
import { ToggleGroup, ToggleGroupItem } from '@dshfiles/plugin-ui/components/ui/toggle-group'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { createContext, useContext, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import type { ShellTranslate } from './native/locales.js'
import type { PluginSettingsPage } from './plugin-settings.js'
import { SECTION_TITLE_CLASS } from './section-title.js'
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
 * Under an entry that already has a heading (a section with merged plugin settings), the title becomes a subheading
 * (`section`), or is left out when it would only repeat the entry's (`none`). There is no scope line: no plugin setting stores per-project or per-thread values today, so every page
 * applies everywhere and saying so on each one is noise; a scope caption returns with the first namespace that stores
 * a narrower scope. The JSON editor stays mounted while the form
 * shows, so switching views keeps an unsaved draft. A focused field opens in the view showing: the form scrolls to its
 * row, the JSON editor selects its key.
 *
 * The JSON view and the plugin's Loader entry (Plugin details) are engineering tools: they sit under the page's Advanced
 * fold, after the advanced settings. While the JSON view shows, its switch leads the editor so the way back to the form
 * stays in sight, and focus follows the switch from one view to the other.
 */
export const PluginSettingsPageView = (props: {
  readonly page: PluginSettingsPage
  readonly form: ConfigForm<unknown>
  readonly t: ShellTranslate
  readonly focusPath?: readonly string[]
  /**
   * `page` (default): the page titles itself. `named`: it does for screen readers only, beside the side column's row that
   * names it. `section`: a subheading under an entry title. `none`: no title.
   */
  readonly heading?: 'page' | 'named' | 'section' | 'none'
  /**
   * The page sits under a Settings navigation that names it: once that navigation collapses into the Sections select
   * (a narrow pane), the select reads the same words, so the page title stays for assistive technology only.
   */
  readonly namedByNavigation?: boolean
  /** The plugin entry behind the page, drawn after its settings. */
  readonly entry?: ReactNode
}): JSX.Element => {
  const memory = useContext(PageViewMemory)
  const [view, setView] = useState<PageView>(() => memory?.get(props.page.ns) ?? 'form')
  const [jsonOpened, setJsonOpened] = useState(view === 'json')
  const formSwitch = useRef<HTMLDivElement>(null)
  const jsonSwitch = useRef<HTMLDivElement>(null)
  /** Set when the user switches views, so the switch that now shows takes focus once it renders. */
  const switched = useRef(false)
  const show = (next: PageView): void => {
    switched.current = true
    setView(next)
    memory?.set(props.page.ns, next)
    if (next === 'json') setJsonOpened(true)
  }
  useEffect(() => {
    if (!switched.current) return
    switched.current = false
    // The switch the user pressed is now hidden with its view: focus would fall to body.
    const shown = view === 'json' ? jsonSwitch.current : formSwitch.current
    shown?.querySelector<HTMLElement>('[data-state="on"]')?.focus()
  }, [view])
  const viewSwitch = (ref: RefObject<HTMLDivElement>): JSX.Element => (
    <div ref={ref} className="dshx:flex dshx:items-center dshx:justify-between dshx:gap-3 dshx:py-2">
      <span className="dshx:text-sm dshx:text-foreground">{props.t('view.label')}</span>
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
  )
  return (
    // The 720 form frame of every Settings column (round nine B1).
    <section aria-label={props.page.title} className={cn('dshx-root dshx:flex dshx:flex-col dshx:gap-1', PAGE_FRAME_CLASS.form)} data-settings-page={props.page.ns}>
      {props.heading === 'section' && <h3 className={SECTION_TITLE_CLASS}>{props.page.title}</h3>}
      {(props.heading === undefined || props.heading === 'page' || props.heading === 'named') && (
        <h2
          className={cn(
            SECTION_TITLE_CLASS,
            props.heading === 'named' ? 'dshx:sr-only' : props.namedByNavigation === true && 'dshx:@max-pane-compact:sr-only',
          )}
        >
          {props.page.title}
        </h2>
      )}
      {props.page.description !== '' && <p className="dshx:m-0 dshx:text-sm dshx:text-muted-foreground">{props.page.description}</p>}
      <div className="dshx:mt-3" hidden={view !== 'form'}>
        <SettingsForm
          advancedOf={props.page.title}
          advancedExtra={
            <>
              {viewSwitch(formSwitch)}
              {/* One Plugin details at a time: the entry follows whichever view shows. */}
              {view === 'form' && props.entry}
            </>
          }
          fields={props.page.fields}
          form={props.form}
          namespace={props.page.ns}
          t={props.t}
          {...(props.focusPath === undefined || view !== 'form' ? {} : { focusPath: props.focusPath })}
        />
      </div>
      {jsonOpened && (
        <div className="dshx:mt-3" hidden={view !== 'json'}>
          {viewSwitch(jsonSwitch)}
          <SettingsJsonEditor
            fields={props.page.fields}
            form={props.form}
            namespace={props.page.ns}
            t={props.t}
            {...(props.focusPath === undefined || view !== 'json' ? {} : { focusPath: props.focusPath })}
          />
          {view === 'json' && props.entry}
        </div>
      )}
    </section>
  )
}
