/**
 * Ported from @deepseek-ai/dsh-client-ui-settings-general@0.2.1-rc.2 (MIT): `GeneralSection.js`,
 * `CurrentVersionRow.js`, `DeveloperToolsRow.js` and `chrome.js`.
 */
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import { IconSettingsOutlineMedium, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import { useEffect, useRef, useState } from 'react'
import type { ShellTranslate } from './locales.js'
import { useObservable } from './use-observable.js'
import { DshReleaseIndicator } from '../release-notice.js'

/** The control a search entry names: the row tagged with its id, focused on its first control. */
const revealSettingsEntry = (input: { readonly container: HTMLElement; readonly entryId: string }): boolean => {
  const row = input.container.querySelector<HTMLElement>(`[data-settings-entry="${CSS.escape(input.entryId)}"]`)
  if (row === null) return false
  row.scrollIntoView({ block: 'center' })
  const focusable = row.querySelector<HTMLElement>('button, input, select, textarea, [role="switch"], [tabindex]:not([tabindex="-1"])') ?? row
  focusable.focus({ preventScroll: true })
  return true
}

/** The General section column; rows come from `settings.general.item` registrants. */
export const GeneralSection = (
  props: Pick<PropsRenderSlots<'settings.general.item'>, 'renderSlot'> & { readonly target?: string | undefined },
): JSX.Element => {
  const column = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (props.target === undefined || column.current === null) return
    revealSettingsEntry({ container: column.current, entryId: props.target })
  }, [props.target])
  return (
    <div className="dshx:flex dshx:w-full dshx:flex-col dshx:[&>[data-slot='settings.general.item']>:last-child]:border-b-0" ref={column}>
      {props.renderSlot('settings.general.item', {})}
    </div>
  )
}

/** The release the native client build embeds; the port keeps the version it was taken from. */
export const CurrentVersionRow = (props: { readonly t: ShellTranslate; readonly version: string }): JSX.Element => (
  <div
    className="dshx:py-4 dshx:text-[14px] dshx:leading-[22px] dshx:wrap-anywhere dshx:text-[var(--dsw-alias-label-primary)]"
    data-settings-entry="current-version"
    tabIndex={-1}
  >
    {props.t('general.currentVersion', { version: props.version })}
  </div>
)

/** The shared developer-tool visibility switch. */
export const DeveloperToolsRow = (props: {
  readonly t: ShellTranslate
  readonly enabled: ObservableSnapshot<boolean>
  readonly setEnabled: (enabled: boolean) => Promise<void>
}): JSX.Element => {
  const enabled = useObservable(props.enabled)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  return (
    <div
      className="dshx:flex dshx:items-center dshx:justify-between dshx:gap-6 dshx:border-b-[0.5px] dshx:border-[var(--dsw-alias-border-l2)] dshx:py-4"
      data-settings-entry="developer-tools"
    >
      <div>
        <div className="dshx:text-[14px] dshx:leading-5">{props.t('developerTools.title')}</div>
        <div className="dshx:mt-1 dshx:text-[12px] dshx:leading-[18px] dshx:text-[var(--dsw-alias-label-secondary)]">
          {props.t('developerTools.description')}
        </div>
        {failed && <div role="alert">{props.t('developerTools.error')}</div>}
      </div>
      <Switch
        checked={enabled}
        disabled={busy}
        label={props.t('developerTools.title')}
        onChange={next => {
          setFailed(false)
          setBusy(true)
          props
            .setEnabled(next)
            .catch(() => setFailed(true))
            .finally(() => setBusy(false))
        }}
      />
    </div>
  )
}

/** The sidebar trigger content: the gear, and the label only in the wide column. */
export const TriggerContent = (props: { readonly wide: boolean; readonly t: ShellTranslate }): JSX.Element => (
  <>
    <span className="dshx:relative dshx:inline-flex">
      <IconSettingsOutlineMedium size={props.wide ? 16 : 18} />
      <DshReleaseIndicator t={props.t} />
    </span>
    {props.wide && <span className="dshx:overflow-hidden dshx:whitespace-nowrap">{props.t('trigger')}</span>}
  </>
)

export const HeaderContent = (props: { readonly t: ShellTranslate }): JSX.Element => <>{props.t('title')}</>

export const CloseLabel = (props: { readonly t: ShellTranslate }): JSX.Element => <>{props.t('close')}</>
