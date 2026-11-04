/**
 * The frame's status strip row (`status-strip.ts`): global items left, thread items right. On a phone-width frame the
 * row collapses to one chip that opens the items as a list above it, so the strip never wraps or scrolls sideways.
 */
import { useRegistry } from '@dshfiles/dshx/client'
import { Component, useMemo, useState } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { StatusItems, StatusStripModel, type StatusItem } from '../../status-strip.ts'
import css from './AppFrame.module.css'

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

const renderItem = (item: StatusItem, props: { readonly compact: boolean; readonly useSessions: PropsRuntime<'root'>['useSessions'] }): ReactNode => {
  const View = item.component
  return (
    <span key={item.id} className={css.statusItem} data-status-item={item.id} data-status-side={item.side}>
      <ItemBoundary id={item.id}>
        <View compact={props.compact} useSessions={props.useSessions} />
      </ItemBoundary>
    </span>
  )
}

/** Renders nothing until a plugin adds an item, so a profile without providers keeps the frame exactly as before. */
export function StatusStrip({ narrow, useSessions }: { readonly narrow: boolean; readonly useSessions: PropsRuntime<'root'>['useSessions'] }) {
  const items = useRegistry(StatusItems)
  const arranged = useMemo(() => StatusStripModel.arrange(items), [items])
  const [open, setOpen] = useState(false)
  const count = arranged.global.length + arranged.thread.length
  if (count === 0) return null
  if (narrow) {
    return (
      <div className={css.statusStrip} data-status-strip="compact" role="status">
        <button type="button" className={css.statusChip} aria-expanded={open} onClick={() => setOpen(current => !current)}>
          <span aria-hidden="true" className={css.statusChipDot} />
          Status
        </button>
        {open ? (
          <div className={css.statusSheet} role="list" aria-label="Status">
            {[...arranged.global, ...arranged.thread].map(item => (
              <div key={item.id} role="listitem" className={css.statusSheetRow}>
                <span className={css.statusSheetLabel}>{item.label}</span>
                {renderItem(item, { compact: true, useSessions })}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    )
  }
  return (
    <div className={css.statusStrip} data-status-strip="full" role="status" aria-label="Status">
      <div className={css.statusSide}>{arranged.global.map(item => renderItem(item, { compact: false, useSessions }))}</div>
      <div className={css.statusSide} data-side="thread">
        {arranged.thread.map(item => renderItem(item, { compact: false, useSessions }))}
      </div>
    </div>
  )
}
