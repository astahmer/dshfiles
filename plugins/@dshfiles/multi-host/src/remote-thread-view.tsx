import { useApi } from '@dshfiles/dshx/client'
import { Alert, AlertDescription } from '@dshfiles/plugin-ui/components/ui/alert'
import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import { Textarea } from '@dshfiles/plugin-ui/components/ui/textarea'
import { ArrowUpIcon, ExternalLinkIcon, RefreshCwIcon, ServerIcon, SquareIcon, WrenchIcon } from '@dshfiles/plugin-ui/icons'
import { errorMessage, useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { useEffect, useRef, useState } from 'react'
import { multiHostApi, type TranscriptEntry } from './api.js'
import { multiHostKeys, multiHostQueries } from './destination/queries.js'
import { openRemoteThread, openRemoteThreadRef } from './destination/state.js'

const EntryView = (props: { readonly entry: TranscriptEntry }) => {
  const { entry } = props
  if (entry.kind === 'user')
    return (
      <div className="dshx:ml-auto dshx:max-w-[85%] dshx:whitespace-pre-wrap dshx:rounded-2xl dshx:bg-muted dshx:px-4 dshx:py-2 dshx:text-sm">{entry.text}</div>
    )
  if (entry.kind === 'tool')
    return (
      <details className="dshx:text-xs dshx:text-muted-foreground">
        <summary className="dshx:flex dshx:cursor-pointer dshx:items-center dshx:gap-1.5">
          <WrenchIcon className="dshx:size-3" />
          <span className="dshx:truncate dshx:font-mono">{entry.text.split('\n', 1)[0]}</span>
        </summary>
        <pre className="dshx:mt-1 dshx:max-h-60 dshx:overflow-auto dshx:whitespace-pre-wrap dshx:rounded-md dshx:bg-muted/60 dshx:p-2">
          {entry.text.split('\n').slice(1).join('\n') || '(no output)'}
        </pre>
      </details>
    )
  if (entry.kind === 'status') return <p className="dshx:text-xs dshx:text-muted-foreground">{entry.text}</p>
  return <div className="dshx:whitespace-pre-wrap dshx:text-sm dshx:leading-relaxed">{entry.text}</div>
}

/**
 * A thread that runs on another host, shown in the local `main` area. Stock DSH binds the browser to one runtime, so
 * the native transcript cannot render a remote Session; this view polls the remote history (fast while a turn runs),
 * sends replies and cancels there, and links to the host's own DSH UI for everything else.
 */
export const RemoteThreadView = () => {
  const api = useApi(multiHostApi)
  const queryClient = useQueryClient()
  const ref = openRemoteThreadRef.useValue()
  const [reply, setReply] = useState('')
  const bottom = useRef<HTMLDivElement>(null)
  const threads = useQuery({ queryKey: multiHostKeys.threads, queryFn: ({ signal }) => api.threadList(undefined, { signal }), refetchInterval: 15_000 })
  const directory = useQuery(multiHostQueries.directory(api))
  const transcript = useQuery({
    queryKey: multiHostKeys.transcript(ref?.runtimeId ?? '', ref?.sessionId ?? ''),
    enabled: ref !== null,
    // A failed poll throws so the last good transcript stays on screen under the error.
    queryFn: async ({ signal }) => {
      const result = await api.threadTranscript({ runtimeId: ref?.runtimeId ?? '', sessionId: ref?.sessionId ?? '' }, { signal })
      if (!result.ok) throw new Error(result.message)
      return result
    },
    refetchInterval: query => (query.state.data?.running === true && query.state.error === null ? 1_500 : 8_000),
    retry: false,
  })
  const data = transcript.data
  const failure = transcript.isError ? { message: errorMessage(transcript.error, 'The host did not answer.') } : undefined
  const thread = threads.data?.threads.find(item => item.runtimeId === ref?.runtimeId && item.sessionId === ref?.sessionId)
  const hostName = thread?.hostName ?? directory.data?.runtimes.find(runtime => runtime.id === ref?.runtimeId)?.name ?? 'Remote host'
  const entryCount = data?.entries.length ?? 0

  useEffect(() => {
    // scrollIntoView can return a Promise; returning it would become the effect cleanup.
    bottom.current?.scrollIntoView({ block: 'end' })
  }, [entryCount, data?.running])

  const refresh = (): void => void queryClient.invalidateQueries({ queryKey: multiHostKeys.transcript(ref?.runtimeId ?? '', ref?.sessionId ?? '') })
  const send = useMutation({
    mutationFn: async () => {
      if (ref === null) return
      const result = await api.runtimeCall({
        runtimeId: ref.runtimeId,
        request: {
          namespace: 'session',
          method: 'prompt',
          args: {
            request: {
              requestId: crypto.randomUUID(),
              sessionId: ref.sessionId,
              mode: data?.running === true ? 'steer' : 'queue',
              content: [{ type: 'text', text: reply.trim() }],
            },
          },
        },
      })
      if (!result.ok)
        throw new Error(
          result.code === 'unknown-mutation-outcome' ? 'The connection dropped after sending; check the thread before sending again.' : result.message,
        )
    },
    onSuccess: () => {
      setReply('')
      refresh()
    },
  })
  const cancel = useMutation({
    mutationFn: async () => {
      if (ref === null) return
      const result = await api.runtimeCall({
        runtimeId: ref.runtimeId,
        request: { namespace: 'session', method: 'cancel', args: { request: { sessionId: ref.sessionId } } },
      })
      if (!result.ok) throw new Error(result.message)
    },
    onSettled: refresh,
  })
  const openHostUi = useMutation({
    mutationFn: async () => {
      if (ref === null) return
      const view = await api.runtimeOpenView({ runtimeId: ref.runtimeId })
      globalThis.open?.(view.launchUrl, '_blank', 'noopener')
    },
  })
  const reconnect = useMutation({
    mutationFn: () => api.runtimeReconnect({ runtimeId: ref?.runtimeId ?? '' }),
    onSettled: refresh,
  })

  if (ref === null)
    return (
      <div className="dshx-root dshx:flex dshx:h-full dshx:flex-col dshx:gap-3 dshx:overflow-auto dshx:p-6">
        <h2 className="dshx:text-sm dshx:font-semibold">Remote threads</h2>
        {(threads.data?.threads ?? []).length === 0 ? (
          <p className="dshx:text-sm dshx:text-muted-foreground">Pick a host in the New thread bar and send a message to start one.</p>
        ) : null}
        {[...(threads.data?.threads ?? [])].reverse().map(item => (
          <button
            key={item.runtimeId + item.sessionId}
            type="button"
            className="dshx:flex dshx:items-center dshx:gap-2 dshx:rounded-md dshx:border dshx:p-2 dshx:text-left dshx:text-sm dshx:hover:bg-accent"
            onClick={() => openRemoteThread({ runtimeId: item.runtimeId, sessionId: item.sessionId })}
          >
            <ServerIcon className="dshx:size-3.5" />
            <span className="dshx:flex-1 dshx:truncate">{item.title}</span>
            <Badge variant="outline">{item.hostName}</Badge>
          </button>
        ))}
      </div>
    )

  return (
    <div className="dshx-root dshx:flex dshx:h-full dshx:min-h-0 dshx:flex-col" data-remote-thread={ref.sessionId}>
      <header className="dshx:flex dshx:items-center dshx:gap-2 dshx:border-b dshx:px-4 dshx:py-2">
        <Badge variant="secondary" className="dshx:gap-1">
          <ServerIcon className="dshx:size-3" />
          {hostName}
        </Badge>
        <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:text-sm dshx:font-medium">{data?.title ?? thread?.title ?? 'Remote thread'}</span>
        {data?.running === true ? (
          <Badge variant="outline" className="dshx:gap-1">
            <Spinner className="dshx:size-3" />
            Working
          </Badge>
        ) : null}
        {data?.model === undefined ? null : <span className="dshx:text-xs dshx:text-muted-foreground">{data.model.model}</span>}
        <Button
          size="sm"
          variant="ghost"
          className="dshx:h-7"
          disabled={openHostUi.isPending}
          onClick={() => openHostUi.mutate()}
          title="Open this host's DSH in a new tab"
        >
          <ExternalLinkIcon className="dshx:size-3.5" />
          Host UI
        </Button>
      </header>
      {data?.cwd === undefined && thread?.cwd === undefined ? null : (
        <p className="dshx:border-b dshx:px-4 dshx:py-1 dshx:font-mono dshx:text-xs dshx:text-muted-foreground">{data?.cwd ?? thread?.cwd}</p>
      )}
      <div className="dshx:flex dshx:min-h-0 dshx:flex-1 dshx:flex-col dshx:gap-3 dshx:overflow-auto dshx:px-6 dshx:py-4" aria-live="polite">
        {transcript.isLoading ? <Spinner className="dshx:size-4" /> : null}
        {failure !== undefined ? (
          <Alert variant="destructive">
            <AlertDescription className="dshx:flex dshx:items-center dshx:gap-2">
              <span className="dshx:flex-1">
                {hostName} is unavailable: {failure.message} The thread keeps running there; this view resumes when the host is back.
              </span>
              <Button size="sm" variant="outline" disabled={reconnect.isPending} onClick={() => reconnect.mutate()}>
                <RefreshCwIcon className="dshx:size-3.5" />
                Reconnect
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}
        {(data?.entries ?? []).map(entry => (
          <EntryView key={`${entry.seq}-${entry.kind}`} entry={entry} />
        ))}
        <div ref={bottom} />
      </div>
      <div className="dshx:border-t dshx:p-3">
        {send.isError || cancel.isError || openHostUi.isError ? (
          <p className="dshx:mb-2 dshx:text-xs dshx:text-destructive">
            {errorMessage(send.error ?? cancel.error ?? openHostUi.error, 'The host refused the request.')}
          </p>
        ) : null}
        <div className="dshx:flex dshx:items-end dshx:gap-2">
          <Textarea
            aria-label={`Reply on ${hostName}`}
            placeholder={failure === undefined ? `Reply on ${hostName}…` : `${hostName} is offline`}
            className="dshx:min-h-12 dshx:flex-1 dshx:resize-none"
            value={reply}
            disabled={failure !== undefined}
            onChange={event => setReply(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && reply.trim() !== '') {
                event.preventDefault()
                send.mutate()
              }
            }}
          />
          {data?.running === true ? (
            <Button size="icon" variant="outline" aria-label="Stop" disabled={cancel.isPending} onClick={() => cancel.mutate()}>
              <SquareIcon className="dshx:size-4" />
            </Button>
          ) : null}
          <Button size="icon" aria-label="Send reply" disabled={reply.trim() === '' || send.isPending || failure !== undefined} onClick={() => send.mutate()}>
            {send.isPending ? <Spinner className="dshx:size-4" /> : <ArrowUpIcon className="dshx:size-4" />}
          </Button>
        </div>
      </div>
    </div>
  )
}
