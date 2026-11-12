/** Strict per-session header/body content inserted into the resident conversation layout. */

import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { Button, IconEllipsisOutlineRegular, Menu, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  ConversationSessionHeaderSlotProps, ConversationSessionSlotProps, ConversationViewActionsOwnerProps,
} from '../contract/slots.ts'
import { resolveActiveView } from '../view-selection.ts'
import { FIXED_VIEW_ID } from '../view-pins.ts'
import { DefaultConversationViews } from './DefaultConversationViews.tsx'
import { phoneMenuScope, usePhoneMenuReader, usePhoneThreadMenu } from '../../phone-thread-menu.tsx'
import css from './ConversationRoot.module.css'

/** Full props composed from the strict session body contract. */
export type ConversationSessionProps = ConversationSessionSlotProps

/** Full props composed from the strict session header contract. */
export type ConversationSessionHeaderProps = ConversationSessionHeaderSlotProps

type ViewsMoreMenuProps =
  Omit<ConversationViewActionsOwnerProps, 'onDismiss'>
  & Pick<ConversationSessionHeaderSlotProps, 'renderSlot'>
  & { readonly label: string; readonly current: boolean }

/** The View tab row's More launcher; its menu rows come from `conversation.session.header.views.actions`. */
function ViewsMoreMenu({ label, current, entries, onOpen, onPinnedChange, renderSlot }: ViewsMoreMenuProps) {
  const [open, setOpen] = useState(false)
  const onDismiss = (): void => { setOpen(false) }
  return (
    <Menu open={open} onClose={onDismiss} portal autoFocus className={css.viewsMoreAnchor} listClassName={css.viewsMoreMenu}
      anchor={(
        <Tooltip label={label} portal>
          <Button size="sm" className={clsx(css.viewsMore, current && css.viewsMoreActive)} aria-label={label} aria-haspopup="menu" aria-expanded={open}
            onClick={() => { setOpen(value => !value) }}>
            <IconEllipsisOutlineRegular size={13} />
          </Button>
        </Tooltip>
      )}>
      {renderSlot('conversation.session.header.views.actions', { entries, onOpen, onPinnedChange, onDismiss })}
    </Menu>
  )
}

/** Approximate 13px text advance: full-width glyphs take one em, other glyphs about half. */
const WIDE_GLYPH = /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]/u
const WIDE_GLYPH_WIDTH = 13
const NARROW_GLYPH_WIDTH = 7
/** Mirrors the `.tabLabel` max-width in `ConversationRoot.module.css`. */
const TAB_LABEL_MAX_WIDTH = 88

/** Estimate whether a View tab label exceeds its 88px cell. */
function labelNeedsTooltip(label: string): boolean {
  let width = 0
  for (const glyph of label) width += WIDE_GLYPH.test(glyph) ? WIDE_GLYPH_WIDTH : NARROW_GLYPH_WIDTH
  return width > TAB_LABEL_MAX_WIDTH
}

/** One View tab label; its full-name tooltip is offered only when the text is expected to overflow. */
function ViewTabLabel({ label }: { readonly label: string }) {
  return (
    <Tooltip label={label} portal disabled={!labelNeedsTooltip(label)}>
      <span className={css.tabLabel}>{label}</span>
    </Tooltip>
  )
}

interface Breadcrumb {
  readonly id: SessionId
  readonly displayTitle: string
  readonly subagent: boolean
}

function deriveAncestry(list: SessionListState, id: SessionId): readonly Breadcrumb[] {
  const chain: Breadcrumb[] = []
  const seen = new Set<SessionId>()
  let cursor: SessionId | undefined = id
  while (cursor !== undefined) {
    if (seen.has(cursor)) break
    seen.add(cursor)
    const summary: SessionSummary | undefined = list.byId[cursor]
    if (summary === undefined) break
    chain.unshift({
      id: summary.id,
      displayTitle: summary.displayTitle,
      subagent: summary.origin === 'subagent',
    })
    if (summary.origin !== 'subagent') break
    cursor = summary.parentId
  }
  return chain
}

function equalBreadcrumbs(left: readonly Breadcrumb[], right: readonly Breadcrumb[]): boolean {
  return left.length === right.length
    && left.every((item, index) => {
      const other = right.at(index)
      return other !== undefined && item.id === other.id && item.displayTitle === other.displayTitle
    })
}

interface SessionTitleEditorProps {
  readonly title: string
  readonly label: string
  readonly error: string | undefined
  /** Resolves whether the rename landed; a failed one leaves the editor open for another try. */
  readonly onCommit: (title: string) => Promise<boolean>
  readonly onCancel: () => void
}

