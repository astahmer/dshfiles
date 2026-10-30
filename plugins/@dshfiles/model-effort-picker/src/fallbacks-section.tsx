import { useState } from 'react'
import { aiAccountsApi } from '@dshfiles/ai-accounts/api'
import type { ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type { ModelSelection } from '@deepseek-ai/dsh-api-session-controller/types'
import { aiAccountsModelFallbackApi, FALLBACK_RETURN_POLICIES, type FallbackRoute, type ModelFallbackSnapshot } from '@dshfiles/ai-accounts/model-fallback-api'
import { useApi, useApiQuery } from '@dshfiles/dshx/client'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { GripVerticalIcon, PlusIcon, Undo2Icon, XIcon } from '@dshfiles/plugin-ui/icons'
import { ModelPickerModel } from './model-picker-model.js'

const RETURN_LABELS = {
  stay: 'Stay on it',
  'next-turn': 'Back next turn',
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
}) => {
  const api = useApi(aiAccountsModelFallbackApi)
  const state = useApiQuery(aiAccountsModelFallbackApi, 'state', { input: { sessionId: props.sessionId } })
  const usage = useApiQuery(aiAccountsApi, 'usage')
  const [pending, setPending] = useState(false)
  const [dragging, setDragging] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  // An older Host or a profile without AI Accounts has no fallback API; the picker works without it.
  const snapshot = state.data
  if (snapshot === undefined) return null

  const followsDefault = snapshot.threadChain === null
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

  const current = props.current
  const servingLabel = snapshot.active === null ? null : ModelPickerModel.fallbackLabel(props.groups, snapshot.active)
  const canAdd = current !== null && !chain.some(route => route.provider === current.provider && route.model === current.model)

  return (
    <section aria-label="Fallbacks" className="dshx:space-y-1.5 dshx:border-t dshx:border-border dshx:pt-2">
      <div className="dshx:flex dshx:items-center dshx:gap-2">
        <p className="dshx:flex-1 dshx:text-xs dshx:font-semibold">Fallbacks</p>
        {followsDefault && <span className="dshx:text-[9px] dshx:text-muted-foreground">Default</span>}
        <span className="dshx:text-[9px] dshx:text-muted-foreground">{snapshot.returnPolicy === 'stay' ? 'Stay on fallback' : 'Return to primary'}</span>
        {FALLBACK_RETURN_POLICIES.map(policy => (
          <button
            aria-label={RETURN_LABELS[policy]}
            aria-pressed={snapshot.returnPolicy === policy}
            className="dshx:size-2 dshx:rounded-full dshx:bg-muted-foreground/30 dshx:aria-pressed:bg-primary"
            disabled={disabled}
            key={policy}
            onClick={() => void write(() => api.setReturnPolicy({ returnPolicy: policy }))}
            type="button"
          />
        ))}
      </div>
      {snapshot.active !== null && (
        <div className="dshx:flex dshx:items-center dshx:gap-1 dshx:text-[10px] dshx:text-muted-foreground" role="status">
          <Undo2Icon aria-hidden="true" className="dshx:size-3" />
          {servingLabel?.model} · {servingLabel?.provider}
          <Button disabled={disabled} onClick={() => void write(() => api.returnToSelection({ sessionId: props.sessionId }))} size="xs" variant="ghost">
            Return
          </Button>
        </div>
      )}
      {chain.length === 0 ? (
        <p className="dshx:text-[10px] dshx:text-muted-foreground">No fallbacks</p>
      ) : (
        <ol aria-label="Fallback order" className="dshx:space-y-1">
          {chain.map((route, index) => {
            const label = ModelPickerModel.fallbackLabel(props.groups, route)
            const name = `${label.provider} ${label.model}`
            const quota = usage.data?.cards.find(card => card.instanceId === route.provider)?.usage.windows[0]?.percentRemaining
            return (
              <li
                className="dshx:flex dshx:h-8 dshx:items-center dshx:gap-1 dshx:border-b dshx:border-border/70"
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
                <GripVerticalIcon aria-label="Drag to reorder" className="dshx:size-3.5 dshx:shrink-0 dshx:cursor-grab dshx:text-muted-foreground" />
                <span
                  aria-hidden="true"
                  className="dshx:flex dshx:size-4 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded-full dshx:bg-muted dshx:text-[9px]"
                >
                  {label.provider.slice(0, 1).toUpperCase()}
                </span>
                <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:text-[10px]">
                  <span className="dshx:font-medium">{label.model}</span>
                  <span className="dshx:text-muted-foreground"> · {label.provider}</span>
                  {label.effort !== undefined && <span className="dshx:text-muted-foreground"> · {label.effort}</span>}
                </span>
                {quota !== undefined && <span className="dshx:text-[9px] dshx:text-success">{Math.round(quota)}%</span>}
                <Button
                  aria-label={`Remove ${name}`}
                  disabled={disabled}
                  onClick={() => save(ModelPickerModel.withoutFallback(chain, index))}
                  size="icon-xs"
                  variant="ghost"
                >
                  <XIcon aria-hidden="true" />
                </Button>
              </li>
            )
          })}
        </ol>
      )}

      <div className="dshx:flex dshx:items-center dshx:gap-2">
        <Button
          className="dshx:h-7 dshx:px-2 dshx:text-[10px]"
          disabled={disabled || !canAdd || current === null}
          onClick={() => {
            if (current !== null) save(ModelPickerModel.withFallback(chain, ModelPickerModel.fallbackFor(current)))
          }}
          size="xs"
          variant="ghost"
        >
          <PlusIcon aria-hidden="true" />
          Add fallback
        </Button>
        {snapshot.threadChain !== null && (
          <Button
            className="dshx:h-7 dshx:px-2 dshx:text-[10px]"
            disabled={disabled}
            onClick={() => void write(() => api.setChain({ sessionId: props.sessionId, chain: null }))}
            size="xs"
            variant="ghost"
          >
            Use default
          </Button>
        )}
      </div>

      {error !== null && (
        <p className="dshx:text-[10px] dshx:text-destructive" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}
