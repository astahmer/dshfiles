import { ChevronDownIcon, ChevronRightIcon, RefreshCwIcon } from '@dshfiles/plugin-ui/icons'
import { useMemo, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import type { SessionListState, SessionProjectionMap, SessionSummary, SessionProjectionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SubagentAddress } from '@deepseek-ai/dsh-subagent/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { Tooltip as NativeTooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { RouteModel } from '@dshfiles/plugin-ui/components/model-mark'
import { StatusGlyph, type StatusGlyphState } from '@dshfiles/plugin-ui/components/work-status'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { formatElapsed } from '@dshfiles/plugin-ui/lib/format-duration'
import { WORK_COUNT_SEPARATOR, workCountParts, type WorkCounts, type WorkCountWords } from '@dshfiles/plugin-ui/lib/work-count'
import { createHoverIntentMachine, useMachine } from '@dshfiles/plugin-ui/machine'
import { HostSnapshotsModel } from '../snapshots.js'
import { NS } from './locales.js'
import { SubagentRouteLabelModel } from './route-label.js'
import { SubagentFeedModel } from './subagent-feed.js'
import { useSubagentFailedTurns } from './subagent-failed-turns.js'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-token-meter/client'
import css from './SubagentHeaderLineage.module.css'

type SubagentCatalogSnapshot = Omit<SessionProjectionSnapshot, 'values' | 'state'> & {
  state: 'loading' | 'ready' | 'error' | 'migration-required'
  entries: (SessionProjectionMap['subagentCatalog'][number] & { activity: 'running' | 'inactive' })[]
}
type CatalogLookup = (sessionId: SessionId) => SubagentCatalogSnapshot | undefined
type CatalogProjections = Readonly<Record<SessionId, { readonly values: { readonly subagentCatalog?: readonly { readonly id: string }[] } }>>

/**
 * Catalog reads for one mounted header. A list publish happens several times a second while a turn streams, so nothing
 * here folds every Session's projection: a catalog is built only when a header row asks for it, and the parent of the
 * shown thread is found by a scan that allocates nothing.
 */
export class SubagentCatalogs {
  static lookup(input: {
    readonly projections: SessionListState['projectionsBySession']
    readonly summaries: Readonly<Record<SessionId, SessionSummary>>
    readonly statuses: ReadonlyMap<SessionId, { readonly running?: boolean | undefined }>
  }): CatalogLookup {
    const built = new Map<SessionId, SubagentCatalogSnapshot | undefined>()
    return sessionId => {
      if (built.has(sessionId)) return built.get(sessionId)
      const snapshot = input.projections[sessionId]
      const catalog: SubagentCatalogSnapshot | undefined =
        snapshot === undefined
          ? undefined
          : {
              state: snapshot.state === 'idle' ? (snapshot.values.subagentCatalog === undefined ? 'loading' : 'ready') : snapshot.state,
              error: snapshot.error,
              entries: (snapshot.values.subagentCatalog ?? []).map(entry => ({
                ...entry,
                activity: (input.statuses.get(entry.id)?.running ?? input.summaries[entry.id]?.running) === true ? ('running' as const) : ('inactive' as const),
              })),
            }
      built.set(sessionId, catalog)
      return catalog
    }
  }

  /**
   * A catalog's direct children counted by state, for the chip's summary: working while running, else the terminal
   * state every list surface reads (round 21 D4). A child with no known state yet counts in no part.
   */
  static countsOf(
    entries: readonly { readonly id: SessionId; readonly mode: string; readonly activity: 'running' | 'inactive' }[],
    summaries: Readonly<Record<SessionId, SessionSummary>>,
    failedTurns: ReadonlyMap<string, unknown>,
  ): WorkCounts {
    let working = 0
    let failed = 0
    let stopped = 0
    let done = 0
    for (const entry of entries) {
      const state = rowStateOf({
        external: entry.mode === 'external',
        running: entry.activity === 'running',
        failedTurn: failedTurns.has(entry.id),
        lastTurnCompleted: summaries[entry.id]?.projectionValues?.subagentTiming?.lastTurnCompleted,
      })
      if (state === 'working') working += 1
      else if (state === 'failed') failed += 1
      else if (state === 'stopped') stopped += 1
      else if (state === 'done') done += 1
    }
    return { working, failed, stopped, done }
  }

  /** The Session whose subagent catalog lists `childSessionId`, first match in projection order. */
  static parentOf(projections: CatalogProjections, childSessionId: SessionId): SessionId | undefined {
    for (const parentId in projections) {
      // SAFETY: projectionsBySession is keyed by SessionId; for-in widens keys to string.
      const catalog = projections[parentId as SessionId]?.values.subagentCatalog
      if (catalog === undefined) continue
      for (const entry of catalog) {
        if (entry.id !== childSessionId) continue
        // SAFETY: same key as above, a SessionId of projectionsBySession.
        return parentId as SessionId
      }
    }
    return undefined
  }
}

/**
 * The chip and the popover rows say what they say in thread-sidebar's own words, so a row is never built from two
 * dictionaries ("Sous-agents 2 working", C5).
 */
export interface SubagentCatalogCopy {
  /** "1 subagent", "3 subagents": the chip's fallback while no child's state is known. */
  readonly count: (count: number) => string
  /** The one count formula's words (council round 22, item 3): the chip reads `6 working · 1 failed`. */
  readonly summary: WorkCountWords
  readonly working: string
  readonly done: string
  readonly stopped: string
  readonly failed: string
}

/** Business actions supplied by the slot registration. */
export interface SubagentCatalogInjected {
  openChild: (address: SubagentAddress) => void
  openChildAside: (address: SubagentAddress) => void
  refreshProjection: (parentSessionId: SessionId) => void
  copy: SubagentCatalogCopy
}

/** Full props for the session-header lineage renderer. */
export type SubagentHeaderLineageProps = PropsRuntime<'conversation.session.header.lineage'> & SubagentCatalogInjected & PropsLocale<typeof NS>

interface CatalogRowsProps {
  parentSessionId: SessionId
  currentSessionId: SessionId | undefined
  catalog: SubagentCatalogSnapshot
  catalogOf: CatalogLookup
  summaries: Readonly<Record<SessionId, SessionSummary>>
  expanded: ReadonlySet<SessionId>
  level: number
  openChild: (address: SubagentAddress) => void
  openChildAside: (address: SubagentAddress) => void
  refreshProjection: (parentSessionId: SessionId) => void
  toggleBranch: (childSessionId: SessionId) => void
  closeCatalog: () => void
  copy: SubagentCatalogCopy
}

function treeItems(root: HTMLDivElement | null): HTMLElement[] {
  return root === null ? [] : Array.from(root.querySelectorAll<HTMLElement>('[role="treeitem"]:not([aria-disabled="true"])'))
}

/** Exact whole-second active-turn duration for one catalog row. */
function activityDuration(summary: SessionSummary | undefined, activity: 'running' | 'inactive', now: number): number | undefined {
  if (summary === undefined) return undefined
  const timing: SessionProjectionMap['subagentTiming'] | undefined = summary.projectionValues?.subagentTiming
  if (timing === undefined) return undefined
  if (timing.active === undefined) return timing.settledMs
  const end = activity === 'running' ? now : timing.active.through
  return timing.settledMs + Math.max(0, end - timing.active.since)
}

function SubagentSwitcherIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M5.99951 12.7L8.95546 14.9478C9.40011 15.2859 9.62244 15.455 9.87526 15.488C9.95774 15.4988 10.0413 15.4988 10.1238 15.488C10.3766 15.455 10.5989 15.2859 11.0436 14.9478L13.9995 12.7"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M13.9995 7.7417L11.0436 5.49387C10.5989 5.15574 10.3766 4.98668 10.1238 4.95362C10.0413 4.94283 9.95775 4.94283 9.87527 4.95362C9.62245 4.98668 9.40012 5.15574 8.95547 5.49387L5.99952 7.7417"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  )
}

