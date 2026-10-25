import type { SettingsSectionOwnerProps } from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  IconAgentPresetOutlineMedium,
  IconArchiveOutlineMedium,
  IconCloseOutlineRegular,
  IconDataOutlineMedium,
  IconPersonalizationOutlineMedium,
  IconSettingsOutlineMedium,
  IconUserOutlineMedium,
  Tooltip,
  useModalLayer,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { Combobox } from '@dshfiles/plugin-ui/components/ui/combobox'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@dshfiles/plugin-ui/components/ui/input-group'
import {
  AppWindowIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  Maximize2Icon,
  Minimize2Icon,
  PuzzleIcon,
  SearchIcon,
  XIcon,
} from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useId, useRef, useState, type ReactNode, type SyntheticEvent } from 'react'
import { createPortal } from 'react-dom'
import type { ShellTranslate } from './native/locales.js'
import type { ShellRenderSlot } from './native/slots.js'
import type { PluginSettingsPage } from './plugin-settings.js'
import { Highlight } from './schema-form/settings-form.js'
import type { SettingField } from './schema-form/schema-model.js'
import { searchSettings, type SettingsSearchResult } from './settings-search.js'

export interface SectionRow {
  readonly id: string
  readonly order: number
  readonly label: string
}

/** How the view is framed: the centered dialog, that dialog filling the window, the main view, or the side panel. */
type ViewVariant = 'modal' | 'expanded' | 'tab' | 'sidebar'

/** Nav glyph by section id, as the native shell draws it; unknown ids fall back to the settings gear. */
const navIcon = (id: string): JSX.Element => {
  const className = 'dshx:flex-none'
  if (id === 'account') return <IconUserOutlineMedium className={className} size={16} />
  if (id === 'models') return <IconDataOutlineMedium className={className} size={16} />
  if (id === 'agent-presets') return <IconAgentPresetOutlineMedium className={className} size={16} />
  if (id === 'plugins') return <IconPersonalizationOutlineMedium className={className} size={16} />
  if (id === 'archived-sessions') return <IconArchiveOutlineMedium className={className} size={16} />
  return <IconSettingsOutlineMedium className={className} size={16} />
}

const headerButton =
  'dshx:inline-flex dshx:size-7 dshx:shrink-0 dshx:cursor-pointer dshx:items-center dshx:justify-center dshx:rounded-[var(--dsw-radius-sm)] dshx:border-none dshx:bg-transparent dshx:p-0 dshx:text-[var(--dsw-alias-label-primary)] dshx:hover:bg-[var(--dsw-alias-interactive-bg-hover)] dshx:[&_svg]:size-3.5'
const navCell =
  'dshx:box-border dshx:flex dshx:h-10 dshx:shrink-0 dshx:cursor-pointer dshx:items-center dshx:gap-2 dshx:rounded-[var(--dsw-radius-md)] dshx:border-none dshx:bg-transparent dshx:py-[9px] dshx:pr-3 dshx:pl-3 dshx:text-left dshx:text-[14px] dshx:leading-[22px] dshx:font-normal dshx:text-[var(--dsw-alias-label-primary)] dshx:hover:bg-[var(--dsw-specific-sidebar-nav-item-hover)]'
const navCellActive = 'dshx:bg-[var(--dsw-specific-sidebar-nav-item-active)]'
const navGroup =
  'dshx:mt-3 dshx:flex dshx:items-center dshx:gap-1 dshx:px-3 dshx:pb-1 dshx:text-[12px] dshx:font-medium dshx:text-[var(--dsw-alias-label-secondary)]'

export interface SettingsViewProps {
  readonly variant: ViewVariant
  readonly rows: readonly SectionRow[]
  /** Pages the shell draws itself from each plugin's settings schema. */
  readonly pluginPages: readonly PluginSettingsPage[]
  readonly renderPluginPage: (page: PluginSettingsPage) => ReactNode
  /** Matching settings of one page, drawn with the query highlighted. */
  readonly renderMatches: (page: PluginSettingsPage, fields: readonly SettingField[], query: string) => ReactNode
  readonly activeId: string | undefined
  readonly query: string
  readonly renderSlot: ShellRenderSlot
  readonly sectionOwner: SettingsSectionOwnerProps
  readonly t: ShellTranslate
  readonly onSelect: (sectionId: string) => void
  readonly onSearch: (query: string) => void
  /** Leaves the drilled-in side-panel section for the section list; a no-op elsewhere. */
  readonly onBack: () => void
  /** Absent in a tab the strip closes. */
  readonly onClose: (() => void) | undefined
  readonly onExpand: () => void
  readonly onRestore: () => void
  readonly onMoveToTab: () => void
}

