import { compactionApi } from '@dshfiles/context-compaction/compaction-api'
import { isApiOwnerMissing } from '@dshfiles/dshx/api'
import { Composer, useApi, useContract, type ComposerService } from '@dshfiles/dshx/client'
import { sessionsApi } from '@dshfiles/session-controller/sessions-api'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@dshfiles/plugin-ui/components/ui/popover'
import { HourglassIcon } from '@dshfiles/plugin-ui/icons'
import { errorMessage, useMutation, useQuery } from '@dshfiles/plugin-ui/query'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import { useEffect, useMemo, useState } from 'react'
import { aiAccountsQueries } from './accounts-queries.js'
import { aiAccountsApi } from './api.js'
import { SESSION_COST_PROJECTION_KEY, sessionCostViewSchema } from './cost-estimate.js'
import { AiAccountsSchema } from './effect-schema.js'
import { IdleCacheModel } from './idle-cache-model.js'
import { usePreferences } from './use-preferences.js'

/** The native token meter's `contextPressure` projection, read structurally: an older Host may publish less. */
const ContextPressure = Schema.Struct({
  pressureTokens: Schema.optional(Schema.Finite),
  projectedTokens: Schema.optional(Schema.Finite),
})

interface SessionRow {
  readonly updatedAt: number
  readonly running: boolean
  readonly cwd?: string | undefined
  readonly title?: string | undefined
}

type UseSessions = <Selected>(select: (state: { readonly byId: Readonly<Record<string, SessionRow | undefined>> }) => Selected) => Selected
/** What the composer's projection hook hands over for the two keys read here, before decoding. */
type ProjectionSnapshot = typeof ContextPressure.Encoded | typeof sessionCostViewSchema.Encoded | undefined
type UseProjection = (key: string) => ProjectionSnapshot

const isProjectionHook = (value: unknown): value is UseProjection => typeof value === 'function'
const isSessionsHook = (value: unknown): value is UseSessions => typeof value === 'function'

/** Per thread, the last-use time the user chose to send past anyway; a new request re-arms the warning. */
const dismissed = new Map<string, number>()

interface IdleCacheWarningProps {
  readonly sessionId: string
  readonly useProjection?: unknown
  readonly useSessions?: unknown
  readonly openSession: (sessionId: string) => void
}

/**
 * Before the user messages a long thread idle past its provider's prompt-cache lifetime, a chip in the composer's meter
 * line says what the next request re-sends uncached and what it costs, and offers to compact first or continue in a new
 * thread that references this one. Sending anyway needs no action: the message goes as usual.
 */
export const IdleCacheWarningDockEntry = (props: IdleCacheWarningProps): JSX.Element | null => {
  const { idleCacheWarning } = usePreferences()
  if (!idleCacheWarning || !isProjectionHook(props.useProjection) || !isSessionsHook(props.useSessions)) return null
  return <IdleCacheWarning openSession={props.openSession} sessionId={props.sessionId} useProjection={props.useProjection} useSessions={props.useSessions} />
}