/** Render catalog loading without inventing child membership. */
function CatalogLoadingRows({ t }: { t: TranslateNS<typeof NS> }) {
  return <div className={css.notice}>{t('loading.label')}</div>
}

/** A child becomes a known leaf only after its own authoritative catalog loads empty. */
function isKnownLeaf(catalog: SubagentCatalogSnapshot | undefined): boolean {
  return catalog?.state === 'ready' && catalog.entries.length === 0
}

/**
 * A child's glyph in the popover: working, done, failed or stopped (round 21 D4: the same terminal state as the
 * transcript and the list); nothing while none is known, and never Idle.
 */
const rowStateOf = (input: {
  readonly external: boolean
  readonly running: boolean
  readonly failedTurn: boolean
  readonly lastTurnCompleted: boolean | undefined
}): StatusGlyphState | undefined => {
  if (input.external) return undefined
  if (input.running) return 'working'
  const terminal = SubagentFeedModel.terminalOf(input)
  if (terminal === 'completed') return 'done'
  return terminal
}

const stateWordOf = (copy: SubagentCatalogCopy, state: StatusGlyphState | undefined): string | undefined => {
  if (state === 'working') return copy.working
  if (state === 'done') return copy.done
  if (state === 'stopped') return copy.stopped
  if (state === 'failed') return copy.failed
  return undefined
}

