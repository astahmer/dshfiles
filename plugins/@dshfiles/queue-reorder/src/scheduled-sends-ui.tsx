import type { ApiClient, ApiContract } from '@dshfiles/dshx/api'
import { Composer, useApi, useApiEvent, useContract, useSettings } from '@dshfiles/dshx/client'
import { ComposerBar, type ComposerBarPlacement } from '@dshfiles/rich-composer/composer-more'
import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@dshfiles/plugin-ui/components/ui/dialog'
import { Input } from '@dshfiles/plugin-ui/components/ui/input'
import { Label } from '@dshfiles/plugin-ui/components/ui/label'
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@dshfiles/plugin-ui/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@dshfiles/plugin-ui/components/ui/select'
import { Textarea } from '@dshfiles/plugin-ui/components/ui/textarea'
import { useSessionOnScreen } from '@dshfiles/plugin-ui/hooks/session-on-screen'
import { AlarmClockIcon, PencilIcon, SendIcon, XIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { errorMessage, queryOptions, useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react'
import { scheduledSendApi, type ScheduledSend, type SendModel } from './scheduled-send-api.js'
import { SendTime } from './send-time.js'
import { SendLaterRequests } from './send-later-requests.js'
import { queueReorderSettings } from './settings.js'

/** The provider groups of the native model picker, as the thread's model directory loads them. */
export interface ModelGroup {
  readonly id: string
  readonly name: string
  readonly models: readonly {
    readonly id: string
    readonly name: string
    readonly reasoning?: { readonly efforts: readonly { readonly id: string; readonly name: string }[] } | undefined
  }[]
}

export type LoadModels = () => Promise<readonly ModelGroup[]>

const sendsKey = (sessionId: string) => ['queue-reorder', 'scheduled-sends', sessionId] as const

type ScheduledSendClient = typeof scheduledSendApi extends ApiContract<infer Methods> ? ApiClient<Methods> : never

/**
 * The `changed` event reads the list again when a send the Host delivered (or another tab scheduled) leaves or joins
 * it. Without that stream it polls, and only for the thread the main view shows: main tabs keep every visited thread's
 * dock mounted, and the others read once when they mount.
 */
export const scheduledSendsQuery = (input: {
  readonly api: Pick<ScheduledSendClient, 'list'>
  readonly sessionId: string
  readonly onScreen: boolean
  readonly eventsLive: boolean
}) =>
  queryOptions({
    queryKey: sendsKey(input.sessionId),
    queryFn: ({ signal }) => input.api.list({ sessionId: input.sessionId }, { signal }),
    refetchInterval: input.onScreen && !input.eventsLive ? 15_000 : false,
  })

const useScheduledSends = (sessionId: string) => {
  const api = useApi(scheduledSendApi)
  const queryClient = useQueryClient()
  const events = useApiEvent(scheduledSendApi, 'changed', () => void queryClient.invalidateQueries({ queryKey: sendsKey(sessionId) }))
  return useQuery(scheduledSendsQuery({ api, sessionId, onScreen: useSessionOnScreen(sessionId), eventsLive: events === 'live' }))
}

const useNow = (): Date => {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(timer)
  }, [])
  return now
}

const noSubscription = (): (() => void) => () => undefined
const alwaysPinned = (): boolean => true

/** Pinned (a button in the bar) only while the user keeps the composer extras there; otherwise a row of the More menu. */
const usePinned = (): boolean => {
  const bar = useContract(ComposerBar)
  const placement: ComposerBarPlacement | undefined = bar.status === 'active' ? bar.value : undefined
  return useSyncExternalStore(placement?.subscribe ?? noSubscription, placement?.pinned ?? alwaysPinned, placement?.pinned ?? alwaysPinned)
}

