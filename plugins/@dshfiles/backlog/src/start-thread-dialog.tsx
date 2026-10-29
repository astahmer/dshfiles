import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Combobox, type ComboboxOption } from '@dshfiles/plugin-ui/components/ui/combobox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@dshfiles/plugin-ui/components/ui/dialog'
import { MessagesSquareIcon } from '@dshfiles/plugin-ui/icons'
import { errorMessage, useQuery } from '@dshfiles/plugin-ui/query'
import { useState } from 'react'

import {
  StartThreadForm,
  type StartThreadAgentChoice,
  type StartThreadCatalog,
  type StartThreadItem,
  type StartThreadProject,
  type StartThreadRequest,
} from './start-thread.js'
import { continueMarkdownList } from './list-continuation.js'
import { StatusDot } from '@dshfiles/plugin-ui/components/ui/status-dot'

const labelClass = 'dshx:text-[11px] dshx:font-semibold dshx:uppercase dshx:tracking-wider dshx:text-muted-foreground'

/**
 * Chooses the project, account/model and opening message, then hands the request to the panel and closes. Creating the
 * thread runs in the background, so nothing here waits for it; the panel reports the outcome in a toast.
 */
export const StartThreadDialog = (props: {
  /** One item, or the selection the thread works on; every item is linked and named in the opening message. */
  readonly items: readonly StartThreadItem[]
  readonly projects: readonly StartThreadProject[]
  readonly loadCatalog: () => Promise<StartThreadCatalog>
  /** Every enabled agent, so the thread can start as one with its preset, route and instructions. */
  readonly listAgents: () => Promise<readonly StartThreadAgentChoice[]>
  readonly openByDefault: boolean
  readonly start: (request: StartThreadRequest) => void
  readonly close: () => void
}): JSX.Element => {
  const targets = StartThreadForm.targets(props.items, props.projects)
  const [targetValue, setTargetValue] = useState(() => StartThreadForm.defaultTargetValue(props.items, props.projects))
  const [targetWasChosen, setTargetWasChosen] = useState(false)
  const [agentHandle, setAgentHandle] = useState('')
  const [modelKey, setModelKey] = useState<string | null>(null)
  const [effort, setEffort] = useState<string | null>(null)
  const [mode, setMode] = useState<'together' | 'per-item'>('together')
  const [message, setMessage] = useState(() => StartThreadForm.message(props.items))
  const [instructions, setInstructions] = useState('')
  const [open, setOpen] = useState(props.openByDefault)
  const catalogQuery = useQuery({ queryKey: ['dshfiles-backlog', 'start-thread', 'catalog'], queryFn: props.loadCatalog, staleTime: 30_000 })
  const agentsQuery = useQuery({ queryKey: ['dshfiles-backlog', 'start-thread', 'agents'], queryFn: props.listAgents, staleTime: 30_000 })
  const chosenAgent = (agentsQuery.data ?? []).find(candidate => candidate.handle === agentHandle)
  const catalog = catalogQuery.data ?? null
  const rows = catalog === null ? [] : StartThreadForm.rows(catalog)
  const selectedKey = modelKey ?? (catalog === null ? null : StartThreadForm.defaultModelKey(catalog))
  const selected = rows.find(row => row.key === selectedKey)
  const effortValue = effort ?? (selected === undefined ? undefined : StartThreadForm.defaultEffort(selected))
  const target = targets.find(option => option.value === targetValue)?.target ?? { kind: 'default' }
  const projectIndex = (projectId: string): number => props.projects.findIndex(project => project.id === projectId)
  const projectOptions: readonly ComboboxOption[] = targets.map(option => {
    const optionTarget = option.target
    const project = optionTarget.kind === 'project' ? props.projects.find(candidate => candidate.id === optionTarget.projectId) : undefined
    const description = project === undefined ? undefined : StartThreadForm.projectPath(project.path)
    return description === undefined ? { value: option.value, label: option.label } : { value: option.value, label: option.label, description }
  })
  const agentOptions: readonly ComboboxOption[] = [
    { value: '', label: 'None (pick an account and model)', keywords: ['no agent', 'default'] },
    ...(agentsQuery.data ?? []).map(choice => ({
      value: choice.handle,
      label: `${choice.name} · @${choice.handle}`,
      keywords: [choice.handle, choice.description, choice.preset ?? ''],
    })),
  ]
  const modelOptions: readonly ComboboxOption[] =
    catalog?.providers.flatMap(provider =>
      provider.models.map(model => ({
        value: `${provider.id}/${model.id}`,
        label: model.name,
        keywords: [model.id, provider.name],
        group: provider.name,
      })),
    ) ?? []
  const effortOptions: readonly ComboboxOption[] = selected?.model.efforts.map(option => ({ value: option.id, label: option.name })) ?? []

  const pickModel = (key: string): void => {
    setModelKey(key)
    setEffort(null)
  }

  /** An agent brings its own preset, route and instructions; without one the account/model fields decide. */
  const selection = (): Pick<StartThreadRequest, 'agent' | 'provider' | 'model' | 'reasoningEffort' | 'message'> | null => {
    if (chosenAgent !== undefined) {
      return { agent: chosenAgent, provider: null, model: null, reasoningEffort: undefined, message: message.trim() }
    }
    if (selected === undefined) return null
    return { provider: selected.provider.id, model: selected.model.id, reasoningEffort: effortValue, message: message.trim() }
  }

  const submit = (): void => {
    const picked = selection()
    if (picked === null) return
    props.close()
    const startTarget = mode === 'per-item' && !targetWasChosen ? { kind: 'default' as const } : target
    props.start({ items: props.items, mode, target: startTarget, ...picked, message: mode === 'per-item' ? instructions : picked.message, open })
  }

  return (
    <Dialog open onOpenChange={next => (next ? undefined : props.close())}>
      <DialogContent className="dshx-root dshx:sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Start thread</DialogTitle>
          <DialogDescription className="dshx:line-clamp-2">
            {props.items.length === 1
              ? `b:${String(props.items[0]?.id)} · ${props.items[0]?.title ?? ''}`
              : `${props.items.map(item => `b:${String(item.id)}`).join(', ')} · ${String(props.items.length)} items`}
          </DialogDescription>
        </DialogHeader>
        <div className="dshx:flex dshx:flex-col dshx:gap-3">
          {props.items.length < 2 ? null : (
            <fieldset className="dshx:flex dshx:flex-col dshx:gap-2">
              <legend className={labelClass}>Thread count</legend>
              <label className="dshx:flex dshx:items-start dshx:gap-2 dshx:text-[13px]">
                <input type="radio" name="backlog-thread-mode" checked={mode === 'together'} onChange={() => setMode('together')} />
                <span>One thread for all {String(props.items.length)} items</span>
              </label>
              <label className="dshx:flex dshx:items-start dshx:gap-2 dshx:text-[13px]">
                <input type="radio" name="backlog-thread-mode" checked={mode === 'per-item'} onChange={() => setMode('per-item')} />
                <span>One thread per item ({String(props.items.length)} threads)</span>
              </label>
            </fieldset>
          )}
          <label className="dshx:flex dshx:flex-col dshx:gap-1">
            <span className={labelClass}>Project</span>
            <Combobox
              emptyLabel="No workspace matches."
              label="Thread project"
              matchTriggerWidth
              onValueChange={value => {
                setTargetWasChosen(true)
                setTargetValue(value)
              }}
              options={projectOptions}
              renderOption={option => {
                const project = props.projects.find(candidate => `project:${candidate.id}` === option.value)
                return (
                  <>
                    {project === undefined ? null : <StatusDot className={StartThreadForm.projectTone(projectIndex(project.id))} />}
                    <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate">{option.label}</span>
                    {option.description === undefined ? null : (
                      <span className="dshx:max-w-40 dshx:truncate dshx:text-[11px] dshx:text-muted-foreground">{option.description}</span>
                    )}
                  </>
                )
              }}
              searchAbove={0}
              searchPlaceholder="Search workspaces and folders…"
              value={targetValue}
            />
          </label>
          <label className="dshx:flex dshx:flex-col dshx:gap-1">
            <span className={labelClass}>Agent</span>
            <Combobox
              label="Thread agent"
              matchTriggerWidth
              onValueChange={setAgentHandle}
              options={agentOptions}
              searchPlaceholder="Search agents…"
              value={agentHandle}
            />
            {chosenAgent === undefined ? null : (
              <span className="dshx:text-[11px] dshx:text-muted-foreground">
                {chosenAgent.route === null ? 'Harness default model' : `${chosenAgent.route.provider}/${chosenAgent.route.model}`} ·{' '}
                {chosenAgent.preset ?? 'Host default tools'}
                {chosenAgent.instructions.trim() === '' ? '' : ' · instructions applied'}
              </span>
            )}
          </label>
          {chosenAgent === undefined ? (
            <label className="dshx:flex dshx:flex-col dshx:gap-1">
              <span className={labelClass}>Account and model</span>
              {catalogQuery.isError ? (
                <p className="dshx:text-xs dshx:text-destructive">The model catalog is unavailable: {errorMessage(catalogQuery.error, 'unknown error')}</p>
              ) : (
                <Combobox
                  disabled={catalog === null}
                  emptyLabel="No model matches."
                  label="Thread model"
                  matchTriggerWidth
                  onValueChange={pickModel}
                  options={modelOptions}
                  placeholder={catalog === null ? 'Loading models…' : 'Select a model'}
                  searchPlaceholder="Search models…"
                  value={selectedKey ?? ''}
                />
              )}
            </label>
          ) : null}
          {chosenAgent !== undefined || selected === undefined || selected.model.efforts.length === 0 ? null : (
            <label className="dshx:flex dshx:flex-col dshx:gap-1">
              <span className={labelClass}>Reasoning effort</span>
              <Combobox label="Reasoning effort" matchTriggerWidth onValueChange={setEffort} options={effortOptions} value={effortValue ?? ''} />
            </label>
          )}
          <label className="dshx:flex dshx:flex-col dshx:gap-1">
            <span className={labelClass}>{mode === 'per-item' ? 'Instructions for each thread' : chosenAgent === undefined ? 'First message' : 'Task'}</span>
            <textarea
              aria-label={mode === 'per-item' ? 'Instructions for each thread' : 'First message'}
              onKeyDown={event => {
                if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
                const current = mode === 'per-item' ? instructions : message
                const continuation = continueMarkdownList({
                  text: current,
                  start: event.currentTarget.selectionStart,
                  end: event.currentTarget.selectionEnd,
                })
                if (continuation === null) return
                event.preventDefault()
                const textarea = event.currentTarget
                if (mode === 'per-item') setInstructions(continuation.value)
                else setMessage(continuation.value)
                requestAnimationFrame(() => textarea.setSelectionRange(continuation.caret, continuation.caret))
              }}
              value={mode === 'per-item' ? instructions : message}
              onChange={event => (mode === 'per-item' ? setInstructions(event.currentTarget.value) : setMessage(event.currentTarget.value))}
              rows={4}
              placeholder={mode === 'per-item' ? 'Optional; each thread gets its own item reference' : 'Leave empty to create an empty thread'}
              className="dshx:w-full dshx:resize-y dshx:rounded-md dshx:border dshx:border-input dshx:bg-background dshx:p-2 dshx:text-[13px] dshx:text-foreground dshx:outline-none dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring/50"
            />
            <label className="dshx:flex dshx:items-center dshx:gap-2 dshx:text-[13px]">
              <input type="checkbox" aria-label="Open the thread when it is created" checked={open} onChange={event => setOpen(event.currentTarget.checked)} />
              Open the thread when it is created
            </label>
            <span className="dshx:text-[11px] dshx:text-muted-foreground">
              {mode === 'per-item'
                ? `Each thread is linked to one item, gets its own b: reference, and uses its project by default. `
                : props.items.length > 1
                  ? `The thread is linked to all ${String(props.items.length)} items. `
                  : 'The thread is linked to this item. '}
              {mode === 'per-item' ? (
                'Each thread starts with a message.'
              ) : (
                <>
                  {message.trim() === '' ? 'It is created empty' : 'It is told what to work on'}
                  {open ? ' and opens when it is ready.' : ', in the background, until you open it.'}
                </>
              )}
              {mode === 'per-item' ? (open ? ' Threads open as they are created.' : ' Threads stay in the background until you open them.') : null}
            </span>
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={props.close}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={selection() === null}>
            <MessagesSquareIcon aria-hidden className="dshx:size-3.5" />
            {mode === 'per-item' ? `Start ${String(props.items.length)} threads` : 'Start thread'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
