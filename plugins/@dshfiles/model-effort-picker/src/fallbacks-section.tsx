import { useState } from 'react'
import type { ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type { ModelSelection } from '@deepseek-ai/dsh-api-session-controller/types'
import { aiAccountsApi } from '@dshfiles/ai-accounts/api'
import { aiAccountsModelFallbackApi, FALLBACK_RETURN_POLICIES, type FallbackRoute, type ModelFallbackSnapshot } from '@dshfiles/ai-accounts/model-fallback-api'
import { useApi, useApiQuery } from '@dshfiles/dshx/client'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { PlusIcon, Undo2Icon, XIcon } from '@dshfiles/plugin-ui/icons'
import { FallbackChain } from '@dshfiles/plugin-ui/components/motion/fallback-chain'
import { accountColor } from './account-color.js'
import { ModelPickerModel } from './model-picker-model.js'
import { AccountBadge, BrandMark, InfoHint, QuotaText } from './picker-atoms.js'

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
  readonly providerLabels: ReadonlyMap<string, string>
}) => {
  const api = useApi(aiAccountsModelFallbackApi)
  const state = useApiQuery(aiAccountsModelFallbackApi, 'state', { input: { sessionId: props.sessionId } })
  const usage = useApiQuery(aiAccountsApi, 'usage')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // An older Host or a profile without AI Accounts has no fallback API; the picker works without it.
  const snapshot = state.data
  if (snapshot === undefined) {
    if (state.error !== undefined && state.error !== null) return null
    return (
      <section aria-label="Fallbacks" className="dshx:mt-2.5 dshx:flex dshx:flex-col dshx:gap-1">
        <p className="dshx:text-[11px] dshx:font-medium">Fallback chain</p>
        <p className="dshx:text-[10px] dshx:text-muted-foreground">Loading fallbacks…</p>
      </section>
    )
  }

  const chain = snapshot.threadChain ?? snapshot.defaultChain
  const disabled = props.busy || pending
  const policyIndex = FALLBACK_RETURN_POLICIES.indexOf(snapshot.returnPolicy)
  const nextPolicy: ModelFallbackSnapshot['returnPolicy'] =
    FALLBACK_RETURN_POLICIES[(policyIndex + 1) % FALLBACK_RETURN_POLICIES.length] ?? snapshot.returnPolicy

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

  const addFallback = (
    <Button
      className="dshx:h-6 dshx:gap-1 dshx:rounded-md dshx:px-1.5 dshx:text-[10px] dshx:font-normal dshx:text-muted-foreground dshx:hover:text-foreground"
      disabled={disabled || !canAdd || props.current === null}
      onClick={() => {
        if (props.current !== null) save(ModelPickerModel.withFallback(chain, ModelPickerModel.fallbackFor(props.current)))
      }}
      size="xs"
      variant="ghost"
    >
      <PlusIcon aria-hidden="true" className="dshx:size-3" />
      Add fallback
    </Button>
  )

  return (
    <section aria-label="Fallbacks" className="dshx:mt-2.5 dshx:flex dshx:flex-col dshx:gap-1">
      <FallbackChain
        actions={
          <>
            <InfoHint description="Routes tried in order when this model request fails under Priority distribution." />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  aria-label={`After a fallback answers: ${RETURN_LABELS[snapshot.returnPolicy]}. Switch to ${RETURN_LABELS[nextPolicy]}.`}
                  className="dshx:h-5 dshx:gap-1 dshx:px-1 dshx:text-[10px] dshx:font-normal dshx:text-muted-foreground"
                  disabled={disabled}
                  onClick={() => void write(() => api.setReturnPolicy({ returnPolicy: nextPolicy }))}
                  size="xs"
                  variant="ghost"
                >
                  <Undo2Icon aria-hidden="true" className="dshx:size-3" />
                  {RETURN_SHORT[snapshot.returnPolicy]}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">After a fallback answers: {RETURN_LABELS[snapshot.returnPolicy]}</TooltipContent>
            </Tooltip>
          </>
        }
        attempts={chain.map((route, index) => {
          const label = ModelPickerModel.fallbackLabel(props.groups, route)
          const routeModel = props.groups.find(group => group.id === route.provider)?.models.find(model => model.id === route.model)
          const providerLabel = props.providerLabels.get(route.provider)
          const quota = ModelPickerModel.quota(usage.data?.cards.find(card => card.instanceId === route.provider))
          const isServing = snapshot.active !== null && snapshot.active.provider === route.provider && snapshot.active.model === route.model
          return {
            id: `${route.provider}/${route.model}`,
            model: label.model,
            provider: label.provider,
            status: isServing ? 'answered' : 'waiting',
            statusLabel: isServing ? 'Serving now' : [providerLabel, label.effort].filter(Boolean).join(' · ') || 'Waiting',
            label: `Fallback ${index + 1}: ${label.model}${providerLabel === undefined ? '' : ` via ${providerLabel}`}, ${label.provider}${isServing ? ', serving now' : ''}. Alt+Arrow to reorder.`,
            mark: (
              <BrandMark
                brand={routeModel === undefined ? undefined : ModelPickerModel.brandFor({ model: routeModel })}
                className="dshx:size-4"
                name={label.model}
              />
            ),
            meta: (
              <>
                <AccountBadge
                  className="dshx:max-w-[7rem]"
                  color={props.accountAccents.get(route.provider) ?? accountColor({ instanceId: route.provider })}
                  label={ModelPickerModel.accountTag({ name: label.provider, provider: providerLabel })}
                  name={label.provider}
                />
                {quota === undefined ? null : (
                  <QuotaText className="dshx:w-6 dshx:shrink-0 dshx:text-right" label={quota.label} onReserve={quota.onReserve} percent={quota.percent} />
                )}
              </>
            ),
            actions: (
              <Button
                aria-label={`Remove ${label.model}`}
                className="dshx:size-5 dshx:shrink-0 dshx:text-muted-foreground"
                disabled={disabled}
                onClick={() => save(ModelPickerModel.withoutFallback(chain, index))}
                size="icon-xs"
                variant="ghost"
              >
                <XIcon aria-hidden="true" className="dshx:size-3" />
              </Button>
            ),
          }
        })}
        density="compact"
        heading="Fallback chain"
        onReorder={(from, to) => save(ModelPickerModel.reorderedFallback(chain, from, to))}
        reorderDisabled={disabled}
        route={props.current === null ? 'selection' : `${props.current.provider}/${props.current.model}`}
        summary={chain.length === 0 ? null : <span className="dshx:text-[10px]">{chain.length === 1 ? '1 route' : `${String(chain.length)} routes`}</span>}
      />

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
        <div className="dshx:flex dshx:items-center dshx:justify-between dshx:gap-2">
          <p className="dshx:text-[10px] dshx:text-muted-foreground">No fallbacks</p>
          {addFallback}
        </div>
      ) : null}

      {chain.length === 0 ? null : (
        <div className="dshx:flex dshx:items-center dshx:justify-between dshx:gap-1">
          {addFallback}
          {snapshot.threadChain === null ? null : (
            <Button
              className="dshx:h-6 dshx:shrink-0 dshx:px-1.5 dshx:text-[10px] dshx:text-muted-foreground"
              disabled={disabled}
              onClick={() => void write(() => api.setChain({ sessionId: props.sessionId, chain: null }))}
              size="xs"
              variant="ghost"
            >
              Use default
            </Button>
          )}
        </div>
      )}

      {error === null ? null : (
        <p className="dshx:text-[10px] dshx:text-destructive" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}
