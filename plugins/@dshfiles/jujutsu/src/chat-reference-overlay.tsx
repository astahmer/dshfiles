import { SessionId } from '@deepseek-ai/dsh-session/types'
import { useApi } from '@dshfiles/dshx/client'
import { jjIntegrationApi } from '@dshfiles/jj-integration/api'
import { Popover, PopoverAnchor, PopoverContent, PopoverHeader, PopoverTitle } from '@dshfiles/plugin-ui/components/ui/popover'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ChatReferenceModel, chatReferenceQueryKeys } from './chat-reference.js'
import { ChatReferenceLinks } from './chat-reference-links.js'
import { SchemaHelpers } from './schema-helpers.js'
import { ReferenceGraphView } from './reference-graph-view.js'
import { OwnerRouting } from './owner-routed-api.js'
import { useOwnerPort, useThreadJujutsuApi } from './use-jujutsu-api.js'
import {
  chatReferencePreviewDismissEvent,
  chatReferencePreviewEvent,
  chatReferencePreviewRequestSchema,
  type ChatReferencePreviewRequest,
} from './chat-reference.js'

/** Moving the pointer from a reference into the card must not close it, so leaving waits out a short grace. */
const CLOSE_GRACE_MS = 140

/**
 * The revision-graph preview for a `jj:` reference in chat. Chat renders the chips through its inline-reference
 * registry; a hover arrives as a window event carrying the chip's anchor, so one overlay serves every message.
 */
