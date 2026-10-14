/**
 * Ported from @deepseek-ai/dsh-client-ui-settings-general@0.2.0-rc.2 (MIT): `SettingsPanel` in `SettingsRoot.js`.
 * Body-portaled modal layer: full-viewport mask and centered panel, closed by the header button, a mask click and
 * document-level Escape.
 */
import {
  IconAgentPresetOutlineMedium,
  IconArchiveOutlineMedium,
  IconCloseOutlineRegular,
  IconDataOutlineMedium,
  IconPersonalizationOutlineMedium,
  IconSettingsOutlineMedium,
  IconUserOutlineMedium,
  useModalLayer,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { ShellRenderSlot } from './slots.js'

export interface SectionRow {
  readonly id: string
  readonly order: number
  readonly label: string
}

/** Nav glyph by section id; unknown ids fall back to the settings gear. */
export const navIcon = (id: string): JSX.Element => {
  const className = 'dshx:flex-none'
  if (id === 'account') return <IconUserOutlineMedium className={className} size={16} />
  if (id === 'models') return <IconDataOutlineMedium className={className} size={16} />
  if (id === 'agent-presets') return <IconAgentPresetOutlineMedium className={className} size={16} />
  if (id === 'plugins') return <IconPersonalizationOutlineMedium className={className} size={16} />
  if (id === 'archived-sessions') return <IconArchiveOutlineMedium className={className} size={16} />
  return <IconSettingsOutlineMedium className={className} size={16} />
}

export const SettingsPanel = (props: {
  readonly rows: readonly SectionRow[]
  readonly renderSlot: ShellRenderSlot
  readonly activeId: string | undefined
  readonly onSelect: (sectionId: string) => void
  readonly onClose: () => void
}): JSX.Element => {
  const active = props.rows.find(row => row.id === props.activeId)?.id ?? props.rows[0]?.id
  const titleId = useId()
  const panel = useRef<HTMLDivElement>(null)
  useModalLayer(panel, true, props.onClose)
  return createPortal(
    <div className="dshx:fixed dshx:inset-0 dshx:z-[1000] dshx:flex dshx:items-center dshx:justify-center" role="presentation">
      <div
        aria-hidden="true"
        className="dshx:absolute dshx:inset-x-0 dshx:top-[var(--dsh-frame-chrome-top,0px)] dshx:bottom-0 dshx:bg-[var(--dsw-alias-bg-mask-1)] dshx:backdrop-blur-[var(--dsw-mask-blur)]"
        onClick={props.onClose}
      />
      <div
        aria-labelledby={titleId}
        aria-modal="true"
        className="dshx:relative dshx:z-[1] dshx:flex dshx:h-[min(800px,calc(100vh-2*max(24px,var(--dsh-frame-overlay-top,24px))))] dshx:w-[800px] dshx:max-w-[calc(100vw-48px)] dshx:overflow-hidden dshx:rounded-[var(--dsw-radius-panel)] dshx:bg-[var(--dsw-alias-bg-layer-2)] dshx:shadow-[var(--dsw-elevation-prominent)] dshx:outline-none"
        data-shortcut-modal="settings"
        ref={panel}
        role="dialog"
        tabIndex={-1}
      >
        <nav className="dshx:box-border dshx:flex dshx:w-[188px] dshx:flex-none dshx:flex-col dshx:gap-[18px] dshx:px-3 dshx:pt-[22px]">
          <div
            className="dshx:px-3 dshx:text-[16px] dshx:leading-6 dshx:font-medium dshx:text-[var(--dsw-alias-label-primary)]"
            data-modal-autofocus={active === undefined ? '' : undefined}
            id={titleId}
            tabIndex={-1}
          >
            {props.renderSlot('settings.header', {})}
          </div>
          <div className="dshx:flex dshx:flex-col dshx:gap-1 dshx:overflow-y-auto">
            {props.rows.map(row => (
              <button
                aria-current={row.id === active ? 'true' : undefined}
                className={cn(
                  'dshx:box-border dshx:flex dshx:h-10 dshx:cursor-pointer dshx:items-center dshx:gap-2 dshx:rounded-[var(--dsw-radius-md)] dshx:border-none dshx:bg-transparent dshx:py-[9px] dshx:pr-4 dshx:pl-3 dshx:text-left dshx:text-[14px] dshx:leading-[22px] dshx:font-normal dshx:text-[var(--dsw-alias-label-primary)] dshx:hover:bg-[var(--dsw-specific-sidebar-nav-item-hover)]',
                  row.id === active && 'dshx:bg-[var(--dsw-specific-sidebar-nav-item-active)]',
                )}
                data-modal-autofocus={row.id === active ? '' : undefined}
                key={row.id}
                onClick={() => props.onSelect(row.id)}
                type="button"
              >
                {navIcon(row.id)}
                <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate">{row.label}</span>
              </button>
            ))}
          </div>
        </nav>
        <div className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-col">
          <div className="dshx:box-border dshx:flex dshx:h-[54px] dshx:flex-none dshx:items-start dshx:justify-between dshx:gap-2 dshx:pt-5 dshx:pr-3.5 dshx:pb-2 dshx:pl-2.5">
            <div className="dshx:ml-auto dshx:flex dshx:min-w-0 dshx:items-center dshx:justify-end dshx:gap-2">{props.renderSlot('settings.action', {})}</div>
            <button
              className="dshx:inline-flex dshx:size-7 dshx:cursor-pointer dshx:items-center dshx:justify-center dshx:rounded-[var(--dsw-radius-sm)] dshx:border-none dshx:bg-transparent dshx:p-0 dshx:text-[var(--dsw-alias-label-primary)] dshx:hover:bg-[var(--dsw-alias-interactive-bg-hover)]"
              onClick={props.onClose}
              type="button"
            >
              <IconCloseOutlineRegular size={14} />
              <span className="dshx:sr-only">{props.renderSlot('settings.close', {})}</span>
            </button>
          </div>
          <div className="dshx:min-h-0 dshx:flex-1 dshx:overflow-y-auto dshx:px-6 dshx:pb-6">
            {active !== undefined && props.renderSlot('settings.section', { close: props.onClose }, { only: active })}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
