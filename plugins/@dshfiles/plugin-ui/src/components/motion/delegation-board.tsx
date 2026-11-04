import * as React from 'react'
import { useEnter, useFlip } from '../../motion/react.js'
import { cn } from '../../lib/utils.js'
import type { LucideIcon } from '../../icons.js'
import { GripVerticalIcon, LoaderCircleIcon, SparklesIcon, UserPlusIcon } from '../../icons.js'
import { Button } from '../ui/button.js'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '../ui/dropdown-menu.js'
import { Switch } from '../ui/switch.js'
import { AgentAvatar, agentToneSoft, type AgentTone } from './agent-avatar.js'
import { RollingNumber } from './text.js'

export interface DelegationTask {
  readonly id: string
  readonly title: string
  readonly estimateMin: number
  /** Where the task comes from (repo, backlog, inbox): lucide icons, no brand logos. */
  readonly sources?: readonly { readonly label: string; readonly icon: LucideIcon }[]
}

export interface DelegationAgent {
  readonly id: string
  readonly name: string
  readonly model: string
  /** Dollars per minute while working. */
  readonly ratePerMin: number
  readonly tone?: AgentTone
  /** Task it is working on now. */
  readonly active?: DelegationTask
  /** Tasks lined up after the active one. */
  readonly queued?: readonly DelegationTask[]
  /** "13:31": shown as "Busy until 13:31" while it has work. */
  readonly busyUntil?: string
}

export interface DelegationBoardProps extends React.HTMLAttributes<HTMLElement> {
  readonly unassigned: readonly DelegationTask[]
  readonly agents: readonly DelegationAgent[]
  /** Auto-assign: new tasks go to whoever is free first. */
  readonly auto: boolean
  readonly onAutoChange?: (auto: boolean) => void
  readonly onAssign?: (taskId: string, agentId: string) => void
  /** Dollars committed across all agent queues. */
  readonly queuedCost: number
}

const DRAG_TYPE = 'application/x-dsh-delegation-task'
const money = (value: number) => `$${value.toFixed(2)}`

/**
 * Delegate work to agents: drag an unassigned task onto an agent (or use its Assign menu) and the card glides into
 * that agent's lane as a chip; the agent flips from Free to Busy. Auto mode hands tasks out by itself. Subagent
 * dispatch, backlog items to threads, a review queue.
 */
