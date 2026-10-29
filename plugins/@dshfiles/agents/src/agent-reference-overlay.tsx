import { useApi } from '@dshfiles/dshx/client'
import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Popover, PopoverAnchor, PopoverContent } from '@dshfiles/plugin-ui/components/ui/popover'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { errorMessage, useQuery } from '@dshfiles/plugin-ui/query'
import { useEffect, useMemo, useRef, useState } from 'react'

import { AgentAnchorModel } from './agent-anchor.js'
import { AGENTS_QUERY_ROOT, type Agent, type AgentThread } from './agent.js'
import { agentReferenceLabel, agentReferencePreviewEvent, agentReferencePreviewRequestSchema, type AgentReferencePreviewRequest } from './agent-reference.js'
import { installAgentReferenceLinks } from './agent-reference-links.js'
import { agentsApi } from './api.js'

const labelClass = 'dshx:text-[11px] dshx:font-semibold dshx:uppercase dshx:tracking-wider dshx:text-muted-foreground'
/** The card lists the newest threads; the Agents page keeps the rest. */
const PREVIEW_THREADS = 4

const day = (at: number): string => new Date(at).toISOString().slice(0, 10)

const routeLabel = (agent: Agent): string => {
  if (agent.route === null) return 'Harness default'
  const route = `${agent.route.provider}/${agent.route.model}`
  return agent.route.reasoningEffort === undefined ? route : `${route} · ${agent.route.reasoningEffort}`
}

const delegationLabel = (agent: Agent): string => {
  if (agent.delegation.messaging === 'any') return 'Any peer'
  if (agent.delegation.messaging === 'none') return 'No messaging'
  return agent.delegation.handles.length === 0 ? 'Listed peers (none)' : agent.delegation.handles.map(handle => `@${handle}`).join(', ')
}

const Detail = (props: { readonly label: string; readonly children: string }): JSX.Element => (
  <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-0.5">
    <dt className={labelClass}>{props.label}</dt>
    <Tooltip>
      <TooltipTrigger asChild>
        <dd className="dshx:truncate dshx:text-xs">{props.children}</dd>
      </TooltipTrigger>
      <TooltipContent className="dshx-root">{props.children}</TooltipContent>
    </Tooltip>
  </div>
)

const AgentCard = (props: {
  readonly agent: Agent
  readonly threads: readonly AgentThread[]
  readonly openThread: (sessionId: string) => void
}): JSX.Element => {
  const { agent } = props
  const instructions = agent.instructions.trim()
  return (
    <TooltipProvider>
      <header className="dshx:flex dshx:items-start dshx:gap-2.5">
        <span
          aria-hidden
          className="dshx:flex dshx:size-9 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded-xl dshx:border dshx:border-border dshx:bg-muted dshx:text-lg"
        >
          {agent.glyph === '' ? agent.name.slice(0, 1).toUpperCase() : agent.glyph}
        </span>
        <div className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-col dshx:gap-1">
          <div className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-1.5">
            <span className="dshx:truncate dshx:text-sm dshx:font-semibold">{agent.name}</span>
            <Badge variant="muted" className="dshx:font-normal">
              {agentReferenceLabel(agent.handle)}
            </Badge>
            {agent.enabled ? null : <Badge variant="outline">Disabled</Badge>}
          </div>
          <p className="dshx:text-xs dshx:text-muted-foreground">{agent.description === '' ? 'No description.' : agent.description}</p>
        </div>
      </header>
      <dl className="dshx:grid dshx:grid-cols-2 dshx:gap-x-3 dshx:gap-y-1.5">
        <Detail label="Model route">{routeLabel(agent)}</Detail>
        <Detail label="Tools">{agent.preset ?? 'Host default'}</Detail>
        <Detail label="Memory">{agent.memoryScope ?? 'Project block only'}</Detail>
        <Detail label="Threads">{agent.threadCount === 1 ? '1 thread' : `${String(agent.threadCount)} threads`}</Detail>
        <Detail label="Peers">{delegationLabel(agent)}</Detail>
        <Detail label="Subagents">{agent.delegation.subagents ? 'Allowed' : 'Off'}</Detail>
      </dl>
      {agent.routine.trim() === '' ? null : (
        <section className="dshx:flex dshx:flex-col dshx:gap-1">
          <h3 className={labelClass}>Routine</h3>
          <p className="dshx:whitespace-pre-wrap dshx:text-xs dshx:text-muted-foreground">{agent.routine}</p>
        </section>
      )}
      <section className="dshx:flex dshx:flex-col dshx:gap-1">
        <h3 className={labelClass}>Instructions</h3>
        <p className="dshx:max-h-36 dshx:overflow-auto dshx:whitespace-pre-wrap dshx:rounded-md dshx:border dshx:border-border dshx:bg-muted/50 dshx:p-2 dshx:text-xs">
          {instructions === '' ? 'None: the tool preset and the prompt decide how it works.' : instructions}
        </p>
      </section>
      <section className="dshx:flex dshx:flex-col dshx:gap-1">
        <h3 className={labelClass}>Recent threads</h3>
        {props.threads.length === 0 ? (
          <p className="dshx:text-xs dshx:text-muted-foreground">
            No thread yet{agent.lastUsedAt === null ? '' : `, last used ${day(agent.lastUsedAt)}`}. Mention it where a thread starts.
          </p>
        ) : (
          props.threads.slice(0, PREVIEW_THREADS).map(thread => (
            <button
              key={thread.sessionId}
              type="button"
              onClick={() => props.openThread(thread.sessionId)}
              className="dshx:flex dshx:w-full dshx:items-center dshx:gap-2 dshx:rounded-md dshx:px-1.5 dshx:py-1 dshx:text-left dshx:text-xs dshx:transition-colors dshx:hover:bg-accent"
            >
              <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate">{thread.title}</span>
              <span className="dshx:shrink-0 dshx:tabular-nums dshx:text-muted-foreground">{day(thread.startedAt)}</span>
            </button>
          ))
        )}
      </section>
    </TooltipProvider>
  )
}

