import { useId, useRef, type KeyboardEvent } from 'react'
import { CheckIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { accountColor } from './account-color.js'
import { ModelPickerModel, type ModelQuota } from './model-picker-model.js'

interface Account {
  readonly id: string
  readonly name: string
}

/** The quota convention every surface shares (ai-accounts `quotaTone`): muted while healthy, amber at 15 % or less, red once spent. */
const quotaTone = (percent: number): string =>
  Math.round(percent) <= 0 ? 'dshx:text-destructive' : percent <= 15 ? 'dshx:text-warning' : 'dshx:text-muted-foreground'

/**
 * Council picker round 1, C3: the accounts that offer the inspected model, as full-width radio rows: the account's dot
 * and name, what is left on it right-aligned in tabular digits under a heading that names the window, and a check on
 * the account in use. An unknown quota reads "—", never 0 %. Arrow keys move between accounts (one tab stop).
 */
export const AccountRows = (props: {
  readonly accounts: readonly Account[]
  readonly selected: string | undefined
  readonly quotas: ReadonlyMap<string, ModelQuota>
  readonly accents: ReadonlyMap<string, string>
  readonly onChoose: (accountId: string) => void
}) => {
  const headingId = useId()
  const group = useRef<HTMLDivElement>(null)
  const heading = ModelPickerModel.quotaHeading(props.accounts.flatMap(account => props.quotas.get(account.id) ?? []))
  const selectedIndex = props.accounts.findIndex(account => account.id === props.selected)

  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    const step = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 0
    if (step === 0) return
    event.preventDefault()
    const next = Math.min(props.accounts.length - 1, Math.max(0, index + step))
    const account = props.accounts[next]
    if (account === undefined) return
    props.onChoose(account.id)
    group.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus()
  }

  return (
    <section aria-labelledby={headingId} className="dshx:mt-3 dshx:flex dshx:flex-col dshx:gap-1" data-model-accounts>
      <div className="dshx:flex dshx:items-baseline dshx:justify-between dshx:gap-2 dshx:px-2">
        <h3 className="dshx:text-xs dshx:font-medium" id={headingId}>
          Account
        </h3>
        {heading === undefined ? null : <span className="dshx:text-2xs dshx:text-muted-foreground">{heading}</span>}
      </div>
      <div aria-labelledby={headingId} className="dshx:flex dshx:flex-col dshx:gap-px" ref={group} role="radiogroup">
        {props.accounts.map((account, index) => {
          const checked = account.id === props.selected
          const quota = props.quotas.get(account.id)
          const percent = quota === undefined ? undefined : Math.round(quota.percent)
          return (
            <button
              aria-checked={checked}
              aria-describedby={`${headingId}-quota-${String(index)}`}
              aria-label={account.name}
              className={cn(
                'dshx:flex dshx:h-8 dshx:w-full dshx:min-w-0 dshx:items-center dshx:gap-2 dshx:rounded-md dshx:px-2 dshx:text-left dshx:text-xs dshx:outline-none dshx:hover:bg-muted dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring dshx:pointer-coarse:h-11',
                checked && 'dshx:bg-selected-wash dshx:font-selected',
              )}
              data-model-account
              key={account.id}
              onClick={() => props.onChoose(account.id)}
              onKeyDown={event => move(event, index)}
              role="radio"
              tabIndex={checked || (selectedIndex < 0 && index === 0) ? 0 : -1}
              type="button"
            >
              <i
                aria-hidden="true"
                className="dshx:size-2 dshx:shrink-0 dshx:rounded-full"
                style={{ backgroundColor: props.accents.get(account.id) ?? accountColor({ instanceId: account.id }) }}
              />
              <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate">{account.name}</span>
              <span
                className={cn(
                  'dshx:w-12 dshx:shrink-0 dshx:text-right dshx:tabular-nums',
                  percent === undefined ? 'dshx:text-muted-foreground' : quotaTone(percent),
                )}
                data-model-account-quota
              >
                <span aria-hidden="true">{percent === undefined ? '—' : `${quota?.onReserve === true ? '☾ ' : ''}${String(percent)}%`}</span>
                <span className="dshx:sr-only" id={`${headingId}-quota-${String(index)}`}>
                  {percent === undefined ? 'quota unknown' : `${String(percent)} % left on ${account.name}`}
                </span>
              </span>
              <span className="dshx:flex dshx:w-3.5 dshx:shrink-0 dshx:justify-center">
                {checked ? <CheckIcon aria-hidden="true" className="dshx:size-3.5 dshx:text-foreground" data-model-account-check /> : null}
              </span>
            </button>
          )
        })}
      </div>
    </section>
  )
}