/** Render one catalog level and recurse only through explicitly expanded rows. */
function CatalogRows({
  parentSessionId,
  currentSessionId,
  catalog,
  catalogOf,
  summaries,
  expanded,
  level,
  openChild,
  openChildAside,
  refreshProjection,
  toggleBranch,
  closeCatalog,
  copy,
  t,
}: CatalogRowsProps & { t: TranslateNS<typeof NS> }) {
  const [now, setNow] = useState(() => Date.now())
  const failedTurns = useSubagentFailedTurns()
  const running = catalog.entries.some(entry => entry.activity === 'running')
  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => {
      setNow(Date.now())
    }, 1_000)
    return () => {
      clearInterval(timer)
    }
  }, [running])
  const emptyLoading = catalog.state === 'loading' && catalog.entries.length === 0
  const reserveDisclosure = catalog.entries.some(entry => entry.mode !== 'external' && !isKnownLeaf(catalogOf(entry.id)))
  return (
    <>
      {emptyLoading && <CatalogLoadingRows t={t} />}
      {catalog.state === 'error' && (
        <div className={css.error}>
          <span>{catalog.error?.message ?? t('load.error')}</span>
          <button
            type="button"
            className={css.refresh}
            onClick={() => {
              refreshProjection(parentSessionId)
            }}
          >
            <RefreshCwIcon strokeWidth={1.5} size={14} />
            {t('retry')}
          </button>
        </div>
      )}
      {catalog.entries.map(entry => {
        // An external execution has no local child Session, so it is a leaf that cannot be opened.
        const external = entry.mode === 'external'
        const childCatalog = catalogOf(entry.id)
        const isCurrent = entry.id === currentSessionId
        const isExpanded = expanded.has(entry.id)
        const knownLeaf = external || isKnownLeaf(childCatalog)
        const childLoading = childCatalog === undefined || (childCatalog.state === 'loading' && childCatalog.entries.length === 0)
        const summary = summaries[entry.id]
        const label = entry.label ?? entry.id
        const runningEntry = entry.activity === 'running'
        // The row is the child's glyph, its description and how long it worked; the child's own title (often the raw
        // prompt), its mode, its route and a token count stay out of it (C13).
        const rowState = rowStateOf({
          external,
          running: runningEntry,
          failedTurn: failedTurns.has(entry.id),
          lastTurnCompleted: summary?.projectionValues?.subagentTiming?.lastTurnCompleted,
        })
        const stateWord = stateWordOf(copy, rowState)
        const durationMs = activityDuration(summary, entry.activity, now)
        const duration = durationMs === undefined ? undefined : formatElapsed(durationMs)

        const open = (): void => {
          if (external) return
          openChild({
            parentSessionId,
            childSessionId: entry.id,
            mode: entry.mode,
          })
          closeCatalog()
        }
        const openAside = (event: MouseEvent<HTMLButtonElement>): void => {
          event.preventDefault()
          event.stopPropagation()
          if (external) return
          openChildAside({ parentSessionId, childSessionId: entry.id, mode: entry.mode })
          closeCatalog()
        }
        const handleKey = (event: KeyboardEvent<HTMLDivElement>): void => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            event.stopPropagation()
            open()
          } else if ((event.key === 'ArrowRight' && !knownLeaf && !isExpanded) || (event.key === 'ArrowLeft' && isExpanded)) {
            event.preventDefault()
            event.stopPropagation()
            toggleBranch(entry.id)
          }
        }
        const toggle = (event: MouseEvent<HTMLButtonElement>): void => {
          event.preventDefault()
          event.stopPropagation()
          toggleBranch(entry.id)
        }

        return (
          <div key={entry.id} className={css.node}>
            <div
              role="treeitem"
              tabIndex={external ? -1 : 0}
              aria-level={level}
              aria-current={isCurrent || undefined}
              aria-disabled={external || undefined}
              aria-label={[label, stateWord, duration].filter(value => value !== undefined).join(' · ')}
              {...(knownLeaf ? {} : { 'aria-expanded': isExpanded })}
              className={css.row}
              onClick={open}
              onKeyDown={handleKey}
            >
              {knownLeaf ? (
                reserveDisclosure && <span className={css.disclosureSpace} />
              ) : (
                <button
                  type="button"
                  tabIndex={-1}
                  className={`${css.disclosure} ${isExpanded ? css.disclosureOpen : ''}`}
                  aria-label={t(isExpanded ? 'branch.collapse' : 'branch.expand', { label })}
                  onClick={toggle}
                >
                  <ChevronRightIcon size={14} strokeWidth={1.5} />
                </button>
              )}
              <div className={css.clickarea}>
                <span className={css.rowActivitySlot}>{rowState === undefined ? null : <StatusGlyph status={rowState} decorative />}</span>
                <span className={css.content}>
                  <span className={`${css.label} ${isCurrent ? css.currentLabel : ''}`}>{label}</span>
                </span>
                {duration !== undefined && (
                  <span className={css.metrics}>
                    <span className={css.metricDuration}>{duration}</span>
                  </span>
                )}
                {!isCurrent && !external && (
                  <NativeTooltip label={t('open.sidebar')} side="bottom" align="end" portal>
                    <button
                      type="button"
                      className={css.sidebarButton}
                      aria-label={t('open.sidebar.aria', { label })}
                      onClick={openAside}
                      onKeyDown={event => {
                        event.stopPropagation()
                      }}
                    >
                      <ChevronRightIcon size={14} strokeWidth={1.5} />
                    </button>
                  </NativeTooltip>
                )}
              </div>
            </div>
            {isExpanded && !knownLeaf && (
              <div role="group" className={css.children} aria-busy={childLoading || undefined}>
                {childCatalog === undefined ? (
                  <CatalogLoadingRows t={t} />
                ) : (
                  <CatalogRows
                    parentSessionId={entry.id}
                    currentSessionId={currentSessionId}
                    catalog={childCatalog}
                    catalogOf={catalogOf}
                    summaries={summaries}
                    expanded={expanded}
                    level={level + 1}
                    openChild={openChild}
                    openChildAside={openChildAside}
                    refreshProjection={refreshProjection}
                    toggleBranch={toggleBranch}
                    closeCatalog={closeCatalog}
                    copy={copy}
                    t={t}
                  />
                )}
              </div>
            )}
          </div>
        )
      })}
    </>
  )
}

