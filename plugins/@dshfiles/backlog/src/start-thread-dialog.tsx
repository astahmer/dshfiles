import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@dshfiles/plugin-ui/components/ui/context-menu'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@dshfiles/plugin-ui/components/ui/dialog'
import { LoaderCircleIcon, MessagesSquareIcon } from '@dshfiles/plugin-ui/icons'
import { errorMessage, useQuery } from '@dshfiles/plugin-ui/query'
import { useState, type ReactNode } from 'react'

import type { BacklogSummaryView } from './api.js'
import { StartThreadForm, type StartThreadCatalog, type StartThreadProject, type StartThreadRequest } from './start-thread.js'

const fieldClass =
  'dshx:h-8 dshx:w-full dshx:rounded-md dshx:border dshx:border-input dshx:bg-background dshx:px-2 dshx:text-[13px] dshx:text-foreground dshx:outline-none dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring/50'
const labelClass = 'dshx:text-[11px] dshx:font-semibold dshx:uppercase dshx:tracking-wider dshx:text-muted-foreground'

type StartOutcome = { readonly ok: true } | { readonly ok: false; readonly reason: string }

/** Right-click entry point: one row action that opens the start-thread dialog for that item. */
export const StartThreadMenu = (props: {
  readonly item: BacklogSummaryView
  readonly startThread: (item: BacklogSummaryView) => void
  readonly children: ReactNode
}): JSX.Element => (
  <ContextMenu>
    <ContextMenuTrigger asChild>{props.children}</ContextMenuTrigger>
    <ContextMenuContent className="dshx-root dshx:min-w-48">
      <ContextMenuItem className="dshx:gap-2 dshx:text-[13px]" onSelect={() => props.startThread(props.item)}>
        <MessagesSquareIcon aria-hidden className="dshx:size-3.5" />
        Start thread…
      </ContextMenuItem>
    </ContextMenuContent>
  </ContextMenu>
)

/**
 * Chooses the project, account/model and opening message, then asks the panel to start the thread. The catalog is a
 * Host read, so it loads when the dialog opens instead of with every list refresh.
 */
export const StartThreadDialog = (props: {
  readonly item: BacklogSummaryView
  readonly projects: readonly StartThreadProject[]
  readonly loadCatalog: () => Promise<StartThreadCatalog>
  readonly start: (request: StartThreadRequest) => Promise<StartOutcome>
  readonly close: () => void
}): JSX.Element => {
  const targets = StartThreadForm.targets(props.item, props.projects)
  const [targetValue, setTargetValue] = useState(() => StartThreadForm.defaultTargetValue(props.item, props.projects))
  const [modelKey, setModelKey] = useState<string | null>(null)
  const [effort, setEffort] = useState<string | null>(null)
  const [message, setMessage] = useState(() => StartThreadForm.message(props.item))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const catalogQuery = useQuery({ queryKey: ['dshfiles-backlog', 'start-thread', 'catalog'], queryFn: props.loadCatalog, staleTime: 30_000 })
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

  const submit = async (): Promise<void> => {
    if (selected === undefined) return
    setBusy(true)
    setError(null)
    try {
      const outcome = await props.start({
        item: props.item,
        target,
        provider: selected.provider.id,
        model: selected.model.id,
        reasoningEffort: effortValue,
        message: message.trim(),
      })
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
            b:{props.item.id} · {props.item.title}
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
          {selected === undefined || selected.model.efforts.length === 0 ? null : (
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
            <span className={labelClass}>First message</span>
            <textarea
              aria-label="First message"
              value={message}
              onChange={event => setMessage(event.currentTarget.value)}
              rows={4}
              placeholder="Leave empty to open an empty thread"
              className="dshx:w-full dshx:resize-y dshx:rounded-md dshx:border dshx:border-input dshx:bg-background dshx:p-2 dshx:text-[13px] dshx:text-foreground dshx:outline-none dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring/50"
            />
            <span className="dshx:text-[11px] dshx:text-muted-foreground">The thread is linked to this item and opened once it exists.</span>
          </label>
          {error === null ? null : <p className="dshx:text-xs dshx:text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={props.close} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy || selected === undefined}>
            {busy ? <LoaderCircleIcon aria-hidden className="dshx:size-3.5 dshx:animate-spin" /> : <MessagesSquareIcon aria-hidden className="dshx:size-3.5" />}
            Start thread
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