/** The composer seat: Send later, a row of the composer's More menu (a button beside Send only while extras are pinned). */
export const SendLaterAction = (props: {
  readonly sessionId: string
  readonly useInput: <Selected>(selector: (state: { readonly draft: string; readonly attachmentIds: readonly unknown[] }) => Selected) => Selected
  readonly inputActions: { readonly setDraft: (text: string) => void; readonly persistDraft: () => void }
}): JSX.Element | null => {
  const settings = useSettings(queueReorderSettings).value
  const api = useApi(scheduledSendApi)
  const queryClient = useQueryClient()
  const composer = useContract(Composer)
  const draft = props.useInput(state => state.draft)
  const attachments = props.useInput(state => state.attachmentIds.length)
  const [open, setOpen] = useState(false)
  const [custom, setCustom] = useState('')
  const [notice, setNotice] = useState('')
  const customId = useId()
  // The presets read the time the popover opened, so their labels hold still while it stays open.
  const [now, setNow] = useState(() => new Date())
  const pinned = usePinned()
  const openRef = useRef((): void => undefined)
  openRef.current = () => {
    setNow(new Date())
    setCustom(SendTime.toLocalInput(Date.now() + 60 * 60_000))
    setOpen(true)
  }
  const sendLaterOn = settings?.sendLater !== false
  useEffect(() => (sendLaterOn ? SendLaterRequests.on(props.sessionId, () => openRef.current()) : undefined), [props.sessionId, sendLaterOn])

  const schedule = useMutation({
    mutationFn: async (sendAt: number) => {
      const text = composer.status === 'active' ? (composer.value.text({ sessionId: props.sessionId }) ?? draft) : draft
      const send = await api.create({ sessionId: props.sessionId, text, sendAt })
      props.inputActions.setDraft('')
      props.inputActions.persistDraft()
      return send
    },
    onSuccess: send => {
      setOpen(false)
      setNotice('')
      void queryClient.invalidateQueries({ queryKey: sendsKey(send.sessionId) })
    },
    onError: error => setNotice(errorMessage(error, 'The message could not be scheduled. Try again, or send it now.')),
  })

  if (!sendLaterOn) return null
  const empty = draft.trim().length === 0
  const blocked =
    attachments > 0 ? 'Attachments cannot be scheduled. Send the message now, or remove them first.' : empty ? 'Write a message to schedule it.' : ''
  const customAt = SendTime.fromLocalInput(custom)

  return (
    <Popover
      open={open}
      onOpenChange={next => {
        setOpen(next)
        if (!next) return
        const opened = new Date()
        setNow(opened)
        setCustom(SendTime.toLocalInput(opened.getTime() + 60 * 60_000))
      }}
    >
      {pinned ? null : (
        // Opened from the More menu: an invisible anchor beside Send keeps the popover above the bar.
        <PopoverAnchor asChild>
          <span aria-hidden="true" className="dshx:inline-block dshx:h-6 dshx:w-0" data-send-later-anchor="" />
        </PopoverAnchor>
      )}
      {pinned ? (
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="Send later"
            className="dshx-root dshx:text-muted-foreground dshx:hover:text-foreground dshx:pointer-coarse:min-h-11 dshx:data-[state=open]:bg-accent dshx:data-[state=open]:text-foreground"
            onMouseDown={event => event.preventDefault()}
          >
            <AlarmClockIcon />
            <span className="dshx:@max-pane-compact:sr-only dshx:in-data-model-compact:sr-only">Later</span>
          </Button>
        </PopoverTrigger>
      ) : null}
      <PopoverContent align="end" side="top" className="dshx-root dshx:flex dshx:w-72 dshx:max-w-[calc(100vw-1rem)] dshx:flex-col dshx:gap-2 dshx:p-2">
        <h2 className="dshx:px-1 dshx:text-sm dshx:font-semibold">Send later</h2>
        {blocked === '' ? null : <p className="dshx:px-1 dshx:text-xs dshx:text-muted-foreground">{blocked}</p>}
        <div className="dshx:flex dshx:flex-col" role="group" aria-label="Send at">
          {SendTime.presets(now).map(preset => (
            <Button
              key={preset.label}
              type="button"
              variant="ghost"
              size="sm"
              className="dshx:justify-between dshx:pointer-coarse:min-h-11"
              disabled={blocked !== '' || schedule.isPending}
              onClick={() => schedule.mutate(preset.at)}
            >
              <span>{preset.label}</span>
              <span className="dshx:text-xs dshx:text-muted-foreground">{SendTime.label(preset.at, now)}</span>
            </Button>
          ))}
        </div>
        <div className="dshx:flex dshx:flex-col dshx:gap-1 dshx:border-t dshx:px-1 dshx:pt-2">
          <Label htmlFor={customId} className="dshx:text-xs">
            Pick a time
          </Label>
          <div className="dshx:flex dshx:gap-2">
            <Input id={customId} type="datetime-local" value={custom} onChange={event => setCustom(event.target.value)} className="dshx:min-w-0 dshx:flex-1" />
            <Button
              type="button"
              size="sm"
              className="dshx:pointer-coarse:min-h-11"
              disabled={blocked !== '' || customAt === undefined || schedule.isPending}
              onClick={() => (customAt === undefined ? undefined : schedule.mutate(customAt))}
            >
              Schedule
            </Button>
          </div>
        </div>
        <p className="dshx:px-1 dshx:text-xs dshx:text-destructive dshx:empty:hidden" role="status" aria-live="polite">
          {notice}
        </p>
      </PopoverContent>
    </Popover>
  )
}