/** In-place editor for the current Session title: Enter or blur commits, Escape cancels. */
function SessionTitleEditor({ title, label, error, onCommit, onCancel }: SessionTitleEditorProps): JSX.Element {
  const [draft, setDraft] = useState(title)
  const settled = useRef(false)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [])
  const settle = (mode: 'commit' | 'cancel'): void => {
    if (settled.current) return
    settled.current = true
    const next = draft.trim()
    if (mode === 'cancel' || next === '' || next === title.trim()) {
      onCancel()
      return
    }
    void onCommit(next).then(committed => {
      if (!committed) settled.current = false
    })
  }
  return (
    <span className={css.titleEditor}>
      <input
        ref={input}
        aria-label={label}
        aria-invalid={error === undefined ? undefined : true}
        className={css.titleInput}
        maxLength={200}
        spellCheck={false}
        value={draft}
        onChange={event => setDraft(event.currentTarget.value)}
        onBlur={() => settle('commit')}
        onClick={event => event.stopPropagation()}
        onKeyDown={event => {
          event.stopPropagation()
          if (event.key === 'Enter') {
            event.preventDefault()
            settle('commit')
          } else if (event.key === 'Escape') {
            event.preventDefault()
            settle('cancel')
          }
        }}
      />
      {error === undefined ? null : <span role="alert" className={css.titleError}>{error}</span>}
    </span>
  )
}

/**
 * The phone shell (thread-sidebar's stack navigation: `data-shell-phone-nav` on the document under 640px) draws its
 * own 44pt top bar with Back and the title. There the conversation header gives up its row (visual refresh T1.4):
 * the title is already in the bar, and the view switch and header actions move into one `⋯` sheet.
 */
const PHONE_QUERY = '(max-width: 639.98px)'
const phoneShell = {
  subscribe: (listener: () => void): (() => void) => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => undefined
    const media = window.matchMedia(PHONE_QUERY)
    media.addEventListener('change', listener)
    const observer = new MutationObserver(listener)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-shell-phone-nav'] })
    return () => {
      media.removeEventListener('change', listener)
      observer.disconnect()
    }
  },
  snapshot: (): boolean =>
    typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia(PHONE_QUERY).matches
    && document.documentElement.hasAttribute('data-shell-phone-nav'),
}
const usePhoneShell = (): boolean => useSyncExternalStore(phoneShell.subscribe, phoneShell.snapshot, () => false)

/**
 * Renders Session header chrome above the resident conversation scrollport.
 * @param props - Strict Session store, view ledger, navigation, render, and locale shares.
 * @returns Session navigation controls, with title and tabs after conversation starts.
 */
