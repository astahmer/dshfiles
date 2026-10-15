import { Alert, AlertDescription } from '@dshfiles/plugin-ui/components/ui/alert'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@dshfiles/plugin-ui/components/ui/select'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import { Textarea } from '@dshfiles/plugin-ui/components/ui/textarea'
import { ArrowUpIcon, RefreshCwIcon, ServerIcon } from '@dshfiles/plugin-ui/icons'
import { errorMessage, useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { useState } from 'react'
import { multiHostKeys, multiHostQueries, type MultiHostClient } from './queries.js'
import { openRemoteThread, type RemoteThreadRef } from './state.js'

const modelKey = (selection: { readonly provider: string; readonly model: string }): string => `${selection.provider}\u0000${selection.model}`

/**
 * Stands in for the composer of a blank thread whose host is remote: the native composer would create a Session in
 * this runtime, so the first message goes to the chosen host instead and the remote thread view opens.
 */
export const RemoteComposer = (props: {
  readonly api: MultiHostClient
  readonly runtimeId: string
  readonly hostName: string
  /** Folder on the host the thread runs in; the composer stays inert until one is chosen. */
  readonly cwd: string | undefined
  /** Resolves the final folder right before sending, e.g. to create an isolated jj workspace on the host. */
  readonly prepareCwd?: () => Promise<string>
  readonly onStarted: (ref: RemoteThreadRef) => void
  readonly onRequestFolder?: () => void
}) => {
  const { api } = props
  const queryClient = useQueryClient()
  const [text, setText] = useState('')
  const [model, setModel] = useState<string | null>(null)
  const models = useQuery(multiHostQueries.models(api, props.runtimeId))
  const catalog = models.data?.ok === true ? models.data : undefined
  const effectiveModel = model ?? (catalog?.default === null || catalog?.default === undefined ? null : modelKey(catalog.default))
  const reconnect = useMutation({
    mutationFn: () => api.runtimeReconnect({ runtimeId: props.runtimeId }),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: multiHostKeys.all }),
  })
  const start = useMutation({
    mutationFn: async () => {
      const cwd = props.prepareCwd === undefined ? props.cwd : await props.prepareCwd()
      if (cwd === undefined) throw new Error('Choose a folder on this host first.')
      const [provider, modelId] = effectiveModel?.split('\u0000') ?? []
      const result = await api.threadStart({
        runtimeId: props.runtimeId,
        cwd,
        text: text.trim(),
        ...(provider === undefined || modelId === undefined ? {} : { model: { provider, model: modelId } }),
      })
      if (!result.ok) {
        if (result.sessionId !== undefined) openRemoteThread({ runtimeId: props.runtimeId, sessionId: result.sessionId })
        throw new Error(
          result.code === 'unknown-mutation-outcome'
            ? 'The connection dropped after the message was sent. Check the thread list before sending again.'
            : `${result.message} (${result.code})`,
        )
      }
      return { runtimeId: props.runtimeId, sessionId: result.sessionId }
    },
    onSuccess: ref => {
      setText('')
      void queryClient.invalidateQueries({ queryKey: multiHostKeys.threads })
      openRemoteThread(ref)
      props.onStarted(ref)
    },
  })
  const offline = models.data?.ok === false ? models.data : undefined
  const canSend = text.trim() !== '' && props.cwd !== undefined && !start.isPending && offline === undefined

  return (
    <div
      className="dshx-root dshx:flex dshx:w-full dshx:flex-col dshx:gap-2 dshx:rounded-2xl dshx:border dshx:bg-card dshx:p-3 dshx:shadow-sm"
      data-remote-composer=""
    >
      <Textarea
        aria-label={`Message for ${props.hostName}`}
        placeholder={props.cwd === undefined ? `Choose a folder on ${props.hostName} to start` : `Message the agent on ${props.hostName}…`}
        className="dshx:min-h-20 dshx:resize-none dshx:border-0 dshx:bg-transparent dshx:shadow-none dshx:focus-visible:ring-0"
        value={text}
        onChange={event => setText(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault()
            if (canSend) start.mutate()
          }
        }}
      />
      {offline !== undefined ? (
        <Alert variant="destructive">
          <AlertDescription className="dshx:flex dshx:items-center dshx:gap-2">
            <span className="dshx:flex-1">
              {props.hostName} is not reachable: {offline.message} Messages are not sent while it is offline.
            </span>
            <Button size="sm" variant="outline" disabled={reconnect.isPending} onClick={() => reconnect.mutate()}>
              {reconnect.isPending ? <Spinner className="dshx:size-3.5" /> : <RefreshCwIcon className="dshx:size-3.5" />}
              Reconnect
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {start.isError ? (
        <Alert variant="destructive">
          <AlertDescription>{errorMessage(start.error, 'The thread could not start on this host.')}</AlertDescription>
        </Alert>
      ) : null}
      <div className="dshx:flex dshx:items-center dshx:gap-2">
        <span className="dshx:inline-flex dshx:items-center dshx:gap-1 dshx:text-xs dshx:text-muted-foreground">
          <ServerIcon className="dshx:size-3.5" />
          {props.hostName}
          {props.cwd === undefined ? null : <span className="dshx:max-w-64 dshx:truncate dshx:font-mono">· {props.cwd}</span>}
        </span>
        {props.cwd === undefined && props.onRequestFolder !== undefined ? (
          <Button size="sm" variant="outline" className="dshx:h-7" onClick={props.onRequestFolder}>
            Choose folder
          </Button>
        ) : null}
        <span className="dshx:ml-auto" />
        {catalog === undefined ? (
          models.isLoading ? (
            <Spinner className="dshx:size-3.5" />
          ) : null
        ) : (
          <Select value={effectiveModel ?? ''} onValueChange={setModel}>
            <SelectTrigger size="sm" className="dshx:h-7 dshx:max-w-56 dshx:text-xs" aria-label="Model on this host">
              <SelectValue placeholder="Model" />
            </SelectTrigger>
            <SelectContent className="dshx-root">
              {catalog.groups.map(group => (
                <SelectGroup key={group.id}>
                  <SelectLabel>{group.name}</SelectLabel>
                  {group.models.map(entry => (
                    <SelectItem key={entry.id} value={modelKey({ provider: group.id, model: entry.id })}>
                      {entry.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        )}
        <Button
          size="icon"
          className="dshx:size-8 dshx:rounded-full"
          aria-label={`Start on ${props.hostName}`}
          disabled={!canSend}
          onClick={() => start.mutate()}
        >
          {start.isPending ? <Spinner className="dshx:size-4" /> : <ArrowUpIcon className="dshx:size-4" />}
        </Button>
      </div>
    </div>
  )
}
