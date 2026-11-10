import { EntityList, EntityRow } from '@dshfiles/plugin-ui/components/entity-row'
import { EmptyState } from '@dshfiles/plugin-ui/components/page'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@dshfiles/plugin-ui/components/ui/dropdown-menu'
import { SearchInput } from '@dshfiles/plugin-ui/components/ui/search-input'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import { Switch } from '@dshfiles/plugin-ui/components/ui/switch'
import { CopyIcon, EllipsisIcon, SendIcon, TrashIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { memo, useState } from 'react'

import type { AgentTemplate } from './agent-editor.js'
import type { Agent } from './agent.js'

/** The list above which a filter field appears; a handful of agents reads faster without one. */
const SEARCH_ABOVE = 6

/** An agent's name with its glyph in front; the glyph is decoration, so the accessible name is the name alone. */
export const AgentName = (props: { readonly glyph: string; readonly name: string }): JSX.Element => (
  <span className="dshx:inline-flex dshx:min-w-0 dshx:items-center dshx:gap-1.5">
    {props.glyph === '' ? null : (
      <span aria-hidden className="dshx:shrink-0 dshx:leading-none">
        {props.glyph}
      </span>
    )}
    <span className="dshx:min-w-0 dshx:truncate">{props.name}</span>
  </span>
)

export interface AgentListActions {
  readonly select: (handle: string) => void
  readonly setEnabled: (agent: Agent, enabled: boolean) => void
  readonly startThread: (agent: Agent) => void
  readonly duplicate: (agent: Agent) => void
  readonly remove: (agent: Agent) => void
}

const matches = (agent: Agent, query: string): boolean => {
  const needle = query.trim().toLowerCase().replace(/^@/u, '')
  if (needle === '') return true
  return [agent.name, agent.handle, agent.description].some(text => text.toLowerCase().includes(needle))
}

const plural = (count: number, word: string): string => `${String(count)} ${word}${count === 1 ? '' : 's'}`

/** The registry as rows: glyph, name, handle, model and thread count, with the enable switch and a row menu. */
const AgentListRows = (props: {
  readonly agents: readonly Agent[]
  readonly selected: string | null
  readonly loading: boolean
  readonly pendingHandles: ReadonlySet<string>
  readonly routeLabel: (agent: Agent) => string
  readonly actions: AgentListActions
}): JSX.Element => {
  const [query, setQuery] = useState('')
  const visible = props.agents.filter(agent => matches(agent, query))

  if (props.loading) return <Spinner className="dshx:mx-auto dshx:my-6" />

  return (
    <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-2">
      {props.agents.length > SEARCH_ABOVE ? (
        <SearchInput aria-label="Filter agents" placeholder="Filter by name or @handle" value={query} onChange={event => setQuery(event.currentTarget.value)} />
      ) : null}
      <EntityList aria-label="Agents">
        {visible.map(agent => (
          <EntityRow
            key={agent.handle}
            role="listitem"
            data-agent-row={agent.handle}
            selected={props.selected === agent.handle}
            className={cn(!agent.enabled && 'dshx:[&_[data-slot=entity-row-title]]:text-muted-foreground')}
            onSelect={() => props.actions.select(agent.handle)}
            heading={<AgentName glyph={agent.glyph} name={agent.name} />}
            meta={<span className="dshx:font-mono">@{agent.handle}</span>}
            description={`${agent.enabled ? props.routeLabel(agent) : 'Off · mentions ignore it'}${agent.threadCount > 0 ? ` · ${plural(agent.threadCount, 'thread')}` : ''}`}
            trailing={
              <>
                <Switch
                  size="sm"
                  aria-label={`${agent.enabled ? 'Turn off' : 'Turn on'} @${agent.handle}`}
                  checked={agent.enabled}
                  disabled={props.pendingHandles.has(agent.handle)}
                  onCheckedChange={enabled => props.actions.setEnabled(agent, enabled)}
                />
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="icon-xs" variant="ghost" aria-label={`Actions for ${agent.name}`} className="dshx:text-muted-foreground">
                      <EllipsisIcon />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="dshx-root">
                    <DropdownMenuItem onSelect={() => props.actions.startThread(agent)}>
                      <SendIcon />
                      Start thread…
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => props.actions.duplicate(agent)}>
                      <CopyIcon />
                      Duplicate
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" disabled={agent.builtIn} onSelect={() => props.actions.remove(agent)}>
                      <TrashIcon />
                      {agent.builtIn ? 'Built in, cannot be removed' : 'Remove…'}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            }
          />
        ))}
        {visible.length === 0 ? <EmptyState action={{ label: 'Clear filter', onSelect: () => setQuery('') }}>No agent matches “{query}”.</EmptyState> : null}
      </EntityList>
    </div>
  )
}

/** Memoized: an editor keystroke changes the panel's state, not this list, so the rows skip the re-render. */
export const AgentList = memo(AgentListRows)

/** Starting points for a new agent, as one list; picking one opens an unsaved draft. */
export const AgentTemplates = (props: { readonly templates: readonly AgentTemplate[]; readonly onPick: (template: AgentTemplate) => void }): JSX.Element => (
  <EntityList aria-label="Templates">
    {props.templates.map(template => (
      <EntityRow
        key={template.id}
        role="listitem"
        onSelect={() => props.onPick(template)}
        heading={<AgentName glyph={template.glyph} name={template.name} />}
        description={template.description}
      />
    ))}
  </EntityList>
)
