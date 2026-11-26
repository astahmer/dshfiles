import type { SettingsSectionOwnerProps } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SettingsSectionSearchProps } from '@dshfiles/dshx/client'
import { PAGE_FRAME_CLASS } from '@dshfiles/plugin-ui/components/page'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { PageHeader } from '@dshfiles/plugin-ui/components/ui/page-header'
import { Toggle } from '@dshfiles/plugin-ui/components/ui/toggle'
import { Kbd } from '@dshfiles/plugin-ui/components/ui/kbd'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@dshfiles/plugin-ui/components/ui/input-group'
import { ArrowUpRightIcon, ChevronLeftIcon, ChevronRightIcon, ListFilterIcon, SearchIcon, SettingsIcon, XIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { Fragment, useEffect, useId, useLayoutEffect, useRef, type KeyboardEvent, type ReactNode, type RefObject, type SyntheticEvent } from 'react'
import { createPortal } from 'react-dom'
import { SECTION_TITLE_CLASS } from './section-title.js'
import type { ShellTranslate } from './native/locales.js'
import type { ShellRenderSlot } from './native/slots.js'
import type { PluginSettingsPage } from './plugin-settings.js'
import { PageViewMemoryProvider } from './plugin-settings-page.js'
import { Highlight } from './schema-form/settings-form.js'
import type { SettingField } from './schema-form/schema-model.js'
import { JEV_ENTRY_ID, SHARED_JEV_NAMESPACE, SettingsGroups, type GroupedEntries, type SettingsEntry } from './settings-groups.js'
import { SettingsSearch, type SectionEntryRow, type SettingsSearchResult, type ShortcutRow } from './settings-search.js'
import { SettingsNavigationModel } from './navigation-state.js'
import { SettingsEntryTile } from './settings-icons.js'

export interface SectionRow {
  readonly id: string
  readonly order: number
  readonly label: string
  /** Words that find the row in search without showing: its group, namespaces, former names. */
  readonly keywords?: string
}

const headerButton =
  'dshx:inline-flex dshx:size-7 dshx:shrink-0 dshx:cursor-pointer dshx:items-center dshx:justify-center dshx:rounded-md dshx:border-none dshx:bg-transparent dshx:p-0 dshx:text-foreground dshx:hover:bg-[var(--dsw-alias-interactive-bg-hover)] dshx:[&_svg]:size-3.5'
const navCell =
  'dshx:box-border dshx:flex dshx:h-8 dshx:shrink-0 dshx:cursor-pointer dshx:items-center dshx:gap-2 dshx:rounded-lg dshx:border-none dshx:bg-transparent dshx:pr-2 dshx:pl-3 dshx:text-left dshx:text-sm dshx:leading-5 dshx:font-normal dshx:text-foreground dshx:hover:bg-[var(--dshx-tone-2)]'
/**
 * The settings column on the kit's 720 form frame (round nine B1, kit A5): each row splits into its label and a 280px
 * control seat, so values sit close to their labels and keep to the trailing edge the header's actions end on.
 */
export const SETTINGS_COLUMN_WIDTH = PAGE_FRAME_CLASS.form
/** Without the side column the page draws its own 208px list before the column: the header spans both (208 + 720). */
const OWN_LIST_HEADER_WIDTH = 'dshx:max-w-[928px]'
/** The active category (round five K2, A1): the quiet selected wash with its leading marker, ink text at 550. */
const navCellActive = 'dshx:bg-selected-wash dshx:selected-marker dshx:hover:bg-selected-wash dshx:font-selected dshx:text-foreground'
// A group label is a label, not one more row: 16 px above it (none above the first), 4 px between it and its entries.
const navGroupBlock = 'dshx:mt-4 dshx:flex dshx:flex-col dshx:gap-0.5 dshx:first:mt-0'
const navGroup = 'dshx:px-3 dshx:pb-1 dshx:text-xs dshx:font-medium dshx:text-muted-foreground'

/** `named`: the page is the whole entry and the side column's current row names it (council round 4 B1). */
export type PluginPageHeading = 'page' | 'named' | 'section' | 'none'

export interface SettingsViewProps {
  /** Every Settings entry, by task group (plan §4.6). */
  readonly groups: readonly GroupedEntries[]
  /** Native and plugin sections, for search. */
  readonly rows: readonly SectionRow[]
  /** Plugin pages as Settings shows them (human titles, Jev fields moved), for search. */
  readonly pluginPages: readonly PluginSettingsPage[]
  /**
   * Draws one plugin page. `heading` says what titles it: `page` when it is the whole entry (it draws the entry title),
   * `section` for a subheading under an entry that has its own title, `none` when its title would repeat that one.
   */
  readonly renderPluginPage: (page: PluginSettingsPage, heading: PluginPageHeading) => ReactNode
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
  /**
   * The side column draws the category list (council round 4 B1: one Settings navigation): the page drops its own list
   * and the entry title the column's selected row already names.
   */
  readonly columnNavigation?: boolean
  /**
   * A narrow pane (a phone) drills down (round five B6): Settings opens on its grouped category list, a category shows
   * only its fields under a Back row, and Back returns to the list by forgetting the category. Absent, Back is not drawn.
   */
  readonly onBack?: (() => void) | undefined
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
    {/* A Pages row opens its page in the stage rather than an entry here. */}
    {props.entry.opens !== undefined && <ArrowUpRightIcon aria-hidden="true" className="dshx:size-3.5 dshx:shrink-0 dshx:text-muted-foreground" />}
    {props.count !== undefined && props.count > 0 && (
      <span className="dshx:rounded-full dshx:bg-secondary dshx:px-1.5 dshx:text-2xs dshx:leading-4 dshx:text-muted-foreground dshx:tabular-nums">
        {props.count}
      </span>
    )}
  </button>
)

/** The phone Settings root's first group head (council round 10 B3). */
const FIRST_GROUP_HEAD = 'Preferences'

/**
 * The phone's Settings root (round five B6): every category in its task group, as grouped 44px rows with a 28px identity
 * tile, the name and a chevron (an arrow for a row that opens a stage page). Drawn only in a narrow pane; the first group
 * stands 16px under the header. Every group carries a head (council round 10 B3): the first one, whose first row is
 * already "General", reads "Preferences".
 */
const SettingsRootList = (props: { readonly groups: readonly GroupedEntries[]; readonly onOpen: (id: string) => void }): JSX.Element => (
  <div className="dshx:hidden dshx:flex-col dshx:gap-4 dshx:pt-1 dshx:pb-6 dshx:@max-pane-compact:flex" data-settings-root="">
    {props.groups.map(({ group, entries }, index) => (
      <section
        aria-label={index === 0 ? FIRST_GROUP_HEAD : group.label}
        className="dshx:flex dshx:flex-col dshx:gap-1.5"
        data-settings-group={group.id}
        key={group.id}
        role="group"
      >
        {/* Heads on the phone's 24px text edge (round nine B4). */}
        <h3 className="dshx:m-0 dshx:px-3 dshx:text-xs dshx:font-medium dshx:text-muted-foreground">{index === 0 ? FIRST_GROUP_HEAD : group.label}</h3>
        {/* A grouped list (round nine B7): a lighter outer edge than the separators, which start at the label column
            and stop before the last row's end. */}
        <div
          className="dshx:flex dshx:flex-col dshx:overflow-hidden dshx:rounded-lg dshx:border dshx:border-(--dsw-alias-border-l2) dshx:bg-(--dsw-alias-bg-layer-1)"
          data-settings-root-card=""
        >
          {entries.map(entry => (
            <button
              className={cn(
                // The card fills from the 12px gutter, its tiles start at 24px (its 1px edge and 11px, round nine B4).
                'dshx:relative dshx:flex dshx:h-11 dshx:w-full dshx:cursor-pointer dshx:items-center dshx:gap-3 dshx:border-none dshx:bg-transparent dshx:px-[11px] dshx:text-left dshx:text-sm dshx:text-foreground dshx:active:bg-accent dshx:hover:bg-[var(--dshx-tone-2)]',
                // The separator above every row but the first, from the label column: 11px, the 28px tile and 12px.
                "dshx:not-first:before:pointer-events-none dshx:not-first:before:absolute dshx:not-first:before:top-0 dshx:not-first:before:right-0 dshx:not-first:before:left-[51px] dshx:not-first:before:h-px dshx:not-first:before:bg-border dshx:not-first:before:content-['']",
              )}
              data-settings-root-row={entry.id}
              key={entry.id}
              onClick={() => props.onOpen(entry.id)}
              type="button"
            >
              <SettingsEntryTile group={group.id} label={entry.label} />
              <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate">{entry.label}</span>
              {entry.opens === undefined ? (
                <ChevronRightIcon aria-hidden="true" className="dshx:size-4 dshx:shrink-0 dshx:text-muted-foreground" />
              ) : (
                <ArrowUpRightIcon aria-hidden="true" className="dshx:size-4 dshx:shrink-0 dshx:text-muted-foreground" />
              )}
            </button>
          ))}
        </div>
      </section>
    ))}
  </div>
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


const matchesText = (t: ShellTranslate, count: number): string => (count === 1 ? t('search.matchesOne') : t('search.matches', { count }))

/** VS Code's results view: a flat list of matching settings grouped by the page that holds them. */
const SearchResults = (props: SettingsViewProps & { readonly result: SettingsSearchResult }): JSX.Element => {
  const { result, t } = props
  if (result.total === 0) return <p className="dshx:py-6 dshx:text-sm dshx:text-muted-foreground">{t('search.none')}</p>
  return (
    <div className="dshx-root dshx:flex dshx:flex-col dshx:gap-6" data-settings-results="">
      {result.sections.length > 0 && (
        <section aria-label={t('search.sections')} className="dshx:flex dshx:flex-col dshx:gap-1">
          <h3 className="dshx:m-0 dshx:text-sm dshx:font-semibold dshx:text-muted-foreground">{t('search.sections')}</h3>
          <div className="dshx:flex dshx:flex-wrap dshx:gap-1.5">
            {result.sections.map(section => (
              <button
                aria-label={t('search.openSection', { section: section.label })}
                className="dshx:inline-flex dshx:cursor-pointer dshx:items-center dshx:gap-1.5 dshx:rounded-md dshx:border dshx:border-border dshx:bg-transparent dshx:px-2.5 dshx:py-1 dshx:text-sm dshx:hover:bg-accent"
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
            <h3 className="dshx:m-0 dshx:text-base dshx:font-semibold dshx:text-foreground dshx:hover:underline">
              <Highlight query={props.query} text={group.label} />
            </h3>
            <span className="dshx:text-xs dshx:text-muted-foreground">{matchesText(t, group.entries.length)}</span>
          </button>
          {group.entries.map(entry => (
            <button
              className="dshx:flex dshx:cursor-pointer dshx:flex-col dshx:gap-0.5 dshx:rounded-md dshx:border-none dshx:bg-transparent dshx:px-2 dshx:py-2 dshx:text-left dshx:hover:bg-accent"
              data-settings-result-entry={entry.id}
              key={entry.id}
              onClick={() => props.onReveal({ sectionId: entry.sectionId, target: entry.id })}
              type="button"
            >
              <span className="dshx:text-base dshx:text-foreground">
                <Highlight query={props.query} text={entry.title} />
              </span>
              {entry.description !== undefined && (
                <span className="dshx:text-xs dshx:text-muted-foreground">
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
            <h3 className="dshx:m-0 dshx:text-base dshx:font-semibold dshx:text-foreground dshx:hover:underline">{t('search.shortcuts')}</h3>
            <span className="dshx:text-xs dshx:text-muted-foreground">{t('search.editShortcuts')}</span>
          </button>
          <ul className="dshx:m-0 dshx:flex dshx:list-none dshx:flex-col dshx:p-0">
            {result.shortcuts.map(shortcut => (
              <li
                className="dshx:flex dshx:items-center dshx:justify-between dshx:gap-3 dshx:px-2 dshx:py-1.5 dshx:text-base"
                data-settings-shortcut={shortcut.id}
                key={shortcut.id}
              >
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
            <h3 className="dshx:m-0 dshx:text-base dshx:font-semibold dshx:text-foreground dshx:hover:underline">
              <Highlight query={props.query} text={hit.page.title} />
            </h3>
            <span className="dshx:text-xs dshx:text-muted-foreground">{matchesText(t, hit.fields.length)}</span>
          </button>
          {props.renderMatches(hit.page, hit.fields, SettingsSearch.highlightText(props.query))}
        </section>
      ))}
    </div>
  )
}

/** "AI Accounts" and "AI accounts" are one title. */
const sameTitle = (left: string, right: string): boolean => left.trim().replace(/\s+/gu, ' ').toLowerCase() === right.trim().replace(/\s+/gu, ' ').toLowerCase()

const REPEATED_TITLE = 'data-settings-repeated-title'

/**
 * One title per entry. The shell titles every entry the same way, and several sections (native ones and other
 * plugins') also print their name as the first thing they draw, so the page read "Built-in plugins / Built-in
 * plugins". The first text a section draws is hidden when it is only that name; a section that starts with anything
 * else, or with a control, is left alone. Sections render late and re-render, so the check follows their changes.
 */
const useSingleTitle = (label: string): RefObject<HTMLDivElement> => {
  const section = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const root = section.current
    if (root === null) return
    const hideRepeatedTitle = (): void => {
      const texts = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      let text = texts.nextNode()
      while (text !== null && (text.textContent ?? '').trim() === '') text = texts.nextNode()
      const first = text?.parentElement ?? null
      const repeats =
        first !== null &&
        first !== root &&
        sameTitle(first.textContent ?? '', label) &&
        first.closest('button, a, label, input, select, textarea, summary, [role="button"], [role="tab"]') === null
      for (const marked of root.querySelectorAll<HTMLElement>(`[${REPEATED_TITLE}]`)) {
        if (repeats && marked === first) continue
        marked.removeAttribute(REPEATED_TITLE)
        marked.style.removeProperty('display')
      }
      if (!repeats || first.hasAttribute(REPEATED_TITLE)) return
      first.setAttribute(REPEATED_TITLE, '')
      // An inline style: a heading's own `display` rule would beat the `hidden` attribute.
      first.style.setProperty('display', 'none')
    }
    hideRepeatedTitle()
    const observer = new MutationObserver(hideRepeatedTitle)
    observer.observe(root, { childList: true, subtree: true, characterData: true })
    return () => observer.disconnect()
  }, [label])
  return section
}

/** What one entry shows: its heading, the page it links to, its section and the plugin settings merged into it. */
const EntryView = (props: SettingsViewProps & { readonly entry: SettingsEntry; readonly jevNamespaces: ReadonlySet<string> }): JSX.Element => {
  const { entry, t } = props
  const link = entry.link
  // A section draws its own rows; a plugin page that is the whole entry draws the entry's heading itself. A page that
  // is one block of a task entry (Layout › Main tabs) keeps the task's heading above it, even while it is the only one.
  const ownHeading = entry.sectionId !== undefined || entry.pages.length !== 1 || link !== undefined || entry.pages[0]?.pageId !== entry.id
  // A plugin whose Jev switches moved gets a pointer to them. The shell's own namespace only lends the shared key: its
  // page (the release check, under Update DSH) is not about Jev, so it says nothing.
  const jevHere = entry.id === JEV_ENTRY_ID ? [] : entry.pages.filter(page => props.jevNamespaces.has(page.ns) && page.ns !== SHARED_JEV_NAMESPACE)
  const section = useSingleTitle(entry.sectionLabel ?? entry.label)
  const pages = entry.pages.map(page => <Fragment key={page.pageId}>{props.renderPluginPage(page, headingOf(page))}</Fragment>)
  function headingOf(page: PluginSettingsPage): PluginPageHeading {
    if (!ownHeading) return 'named'
    return sameTitle(page.title, entry.label) ? 'none' : 'section'
  }
  return (
    <div className="dshx:flex dshx:flex-col dshx:gap-5" data-settings-entry={entry.id}>
      {ownHeading && (
        // The page's h1 names the entry (council round 7 B2), and a phone's Back row does: the title is not printed twice.
        <header className="dshx:sr-only">
          <h2 className={SECTION_TITLE_CLASS}>{entry.label}</h2>
        </header>
      )}
      {link !== undefined && (
        <div
          className="dshx:flex dshx:flex-wrap dshx:items-center dshx:justify-between dshx:gap-3 dshx:border-b dshx:border-border dshx:pb-4"
          data-settings-link={link.panelId}
        >
          <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-0.5">
            <span className="dshx:text-base dshx:text-foreground">{link.description}</span>
            <span className="dshx:text-xs dshx:text-muted-foreground">{t('entry.opensPage')}</span>
          </div>
          <Button onClick={() => props.openPanel(link.panelId)} size="sm" variant="outline">
            {t('entry.open', { page: link.label })}
            <ArrowUpRightIcon aria-hidden="true" />
          </Button>
        </div>
      )}
      {/* A section that is one block of a task entry follows the plugin pages, under its own name. */}
      {entry.sectionLabel !== undefined && pages}
      {entry.sectionId !== undefined && (
        <div className="dshx:flex dshx:flex-col dshx:gap-1" data-settings-section={entry.sectionId}>
          {entry.sectionLabel !== undefined && <h3 className={SECTION_TITLE_CLASS}>{entry.sectionLabel}</h3>}
          <div ref={section}>{props.renderSlot('settings.section', sectionOwnerWithTarget(props), { only: entry.sectionId })}</div>
        </div>
      )}
      {entry.sectionLabel === undefined && pages}
      {jevHere.length > 0 && (
        <p className="dshx:m-0 dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2 dshx:text-sm dshx:text-muted-foreground" role="note">
          {t('entry.jevMoved', { page: entry.label })}
          <Button onClick={() => props.onSelect(JEV_ENTRY_ID)} size="xs" variant="link">
            {t('entry.openJev')}
          </Button>
        </p>
      )}
    </div>
  )
}

/** How many frames the search field waits for the stage to show the page before it gives up taking focus. */
const SEARCH_FOCUS_FRAMES = 30

/**
 * A touch screen opens Settings without focusing its search (round five B7): focus there raises the software keyboard
 * over the page the person came to read. A keyboard and mouse keep the focused field.
 */
const touchFirst = (): boolean => typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches === true

/**
 * Settings opens with its search field focused (DESIGN.md: a shortcut that opens a page focuses its first field).
 * `autoFocus` alone runs while the stage still hides the page's host, so the field cannot take focus and focus falls to
 * `body` (Option+Cmd+, from the composer). This retries for a few frames, and only while focus is nowhere: a control
 * the user moved to, the rail they clicked, keeps it.
 */
const useSearchFocusOnShow = (search: RefObject<HTMLInputElement | null>): void => {
  useEffect(() => {
    if (touchFirst()) return
    let frame = 0
    let tries = 0
    const attempt = (): void => {
      const input = search.current
      if (input === null || document.activeElement === input) return
      const active = document.activeElement
      const nowhere = active === null || active === document.body || (active instanceof HTMLElement && active.checkVisibility?.() === false)
      if (!nowhere) return
      input.focus()
      if (document.activeElement !== input && tries < SEARCH_FOCUS_FRAMES) {
        tries += 1
        frame = requestAnimationFrame(attempt)
      }
    }
    frame = requestAnimationFrame(attempt)
    return () => cancelAnimationFrame(frame)
  }, [search])
}

/** Search field, the grouped navigation and the active entry, or the search results. */
const SettingsView = (props: SettingsViewProps & { readonly titleId: string }): JSX.Element => {
  const { t } = props
  const search = useRef<HTMLInputElement>(null)
  useSearchFocusOnShow(search)
  const searching = props.query.trim() !== ''
  const result = SettingsSearch.search({
    query: props.query,
    sections: props.rows,
    pages: props.pluginPages,
    entries: props.sectionEntries,
    shortcuts: props.shortcuts,
  })
  const picked = SettingsGroups.entryFor(props.groups, props.activeId)
  const active = picked ?? props.groups[0]?.entries[0]
  // A narrow pane drills down (round five B6): no category picked shows the grouped list, a picked one only its fields.
  const atRoot = !searching && picked === undefined
  const drilled = !searching && picked !== undefined && props.onBack !== undefined
  const jevNamespaces = new Set(
    props.groups.flatMap(group => group.entries.filter(entry => entry.id === JEV_ENTRY_ID).flatMap(entry => entry.pages.map(page => page.ns))),
  )
  const content = useRef<HTMLDivElement>(null)
  const countOf = (entry: SettingsEntry): number | undefined => {
    if (!searching) return undefined
    // A page that is the whole entry shares its id with it: each id counts once ("Main tabs 2" for one match).
    return SettingsNavigationModel.matchCount(entry, result.counts)
  }
  // A Pages row (round five B1) opens its stage page; any other entry opens here.
  const openEntry = (id: string): void => {
    const opens = SettingsGroups.entryFor(props.groups, id)?.opens
    if (opens === undefined) props.onSelect(id)
    else props.openPanel(opens)
  }
  // While searching, a tree entry with matches scrolls to its results (VS Code filters the same way); others open.
  const select = (id: string): void => {
    const entry = SettingsGroups.entryFor(props.groups, id)
    const ids = entry === undefined ? [id] : [entry.id, entry.sectionId ?? '', ...entry.pages.map(page => page.pageId)]
    const group = searching
      ? ids
          .map(candidate => content.current?.querySelector(`[data-results-page="${CSS.escape(candidate)}"]`))
          .find(element => element !== null && element !== undefined)
      : undefined
    if (group !== undefined && group !== null) group.scrollIntoView({ block: 'start' })
    else openEntry(id)
  }
  const foundText = result.total === 1 ? t('search.foundOne') : t('search.found', { count: result.total })
  // The header ends where the settings column does (council round 6 B2): beside the side column's list that is the 680px
  // field column itself, so the configuration file's action sits flush with the selects; after the page's own 208px list
  // it is that list plus the column.
  const headerWidth = props.columnNavigation === true ? SETTINGS_COLUMN_WIDTH : OWN_LIST_HEADER_WIDTH
  // Each category page titles itself (council round 7 B2): the side column's head names Settings, the h1 the category,
  // so no page reads "Settings Settings". Search results span every category and keep "Settings"; so does a phone's
  // category list, which a wide pane shows as its first category.
  const settingsTitle = props.renderSlot('settings.header', {})
  const category = searching ? undefined : active?.label
  const title =
    category === undefined ? (
      settingsTitle
    ) : atRoot && props.onBack !== undefined ? (
      <>
        <span className="dshx:@max-pane-compact:hidden">{category}</span>
        <span className="dshx:hidden dshx:@max-pane-compact:inline">{settingsTitle}</span>
      </>
    ) : (
      category
    )
  return (
    <PageViewMemoryProvider>
      <div className="dshx:@container dshx:flex dshx:min-h-0 dshx:min-w-0 dshx:flex-1 dshx:flex-col">
        {/* The page header (council round 3 B3, kit A5): one h1 and a line on what the page holds, with the search,
            Modified and the configuration file on a toolbar under it. It ends where the settings column does, so the
            actions line up with the rows. A narrow pane (a phone) names
            the page in its top bar, so the header is kept for screen readers only there. */}
        <div
          className={cn(
            'dshx:flex dshx:flex-none dshx:flex-col dshx:gap-3 dshx:border-b-[0.5px] dshx:border-[var(--dsw-alias-border-l2)] dshx:px-6 dshx:pt-5 dshx:pb-3 dshx:@max-pane-compact:px-3 dshx:@max-pane-compact:pt-2 dshx:@max-pane-compact:pb-2',
            // A phone category page shows only its fields under Back (round five B6): the search stays on the list.
            drilled && 'dshx:@max-pane-compact:hidden',
          )}
        >
          <div className={cn(headerWidth, 'dshx:@max-pane-compact:sr-only')} data-settings-page-header="">
            {/* The Settings rail glyph in its tone marks the page (council round 7 B6). */}
            <PageHeader
              heading={<span id={props.titleId}>{title}</span>}
              description={t('description')}
              mark={<SettingsIcon />}
              markTone="settings"
            />
          </div>
          {/* One 8px rhythm (council round 6 B2): the search grows, then Modified and the action group, all 32px. */}
          <div className={cn('dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-2', headerWidth)} data-settings-toolbar="">
          {/* On a phone the search, Modified and the file menu are one 44px row (council round 4 B3). */}
          <InputGroup className="dshx:h-8 dshx:min-w-0 dshx:flex-1 dshx:@max-pane-compact:h-11">
            <InputGroupAddon>
              <SearchIcon />
            </InputGroupAddon>
            <InputGroupInput
              ref={search}
              aria-label={t('search.placeholder')}
              autoComplete="off"
              autoFocus={!touchFirst()}
              data-modal-autofocus={touchFirst() ? undefined : ''}
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
            <InputGroupAddon align="inline-end">
              {props.query !== '' && (
                <InputGroupButton aria-label={t('search.clear')} onClick={() => props.onSearch('')} size="icon-xs">
                  <XIcon />
                </InputGroupButton>
              )}
              {/* On a phone Modified is the search field's own filter (round five B6), not a toolbar button. */}
              <InputGroupButton
                aria-label={t('search.modified')}
                aria-pressed={SettingsSearch.hasModifiedFilter(props.query)}
                className="dshx:hidden dshx:aria-pressed:bg-selected-wash dshx:aria-pressed:text-foreground dshx:@max-pane-compact:inline-flex"
                data-settings-modified-inline=""
                onClick={() => props.onSearch(SettingsSearch.toggleModified(props.query))}
                size="icon-xs"
              >
                <ListFilterIcon />
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
          <Toggle
            aria-label={t('search.modified')}
            // A 13px line box like the file action's: the kit's 18.85px one set the label 0.92px high (council round 7 B7).
            className="dshx:shrink-0 dshx:leading-none dshx:@max-pane-compact:hidden"
            data-settings-modified-filter=""
            onPressedChange={() => props.onSearch(SettingsSearch.toggleModified(props.query))}
            pressed={SettingsSearch.hasModifiedFilter(props.query)}
            variant="outline"
          >
            {t('search.modified')}
          </Toggle>
          {searching && (
            <span aria-live="polite" className="dshx:shrink-0 dshx:text-xs dshx:text-muted-foreground dshx:@max-pane-narrow:hidden" role="status">
              {foundText}
            </span>
          )}
          <div className="dshx:ml-auto dshx:flex dshx:min-w-0 dshx:items-center dshx:justify-end dshx:gap-1.5">
            {props.renderSlot('settings.action', {})}
            {props.onClose !== undefined && (
              <button className={headerButton} data-settings-close="" onClick={props.onClose} type="button">
                <XIcon strokeWidth={1.5} size={14} />
                <span className="dshx:sr-only">{props.renderSlot('settings.close', {})}</span>
              </button>
            )}
          </div>
          </div>
        </div>
        {drilled && picked !== undefined && (
          // The phone category page's one row of chrome (round five B6): Back to the list, and the category's name.
          <div
            className="dshx:hidden dshx:min-w-0 dshx:shrink-0 dshx:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,1fr)] dshx:items-center dshx:border-b-[0.5px] dshx:border-[var(--dsw-alias-border-l2)] dshx:px-1 dshx:@max-pane-compact:grid"
            data-settings-back-row=""
          >
            <Button aria-label={t('nav.back')} className="dshx:h-11 dshx:justify-self-start dshx:gap-0.5 dshx:px-2 dshx:text-muted-foreground" onClick={props.onBack} variant="ghost">
              <ChevronLeftIcon aria-hidden="true" className="dshx:size-5" />
              {t('nav.backShort')}
            </Button>
            <h2 className="dshx:m-0 dshx:truncate dshx:text-center dshx:text-heading dshx:font-semibold dshx:text-foreground">{picked.label}</h2>
          </div>
        )}
        <div className="dshx:flex dshx:min-h-0 dshx:min-w-0 dshx:flex-1">
          {props.columnNavigation === true ? null : (
          <nav
            aria-label={t('title')}
            className="dshx:box-border dshx:flex dshx:min-h-0 dshx:w-[208px] dshx:flex-none dshx:flex-col dshx:gap-0.5 dshx:overflow-y-auto dshx:px-3 dshx:pt-3 dshx:pb-4 dshx:@max-pane-compact:hidden"
          >
            {props.groups.map(({ group, entries }) => (
              <div aria-label={group.label} className={navGroupBlock} data-settings-group={group.id} key={group.id} role="group">
                {/* General leads the list and names its first entry: its label would print "General" a third time (B1). */}
                {group.id !== 'general' && <span className={navGroup}>{group.label}</span>}
                {entries.map(entry => (
                  <NavCell active={!searching && entry.id === active?.id} count={countOf(entry)} entry={entry} key={entry.id} onSelect={select} />
                ))}
              </div>
            ))}
          </nav>
          )}
          <div
            className="dshx:min-h-0 dshx:min-w-0 dshx:flex-1 dshx:overflow-y-auto dshx:px-6 dshx:pt-5 dshx:pb-6 dshx:@max-pane-compact:px-3 dshx:@max-pane-compact:pt-3"
            ref={content}
          >
            {atRoot && <SettingsRootList groups={props.groups} onOpen={openEntry} />}
            {/* One reading width for every entry: sections, plugin pages and search results share this 680px column, so a
                value sits near its label (council round 4 B5). */}
            <div className={cn(SETTINGS_COLUMN_WIDTH, atRoot && 'dshx:@max-pane-compact:hidden')} data-settings-column="">
              {searching && <SearchResults {...props} onSelect={openEntry} result={result} />}
              {!searching && active !== undefined && <EntryView {...props} entry={active} jevNamespaces={jevNamespaces} key={active.id} />}
            </div>
          </div>
        </div>
      </div>
    </PageViewMemoryProvider>
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
    // The page sits on the stage surface, the column beside it on nav (round five B5, kit A4), in both schemes.
    // Named Settings, whichever category its h1 shows.
    <section
      aria-label={props.t('title')}
      className="dshx-root dshx:flex dshx:h-full dshx:min-h-0 dshx:w-full dshx:surface-stage"
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