/** A nav entry: icon, name and, while searching, how many matches it holds. */
const NavCell = (props: {
  readonly id: string
  readonly label: string
  readonly icon: ReactNode
  readonly active: boolean
  readonly count: number | undefined
  readonly compact: boolean
  readonly title?: string
  readonly onSelect: (id: string) => void
}): JSX.Element => (
  <button
    aria-current={props.active ? 'true' : undefined}
    className={cn(navCell, props.compact && 'dshx:h-8 dshx:text-[13px]', props.active && navCellActive, props.count === 0 && 'dshx:opacity-45')}
    data-nav-id={props.id}
    onClick={() => props.onSelect(props.id)}
    title={props.title}
    type="button"
  >
    {props.icon}
    <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate">{props.label}</span>
    {props.count !== undefined && props.count > 0 && (
      <span className="dshx:rounded-full dshx:bg-secondary dshx:px-1.5 dshx:text-[11px] dshx:leading-4 dshx:text-muted-foreground dshx:tabular-nums">
        {props.count}
      </span>
    )}
  </button>
)

const pageIcon = <PuzzleIcon className="dshx:size-3.5 dshx:flex-none dshx:text-[var(--dsw-alias-label-secondary)]" />

/** VS Code's results view: a flat list of matching settings grouped by the page that holds them. */
const SearchResults = (props: SettingsViewProps & { readonly result: SettingsSearchResult }): JSX.Element => {
  const { result, t } = props
  if (result.total === 0) return <p className="dshx:py-6 dshx:text-sm dshx:text-muted-foreground">{t('search.none')}</p>
  return (
    <div className="dshx-root dshx:flex dshx:max-w-[760px] dshx:flex-col dshx:gap-6" data-settings-results="">
      {result.sections.length > 0 && (
        <section aria-label={t('search.sections')} className="dshx:flex dshx:flex-col dshx:gap-1">
          <h3 className="dshx:m-0 dshx:text-[13px] dshx:font-semibold dshx:text-muted-foreground">{t('search.sections')}</h3>
          <div className="dshx:flex dshx:flex-wrap dshx:gap-1.5">
            {result.sections.map(section => (
              <button
                aria-label={t('search.openSection', { section: section.label })}
                className="dshx:inline-flex dshx:cursor-pointer dshx:items-center dshx:gap-1.5 dshx:rounded-md dshx:border dshx:border-border dshx:bg-transparent dshx:px-2.5 dshx:py-1 dshx:text-[13px] dshx:hover:bg-accent"
                key={section.id}
                onClick={() => props.onSelect(section.id)}
                type="button"
              >
                {navIcon(section.id)}
                <Highlight query={props.query} text={section.label} />
              </button>
            ))}
          </div>
        </section>
      )}
      {result.pages.map(hit => (
        <section aria-label={hit.page.title} className="dshx:flex dshx:scroll-mt-4 dshx:flex-col" data-results-page={hit.page.pageId} key={hit.page.pageId}>
          <button
            className="dshx:flex dshx:cursor-pointer dshx:items-baseline dshx:gap-2 dshx:border-none dshx:bg-transparent dshx:p-0 dshx:text-left"
            onClick={() => props.onSelect(hit.page.pageId)}
            type="button"
          >
            <h3 className="dshx:m-0 dshx:text-[15px] dshx:font-semibold dshx:text-foreground dshx:hover:underline">
              <Highlight query={props.query} text={hit.page.title} />
            </h3>
            <span className="dshx:text-xs dshx:text-muted-foreground">{t('search.matches', { count: hit.fields.length })}</span>
          </button>
          {props.renderMatches(hit.page, hit.fields, props.query)}
        </section>
      ))}
    </div>
  )
}