const THREAD_MODEL = 'thread'
const DEFAULT_EFFORT = 'default'
type ModelRoute = Pick<SendModel, 'provider' | 'model'>
/** A model route as one Select value: the JSON `[provider, model]` pair, so neither part needs escaping. */
const modelValueSchema = Schema.fromJsonString(Schema.Tuple([Schema.String, Schema.String]))
const decodeModelValue = Schema.decodeUnknownOption(modelValueSchema)
const modelValue = (model: ModelRoute): string => JSON.stringify([model.provider, model.model])
const parseModelValue = (value: string): ModelRoute | undefined => {
  if (value === THREAD_MODEL) return undefined
  return Option.getOrUndefined(Option.map(decodeModelValue(value), ([provider, model]) => ({ provider, model })))
}
const sendModelOf = (route: ModelRoute, effort: string | undefined): SendModel => {
  if (effort === undefined) return { ...route }
  return { ...route, reasoningEffort: effort }
}

/** Edit one scheduled send: text, time, and the model and effort the thread switches to first. */
const ScheduledSendDialog = (props: {
  readonly send: ScheduledSend
  readonly loadModels: LoadModels | undefined
  readonly onClose: () => void
}): JSX.Element => {
  const api = useApi(scheduledSendApi)
  const queryClient = useQueryClient()
  const textId = useId()
  const timeId = useId()
  const [text, setText] = useState(props.send.text)
  const [time, setTime] = useState(SendTime.toLocalInput(props.send.sendAt))
  const [model, setModel] = useState(props.send.model === undefined ? THREAD_MODEL : modelValue(props.send.model))
  const [effort, setEffort] = useState(props.send.model?.reasoningEffort ?? DEFAULT_EFFORT)
  const models = useQuery({
    queryKey: ['queue-reorder', 'scheduled-send-models', props.send.sessionId],
    queryFn: async () => (props.loadModels === undefined ? [] : props.loadModels()),
    staleTime: 60_000,
  })
  const chosen = useMemo(() => parseModelValue(model), [model])
  const efforts = useMemo(() => {
    if (chosen === undefined) return []
    const group = models.data?.find(item => item.id === chosen.provider)
    return group?.models.find(item => item.id === chosen.model)?.reasoning?.efforts ?? []
  }, [chosen, models.data])
  const sendAt = SendTime.fromLocalInput(time)

  const save = useMutation({
    mutationFn: () => {
      const chosenEffort = effort === DEFAULT_EFFORT || !efforts.some(item => item.id === effort) ? undefined : effort
      const update = { id: props.send.id, text, model: chosen === undefined ? null : sendModelOf(chosen, chosenEffort) }
      return api.update(sendAt === undefined || sendAt === props.send.sendAt ? update : { ...update, sendAt })
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: sendsKey(props.send.sessionId) })
      props.onClose()
    },
  })

  return (
    <Dialog open onOpenChange={next => (next ? undefined : props.onClose())}>
      <DialogContent className="dshx-root">
        <DialogHeader>
          <DialogTitle>Edit scheduled message</DialogTitle>
        </DialogHeader>
        <form
          className="dshx:flex dshx:flex-col dshx:gap-3"
          onSubmit={event => {
            event.preventDefault()
            save.mutate()
          }}
        >
          <div className="dshx:flex dshx:flex-col dshx:gap-1">
            <Label htmlFor={textId}>Message</Label>
            <Textarea id={textId} value={text} onChange={event => setText(event.target.value)} rows={5} />
          </div>
          <div className="dshx:flex dshx:flex-col dshx:gap-1">
            <Label htmlFor={timeId}>Send at</Label>
            <Input id={timeId} type="datetime-local" value={time} onChange={event => setTime(event.target.value)} />
          </div>
          <div className="dshx:flex dshx:flex-wrap dshx:gap-3">
            <div className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-col dshx:gap-1">
              <Label>Model</Label>
              <Select value={model} onValueChange={setModel}>
                <SelectTrigger aria-label="Model" className="dshx:w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={THREAD_MODEL}>The thread’s model</SelectItem>
                  {props.send.model !== undefined &&
                  !(models.data ?? []).some(group =>
                    group.models.some(
                      item => modelValue({ provider: group.id, model: item.id }) === modelValue(props.send.model ?? { provider: '', model: '' }),
                    ),
                  ) ? (
                    <SelectItem value={modelValue(props.send.model)}>{props.send.model.model}</SelectItem>
                  ) : null}
                  {(models.data ?? []).flatMap(group =>
                    group.models.map(item => (
                      <SelectItem key={`${group.id}/${item.id}`} value={modelValue({ provider: group.id, model: item.id })}>
                        {item.name} · {group.name}
                      </SelectItem>
                    )),
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-col dshx:gap-1">
              <Label>Effort</Label>
              <Select value={effort} onValueChange={setEffort} disabled={efforts.length === 0}>
                <SelectTrigger aria-label="Effort" className="dshx:w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={DEFAULT_EFFORT}>Model default</SelectItem>
                  {efforts.map(item => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {models.isError ? (
            <p className="dshx:text-xs dshx:text-muted-foreground">Models could not be listed; the thread keeps its own model unless you pick another later.</p>
          ) : null}
          {save.isError ? (
            <p className="dshx:text-xs dshx:text-destructive" role="alert">
              {errorMessage(save.error, 'The change was not saved. Try again.')}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={props.onClose}>
              Close
            </Button>
            <Button type="submit" disabled={text.trim().length === 0 || sendAt === undefined || save.isPending}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Scheduled sends of this thread, above the composer, each with its time, model and actions. */
export const ScheduledSendsDock = (props: {
  readonly sessionId: string
  readonly loadModels: LoadModels | undefined
  readonly style: CSSProperties
}): JSX.Element | null => {
  const api = useApi(scheduledSendApi)
  const queryClient = useQueryClient()
  const composer = useContract(Composer)
  const sends = useScheduledSends(props.sessionId)
  const now = useNow()
  const [editing, setEditing] = useState<ScheduledSend | null>(null)
  const [notice, setNotice] = useState('')
  const refresh = () => queryClient.invalidateQueries({ queryKey: sendsKey(props.sessionId) })

  const sendNow = useMutation({
    mutationFn: (id: string) => api.sendNow({ id }),
    onSuccess: () => void refresh(),
    onError: error => setNotice(errorMessage(error, 'The message could not be sent now. Try again.')),
  })
  const cancel = useMutation({
    mutationFn: (id: string) => api.cancel({ id }),
    onSuccess: cancelled => {
      // Cancel never loses the words: they go back into the composer, or stay on screen when it cannot take them.
      const current = composer.status === 'active' ? (composer.value.text({ sessionId: props.sessionId }) ?? '') : ''
      const restored =
        composer.status === 'active' &&
        composer.value.setText({ sessionId: props.sessionId, text: current.trim().length === 0 ? cancelled.text : `${current}\n\n${cancelled.text}` })
      setNotice(restored ? '' : `Cancelled. Its text: ${cancelled.text}`)
      void refresh()
    },
    onError: error => setNotice(errorMessage(error, 'The message could not be cancelled. Try again.')),
  })

  const rows = sends.data?.sends ?? []
  if (rows.length === 0) return null

  // The queue dock's anatomy (queue-reorder client.tsx): an inset panel on the composer's top edge, a header once it
  // holds more than one row, 32px rows with a faint lead icon, the words, and quiet row verbs.
  return (
    <section className="dshx-root dshx:@container" data-scheduled-sends-dock="" style={props.style} aria-label="Scheduled messages">
      <div className="dshx:w-full dshx:overflow-hidden dshx:rounded-t-lg dshx:border dshx:border-b-0 dshx:bg-popover dshx:py-0.5 dshx:text-popover-foreground">
        {rows.length > 1 ? (
          <div className="dshx:flex dshx:h-row dshx:items-center dshx:gap-2 dshx:px-3">
            <AlarmClockIcon aria-hidden className="dshx:size-3.5 dshx:flex-none dshx:text-muted-foreground" />
            <span className="dshx:text-sm dshx:font-medium dshx:tabular-nums">{rows.length} scheduled</span>
            <span className="dshx:text-xs dshx:text-muted-foreground dshx:@max-pane-narrow:hidden">soonest first</span>
          </div>
        ) : null}
        <ul className="dshx:flex dshx:max-h-60 dshx:flex-col dshx:gap-px dshx:overflow-y-auto dshx:px-1 dshx:pb-0.5">
          {rows.map(send => (
            <li
              key={send.id}
              data-scheduled-send={send.status}
              className="dshx:group/row dshx:flex dshx:min-h-row dshx:min-w-0 dshx:items-center dshx:gap-1.5 dshx:rounded-md dshx:px-2 dshx:py-0.5 dshx:hover:bg-accent/50"
            >
              <AlarmClockIcon
                className={cn('dshx:size-3.5 dshx:flex-none', send.status === 'failed' ? 'dshx:text-destructive' : 'dshx:text-muted-foreground')}
                aria-hidden
              />
              <span className={cn('dshx:flex-none dshx:text-xs dshx:font-medium dshx:tabular-nums', send.status === 'failed' && 'dshx:text-destructive')}>
                {send.status === 'failed' ? 'Not sent' : send.status === 'sending' ? 'Sending…' : SendTime.label(send.sendAt, now)}
              </span>
              {send.model === undefined ? null : (
                <Badge variant="muted" className="dshx:flex-none dshx:font-normal dshx:@max-pane-narrow:hidden" data-scheduled-model="">
                  {send.model.model}
                  {send.model.reasoningEffort === undefined ? '' : ` · ${send.model.reasoningEffort}`}
                </Badge>
              )}
              <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:text-sm">{send.text}</span>
              {send.note === undefined ? null : <span className="dshx:sr-only">{send.note}</span>}
              <div className="dshx:flex dshx:flex-none dshx:items-center dshx:gap-0.5 dshx:opacity-60 dshx:transition-opacity dshx:group-hover/row:opacity-100 dshx:focus-within:opacity-100 dshx:pointer-coarse:opacity-100">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="dshx:pointer-coarse:size-touch"
                  aria-label="Edit scheduled message"
                  disabled={send.status === 'sending'}
                  onClick={() => setEditing(send)}
                >
                  <PencilIcon />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="dshx:pointer-coarse:size-touch"
                  aria-label="Send now"
                  disabled={send.status === 'sending' || sendNow.isPending}
                  onClick={() => sendNow.mutate(send.id)}
                >
                  <SendIcon />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="dshx:pointer-coarse:size-touch"
                  aria-label="Cancel scheduled message"
                  disabled={send.status === 'sending' || cancel.isPending}
                  onClick={() => cancel.mutate(send.id)}
                >
                  <XIcon />
                </Button>
              </div>
            </li>
          ))}
        </ul>
        {rows.some(send => send.note !== undefined) ? (
          <p className="dshx:border-t dshx:px-3 dshx:py-1 dshx:text-xs dshx:text-muted-foreground">{rows.find(send => send.note !== undefined)?.note}</p>
        ) : null}
        <p className="dshx:border-t dshx:px-3 dshx:py-1 dshx:text-xs dshx:text-destructive dshx:empty:hidden" role="status" aria-live="polite">
          {notice}
        </p>
      </div>
      {editing === null ? null : <ScheduledSendDialog send={editing} loadModels={props.loadModels} onClose={() => setEditing(null)} />}
    </section>
  )
}
