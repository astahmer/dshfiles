import { ReferenceChip } from '@deepseek-ai/dsh-client-ui-primitives'
import { useApi } from '@dshfiles/dshx/client'
import { jjIntegrationApi } from '@dshfiles/jj-integration/api'
import { Popover, PopoverAnchor, PopoverContent, PopoverHeader, PopoverTitle } from '@dshfiles/plugin-ui/components/ui/popover'
import { useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { useEffect, useRef, useState } from 'react'
import { jujutsuApi } from './api.js'
import { ChatReferenceModel, chatReferenceQueryKeys } from './chat-reference.js'
import { ReferenceGraphView } from './reference-graph-view.js'
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
 * The revision-graph preview for a `jj:` reference in chat. A native session-reference chip lives inside its code node;
 * the request arrives as a window event carrying the chip's anchor, so one overlay serves every message.
 */
export const ChatReferenceOverlay = (): JSX.Element => {
  const api = useApi(jujutsuApi)
  const jjIntegration = useApi(jjIntegrationApi)
  const queryClient = useQueryClient()
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

  const titleRequest = titleRequests.at(0) ?? null
  const referenced = request?.reference.value
  const titleReference = titleRequest?.reference.value
  const resolveReference = async (cwd: string, reference: string, signal: AbortSignal) => {
    const read = async (path: string) => {
      try {
        const repository = await queryClient.fetchQuery({
          queryKey: chatReferenceQueryKeys.repository(path),
          queryFn: ({ signal: querySignal }) => api.registerRepository({ path }, { signal: querySignal }),
          staleTime: 30_000,
        })
        const graph = await api.referenceGraph({ repoId: repository.repoId, reference }, { signal })
        return 'graph' in graph ? { repository, graph } : undefined
      } catch {
        return undefined
      }
    }
    const local = await read(cwd)
    if (local !== undefined) return [local]
    const projects = await queryClient.fetchQuery({
      queryKey: chatReferenceQueryKeys.projects,
      queryFn: ({ signal: querySignal }) => jjIntegration.projects({}, { signal: querySignal }),
      staleTime: 30_000,
    })
    const paths = [...projects.projects, ...(projects.workspaces ?? [])].map(project => project.path)
    const repositories = await Promise.all(
      [...new Set(paths)].slice(0, 31).map(async path => {
        try {
          return {
            path,
            repository: await queryClient.fetchQuery({
              queryKey: chatReferenceQueryKeys.repository(path),
              queryFn: ({ signal: querySignal }) => api.registerRepository({ path }, { signal: querySignal }),
              staleTime: 30_000,
            }),
          }
        } catch {
          return undefined
        }
      }),
    )
    const repositoryIds = new Set<string>()
    const candidates = repositories.flatMap(candidate => {
      if (candidate === undefined || repositoryIds.has(candidate.repository.repoId)) return []
      repositoryIds.add(candidate.repository.repoId)
      return [candidate]
    })
    const matches = await Promise.all(
      candidates.map(async candidate => {
        try {
          const graph = await api.referenceGraph({ repoId: candidate.repository.repoId, reference }, { signal })
          return 'graph' in graph ? { repository: candidate.repository, graph } : undefined
        } catch {
          return undefined
        }
      }),
    )
    return matches.filter(match => match !== undefined)
  }
  const graph = useQuery({
    queryKey: chatReferenceQueryKeys.search(request?.cwd ?? '', referenced ?? ''),
    enabled: request !== null && referenced !== undefined,
    retry: false,
    staleTime: 30_000,
    queryFn: ({ signal }) => resolveReference(request?.cwd ?? '', referenced ?? '', signal),
  })
  const titleGraph = useQuery({
    queryKey: chatReferenceQueryKeys.search(titleRequest?.cwd ?? '', titleReference ?? ''),
    enabled: titleRequest !== null && titleReference !== undefined,
    retry: false,
    staleTime: 30_000,
    queryFn: ({ signal }) => resolveReference(titleRequest?.cwd ?? '', titleReference ?? '', signal),
  })

  useEffect(() => {
    if (titleRequest === null || titleGraph.isFetching || (!titleGraph.isSuccess && !titleGraph.isError)) return
    const matches = titleGraph.data ?? []
    const match = ChatReferenceModel.uniqueMatch(matches)
    window.dispatchEvent(
      new CustomEvent(chatReferenceTitleResolvedEvent, {
        detail: {
          ...titleRequest,
          title: match?.graph.description?.trim() || titleRequest.reference.value,
          targetPath: match?.repository.root ?? null,
        },
      }),
    )
    const completedKey = titleRequestKey(titleRequest)
    setTitleRequests(current => (current[0] !== undefined && titleRequestKey(current[0]) === completedKey ? current.slice(1) : current))
  }, [titleGraph.data, titleGraph.isError, titleGraph.isFetching, titleGraph.isSuccess, titleRequest])

  const matches = graph.data ?? []
  const referenceGraph = ChatReferenceModel.uniqueMatch(matches)?.graph
  const failure = matches.length > 1 ? 'This reference exists in multiple registered repositories, so it cannot be selected unambiguously.' : undefined
  const rendered = referenceGraph?.graph
  return (
    <>
      <span aria-hidden="true" data-composer-card data-dshfiles-jj-reference-template hidden>
        <ReferenceChip appearance="session" label="Jujutsu reference" title="Jujutsu reference" />
      </span>
      {request === null ? null : (
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
            {graph.isPending ? <p className="dshx:text-xs dshx:text-muted-foreground">Reading revisions…</p> : null}
            {graph.isError ? (
              <p className="dshx:text-xs dshx:text-destructive" role="alert">
                That reference could not be read in the registered repositories.
              </p>
            ) : null}
            {graph.isSuccess && matches.length === 0 ? (
              <p className="dshx:text-xs dshx:text-destructive" role="alert">
                No registered repository contains this reference.
              </p>
            ) : null}
            {failure === undefined ? null : (
              <p className="dshx:text-xs dshx:text-destructive" role="alert">
                {failure}
              </p>
            )}
            {referenceGraph?.revisions !== undefined && referenceGraph.listedCommitIds !== undefined && referenceGraph.listedCommitIds.length > 0 ? (
              <ReferenceGraphView
                defaultCommitId={referenceGraph.defaultCommitId ?? null}
                listedCommitIds={referenceGraph.listedCommitIds}
                referencedCommitId={referenceGraph.commitId}
                revisions={referenceGraph.revisions}
              />
            ) : rendered === undefined ? null : (
              <pre aria-label="Revision graph" className="dshx:max-h-72 dshx:overflow-auto dshx:font-mono dshx:text-xs dshx:leading-4">
                {rendered}
              </pre>
            )}
          </PopoverContent>
        </Popover>
      )}
    </>
  )
}