const IdleCacheWarning = (props: {
  readonly sessionId: string
  readonly useProjection: UseProjection
  readonly useSessions: UseSessions
  readonly openSession: (sessionId: string) => void
}) => {
  const preferences = usePreferences()
  const accounts = useApi(aiAccountsApi)
  const compaction = useApi(compactionApi)
  const sessions = useApi(sessionsApi)
  const composer = useContract(Composer)
  const sessionId = props.sessionId
  const lastUsedAt = props.useSessions(state => state.byId[sessionId]?.updatedAt ?? null)
  const running = props.useSessions(state => state.byId[sessionId]?.running === true)
  const cwd = props.useSessions(state => state.byId[sessionId]?.cwd)
  const title = props.useSessions(state => state.byId[sessionId]?.title)
  const pressure = Option.getOrUndefined(Schema.decodeUnknownOption(ContextPressure)(props.useProjection('contextPressure')))
  const costView = props.useProjection(SESSION_COST_PROJECTION_KEY)

  const threshold = useQuery({
    queryKey: ['ai-accounts', 'idle-cache', 'compaction-threshold', sessionId, lastUsedAt],
    queryFn: ({ signal }) => compaction.threshold({ sessionId }, { signal }),
    staleTime: Number.POSITIVE_INFINITY,
    retry: (count, error) => !isApiOwnerMissing(error) && count < 2,
  })
  // The engine's route first; without context-compaction, the route that served the latest turn.
  const route = useMemo(() => {
    const engine = threshold.data
    if (engine !== undefined && engine !== null) return { provider: engine.provider, model: engine.model }
    const parsed = AiAccountsSchema.decodeResult(sessionCostViewSchema, costView)
    const group = parsed._tag === 'Success' ? parsed.success.turn?.groups.at(-1) : undefined
    return group === undefined || group.provider === '' ? null : { provider: group.provider, model: group.model }
  }, [costView, threshold.data])
  const promptTokens = pressure?.projectedTokens ?? pressure?.pressureTokens ?? threshold.data?.usedTokens ?? undefined

  const quotes = useQuery({
    ...aiAccountsQueries.routeQuotes(accounts, { routes: route === null ? [] : [route], overrides: preferences.pricingOverrides }),
    enabled: route !== null,
  })
  const quote = quotes.data?.quotes[0]

  const [now, setNow] = useState(Date.now)
  const lifetime =
    route === null
      ? null
      : IdleCacheModel.lifetime({
          ...route,
          modelsDevId: quote?.modelsDevId ?? null,
          overrides: preferences.promptCacheMinutes,
          retention: preferences.promptCacheRetention,
          longCacheMinutes: quote?.longCacheMinutes,
        })
  const expiresAt = lastUsedAt === null ? null : IdleCacheModel.expiresAt({ lastUsedAt, lifetime })
  useEffect(() => {
    const current = Date.now()
    setNow(current)
    if (expiresAt === null || expiresAt <= current) return
    const timer = setTimeout(() => setNow(Date.now()), expiresAt - current + 1_000)
    return () => clearTimeout(timer)
  }, [expiresAt])
  const [dismissedAt, setDismissedAt] = useState(() => dismissed.get(sessionId))

  const compact = useMutation({
    mutationFn: async () => {
      const result = await sessions.compact({ sessionId })
      if (result.kind === 'error') throw new Error(result.text ?? 'Compaction failed.')
    },
  })
  const continueElsewhere = useMutation({
    mutationFn: async () => {
      const service = composer.status === 'active' ? composer.value : undefined
      const draft = service?.text({ sessionId }) ?? ''
      const reference = IdleCacheModel.referencePrompt({ sessionId, title, draft })
      const hasDraft = draft.trim() !== ''
      const location = cwd === undefined ? {} : { cwd }
      const created = await sessions.create(hasDraft ? { ...location, prompt: reference } : location)
      if (hasDraft) service?.setText({ sessionId, text: '' })
      props.openSession(created.sessionId)
      if (!hasDraft && service !== undefined) prefillWhenShown({ composer: service, from: sessionId, sessionId: created.sessionId, text: reference })
    },
  })

  const facts =
    route === null || dismissedAt === lastUsedAt
      ? null
      : IdleCacheModel.of({
          now,
          lastUsedAt,
          running,
          promptTokens,
          minTokens: preferences.idleCacheMinTokens,
          route,
          quote,
          overrides: preferences.promptCacheMinutes,
          retention: preferences.promptCacheRetention,
        })
  if (facts === null) return null
  const sendAnyway = (): void => {
    if (lastUsedAt === null) return
    dismissed.set(sessionId, lastUsedAt)
    setDismissedAt(lastUsedAt)
  }
  const failure = compact.error ?? continueElsewhere.error
  const busy = compact.isPending || continueElsewhere.isPending
  const label = IdleCacheModel.label(facts)

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          aria-label={`${label}. ${IdleCacheModel.detail(facts)}`}
          className="dshx-root dshx:inline-flex dshx:min-w-0 dshx:shrink dshx:items-center dshx:gap-1 dshx:rounded-full dshx:px-2 dshx:py-px dshx:text-xs dshx:whitespace-nowrap dshx:text-muted-foreground dshx:tabular-nums dshx:outline-none dshx:hover:bg-accent dshx:hover:text-foreground dshx:pointer-coarse:min-h-11 dshx:focus-visible:ring-[3px] dshx:focus-visible:ring-ring/50"
          data-ai-accounts-idle-cache=""
          type="button"
        >
          <HourglassIcon aria-hidden className="dshx:size-3.5 dshx:shrink-0" />
          <span className="dshx:min-w-0 dshx:truncate">{label}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="center" className="dshx-root dshx:flex dshx:w-80 dshx:flex-col dshx:gap-3 dshx:p-3 dshx:text-xs" side="top">
        <p>{IdleCacheModel.detail(facts)}</p>
        {failure === null ? null : (
          <p className="dshx:text-destructive" role="alert">
            {errorMessage(failure, 'The action failed.')} Try again, or send the message as is.
          </p>
        )}
        <div className="dshx:flex dshx:flex-wrap dshx:gap-2">
          <Button disabled={busy} onClick={() => compact.mutate()} size="sm" type="button">
            {compact.isPending ? 'Compacting…' : 'Compact first'}
          </Button>
          <Button disabled={busy} onClick={() => continueElsewhere.mutate()} size="sm" type="button" variant="outline">
            New thread with a reference
          </Button>
          <Button disabled={busy} onClick={sendAnyway} size="sm" type="button" variant="ghost">
            Send anyway
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

/** Put the reference in the new thread's composer once it is on screen; give up when the user opens another thread first. */
const prefillWhenShown = (input: {
  readonly composer: Pick<ComposerService, 'current' | 'setText'>
  readonly from: string
  readonly sessionId: string
  readonly text: string
}): void => {
  const unsubscribe = input.composer.current.subscribe(() => {
    const current = input.composer.current.get()
    if (current === input.sessionId) input.composer.setText({ sessionId: input.sessionId, text: input.text })
    if (current === input.sessionId || (current !== undefined && current !== input.from)) unsubscribe()
  })
}