export function DelegationBoard({ unassigned, agents, auto, onAutoChange, onAssign, queuedCost, className, ...props }: DelegationBoardProps) {
  const rootRef = React.useRef<HTMLElement>(null)
  const [dragging, setDragging] = React.useState<string | null>(null)
  const [over, setOver] = React.useState<string | null>(null)
  const autoId = React.useId()
  const layoutKey = [
    unassigned.map(task => task.id).join(','),
    agents.map(agent => `${agent.id}:${agent.active?.id ?? ''}:${(agent.queued ?? []).map(task => task.id).join(',')}`).join('|'),
  ].join('#')
  useFlip(rootRef, [layoutKey], { enterPreset: 'popIn' })

  const assign = (taskId: string, agentId: string) => {
    setDragging(null)
    setOver(null)
    onAssign?.(taskId, agentId)
  }

  return (
    <section ref={rootRef} aria-label="Delegate tasks" className={cn('dshx:@container dshx:flex dshx:flex-col dshx:text-sm', className)} {...props}>
      <header className="dshx:flex dshx:items-center dshx:gap-2 dshx:border-b dshx:border-border dshx:px-4 dshx:py-3">
        <SparklesIcon aria-hidden className="dshx:size-4 dshx:shrink-0 dshx:text-info" />
        <span className="dshx:font-medium">Delegate</span>
        <Hint text={auto ? 'New tasks go to whoever is free first' : 'Drag a task onto an agent'} />
        <label htmlFor={autoId} className="dshx:ml-auto dshx:text-muted-foreground">
          Auto
        </label>
        <Switch id={autoId} checked={auto} onCheckedChange={checked => onAutoChange?.(checked)} />
      </header>
      <div className="dshx:grid dshx:grid-cols-[minmax(0,0.85fr)_minmax(0,1.4fr)] dshx:gap-3 dshx:p-3 dshx:@max-pane-narrow:grid-cols-1">
        <div
          className={cn(
            'dshx:flex dshx:flex-col dshx:gap-2 dshx:rounded-xl dshx:p-2 dshx:transition-colors dshx:motion-reduce:transition-none',
            auto ? 'dshx:bg-transparent' : 'dshx:bg-muted/50',
          )}
        >
          <div className="dshx:flex dshx:items-center dshx:gap-2 dshx:px-1 dshx:text-muted-foreground">
            Unassigned
            <span className="dshx:inline-flex dshx:rounded dshx:border dshx:border-border dshx:px-1 dshx:text-xs dshx:text-foreground">
              <RollingNumber value={unassigned.length} />
            </span>
          </div>
          <ul aria-label="Unassigned tasks" className="dshx:flex dshx:flex-col dshx:gap-1.5">
            {unassigned.map(task => (
              <li
                key={task.id}
                data-flip-key={task.id}
                draggable
                onDragStart={event => {
                  event.dataTransfer.setData(DRAG_TYPE, task.id)
                  event.dataTransfer.effectAllowed = 'move'
                  setDragging(task.id)
                }}
                onDragEnd={() => {
                  setDragging(null)
                  setOver(null)
                }}
                className={cn(
                  'dshx:group dshx:flex dshx:cursor-grab dshx:items-start dshx:gap-1.5 dshx:rounded-lg dshx:px-2 dshx:py-2 dshx:transition-[opacity,box-shadow,background-color] dshx:motion-reduce:transition-none dshx:active:cursor-grabbing',
                  auto ? 'dshx:bg-transparent' : 'dshx:border dshx:border-border dshx:bg-card dshx:shadow-xs dshx:hover:shadow-md',
                  dragging === task.id && 'dshx:opacity-40',
                )}
              >
                <GripVerticalIcon aria-hidden className="dshx:mt-0.5 dshx:size-3.5 dshx:shrink-0 dshx:text-muted-foreground/60" />
                <div className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-col dshx:gap-0.5">
                  <span className="dshx:min-w-0 dshx:truncate dshx:font-medium">{task.title}</span>
                  <span className="dshx:flex dshx:items-center dshx:gap-1 dshx:text-xs dshx:text-muted-foreground">
                    {(task.sources ?? []).map(source => (
                      <source.icon key={source.label} aria-label={source.label} className="dshx:size-3 dshx:shrink-0" />
                    ))}
                    ~{task.estimateMin} min
                  </span>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Assign ${task.title}`}
                      className="dshx:text-muted-foreground dshx:opacity-0 dshx:group-hover:opacity-100 dshx:focus-visible:opacity-100 dshx:data-[state=open]:opacity-100 dshx:@max-pane-narrow:opacity-100"
                    >
                      <UserPlusIcon />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuLabel>Assign to</DropdownMenuLabel>
                    {agents.map(agent => (
                      <DropdownMenuItem key={agent.id} onSelect={() => assign(task.id, agent.id)}>
                        <AgentAvatar name={agent.name} tone={agent.tone ?? 'chart-4'} size="xs" decorative />
                        {agent.name}
                        <span className="dshx:ml-auto dshx:text-xs dshx:text-muted-foreground">{agent.active ? 'Busy' : 'Free'}</span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </li>
            ))}
          </ul>
          {unassigned.length === 0 ? <p className="dshx:px-1 dshx:py-2 dshx:text-xs dshx:text-muted-foreground">All delegated</p> : null}
        </div>

        <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-1">
          <div className="dshx:flex dshx:items-center dshx:justify-between dshx:px-1 dshx:pt-2 dshx:pb-1 dshx:text-muted-foreground">
            <span>Agents</span>
            <span className="dshx:flex dshx:gap-1">
              <RollingNumber value={queuedCost} format={money} /> in queues
            </span>
          </div>
          <ul aria-label="Agents" className="dshx:flex dshx:flex-col dshx:gap-1">
            {agents.map(agent => (
              <li
                key={agent.id}
                onDragOver={event => {
                  if (!event.dataTransfer.types.includes(DRAG_TYPE)) return
                  event.preventDefault()
                  event.dataTransfer.dropEffect = 'move'
                  if (over !== agent.id) setOver(agent.id)
                }}
                onDragLeave={event => {
                  const next = event.relatedTarget
                  if (!(next instanceof Node) || !event.currentTarget.contains(next)) setOver(current => (current === agent.id ? null : current))
                }}
                onDrop={event => {
                  event.preventDefault()
                  const taskId = event.dataTransfer.getData(DRAG_TYPE)
                  if (taskId) assign(taskId, agent.id)
                }}
                className={cn(
                  'dshx:flex dshx:gap-3 dshx:rounded-xl dshx:p-2 dshx:transition-[background-color,box-shadow] dshx:duration-200 dshx:motion-reduce:transition-none',
                  over === agent.id
                    ? 'dshx:bg-info/10 dshx:ring-2 dshx:ring-info/40'
                    : dragging !== null
                      ? 'dshx:outline-1 dshx:outline-dashed dshx:outline-border'
                      : '',
                )}
              >
                <AgentAvatar name={agent.name} tone={agent.tone ?? 'chart-4'} size="md" decorative className="dshx:border dshx:border-border" />
                <div className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-col dshx:gap-1.5">
                  <div className="dshx:flex dshx:items-start dshx:gap-2">
                    <div className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-col">
                      <span className="dshx:truncate dshx:font-medium">{agent.name}</span>
                      <span className="dshx:truncate dshx:text-muted-foreground">
                        {agent.model} <span className="dshx:opacity-70">{money(agent.ratePerMin)}/min</span>
                      </span>
                    </div>
                    <BusyBadge busyUntil={agent.active ? (agent.busyUntil ?? 'later') : undefined} />
                  </div>
                  {agent.active || (agent.queued ?? []).length > 0 ? (
                    <div className="dshx:flex dshx:flex-wrap dshx:gap-1.5">
                      {agent.active ? (
                        <span
                          data-flip-key={agent.active.id}
                          className={cn(
                            'dshx:inline-flex dshx:max-w-full dshx:items-center dshx:gap-1.5 dshx:rounded-md dshx:px-2 dshx:py-1',
                            agentToneSoft['chart-1'],
                          )}
                        >
                          <LoaderCircleIcon aria-label="Running" className="dshx:size-3.5 dshx:shrink-0 dshx:animate-spin dshx:motion-reduce:animate-none" />
                          <span className="dshx:min-w-0 dshx:truncate">{agent.active.title}</span>
                        </span>
                      ) : null}
                      {(agent.queued ?? []).map(task => (
                        <span
                          key={task.id}
                          data-flip-key={task.id}
                          className="dshx:inline-flex dshx:max-w-full dshx:items-center dshx:gap-1.5 dshx:rounded-md dshx:border dshx:border-border dshx:px-2 dshx:py-1 dshx:text-muted-foreground"
                        >
                          {(task.sources ?? []).map(source => (
                            <source.icon key={source.label} aria-hidden className="dshx:size-3 dshx:shrink-0" />
                          ))}
                          <span className="dshx:min-w-0 dshx:truncate">{task.title}</span>
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}

function Hint({ text }: { readonly text: string }) {
  const ref = React.useRef<HTMLSpanElement>(null)
  useEnter(ref, 'blurIn', { duration: 0.35 }, text)
  return (
    <span ref={ref} className="dshx:min-w-0 dshx:truncate dshx:text-muted-foreground dshx:@max-pane-narrow:hidden">
      {text}
    </span>
  )
}

function BusyBadge({ busyUntil }: { readonly busyUntil: string | undefined }) {
  const ref = React.useRef<HTMLSpanElement>(null)
  useEnter(ref, 'popIn', {}, busyUntil === undefined)
  return (
    <span
      ref={ref}
      className={cn(
        'dshx:shrink-0 dshx:rounded-md dshx:px-2 dshx:py-0.5 dshx:text-xs dshx:font-medium',
        busyUntil === undefined ? 'dshx:bg-success/15 dshx:text-success' : 'dshx:bg-muted dshx:text-muted-foreground',
      )}
    >
      {busyUntil === undefined ? 'Free' : `Busy until ${busyUntil}`}
    </span>
  )
}
