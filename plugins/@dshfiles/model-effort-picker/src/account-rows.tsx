import { useId, useRef, type KeyboardEvent } from 'react'
import { CheckIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { AccountColor, type AccountAccent } from './account-color.js'
import { AccountDot } from './account-dot.js'
import { ModelPickerModel, type ModelQuota } from './model-picker-model.js'
import { quotaTone } from './picker-atoms.js'

interface Account {
  readonly id: string
  readonly name: string
}

/**
 * Council picker round 1, C3: the accounts that offer the inspected model, as full-width radio rows: the account's dot
 * and name, what is left on it right-aligned in tabular digits under a heading that names the window, and a check on
 * the account in use. An unknown quota reads "—", never 0 %. Arrow keys move between accounts (one tab stop).
 */
export const AccountRows = (props: {
  readonly accounts: readonly Account[]
  readonly selected: string | undefined
  readonly quotas: ReadonlyMap<string, ModelQuota>
  readonly accents: ReadonlyMap<string, AccountAccent>
  readonly onChoose: (accountId: string) => void
  /** Round 4 T13: the account a new thread on this model is routed to, captioned "Default". */
  readonly defaultId?: string | undefined
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
      <div className="dshx:flex dshx:items-baseline dshx:justify-between dshx:gap-2 dshx:pr-7.5" data-model-accounts-heading>
        <h3 className="dshx:text-xs dshx:font-medium" id={headingId}>
          Account
        </h3>
        {heading === undefined ? null : <span className="dshx:text-2xs dshx:text-muted-foreground">{heading}</span>}
      </div>
      {/* Round 4 T16: one account is a fact, not a choice: a plain line instead of a lone radio. */}
      {props.accounts.length === 1 && props.accounts[0] !== undefined ? (
        <SingleAccount account={props.accounts[0]} accent={props.accents.get(props.accounts[0].id)} quota={props.quotas.get(props.accounts[0].id)} />
      ) : (
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
                  'dshx:flex dshx:h-8 dshx:w-full dshx:min-w-0 dshx:items-center dshx:gap-2 dshx:rounded-md dshx:px-2 dshx:text-left dshx:text-xs dshx:outline-none dshx:hover:bg-accent/50 dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring dshx:pointer-coarse:h-11',
                  // Round 3 R14, round 5 U4: hover is a light wash; the chosen account is its 1 px edge, check and 600 weight, no wash,
                // so it never reads as the list's keyboard row.
                  checked && 'dshx:font-selected dshx:selected-edge',
                )}
                data-model-account
                key={account.id}
                onClick={() => props.onChoose(account.id)}
                onKeyDown={event => move(event, index)}
                role="radio"
                tabIndex={checked || (selectedIndex < 0 && index === 0) ? 0 : -1}
                type="button"
              >
                <AccountDot accent={props.accents.get(account.id) ?? AccountColor.of({ instanceId: account.id })} className="dshx:size-2" />
                <span className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:items-baseline dshx:gap-1.5">
                  <span className="dshx:min-w-0 dshx:truncate">{account.name}</span>
                  {account.id === props.defaultId ? (
                    <span className="dshx:shrink-0 dshx:text-2xs dshx:font-normal dshx:text-muted-foreground" data-model-account-default>
                      Default
                    </span>
                  ) : null}
                </span>
                {/* Round 3 R18: without any quota (no heading) the column is gone, not a column of dashes. */}
                {heading === undefined ? null : (
                  <span
                    className={cn(
                      'dshx:w-12 dshx:shrink-0 dshx:text-right dshx:tabular-nums',
                      percent === undefined ? 'dshx:text-muted-foreground' : quotaTone(percent),
                    )}
                    data-model-account-quota
                  >
                    <span aria-hidden="true">{percent === undefined ? '' : `${quota?.onReserve === true ? '☾ ' : ''}${String(percent)}%`}</span>
                    <span className="dshx:sr-only" id={`${headingId}-quota-${String(index)}`}>
                      {percent === undefined ? 'quota unknown' : `${String(percent)} % left on ${account.name}`}
                    </span>
                  </span>
                )}
                <span className="dshx:flex dshx:w-3.5 dshx:shrink-0 dshx:justify-center">
                  {checked ? <CheckIcon aria-hidden="true" className="dshx:size-3.5 dshx:text-foreground" data-model-account-check /> : null}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </section>
  )
}

const SingleAccount = (props: { readonly account: Account; readonly accent: AccountAccent | undefined; readonly quota: ModelQuota | undefined }) => {
  const percent = props.quota === undefined ? undefined : Math.round(props.quota.percent)
  return (
    <div className="dshx:flex dshx:h-8 dshx:min-w-0 dshx:items-center dshx:gap-2 dshx:px-2 dshx:text-xs dshx:pointer-coarse:h-11" data-model-account-single>
      <AccountDot accent={props.accent ?? AccountColor.of({ instanceId: props.account.id })} className="dshx:size-2" />
      <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate">{props.account.name}</span>
      {percent === undefined ? null : (
        <span className={cn('dshx:shrink-0 dshx:tabular-nums', quotaTone(percent))}>
          <span aria-hidden="true">{`${props.quota?.onReserve === true ? '☾ ' : ''}${String(percent)}%`}</span>
          <span className="dshx:sr-only">{`${String(percent)} % left on ${props.account.name}`}</span>
        </span>
      )}
    </div>
  )
}