/** Search field, navigation tree and the active section, or the search results; the frame decides dialog or tab. */
const SettingsView = (props: SettingsViewProps & { readonly titleId: string }): JSX.Element => {
  const { t } = props
  const sidebar = props.variant === 'sidebar'
  const searching = props.query.trim() !== ''
  const result = searchSettings({ query: props.query, sections: props.rows, pages: props.pluginPages })
  const activePage = props.pluginPages.find(page => page.pageId === props.activeId)
  const active = activePage?.pageId ?? props.rows.find(row => row.id === props.activeId)?.id ?? props.rows[0]?.id
  // A narrow side panel shows one column: the section list until the user picks one, that section afterwards.
  const drilled = sidebar && (searching || props.activeId !== undefined)
  const plugins = props.pluginPages.filter(page => page.group === 'plugins')
  const more = props.pluginPages.filter(page => page.group === 'more' && (!searching || (result.counts.get(page.pageId) ?? 0) > 0))
  const [moreOpen, setMoreOpen] = useState(activePage?.group === 'more')
  const content = useRef<HTMLDivElement>(null)
  const countOf = (id: string): number | undefined => (searching ? (result.counts.get(id) ?? 0) : undefined)
  // While searching, a tree entry with matches scrolls to its results (VS Code filters the same way); others open.
  const select = (id: string): void => {
    const group = searching ? content.current?.querySelector(`[data-results-page="${CSS.escape(id)}"]`) : null
    if (group !== null && group !== undefined) group.scrollIntoView({ block: 'start' })
    else props.onSelect(id)
  }
  const foundText = result.total === 1 ? t('search.foundOne') : t('search.found', { count: result.total })
  const activeLabel = activePage?.title ?? props.rows.find(row => row.id === props.activeId)?.label ?? ''
  return (
    <div className="dshx:@container dshx:flex dshx:min-h-0 dshx:min-w-0 dshx:flex-1 dshx:flex-col">
      <div
        className={cn(
          'dshx:box-border dshx:flex dshx:h-[58px] dshx:flex-none dshx:items-center dshx:gap-3 dshx:border-b-[0.5px] dshx:border-[var(--dsw-alias-border-l2)] dshx:px-4',
          sidebar && 'dshx:h-11 dshx:gap-2 dshx:px-3',
          !sidebar && 'dshx:@max-pane-compact:gap-2 dshx:@max-pane-compact:px-3',
        )}
      >
        <div
          className={cn(
            'dshx:w-[176px] dshx:shrink-0 dshx:px-2 dshx:text-[16px] dshx:leading-6 dshx:font-medium dshx:text-[var(--dsw-alias-label-primary)]',
            sidebar ? 'dshx:hidden dshx:@pane-compact:block' : 'dshx:@max-pane-compact:sr-only',
          )}
          id={props.titleId}
        >
          {props.renderSlot('settings.header', {})}
        </div>
        <InputGroup className="dshx:h-8 dshx:min-w-0 dshx:max-w-[560px] dshx:flex-1">
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput
            aria-label={t('search.placeholder')}
            autoComplete="off"
            autoFocus
            data-modal-autofocus=""
            onChange={event => props.onSearch(event.currentTarget.value)}
            onKeyDown={event => {
              // Escape clears a query first, as in VS Code; an empty field lets it close the dialog.
              if (event.key === 'Escape' && props.query !== '') {
                event.preventDefault()
                event.stopPropagation()
                event.nativeEvent.stopImmediatePropagation()
                props.onSearch('')
              }
            }}
            placeholder={t('search.placeholder')}
            role="searchbox"
            spellCheck={false}
            type="text"
            value={props.query}
          />
          {props.query !== '' && (
            <InputGroupAddon align="inline-end">
              <InputGroupButton aria-label={t('search.clear')} onClick={() => props.onSearch('')} size="icon-xs">
                <XIcon />
              </InputGroupButton>
            </InputGroupAddon>
          )}
        </InputGroup>
        {searching && (
          <span aria-live="polite" className="dshx:shrink-0 dshx:text-[12px] dshx:text-muted-foreground dshx:@max-pane-narrow:hidden" role="status">
            {foundText}
          </span>
        )}
        <div className="dshx:ml-auto dshx:flex dshx:min-w-0 dshx:items-center dshx:justify-end dshx:gap-1.5">
          {props.renderSlot('settings.action', {})}
          {props.variant !== 'tab' && props.variant !== 'sidebar' && (
            <Tooltip label={t('view.openInTab')}>
              <button aria-label={t('view.openInTab')} className={headerButton} onClick={props.onMoveToTab} type="button">
                <AppWindowIcon />
              </button>
            </Tooltip>
          )}
          {props.variant === 'modal' && (
            <Tooltip label={t('view.expand')}>
              <button aria-label={t('view.expand')} className={headerButton} onClick={props.onExpand} type="button">
                <Maximize2Icon />
              </button>
            </Tooltip>
          )}
          {props.variant === 'expanded' && (
            <Tooltip label={t('view.restore')}>
              <button aria-label={t('view.restore')} className={headerButton} onClick={props.onRestore} type="button">
                <Minimize2Icon />
              </button>
            </Tooltip>
          )}
          {props.onClose !== undefined && (
            <button className={headerButton} onClick={props.onClose} type="button">
              <IconCloseOutlineRegular size={14} />
              <span className="dshx:sr-only">{props.renderSlot('settings.close', {})}</span>
            </button>
          )}
        </div>
      </div>
      {!sidebar && (
        <div className="dshx:hidden dshx:shrink-0 dshx:border-b dshx:border-border dshx:px-3 dshx:py-2 dshx:@max-pane-compact:block">
          <Combobox
            label={t('search.sections')}
            value={active ?? ''}
            options={[
              ...props.rows.map(row => ({ value: row.id, label: row.label, group: t('search.sections') })),
              ...props.pluginPages.map(page => ({
                value: page.pageId,
                label: page.title,
                keywords: [page.ns],
                group: t(page.group === 'plugins' ? 'nav.plugins' : 'nav.more'),
              })),
            ]}
            onValueChange={select}
            matchTriggerWidth
          />
        </div>
      )}
      <div className="dshx:flex dshx:min-h-0 dshx:min-w-0 dshx:flex-1">
        <nav
          aria-label={t('title')}
          className={cn(
            'dshx:box-border dshx:flex dshx:min-h-0 dshx:w-[208px] dshx:flex-none dshx:flex-col dshx:gap-1 dshx:overflow-y-auto dshx:px-3 dshx:pt-3 dshx:pb-4',
            sidebar && 'dshx:w-full dshx:@pane-compact:w-[208px]',
            !sidebar && 'dshx:@max-pane-compact:hidden',
            drilled && 'dshx:hidden dshx:@pane-compact:flex',
          )}
        >
          {props.rows.map(row => (
            <NavCell
              active={!searching && row.id === active}
              count={countOf(row.id)}
              compact={false}
              icon={navIcon(row.id)}
              id={row.id}
              key={row.id}
              label={row.label}
              onSelect={select}
            />
          ))}
          {plugins.length > 0 && (
            <div aria-label={t('nav.plugins')} className="dshx:flex dshx:flex-col dshx:gap-0.5" role="group">
              <span className={navGroup}>{t('nav.plugins')}</span>
              {plugins.map(page => (
                <NavCell
                  active={!searching && page.pageId === active}
                  compact
                  count={countOf(page.pageId)}
                  icon={pageIcon}
                  id={page.pageId}
                  key={page.pageId}
                  label={page.title}
                  onSelect={select}
                  title={page.ns}
                />
              ))}
            </div>
          )}
          {more.length > 0 && (
            <div aria-label={t('nav.more')} className="dshx:flex dshx:flex-col dshx:gap-0.5" role="group">
              <button
                aria-expanded={moreOpen || searching}
                className={cn(navGroup, 'dshx:cursor-pointer dshx:border-none dshx:bg-transparent')}
                onClick={() => setMoreOpen(open => !open)}
                type="button"
              >
                {moreOpen || searching ? <ChevronDownIcon className="dshx:size-3" /> : <ChevronRightIcon className="dshx:size-3" />}
                {t('nav.more')}
              </button>
              {(moreOpen || searching) &&
                more.map(page => (
                  <NavCell
                    active={!searching && page.pageId === active}
                    compact
                    count={countOf(page.pageId)}
                    icon={pageIcon}
                    id={page.pageId}
                    key={page.pageId}
                    label={page.title}
                    onSelect={select}
                    title={page.ns}
                  />
                ))}
            </div>
          )}
        </nav>
        <div
          className={cn(
            'dshx:min-h-0 dshx:min-w-0 dshx:flex-1 dshx:overflow-y-auto dshx:px-6 dshx:pt-5 dshx:pb-6',
            sidebar && 'dshx:px-3 dshx:pt-3 dshx:@pane-compact:px-6 dshx:@pane-compact:pt-5',
            !sidebar && 'dshx:@max-pane-compact:px-3 dshx:@max-pane-compact:pt-3',
            sidebar && !drilled && 'dshx:hidden dshx:@pane-compact:block',
          )}
          ref={content}
        >
          {drilled && (
            <div className="dshx:mb-2 dshx:flex dshx:items-center dshx:gap-1.5 dshx:@pane-compact:hidden">
              <button aria-label={t('sidebar.back')} className={headerButton} onClick={props.onBack} type="button">
                <ChevronLeftIcon />
              </button>
              <span className="dshx:min-w-0 dshx:truncate dshx:text-[13px] dshx:font-medium dshx:text-[var(--dsw-alias-label-primary)]">
                {searching ? t('search.placeholder') : activeLabel}
              </span>
            </div>
          )}
          <div className="dshx:max-w-[880px]">
            {searching && <SearchResults {...props} result={result} />}
            {!searching && activePage !== undefined && props.renderPluginPage(activePage)}
            {!searching && activePage === undefined && active !== undefined && props.renderSlot('settings.section', props.sectionOwner, { only: active })}
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * The dialog frame, ported from the native `SettingsPanel` (@deepseek-ai/dsh-client-ui-settings-general@0.2.1-rc.2,
 * MIT): body-portaled mask and panel closed by the header button, a mask click and document-level Escape. Expanded,
 * the panel fills the window below the frame chrome, like VS Code's maximized editor.
 */
export const SettingsDialog = (props: SettingsViewProps): JSX.Element => {
  const titleId = useId()
  const panel = useRef<HTMLDivElement>(null)
  const close = props.onClose ?? props.onRestore
  useModalLayer(panel, true, close)
  const expanded = props.variant === 'expanded'
  return createPortal(
    <div className="dshx:fixed dshx:inset-0 dshx:z-[1000] dshx:flex dshx:items-center dshx:justify-center" role="presentation">
      <div
        aria-hidden="true"
        className="dshx:absolute dshx:inset-x-0 dshx:top-[var(--dsh-frame-chrome-top,0px)] dshx:bottom-0 dshx:bg-[var(--dsw-alias-bg-mask-1)] dshx:backdrop-blur-[var(--dsw-mask-blur)]"
        onClick={close}
      />
      <div
        aria-labelledby={titleId}
        aria-modal="true"
        className={cn(
          'dshx:relative dshx:z-[1] dshx:flex dshx:overflow-hidden dshx:bg-[var(--dsw-alias-bg-layer-2)] dshx:shadow-[var(--dsw-elevation-prominent)] dshx:outline-none',
          expanded
            ? 'dshx:absolute dshx:inset-x-0 dshx:top-[var(--dsh-frame-chrome-top,0px)] dshx:bottom-0'
            : 'dshx:h-[min(800px,calc(100vh-2*max(24px,var(--dsh-frame-overlay-top,24px))))] dshx:w-[960px] dshx:max-w-[calc(100vw-48px)] dshx:rounded-[var(--dsw-radius-panel)]',
        )}
        data-settings-view={props.variant}
        data-shortcut-modal="settings"
        ref={panel}
        role="dialog"
        tabIndex={-1}
      >
        <SettingsView {...props} titleId={titleId} />
      </div>
    </div>,
    document.body,
  )
}

/** Keeps the tab's events inside Settings: it is rendered from the sidebar's tree through a portal. */
const stopPropagation = (event: SyntheticEvent): void => event.stopPropagation()

/** The main-view frame: Settings fills the panel main-tabs gives a tab. */
export const SettingsTab = (props: SettingsViewProps & { readonly host: HTMLElement }): ReactNode => {
  const titleId = useId()
  return createPortal(
    <section
      aria-labelledby={titleId}
      className="dshx-root dshx:flex dshx:h-full dshx:min-h-0 dshx:w-full dshx:bg-[var(--dsw-alias-bg-layer-1)]"
      data-settings-view="tab"
      onClick={stopPropagation}
      onKeyDown={stopPropagation}
      onPointerDown={stopPropagation}
    >
      <SettingsView {...props} titleId={titleId} />
    </section>,
    props.host,
  )
}

/**
 * The side-panel frame: Settings fills the right sidebar's tab. The panel follows its own width, so a narrow one shows
 * the section list (then one section, with back) and a wide one keeps the dialog's two columns.
 */
export const SettingsSidePanel = (props: SettingsViewProps & { readonly host: HTMLElement }): ReactNode => {
  const titleId = useId()
  return createPortal(
    <section
      aria-label={props.t('title')}
      className="dshx-root dshx:flex dshx:h-full dshx:min-h-0 dshx:w-full dshx:flex-col dshx:bg-[var(--dsw-alias-bg-layer-1)]"
      data-settings-view="sidebar"
      onClick={stopPropagation}
      onKeyDown={stopPropagation}
      onPointerDown={stopPropagation}
    >
      <SettingsView {...props} titleId={titleId} variant="sidebar" />
    </section>,
    props.host,
  )
}