interface CatalogDropdownSharedProps extends SubagentCatalogInjected {
  /** Session whose direct catalog roots the tree. */
  rootSessionId: SessionId
  useSessions: SubagentHeaderLineageProps['useSessions']
  useSessionStatus: SubagentHeaderLineageProps['useSessionStatus']
  t: TranslateNS<typeof NS>
}

type CatalogDropdownProps = CatalogDropdownSharedProps &
  (
    | {
        /** Descendant-count control. */
        variant: 'count'
        currentSessionId?: never
        displayTitle?: never
        openTitle?: never
      }
    | {
        /** Current-title sibling switcher. */
        variant: 'switcher'
        /** Selected descendant highlighted in the catalog. */
        currentSessionId: SessionId
        /** Visible title included in the switcher's hover target. */
        displayTitle: string
        /** Optional ancestor navigation when the combined title is clicked. */
        openTitle?: () => void
      }
  )

const MENU_VIEWPORT_MARGIN = 16

/** Hover opens after 150 ms and closes after 120 ms; a click pins the menu open against hover-out. */
const catalogMenuHover = createHoverIntentMachine({ openDelayMs: 150, closeDelayMs: 120 })

/** Place a portaled catalog below its trigger without crossing the viewport edge. */
function catalogMenuPosition(trigger: HTMLButtonElement): CSSProperties {
  const rect = trigger.getBoundingClientRect()
  const width = Math.min(336, window.innerWidth - MENU_VIEWPORT_MARGIN * 2)
  return {
    top: rect.bottom + 5,
    left: Math.min(Math.max(MENU_VIEWPORT_MARGIN, rect.left), window.innerWidth - width - MENU_VIEWPORT_MARGIN),
  }
}

