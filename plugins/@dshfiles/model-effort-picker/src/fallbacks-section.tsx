import { useState } from 'react'
import type { ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type { ModelSelection } from '@deepseek-ai/dsh-api-session-controller/types'
import { aiAccountsModelFallbackApi, FALLBACK_RETURN_POLICIES, type FallbackRoute, type ModelFallbackSnapshot } from '@dshfiles/ai-accounts/model-fallback-api'
import { useApi, useApiQuery } from '@dshfiles/dshx/client'
import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@dshfiles/plugin-ui/components/ui/toggle-group'
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, Undo2Icon, XIcon } from '@dshfiles/plugin-ui/icons'
import { ModelPickerModel } from './model-picker-model.js'

type Scope = 'thread' | 'default'

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
  const [scope, setScope] = useState<Scope>('thread')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // An older Host or a profile without AI Accounts has no fallback API; the picker works without it.
  const snapshot = state.data
  if (snapshot === undefined) return null

  const followsDefault = scope === 'thread' && snapshot.threadChain === null
  const chain = scope === 'default' ? snapshot.defaultChain : (snapshot.threadChain ?? snapshot.defaultChain)
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

  const save = (next: readonly FallbackRoute[]): void =>
    void write(() => api.setChain(scope === 'default' ? { chain: [...next] } : { sessionId: props.sessionId, chain: [...next] }))

  const current = props.current
  const canAdd = current !== null && !chain.some(route => route.provider === current.provider && route.model === current.model)

  return (
    <section aria-label="Fallbacks" className="dshx:space-y-2 dshx:border-t dshx:border-border dshx:px-3 dshx:py-3">
      <div className="dshx:flex dshx:items-center dshx:justify-between dshx:gap-2">
        <p className="dshx:text-sm dshx:font-semibold">Fallbacks</p>
        <ToggleGroup
          aria-label="Fallback chain scope"
          onValueChange={(value: string) => {
            if (value === 'thread' || value === 'default') setScope(value)
          }}
          size="sm"
          type="single"
          value={scope}
          variant="outline"
        >
          <ToggleGroupItem className="dshx:px-2 dshx:text-xs" value="thread">
            This thread
          </ToggleGroupItem>
          <ToggleGroupItem className="dshx:px-2 dshx:text-xs" value="default">
            Default
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      {snapshot.distribution !== 'priority' && (
        <p className="dshx:text-xs dshx:text-muted-foreground">Fallbacks run only when AI Accounts spreads requests by Priority.</p>
      )}

      {snapshot.active !== null && (
        <div className="dshx:flex dshx:items-center dshx:justify-between dshx:gap-2 dshx:rounded-md dshx:bg-muted dshx:px-2 dshx:py-1.5" role="status">
          <p className="dshx:min-w-0 dshx:truncate dshx:text-xs">
            Serving from fallback {ModelPickerModel.fallbackLabel(props.groups, snapshot.active).provider}
          </p>
          <Button disabled={disabled} onClick={() => void write(() => api.returnToSelection({ sessionId: props.sessionId }))} size="xs" variant="outline">
            <Undo2Icon aria-hidden="true" />
            Return to selection
          </Button>
        </div>
      )}

      {followsDefault && <p className="dshx:text-xs dshx:text-muted-foreground">This thread follows the default chain; an edit here gives it its own.</p>}

      {chain.length === 0 ? (
        <p className="dshx:text-xs dshx:text-muted-foreground">No fallbacks. A failed request stays with this provider.</p>
      ) : (
        <ol aria-label="Fallback order" className="dshx:space-y-1">
          {chain.map((route, index) => {
            const label = ModelPickerModel.fallbackLabel(props.groups, route)
            const name = `${label.provider} ${label.model}`
            return (
              <li
                className="dshx:flex dshx:items-center dshx:gap-1.5 dshx:rounded-md dshx:border dshx:border-border dshx:px-2 dshx:py-1"
                data-model-fallback
                key={`${route.provider}/${route.model}`}
              >
                <span className="dshx:w-4 dshx:shrink-0 dshx:text-[10px] dshx:text-muted-foreground">{index + 1}</span>
                <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:text-xs">
                  <span className="dshx:font-medium">{label.model}</span>
                  <span className="dshx:text-muted-foreground"> · {label.provider}</span>
                </span>
                {label.effort !== undefined && <Badge variant="secondary">{label.effort}</Badge>}
                <Button
                  aria-label={`Move ${name} earlier`}
                  disabled={disabled || index === 0}
                  onClick={() => save(ModelPickerModel.movedFallback(chain, index, -1))}
                  size="icon-xs"
                  variant="ghost"
                >
                  <ArrowUpIcon aria-hidden="true" />
                </Button>
                <Button
                  aria-label={`Move ${name} later`}
                  disabled={disabled || index === chain.length - 1}
                  onClick={() => save(ModelPickerModel.movedFallback(chain, index, 1))}
                  size="icon-xs"
                  variant="ghost"
                >
                  <ArrowDownIcon aria-hidden="true" />
                </Button>
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

      <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2">
        <Button
          disabled={disabled || !canAdd || current === null}
          onClick={() => {
            if (current !== null) save(ModelPickerModel.withFallback(chain, ModelPickerModel.fallbackFor(current)))
          }}
          size="xs"
          variant="outline"
        >
          <PlusIcon aria-hidden="true" />
          Add current selection
        </Button>
        {scope === 'thread' && snapshot.threadChain !== null && (
          <Button disabled={disabled} onClick={() => void write(() => api.setChain({ sessionId: props.sessionId, chain: null }))} size="xs" variant="ghost">
            Use default
          </Button>
        )}
      </div>

      <div className="dshx:flex dshx:items-center dshx:justify-between dshx:gap-2">
        <p className="dshx:text-xs dshx:text-muted-foreground">After a fallback answers</p>
        <ToggleGroup
          aria-label="After a fallback answers"
          onValueChange={(value: string) => {
            if (value === 'stay' || value === 'next-turn') void write(() => api.setReturnPolicy({ returnPolicy: value }))
          }}
          size="sm"
          type="single"
          value={snapshot.returnPolicy}
          variant="outline"
        >
          {FALLBACK_RETURN_POLICIES.map(policy => (
            <ToggleGroupItem className="dshx:px-2 dshx:text-xs" disabled={disabled} key={policy} value={policy}>
              {RETURN_LABELS[policy]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      {error !== null && (
        <p className="dshx:text-xs dshx:text-destructive" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}
