import { useApi } from '@dshfiles/dshx/client'
import { Popover, PopoverAnchor, PopoverContent, PopoverHeader, PopoverTitle } from '@dshfiles/plugin-ui/components/ui/popover'
import { errorMessage, useQuery } from '@dshfiles/plugin-ui/query'
import { useEffect, useRef, useState } from 'react'
import { jujutsuApi } from './api.js'
import {
  chatReferencePreviewDismissEvent,
  chatReferencePreviewEvent,
  chatReferencePreviewRequestSchema,
  chatReferenceTitleRequestEvent,
  chatReferenceTitleRequestSchema,
  chatReferenceTitleResolvedEvent,
  type ChatReferencePreviewRequest,
  type ChatReferenceTitleRequest,
} from './chat-reference.js'

/** Moving the pointer from a reference into the card must not close it, so leaving waits out a short grace. */
const CLOSE_GRACE_MS = 140

const titleRequestKey = (request: ChatReferenceTitleRequest): string =>
  `${request.sessionId}\u0000${request.cwd}\u0000${request.reference.kind}\u0000${request.reference.value}`

/**
 * The revision-graph preview for a `jj:` reference in chat. The reference itself is a native `<code>` node this plugin
 * decorated, so the request arrives as a window event carrying the card's anchor; one overlay serves every message.
 */