/** One trigger-plus-tree dropdown over the catalog rooted at `rootSessionId`. */
function CatalogDropdown({
  rootSessionId,
  currentSessionId,
  displayTitle,
  openTitle,
  variant,
  useSessions,
  useSessionStatus,
  openChild,
  openChildAside,
  refreshProjection,
  copy,
  t,
}: CatalogDropdownProps) {
  const ancestorSwitcher = variant === 'switcher' && openTitle !== undefined
  const sessionState = useSessions(HostSnapshotsModel.selectStableSessionListState)
  const projections = sessionState.projectionsBySession
  const summaries = sessionState.byId
  const statuses = useSessionStatus(HostSnapshotsModel.selectStableSessionStatus)
  const catalogOf = useMemo(() => SubagentCatalogs.lookup({ projections, summaries, statuses }), [projections, summaries, statuses])
  const catalog = catalogOf(rootSessionId)
  const [hoverMenu, sendHoverMenu] = useMachine(catalogMenuHover)
  const open = hoverMenu.matches('openHover') || hoverMenu.matches('openPinned')
  const [menuPosition, setMenuPosition] = useState<CSSProperties>()
  const [expanded, setExpanded] = useState<ReadonlySet<SessionId>>(() => new Set())
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const currentEntry = currentSessionId === undefined ? undefined : catalog?.entries.find(entry => entry.id === currentSessionId)
  const switcherDisplayTitle = currentEntry !== undefined ? (currentEntry.label ?? currentEntry.id) : displayTitle
  const directChildren = catalog?.entries ?? []
  const directCount = directChildren.length
  const runningCount = directChildren.filter(entry => entry.activity === 'running').length
  const failedTurns = useSubagentFailedTurns()
  // `6 working · 1 failed`, the formula every surface that summarises children reads (council round 22, item 3), with
  // the spinner only while one works; "3 subagents" only while no child's state is known yet.
  const countParts = workCountParts(
    variant === 'count' ? SubagentCatalogs.countsOf(directChildren, summaries, failedTurns) : {},
    copy.summary,
  )
  const countLabel = countParts.length === 0 ? copy.count(directCount) : countParts.map(part => part.text).join(WORK_COUNT_SEPARATOR)
  const presentedCatalog: SubagentCatalogSnapshot | undefined = catalog ?? (variant === 'switcher' ? { entries: [], state: 'loading', error: null } : undefined)

  const closeBranch = (root: SessionId): void => {
    const closing = new Set<SessionId>()
    const visit = (parentSessionId: SessionId): void => {
      if (closing.has(parentSessionId) || !expanded.has(parentSessionId)) return
      closing.add(parentSessionId)
      const branch = catalogOf(parentSessionId)
      for (const entry of branch?.entries ?? []) {
        visit(entry.id)
      }
    }
    visit(root)
    setExpanded(current => new Set([...current].filter(id => !closing.has(id))))
  }

  const toggleBranch = (childSessionId: SessionId): void => {
    if (expanded.has(childSessionId)) {
      closeBranch(childSessionId)
      return
    }
    setExpanded(current => new Set(current).add(childSessionId))
    refreshProjection(childSessionId)
  }

  useLayoutEffect(() => {
    if (!open) return
    const trigger = triggerRef.current
    /* v8 ignore next -- native resize or scroll can outlive the trigger */
    if (trigger === null) return
    setMenuPosition(catalogMenuPosition(trigger))
  }, [open])

  useEffect(() => {
    if (open) return
    setExpanded(current => (current.size === 0 ? current : new Set()))
  }, [open])

  useEffect(() => {
    if (!open) return
    const closeOutside = (event: PointerEvent): void => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target) && !menuRef.current?.contains(event.target)) {
        sendHoverMenu({ type: 'dismiss' })
      }
    }
    document.addEventListener('pointerdown', closeOutside)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
    }
  }, [open, sendHoverMenu])

  useEffect(() => {
    if (!open) return
    const placeMenu = (): void => {
      const trigger = triggerRef.current
      /* v8 ignore next -- native resize or scroll can outlive the trigger */
      if (trigger === null) return
      setMenuPosition(catalogMenuPosition(trigger))
    }
    window.addEventListener('resize', placeMenu)
    document.addEventListener('scroll', placeMenu, true)
    return () => {
      window.removeEventListener('resize', placeMenu)
      document.removeEventListener('scroll', placeMenu, true)
    }
  }, [open])

  // Visibility needs catalog evidence of children or a failed load worth retrying.
  // An empty loading catalog is not evidence of children.
  const visible = presentedCatalog !== undefined && (variant === 'switcher' || presentedCatalog.state === 'error' || presentedCatalog.entries.length > 0)
  useEffect(() => {
    if (visible) return
    sendHoverMenu({ type: 'hide' })
  }, [sendHoverMenu, visible])

  if (!visible) return null

  const focusAt = (index: number): void => {
    const items = treeItems(menuRef.current)
    if (items.length === 0) return
    items[(index + items.length) % items.length]?.focus()
  }

  const navigate = (event: KeyboardEvent<HTMLDivElement>): void => {
    const items = treeItems(menuRef.current)
    // SAFETY: indexOf only compares identity; a non-HTMLElement active element yields -1.
    const index = items.indexOf(document.activeElement as HTMLElement)
    if (event.key === 'Escape') {
      event.preventDefault()
      sendHoverMenu({ type: 'dismiss' })
      queueMicrotask(() => {
        triggerRef.current?.focus()
      })
    } else if (event.key === 'Home') {
      event.preventDefault()
      focusAt(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      focusAt(items.length - 1)
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      focusAt(index + 1)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      focusAt(index < 0 ? items.length - 1 : index - 1)
    }
  }

  return (
    <div
      className={`${css.root} ${variant === 'switcher' ? css.switcherRoot : ''}`}
      ref={rootRef}
      onKeyDown={navigate}
      onMouseLeave={() => sendHoverMenu({ type: 'leave' })}
    >
      <button
        ref={triggerRef}
        onMouseEnter={() => sendHoverMenu({ type: 'hover' })}
        type="button"
        className={variant === 'switcher' ? `${css.switcherTrigger} ${ancestorSwitcher ? css.ancestorSwitcherTrigger : ''}` : css.trigger}
        aria-haspopup="tree"
        aria-expanded={open}
        aria-label={
          variant === 'switcher'
            ? t('switcher.aria', { title: switcherDisplayTitle })
            : countLabel
        }
        onClick={
          openTitle === undefined
            ? () => {
                sendHoverMenu({ type: 'pin' })
              }
            : () => {
                sendHoverMenu({ type: 'dismiss' })
                openTitle()
              }
        }
        onKeyDown={event => {
          if (event.key !== 'ArrowDown') return
          event.preventDefault()
          if (!open) sendHoverMenu({ type: 'pin' })
          queueMicrotask(() => {
            focusAt(0)
          })
        }}
      >
        {variant === 'switcher' ? (
          <span className={css.switcherTitle}>{switcherDisplayTitle}</span>
        ) : (
          <>
            {runningCount > 0 && (
              <span className={css.activitySlot}>
                <StatusGlyph status="working" decorative />
              </span>
            )}
            <span className={css.count}>
              {countParts.length === 0
                ? countLabel
                : countParts.map((part, index) => (
                    <span key={part.key} className={part.tone === 'failed' ? css.countFailed : undefined}>
                      {index === 0 ? '' : WORK_COUNT_SEPARATOR}
                      {part.text}
                    </span>
                  ))}
            </span>
          </>
        )}
        {variant === 'switcher' ? <SubagentSwitcherIcon /> : <ChevronDownIcon size={14} strokeWidth={1.5} className={open ? css.triggerOpen : undefined} />}
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            className={css.menu}
            style={menuPosition}
            onMouseEnter={() => sendHoverMenu({ type: 'hover' })}
            onMouseLeave={() => sendHoverMenu({ type: 'leave' })}
          >
            <div className={css.menuBody} role="tree" aria-label={t('tree.aria')}>
              <CatalogRows
                parentSessionId={rootSessionId}
                currentSessionId={currentSessionId}
                catalog={presentedCatalog}
                catalogOf={catalogOf}
                summaries={summaries}
                expanded={expanded}
                level={1}
                openChild={openChild}
                openChildAside={openChildAside}
                refreshProjection={refreshProjection}
                toggleBranch={toggleBranch}
                closeCatalog={() => {
                  sendHoverMenu({ type: 'dismiss' })
                }}
                copy={copy}
                t={t}
              />
            </div>
          </div>,
          document.body,
        )}
    </div>
  )
}

