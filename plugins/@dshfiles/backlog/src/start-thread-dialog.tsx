import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@dshfiles/plugin-ui/components/ui/dialog'
import { LoaderCircleIcon, MessagesSquareIcon } from '@dshfiles/plugin-ui/icons'
import { errorMessage, useQuery } from '@dshfiles/plugin-ui/query'
import { useState } from 'react'

import { AgentComments } from './agent-dispatch.js'
import {
  StartThreadForm,
  type StartThreadAgentChoice,
  type StartThreadCatalog,
  type StartThreadItem,
  type StartThreadProject,
  type StartThreadRequest,
} from './start-thread.js'

const fieldClass =
  'dshx:h-8 dshx:w-full dshx:rounded-md dshx:border dshx:border-input dshx:bg-background dshx:px-2 dshx:text-[13px] dshx:text-foreground dshx:outline-none dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring/50'
const labelClass = 'dshx:text-[11px] dshx:font-semibold dshx:uppercase dshx:tracking-wider dshx:text-muted-foreground'

type StartOutcome = { readonly ok: true } | { readonly ok: false; readonly reason: string }

/**
 * Chooses the project, account/model and opening message, then asks the panel to start the thread. The catalog is a
 * Host read, so it loads when the dialog opens instead of with every list refresh.
 */
