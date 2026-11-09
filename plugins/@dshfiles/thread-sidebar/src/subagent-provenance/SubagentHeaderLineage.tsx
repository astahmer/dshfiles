import { useMemo, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import type { SessionProjectionMap, SessionSummary, SessionProjectionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SubagentAddress } from '@deepseek-ai/dsh-subagent/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  IconChevronDownOutlineRegular,
  IconChevronRightOutlineRegular,
  IconRefreshOutlineRegular,
  StateDot,
  Tooltip as NativeTooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { createHoverIntentMachine, useMachine } from '@dshfiles/plugin-ui/machine'
import { HostSnapshotsModel } from '../snapshots.js'
import { NS } from './locales.js'
import { SubagentRouteLabelModel } from './route-label.js'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-token-meter/client'
import css from './SubagentHeaderLineage.module.css'

type SubagentCatalogSnapshot = Omit<SessionProjectionSnapshot, 'values' | 'state'> & {
  state: 'loading' | 'ready' | 'error' | 'migration-required'
  entries: (SessionProjectionMap['subagentCatalog'][number] & { activity: 'running' | 'inactive' })[]
}
type Catalogs = Readonly<Record<SessionId, SubagentCatalogSnapshot>>

/** Child → catalog parent, folded once per projection snapshot: every mounted header asks on every list change. */
class SubagentParentIndex {
  private static readonly bySnapshot = new WeakMap<object, ReadonlyMap<string, SessionId>>()

  static of(
    projections: Readonly<Record<SessionId, { readonly values: { readonly subagentCatalog?: readonly { readonly id: string }[] } }>>,
  ): ReadonlyMap<string, SessionId> {
    const cached = SubagentParentIndex.bySnapshot.get(projections)
    if (cached !== undefined) return cached
    const parents = new Map<string, SessionId>()
    for (const [parentId, snapshot] of Object.entries(projections)) {
      for (const entry of snapshot.values.subagentCatalog ?? []) {
        if (parents.has(entry.id)) continue
        // SAFETY: projectionsBySession is keyed by SessionId; Object.entries widens keys to string.
        parents.set(entry.id, parentId as SessionId)
      }
    }
    SubagentParentIndex.bySnapshot.set(projections, parents)
    return parents
  }
}

/** Business actions supplied by the slot registration. */
export interface SubagentCatalogInjected {
  openChild: (address: SubagentAddress) => void
  openChildAside: (address: SubagentAddress) => void
  refreshProjection: (parentSessionId: SessionId) => void
}

/** Full props for the session-header lineage renderer. */
export type SubagentHeaderLineageProps = PropsRuntime<'conversation.session.header.lineage'> & SubagentCatalogInjected & PropsLocale<typeof NS>

interface CatalogRowsProps {
  parentSessionId: SessionId
  currentSessionId: SessionId | undefined
  catalog: SubagentCatalogSnapshot
  catalogs: Catalogs
  summaries: Readonly<Record<SessionId, SessionSummary>>
  expanded: ReadonlySet<SessionId>
  level: number
  openChild: (address: SubagentAddress) => void
  openChildAside: (address: SubagentAddress) => void
  refreshProjection: (parentSessionId: SessionId) => void
  toggleBranch: (childSessionId: SessionId) => void
  closeCatalog: () => void
}

function treeItems(root: HTMLDivElement | null): HTMLElement[] {
  return root === null ? [] : Array.from(root.querySelectorAll<HTMLElement>('[role="treeitem"]:not([aria-disabled="true"])'))
}

/** Compact token count shared in shape with the conversation stats strip. */
function formatTokens(value: number, t: TranslateNS<typeof NS>): string {
  const scaled = (next: number): string => (next >= 100 ? String(Math.round(next)) : String(Math.round(next * 10) / 10))
  if (value < 1_000) return String(value)
  if (value < 1_000_000) return t('tokens.thousand', { value: scaled(value / 1_000) })
  return t('tokens.million', { value: scaled(value / 1_000_000) })
}

/** Sum the four disjoint durable provider-usage buckets. */
function tokenTotal(usage: SessionProjectionMap['tokenUsage'] | undefined): number | undefined {
  return usage === undefined ? undefined : usage.uncachedInputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheWriteTokens
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

interface DurationParts {
  seconds: number
  minutes: number
  hours: number
  days: number
  totalMinutes: number
  totalHours: number
}

function splitDuration(ms: number): DurationParts {
  const totalSeconds = Math.floor(Math.max(0, ms) / 1_000)
  const totalMinutes = Math.floor(totalSeconds / 60)
  const totalHours = Math.floor(totalMinutes / 60)
  return {
    seconds: totalSeconds % 60,
    minutes: totalMinutes % 60,
    hours: totalHours % 24,
    days: Math.floor(totalHours / 24),
    totalMinutes,
    totalHours,
  }
}

/** Format a duration with decreasing visual precision at larger scales. */
function formatDuration(ms: number, t: TranslateNS<typeof NS>): string {
  const { seconds, minutes, hours, days, totalMinutes, totalHours } = splitDuration(ms)
  if (days >= 365) {
    const years = Math.floor(days / 365)
    const months = Math.floor((days % 365) / 30)
    return months === 0 ? t('duration.years', { years }) : t('duration.yearsMonths', { years, months })
  }
  if (days >= 30) {
    const months = Math.floor(days / 30)
    const remainingDays = days % 30
    return remainingDays === 0 ? t('duration.months', { months }) : t('duration.monthsDays', { months, days: remainingDays })
  }
  if (days > 0) {
    return hours === 0 ? t('duration.days', { days }) : t('duration.daysHours', { days, hours })
  }
  if (totalHours > 0) {
    return t('duration.hours', {
      hours: totalHours,
      minutes: String(minutes).padStart(2, '0'),
      seconds: String(seconds).padStart(2, '0'),
    })
  }
  if (totalMinutes > 0) {
    return t('duration.minutes', {
      minutes: totalMinutes,
      seconds: String(seconds).padStart(2, '0'),
    })
  }
  return t('duration.seconds', { seconds })
}

/** Preserve exact whole seconds for hover and accessible naming. */
function formatExactDuration(ms: number, t: TranslateNS<typeof NS>): string {
  const { seconds, minutes, hours, days } = splitDuration(ms)
  return days === 0
    ? formatDuration(ms, t)
    : t('duration.exactDays', {
        days,
        hours: String(hours).padStart(2, '0'),
        minutes: String(minutes).padStart(2, '0'),
        seconds: String(seconds).padStart(2, '0'),
      })
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

const modeLabelOf = (props: {
  readonly mode: SubagentCatalogSnapshot['entries'][number]['mode']
  readonly external: boolean
  readonly t: TranslateNS<typeof NS>
}): string => {
  if (props.external) return props.t('mode.external')
  if (props.mode === 'unknown') return props.t('mode.unknown')
  if (props.mode === 'one-shot') return props.t('mode.oneShot')
  return props.t('mode.continuable')
}

const activityLabelOf = (props: {
  readonly external: boolean
  readonly running: boolean
  readonly completed: boolean
  readonly t: TranslateNS<typeof NS>
}): string | undefined => {
  if (props.external) return undefined
  if (props.running) return props.t('activity.running')
  if (props.completed) return props.t('activity.completed')
  return props.t('activity.inactive')
}

/** Render one catalog level and recurse only through explicitly expanded rows. */
function CatalogRows({
  parentSessionId,
  currentSessionId,
  catalog,
  catalogs,
  summaries,
  expanded,
  level,
  openChild,
  openChildAside,
  refreshProjection,
  toggleBranch,
  closeCatalog,
  t,
}: CatalogRowsProps & { t: TranslateNS<typeof NS> }) {
  const [now, setNow] = useState(() => Date.now())
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
  const reserveDisclosure = catalog.entries.some(entry => entry.mode !== 'external' && !isKnownLeaf(catalogs[entry.id]))
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
            <IconRefreshOutlineRegular size={14} />
            {t('retry')}
          </button>
        </div>
      )}
      {catalog.entries.map(entry => {
        // An external execution has no local child Session, so it is a leaf that cannot be opened.
        const external = entry.mode === 'external'
        const childCatalog = catalogs[entry.id]
        const isCurrent = entry.id === currentSessionId
        const isExpanded = expanded.has(entry.id)
        const knownLeaf = external || isKnownLeaf(childCatalog)
        const childLoading = childCatalog === undefined || (childCatalog.state === 'loading' && childCatalog.entries.length === 0)
        const summary = summaries[entry.id]
        const label = entry.label ?? entry.id
        const mode = modeLabelOf({ mode: entry.mode, external, t })
        const runningEntry = entry.activity === 'running'
        const completed = !external && !runningEntry && summary?.projectionValues?.subagentTiming?.lastTurnCompleted === true
        const activity = activityLabelOf({ external, running: runningEntry, completed, t })
        const agentRoute = SubagentRouteLabelModel.displayedAgentRouteLabel(
          summary?.projectionValues?.threadSidebarModelRoute,
          summary?.projectionValues?.subagent,
        )
        const secondary = [summary?.title, mode, agentRoute, runningEntry ? undefined : activity].filter(value => value !== undefined).join(' · ')
        const totalTokens = tokenTotal(summary?.projectionValues?.tokenUsage)
        const durationMs = activityDuration(summary, entry.activity, now)
        const tokenMetric = totalTokens === undefined ? undefined : t('tokens.total', { value: formatTokens(totalTokens, t) })
        const durationMetric =
          durationMs === undefined
            ? undefined
            : {
                compact: formatDuration(durationMs, t),
                exact: formatExactDuration(durationMs, t),
              }
        const metrics = [tokenMetric, durationMetric?.exact].filter(value => value !== undefined).join(' · ')

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
              aria-label={[label, secondary, runningEntry ? activity : undefined, metrics].filter(value => value !== undefined && value !== '').join(' ')}
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
                  <IconChevronRightOutlineRegular />
                </button>
              )}
              <div className={css.clickarea}>
                <span className={css.rowActivitySlot}>
                  <StateDot state={entry.activity === 'running' ? 'ongoing' : completed ? 'done' : 'idle'} />
                </span>
                <span className={css.content}>
                  <span className={`${css.label} ${isCurrent ? css.currentLabel : ''}`}>{label}</span>
                  <span className={css.summary}>{secondary}</span>
                  {runningEntry && activity !== undefined && (
                    <span className={css.activityStatus} role="status">
                      {activity}
                    </span>
                  )}
                </span>
                {metrics !== '' && (
                  <span className={css.metrics}>
                    {tokenMetric !== undefined && <span className={css.metricToken}>{tokenMetric}</span>}
                    {durationMetric !== undefined && (
                      <NativeTooltip label={t('duration.exactTitle', { duration: durationMetric.exact })} side="bottom">
                        <span className={css.metricDuration}>{durationMetric.compact}</span>
                      </NativeTooltip>
                    )}
                  </span>
                )}
                {!isCurrent && !external && (
                  <NativeTooltip label={t('open.sidebar')} side="bottom" align="end">
                    <button
                      type="button"
                      className={css.sidebarButton}
                      aria-label={t('open.sidebar.aria', { label })}
                      onClick={openAside}
                      onKeyDown={event => {
                        event.stopPropagation()
                      }}
                    >
                      <IconChevronRightOutlineRegular />
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
                    catalogs={catalogs}
                    summaries={summaries}
                    expanded={expanded}
                    level={level + 1}
                    openChild={openChild}
                    openChildAside={openChildAside}
                    refreshProjection={refreshProjection}
                    toggleBranch={toggleBranch}
                    closeCatalog={closeCatalog}
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
  t,
}: CatalogDropdownProps) {
  const ancestorSwitcher = variant === 'switcher' && openTitle !== undefined
  const sessionState = useSessions(HostSnapshotsModel.selectStableSessionListState)
  const projections = sessionState.projectionsBySession
  const summaries = sessionState.byId
  const statuses = useSessionStatus(HostSnapshotsModel.selectStableSessionStatus)
  const catalogs = useMemo<Catalogs>(
    () =>
      Object.fromEntries(
        Object.entries(projections).map(([id, snapshot]) => [
          id,
          {
            state: snapshot.state === 'idle' ? (snapshot.values.subagentCatalog === undefined ? 'loading' : 'ready') : snapshot.state,
            error: snapshot.error,
            entries: (snapshot.values.subagentCatalog ?? []).map(entry => ({
              ...entry,
              activity: (statuses.get(entry.id)?.running ?? summaries[entry.id]?.running) === true ? ('running' as const) : ('inactive' as const),
            })),
          },
        ]),
      ),
    [projections, summaries, statuses],
  )
  const catalog = catalogs[rootSessionId]
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
  const totalCountKey = directCount === 1 ? 'count.total.one' : 'count.total.other'
  const runningCountKey = runningCount === 1 ? 'count.running.one' : 'count.running.other'
  const presentedCatalog: SubagentCatalogSnapshot | undefined = catalog ?? (variant === 'switcher' ? { entries: [], state: 'loading', error: null } : undefined)

  const closeBranch = (root: SessionId): void => {
    const closing = new Set<SessionId>()
    const visit = (parentSessionId: SessionId): void => {
      if (closing.has(parentSessionId) || !expanded.has(parentSessionId)) return
      closing.add(parentSessionId)
      const branch = catalogs[parentSessionId]
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
            : t(runningCount > 0 ? runningCountKey : totalCountKey, { count: runningCount > 0 ? runningCount : directCount })
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
                <StateDot state="ongoing" />
              </span>
            )}
            <span className={css.count}>{t(totalCountKey, { count: runningCount > 0 ? `${runningCount}/${directCount}` : directCount })}</span>
          </>
        )}
        {variant === 'switcher' ? <SubagentSwitcherIcon /> : <IconChevronDownOutlineRegular className={open ? css.triggerOpen : undefined} />}
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
                catalogs={catalogs}
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
  t,
}: SubagentHeaderLineageProps) {
  const address = useSession(session => session.subagent?.address)
  const agentLabel = SubagentRouteLabelModel.displayedAgentRouteLabel(useProjection('threadSidebarModelRoute'), useProjection('subagent'))
  const parentId = useSessions(state => {
    if (address?.childSessionId === lineageSessionId) return address.parentSessionId
    return SubagentParentIndex.of(state.projectionsBySession).get(lineageSessionId)
  })
  const shared = { useSessions, useSessionStatus, openChild, openChildAside, refreshProjection, t }
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
      {agentLabel !== undefined && (
        <span className={css.agentBadge} title={agentLabel}>
          {agentLabel}
        </span>
      )}
    </>
  )
}
