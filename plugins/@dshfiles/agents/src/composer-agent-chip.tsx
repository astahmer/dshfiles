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
import { BotIcon, ChevronDownIcon, PinIcon, PinOffIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { errorMessage, useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { useSyncExternalStore, type ReactNode } from 'react'
import { AGENTS_QUERY_ROOT, type Agent } from './agent.js'
import { ComposerAgent } from './composer-agent.js'
import { ComposerAgentChoices } from './composer-agent-choices.js'
import { useClickOpenedMenu } from './composer-menu-trigger.js'

/** What the chip reads: the agents and project defaults from the Host, and this composer's project. */
export interface ComposerAgentChipProps {
  readonly sessionId: string
  /** The project this new thread starts in, or undefined outside a project. */
  readonly projectId: string | undefined
  readonly loadAgents: (signal: AbortSignal) => Promise<readonly Agent[]>
  readonly loadProjectDefaults: (signal: AbortSignal) => Promise<readonly { readonly projectId: string; readonly handle: string }[]>
  /** Set or clear (null) the project's default agent; the same `agents_project_default_set` the Agent has. */
  readonly setProjectDefault: (
    projectId: string,
    handle: string | null,
  ) => Promise<{ readonly kind: 'applied' | 'missing-agent'; readonly projects: readonly { readonly projectId: string; readonly handle: string }[] }>
}

/**
 * Own keys. The composer's agents sit under the panel's `[root, 'list']` prefix (the panel caches the whole snapshot at
 * that exact key), so a save or removal in the panel, which invalidates that prefix, refreshes the chip too.
 */
export const composerAgentKeys = {
  agents: [AGENTS_QUERY_ROOT, 'list', 'composer'] as const,
  projectDefaults: [AGENTS_QUERY_ROOT, 'composer', 'project-defaults'] as const,
  access: (sessionId: string) => [AGENTS_QUERY_ROOT, 'composer', 'thread-access', sessionId] as const,
}

const ITEM = 'dshx:pointer-coarse:min-h-11 dshx:flex dshx:min-w-0 dshx:items-baseline dshx:gap-2'

const AgentRow = (props: { readonly agent: Agent; readonly projectDefault: boolean }): ReactNode => (
  <span className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:items-baseline dshx:gap-2">
    <span className="dshx:min-w-0 dshx:truncate">
      {props.agent.glyph === '' ? '' : `${props.agent.glyph} `}
      {props.agent.name}
    </span>
    <span className="dshx:shrink-0 dshx:font-mono! dshx:text-xs dshx:text-muted-foreground">@{props.agent.handle}</span>
    {props.projectDefault ? <span className="dshx:ml-auto dshx:shrink-0 dshx:text-xs dshx:text-muted-foreground">project default</span> : null}
  </span>
)

/**
 * The agent a new thread starts as, beside the composer's tools: "as @reviewer". It shows once the project has a
 * default agent, the person picked one, or any agent of their own exists; the menu switches this one thread to another
 * agent or to `@dsh`, and makes the shown agent the project's default (or stops it being one). A pick is only read here:
 * the first send applies it (preset, model, instructions and the recorded agent).
 */
export const ComposerAgentChip = (props: ComposerAgentChipProps): ReactNode => {
  const agents = useQuery({ queryKey: composerAgentKeys.agents, queryFn: ({ signal }) => props.loadAgents(signal), staleTime: 30_000 })
  const defaults = useQuery({
    queryKey: composerAgentKeys.projectDefaults,
    queryFn: ({ signal }) => props.loadProjectDefaults(signal),
    staleTime: 30_000,
  })
  const choice = useSyncExternalStore(ComposerAgentChoices.subscribe, () => ComposerAgentChoices.get(props.sessionId))
  const client = useQueryClient()
  const menu = useClickOpenedMenu()
  const makeDefault = useMutation({
    mutationFn: async (input: { readonly projectId: string; readonly handle: string | null }) => {
      const result = await props.setProjectDefault(input.projectId, input.handle)
      if (result.kind === 'missing-agent') throw new Error('That agent no longer exists.')
      return result.projects
    },
    onSuccess: projects => {
      client.setQueryData(composerAgentKeys.projectDefaults, projects)
      ComposerAgentChoices.set(props.sessionId, null)
    },
  })
  if (agents.data === undefined) return null
  const projectDefault = ComposerAgent.projectDefaultOf(defaults.data ?? [], props.projectId)
  const ownAgents = agents.data.some(agent => agent.enabled && !agent.builtIn)
  if (projectDefault === null && choice === null && !ownAgents) return null
  const resolution = ComposerAgent.resolve({ agents: agents.data, projectDefault, choice })
  const handle = resolution.agent.handle
  const pick = (next: string): void => ComposerAgentChoices.set(props.sessionId, next === projectDefault ? null : next)
  const enabled = agents.data.filter(agent => agent.enabled)
  return (
    <DropdownMenu modal={false} open={menu.open} onOpenChange={menu.onOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button
          {...menu.triggerProps}
          type="button"
          variant="ghost"
          size="sm"
          data-composer-agent={handle}
          data-composer-agent-source={resolution.source}
          aria-label={`New thread runs as @${handle} (${ComposerAgent.sourceLabel(resolution.source)}). Change agent`}
          // The bar's 28px chip height; the composer row gives it a 44pt tap area (council round 34 A2).
          className="dshx-root dshx:min-w-0 dshx:shrink dshx:gap-1 dshx:px-2 dshx:text-muted-foreground dshx:hover:text-foreground"
          onMouseDown={event => event.preventDefault()}
        >
          <BotIcon aria-hidden />
          <span className="dshx:min-w-0 dshx:truncate">
            <span className="dshx:@max-pane-narrow:hidden">as </span>@{handle}
          </span>
          <ChevronDownIcon aria-hidden className="dshx:opacity-60 dshx:@max-pane-narrow:hidden" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="dshx-root dshx:w-80 dshx:max-w-[calc(100vw-1rem)]">
        <DropdownMenuLabel>Start this thread as</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={handle} onValueChange={pick}>
          {enabled.map(agent => (
            <DropdownMenuRadioItem key={agent.handle} value={agent.handle} className={ITEM}>
              <AgentRow agent={agent} projectDefault={agent.handle === projectDefault} />
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {props.projectId === undefined || (resolution.agent.builtIn && projectDefault === null) ? null : (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className={ITEM}
              disabled={makeDefault.isPending}
              onSelect={() =>
                props.projectId !== undefined &&
                // @dsh is what a project without a default runs, so making it the default clears the default.
                makeDefault.mutate({ projectId: props.projectId, handle: handle === projectDefault || resolution.agent.builtIn ? null : handle })
              }
            >
              {handle === projectDefault ? <PinOffIcon aria-hidden /> : <PinIcon aria-hidden />}
              {handle === projectDefault ? `Stop using @${handle} as this project’s default` : `Make @${handle} this project’s default`}
            </DropdownMenuItem>
          </>
        )}
        <DropdownMenuSeparator />
        <p role="status" className={cn('dshx:px-2 dshx:py-1.5 dshx:text-xs dshx:text-muted-foreground', makeDefault.isError && 'dshx:text-destructive')}>
          {makeDefault.isError
            ? `${errorMessage(makeDefault.error, 'The project default did not change.')} Pick another agent and try again.`
            : 'Its model, preset and instructions apply when you send. A message that starts with an @agent mention runs as that agent instead.'}
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
