import { useState } from 'react'
import type { ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type { ModelSelection } from '@deepseek-ai/dsh-api-session-controller/types'
import { aiAccountsApi } from '@dshfiles/ai-accounts/api'
import { aiAccountsModelFallbackApi, FALLBACK_RETURN_POLICIES, type FallbackRoute, type ModelFallbackSnapshot } from '@dshfiles/ai-accounts/model-fallback-api'
import { useApi, useApiQuery } from '@dshfiles/dshx/client'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { GripVerticalIcon, PlusIcon, Undo2Icon, XIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { accountColor } from './account-color.js'
import { ModelPickerModel } from './model-picker-model.js'
import { AccountBadge, BrandMark, InfoHint, QuotaRing, QuotaText } from './picker-atoms.js'

const RETURN_LABELS = {
  stay: 'Stay on it',
  'next-turn': 'Back next turn',
} satisfies Record<ModelFallbackSnapshot['returnPolicy'], string>

const RETURN_SHORT = {
  stay: 'Stay',
  'next-turn': 'Return',
} satisfies Record<ModelFallbackSnapshot['returnPolicy'], string>

/**
 * The ordered routes the Host walks when this thread's model request fails under Priority distribution. The Host
 * owns the chain (AI Accounts runs the fail-over), so every edit is a Host write and the list renders what it stored.
 */
export const FallbacksSection = (props: {
  readonly sessionId: string
  readonly groups: ModelDirectoryState['groups']
  readonly current: ModelSelection | null
  readonly busy: boolean
  readonly accountAccents: ReadonlyMap<string, string>
}) => {
  const api = useApi(aiAccountsModelFallbackApi)
  const state = useApiQuery(aiAccountsModelFallbackApi, 'state', { input: { sessionId: props.sessionId } })
  const usage = useApiQuery(aiAccountsApi, 'usage')
  const [pending, setPending] = useState(false)
  const [dragging, setDragging] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  // An older Host or a profile without AI Accounts has no fallback API; the picker works without it.
  const snapshot = state.data
  if (snapshot === undefined) {
    if (state.error !== undefined && state.error !== null) return null
    return (
      <section aria-label="Fallbacks" className="dshx:mt-3 dshx:flex dshx:flex-col dshx:gap-1.5 dshx:border-t dshx:border-border dshx:pt-2.5">
        <p className="dshx:text-xs dshx:font-medium">Fallback chain</p>
        <div className="dshx:h-8 dshx:animate-pulse dshx:rounded-lg dshx:bg-muted/60" />
        <div className="dshx:h-7 dshx:animate-pulse dshx:rounded-lg dshx:bg-muted/40" />
      </section>
    )
  }

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
  const serving = snapshot.active === null ? null : ModelPickerModel.fallbackLabel(props.groups, snapshot.active)
  const canAdd = props.current !== null && !chain.some(route => route.provider === props.current?.provider && route.model === props.current.model)

  return (
    <section aria-label="Fallbacks" className="dshx:mt-3 dshx:flex dshx:flex-col dshx:gap-1.5 dshx:border-t dshx:border-border dshx:pt-2.5">
      <div className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-1">
        <p className="dshx:text-xs dshx:font-medium">Fallback chain</p>
        <InfoHint description="Routes tried in order when this model request fails under Priority distribution." />
        <span className="dshx:flex-1" />
        <div aria-label="After a fallback answers" className="dshx:flex dshx:gap-px dshx:rounded-md dshx:bg-muted dshx:p-px" role="group">
          {FALLBACK_RETURN_POLICIES.map(policy => (
            <button
              aria-label={RETURN_LABELS[policy]}
              aria-pressed={snapshot.returnPolicy === policy}
              className={cn(
                'dshx:rounded-[5px] dshx:px-1.5 dshx:py-0.5 dshx:text-[10px] dshx:text-muted-foreground dshx:outline-none dshx:hover:text-foreground dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring',
                snapshot.returnPolicy === policy && 'dshx:bg-background dshx:text-foreground dshx:shadow-sm',
              )}
              disabled={disabled}
              key={policy}
              onClick={() => void write(() => api.setReturnPolicy({ returnPolicy: policy }))}
              type="button"
            >
              {RETURN_SHORT[policy]}
            </button>
          ))}
        </div>
      </div>

      {snapshot.active !== null && (
        <div className="dshx:flex dshx:items-center dshx:gap-1 dshx:text-[10px] dshx:text-muted-foreground" role="status">
          <Undo2Icon aria-hidden="true" className="dshx:size-3" />
          <span className="dshx:min-w-0 dshx:truncate">
            {serving?.model} · {serving?.provider}
          </span>
          <Button disabled={disabled} onClick={() => void write(() => api.returnToSelection({ sessionId: props.sessionId }))} size="xs" variant="ghost">
            Return
          </Button>
        </div>
      )}

      {chain.length === 0 ? (
        <p className="dshx:text-[11px] dshx:text-muted-foreground">No fallbacks</p>
      ) : (
        <ol aria-label="Fallback order" className="dshx:divide-y dshx:divide-border dshx:overflow-hidden dshx:rounded-lg dshx:border dshx:border-border">
          {chain.map((route, index) => {
            const label = ModelPickerModel.fallbackLabel(props.groups, route)
            const routeModel = props.groups.find(group => group.id === route.provider)?.models.find(model => model.id === route.model)
            const quota = usage.data?.cards.find(card => card.instanceId === route.provider)?.usage.windows[0]?.percentRemaining
            return (
              <li
                className="dshx:flex dshx:h-8 dshx:items-center dshx:gap-1 dshx:px-1.5"
                data-model-fallback
                draggable={!disabled}
                key={`${route.provider}/${route.model}`}
                onDragOver={event => event.preventDefault()}
                onDragStart={() => setDragging(index)}
                onDrop={event => {
                  event.preventDefault()
                  if (dragging !== null && dragging !== index) {
                    const next = [...chain]
                    const [moving] = next.splice(dragging, 1)
                    if (moving !== undefined) next.splice(index, 0, moving)
                    save(next)
                  }
                  setDragging(null)
                }}
              >
                <GripVerticalIcon aria-label="Drag to reorder" className="dshx:size-3 dshx:shrink-0 dshx:cursor-grab dshx:text-muted-foreground/60" />
                <span
                  aria-hidden="true"
                  className="dshx:flex dshx:size-4 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded-full dshx:bg-muted dshx:text-[9px] dshx:tabular-nums dshx:text-muted-foreground"
                >
                  {index + 1}
                </span>
                <BrandMark
                  brand={routeModel === undefined ? undefined : ModelPickerModel.brandFor({ model: routeModel })}
                  className="dshx:size-4"
                  name={label.model}
                />
                <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:text-[11px] dshx:font-medium">{label.model}</span>
                {label.effort === undefined ? null : <span className="dshx:shrink-0 dshx:text-[10px] dshx:text-muted-foreground">{label.effort}</span>}
                <AccountBadge
                  className="dshx:max-w-[5rem] dshx:text-[9.5px]"
                  color={props.accountAccents.get(route.provider) ?? accountColor({ instanceId: route.provider })}
                  name={label.provider}
                />
                {quota === undefined ? null : (
                  <span className="dshx:flex dshx:shrink-0 dshx:items-center dshx:gap-1">
                    <QuotaRing percent={quota} />
                    <QuotaText className="dshx:tabular-nums" percent={quota} />
                  </span>
                )}
                <button
                  aria-label={`Remove ${label.model}`}
                  className="dshx:flex dshx:size-5 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded dshx:text-muted-foreground dshx:outline-none dshx:hover:bg-muted dshx:hover:text-foreground dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring"
                  disabled={disabled}
                  onClick={() => save(ModelPickerModel.withoutFallback(chain, index))}
                  type="button"
                >
                  <XIcon aria-hidden="true" className="dshx:size-3" />
                </button>
              </li>
            )
          })}
        </ol>
      )}

      <div className="dshx:flex dshx:items-center dshx:gap-1.5">
        <Button
          className="dshx:h-7 dshx:flex-1 dshx:justify-center dshx:gap-1.5 dshx:rounded-lg dshx:border dshx:border-dashed dshx:border-border dshx:text-[11px] dshx:font-normal dshx:text-foreground"
          disabled={disabled || !canAdd || props.current === null}
          onClick={() => {
            if (props.current !== null) save(ModelPickerModel.withFallback(chain, ModelPickerModel.fallbackFor(props.current)))
          }}
          size="xs"
          variant="ghost"
        >
          <PlusIcon aria-hidden="true" />
          Add fallback
        </Button>
        {snapshot.threadChain === null ? null : (
          <Button
            className="dshx:h-7 dshx:shrink-0 dshx:px-2 dshx:text-[10px] dshx:text-muted-foreground"
            disabled={disabled}
            onClick={() => void write(() => api.setChain({ sessionId: props.sessionId, chain: null }))}
            size="xs"
            variant="ghost"
          >
            Use default
          </Button>
        )}
      </div>

      {error === null ? null : (
        <p className="dshx:text-[10px] dshx:text-destructive" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}
