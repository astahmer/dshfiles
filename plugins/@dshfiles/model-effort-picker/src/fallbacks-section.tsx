import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import type { ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type { ModelSelection } from '@deepseek-ai/dsh-api-session-controller/types'
import { aiAccountsApi } from '@dshfiles/ai-accounts/api'
import { aiAccountsModelFallbackApi, FALLBACK_RETURN_POLICIES, type FallbackRoute, type ModelFallbackSnapshot } from '@dshfiles/ai-accounts/model-fallback-api'
import { useApi, useApiQuery } from '@dshfiles/dshx/client'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@dshfiles/plugin-ui/components/ui/dropdown-menu'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@dshfiles/plugin-ui/components/ui/select'
import { ChevronRightIcon, EllipsisIcon, PlusIcon, Undo2Icon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { AccountColor, AccountDot, type AccountAccent } from '@dshfiles/ai-accounts/account-color'
import { ModelPickerModel, type ModelQuota } from './model-picker-model.js'
import { BrandMark, InfoHint, quotaTone } from './picker-atoms.js'

const RETURN_LABELS = {
  stay: 'stay on it',
  'next-turn': 'return next turn',
} satisfies Record<ModelFallbackSnapshot['returnPolicy'], string>

/** One rung as the list shows it. */
export interface FallbackRow {
  readonly id: string
  readonly model: string
  readonly brand: ReturnType<typeof ModelPickerModel.brandFor>
  readonly account: string
  readonly tag: string
  readonly color: AccountAccent
  readonly quota: ModelQuota | undefined
  readonly serving: boolean
}

/**
 * Council picker round 1, N5: the fallback chain, collapsed to "Fallbacks · 2 routes ›". Expanded it is one numbered list
 * (a rank column before each mark, the account tag, the quota trailing), the return policy below it once there is a
 * route, and "Add fallback" always in the same place. Alt+Up and Alt+Down move a focused rung.
 */
export const FallbackList = (props: {
  readonly rows: readonly FallbackRow[]
  readonly expanded: boolean
  readonly onExpandedChange: (expanded: boolean) => void
  readonly returnPolicy: ModelFallbackSnapshot['returnPolicy']
  readonly disabled: boolean
  readonly canAdd: boolean
  readonly threadChain: boolean
  readonly serving: string | null
  readonly error: string | null
  readonly onAdd: () => void
  readonly onRemove: (index: number) => void
  readonly onMove: (from: number, to: number) => void
  readonly onPolicyChange: (policy: ModelFallbackSnapshot['returnPolicy']) => void
  readonly onUseDefault: () => void
  readonly onReturn: () => void
}) => {
  const listId = useId()
  const count = props.rows.length
  const summary = count === 0 ? 'none' : count === 1 ? '1 route' : `${String(count)} routes`
  // Round 5 U5: a move from the keyboard or the actions menu says where the route went.
  const [moved, setMoved] = useState('')
  const moveTo = (from: number, to: number): void => {
    const row = props.rows[from]
    props.onMove(from, to)
    if (row !== undefined) setMoved(`${row.model} on ${row.account} is now fallback ${String(to + 1)}`)
  }

  const move = (event: KeyboardEvent<HTMLLIElement>, index: number): void => {
    if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return
    event.preventDefault()
    const to = index + (event.key === 'ArrowUp' ? -1 : 1)
    if (to >= 0 && to < count && !props.disabled) moveTo(index, to)
  }

  // Round 4 T10: opening the chain brings its heading to the top of the details body, so the routes show.
  const section = useRef<HTMLElement>(null)
  const opening = useRef(false)
  const toggle = (): void => {
    if (!props.expanded) opening.current = true
    props.onExpandedChange(!props.expanded)
  }
  useEffect(() => {
    if (!props.expanded || !opening.current) return
    opening.current = false
    const element = section.current
    const body = element?.closest('[data-model-details-body]')
    if (element === null || element === undefined || !(body instanceof HTMLElement)) return
    // Round 6 V2: scroll only as far as needed (\"nearest\") to show what opening revealed: the first route, or Add
    // fallback's whole 44 pt target.
    const target = element.querySelector('[data-model-fallback-rung]') ?? element.querySelector('[data-model-fallback-add]')
    const top = FallbackReveal.scrollTop({ body: body.getBoundingClientRect(), scrollTop: body.scrollTop, target: (target ?? element).getBoundingClientRect() })
    if (top !== body.scrollTop) body.scrollTo({ top, behavior: 'auto' })
  }, [props.expanded])

  return (
    <section aria-label="Fallbacks" className="dshx:mt-3 dshx:flex dshx:flex-col dshx:gap-1" data-model-fallbacks ref={section}>
      {/* Round 4 T10: the label, its chevron and its help icon sit together on the inspector's left edge, as effort's do. */}
      <div className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-1">
        <button
          aria-controls={listId}
          aria-expanded={props.expanded}
          className="dshx:flex dshx:h-8 dshx:min-w-0 dshx:items-center dshx:gap-1 dshx:rounded-md dshx:px-0 dshx:text-left dshx:text-xs dshx:font-medium dshx:outline-none dshx:hover:text-foreground dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring dshx:pointer-coarse:h-11"
          data-model-fallbacks-toggle
          onClick={toggle}
          type="button"
        >
          <span className="dshx:truncate">
            Fallbacks <span className="dshx:font-normal dshx:text-muted-foreground">· {summary}</span>
          </span>
        </button>
        <InfoHint description="Routes tried in order when this model request fails under Priority distribution." label="About fallbacks" />
        {/* The rest of the row opens it too, for the pointer only (round 5 U15: not a nameless button); the labelled toggle
            carries the state for assistive tech and the keyboard. */}
        <span
          aria-hidden="true"
          className="dshx:flex dshx:h-8 dshx:min-w-0 dshx:flex-1 dshx:items-center dshx:justify-end dshx:rounded-md dshx:outline-none dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring dshx:pointer-coarse:h-11 dshx:pointer-coarse:pr-1.5"
          data-model-fallbacks-chevron
          onClick={toggle}
        >
          <ChevronRightIcon aria-hidden="true" className={cn('dshx:size-3.5 dshx:shrink-0 dshx:text-muted-foreground', props.expanded && 'dshx:rotate-90')} />
        </span>
      </div>

      {props.expanded ? (
        <div className="dshx:flex dshx:flex-col dshx:gap-1" id={listId}>
          {/* Round 5 U11: on touch the help icon is hidden, so the chain says what it is. */}
          <p className="dshx:hidden dshx:text-xs dshx:text-pretty dshx:text-muted-foreground dshx:pointer-coarse:block" data-model-fallbacks-help>
            If this model fails, DSH tries these in order.
          </p>
          {props.serving === null ? null : (
            <div className="dshx:flex dshx:items-center dshx:gap-2 dshx:text-xs dshx:text-muted-foreground" role="status">
              <Undo2Icon aria-hidden="true" className="dshx:size-3.5 dshx:shrink-0" />
              <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate">Serving {props.serving}</span>
              <Button className="dshx:pointer-coarse:h-11" disabled={props.disabled} onClick={props.onReturn} size="xs" variant="ghost">
                Return
              </Button>
            </div>
          )}

          <span aria-live="polite" className="dshx:sr-only" data-model-fallback-announcer>
            {moved}
          </span>
          {count === 0 ? null : (
            <ol aria-label="Fallback order" className="dshx:flex dshx:flex-col dshx:gap-px">
              {props.rows.map((row, index) => (
                <li
                  aria-label={`Fallback ${String(index + 1)}: ${row.model} on ${row.account}${row.serving ? ', serving now' : ''}. Alt+Arrow to reorder.`}
                  className={cn(
                    'dshx:flex dshx:h-8 dshx:min-w-0 dshx:items-center dshx:gap-2 dshx:rounded-md dshx:text-xs dshx:outline-none dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring dshx:pointer-coarse:h-11',
                    row.serving && 'dshx:bg-selected-wash',
                  )}
                  data-model-fallback-rung
                  key={row.id}
                  onKeyDown={event => move(event, index)}
                  tabIndex={0}
                >
                  <span aria-hidden="true" className="dshx:w-4 dshx:shrink-0 dshx:tabular-nums dshx:text-muted-foreground" data-model-fallback-rank>
                    {index + 1}
                  </span>
                  <BrandMark brand={row.brand} className="dshx:size-4" name={row.model} />
                  <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate">{row.model}</span>
                  {/* Round 5 U5: the account in a fixed left-aligned slot, so the dots line up as in the list. */}
                  <span
                    className="dshx:flex dshx:w-12 dshx:shrink-0 dshx:items-center dshx:gap-1 dshx:text-2xs dshx:text-muted-foreground"
                    data-model-fallback-account
                  >
                    <AccountDot accent={row.color} className="dshx:size-1.5" />
                    {row.tag}
                  </span>
                  <span
                    className={cn(
                      'dshx:w-9 dshx:shrink-0 dshx:text-right dshx:tabular-nums',
                      row.quota === undefined ? 'dshx:text-muted-foreground' : quotaTone(row.quota.percent),
                    )}
                    data-model-fallback-quota
                  >
                    {row.quota === undefined ? '—' : `${String(Math.round(row.quota.percent))}%`}
                  </span>
                  {/* Round 5 U5: one actions button per route (44 pt on touch), so the order changes without Alt+Arrow. */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        aria-label={`Actions for fallback ${String(index + 1)}`}
                        className="dshx:size-7 dshx:shrink-0 dshx:text-muted-foreground dshx:pointer-coarse:size-11 dshx:pointer-coarse:justify-end dshx:pointer-coarse:pr-0.5"
                        data-model-fallback-actions
                        disabled={props.disabled}
                        size="icon-xs"
                        variant="ghost"
                      >
                        <EllipsisIcon aria-hidden="true" className="dshx:size-3.5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {index === 0 ? null : <DropdownMenuItem onSelect={() => moveTo(index, index - 1)}>Move up</DropdownMenuItem>}
                      {index === count - 1 ? null : <DropdownMenuItem onSelect={() => moveTo(index, index + 1)}>Move down</DropdownMenuItem>}
                      <DropdownMenuItem onSelect={() => props.onRemove(index)} variant="destructive">
                        Remove
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </li>
              ))}
            </ol>
          )}

          {count === 0 ? null : (
            <div className="dshx:flex dshx:items-center dshx:gap-1 dshx:text-xs dshx:text-muted-foreground" data-model-fallback-policy>
              <span>After a fallback answers:</span>
              {/* Round 3 R15: a visible small select (with its chevron), not a word that changes when clicked. */}
              <Select
                disabled={props.disabled}
                onValueChange={value => {
                  const policy = FALLBACK_RETURN_POLICIES.find(candidate => candidate === value)
                  if (policy !== undefined) props.onPolicyChange(policy)
                }}
                value={props.returnPolicy}
              >
                <SelectTrigger
                  aria-label="After a fallback answers"
                  className="dshx:h-7 dshx:gap-1 dshx:px-2 dshx:text-xs dshx:pointer-coarse:h-11"
                  data-model-fallback-policy-select
                  size="sm"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FALLBACK_RETURN_POLICIES.map(policy => (
                    <SelectItem key={policy} value={policy}>
                      {RETURN_LABELS[policy]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Add fallback is always the first action under the list, wherever the list ends. */}
          <div className="dshx:flex dshx:items-center dshx:justify-between dshx:gap-1">
            <Button
              className="dshx:h-7 dshx:gap-1 dshx:px-0! dshx:text-xs dshx:font-normal dshx:text-muted-foreground dshx:hover:bg-transparent dshx:hover:text-foreground dshx:pointer-coarse:h-11"
              data-model-fallback-add
              disabled={props.disabled || !props.canAdd}
              onClick={props.onAdd}
              size="xs"
              variant="ghost"
            >
              <PlusIcon aria-hidden="true" className="dshx:size-3.5" />
              Add fallback
            </Button>
            {props.threadChain ? (
              <Button
                className="dshx:h-7 dshx:shrink-0 dshx:px-2 dshx:text-xs dshx:text-muted-foreground dshx:pointer-coarse:h-11"
                disabled={props.disabled}
                onClick={props.onUseDefault}
                size="xs"
                variant="ghost"
              >
                Reset to default chain
              </Button>
            ) : null}
          </div>

          {props.error === null ? null : (
            <p className="dshx:px-2 dshx:text-xs dshx:text-destructive">{props.error} Try again, or reopen the picker to reload the chain.</p>
          )}
        </div>
      ) : null}
    </section>
  )
}

/**
 * The ordered routes the Host walks when this thread's model request fails under Priority distribution. The Host
 * owns the chain (AI Accounts runs the fail-over), so every edit is a Host write and the list renders what it stored.
 */
/** Where to scroll the details body so what opening Fallbacks revealed shows (round 6 V2): the nearest position. */
export class FallbackReveal {
  static scrollTop(input: { readonly body: { readonly bottom: number }; readonly scrollTop: number; readonly target: { readonly bottom: number } }): number {
    const below = input.target.bottom - input.body.bottom
    return below <= 0 ? input.scrollTop : input.scrollTop + below
  }
}

export const FallbacksSection = (props: {
  readonly sessionId: string
  readonly groups: ModelDirectoryState['groups']
  readonly current: ModelSelection | null
  readonly busy: boolean
  readonly accountAccents: ReadonlyMap<string, AccountAccent>
  /** N2: each account's short tag ("CC2"), the one the status bar and AI Accounts show. */
  readonly accountBadges?: ReadonlyMap<string, string>
  readonly providerLabels: ReadonlyMap<string, string>
}) => {
  const api = useApi(aiAccountsModelFallbackApi)
  const state = useApiQuery(aiAccountsModelFallbackApi, 'state', { input: { sessionId: props.sessionId } })
  const usage = useApiQuery(aiAccountsApi, 'usage')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)

  // An older Host or a profile without AI Accounts has no fallback API; the picker works without it.
  const snapshot = state.data
  if (snapshot === undefined) return null

  const chain = snapshot.threadChain ?? snapshot.defaultChain
  const disabled = props.busy || pending

  const write = async (call: () => Promise<ModelFallbackSnapshot>): Promise<void> => {
    setPending(true)
    setError(null)
    try {
      await call()
      state.refetch()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setPending(false)
    }
  }

  const save = (next: readonly FallbackRoute[]): void => void write(() => api.setChain({ sessionId: props.sessionId, chain: [...next] }))
  const servingLabel = snapshot.active === null ? null : ModelPickerModel.fallbackLabel(props.groups, snapshot.active)
  const canAdd = props.current !== null && !chain.some(route => route.provider === props.current?.provider && route.model === props.current.model)
  const rows = chain.map((route): FallbackRow => {
    const label = ModelPickerModel.fallbackLabel(props.groups, route)
    const routeModel = props.groups.find(group => group.id === route.provider)?.models.find(model => model.id === route.model)
    return {
      id: `${route.provider}/${route.model}`,
      model: label.model,
      brand: routeModel === undefined ? undefined : ModelPickerModel.brandFor({ model: routeModel }),
      account: label.provider,
      tag: props.accountBadges?.get(route.provider) ?? ModelPickerModel.accountTag({ name: label.provider }),
      color: props.accountAccents.get(route.provider) ?? AccountColor.of({ instanceId: route.provider }),
      quota: ModelPickerModel.quota(usage.data?.cards.find(card => card.instanceId === route.provider)),
      serving: snapshot.active !== null && snapshot.active.provider === route.provider && snapshot.active.model === route.model,
    }
  })

  return (
    <FallbackList
      canAdd={canAdd}
      disabled={disabled}
      error={error}
      // A thread serving a fallback shows the chain open, so the Return control is in view.
      expanded={expanded || snapshot.active !== null}
      onAdd={() => {
        if (props.current !== null) save(ModelPickerModel.withFallback(chain, ModelPickerModel.fallbackFor(props.current)))
      }}
      onExpandedChange={setExpanded}
      onMove={(from, to) => save(ModelPickerModel.reorderedFallback(chain, from, to))}
      onRemove={index => save(ModelPickerModel.withoutFallback(chain, index))}
      onReturn={() => void write(() => api.returnToSelection({ sessionId: props.sessionId }))}
      onPolicyChange={returnPolicy => void write(() => api.setReturnPolicy({ returnPolicy }))}
      onUseDefault={() => void write(() => api.setChain({ sessionId: props.sessionId, chain: null }))}
      returnPolicy={snapshot.returnPolicy}
      rows={rows}
      serving={servingLabel === null ? null : `${servingLabel.model} · ${servingLabel.provider}`}
      threadChain={snapshot.threadChain !== null}
    />
  )
}