export function ConversationSessionHeader({
  sessionId, hideChrome, useSessions, useConversationViews, useStore,
  renderSlot, open, rename, useContextMenu, selectView, setPinned, t, useEntryPins, useEntryActions,
}: ConversationSessionHeaderProps) {
  const { getTriggerProps } = useContextMenu()
  const tabs = useConversationViews(value => value)
  const selectedId = useStore(s => s.view)
  const active = resolveActiveView(tabs, selectedId)
  // Productivity pass Q5 (E5, docs/ade-ux §4.4 "no sub-tabs in the header"): where a thread panel hosts Trajectory,
  // Traces and Requests as facets (thread-view-facets.tsx), the header's `⋯` opens them and the stage is always Chat.
  // A composition without a right pane keeps this view switch, so those views stay reachable.
  const facetsHosted = useSyncExternalStore(ThreadViewsModel.subscribe, ThreadViewsModel.hosted, ThreadViewsModel.hosted)
  const ancestry = useSessions(s => deriveAncestry(s, sessionId), equalBreadcrumbs)
  const phone = usePhoneShell()
  const { service: phoneMenu, snapshot: phoneMenuState } = usePhoneThreadMenu()
  const readerId = useContext(phoneMenu?.scope ?? phoneMenuScope())
  usePhoneMenuReader(readerId === null ? null : { id: readerId, sessionId })
  const phoneToolsOpen = readerId !== null && phoneMenuState.openReader === readerId
  const phoneTools = phoneMenuState.tools.filter(tool => tool.readerId === readerId)
  const phoneMenuRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (!phone || !phoneToolsOpen) return
    const previousFocus = document.activeElement
    phoneMenuRef.current?.focus()
    const keydown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        phoneMenu?.close()
      }
      if (event.key !== 'Tab') return
      const controls = Array.from(phoneMenuRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input, [tabindex="0"]') ?? [])
      const first = controls[0]
      const last = controls.at(-1)
      if (event.shiftKey && (document.activeElement === first || document.activeElement === phoneMenuRef.current)) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === phoneMenuRef.current)) {
        event.preventDefault()
        first?.focus()
      }
    }
    document.addEventListener('keydown', keydown)
    return () => {
      document.removeEventListener('keydown', keydown)
      if (phoneMenu?.state.get().closeReason !== 'pick' && previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus()
    }
  }, [phone, phoneToolsOpen, phoneMenu])
  const [renaming, setRenaming] = useState(false)
  const [renameError, setRenameError] = useState<string>()
  useEffect(() => {
    setRenaming(false)
    setRenameError(undefined)
  }, [sessionId])
  const commitRename = async (title: string): Promise<boolean> => {
    try {
      await rename(sessionId, title)
      setRenaming(false)
      setRenameError(undefined)
      return true
    } catch {
      setRenameError(t('session.renameFailed'))
      return false
    }
  }
  const unpinned = useEntryPins(ids => ids)
  const hasEntryActions = useEntryActions(registered => registered)
  const showTabs = !hideChrome && tabs.length > 1
  const tabRow = useRef<HTMLDivElement>(null)
  const [visibleViewLimit, setVisibleViewLimit] = useState(1)
  // Observe only the available row width; individual tabs are not measured.
  useLayoutEffect(() => {
    const row = tabRow.current
    if (row === null || !hasEntryActions) return
    const updateLimit = (): void => {
      setVisibleViewLimit(Math.max(1, Math.floor((row.clientWidth - 48) / 120)))
    }
    updateLimit()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(updateLimit)
    observer.observe(row)
    return () => { observer.disconnect() }
  }, [showTabs, hasEntryActions])
  const { visibleTabs, moreTabs } = useMemo(() => {
    const preferred = [
      ...tabs.filter(tab => tab.id === FIXED_VIEW_ID),
      ...tabs.filter(tab => tab.id !== FIXED_VIEW_ID && !unpinned.includes(tab.id)),
    ]
    const visibleTabs = hasEntryActions ? preferred.slice(0, visibleViewLimit) : preferred
    const visibleIds = new Set(visibleTabs.map(tab => tab.id))
    return { visibleTabs, moreTabs: tabs.filter(tab => !visibleIds.has(tab.id)) }
  }, [tabs, unpinned, hasEntryActions, visibleViewLimit])
  const currentInMore = moreTabs.some(tab => tab.id === active?.id)
  // A selected view other than the first keeps its strip on a phone, so the way back to it is never hidden.
  const secondaryViewActive = active !== undefined && active.id !== tabs[0]?.id
  const renderViewTabs = (className: string | undefined, activeClassName: string | undefined, onPicked?: () => void) => tabs.map(viewTab => (
    <button key={viewTab.id} type="button" role="tab" aria-selected={viewTab.id === active?.id}
      className={clsx(className, viewTab.id === active?.id && activeClassName)}
      onClick={() => { selectView(viewTab.id); onPicked?.() }}>
      {viewTab.label}
    </button>
  ))
  const tabStrip = (
    // data-conversation-tabs: marks the tab strip, which the window-chrome
    // geometry and the browser coverage lane anchor on.
    <div ref={tabRow} className={css.tabs}>
      <div className={css.viewTabs} role="tablist" data-conversation-tabs="">
        {visibleTabs.map(viewTab => (
          <button
            key={viewTab.id}
            type="button"
            role="tab"
            aria-selected={viewTab.id === active?.id}
            className={clsx(css.tab, viewTab.id === active?.id && css.tabActive)}
            onClick={() => { selectView(viewTab.id) }}
          >
            <ViewTabLabel label={viewTab.label} />
          </button>
        ))}
      </div>
      {hasEntryActions && (
        <ViewsMoreMenu
          label={t('session.moreViews')}
          current={currentInMore}
          entries={moreTabs.map(viewTab => ({
            id: viewTab.id, label: viewTab.label,
            pinned: !unpinned.includes(viewTab.id), active: viewTab.id === active?.id,
          }))}
          onOpen={selectView}
          onPinnedChange={setPinned}
          renderSlot={renderSlot}
        />
      )}
    </div>
  )
  const headerActions = (
    <div className={css.headerActions}>
      {renderSlot('conversation.session.header.actions', {})}
    </div>
  )
  const headerUtilities = (
    <div className={css.headerUtilities}>
      {renderSlot('conversation.session.header.utilities', {})}
    </div>
  )
  const headerCorner = (
    <div className={css.headerCorner} data-conversation-header-corner="">
      {renderSlot('conversation.session.header.corner', {})}
    </div>
  )
  // The phone top bar names the thread and owns the menu button: no second title row here.
  if (phone && !phoneToolsOpen) return showTabs && secondaryViewActive && tabStrip
  if (phone)
    return (
      <div className={css.phoneMenuLayer} data-phone-thread-menu="">
        <button type="button" className={css.phoneMenuScrim} aria-label={t('session.phoneMenuClose')} tabIndex={-1} onClick={closePhoneThreadTools} />
        <div
          className={css.phoneMenu}
          role="dialog"
          aria-modal="true"
          tabIndex={-1}
          ref={phoneMenuRef}
          aria-label={t('session.phoneTools')}
        >
          {showTabs && (
            <section className={css.phoneMenuSection}>
              <h3 className={css.phoneMenuHeading}>{t('session.phoneMenuViews')}</h3>
              <div role="tablist" className={css.phoneMenuList}>
                {renderViewTabs(css.phoneMenuItem, css.phoneMenuItemActive, closePhoneThreadTools)}
              </div>
            </section>
          )}
          {!hideChrome && <section className={css.phoneMenuSection}>
            <h3 className={css.phoneMenuHeading}>{t('session.phoneMenuThread')}</h3>
            <div className={css.phoneMenuRow}>
              {headerActions}
              {headerUtilities}
              <div className={css.phoneMenuCorner} onClickCapture={() => requestAnimationFrame(closePhoneThreadTools)}>
                {headerCorner}
              </div>
            </div>
          </section>}
          {phoneTools.length > 0 && (
            <div className={css.phoneSheetTools} data-phone-sheet-tools="">
              {phoneTools.map(tool => (
                <button
                  key={tool.id}
                  type="button"
                  className={css.phoneSheetTool}
                  data-phone-thread-tool-proxy=""
                  onClick={() => { phoneMenu?.pick(tool) }}
                >
                  {tool.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </>,
      document.body,
    )}</>
  }
  return (
    <>
      <div className={css.titleRow}>
        {!hideChrome && (
          <>
            <div className={css.titleCluster}>
              <nav className={css.crumbs} aria-label={t('session.hierarchy')}>
                {ancestry.map((summary, index) => {
                  const last = index === ancestry.length - 1
                  // The current crumb is editable in place. Ancestor crumbs stay
                  // buttons because they navigate; a subagent current crumb keeps
                  // its lineage switcher and is not renamed from here.
                  const title = last
                    ? summary.subagent
                      ? (
                        <span className={clsx(css.crumb, css.crumbSubagent, css.crumbCurrent)}>
                          {summary.displayTitle}
                        </span>
                      )
                      : renaming
                        ? (
                          <SessionTitleEditor
                            title={summary.displayTitle}
                            label={t('session.renameTitle')}
                            error={renameError}
                            onCommit={commitRename}
                            onCancel={() => {
                              setRenaming(false)
                              setRenameError(undefined)
                            }}
                          />
                        )
                        : (
                          <button
                            type="button"
                            className={clsx(css.crumb, css.crumbCurrent, css.crumbEditable)}
                            title={t('session.renameHint')}
                            onClick={() => {
                              setRenameError(undefined)
                              setRenaming(true)
                            }}
                          >
                            {summary.displayTitle}
                          </button>
                        )
                    : (
                      <button
                        type="button"
                        className={clsx(css.crumb, summary.subagent && css.crumbSubagent)}
                        onClick={() => { open(summary.id) }}
                      >
                        {summary.displayTitle}
                      </button>
                    )
                  const lineage = last || summary.subagent
                  const lineageOwner = {
                    lineageSessionId: summary.id,
                    displayTitle: summary.displayTitle,
                    ...last ? {} : { openTitle: () => { open(summary.id) } },
                  }
                  return (
                    <span key={summary.id} className={css.crumbSeg} {...getTriggerProps({ kind: 'session', value: { sessionId: summary.id, displayTitle: summary.displayTitle } })}>
                      {index > 0 && <span className={css.crumbSep}>/</span>}
                      {lineage
                        ? summary.subagent
                          ? renderSlot(
                            'conversation.session.header.lineage',
                            lineageOwner,
                            { fallback: title },
                          )
                          : (
                            <>
                              {title}
                              {renderSlot(
                                'conversation.session.header.lineage',
                                lineageOwner,
                                { fallback: null },
                              )}
                            </>
                          )
                        : title}
                    </span>
                  )
                })}
                {ancestry.length === 0 && <span className={css.crumbCurrent}>{sessionId}</span>}
              </nav>
              <div className={css.headerActions}>
                {renderSlot('conversation.session.header.actions', {})}
              </div>
              {views}
            </div>
            <div className={css.headerUtilities}>
              {renderSlot('conversation.session.header.changes', {})}
              {renderSlot('conversation.session.header.utilities', {})}
            </div>
          </>
        )}
        <div className={css.headerCorner} data-conversation-header-corner="">
          {renderSlot('conversation.session.header.corner', {})}
        </div>
      </div>
    </>
  )
}

/**
 * Renders the active Session view inside the resident scrollport and keeps
 * the input draft mirrored while blank Hero chrome is visible.
 * @param props - Strict Session input/store, view ledger, and render shares.
 * @returns the active view area, or null while the Session remains blank.
 */
export function ConversationSession(props: ConversationSessionProps) {
  return <DefaultConversationViews {...props} />
}
