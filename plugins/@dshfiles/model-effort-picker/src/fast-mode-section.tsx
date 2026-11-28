import { useEffect, useId, useState } from 'react'
import { aiAccountsFastModeApi } from '@dshfiles/ai-accounts/model-fast-mode-api'
import { useApi, useApiQuery } from '@dshfiles/dshx/client'
import { Switch } from '@dshfiles/plugin-ui/components/ui/switch'
import { errorMessage } from '@dshfiles/plugin-ui/query'

type Props = {
  readonly sessionId: string
  readonly provider: string
  readonly model: string
  readonly disabled: boolean
  readonly onEnabledChange: (enabled: boolean) => void
  /** On a draft (S1) the switch stages its value; "Use ‹model›" applies it. */
  readonly draft?: { readonly value: boolean | undefined; readonly onChange: (enabled: boolean) => void } | null
}

/**
 * Council picker round 1, C2: Fast mode is one visible, labelled row in details, the kit Switch at its end (28×16 drawn,
 * a 44 px row on touch). The label says what it does and what it costs, so no tooltip is needed.
 */
export const FastModeRow = (props: {
  readonly enabled: boolean
  readonly disabled: boolean
  readonly error: string | null
  readonly onChange: (enabled: boolean) => void
}) => {
  const labelId = useId()
  return (
    <div className="dshx:mt-3 dshx:flex dshx:flex-col dshx:gap-1" data-model-fast-mode>
      {/* The whole row is the one target (C6): a tap anywhere on it toggles Fast mode once, so no 34 px switch hit area sits
          beside a 44 px label that does the same. The switch keeps its own click (and the keyboard); a tap that lands on it
          is not counted twice. No <label>: WebKit re-dispatched a tap through a label onto the switch, toggling twice. */}
      <div
        className="dshx:flex dshx:min-h-8 dshx:cursor-pointer dshx:items-center dshx:gap-2 dshx:pointer-coarse:min-h-11"
        data-model-fast-row
        onClick={event => {
          if (props.disabled || (event.target instanceof Element && event.target.closest('[role="switch"]') !== null)) return
          props.onChange(!props.enabled)
        }}
      >
        <span className="dshx:min-w-0 dshx:flex-1 dshx:text-xs dshx:font-medium" id={labelId}>
          Fast mode <span className="dshx:font-normal dshx:text-muted-foreground">· may cost more</span>
        </span>
        <Switch
          // Round 5 U15: an explicit name (it was only aria-labelledby), the visible label's first words.
          aria-label="Fast mode"
          checked={props.enabled}
          // The row is the touch target, so the kit's 44 px hit area (an ::after 10 px past a 24 px switch) is off: it
          // pushed the details body 10 px wider than the sheet (round 3 R1).
          className="dshx:after:hidden dshx:data-[size=sm]:h-4! dshx:data-[size=sm]:w-7! dshx:*:data-[slot=switch-thumb]:size-3.5!"
          data-model-fast-mode-toggle
          data-touch-row
          disabled={props.disabled}
          onCheckedChange={props.onChange}
          size="sm"
        />
      </div>
      {props.error === null ? null : (
        <p className="dshx:text-2xs dshx:text-destructive" data-model-fast-mode-error>
          {props.error} Try the switch again, or reopen the picker.
        </p>
      )}
    </div>
  )
}

/**
 * When to ask a route's Fast mode status again (round 5 U3): while it reads unavailable, every 3 s for up to a minute
 * (Codex lists its Fast tiers once its catalog loads, which took longer than ten seconds after accounts came back).
 */
export class FastModeRetry {
  static readonly DELAY_MS = 3_000
  static readonly LIMIT = 20
  static shouldRetry(input: { readonly status: { readonly available: boolean } | undefined; readonly retries: number }): boolean {
    return input.status !== undefined && !input.status.available && input.retries < FastModeRetry.LIMIT
  }
}

/** Fast mode for the inspected route: hidden unless AI Accounts says the route supports it. */
export const FastModeSection = ({
  sessionId,
  provider,
  model,
  disabled,
  onEnabledChange,
  draft = null,
  onStatus,
}: Props & {
  /** Reports the route's stored state once it is known, so the list can mark the routes where Fast mode is on. */
  readonly onStatus?: (enabled: boolean) => void
}) => {
  const input = { sessionId, provider, model }
  const api = useApi(aiAccountsFastModeApi)
  const state = useApiQuery(aiAccountsFastModeApi, 'status', { input })
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const status = state.data
  useEffect(() => {
    if (status !== undefined && status.available) onStatus?.(status.enabled)
  }, [status, onStatus])
  // Round 5 U3: a route reads "unavailable" while its service's catalog is still loading (Codex lists its Fast tiers
  // late), and nothing asked again, so the row never came. Ask again a few times while the details stay open.
  const [retries, setRetries] = useState(0)
  const { refetch } = state
  useEffect(() => setRetries(0), [sessionId, provider, model])
  useEffect(() => {
    if (!FastModeRetry.shouldRetry({ status, retries })) return
    const timer = setTimeout(() => {
      setRetries(count => count + 1)
      refetch()
    }, FastModeRetry.DELAY_MS)
    return () => clearTimeout(timer)
  }, [status, retries, refetch])
  if (status === undefined || !status.available) return null

  const update = async (enabled: boolean): Promise<void> => {
    if (draft !== null) {
      draft.onChange(enabled)
      return
    }
    setPending(true)
    setError(null)
    try {
      const updated = await api.setFast({ ...input, enabled })
      onEnabledChange(updated.enabled)
      await state.refetch()
    } catch (cause) {
      setError(errorMessage(cause, 'Fast mode could not be updated.'))
    } finally {
      setPending(false)
    }
  }

  return (
    <FastModeRow
      disabled={(disabled && draft === null) || pending}
      enabled={draft?.value ?? status.enabled}
      error={error}
      onChange={enabled => void update(enabled)}
    />
  )
}
