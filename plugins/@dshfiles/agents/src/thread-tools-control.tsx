import { StatusDot } from '@dshfiles/plugin-ui/components/ui/status-dot'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@dshfiles/plugin-ui/components/ui/dropdown-menu'
import { RotateCcwIcon, WrenchIcon } from '@dshfiles/plugin-ui/icons'
import { errorMessage, useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { usePhoneThreadTool } from '@dshfiles/rich-composer/phone-thread-menu'
import type { ReactNode } from 'react'
import type { Agent } from './agent.js'
import { composerAgentKeys } from './composer-agent-chip.js'
import { useClickOpenedMenu } from './composer-menu-trigger.js'
import type { ThreadAccessView, ThreadToolOverrideRequest } from './thread-agents.js'
import { ThreadTools } from './thread-tools-model.js'

export interface ThreadToolsControlProps {
  readonly sessionId: string
  readonly loadAgents: (signal: AbortSignal) => Promise<readonly Agent[]>
  readonly loadAccess: (sessionId: string, signal: AbortSignal) => Promise<ThreadAccessView>
  readonly setOverride: (
    sessionId: string,
    override: ThreadToolOverrideRequest,
  ) => Promise<{ readonly kind: 'applied' | 'missing-agent'; readonly view: ThreadAccessView }>
}

const ITEM = 'dshx:pointer-coarse:min-h-11'

/**
 * A running thread's tools, in the composer's tool row: its agent, how that agent was decided, and whose tools apply.
 * The menu switches this thread to another agent's tool set or to every tool, or resets the override; the change
 * applies from the thread's next model request (the same `agents_thread_override_set` the Agent has).
 */
export const ThreadToolsControl = (props: ThreadToolsControlProps): ReactNode => {
  const client = useQueryClient()
  const access = useQuery({
    queryKey: composerAgentKeys.access(props.sessionId),
    queryFn: ({ signal }) => props.loadAccess(props.sessionId, signal),
    staleTime: 15_000,
  })
  const menu = useClickOpenedMenu(() => void access.refetch())
  const agents = useQuery({
    queryKey: composerAgentKeys.agents,
    queryFn: ({ signal }) => props.loadAgents(signal),
    staleTime: 30_000,
    enabled: menu.open,
  })
  const change = useMutation({
    mutationFn: async (override: ThreadToolOverrideRequest) => {
      const result = await props.setOverride(props.sessionId, override)
      if (result.kind === 'missing-agent') throw new Error('That agent no longer exists. Pick another one, or reset to the thread’s own tools.')
      return result.view
    },
    onSuccess: view => client.setQueryData(composerAgentKeys.access(props.sessionId), view),
  })
  const state = access.data === undefined ? undefined : ThreadTools.state(access.data)
  const shown = state === undefined ? '' : state.overridden && state.value === 'all' ? 'All tools' : `@${state.agent}`
  // A phone bar has no room for the words (they would push the model name out), and a bare wrench says nothing (council
  // round 34 B1): there the control leaves the bar for the thread's ⋯ sheet as a labelled row, as Saved prompts and
  // Annotations do, and comes back in place while its menu is open.
  const phoneTool = usePhoneThreadTool({
    id: '@dshfiles/agents/tools',
    label: `Tools · ${shown}${state?.overridden === true ? ' (changed)' : ''}`,
    open: () => menu.onOpenChange(true),
    active: menu.open,
    available: state !== undefined,
  })
  if (access.data === undefined || state === undefined) return null
  const apply = (value: string): void => {
    if (!ThreadTools.isValue(value) || value === state.value) return
    change.mutate(ThreadTools.requestFor(value, state.agent))
  }
  const label = `Tools: ${state.tools}. Thread agent @${state.agent} (${state.source}). Change tools`
  return (
    <DropdownMenu modal={false} open={menu.open} onOpenChange={menu.onOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button
          {...menu.triggerProps}
          {...phoneTool.triggerProps}
          type="button"
          variant="ghost"
          size="sm"
          aria-label={label}
          data-thread-tools={state.value}
          data-thread-tools-source={access.data.policy.source}
          // The bar's 28px chip height: the composer row gives every button its 44pt tap area, so a taller box would only
          // grow the bar and pull Send off the + control's line (council round 34 A2).
          className="dshx-root dshx:min-w-0 dshx:shrink dshx:gap-1 dshx:px-2 dshx:text-muted-foreground dshx:hover:text-foreground"
          onMouseDown={event => event.preventDefault()}
        >
          <WrenchIcon aria-hidden />
          <span className="dshx:min-w-0 dshx:truncate dshx:@max-pane-narrow:sr-only">
            {shown}
          </span>
          {state.overridden ? <StatusDot size="sm" tone="warning" /> : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="start"
        className="dshx-root dshx:w-80 dshx:max-w-[calc(100vw-1rem)]"
        onCloseAutoFocus={phoneTool.onCloseAutoFocus}
      >
        <DropdownMenuLabel className="dshx:flex dshx:flex-col dshx:gap-0.5">
          <span>
            Thread agent <span className="dshx:font-mono!">@{state.agent}</span>
          </span>
          <span className="dshx:text-xs dshx:font-normal dshx:text-muted-foreground">
            {state.source}
            {state.recorded ? '' : ' · decided at its next request'} · now {state.tools}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="dshx:text-xs dshx:font-normal dshx:text-muted-foreground">Use the tools of</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={state.value} onValueChange={apply}>
          {ThreadTools.choices(agents.data ?? [], state.agent).map(agent => (
            <DropdownMenuRadioItem key={agent.handle} value={`agent:${agent.handle}`} className={ITEM} disabled={change.isPending}>
              <span className="dshx:min-w-0 dshx:truncate">
                {agent.glyph === '' ? '' : `${agent.glyph} `}
                {agent.name}
              </span>
              <span className="dshx:ml-auto dshx:shrink-0 dshx:font-mono! dshx:text-xs dshx:text-muted-foreground">@{agent.handle}</span>
            </DropdownMenuRadioItem>
          ))}
          <DropdownMenuRadioItem value="all" className={ITEM} disabled={change.isPending}>
            All tools
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        {state.overridden ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem className={ITEM} disabled={change.isPending} onSelect={() => change.mutate(null)}>
              <RotateCcwIcon aria-hidden /> Reset to @{state.agent}’s tools
            </DropdownMenuItem>
          </>
        ) : null}
        <DropdownMenuSeparator />
        <p role="status" className="dshx:px-2 dshx:py-1.5 dshx:text-xs dshx:text-muted-foreground">
          {change.isError
            ? `${errorMessage(change.error, 'The change did not apply.')} Try again, or edit the agent in the Agents panel.`
            : 'Applies from this thread’s next request.'}
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
