/** Strict per-session header/body content inserted into the resident conversation layout. */

import clsx from 'clsx'
import { useContext, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  ConversationSessionHeaderSlotProps, ConversationSessionSlotProps,
} from '../contract/slots.ts'
import { resolveActiveView } from '../view-selection.ts'
import { ThreadViewsModel } from '../../thread-views.ts'
import { DefaultConversationViews } from './DefaultConversationViews.tsx'
import { phoneMenuScope, usePhoneMenuReader, usePhoneThreadMenu } from '../../phone-thread-menu.tsx'
import css from './ConversationRoot.module.css'

/** Full props composed from the strict session body contract. */
export type ConversationSessionProps = ConversationSessionSlotProps

/** Full props composed from the strict session header contract. */
export type ConversationSessionHeaderProps = ConversationSessionHeaderSlotProps

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
  renderSlot, open, rename, selectView, t,
}: ConversationSessionHeaderProps) {
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
  // dshfiles (parent decision for the 2026-11-11 upstream merge): our ⋯ sheet stays the phone thread menu, and it is the
  // launcher of upstream's PhoneThreadMenu, so composer tools registered there (side question, saved prompts,
  // annotations, …) hide in place and are listed in the sheet. Without that contract the sheet keeps its own state.
  const [localMenuOpen, setLocalMenuOpen] = useState(false)
  const sharedMenu = phoneMenu !== undefined && readerId !== null
  const menuOpen = sharedMenu ? phoneToolsOpen : localMenuOpen
  const setMenuOpen = (next: boolean | ((open: boolean) => boolean)): void => {
    const value = typeof next === 'function' ? next(menuOpen) : next
    if (phoneMenu === undefined || readerId === null) {
      setLocalMenuOpen(value)
      return
    }
    if (value === phoneToolsOpen) return
    if (value) phoneMenu.toggle(readerId)
    else phoneMenu.close()
  }
  useEffect(() => {
    if (!phone) setLocalMenuOpen(false)
  }, [phone])
  // dshfiles (productivity pass Q6): every mounted conversation renders this header, kept-alive ones in hidden panels
  // included, and the phone bar is portalled out of them, so eight open threads stacked eight bars (and eight Changes
  // pills, read as one ghosted `+N −N`) in the top bar's corner. Only the conversation whose own header seat is on
  // screen portals its bar. The header row itself is not drawn on a phone (the bar replaces it), so the test is on the
  // conversation that holds it: it has no box while its panel is hidden.
  const phoneAnchorRef = useRef<HTMLSpanElement | null>(null)
  const [onScreen, setOnScreen] = useState(false)
  useLayoutEffect(() => {
    const anchor = phoneAnchorRef.current
    if (!phone || anchor === null) return
    // Slot wrappers are `display: contents` (no box of their own): the seat is the first ancestor that draws one.
    let seat: Element = anchor.closest('header')?.parentElement ?? anchor
    while (seat.parentElement !== null && getComputedStyle(seat).display === 'contents') seat = seat.parentElement
    // Workbench keeps an off-screen conversation in a Dockview render overlay hidden by `visibility`, which neither a
    // box test nor a size observer sees: read the computed visibility, and watch that overlay's attributes too.
    const check = (): void => {
      const boxed = typeof seat.checkVisibility === 'function' ? seat.checkVisibility() : seat.getClientRects().length > 0
      setOnScreen(boxed && getComputedStyle(seat).visibility === 'visible')
    }
    check()
    const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(check) : undefined
    resize?.observe(seat)
    const overlay = seat.closest('.dv-render-overlay')
    const mutation = overlay === null || typeof MutationObserver !== 'function' ? undefined : new MutationObserver(check)
    if (overlay !== null) mutation?.observe(overlay, { attributes: true, attributeFilter: ['style', 'class', 'hidden'] })
    return () => {
      resize?.disconnect()
      mutation?.disconnect()
    }
  }, [phone, hideChrome])
  // The sheet is the launcher only while its bar is on screen: a hidden kept-alive conversation leaves its tools in place.
  useLayoutEffect(() => {
    if (!phone || !onScreen || phoneMenu === undefined || readerId === null) return
    return phoneMenu.attachLauncher(readerId)
  }, [phone, onScreen, phoneMenu, readerId])
  // The phone bar grows with the Changes pill (T3.2): publish its width so the shell's top bar keeps that much of its
  // trailing corner free (thread-sidebar reads --dsh-phone-bar-width) and the panels button never sits under it.
  const phoneBarRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const bar = phoneBarRef.current
    if (!phone || bar === null) return
    const root = document.documentElement
    let published: string | undefined
    const publish = (): void => {
      const width = bar.getBoundingClientRect().width
      if (width === 0) return
      published = `${Math.ceil(width)}px`
      root.style.setProperty('--dsh-phone-bar-width', published)
    }
    // An engine without ResizeObserver keeps the first measurement.
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(publish) : undefined
    observer?.observe(bar)
    publish()
    return () => {
      observer?.disconnect()
      if (published !== undefined && root.style.getPropertyValue('--dsh-phone-bar-width') === published) {
        root.style.removeProperty('--dsh-phone-bar-width')
      }
    }
  }, [phone, hideChrome, onScreen])
  useEffect(() => {
    if (!menuOpen) return
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    window.addEventListener('keydown', close)
    // dshfiles (productivity pass Q4): choosing an action from a menu the sheet holds (its menus portal out of it)
    // closes the sheet, as an action sheet does, so the chosen tool (Find in thread, Turns) is not left under it.
    // A submenu trigger only opens its submenu. The close waits a task so the item's own handler runs first.
    let timer: ReturnType<typeof setTimeout> | undefined
    const chosen = (event: MouseEvent) => {
      const item = event.target instanceof Element ? event.target.closest('[role^="menuitem"]') : null
      if (item === null || item.hasAttribute('aria-haspopup') || item.getAttribute('aria-disabled') === 'true') return
      timer = setTimeout(() => { setMenuOpen(false) }, 0)
    }
    document.addEventListener('click', chosen, true)
    return () => {
      window.removeEventListener('keydown', close)
      document.removeEventListener('click', chosen, true)
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [menuOpen])
  const showTabs = !hideChrome && !facetsHosted && tabs.length > 1
  // One tab grammar (T1.4): a segmented control in the title row, not an underlined second row.
  // data-conversation-tabs: marks the view switch, which the window-chrome
  // geometry and the browser coverage lane anchor on.
  const views = showTabs && (
    <div className={css.tabs} role="tablist" aria-label={t('session.views')} data-conversation-tabs="">
      {tabs.map(viewTab => (
        <button
          key={viewTab.id}
          type="button"
          role="tab"
          aria-selected={viewTab.id === active?.id}
          className={clsx(css.tab, viewTab.id === active?.id && css.tabActive)}
          onClick={() => {
            selectView(viewTab.id)
            setMenuOpen(false)
          }}
        >
          {viewTab.label}
        </button>
      ))}
    </div>
  )
  if (phone) {
    if (hideChrome) return null
    const anchor = <span ref={phoneAnchorRef} className={css.phoneBarAnchor} aria-hidden data-conversation-phone-anchor="" />
    if (!onScreen) return anchor
    // Portalled to the body: the bar sits in the shell's fixed top bar, outside any transformed or
    // paint-contained stage ancestor; React context (this Session's slots) still flows through the portal.
    // The sheet and its scrim get their own portal (b:ppd0): the bar is transformed (it follows the visual viewport),
    // which makes it the containing block of any fixed descendant, so a sheet inside it was a bar-wide box growing up
    // off the top of the screen instead of a full-width bottom sheet.
    return <>{anchor}{createPortal(
      <div ref={phoneBarRef} className={css.phoneBar} data-conversation-phone-bar="">
        <div className={css.phoneChanges}>{renderSlot('conversation.session.header.changes', {})}</div>
        <button
          type="button"
          className={css.phoneMenuButton}
          aria-label={t('session.menu')}
          aria-haspopup="dialog"
          aria-expanded={menuOpen}
          onClick={() => { setMenuOpen(open => !open) }}
        >
          <svg aria-hidden viewBox="0 0 16 16" width="20" height="20" fill="currentColor">
            <circle cx="3" cy="8" r="1.4" />
            <circle cx="8" cy="8" r="1.4" />
            <circle cx="13" cy="8" r="1.4" />
          </svg>
        </button>
      </div>,
      document.body,
    )}{menuOpen && createPortal(
      <>
        <button
          type="button"
          className={css.phoneScrim}
          aria-label={t('session.closeMenu')}
          onClick={() => { setMenuOpen(false) }}
        />
        <div className={css.phoneSheet} role="dialog" aria-label={t('session.menu')} data-conversation-phone-sheet="" ref={phoneMenuRef} tabIndex={-1}>
          <span className={css.phoneGrabber} aria-hidden />
          {views}
          <div className={css.phoneSheetActions}>
            {renderSlot('conversation.session.header.actions', {})}
            {renderSlot('conversation.session.header.utilities', {})}
          </div>
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
                    <span key={summary.id} className={css.crumbSeg}>
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
