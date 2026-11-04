import type { SettingsSectionOwnerProps } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SettingsSectionSearchProps } from '@dshfiles/dshx/client'
import { IconCloseOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Combobox } from '@dshfiles/plugin-ui/components/ui/combobox'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@dshfiles/plugin-ui/components/ui/input-group'
import { ArrowUpRightIcon, SearchIcon, XIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { Fragment, useId, useRef, type KeyboardEvent, type ReactNode, type SyntheticEvent } from 'react'
import { createPortal } from 'react-dom'
import type { ShellTranslate } from './native/locales.js'
import type { ShellRenderSlot } from './native/slots.js'
import type { PluginSettingsPage } from './plugin-settings.js'
import { Highlight } from './schema-form/settings-form.js'
import type { SettingField } from './schema-form/schema-model.js'
import { JEV_ENTRY_ID, SettingsGroups, type GroupedEntries, type SettingsEntry } from './settings-groups.js'
import { SettingsSearch, type SectionEntryRow, type SettingsSearchResult, type ShortcutRow } from './settings-search.js'

export interface SectionRow {
  readonly id: string
  readonly order: number
  readonly label: string
  /** Words that find the row in search without showing: its group, namespaces, former names. */
  readonly keywords?: string
}

const headerButton =
  'dshx:inline-flex dshx:size-7 dshx:shrink-0 dshx:cursor-pointer dshx:items-center dshx:justify-center dshx:rounded-[var(--dsw-radius-sm)] dshx:border-none dshx:bg-transparent dshx:p-0 dshx:text-[var(--dsw-alias-label-primary)] dshx:hover:bg-[var(--dsw-alias-interactive-bg-hover)] dshx:[&_svg]:size-3.5'
const navCell =
  'dshx:box-border dshx:flex dshx:h-8 dshx:shrink-0 dshx:cursor-pointer dshx:items-center dshx:gap-2 dshx:rounded-[var(--dsw-radius-md)] dshx:border-none dshx:bg-transparent dshx:pr-2 dshx:pl-3 dshx:text-left dshx:text-[13px] dshx:leading-5 dshx:font-normal dshx:text-[var(--dsw-alias-label-primary)] dshx:hover:bg-[var(--dsw-specific-sidebar-nav-item-hover)]'
const navCellActive = 'dshx:bg-[var(--dsw-specific-sidebar-nav-item-active)] dshx:font-medium'
const navGroup = 'dshx:mt-3 dshx:px-3 dshx:pb-1 dshx:text-[12px] dshx:font-medium dshx:text-[var(--dsw-alias-label-secondary)] dshx:first:mt-0'

export interface SettingsViewProps {
  /** Every Settings entry, by task group (plan §4.6). */
  readonly groups: readonly GroupedEntries[]
  /** Native and plugin sections, for search. */
  readonly rows: readonly SectionRow[]
  /** Plugin pages as Settings shows them (human titles, Jev fields moved), for search. */
  readonly pluginPages: readonly PluginSettingsPage[]
  readonly renderPluginPage: (page: PluginSettingsPage, nested: boolean) => ReactNode
  /** Matching settings of one page, drawn with the query highlighted. */
  readonly renderMatches: (page: PluginSettingsPage, fields: readonly SettingField[], query: string) => ReactNode
  readonly activeId: string | undefined
  /** Controls live sections publish, searched while their sections stay unmounted. */
  readonly sectionEntries: readonly SectionEntryRow[]
  /** Key bindings, searched by command name and keys. */
  readonly shortcuts: readonly ShortcutRow[]
  /** The entry id the active section scrolls to, when search opened it. */
  readonly sectionTarget: string | undefined
  readonly query: string
  readonly renderSlot: ShellRenderSlot
  readonly sectionOwner: SettingsSectionOwnerProps
  readonly t: ShellTranslate
  readonly onSelect: (sectionId: string) => void
  readonly onReveal: (entry: { readonly sectionId: string; readonly target: string }) => void
  readonly onSearch: (query: string) => void
  /** Opens another plugin's page in the stage (MCP servers, Secrets, Hosts, AI accounts). */
  readonly openPanel: (panelId: string) => void
  /** Absent in a tab the strip closes. */
  readonly onClose: (() => void) | undefined
}

/** A nav entry: name, a mark for a page that opens elsewhere and, while searching, how many matches it holds. */
const NavCell = (props: {
  readonly entry: SettingsEntry
  readonly active: boolean
  readonly count: number | undefined
  readonly onSelect: (id: string) => void
}): JSX.Element => (
  <button
    aria-current={props.active ? 'page' : undefined}
    className={cn(navCell, props.active && navCellActive, props.count === 0 && 'dshx:opacity-45')}
    data-nav-id={props.entry.id}
    onClick={() => props.onSelect(props.entry.id)}
    type="button"
  >
    <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate">{props.entry.label}</span>
    {props.count !== undefined && props.count > 0 && (
      <span className="dshx:rounded-full dshx:bg-secondary dshx:px-1.5 dshx:text-[11px] dshx:leading-4 dshx:text-muted-foreground dshx:tabular-nums">
        {props.count}
      </span>
    )}
  </button>
)

/** Matching entries grouped by their section, in section order. */
const entryGroups = (
  entries: readonly SectionEntryRow[],
): ReadonlyArray<{ readonly sectionId: string; readonly label: string; readonly entries: readonly SectionEntryRow[] }> => {
  const groups = new Map<string, { readonly sectionId: string; readonly label: string; readonly entries: SectionEntryRow[] }>()
  for (const entry of entries) {
    const group = groups.get(entry.sectionId) ?? { sectionId: entry.sectionId, label: entry.sectionLabel, entries: [] }
    group.entries.push(entry)
    groups.set(entry.sectionId, group)
  }
  return [...groups.values()]
}

/** The machine sets a target only together with its section, so the active section is the one it belongs to. */
const sectionOwnerWithTarget = (props: SettingsViewProps): SettingsSectionOwnerProps & SettingsSectionSearchProps =>
  props.sectionTarget === undefined ? props.sectionOwner : { ...props.sectionOwner, target: props.sectionTarget }

const Kbd = (props: { readonly children: ReactNode }): JSX.Element => (
  <kbd className="dshx:rounded dshx:border dshx:border-border dshx:bg-muted dshx:px-1.5 dshx:py-px dshx:font-mono dshx:text-[11px] dshx:text-muted-foreground">
    {props.children}
  </kbd>
)

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
                <Highlight query={props.query} text={section.label} />
              </button>
            ))}
          </div>
        </section>
      )}
      {entryGroups(result.entries).map(group => (
        <section
          aria-label={group.label}
          className="dshx:flex dshx:scroll-mt-4 dshx:flex-col dshx:gap-1"
          data-results-page={group.sectionId}
          key={group.sectionId}
        >
          <button
            className="dshx:flex dshx:cursor-pointer dshx:items-baseline dshx:gap-2 dshx:border-none dshx:bg-transparent dshx:p-0 dshx:text-left"
            onClick={() => props.onSelect(group.sectionId)}
            type="button"
          >
            <h3 className="dshx:m-0 dshx:text-[15px] dshx:font-semibold dshx:text-foreground dshx:hover:underline">
              <Highlight query={props.query} text={group.label} />
            </h3>
            <span className="dshx:text-xs dshx:text-muted-foreground">{t('search.matches', { count: group.entries.length })}</span>
          </button>
          {group.entries.map(entry => (
            <button
              className="dshx:flex dshx:cursor-pointer dshx:flex-col dshx:gap-0.5 dshx:rounded-md dshx:border-none dshx:bg-transparent dshx:px-2 dshx:py-2 dshx:text-left dshx:hover:bg-accent"
              data-settings-result-entry={entry.id}
              key={entry.id}
              onClick={() => props.onReveal({ sectionId: entry.sectionId, target: entry.id })}
              type="button"
            >
              <span className="dshx:text-[14px] dshx:text-foreground">
                <Highlight query={props.query} text={entry.title} />
              </span>
              {entry.description !== undefined && (
                <span className="dshx:text-[12px] dshx:text-muted-foreground">
                  <Highlight query={props.query} text={entry.description} />
                </span>
              )}
            </button>
          ))}
        </section>
      ))}
      {result.shortcuts.length > 0 && (
        <section aria-label={t('search.shortcuts')} className="dshx:flex dshx:flex-col dshx:gap-1" data-results-page="shortcuts">
          <button
            className="dshx:flex dshx:cursor-pointer dshx:items-baseline dshx:gap-2 dshx:border-none dshx:bg-transparent dshx:p-0 dshx:text-left"
            onClick={() => props.onSelect('general')}
            type="button"
          >
            <h3 className="dshx:m-0 dshx:text-[15px] dshx:font-semibold dshx:text-foreground dshx:hover:underline">{t('search.shortcuts')}</h3>
            <span className="dshx:text-xs dshx:text-muted-foreground">{t('search.editShortcuts')}</span>
          </button>
          <ul className="dshx:m-0 dshx:flex dshx:list-none dshx:flex-col dshx:p-0">
            {result.shortcuts.map(shortcut => (
              <li className="dshx:flex dshx:items-center dshx:justify-between dshx:gap-3 dshx:px-2 dshx:py-1.5 dshx:text-[14px]" data-settings-shortcut={shortcut.id} key={shortcut.id}>
                <span className="dshx:min-w-0 dshx:truncate">
                  <Highlight query={props.query} text={shortcut.label} />
                </span>
                <span className="dshx:flex dshx:shrink-0 dshx:gap-1">
                  {shortcut.keys.map(key => (
                    <Kbd key={key}>{key}</Kbd>
                  ))}
                </span>
              </li>
            ))}
          </ul>
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

/** What one entry shows: its heading, the page it links to, its section and the plugin settings merged into it. */
const EntryView = (props: SettingsViewProps & { readonly entry: SettingsEntry; readonly groupLabel: string; readonly jevNamespaces: ReadonlySet<string> }): JSX.Element => {
  const { entry, t } = props
  const link = entry.link
  // A section draws its own rows; a lone plugin page draws its own heading, so the entry heading would repeat it.
  const ownHeading = entry.sectionId !== undefined || entry.pages.length !== 1 || link !== undefined
  const jevHere = entry.id === JEV_ENTRY_ID ? [] : entry.pages.filter(page => props.jevNamespaces.has(page.ns))
  return (
    <div className="dshx:flex dshx:flex-col dshx:gap-5" data-settings-entry={entry.id}>
      {ownHeading && (
        <header className="dshx:flex dshx:flex-col dshx:gap-0.5">
          {props.groupLabel !== entry.label && <p className="dshx:m-0 dshx:text-[12px] dshx:text-muted-foreground">{props.groupLabel}</p>}
          <h2 className="dshx:m-0 dshx:text-[18px] dshx:font-semibold dshx:text-foreground">{entry.label}</h2>
        </header>
      )}
      {link !== undefined && (
        <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:justify-between dshx:gap-3 dshx:rounded-lg dshx:border dshx:border-border dshx:px-4 dshx:py-3" data-settings-link={link.panelId}>
          <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-0.5">
            <span className="dshx:text-[14px] dshx:text-foreground">{link.description}</span>
            <span className="dshx:text-[12px] dshx:text-muted-foreground">{t('entry.opensPage')}</span>
          </div>
          <Button onClick={() => props.openPanel(link.panelId)} size="sm" variant="outline">
            {t('entry.open', { page: link.label })}
            <ArrowUpRightIcon aria-hidden="true" />
          </Button>
        </div>
      )}
      {entry.sectionId !== undefined && <div>{props.renderSlot('settings.section', sectionOwnerWithTarget(props), { only: entry.sectionId })}</div>}
      {entry.pages.map(page => (
        <Fragment key={page.pageId}>{props.renderPluginPage(page, ownHeading)}</Fragment>
      ))}
      {jevHere.length > 0 && (
        <p className="dshx:m-0 dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2 dshx:text-[13px] dshx:text-muted-foreground" role="note">
          {t('entry.jevMoved', { page: entry.label })}
          <Button onClick={() => props.onSelect(JEV_ENTRY_ID)} size="xs" variant="link">
            {t('entry.openJev')}
          </Button>
        </p>
      )}
    </div>
  )
}

/** Search field, the grouped navigation and the active entry, or the search results. */
const SettingsView = (props: SettingsViewProps & { readonly titleId: string }): JSX.Element => {
  const { t } = props
  const searching = props.query.trim() !== ''
  const result = SettingsSearch.search({
    query: props.query,
    sections: props.rows,
    pages: props.pluginPages,
    entries: props.sectionEntries,
    shortcuts: props.shortcuts,
  })
  const active = SettingsGroups.entryFor(props.groups, props.activeId) ?? props.groups[0]?.entries[0]
  const activeGroup = props.groups.find(group => group.entries.some(entry => entry.id === active?.id))?.group
  const jevNamespaces = new Set(props.groups.flatMap(group => group.entries.filter(entry => entry.id === JEV_ENTRY_ID).flatMap(entry => entry.pages.map(page => page.ns))))
  const content = useRef<HTMLDivElement>(null)
  const countOf = (entry: SettingsEntry): number | undefined => {
    if (!searching) return undefined
    const ids = [entry.id, ...(entry.sectionId === undefined || entry.sectionId === entry.id ? [] : [entry.sectionId]), ...entry.pages.map(page => page.pageId)]
    return ids.reduce((sum, id) => sum + (result.counts.get(id) ?? 0), 0)
  }
  // While searching, a tree entry with matches scrolls to its results (VS Code filters the same way); others open.
  const select = (id: string): void => {
    const entry = SettingsGroups.entryFor(props.groups, id)
    const ids = entry === undefined ? [id] : [entry.id, entry.sectionId ?? '', ...entry.pages.map(page => page.pageId)]
    const group = searching
      ? ids.map(candidate => content.current?.querySelector(`[data-results-page="${CSS.escape(candidate)}"]`)).find(element => element !== null && element !== undefined)
      : undefined
    if (group !== undefined && group !== null) group.scrollIntoView({ block: 'start' })
    else props.onSelect(id)
  }
  const foundText = result.total === 1 ? t('search.foundOne') : t('search.found', { count: result.total })
  return (
    <div className="dshx:@container dshx:flex dshx:min-h-0 dshx:min-w-0 dshx:flex-1 dshx:flex-col">
      <div className="dshx:box-border dshx:flex dshx:h-[58px] dshx:flex-none dshx:items-center dshx:gap-3 dshx:border-b-[0.5px] dshx:border-[var(--dsw-alias-border-l2)] dshx:px-4 dshx:@max-pane-compact:gap-2 dshx:@max-pane-compact:px-3">
        <div
          className="dshx:w-[176px] dshx:shrink-0 dshx:px-2 dshx:text-[16px] dshx:leading-6 dshx:font-medium dshx:text-[var(--dsw-alias-label-primary)] dshx:@max-pane-compact:sr-only"
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
              // Escape clears a query first, as in VS Code.
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
          {props.onClose !== undefined && (
            <button className={headerButton} onClick={props.onClose} type="button">
              <IconCloseOutlineRegular size={14} />
              <span className="dshx:sr-only">{props.renderSlot('settings.close', {})}</span>
            </button>
          )}
        </div>
      </div>
      <div className="dshx:hidden dshx:shrink-0 dshx:border-b dshx:border-border dshx:px-3 dshx:py-2 dshx:@max-pane-compact:block">
        <Combobox
          label={t('search.sections')}
          value={active?.id ?? ''}
          options={props.groups.flatMap(({ group, entries }) =>
            entries.map(entry => ({ value: entry.id, label: entry.label, keywords: [entry.keywords], group: group.label })),
          )}
          onValueChange={select}
          matchTriggerWidth
        />
      </div>
      <div className="dshx:flex dshx:min-h-0 dshx:min-w-0 dshx:flex-1">
        <nav
          aria-label={t('title')}
          className="dshx:box-border dshx:flex dshx:min-h-0 dshx:w-[208px] dshx:flex-none dshx:flex-col dshx:gap-0.5 dshx:overflow-y-auto dshx:px-3 dshx:pt-3 dshx:pb-4 dshx:@max-pane-compact:hidden"
        >
          {props.groups.map(({ group, entries }) => (
            <div aria-label={group.label} className="dshx:flex dshx:flex-col dshx:gap-0.5" data-settings-group={group.id} key={group.id} role="group">
              <span className={navGroup}>{group.label}</span>
              {entries.map(entry => (
                <NavCell active={!searching && entry.id === active?.id} count={countOf(entry)} entry={entry} key={entry.id} onSelect={select} />
              ))}
            </div>
          ))}
        </nav>
        <div className="dshx:min-h-0 dshx:min-w-0 dshx:flex-1 dshx:overflow-y-auto dshx:px-6 dshx:pt-5 dshx:pb-6 dshx:@max-pane-compact:px-3 dshx:@max-pane-compact:pt-3" ref={content}>
          <div className="dshx:max-w-[880px]">
            {searching && <SearchResults {...props} result={result} />}
            {!searching && active !== undefined && (
              <EntryView {...props} entry={active} groupLabel={activeGroup?.label ?? ''} jevNamespaces={jevNamespaces} key={active.id} />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/** Keeps the page's events inside Settings: it is rendered from the sidebar's tree through a portal. */
const stopPropagation = (event: SyntheticEvent): void => event.stopPropagation()
/** Typing stays inside Settings; a chord (Mod+, closes Settings, the palette, tab keys) still reaches the shortcuts. */
const stopTyping = (event: KeyboardEvent): void => {
  if (event.metaKey || event.ctrlKey || event.altKey) return
  event.stopPropagation()
}

/** The one Settings page: it fills the stage (the main view panel main-tabs gives a tab, or a free-docking pane). */
export const SettingsTab = (props: SettingsViewProps & { readonly host: HTMLElement }): ReactNode => {
  const titleId = useId()
  return createPortal(
    <section
      aria-labelledby={titleId}
      className="dshx-root dshx:flex dshx:h-full dshx:min-h-0 dshx:w-full dshx:bg-[var(--dsw-alias-bg-layer-1)]"
      data-settings-view="tab"
      onClick={stopPropagation}
      onKeyDown={stopTyping}
      onPointerDown={stopPropagation}
    >
      <SettingsView {...props} titleId={titleId} />
    </section>,
    props.host,
  )
}
