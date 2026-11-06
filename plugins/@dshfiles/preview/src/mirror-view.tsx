import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useApi, useApiEvent } from '@dshfiles/dshx/client'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { EmptyState } from '@dshfiles/plugin-ui/components/page'
import { RotateCwIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { errorMessage, useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { previewApi } from './api.js'
import { DevServerPoll } from './dev-server-poll.js'
import { MirrorGestures, type MirrorGesture } from './mirror-gestures.js'

/** About two frames a second while someone watches; a still page costs only a hash per round. */
const FRAME_INTERVAL_MS = 500

const subscribeVisibility = (listener: () => void): (() => void) => {
  document.addEventListener('visibilitychange', listener)
  return () => document.removeEventListener('visibilitychange', listener)
}
const documentVisible = (): boolean => document.visibilityState === 'visible'

interface ShownFrame {
  readonly hash: string
  readonly src: string
  readonly width: number
  readonly height: number
}

/**
 * The page the thread's agent drives, mirrored from the Host's headless Chromium: frames poll only while the tab and
 * the browser window are visible, and clicks, scrolls and keys go back to that same page.
 */
export const MirrorView = (props: { readonly sessionId: string; readonly pageId: string | undefined; readonly visible: boolean }): JSX.Element => {
  const api = useApi(previewApi)
  const queryClient = useQueryClient()
  const pagesKey = useMemo(() => DevServerPoll.pagesKey(props.sessionId), [props.sessionId])
  useApiEvent(previewApi, 'pagesChanged', payload => {
    if (payload.sessionId === props.sessionId) void queryClient.invalidateQueries({ queryKey: pagesKey })
  })
  const pagesQuery = useQuery({ queryKey: pagesKey, queryFn: ({ signal }) => api.list({ sessionId: props.sessionId }, { signal }), retry: false })
  const pages = pagesQuery.data?.pages ?? []
  const [chosen, setChosen] = useState<string | undefined>(props.pageId)
  const pageId = pages.some(page => page.pageId === chosen) ? chosen : pages[0]?.pageId

  const windowVisible = useSyncExternalStore(subscribeVisibility, documentVisible, documentVisible)
  const shown = useRef<ShownFrame | undefined>(undefined)
  const frameQuery = useQuery({
    queryKey: ['dshfiles-preview', 'mirror', props.sessionId, pageId ?? ''],
    enabled: pageId !== undefined,
    queryFn: async ({ signal }): Promise<ShownFrame & { readonly url: string; readonly title: string }> => {
      const previous = shown.current
      const page = { sessionId: props.sessionId, pageId: pageId ?? '' }
      const frame = await api.mirrorFrame(previous === undefined ? page : { ...page, knownHash: previous.hash }, { signal })
      const next: ShownFrame =
        frame.image === null && previous !== undefined
          ? previous
          : { hash: frame.hash, src: `data:image/jpeg;base64,${frame.image ?? ''}`, width: frame.width, height: frame.height }
      shown.current = next
      return { ...next, url: frame.url, title: frame.title }
    },
    refetchInterval: props.visible && windowVisible ? FRAME_INTERVAL_MS : false,
    refetchIntervalInBackground: false,
    retry: false,
  })
  useEffect(() => {
    shown.current = undefined
  }, [props.sessionId, pageId])

  const send = useMutation({
    mutationFn: (gesture: MirrorGesture) => api.mirrorInput({ sessionId: props.sessionId, pageId: pageId ?? '', gesture }),
    onSettled: () => void frameQuery.refetch(),
  })
  const reload = useMutation({
    mutationFn: () => api.navigate({ sessionId: props.sessionId, pageId: pageId ?? '', action: 'reload' }),
    onSettled: () => void frameQuery.refetch(),
  })

  if (pageId === undefined)
    return (
      <EmptyState className="dshx:m-3 dshx:rounded-lg dshx:border dshx:border-border">
        {pagesQuery.isPending ? 'Looking for the agent’s pages…' : 'The agent has no browser page open in this thread.'}
      </EmptyState>
    )

  const frame = frameQuery.data
  const pointOf = (event: { readonly clientX: number; readonly clientY: number; readonly currentTarget: HTMLImageElement }) => {
    const box = event.currentTarget.getBoundingClientRect()
    return MirrorGestures.point({
      offsetX: event.clientX - box.left,
      offsetY: event.clientY - box.top,
      shownWidth: box.width,
      shownHeight: box.height,
      frameWidth: frame?.width ?? 0,
      frameHeight: frame?.height ?? 0,
    })
  }

  return (
    <div className="dshx-root dshx:flex dshx:h-full dshx:min-h-0 dshx:flex-col dshx:gap-2 dshx:p-2" data-preview-mirror={pageId}>
      <div className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-1">
        {pages.length > 1
          ? pages.map(page => (
              <Button key={page.pageId} variant={page.pageId === pageId ? 'secondary' : 'ghost'} size="xs" onClick={() => setChosen(page.pageId)}>
                {page.pageId}
              </Button>
            ))
          : null}
        <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:font-mono! dshx:text-xs dshx:text-muted-foreground">{frame?.url ?? ''}</span>
        <Button variant="ghost" size="icon-xs" aria-label="Reload page" disabled={reload.isPending} onClick={() => reload.mutate()}>
          <RotateCwIcon />
        </Button>
      </div>
      {frameQuery.isError ? (
        <p className="dshx:text-xs dshx:text-destructive">
          {errorMessage(frameQuery.error, 'The page could not be captured.')} It may have closed; ask the agent to reopen it.
        </p>
      ) : null}
      {send.isError ? <p className="dshx:text-xs dshx:text-destructive">{errorMessage(send.error, 'That input did not reach the page.')} Try again.</p> : null}
      <div className="dshx:min-h-0 dshx:flex-1 dshx:overflow-auto">
        {frame === undefined ? null : (
          <img
            alt={frame.title === '' ? 'Agent browser page' : frame.title}
            className={cn(
              'dshx:block dshx:w-full dshx:rounded-md dshx:border dshx:border-border dshx:outline-none dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring',
              send.isPending && 'dshx:cursor-progress',
            )}
            src={frame.src}
            tabIndex={0}
            draggable={false}
            onClick={event => {
              event.currentTarget.focus()
              send.mutate({ kind: 'click', ...pointOf(event) })
            }}
            onWheel={event => {
              // One scroll in flight at a time: a trackpad fires dozens of wheel events a second.
              if (!send.isPending) send.mutate({ kind: 'wheel', ...pointOf(event), deltaY: event.deltaY })
            }}
            onKeyDown={event => {
              const gesture = MirrorGestures.fromKey(event)
              if (gesture === undefined) return
              event.preventDefault()
              send.mutate(gesture)
            }}
          />
        )}
      </div>
    </div>
  )
}