/** Full props for the root-session catalog entry in the header actions band. */
export type SubagentCatalogActionProps = PropsRuntime<'conversation.session.header.actions'> & SubagentCatalogInjected & PropsLocale<typeof NS>

/**
 * Session-header catalog action for root sessions: the descendant count and
 * its dropdown at the start of the header actions band. Child sessions render nothing
 * here — their breadcrumb switcher in the lineage slot owns the same
 * navigation.
 * @param props - Session standard props plus the catalog actions and translator.
 * @returns The count dropdown, or null on a child session.
 */
export function SubagentCatalogAction({
  sessionId,
  useSessions,
  useSessionStatus,
  openChild,
  openChildAside,
  refreshProjection,
  copy,
  t,
}: SubagentCatalogActionProps) {
  const isChild = useSessions(state => state.byId[sessionId]?.origin === 'subagent')
  if (isChild) return null
  return (
    <CatalogDropdown
      key={sessionId}
      rootSessionId={sessionId}
      variant="count"
      useSessions={useSessions}
      useSessionStatus={useSessionStatus}
      openChild={openChild}
      openChildAside={openChildAside}
      refreshProjection={refreshProjection}
      copy={copy}
      t={t}
    />
  )
}

/**
 * Render one breadcrumb title together with its subagent navigation.
 * @param props - Breadcrumb title, session standard props, and catalog actions.
 * @returns A title-and-chevron sibling switcher, or nothing on a root session.
 */
