import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import { useApi } from '@dshfiles/dshx/client'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Combobox, type ComboboxOption } from '@dshfiles/plugin-ui/components/ui/combobox'
import { Input } from '@dshfiles/plugin-ui/components/ui/input'
import { Switch } from '@dshfiles/plugin-ui/components/ui/switch'
import { Textarea } from '@dshfiles/plugin-ui/components/ui/textarea'
import { PlusIcon, RotateCcwIcon, SendIcon, TrashIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { errorMessage, useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'

import { AgentFocusModel } from './agent-focus.js'
import {
  AGENT_DELEGATION_UNRESTRICTED,
  agentLimits,
  Agents,
  AGENTS_QUERY_ROOT,
  type Agent,
  type AgentDraft,
  type AgentRoute,
  type AgentThread,
} from './agent.js'
import { agentsApi, type AgentPresetRow } from './api.js'
import type { AgentCatalog, AgentDispatchRequest, AgentThreadTarget } from './dispatch.js'

const QUERY_ROOT = AGENTS_QUERY_ROOT

export interface AgentsPanelProject {
  readonly id: WorkspaceId
  readonly title: string
  readonly path: string
}

/** One reminder that belongs to a thread the agent started, read from the Host's schedule catalog. */
export interface AgentsPanelSchedule {
  readonly id: string
  readonly sessionId: string
  readonly title: string
  readonly status: 'active' | 'inactive'
}

export interface AgentsPanelProps {
  readonly listProjects: () => readonly AgentsPanelProject[]
  readonly loadCatalog: () => Promise<AgentCatalog>
  readonly loadPresets: () => Promise<readonly AgentPresetRow[]>
  readonly loadThreads: (handle: string) => Promise<readonly AgentThread[]>
  readonly loadSchedules: (sessionIds: readonly string[]) => Promise<readonly AgentsPanelSchedule[]>
  readonly openThread: (sessionId: string) => void
  readonly startThread: (request: AgentDispatchRequest) => Promise<{ readonly ok: true } | { readonly ok: false; readonly reason: string }>
}

type Outcome = { readonly ok: true } | { readonly ok: false; readonly reason: string }

const labelClass = 'dshx:text-[11px] dshx:font-semibold dshx:uppercase dshx:tracking-wider dshx:text-muted-foreground'

const draftOf = (agent: Agent | null): AgentDraft => ({
  handle: agent?.handle ?? '',
  name: agent?.name ?? '',
  glyph: agent?.glyph ?? '🤖',
  description: agent?.description ?? '',
  instructions: agent?.instructions ?? '',
  preset: agent?.preset ?? null,
  route: agent?.route ?? null,
  memoryScope: agent?.memoryScope ?? null,
  routine: agent?.routine ?? '',
  delegation: agent?.delegation ?? AGENT_DELEGATION_UNRESTRICTED,
  enabled: agent?.enabled ?? true,
})

const targetOf = (value: string, projects: readonly AgentsPanelProject[]): AgentThreadTarget => {
  if (value === 'default') return { kind: 'default' }
  if (value.startsWith('cwd:')) return { kind: 'cwd', path: value.slice('cwd:'.length) }
  const project = projects.find(candidate => value === `project:${candidate.id}`)
  return project === undefined ? { kind: 'default' } : { kind: 'project', projectId: project.id }
}

/** Agents panel: the registry list, the selected agent's editor and a thread launcher. */
export const AgentsPanel = (props: AgentsPanelProps): JSX.Element => {
  const api = useApi(agentsApi)
  const client = useQueryClient()
  const list = useQuery({ queryKey: [QUERY_ROOT, 'list'], queryFn: ({ signal }) => api.list(undefined, { signal }) })
  const presets = useQuery({ queryKey: [QUERY_ROOT, 'presets'], queryFn: () => props.loadPresets(), staleTime: 60_000 })
  const catalog = useQuery({ queryKey: [QUERY_ROOT, 'catalog'], queryFn: () => props.loadCatalog(), staleTime: 60_000 })
  const agents = useMemo(() => list.data?.agents ?? [], [list.data])
  const [selected, setSelected] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState<AgentDraft>(() => draftOf(null))
  const [notice, setNotice] = useState<Outcome | null>(null)
  const [prompt, setPrompt] = useState('')
  const [target, setTarget] = useState<string>('default')
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const focus = useSyncExternalStore(AgentFocusModel.subscribe, AgentFocusModel.read, () => null)

  // A mention preview's "Open in Agents" lands here: select that agent, then drop the request.
  useEffect(() => {
    if (focus === null) return
    setCreating(false)
    setSelected(focus)
    setConfirmingDelete(false)
    setNotice(null)
    const timer = window.setTimeout(AgentFocusModel.clear, 0)
    return () => window.clearTimeout(timer)
  }, [focus])

  const projects = props.listProjects()
  const current = useMemo(() => agents.find(agent => agent.handle === selected) ?? null, [agents, selected])
  const threads = useQuery({
    queryKey: [QUERY_ROOT, 'threads', selected ?? ''],
    queryFn: () => props.loadThreads(selected ?? ''),
    enabled: selected !== null,
  })
  const agentThreadIds = (threads.data ?? []).map(thread => thread.sessionId)
  const schedules = useQuery({
    queryKey: [QUERY_ROOT, 'schedules', ...agentThreadIds],
    queryFn: () => props.loadSchedules(agentThreadIds),
    enabled: agentThreadIds.length > 0,
  })
  const editing = creating || current === null
  useEffect(() => {
    if (creating) return
    setDraft(draftOf(current))
  }, [creating, current])

  const save = useMutation({
    // The first open shows the new-agent form without the plus button's state, so no selected agent means creating.
    mutationFn: () => api.save({ agent: Agents.normalizeDraft(draft, { creating: current === null }) }),
    onSuccess: async result => {
      await client.invalidateQueries({ queryKey: [QUERY_ROOT, 'list'] })
      if (result.kind === 'limit') {
        setNotice({ ok: false, reason: `At most ${String(agentLimits.agents)} agents are kept.` })
        return
      }
      setCreating(false)
      setSelected(result.agent.handle)
      setNotice({ ok: true })
    },
    onError: error => setNotice({ ok: false, reason: errorMessage(error, 'The agent was not saved.') }),
  })

  const remove = useMutation({
    mutationFn: (handle: string) => api.remove({ handle, confirm: true }),
    onSuccess: async result => {
      await client.invalidateQueries({ queryKey: [QUERY_ROOT, 'list'] })
      setConfirmingDelete(false)
      if (result.kind === 'built-in') {
        setNotice({ ok: false, reason: 'The built-in @dsh agent cannot be removed.' })
        return
      }
      if (result.kind === 'missing') {
        setNotice({ ok: false, reason: 'That agent was already gone.' })
        return
      }
      setSelected(null)
      setNotice({ ok: true })
    },
    onError: error => setNotice({ ok: false, reason: errorMessage(error, 'The agent was not removed.') }),
  })

  const dispatch = useMutation({
    mutationFn: async () => {
      if (current === null) throw new Error('Select an agent first.')
      return props.startThread({ agent: current, prompt, target: targetOf(target, projects) })
    },
    onSuccess: async result => {
      if (!result.ok) {
        setNotice(result)
        return
      }
      setPrompt('')
      setNotice({ ok: true })
      await client.invalidateQueries({ queryKey: [QUERY_ROOT, 'list'] })
    },
    onError: error => setNotice({ ok: false, reason: errorMessage(error, 'The thread was not started.') }),
  })

  const patch = (next: Partial<AgentDraft>): void => setDraft(currentDraft => ({ ...currentDraft, ...next }))
  const routeKey = draft.route === null ? '' : `${draft.route.provider}/${draft.route.model}`
  const routeOption = catalog.data?.options.find(option => option.key === routeKey)
  const delegationOptions: readonly ComboboxOption[] = [
    { value: 'any', label: 'Any peer' },
    { value: 'listed', label: 'Listed peers only' },
    { value: 'none', label: 'No messaging' },
  ]
  const presetOptions: readonly ComboboxOption[] = [
    { value: '', label: 'Host default' },
    ...(presets.data ?? []).map(preset => ({ value: preset.id, label: preset.name ?? preset.id, disabled: preset.broken !== undefined })),
  ]
  const routeOptions: readonly ComboboxOption[] = [
    { value: '', label: 'Harness default' },
    ...(catalog.data?.options ?? []).map(option => ({
      value: option.key,
      label: `${option.providerName} · ${option.modelName}`,
      keywords: [option.provider, option.model],
      group: option.providerName,
    })),
  ]
  const effortOptions: readonly ComboboxOption[] = [
    { value: '', label: 'Model default' },
    ...(routeOption?.efforts ?? []).map(effort => ({ value: effort, label: effort })),
  ]
  const targetOptions: readonly ComboboxOption[] = [
    { value: 'default', label: 'Host default workspace' },
    ...projects.map(project => ({ value: `project:${project.id}`, label: project.title })),
  ]

  return (
    <main className="dshx-root dshx:@container dshx:flex dshx:h-full dshx:min-h-0 dshx:bg-background dshx:text-foreground">
      <aside className="dshx:flex dshx:w-64 dshx:shrink-0 dshx:flex-col dshx:gap-1 dshx:border-r dshx:border-border dshx:p-2">
        <div className="dshx:flex dshx:items-center dshx:justify-between dshx:px-1 dshx:pb-1">
          <h2 className={labelClass}>Agents</h2>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="New agent"
            onClick={() => {
              setCreating(true)
              setSelected(null)
              setConfirmingDelete(false)
              setNotice(null)
              setDraft(draftOf(null))
            }}
          >
            <PlusIcon />
          </Button>
        </div>
        {list.isPending ? <p className="dshx:px-1 dshx:text-[12px] dshx:text-muted-foreground">Loading…</p> : null}
        {agents.map(agent => (
          <button
            key={agent.handle}
            type="button"
            onClick={() => {
              setCreating(false)
              setSelected(agent.handle)
              setConfirmingDelete(false)
              setNotice(null)
            }}
            className={cn(
              'dshx:flex dshx:w-full dshx:flex-col dshx:gap-0.5 dshx:rounded-md dshx:px-2 dshx:py-1.5 dshx:text-left dshx:transition-colors dshx:hover:bg-accent',
              selected === agent.handle && 'dshx:bg-accent',
              !agent.enabled && 'dshx:opacity-50',
            )}
          >
            <span className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-1.5 dshx:text-[13px]">
              {agent.glyph === '' ? null : <span aria-hidden>{agent.glyph}</span>}
              <span className="dshx:truncate dshx:font-medium">{agent.name}</span>
              <span className="dshx:ml-auto dshx:shrink-0 dshx:text-[11px] dshx:text-muted-foreground">@{agent.handle}</span>
            </span>
            {agent.description === '' ? null : <span className="dshx:truncate dshx:text-[11px] dshx:text-muted-foreground">{agent.description}</span>}
          </button>
        ))}
        {agents.length === 0 && !list.isPending ? <p className="dshx:px-1 dshx:text-[12px] dshx:text-muted-foreground">No agents yet.</p> : null}
      </aside>

      <section className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-col dshx:gap-3 dshx:overflow-y-auto dshx:p-3">
        <header className="dshx:flex dshx:items-center dshx:justify-between dshx:gap-2">
          <div className="dshx:min-w-0">
            <h1 className="dshx:truncate dshx:text-[15px] dshx:font-semibold">{editing ? 'New agent' : (current?.name ?? 'Agent')}</h1>
            <p className="dshx:text-[11px] dshx:text-muted-foreground">
              {current === null
                ? 'A handle, instructions, a model route and a tool preset.'
                : `@${current.handle} · ${current.threadCount} thread${current.threadCount === 1 ? '' : 's'}`}
            </p>
          </div>
          <div className="dshx:flex dshx:shrink-0 dshx:items-center dshx:gap-1.5">
            <Switch aria-label="Enabled" checked={draft.enabled} onCheckedChange={enabled => patch({ enabled })} />
            <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
              Save
            </Button>
          </div>
        </header>

        {notice === null ? null : (
          <p
            className={cn(
              'dshx:rounded-md dshx:border dshx:px-2 dshx:py-1.5 dshx:text-[12px]',
              notice.ok ? 'dshx:border-border dshx:text-muted-foreground' : 'dshx:border-destructive/60 dshx:text-destructive',
            )}
          >
            {notice.ok ? 'Saved.' : notice.reason}
          </p>
        )}

        <div className="dshx:grid dshx:grid-cols-2 dshx:gap-2 dshx:@max-pane-narrow:grid-cols-1">
          <label className="dshx:flex dshx:flex-col dshx:gap-1">
            <span className={labelClass}>Name</span>
            <Input value={draft.name} maxLength={agentLimits.name} onChange={event => patch({ name: event.currentTarget.value })} />
          </label>
          <label className="dshx:flex dshx:flex-col dshx:gap-1">
            <span className={labelClass}>Handle</span>
            <Input
              value={draft.handle}
              maxLength={32}
              disabled={!editing && current !== null}
              placeholder={Agents.handleFrom(draft.name)}
              onChange={event => patch({ handle: event.currentTarget.value })}
            />
          </label>
          <label className="dshx:flex dshx:flex-col dshx:gap-1">
            <span className={labelClass}>Glyph</span>
            <Input value={draft.glyph} maxLength={8} onChange={event => patch({ glyph: event.currentTarget.value })} />
          </label>
          <label className="dshx:flex dshx:flex-col dshx:gap-1">
            <span className={labelClass}>Description</span>
            <Input value={draft.description} maxLength={agentLimits.description} onChange={event => patch({ description: event.currentTarget.value })} />
          </label>
          <label className="dshx:flex dshx:flex-col dshx:gap-1">
            <span className={labelClass}>Memory scope</span>
            <Input
              value={draft.memoryScope ?? ''}
              placeholder={Agents.defaultMemoryScope(editing ? Agents.handleFrom(draft.name || draft.handle) : (current?.handle ?? ''))}
              onChange={event => patch({ memoryScope: event.currentTarget.value === '' ? null : event.currentTarget.value })}
            />
            <span className="dshx:text-[11px] dshx:text-muted-foreground">The notes this agent's threads read; empty keeps memory to the project.</span>
          </label>
        </div>

        <label className="dshx:flex dshx:flex-col dshx:gap-1">
          <span className={labelClass}>Instructions</span>
          <Textarea
            value={draft.instructions}
            maxLength={agentLimits.instructions}
            rows={6}
            placeholder="How this agent works: role, constraints, the shape of a good answer."
            onChange={event => patch({ instructions: event.currentTarget.value })}
          />
          <span className="dshx:self-end dshx:text-[11px] dshx:text-muted-foreground">
            {draft.instructions.length}/{agentLimits.instructions}
          </span>
        </label>

        <label className="dshx:flex dshx:flex-col dshx:gap-1">
          <span className={labelClass}>Routine</span>
          <Textarea
            value={draft.routine}
            maxLength={agentLimits.routine}
            rows={2}
            placeholder="Every weekday at 09:00, summarise open reviews."
            onChange={event => patch({ routine: event.currentTarget.value })}
          />
          <span className="dshx:text-[11px] dshx:text-muted-foreground">
            Carried into the opening message; the thread keeps it with its own schedule tools, not a timer.
          </span>
        </label>

        <div className="dshx:grid dshx:grid-cols-3 dshx:gap-2 dshx:@max-pane-narrow:grid-cols-1">
          <label className="dshx:flex dshx:flex-col dshx:gap-1">
            <span className={labelClass}>Delegation (messages)</span>
            <Combobox
              label="Delegation (messages)"
              matchTriggerWidth
              onValueChange={value =>
                patch({
                  delegation: {
                    messaging: value === 'none' ? 'none' : value === 'listed' ? 'listed' : 'any',
                    handles: draft.delegation.handles,
                    subagents: draft.delegation.subagents,
                  },
                })
              }
              options={delegationOptions}
              value={draft.delegation.messaging}
            />
          </label>
          <label className="dshx:flex dshx:flex-col dshx:gap-1">
            <span className={labelClass}>Peers (handles)</span>
            <Input
              value={draft.delegation.handles.join(', ')}
              disabled={draft.delegation.messaging !== 'listed'}
              placeholder="reviewer, planner"
              onChange={event =>
                patch({
                  delegation: {
                    messaging: draft.delegation.messaging,
                    subagents: draft.delegation.subagents,
                    handles: event.currentTarget.value
                      .split(',')
                      .map(handle => handle.trim().replace(/^@/u, ''))
                      .filter(handle => handle !== ''),
                  },
                })
              }
            />
          </label>
          <label className="dshx:flex dshx:items-center dshx:gap-2 dshx:self-end dshx:pb-1">
            <Switch
              aria-label="Subagents and workflows"
              checked={draft.delegation.subagents}
              onCheckedChange={subagents => patch({ delegation: { ...draft.delegation, subagents } })}
            />
            <span className="dshx:text-[12px]">Subagents and workflows</span>
          </label>
          <span className="dshx:self-end dshx:text-[11px] dshx:text-muted-foreground">
            Constrains this agent's <code>dshx_comm_*</code> sends and its subagent/workflow calls; it does not replace DSH messaging.
          </span>
        </div>

        <div className="dshx:grid dshx:grid-cols-3 dshx:gap-2 dshx:@max-pane-narrow:grid-cols-1">
          <label className="dshx:flex dshx:flex-col dshx:gap-1">
            <span className={labelClass}>Tools (preset)</span>
            <Combobox
              label="Tools (preset)"
              matchTriggerWidth
              onValueChange={value => patch({ preset: value === '' ? null : value })}
              options={presetOptions}
              searchAbove={0}
              searchPlaceholder="Search presets…"
              value={draft.preset ?? ''}
            />
          </label>
          <label className="dshx:flex dshx:flex-col dshx:gap-1">
            <span className={labelClass}>Model route</span>
            <Combobox
              label="Model route"
              matchTriggerWidth
              onValueChange={value => {
                const option = catalog.data?.options.find(candidate => candidate.key === value)
                if (option === undefined) {
                  patch({ route: null })
                  return
                }
                const route: AgentRoute = { provider: option.provider, model: option.model }
                if (option.defaultEffort !== undefined) route.reasoningEffort = option.defaultEffort
                patch({ route })
              }}
              options={routeOptions}
              searchAbove={0}
              searchPlaceholder="Search models…"
              value={routeKey}
            />
          </label>
          <label className="dshx:flex dshx:flex-col dshx:gap-1">
            <span className={labelClass}>Reasoning</span>
            <Combobox
              disabled={routeOption === undefined}
              label="Reasoning"
              matchTriggerWidth
              onValueChange={value =>
                patch({
                  route:
                    draft.route === null
                      ? null
                      : value === ''
                        ? { provider: draft.route.provider, model: draft.route.model }
                        : { provider: draft.route.provider, model: draft.route.model, reasoningEffort: value },
                })
              }
              options={effortOptions}
              value={draft.route?.reasoningEffort ?? ''}
            />
          </label>
        </div>

        {current === null ? null : (
          <div className="dshx:flex dshx:flex-col dshx:gap-2 dshx:rounded-lg dshx:border dshx:border-border dshx:p-2">
            <div className="dshx:flex dshx:items-center dshx:justify-between dshx:gap-2">
              <h3 className={labelClass}>Start a thread</h3>
              {confirmingDelete ? (
                <span className="dshx:flex dshx:items-center dshx:gap-1.5">
                  <span className="dshx:text-[11px] dshx:text-muted-foreground">Remove @{current.handle}?</span>
                  <Button size="xs" variant="ghost" onClick={() => setConfirmingDelete(false)}>
                    Cancel
                  </Button>
                  <Button size="xs" variant="destructive" onClick={() => remove.mutate(current.handle)} disabled={remove.isPending}>
                    Remove
                  </Button>
                </span>
              ) : (
                <Button size="icon-sm" variant="ghost" aria-label="Remove agent" disabled={current.builtIn} onClick={() => setConfirmingDelete(true)}>
                  <TrashIcon />
                </Button>
              )}
            </div>
            <Textarea
              aria-label="Prompt"
              rows={2}
              value={prompt}
              placeholder={`What should @${current.handle} do?`}
              onChange={event => setPrompt(event.currentTarget.value)}
            />
            <div className="dshx:flex dshx:items-center dshx:gap-1.5">
              <Combobox
                label="Thread workspace"
                matchTriggerWidth
                onValueChange={setTarget}
                options={targetOptions}
                searchAbove={0}
                searchPlaceholder="Search workspaces…"
                triggerClassName="dshx:flex-1"
                value={target}
              />
              <Button size="sm" onClick={() => dispatch.mutate()} disabled={dispatch.isPending}>
                <SendIcon />
                Start
              </Button>
            </div>
          </div>
        )}

        {current === null ? null : (
          <div className="dshx:flex dshx:flex-col dshx:gap-1.5 dshx:rounded-lg dshx:border dshx:border-border dshx:p-2">
            <h3 className={labelClass}>Threads started</h3>
            {threads.isPending ? <p className="dshx:text-[11px] dshx:text-muted-foreground">Loading…</p> : null}
            {!threads.isPending && (threads.data ?? []).length === 0 ? (
              <p className="dshx:text-[11px] dshx:text-muted-foreground">No thread yet. Start one above; it stays listed here after a restart.</p>
            ) : null}
            {(threads.data ?? []).map(thread => (
              <button
                key={thread.sessionId}
                type="button"
                onClick={() => props.openThread(thread.sessionId)}
                className="dshx:flex dshx:w-full dshx:items-center dshx:gap-2 dshx:rounded-md dshx:px-1.5 dshx:py-1 dshx:text-left dshx:text-[12px] dshx:transition-colors dshx:hover:bg-accent"
              >
                <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate">{thread.title}</span>
                <span className="dshx:shrink-0 dshx:text-[11px] dshx:tabular-nums dshx:text-muted-foreground">
                  {new Date(thread.startedAt).toISOString().slice(0, 10)}
                </span>
              </button>
            ))}
            {(schedules.data ?? []).length === 0 ? null : <span className={cn(labelClass, 'dshx:pt-1')}>Routines</span>}
            {(schedules.data ?? []).map(schedule => (
              <button
                key={schedule.id}
                type="button"
                onClick={() => props.openThread(schedule.sessionId)}
                className="dshx:flex dshx:w-full dshx:items-center dshx:gap-2 dshx:rounded-md dshx:px-1.5 dshx:py-1 dshx:text-left dshx:text-[12px] dshx:transition-colors dshx:hover:bg-accent"
              >
                <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate">{schedule.title}</span>
                <span className="dshx:shrink-0 dshx:text-[11px] dshx:text-muted-foreground">{schedule.status}</span>
              </button>
            ))}
          </div>
        )}

        {current === null ? null : (
          <p className="dshx:flex dshx:items-center dshx:gap-1 dshx:text-[11px] dshx:text-muted-foreground">
            <RotateCcwIcon aria-hidden className="dshx:size-3" />
            Mention it as @{current.handle} where a thread starts: a backlog comment or a start-thread dialog.
          </p>
        )}
      </section>
    </main>
  )
}