export const AgentReferenceOverlay = (props: {
  /** Opens the Agents page on this agent, the way the sidebar's Agents row would. */
  readonly openInAgents: (handle: string) => void
  readonly openThread: (sessionId: string) => void
}): JSX.Element | null => {
  const api = useApi(agentsApi)
  const list = useQuery({
    queryKey: [AGENTS_QUERY_ROOT, 'list'],
    queryFn: ({ signal }) => api.list(undefined, { signal }),
    staleTime: 30_000,
  })
  const handles = useMemo(() => new Set((list.data?.agents ?? []).map(agent => agent.handle)), [list.data])
  const handlesRef = useRef(handles)
  handlesRef.current = handles
  // A saved or removed agent changes which mentions are references; the installer rescans the loaded transcript.
  const handlesKey = [...handles].sort().join(',')
  useEffect(() => installAgentReferenceLinks({ handles: () => handlesRef.current }), [handlesKey])

  const [request, setRequest] = useState<AgentReferencePreviewRequest | null>(null)
  const [anchor, setAnchor] = useState<AgentReferencePreviewRequest['anchor'] | null>(null)

  useEffect(() => {
    const open = (event: Event): void => {
      if (!(event instanceof CustomEvent)) return
      const parsed = agentReferencePreviewRequestSchema.safeParse(event.detail)
      if (!parsed.success) return
      setAnchor(parsed.data.anchor)
      setRequest(parsed.data)
    }
    window.addEventListener(agentReferencePreviewEvent, open)
    return () => window.removeEventListener(agentReferencePreviewEvent, open)
  }, [])

  // A landing message scrolls the conversation; the card follows the mention instead of disappearing under it.
  useEffect(() => {
    if (request === null) return
    const remeasure = (): void => {
      const measurement = AgentAnchorModel.measure(request.anchorId, window.innerHeight)
      if (measurement.kind === 'gone') return
      if (measurement.kind === 'offscreen') {
        setRequest(null)
        return
      }
      setAnchor(measurement.rect)
    }
    window.addEventListener('scroll', remeasure, true)
    window.addEventListener('resize', remeasure)
    return () => {
      window.removeEventListener('scroll', remeasure, true)
      window.removeEventListener('resize', remeasure)
    }
  }, [request])

  const agent = useQuery({
    queryKey: [AGENTS_QUERY_ROOT, 'reference-preview', request?.handle],
    enabled: request !== null,
    retry: false,
    staleTime: 15_000,
    queryFn: async ({ signal }) => {
      if (request === null) throw new Error('No agent reference is selected.')
      return (await api.get({ handle: request.handle }, { signal })).agent
    },
  })
  const threads = useQuery({
    queryKey: [AGENTS_QUERY_ROOT, 'reference-threads', request?.handle],
    enabled: request !== null,
    retry: false,
    staleTime: 15_000,
    queryFn: async ({ signal }) => {
      if (request === null) return []
      return (await api.threads({ handle: request.handle }, { signal })).threads
    },
  })

  if (request === null) return null
  const found = agent.data ?? null
  const missing = agent.isSuccess && found === null
  return (
    <Popover open onOpenChange={open => !open && setRequest(null)}>
      <PopoverAnchor asChild>
        <span
          aria-hidden
          style={{
            position: 'fixed',
            display: 'block',
            left: (anchor ?? request.anchor).left,
            top: (anchor ?? request.anchor).top,
            width: Math.max(1, (anchor ?? request.anchor).width),
            height: Math.max(1, (anchor ?? request.anchor).height),
            pointerEvents: 'none',
          }}
        />
      </PopoverAnchor>
      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={6}
        collisionPadding={8}
        className="dshx-root dshx:flex dshx:w-[30rem] dshx:max-w-[calc(100vw-1rem)] dshx:flex-col dshx:gap-0 dshx:overflow-hidden dshx:p-0"
        data-dshfiles-agent-preview
      >
        <div className="dshx:flex dshx:min-h-0 dshx:flex-col dshx:gap-3 dshx:overflow-auto dshx:p-4">
          {agent.isPending ? <p className="dshx:text-xs dshx:text-muted-foreground">Loading agent…</p> : null}
          {agent.isError ? (
            <p className="dshx:text-xs dshx:text-destructive" role="alert">
              {errorMessage(agent.error, 'Agent is unavailable.')}
            </p>
          ) : null}
          {missing ? (
            <p className="dshx:text-xs dshx:text-muted-foreground">No agent {agentReferenceLabel(request.handle)}. It may have been removed.</p>
          ) : null}
          {found === null ? null : <AgentCard agent={found} threads={threads.data ?? []} openThread={props.openThread} />}
        </div>
        <div className="dshx:flex dshx:justify-end dshx:border-t dshx:border-border dshx:px-4 dshx:py-2.5">
          {missing ? null : (
            <Button
              size="xs"
              variant="outline"
              onClick={() => {
                props.openInAgents(request.handle)
                setRequest(null)
              }}
            >
              Open in Agents
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
