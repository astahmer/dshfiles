/**
 * The frame's status strip row (`status-strip.ts`): global items left, thread items right. On a phone-width frame the
 * row collapses to one chip that opens the items as a list above it, so the strip never wraps or scrolls sideways.
 */
import { useRegistry } from '@dshfiles/dshx/client'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@dshfiles/plugin-ui/components/ui/context-menu'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@dshfiles/plugin-ui/components/ui/dropdown-menu'
import { EyeOffIcon } from '@dshfiles/plugin-ui/icons'
import { Component, createContext, memo, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ComponentType, ErrorInfo, ReactNode } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { openStatusBarSettings } from '../../status-bar.ts'
import { StatusItems, type StatusItem } from '../../status-strip.ts'
import { DEFAULT_STATUS_STRIP_PREFERENCES, StatusStripPreferencesModel } from '../../status-strip-preferences.ts'
import { useStatusStripSettings, type StatusStripSettings } from '../../status-strip-settings.ts'
import { StatusSummaryModel } from '../../status-summary.ts'
import css from './AppFrame.module.css'

export interface StatusStripProps {
  readonly narrow: boolean
  readonly useSessions: PropsRuntime<'root'>['useSessions']
}

/** One item that throws hides itself instead of the frame. */
class ItemBoundary extends Component<{ readonly id: string; readonly children: ReactNode }, { readonly failed: boolean }> {
  override state = { failed: false }
  static getDerivedStateFromError(): { readonly failed: boolean } {
    return { failed: true }
  }
  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.warn(`[frame-layout] status item ${this.props.id} failed`, error, info.componentStack)
  }
  override render(): ReactNode {
    return this.state.failed ? null : this.props.children
  }
}

/** "Show <item>" for each hidden item, so a hidden item comes back where the user hid it. */
const showHiddenActions = (settings: StatusStripSettings, hidden: readonly StatusItem[]): readonly { readonly id: string; readonly label: string; readonly run: () => void }[] => {
  const save = settings.save
  if (save === undefined) return []
  return hidden.map(item => ({
    id: item.id,
    label: `Show ${item.label}`,
    run: () => save(StatusStripPreferencesModel.setHidden({ preferences: settings.preferences, id: item.id, hidden: false })),
  }))
}

/**
 * Every item hidden: the strip keeps one small control instead of vanishing, so the items come back in place rather than
 * only through Settings.
 */
const HiddenItemsControl = (props: { readonly settings: StatusStripSettings; readonly hidden: readonly StatusItem[] }): ReactNode => (
  <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <button type="button" className={css.statusItemButton} aria-label="Show hidden status items" data-status-restore="">
        <EyeOffIcon aria-hidden="true" size={12} />
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent className="dshx-root" align="start" side="top">
      {showHiddenActions(props.settings, props.hidden).map(action => (
        <DropdownMenuItem key={action.id} onSelect={action.run}>
          {action.label}
        </DropdownMenuItem>
      ))}
      {props.settings.save === undefined ? null : <DropdownMenuSeparator />}
      <DropdownMenuItem onSelect={openStatusBarSettings}>Status bar settings…</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
)

const StatusItemView = (props: {
  readonly item: StatusItem
  readonly compact: boolean
  readonly useSessions: StatusStripProps['useSessions']
  readonly settings: StatusStripSettings
  readonly hidden: readonly StatusItem[]
}): ReactNode => {
  const { item, settings } = props
  const showActions = showHiddenActions(settings, props.hidden)
  const View = item.component
  const content = (
    <ItemBoundary id={item.id}>
      <View compact={props.compact} useSessions={props.useSessions} />
    </ItemBoundary>
  )
  const hide = settings.save
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <span className={css.statusItem} data-status-item={item.id} data-status-side={item.side} data-status-controls={item.controls === true ? '' : undefined}>
          {item.open === undefined || item.controls === true ? (
            content
          ) : (
            <button type="button" className={css.statusItemButton} onClick={item.open}>
              {content}
            </button>
          )}
        </span>
      </ContextMenuTrigger>
      <ContextMenuContent className="dshx-root">
        {item.open === undefined ? null : <ContextMenuItem onSelect={item.open}>Open {item.label}</ContextMenuItem>}
        {hide === undefined ? null : (
          <ContextMenuItem onSelect={() => hide(StatusStripPreferencesModel.setHidden({ preferences: settings.preferences, id: item.id, hidden: true }))}>
            Hide this item
          </ContextMenuItem>
        )}
        {showActions.length === 0 ? null : <ContextMenuSeparator />}
        {showActions.map(action => (
          <ContextMenuItem key={action.id} onSelect={action.run}>
            {action.label}
          </ContextMenuItem>
        ))}
        <ContextMenuItem onSelect={openStatusBarSettings}>Status bar settings…</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

/**
 * An item's visible words, one space between adjacent elements ("CC1" and "56%" stay two words). A subtree marked
 * `data-status-detail` belongs to the opened list only, so the pill skips it.
 */
const textOf = (element: Element): string => {
  const parts: string[] = []
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
    acceptNode: node => (node.parentElement?.closest('[data-status-detail]') === null ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
  })
  while (walker.nextNode() !== null) parts.push(walker.currentNode.textContent ?? '')
  return parts.join(' ')
}