export const ChatReferenceOverlay = (): JSX.Element | null => {
  const api = useApi(jujutsuApi)
  const [request, setRequest] = useState<ChatReferencePreviewRequest | null>(null)
  const [titleRequests, setTitleRequests] = useState<ChatReferenceTitleRequest[]>([])
  const closeTimer = useRef<number | undefined>(undefined)

  useEffect(() => {
    const cancelClose = (): void => {
      if (closeTimer.current === undefined) return
      window.clearTimeout(closeTimer.current)
      closeTimer.current = undefined
    }
    const open = (event: Event): void => {
      if (!(event instanceof CustomEvent)) return
      const parsed = chatReferencePreviewRequestSchema.safeParse(event.detail)
      if (!parsed.success) return
      cancelClose()
      setRequest(parsed.data)
    }
    const queueTitle = (event: Event): void => {
      if (!(event instanceof CustomEvent)) return
      const parsed = chatReferenceTitleRequestSchema.safeParse(event.detail)
      if (!parsed.success) return
      setTitleRequests(current => (current.some(request => titleRequestKey(request) === titleRequestKey(parsed.data)) ? current : [...current, parsed.data]))
    }
    const dismiss = (): void => {
      cancelClose()
      closeTimer.current = window.setTimeout(() => {
        closeTimer.current = undefined
        setRequest(null)
      }, CLOSE_GRACE_MS)
    }
    const closeOnScroll = (event: Event): void => {
      if (event.target instanceof Element && event.target.closest('[data-dshfiles-jj-preview]') !== null) return
      setRequest(null)
    }
    const close = (): void => setRequest(null)
    window.addEventListener(chatReferencePreviewEvent, open)
    window.addEventListener(chatReferenceTitleRequestEvent, queueTitle)
    window.addEventListener(chatReferencePreviewDismissEvent, dismiss)
    window.addEventListener('scroll', closeOnScroll, true)
    window.addEventListener('resize', close)
    return () => {
      if (closeTimer.current !== undefined) window.clearTimeout(closeTimer.current)
      window.removeEventListener(chatReferencePreviewEvent, open)
      window.removeEventListener(chatReferenceTitleRequestEvent, queueTitle)
      window.removeEventListener(chatReferencePreviewDismissEvent, dismiss)
      window.removeEventListener('scroll', closeOnScroll, true)
      window.removeEventListener('resize', close)
    }
  }, [])

  const referenced = request?.reference.value
  const repository = useQuery({
    queryKey: ['jujutsu', 'reference-preview-repository', request?.cwd],
    enabled: request !== null,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: ({ signal }) => api.registerRepository({ path: request?.cwd ?? '' }, { signal }),
  })
  const repoId = repository.data?.repoId
  const graph = useQuery({
    queryKey: ['jujutsu', 'reference-preview-graph', repoId, referenced],
    enabled: repoId !== undefined && referenced !== undefined,
    retry: false,
    queryFn: ({ signal }) => api.referenceGraph({ repoId: repoId ?? '', reference: referenced ?? '' }, { signal }),
  })
  const titleRequest = titleRequests.at(0) ?? null
  const titleRepository = useQuery({
    queryKey: ['jujutsu', 'reference-preview-repository', titleRequest?.cwd],
    enabled: titleRequest !== null,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: ({ signal }) => api.registerRepository({ path: titleRequest?.cwd ?? '' }, { signal }),
  })
  const titleRepoId = titleRepository.data?.repoId
  const titleReference = titleRequest?.reference.value
  const titleGraph = useQuery({
    queryKey: ['jujutsu', 'reference-preview-graph', titleRepoId, titleReference],
    enabled: titleRepoId !== undefined && titleReference !== undefined,
    retry: false,
    queryFn: ({ signal }) => api.referenceGraph({ repoId: titleRepoId ?? '', reference: titleReference ?? '' }, { signal }),
  })

  useEffect(() => {
    if (titleRequest === null) return
    const output = titleGraph.data
    const settled = titleRepository.isError || titleGraph.isError || (titleGraph.isSuccess && !titleGraph.isFetching)
    if (!settled) return
    if (
      output !== undefined &&
      'graph' in output &&
      output.label === titleRequest.reference.value &&
      output.description !== undefined &&
      output.description.trim().length > 0
    ) {
      window.dispatchEvent(new CustomEvent(chatReferenceTitleResolvedEvent, { detail: { ...titleRequest, title: output.description } }))
    }
    const completedKey = titleRequestKey(titleRequest)
    setTitleRequests(current => (current[0] !== undefined && titleRequestKey(current[0]) === completedKey ? current.slice(1) : current))
  }, [titleGraph.data, titleGraph.isError, titleGraph.isFetching, titleGraph.isSuccess, titleRepository.isError, titleRequest])

  if (request === null) return null
  const referenceGraph = graph.data !== undefined && 'graph' in graph.data ? graph.data : undefined
  const failure = graph.data !== undefined && 'failure' in graph.data ? graph.data.failure.message : undefined
  const rendered = referenceGraph?.graph
  return (
    <Popover open onOpenChange={open => !open && setRequest(null)}>
      <PopoverAnchor asChild>
        <span
          aria-hidden
          style={{
            position: 'fixed',
            display: 'block',
            left: request.anchor.left,
            top: request.anchor.top,
            width: Math.max(1, request.anchor.width),
            height: Math.max(1, request.anchor.height),
            pointerEvents: 'none',
          }}
        />
      </PopoverAnchor>
      <PopoverContent
        align="start"
        className="dshx-root dshx:w-[34rem] dshx:max-w-[calc(100vw-1rem)]"
        data-dshfiles-jj-preview
        onPointerEnter={() => {
          if (closeTimer.current === undefined) return
          window.clearTimeout(closeTimer.current)
          closeTimer.current = undefined
        }}
        onPointerLeave={() => setRequest(null)}
        side="bottom"
        sideOffset={6}
      >
        <PopoverHeader>
          <PopoverTitle>Revision graph · {request.reference.value}</PopoverTitle>
        </PopoverHeader>
        {referenceGraph === undefined ? null : (
          <div className="dshx:flex dshx:flex-wrap dshx:gap-x-3 dshx:text-xs dshx:text-muted-foreground">
            {referenceGraph.commitId === null ? null : (
              <span>
                Commit ID: <code title={referenceGraph.commitId}>{referenceGraph.commitId.slice(0, 8)}</code>
              </span>
            )}
            {referenceGraph.changeId === null ? null : (
              <span>
                Change ID: <code>{referenceGraph.changeId}</code>
              </span>
            )}
          </div>
        )}
        {graph.isPending || repository.isPending ? <p className="dshx:text-xs dshx:text-muted-foreground">Reading revisions…</p> : null}
        {graph.isError ? (
          <p className="dshx:text-xs dshx:text-destructive" role="alert">
            {errorMessage(graph.error, 'That reference could not be read.')}
          </p>
        ) : null}
        {failure === undefined ? null : (
          <p className="dshx:text-xs dshx:text-destructive" role="alert">
            {failure}
          </p>
        )}
        {rendered === undefined ? null : (
          <pre aria-label="Revision graph" className="dshx:max-h-72 dshx:overflow-auto dshx:font-mono dshx:text-xs dshx:leading-4">
            {rendered}
          </pre>
        )}
      </PopoverContent>
    </Popover>
  )
}
