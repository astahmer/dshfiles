import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react'
import { useSubscribable, type SelectOption, type Subscribable } from '@dshfiles/dshx/client'
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
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@dshfiles/plugin-ui/components/ui/command'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@dshfiles/plugin-ui/components/ui/dialog'
import { Input } from '@dshfiles/plugin-ui/components/ui/input'
import { CheckIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { cancelRequest, type DialogRequest } from './dialog-queue.js'

type RequestOf<Kind extends DialogRequest['kind']> = Extract<DialogRequest, { readonly kind: Kind }>

const ConfirmDialog = (props: { readonly request: RequestOf<'confirm'> | RequestOf<'alert'> }): JSX.Element => {
  const { request } = props
  const danger = request.kind === 'confirm' && request.input.danger === true
  const descriptionId = useId()
  const cancel = (): void => cancelRequest(request)
  const accept = (): void => (request.kind === 'confirm' ? request.settle(true) : request.settle())
  // Radix alert dialogs swallow outside presses by design; these asks dismiss on one like every other dialog here.
  useEffect(() => {
    const onPointerDown = (event: PointerEvent): void => {
      if (event.target instanceof Element && event.target.closest('[data-slot="alert-dialog-content"]') !== null) return
      cancelRequest(request)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [request])
  return (
    <AlertDialog open onOpenChange={open => !open && cancel()}>
      <AlertDialogContent
        className="dshx-root"
        aria-describedby={request.input.description === undefined ? undefined : descriptionId}
        onOpenAutoFocus={event => {
          event.preventDefault()
          if (!(event.target instanceof HTMLElement)) return
          const slot = danger ? 'alert-dialog-cancel' : 'alert-dialog-action'
          event.target.querySelector<HTMLElement>(`[data-slot="${slot}"]`)?.focus()
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{request.input.title}</AlertDialogTitle>
          {request.input.description !== undefined && <AlertDialogDescription id={descriptionId}>{request.input.description}</AlertDialogDescription>}
        </AlertDialogHeader>
        <AlertDialogFooter>
          {request.kind === 'confirm' && <AlertDialogCancel onClick={cancel}>{request.input.cancel ?? 'Cancel'}</AlertDialogCancel>}
          <AlertDialogAction variant={danger ? 'destructive' : 'default'} onClick={accept}>
            {request.kind === 'confirm' ? (request.input.confirm ?? 'Confirm') : 'OK'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

const PromptDialog = (props: { readonly request: RequestOf<'prompt'> }): JSX.Element => {
  const { request } = props
  const [value, setValue] = useState(request.input.initial ?? '')
  const descriptionId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const empty = value.trim() === ''
  const submit = (event: FormEvent): void => {
    event.preventDefault()
    if (empty) return
    request.settle(value)
  }
  return (
    <Dialog open onOpenChange={open => !open && cancelRequest(request)}>
      <DialogContent
        className="dshx-root"
        showCloseButton={false}
        aria-describedby={request.input.description === undefined ? undefined : descriptionId}
        onOpenAutoFocus={event => {
          event.preventDefault()
          inputRef.current?.focus()
          inputRef.current?.select()
        }}
      >
        <form className="dshx:grid dshx:gap-4" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{request.input.title}</DialogTitle>
            {request.input.description !== undefined && <DialogDescription id={descriptionId}>{request.input.description}</DialogDescription>}
          </DialogHeader>
          <Input
            ref={inputRef}
            aria-label={request.input.title}
            type={request.input.secret === true ? 'password' : 'text'}
            autoComplete="off"
            placeholder={request.input.placeholder}
            value={value}
            onChange={event => setValue(event.target.value)}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => cancelRequest(request)}>
              Cancel
            </Button>
            <Button type="submit" disabled={empty}>
              OK
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

const groupOptions = (options: readonly SelectOption<string>[]): readonly (readonly [string, readonly SelectOption<string>[]])[] => {
  const groups = new Map<string, SelectOption<string>[]>()
  for (const option of options) {
    const key = option.group ?? ''
    groups.set(key, [...(groups.get(key) ?? []), option])
  }
  return [...groups]
}

const matchesSearch = (_value: string, search: string, keywords?: string[]): number =>
  (keywords ?? []).join(' ').toLowerCase().includes(search.trim().toLowerCase()) ? 1 : 0

const SelectDialog = (props: { readonly request: RequestOf<'select'> }): JSX.Element => {
  const { request } = props
  const groups = useMemo(() => groupOptions(request.input.options), [request.input.options])
  return (
    <Dialog open onOpenChange={open => !open && cancelRequest(request)}>
      <DialogContent className="dshx-root dshx:gap-0 dshx:overflow-hidden dshx:p-0" showCloseButton={false} aria-describedby={undefined}>
        <DialogHeader className="dshx:sr-only">
          <DialogTitle>{request.input.title}</DialogTitle>
        </DialogHeader>
        <Command filter={matchesSearch} label={request.input.title} defaultValue={request.input.current ?? ''}>
          <CommandInput aria-label={request.input.title} placeholder={request.input.title} />
          <CommandList>
            <CommandEmpty>No matches</CommandEmpty>
            {groups.map(([group, options]) => (
              <CommandGroup key={group} heading={group === '' ? undefined : group}>
                {options.map(option => {
                  const current = option.value === request.input.current
                  return (
                    <CommandItem
                      key={option.value}
                      value={option.value}
                      keywords={option.description === undefined ? [option.title] : [option.title, option.description]}
                      aria-current={current ? 'true' : undefined}
                      onSelect={() => request.settle(option.value)}
                    >
                      <div className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-col">
                        <span className={cn('dshx:truncate', current && 'dshx:font-medium')}>{option.title}</span>
                        {option.description !== undefined && (
                          <span className="dshx:truncate dshx:text-xs dshx:text-muted-foreground">{option.description}</span>
                        )}
                      </div>
                      {current && <CheckIcon aria-hidden className="dshx:text-foreground" />}
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  )
}

/** Renders the queue's open request; a key per request remounts it so focus and field state start fresh. */
export const DialogHost = (props: { readonly current: Subscribable<DialogRequest | undefined> }): JSX.Element | null => {
  const request = useSubscribable(props.current)
  if (request === undefined) return null
  switch (request.kind) {
    case 'confirm':
    case 'alert':
      return <ConfirmDialog key={request.id} request={request} />
    case 'prompt':
      return <PromptDialog key={request.id} request={request} />
    case 'select':
      return <SelectDialog key={request.id} request={request} />
  }
}
