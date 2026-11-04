import { relativeTime } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import { useApi } from '@dshfiles/dshx/client'
import { EntityList, EntityRow } from '@dshfiles/plugin-ui/components/entity-row'
import { EmptyState, Page, PageSection } from '@dshfiles/plugin-ui/components/page'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@dshfiles/plugin-ui/components/ui/alert-dialog'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@dshfiles/plugin-ui/components/ui/dropdown-menu'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import { Switch } from '@dshfiles/plugin-ui/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@dshfiles/plugin-ui/components/ui/tabs'
import { AlertCircleIcon, CheckIcon, ChevronLeftIcon, CopyIcon, EllipsisIcon, PlusIcon, SendIcon, TrashIcon, XIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { errorMessage, useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { useEffect, useMemo, useState, useSyncExternalStore, type KeyboardEvent } from 'react'

import { AgentFocusModel } from './agent-focus.js'
import { AGENT_TEMPLATES, AgentEditor, type AgentFix, type AgentTemplate } from './agent-editor.js'
import { AgentEditorForm, agentFieldId } from './agent-editor-form.js'
import { AgentList, AgentName, AgentTemplates } from './agent-list.js'
import { AgentStartDialog } from './agent-start-dialog.js'
import { agentLimits, Agents, AGENTS_QUERY_ROOT, type Agent, type AgentDraft, type AgentThread } from './agent.js'
import { agentsApi, type AgentPresetRow } from './api.js'
import type { AgentCatalog, AgentDispatchRequest, AgentThreadTarget } from './dispatch.js'

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

/** What the detail pane shows: nothing yet, a saved agent, or a new draft that is not saved. */
type Selection = { readonly kind: 'none' } | { readonly kind: 'agent'; readonly handle: string } | { readonly kind: 'new'; readonly base: AgentDraft }

type Notice = { readonly tone: 'ok'; readonly text: string; readonly restore?: AgentDraft } | { readonly tone: 'error'; readonly text: string }

const NONE: Selection = { kind: 'none' }
const NOTICE_MS = 5_000

const targetOf = (value: string, projects: readonly AgentsPanelProject[]): AgentThreadTarget => {
  if (value === 'default') return { kind: 'default' }
  const project = projects.find(candidate => value === `project:${candidate.id}`)
  return project === undefined ? { kind: 'default' } : { kind: 'project', projectId: project.id }
}

const AGO_SUFFIX = { minutes: 'm ago', hours: 'h ago', days: 'd ago', months: 'mo ago', years: 'y ago' } as const
const ago = (at: number): string => {
  const age = relativeTime(at, Date.now())
  return age.unit === 'now' ? 'just now' : `${String(age.n)}${AGO_SUFFIX[age.unit]}`
}

/** A Host or network message as a sentence, so a recovery hint after it reads as the next sentence. */
const sentence = (text: string): string => (/[.!?…]$/u.test(text.trim()) ? text.trim() : `${text.trim()}.`)

const plural = (count: number, word: string): string => `${String(count)} ${word}${count === 1 ? '' : 's'}`

/**
 * Agents page: a master–detail `Page` with the registry list beside one agent's editor, threads and actions. Below
 * the compact tier the list and the detail take the pane in turn.
 */
export const AgentsPanel = (props: AgentsPanelProps): JSX.Element => {
  const api = useApi(agentsApi)
  const client = useQueryClient()
  const list = useQuery({ queryKey: [AGENTS_QUERY_ROOT, 'list'], queryFn: ({ signal }) => api.list(undefined, { signal }) })
  const presets = useQuery({ queryKey: [AGENTS_QUERY_ROOT, 'presets'], queryFn: () => props.loadPresets(), staleTime: 60_000 })
  const catalog = useQuery({ queryKey: [AGENTS_QUERY_ROOT, 'catalog'], queryFn: () => props.loadCatalog(), staleTime: 60_000 })
  const agents = useMemo(() => list.data?.agents ?? [], [list.data])
  const options = useMemo(() => catalog.data?.options ?? [], [catalog.data])

  const [selection, setSelection] = useState<Selection>(NONE)
  const [draft, setDraft] = useState<AgentDraft>(() => AgentEditor.draftOf(null))
  const [tab, setTab] = useState<'settings' | 'threads'>('settings')
  const [notice, setNotice] = useState<Notice | null>(null)
  const [pending, setPending] = useState<Selection | null>(null)
  const [removing, setRemoving] = useState<Agent | null>(null)
  const [starting, setStarting] = useState<Agent | null>(null)
  const [startError, setStartError] = useState<string | null>(null)
  const [attempted, setAttempted] = useState(false)
  const [toggling, setToggling] = useState<ReadonlySet<string>>(() => new Set())
  const focus = useSyncExternalStore(AgentFocusModel.subscribe, AgentFocusModel.read, () => null)

  const selectedHandle = selection.kind === 'agent' ? selection.handle : null
  const current = useMemo(() => agents.find(agent => agent.handle === selectedHandle) ?? null, [agents, selectedHandle])
  const creating = selection.kind === 'new'
  const base = useMemo(() => (selection.kind === 'new' ? selection.base : AgentEditor.draftOf(current)), [selection, current])
  const dirty = selection.kind !== 'none' && AgentEditor.isDirty(draft, base)
  const review = useMemo(
    () => AgentEditor.review(draft, { creating, agents, catalog: catalog.isSuccess ? options : null }),
    [draft, creating, agents, catalog.isSuccess, options],
  )

  // A refetch of the saved agent (another browser, an agent tool) lands in a clean editor; edits in progress stay.
  useEffect(() => {
    if (selection.kind !== 'agent' || current === null) return
    setDraft(previous => (AgentEditor.isDirty(previous, base) ? previous : base))
  }, [selection.kind, current, base])

  useEffect(() => {
    if (notice?.tone !== 'ok') return
    const timer = window.setTimeout(() => setNotice(null), NOTICE_MS)
    return () => window.clearTimeout(timer)
  }, [notice])

  const apply = (next: Selection): void => {
    setSelection(next)
    setDraft(next.kind === 'new' ? next.base : AgentEditor.draftOf(next.kind === 'agent' ? (agents.find(agent => agent.handle === next.handle) ?? null) : null))
    setTab('settings')
    setNotice(null)
    setPending(null)
    setAttempted(false)
  }
  /** Moving away from unsaved edits asks first, so a stray tap on another row never drops a long brief. */
  const navigate = (next: Selection): void => {
    if (dirty) {
      setPending(next)
      return
    }
    apply(next)
  }

  // A mention preview's "Open in Agents" lands here: select that agent, then drop the request.
  useEffect(() => {
    if (focus === null) return
    navigate({ kind: 'agent', handle: focus })
    const timer = window.setTimeout(AgentFocusModel.clear, 0)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a focus request is handled once, with the state of that moment.
  }, [focus])

  const invalidateList = () => client.invalidateQueries({ queryKey: [AGENTS_QUERY_ROOT, 'list'] })

  const save = useMutation({
    mutationFn: async (input: AgentDraft) => api.save({ agent: input }),
    onSuccess: async result => {
      await invalidateList()
      if (result.kind === 'limit') {
        setNotice({ tone: 'error', text: `At most ${String(agentLimits.agents)} agents are kept. Remove one you no longer use, then save again.` })
        return
      }
      setSelection({ kind: 'agent', handle: result.agent.handle })
      setDraft(AgentEditor.draftOf(result.agent))
      setNotice({ tone: 'ok', text: 'Saved.' })
    },
    onError: error => setNotice({ tone: 'error', text: `${sentence(errorMessage(error, 'The agent was not saved.'))} Your edits are still here; save again.` }),
  })
  const saveDraft = (): void => {
    if (review.errors.length > 0) {
      setAttempted(true)
      const first = review.errors[0]
      if (first !== undefined) document.getElementById(agentFieldId(first.field))?.focus()
      return
    }
    save.mutate(Agents.normalizeDraft(draft, { creating }))
  }

  const toggle = useMutation({
    mutationFn: async (input: { readonly agent: Agent; readonly enabled: boolean }) =>
      api.save({ agent: { ...AgentEditor.draftOf(input.agent), enabled: input.enabled } }),
    onMutate: input => setToggling(previous => new Set(previous).add(input.agent.handle)),
    onSettled: (_result, _error, input) =>
      setToggling(previous => {
        const next = new Set(previous)
        next.delete(input.agent.handle)
        return next
      }),
    onSuccess: async (_result, input) => {
      await invalidateList()
      // The switch saves at once; an open editor follows it so its next save does not undo the switch.
      if (input.agent.handle === selectedHandle) setDraft(previous => ({ ...previous, enabled: input.enabled }))
    },
    onError: (error, input) =>
      setNotice({
        tone: 'error',
        text: `${sentence(errorMessage(error, `@${input.agent.handle} was not turned ${input.enabled ? 'on' : 'off'}.`))} Try the switch again.`,
      }),
  })

  const remove = useMutation({
    mutationFn: async (agent: Agent) => ({ agent, result: await api.remove({ handle: agent.handle, confirm: true }) }),
    onSuccess: async ({ agent, result }) => {
      await invalidateList()
      setRemoving(null)
      if (result.kind === 'built-in') {
        setNotice({ tone: 'error', text: 'The built-in @dsh agent cannot be removed. Turn it off with its switch instead.' })
        return
      }
      if (selectedHandle === agent.handle) apply(NONE)
      setNotice(
        result.kind === 'missing'
          ? { tone: 'ok', text: `@${agent.handle} was already removed; the list now shows the current agents.` }
          : { tone: 'ok', text: `Removed @${agent.handle}.`, restore: AgentEditor.draftOf(agent) },
      )
    },
    onError: error => setNotice({ tone: 'error', text: `${sentence(errorMessage(error, 'The agent was not removed.'))} Try Remove again.` }),
  })

  const restore = useMutation({
    mutationFn: async (input: AgentDraft) => api.save({ agent: input }),
    onSuccess: async result => {
      await invalidateList()
      if (result.kind === 'applied') apply({ kind: 'agent', handle: result.agent.handle })
      setNotice(
        result.kind === 'applied'
          ? { tone: 'ok', text: `Restored @${result.agent.handle}. Its earlier thread list is not restored.` }
          : { tone: 'error', text: `The agent could not be restored: at most ${String(agentLimits.agents)} agents are kept. Remove one, then try Undo again.` },
      )
    },
    onError: error => setNotice({ tone: 'error', text: `${sentence(errorMessage(error, 'The agent was not restored.'))} Try Undo again.` }),
  })

  const projects = props.listProjects()
  const dispatch = useMutation({
    mutationFn: async (input: { readonly agent: Agent; readonly prompt: string; readonly target: string }) =>
      props.startThread({ agent: input.agent, prompt: input.prompt, target: targetOf(input.target, projects) }),
    onMutate: () => setStartError(null),
    onSuccess: async result => {
      if (!result.ok) {
        setStartError(result.reason)
        return
      }
      setStarting(null)
      await client.invalidateQueries({ queryKey: [AGENTS_QUERY_ROOT] })
    },
    onError: error => setStartError(errorMessage(error, 'The thread was not started.')),
  })

  const threads = useQuery({
    queryKey: [AGENTS_QUERY_ROOT, 'threads', selectedHandle ?? ''],
    queryFn: () => props.loadThreads(selectedHandle ?? ''),
    enabled: selectedHandle !== null,
  })
  const agentThreadIds = (threads.data ?? []).map(thread => thread.sessionId)
  const schedules = useQuery({
    queryKey: [AGENTS_QUERY_ROOT, 'schedules', ...agentThreadIds],
    queryFn: () => props.loadSchedules(agentThreadIds),
    enabled: agentThreadIds.length > 0,
  })

  const routeLabel = (agent: AgentDraft): string => AgentEditor.routeLabel(agent.route, options)
  const presetLabel = (agent: AgentDraft): string =>
    agent.preset === null ? 'default tools' : `${presets.data?.find(preset => preset.id === agent.preset)?.name ?? agent.preset} tools`
  const patch = (next: Partial<AgentDraft>): void => setDraft(previous => ({ ...previous, ...next }))
  const fix = (action: AgentFix): void => {
    if (action.kind === 'open-agent') navigate({ kind: 'agent', handle: action.handle })
    else if (action.kind === 'use-handle') patch({ handle: action.handle })
    else if (action.kind === 'clear-memory-scope') patch({ memoryScope: null })
    else if (action.kind === 'messaging-none') patch({ delegation: { ...draft.delegation, messaging: 'none' } })
    else patch({ route: null })
  }
  const newAgent = (seed: AgentDraft = AgentEditor.draftOf(null)): void => navigate({ kind: 'new', base: seed })
  const fromTemplate = (template: AgentTemplate): void => newAgent(AgentEditor.fromTemplate(template, agents))
  const listActions = {
    select: (handle: string) => navigate({ kind: 'agent', handle }),
    setEnabled: (agent: Agent, enabled: boolean) => toggle.mutate({ agent, enabled }),
    startThread: (agent: Agent) => {
      setStartError(null)
      setStarting(agent)
    },
    duplicate: (agent: Agent) => newAgent(AgentEditor.duplicate(agent, agents)),
    remove: (agent: Agent) => setRemoving(agent),
  }

  const onEditorKey = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key.toLowerCase() === 's' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      if (dirty || creating) saveDraft()
    }
  }

  const showDetail = selection.kind !== 'none'
  const errorCount = review.errors.length
  // A blank new agent is not an error yet: its fields speak up once left, or once Create agent is pressed.
  const revealAll = !creating || attempted
  const custom = agents.filter(agent => !agent.builtIn).length

  return (
    <main className="dshx-root dshx:h-full dshx:min-h-0 dshx:bg-background dshx:text-foreground">
      <Page
        heading="Agents"
        description="Saved @handles with a brief, a model and tools. Mention one where a thread starts, or start a thread from here."
        {...(list.isPending ? {} : { count: agents.length })}
        primaryAction={{ id: 'new-agent', label: 'New agent', icon: <PlusIcon />, onSelect: () => newAgent() }}
        fill
        data-agents-view={showDetail ? 'detail' : 'list'}
        bodyClassName="dshx:grid dshx:grid-cols-[18rem_minmax(0,1fr)] dshx:grid-rows-[minmax(0,1fr)] dshx:gap-4 dshx:@max-pane-compact:grid-cols-1"
      >
        <div
          aria-label="Agent list"
          role="region"
          className={cn('dshx:flex dshx:min-h-0 dshx:min-w-0 dshx:flex-col dshx:gap-3 dshx:overflow-y-auto', showDetail && 'dshx:@max-pane-compact:hidden')}
        >
          <AgentList
            agents={agents}
            selected={selectedHandle}
            loading={list.isPending}
            pendingHandles={toggling}
            routeLabel={routeLabel}
            actions={listActions}
          />
          {list.isError ? (
            <EntityList>
              <EmptyState action={{ label: 'Retry', onSelect: () => void list.refetch() }}>{errorMessage(list.error, 'The agents did not load.')}</EmptyState>
            </EntityList>
          ) : null}
          {!list.isPending && custom === 0 ? (
            <PageSection heading="Start from a template" className="dshx:hidden dshx:@max-pane-compact:flex">
              <AgentTemplates templates={AGENT_TEMPLATES} onPick={fromTemplate} />
            </PageSection>
          ) : null}
        </div>

        <div
          aria-label="Agent detail"
          role="region"
          onKeyDown={onEditorKey}
          className={cn('dshx:relative dshx:flex dshx:min-h-0 dshx:min-w-0 dshx:flex-col dshx:gap-3', !showDetail && 'dshx:@max-pane-compact:hidden')}
        >
          {notice === null ? null : (
            <div
              role={notice.tone === 'error' ? 'alert' : 'status'}
              className={cn(
                'dshx:flex dshx:items-center dshx:gap-2 dshx:rounded-md dshx:border dshx:px-3 dshx:py-2 dshx:text-xs',
                notice.tone === 'ok' ? 'dshx:border-border dshx:text-foreground' : 'dshx:border-destructive/60 dshx:text-destructive',
              )}
            >
              {notice.tone === 'ok' ? (
                <CheckIcon aria-hidden className="dshx:size-3.5 dshx:text-success" />
              ) : (
                <AlertCircleIcon aria-hidden className="dshx:size-3.5" />
              )}
              <span className="dshx:min-w-0 dshx:flex-1">{notice.text}</span>
              {notice.tone === 'ok' && notice.restore !== undefined ? (
                <Button size="xs" variant="outline" disabled={restore.isPending} onClick={() => notice.restore !== undefined && restore.mutate(notice.restore)}>
                  Undo
                </Button>
              ) : null}
              <Button size="icon-xs" variant="ghost" aria-label="Dismiss" onClick={() => setNotice(null)}>
                <XIcon />
              </Button>
            </div>
          )}

          {!showDetail ? (
            <Welcome custom={custom} onCreate={() => newAgent()} onTemplate={fromTemplate} />
          ) : selection.kind === 'agent' && current === null ? (
            <EntityList>
              <EmptyState action={{ label: 'Back to the list', onSelect: () => apply(NONE) }}>
                @{selection.handle} was removed, perhaps from another window or by an agent tool.
              </EmptyState>
            </EntityList>
          ) : (
            <>
              <Button size="sm" variant="ghost" className="dshx:hidden dshx:self-start dshx:@max-pane-compact:inline-flex" onClick={() => navigate(NONE)}>
                <ChevronLeftIcon />
                All agents
              </Button>
              <PageSection
                heading={<AgentName glyph={draft.glyph} name={creating ? (draft.name.trim() === '' ? 'New agent' : draft.name) : (current?.name ?? 'Agent')} />}
                description={
                  creating
                    ? `@${review.handle} · not saved yet`
                    : `@${current?.handle ?? ''} · ${plural(current?.threadCount ?? 0, 'thread')}${
                        current?.lastUsedAt === null || current?.lastUsedAt === undefined ? '' : ` · used ${ago(current.lastUsedAt)}`
                      }`
                }
                actions={
                  current === null ? null : (
                    <>
                      <label className="dshx:flex dshx:items-center dshx:gap-1.5 dshx:text-xs dshx:text-muted-foreground">
                        <Switch
                          aria-label="Enabled"
                          checked={current.enabled}
                          disabled={toggling.has(current.handle)}
                          onCheckedChange={enabled => toggle.mutate({ agent: current, enabled })}
                        />
                        <span className="dshx:@max-pane-narrow:sr-only">{current.enabled ? 'On' : 'Off'}</span>
                      </label>
                      <Button size="sm" variant="outline" onClick={() => listActions.startThread(current)}>
                        <SendIcon />
                        <span className="dshx:@max-pane-narrow:sr-only">Start thread</span>
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="icon-sm" variant="ghost" aria-label="More actions">
                            <EllipsisIcon />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="dshx-root">
                          <DropdownMenuItem onSelect={() => toggle.mutate({ agent: current, enabled: !current.enabled })}>
                            {current.enabled ? 'Turn off' : 'Turn on'}
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => listActions.duplicate(current)}>
                            <CopyIcon />
                            Duplicate
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem variant="destructive" disabled={current.builtIn} onSelect={() => setRemoving(current)}>
                            <TrashIcon />
                            {current.builtIn ? 'Built in, cannot be removed' : 'Remove…'}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </>
                  )
                }
                className="dshx:min-h-0 dshx:flex-1"
              >
                <Tabs
                  value={tab}
                  onValueChange={value => setTab(value === 'threads' ? 'threads' : 'settings')}
                  className="dshx:flex dshx:min-h-0 dshx:flex-1 dshx:flex-col dshx:gap-2"
                >
                  {current === null ? null : (
                    <TabsList aria-label="Agent views" className="dshx:self-start">
                      <TabsTrigger value="settings" className="dshx:flex-none">
                        Settings
                      </TabsTrigger>
                      <TabsTrigger value="threads" className="dshx:flex-none">
                        Threads <span className="dshx:text-xs dshx:text-muted-foreground dshx:tabular-nums">{current.threadCount}</span>
                      </TabsTrigger>
                    </TabsList>
                  )}
                  <TabsContent value="settings" className="dshx:min-h-0 dshx:flex-1 dshx:overflow-y-auto">
                    <div className={cn('dshx:pr-1', (dirty || creating) && 'dshx:pb-20')}>
                      <AgentEditorForm
                        key={selection.kind === 'agent' ? selection.handle : `new:${base.handle}:${base.name}`}
                        draft={draft}
                        review={review}
                        creating={creating}
                        agents={agents}
                        catalog={options}
                        catalogError={catalog.isError ? errorMessage(catalog.error, 'unknown error') : null}
                        presets={presets.data ?? []}
                        patch={patch}
                        onFix={fix}
                        revealAll={revealAll}
                      />
                    </div>
                  </TabsContent>
                  {current === null ? null : (
                    <TabsContent value="threads" className="dshx:min-h-0 dshx:flex-1 dshx:overflow-y-auto">
                      <ThreadsView
                        agent={current}
                        threads={threads.data ?? []}
                        loading={threads.isPending}
                        schedules={schedules.data ?? []}
                        onOpen={props.openThread}
                        onStart={() => listActions.startThread(current)}
                      />
                    </TabsContent>
                  )}
                </Tabs>
              </PageSection>

              {(dirty || creating) && tab === 'settings' ? (
                <div
                  role="region"
                  aria-label="Save changes"
                  className="dshx:absolute dshx:inset-x-0 dshx:bottom-0 dshx:flex dshx:items-center dshx:gap-2 dshx:rounded-lg dshx:border dshx:border-border dshx:bg-card dshx:px-3 dshx:py-2 dshx:shadow-lg"
                >
                  <div className="dshx:min-w-0 dshx:flex-1 dshx:text-xs">
                    {errorCount > 0 && revealAll ? (
                      <button
                        type="button"
                        className="dshx:flex dshx:items-center dshx:gap-1.5 dshx:text-destructive dshx:underline-offset-2 dshx:hover:underline"
                        onClick={saveDraft}
                      >
                        <AlertCircleIcon aria-hidden className="dshx:size-3.5" />
                        {errorCount === 1 ? 'Fix 1 field to save' : `Fix ${String(errorCount)} fields to save`}
                      </button>
                    ) : (
                      <span className="dshx:block dshx:truncate dshx:text-muted-foreground">
                        {creating ? `Creates @${review.handle}` : 'Unsaved changes'}
                        {review.warnings.length > 0 ? ` · ${plural(review.warnings.length, 'note')} above` : ''}
                      </span>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      if (creating) apply(NONE)
                      else setDraft(base)
                    }}
                  >
                    {creating ? 'Cancel' : 'Discard'}
                  </Button>
                  <Button size="sm" disabled={save.isPending} onClick={saveDraft}>
                    {save.isPending ? <Spinner aria-hidden className="dshx:size-3.5" /> : null}
                    {creating ? 'Create agent' : 'Save'}
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </div>
      </Page>

      <AgentStartDialog
        agent={starting}
        projects={projects.map(project => ({ id: project.id, title: project.title }))}
        routeLabel={routeLabel}
        presetLabel={presetLabel}
        pending={dispatch.isPending}
        error={startError}
        onOpenChange={open => {
          if (!open) setStarting(null)
        }}
        onStart={input => {
          if (starting !== null) dispatch.mutate({ agent: starting, ...input })
        }}
      />

      <AlertDialog open={removing !== null} onOpenChange={open => !open && setRemoving(null)}>
        <AlertDialogContent className="dshx-root">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove @{removing?.handle}?</AlertDialogTitle>
            <AlertDialogDescription>
              Its settings and its list of {plural(removing?.threadCount ?? 0, 'thread')} are deleted. The threads themselves stay, and mentions of @
              {removing?.handle} stop starting threads. You can undo right after.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={remove.isPending}
              onClick={event => {
                event.preventDefault()
                if (removing !== null) remove.mutate(removing)
              }}
            >
              Remove agent
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={pending !== null} onOpenChange={open => !open && setPending(null)}>
        <AlertDialogContent className="dshx-root">
          <AlertDialogHeader>
            <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
            <AlertDialogDescription>
              {creating ? 'This new agent was not saved.' : `Your edits to @${current?.handle ?? ''} were not saved.`} Keep editing to save them first.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => pending !== null && apply(pending)}>
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  )
}

const Welcome = (props: { readonly custom: number; readonly onCreate: () => void; readonly onTemplate: (template: AgentTemplate) => void }): JSX.Element => (
  <div className="dshx:flex dshx:min-h-0 dshx:flex-col dshx:gap-4 dshx:overflow-y-auto">
    <EntityList>
      <EmptyState action={{ label: 'New agent', icon: <PlusIcon />, onSelect: props.onCreate }}>
        {props.custom === 0
          ? 'Only the built-in @dsh so far. An agent is a name, a brief and a model: make one for work you repeat, then mention its @handle where a thread starts.'
          : 'Pick an agent to edit it, or start a new one.'}
      </EmptyState>
    </EntityList>
    <PageSection heading="Start from a template" description="Each opens as an unsaved draft you can change before creating it.">
      <AgentTemplates templates={AGENT_TEMPLATES} onPick={props.onTemplate} />
    </PageSection>
  </div>
)

const ThreadsView = (props: {
  readonly agent: Agent
  readonly threads: readonly AgentThread[]
  readonly loading: boolean
  readonly schedules: readonly AgentsPanelSchedule[]
  readonly onOpen: (sessionId: string) => void
  readonly onStart: () => void
}): JSX.Element => {
  if (props.loading) return <Spinner className="dshx:mx-auto dshx:my-6" />
  if (props.threads.length === 0)
    return (
      <EntityList>
        <EmptyState action={{ label: 'Start thread', icon: <SendIcon />, onSelect: props.onStart }}>
          No threads yet. Threads @{props.agent.handle} starts are listed here and stay after a restart.
        </EmptyState>
      </EntityList>
    )
  return (
    <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-4">
      <EntityList aria-label="Threads started">
        {props.threads.map(thread => (
          <EntityRow
            key={thread.sessionId}
            role="listitem"
            onSelect={() => props.onOpen(thread.sessionId)}
            heading={thread.title}
            meta={<span className="dshx:tabular-nums">{ago(thread.startedAt)}</span>}
          />
        ))}
      </EntityList>
      {props.schedules.length === 0 ? null : (
        <PageSection heading="Routines" meta={plural(props.schedules.length, 'reminder')}>
          <EntityList aria-label="Routines">
            {props.schedules.map(schedule => (
              <EntityRow
                key={schedule.id}
                role="listitem"
                onSelect={() => props.onOpen(schedule.sessionId)}
                heading={schedule.title}
                meta={<span>{schedule.status === 'active' ? 'Active' : 'Inactive'}</span>}
              />
            ))}
          </EntityList>
        </PageSection>
      )}
    </div>
  )
}