export function SubagentHeaderLineage({
  lineageSessionId,
  displayTitle,
  openTitle,
  useSessions,
  useSession,
  useProjection,
  useSessionStatus,
  openChild,
  openChildAside,
  refreshProjection,
  copy,
  t,
}: SubagentHeaderLineageProps) {
  const address = useSession(session => session.subagent?.address)
  // The model this subagent runs on (council round 17 B1.1): the kit's mark and the model's name, never the provider id
  // or a backend such as "in-process".
  const route = SubagentRouteLabelModel.subagentRoute({ route: useProjection('threadSidebarModelRoute'), identity: useProjection('subagent') })
  const parentId = useSessions(state => {
    if (address?.childSessionId === lineageSessionId) return address.parentSessionId
    return SubagentCatalogs.parentOf(state.projectionsBySession, lineageSessionId)
  })
  const shared = { useSessions, useSessionStatus, openChild, openChildAside, refreshProjection, copy, t }
  // Root sessions carry no breadcrumb; their descendant count lives in the
  // header actions band (SubagentCatalogAction).
  if (parentId === undefined) return null
  return (
    <>
      <CatalogDropdown
        key={lineageSessionId}
        rootSessionId={parentId}
        currentSessionId={lineageSessionId}
        variant="switcher"
        displayTitle={displayTitle}
        {...(openTitle === undefined ? {} : { openTitle })}
        {...shared}
      />
      {openTitle === undefined && <CatalogDropdown key={`${lineageSessionId}-descendants`} rootSessionId={lineageSessionId} variant="count" {...shared} />}
      {route !== undefined && (
        <span className={cn('dshx-root', css.agentBadge)} data-subagent-route="">
          <RouteModel provider={route.provider} model={route.model} size="md" />
        </span>
      )}
    </>
  )
}