export const ChatReferenceOverlay = (props: { readonly projectPathForSession: (sessionId: string) => string | undefined }): JSX.Element => {
  const jjIntegration = useApi(jjIntegrationApi)
  const owner = useOwnerPort()
  const queryClient = useQueryClient()
  const [request, setRequest] = useState<ChatReferencePreviewRequest | null>(null)
  const api = useThreadJujutsuApi(request === null ? null : SessionId(request.sessionId))
  const closeTimer = useRef<number | undefined>(undefined)
  const cancelClose = useCallback((): void => {
    if (closeTimer.current === undefined) return
    window.clearTimeout(closeTimer.current)
    closeTimer.current = undefined
  }, [])
  const dismiss = useCallback((): void => {
    cancelClose()
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = undefined
      setRequest(null)
    }, CLOSE_GRACE_MS)
  }, [cancelClose])

  useEffect(() => {
    const open = (event: Event): void => {
      if (!(event instanceof CustomEvent)) return
      const parsed = SchemaHelpers.decodeSafe(chatReferencePreviewRequestSchema, event.detail)
      if (!parsed.success) return
      cancelClose()
      setRequest(parsed.data)
    }
    const closeOnScroll = (event: Event): void => {
      if (event.target instanceof Element && event.target.closest('[data-dshfiles-jj-preview]') !== null) return
      setRequest(null)
    }
    const close = (): void => setRequest(null)
    window.addEventListener(chatReferencePreviewEvent, open)
    window.addEventListener(chatReferencePreviewDismissEvent, dismiss)
    window.addEventListener('scroll', closeOnScroll, true)
    window.addEventListener('resize', close)
    return () => {
      if (closeTimer.current !== undefined) window.clearTimeout(closeTimer.current)
      window.removeEventListener(chatReferencePreviewEvent, open)
      window.removeEventListener(chatReferencePreviewDismissEvent, dismiss)
      window.removeEventListener('scroll', closeOnScroll, true)
      window.removeEventListener('resize', close)
    }
  }, [cancelClose, dismiss])

  const referenced = request?.reference.value
  const projectPath = request === null ? undefined : props.projectPathForSession(request.sessionId)
  const readLocalReference = async (cwd: string, reference: string, signal: AbortSignal) => {
    try {
      const repository = await queryClient.fetchQuery({
        queryKey: chatReferenceQueryKeys.repository(cwd),
        queryFn: ({ signal: querySignal }) => api.registerRepository({ path: cwd }, { signal: querySignal }),
        staleTime: 30_000,
      })
      const graph = await api.referenceGraph({ repoId: repository.repoId, reference }, { signal })
      return 'graph' in graph ? { repository, graph } : null
    } catch {
      return null
    }
  }
  const resolveReference = async (cwd: string, projectPath: string | undefined, reference: string, signal: AbortSignal) => {
    const preferred =
      projectPath === undefined
        ? null
        : await queryClient.fetchQuery({
            queryKey: chatReferenceQueryKeys.localTitle(cwd, reference, projectPath),
            queryFn: ({ signal: querySignal }) => readLocalReference(projectPath, reference, querySignal),
            staleTime: 30_000,
          })
    if (preferred !== null) return [preferred]
    const local = await queryClient.fetchQuery({
      queryKey: chatReferenceQueryKeys.localTitle(cwd, reference),
      queryFn: ({ signal: querySignal }) => readLocalReference(cwd, reference, querySignal),
      staleTime: 30_000,
    })
    if (local !== null) return [local]
    // The other registered projects are this machine's; a remote thread's reference can only be in its own repository.
    if (request !== null && (await OwnerRouting.ownerOf(owner, SessionId(request.sessionId), { signal }).catch(() => null)) !== null) return []
    const projects = await queryClient.fetchQuery({
      queryKey: chatReferenceQueryKeys.projects,
      queryFn: ({ signal: querySignal }) => jjIntegration.projects({}, { signal: querySignal }),
      staleTime: 30_000,
    })
    const paths = [...new Set([...projects.projects, ...(projects.workspaces ?? [])].map(project => project.path))].slice(0, 31)
    const registered = await queryClient.fetchQuery({
      queryKey: chatReferenceQueryKeys.repositories(paths),
      queryFn: ({ signal: querySignal }) => api.registerRepositories({ paths }, { signal: querySignal }),
      staleTime: 30_000,
    })
    const repositories = registered.repositories.flatMap(entry =>
      entry.repoId === null || entry.root === null ? [] : [{ path: entry.path, repository: { repoId: entry.repoId, root: entry.root } }],
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
    queryKey: chatReferenceQueryKeys.search(request?.cwd ?? '', referenced ?? '', projectPath),
    enabled: request !== null && referenced !== undefined,
    retry: false,
    staleTime: 30_000,
    queryFn: ({ signal }) => resolveReference(request?.cwd ?? '', projectPath, referenced ?? '', signal),
  })
  useEffect(() => {
    if (request === null || graph.isFetching || !graph.isSuccess) return
    const match = ChatReferenceModel.uniqueMatch(graph.data ?? [])
    if (match === undefined) return
    // The preview searched every registered repository, so it can settle a chip the thread's own repository could not.
    ChatReferenceLinks.titles()?.record(request.sessionId, request.cwd, request.reference, {
      title: match.graph.description?.trim() || request.reference.value,
      targetPath: match.repository.root,
    })
  }, [graph.data, graph.isFetching, graph.isSuccess, request])

  const matches = graph.data ?? []
  const referenceGraph = ChatReferenceModel.uniqueMatch(matches)?.graph
  const failure = matches.length > 1 ? 'This reference exists in multiple registered repositories, so it cannot be selected unambiguously.' : undefined
  const rendered = referenceGraph?.graph
  return (
    <TooltipProvider delayDuration={0}>
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
            onPointerEnter={cancelClose}
            onPointerLeave={event => {
              const relatedTarget = event.relatedTarget
              if (
                relatedTarget instanceof Element &&
                (relatedTarget.closest('[data-dshfiles-jj-preview-tooltip]') !== null ||
                  relatedTarget.querySelector('[data-dshfiles-jj-preview-tooltip]') !== null)
              ) {
                return
              }
              dismiss()
            }}
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
                    Commit ID:{' '}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <code>{referenceGraph.commitId.slice(0, 8)}</code>
                      </TooltipTrigger>
                      <TooltipContent data-dshfiles-jj-preview-tooltip onPointerEnter={cancelClose} onPointerLeave={dismiss} side="bottom">
                        {referenceGraph.commitId}
                      </TooltipContent>
                    </Tooltip>
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
    </TooltipProvider>
  )
}