/** Renders nothing until a plugin adds a visible item, so a profile without providers keeps the frame exactly as before. */
const StatusStripRow = (props: StatusStripProps & { readonly settings: StatusStripSettings }): ReactNode => {
  const items = useRegistry(StatusItems)
  const preferences = props.settings.preferences
  const arranged = useMemo(() => StatusStripPreferencesModel.visible(items, preferences), [items, preferences])
  const hidden = useMemo(() => StatusStripPreferencesModel.hiddenItems(items, preferences), [items, preferences])
  const [open, setOpen] = useState(false)
  const count = arranged.global.length + arranged.thread.length
  // The phone pill reads what its items say ("1 working · Quota 56%"), never a bare "Status": the items render once
  // more, hidden, and the pill reads their text in strip order.
  const measureRef = useRef<HTMLDivElement | null>(null)
  const [summary, setSummary] = useState('')
  useEffect(() => {
    const measure = measureRef.current
    if (!props.narrow || measure === null) return
    const read = (): void => {
      setSummary(
        StatusSummaryModel.summarize(
          Array.from(measure.children, child => ({ label: child.getAttribute('data-status-label') ?? '', text: textOf(child) })),
        ),
      )
    }
    const observer = new MutationObserver(read)
    observer.observe(measure, { subtree: true, childList: true, characterData: true })
    read()
    return () => observer.disconnect()
  }, [props.narrow, count])
  const renderItem = (item: StatusItem, compact: boolean): ReactNode => (
    <StatusItemView key={item.id} item={item} compact={compact} useSessions={props.useSessions} settings={props.settings} hidden={hidden} />
  )
  if (count === 0 && hidden.length === 0) return null
  if (count === 0) {
    return (
      <div className={css.statusStrip} data-status-strip={props.narrow ? 'compact' : 'hidden'} role="status" aria-label="Status">
        <div className={css.statusSide}>
          <HiddenItemsControl settings={props.settings} hidden={hidden} />
        </div>
      </div>
    )
  }
  if (props.narrow) {
    return (
      <div className={css.statusStrip} data-status-strip="compact" role="status">
        <div ref={measureRef} hidden>
          {[...arranged.global, ...arranged.thread].map(item => (
            <span key={item.id} data-status-label={item.summaryLabel === false ? '' : item.label}>
              <ItemBoundary id={item.id}>
                <item.component compact useSessions={props.useSessions} />
              </ItemBoundary>
            </span>
          ))}
        </div>
        <button
          type="button"
          className={css.statusChip}
          aria-expanded={open}
          aria-label={summary === '' ? 'Status' : `Status: ${summary}`}
          data-status-summary={summary}
          onClick={() => setOpen(current => !current)}
        >
          <span aria-hidden="true" className={css.statusChipDot} />
          <span className={css.statusChipLabel}>{summary === '' ? 'Status' : summary}</span>
        </button>
        {open ? (
          <div className={css.statusSheet} role="list" aria-label="Status">
            {[...arranged.global, ...arranged.thread].map(item => (
              <div key={item.id} role="listitem" className={css.statusSheetRow}>
                <span className={css.statusSheetLabel}>{item.label}</span>
                {renderItem(item, true)}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    )
  }
  return (
    <div className={css.statusStrip} data-status-strip="full" role="status" aria-label="Status">
      <div className={css.statusSide}>
        {arranged.global.map(item => renderItem(item, false))}
        {hidden.length === 0 ? null : <HiddenItemsControl settings={props.settings} hidden={hidden} />}
      </div>
      <div className={css.statusSide} data-side="thread">
        {arranged.thread.map(item => renderItem(item, false))}
      </div>
    </div>
  )
}

const DEFAULT_SETTINGS: StatusStripSettings = { preferences: DEFAULT_STATUS_STRIP_PREFERENCES, error: null }

const DefaultStatusStrip = (props: StatusStripProps): ReactNode => <StatusStripRow {...props} settings={DEFAULT_SETTINGS} />

/** The strip with the user's choices; the frame's client decorates it so `useSettings` reads this plugin's context. */
export const SettingsStatusStrip = (props: StatusStripProps): ReactNode => <StatusStripRow {...props} settings={useStatusStripSettings()} />

/** Which strip the frame renders: the decorated settings strip once the client provides it, the default order before. */
export const StatusStripSeat = createContext<ComponentType<StatusStripProps>>(DefaultStatusStrip)

export const StatusStrip = memo((props: StatusStripProps) => {
  const Seat = useContext(StatusStripSeat)
  return <Seat {...props} />
})