export const StartThreadDialog = (props: {
  /** One item, or the selection the thread works on; every item is linked and named in the opening message. */
  readonly items: readonly StartThreadItem[]
  readonly projects: readonly StartThreadProject[]
  readonly loadCatalog: () => Promise<StartThreadCatalog>
  /** Every enabled agent, so the thread can start as one with its preset, route and instructions. */
  readonly listAgents: () => Promise<readonly StartThreadAgentChoice[]>
  readonly sendByDefault: boolean
  readonly start: (request: StartThreadRequest) => Promise<StartOutcome>
  readonly close: () => void
}): JSX.Element => {
  const targets = StartThreadForm.targets(props.items, props.projects)
  const [targetValue, setTargetValue] = useState(() => StartThreadForm.defaultTargetValue(props.items, props.projects))
  const [agentHandle, setAgentHandle] = useState('')
  const [modelKey, setModelKey] = useState<string | null>(null)
  const [effort, setEffort] = useState<string | null>(null)
  const [message, setMessage] = useState(() => StartThreadForm.message(props.items))
  const [send, setSend] = useState(props.sendByDefault)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const catalogQuery = useQuery({ queryKey: ['dshfiles-backlog', 'start-thread', 'catalog'], queryFn: props.loadCatalog, staleTime: 30_000 })
  const agentsQuery = useQuery({ queryKey: ['dshfiles-backlog', 'start-thread', 'agents'], queryFn: props.listAgents, staleTime: 30_000 })
  const chosenAgent = (agentsQuery.data ?? []).find(candidate => candidate.handle === agentHandle)
  const catalog = catalogQuery.data ?? null
  const rows = catalog === null ? [] : StartThreadForm.rows(catalog)
  const selectedKey = modelKey ?? (catalog === null ? null : StartThreadForm.defaultModelKey(catalog))
  const selected = rows.find(row => row.key === selectedKey)
  const effortValue = effort ?? (selected === undefined ? undefined : StartThreadForm.defaultEffort(selected))
  const target = targets.find(option => option.value === targetValue)?.target ?? { kind: 'default' }

  const pickModel = (key: string): void => {
    setModelKey(key)
    setEffort(null)
  }

  /** An agent brings its own preset, route and instructions; without one the account/model fields decide. */
  const selection = (): Pick<StartThreadRequest, 'agent' | 'provider' | 'model' | 'reasoningEffort' | 'message'> | null => {
    if (chosenAgent !== undefined) {
      return { agent: chosenAgent, provider: null, model: null, reasoningEffort: undefined, message: AgentComments.opening(chosenAgent, message.trim()) }
    }
    if (selected === undefined) return null
    return { provider: selected.provider.id, model: selected.model.id, reasoningEffort: effortValue, message: message.trim() }
  }

  const submit = async (): Promise<void> => {
    const picked = selection()
    if (picked === null) return
    setBusy(true)
    setError(null)
    try {
      const outcome = await props.start({ items: props.items, target, ...picked, send })
      if (outcome.ok) {
        props.close()
        return
      }
      setError(outcome.reason)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={open => (open ? undefined : props.close())}>
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
          <label className="dshx:flex dshx:flex-col dshx:gap-1">
            <span className={labelClass}>Project</span>
            <select aria-label="Thread project" className={fieldClass} value={targetValue} onChange={event => setTargetValue(event.currentTarget.value)}>
              {targets.map(option => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="dshx:flex dshx:flex-col dshx:gap-1">
            <span className={labelClass}>Agent</span>
            <select aria-label="Thread agent" className={fieldClass} value={agentHandle} onChange={event => setAgentHandle(event.currentTarget.value)}>
              <option value="">None (pick an account and model)</option>
              {(agentsQuery.data ?? []).map(choice => (
                <option key={choice.handle} value={choice.handle}>
                  {choice.name} · @{choice.handle}
                </option>
              ))}
            </select>
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
                <select
                  aria-label="Thread model"
                  className={fieldClass}
                  value={selectedKey ?? ''}
                  disabled={catalog === null}
                  onChange={event => pickModel(event.currentTarget.value)}
                >
                  {catalog === null ? <option value="">Loading models…</option> : null}
                  {catalog?.providers.map(provider => (
                    <optgroup key={provider.id} label={provider.name}>
                      {provider.models.map(model => (
                        <option key={`${provider.id}/${model.id}`} value={`${provider.id}/${model.id}`}>
                          {model.name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              )}
            </label>
          ) : null}
          {chosenAgent !== undefined || selected === undefined || selected.model.efforts.length === 0 ? null : (
            <label className="dshx:flex dshx:flex-col dshx:gap-1">
              <span className={labelClass}>Reasoning effort</span>
              <select aria-label="Reasoning effort" className={fieldClass} value={effortValue ?? ''} onChange={event => setEffort(event.currentTarget.value)}>
                {selected.model.efforts.map(option => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="dshx:flex dshx:flex-col dshx:gap-1">
            <span className={labelClass}>{chosenAgent === undefined ? 'First message' : 'Task'}</span>
            <textarea
              aria-label="First message"
              value={message}
              onChange={event => setMessage(event.currentTarget.value)}
              rows={4}
              placeholder="Leave empty to open an empty thread"
              className="dshx:w-full dshx:resize-y dshx:rounded-md dshx:border dshx:border-input dshx:bg-background dshx:p-2 dshx:text-[13px] dshx:text-foreground dshx:outline-none dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring/50"
            />
            <label className="dshx:flex dshx:items-center dshx:gap-2 dshx:text-[13px]">
              <input type="checkbox" checked={send} onChange={event => setSend(event.currentTarget.checked)} disabled={message.trim() === ''} />
              Send this message now
            </label>
            <span className="dshx:text-[11px] dshx:text-muted-foreground">
              {props.items.length > 1 ? `The thread is linked to all ${String(props.items.length)} items. ` : 'The thread is linked to this item. '}
              {message.trim() === ''
                ? 'It opens as an empty draft.'
                : send
                  ? 'It is told what to work on and opened.'
                  : 'It opens with the message as an editable draft.'}
            </span>
          </label>
          {error === null ? null : <p className="dshx:text-xs dshx:text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={props.close} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy || selection() === null}>
            {busy ? <LoaderCircleIcon aria-hidden className="dshx:size-3.5 dshx:animate-spin" /> : <MessagesSquareIcon aria-hidden className="dshx:size-3.5" />}
            Start thread
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
