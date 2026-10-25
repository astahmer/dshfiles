import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Input } from '@dshfiles/plugin-ui/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@dshfiles/plugin-ui/components/ui/popover'
import { CrosshairIcon, SquareDashedIcon } from '@dshfiles/plugin-ui/icons'
import { useApi, type ComposerActionProps } from '@dshfiles/dshx/client'
import { runHostRequest } from '@dshfiles/plugin-ui/lib/host-request'
import { useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { annotationsApi } from '../api.js'
import { INGEST_PATH } from '../limits.js'
import { formatAnnotationBlock } from '../draft.js'
import type { Annotation } from '../schema.js'
import { staleAnnotations } from '../stale.js'
import { annotationsUi } from './state.js'
import { PreviewDialog } from './preview-dialog.js'

const OPEN_STATUSES = ['pending', 'acknowledged', 'stale'] as const

const selectorLabel = (annotation: Annotation): string => annotation.target.selector.split(' > ').slice(-1)[0] ?? annotation.target.tag

const statusVariant = (annotation: Annotation): 'default' | 'secondary' | 'outline' | 'destructive' => {
  if (annotation.status === 'stale') return 'destructive'
  if (annotation.severity === 'blocking') return 'destructive'
  if (annotation.status === 'acknowledged') return 'secondary'
  return 'outline'
}

export const AnnotationsAction = (props: ComposerActionProps): JSX.Element => {
  const api = useApi(annotationsApi)
  const queryClient = useQueryClient()
  const sessionId = props.sessionId
  const [open, setOpen] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [pairingArmed, setPairingArmed] = useState(false)
  const [dismissing, setDismissing] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [replying, setReplying] = useState<string | null>(null)
  const [reply, setReply] = useState('')
  const checked = useRef(new Set<string>())

  useEffect(() => {
    annotationsUi.setSession(sessionId)
    return () => annotationsUi.setSession(null)
  }, [sessionId])

  const list = useQuery({
    queryKey: ['annotations', sessionId],
    queryFn: ({ signal }) =>
      runHostRequest({ signal, request: hostSignal => api.list({ sessionId, statuses: [...OPEN_STATUSES], limit: 50 }, { signal: hostSignal }) }),
    refetchInterval: 4_000,
    retry: 1,
  })
  const rows = useMemo(() => list.data?.annotations ?? [], [list.data])
  const count = rows.length

  const intake = useQuery({
    queryKey: ['annotations', 'intake'],
    queryFn: ({ signal }) => runHostRequest({ signal, request: hostSignal => api.intake({ limit: 20 }, { signal: hostSignal }) }),
    enabled: open,
    refetchInterval: 6_000,
    retry: 1,
  })
  const attach = useMutation({
    mutationFn: async (ids: readonly string[]) => runHostRequest({ request: signal => api.attach({ sessionId, ids: [...ids] }, { signal }) }),
    onError: (cause: unknown) => setActionError(cause instanceof Error ? cause.message : 'Could not attach that annotation.'),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['annotations', 'intake'] })
      await refresh()
    },
  })
  const setupQuery = useQuery({
    queryKey: ['annotations', 'setup'],
    queryFn: ({ signal }) => runHostRequest({ signal, request: hostSignal => api.setup({}, { signal: hostSignal }) }),
    enabled: open,
    retry: 0,
  })
  const pairStatus = useQuery({
    queryKey: ['annotations', 'pair'],
    queryFn: ({ signal }) => runHostRequest({ signal, request: hostSignal => api.pair({ action: 'status' }, { signal: hostSignal }) }),
    enabled: open && pairingArmed,
    refetchInterval: 2_000,
    retry: 0,
  })
  useEffect(() => {
    if (pairingArmed && pairStatus.data?.pairedAt !== undefined) setPairingArmed(false)
  }, [pairingArmed, pairStatus.data])
  const armPairing = useMutation({
    mutationFn: async () => runHostRequest({ request: signal => api.pair({ action: 'arm' }, { signal }) }),
    onSuccess: () => setPairingArmed(true),
    onError: (cause: unknown) => setActionError(cause instanceof Error ? cause.message : 'Could not open the pairing window.'),
  })
  const chromeStatus = useQuery({
    queryKey: ['annotations', 'chrome'],
    queryFn: ({ signal }) => runHostRequest({ signal, request: hostSignal => api.chromeStatus({}, { signal: hostSignal }) }),
    enabled: open,
    refetchInterval: 5_000,
    retry: 0,
  })
  const launchChrome = useMutation({
    mutationFn: async () => runHostRequest({ request: signal => api.chromeLaunch({}, { signal }) }),
    onSuccess: () => void chromeStatus.refetch(),
    onError: (cause: unknown) => setActionError(cause instanceof Error ? cause.message : 'Could not start Chrome.'),
  })
  const stopChrome = useMutation({
    mutationFn: async () => runHostRequest({ request: signal => api.chromeStop({}, { signal }) }),
    onSuccess: () => void chromeStatus.refetch(),
  })
  const pickActiveTab = useMutation({
    mutationFn: async () => runHostRequest({ request: signal => api.chromePick({}, { signal }) }),
    onSuccess: result => {
      if (!result.ok) {
        setActionError(
          result.reason === 'no-page'
            ? 'No annotatable tab yet; open a page in that window.'
            : result.reason === 'timeout'
              ? 'The pick timed out; click Pick again.'
              : result.reason === 'cancelled'
                ? null
                : 'Could not reach that tab.',
        )
        return
      }
      setActionError(null)
      annotationsUi.picked({ target: result.target, point: result.point, mode: 'element' })
    },
    onError: (cause: unknown) => setActionError(cause instanceof Error ? cause.message : 'Could not pick in that tab.'),
  })
  const pickOnChrome = useMutation({
    mutationFn: async (pageId: string) => runHostRequest({ request: signal => api.chromePick({ pageId }, { signal }) }),
    onSuccess: result => {
      if (!result.ok) {
        setActionError(
          result.reason === 'no-page'
            ? 'That tab is gone; refresh the list.'
            : result.reason === 'timeout'
              ? 'The pick timed out; click Pick again.'
              : result.reason === 'cancelled'
                ? null
                : 'Could not reach that tab.',
        )
        return
      }
      setActionError(null)
      annotationsUi.picked({ target: result.target, point: result.point, mode: 'element' })
    },
    onError: (cause: unknown) => setActionError(cause instanceof Error ? cause.message : 'Could not pick in that tab.'),
  })
  const tokenQuery = useQuery({
    queryKey: ['annotations', 'token'],
    queryFn: ({ signal }) => runHostRequest({ signal, request: hostSignal => api.token({}, { signal: hostSignal }) }),
    enabled: false,
    retry: 0,
  })

  const refresh = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ['annotations', sessionId] })
  }

  const stale = useMutation({
    mutationFn: async (check: { readonly id: string; readonly revision: number; readonly reason: 'element-missing' | 'text-changed' | 'route-changed' }) =>
      runHostRequest({ request: signal => api.stale({ sessionId, id: check.id, reason: check.reason }, { signal }) }),
    onSuccess: refresh,
  })

  const resolve = useMutation({
    mutationFn: async (annotation: Annotation) =>
      runHostRequest({ request: signal => api.resolve({ sessionId, id: annotation.id, revision: annotation.revision }, { signal }) }),
    onSuccess: refresh,
  })

  const dismiss = useMutation({
    mutationFn: async ({ id, text }: { readonly id: string; readonly text: string }) =>
      runHostRequest({ request: signal => api.dismiss({ sessionId, id, reason: text }, { signal }) }),
    onSuccess: async () => {
      setDismissing(null)
      setReason('')
      await refresh()
    },
  })

  const sendReply = useMutation({
    mutationFn: async ({ id, body }: { readonly id: string; readonly body: string }) =>
      runHostRequest({ request: signal => api.reply({ sessionId, id, body, role: 'human' }, { signal }) }),
    onSuccess: async () => {
      setReplying(null)
      setReply('')
      await refresh()
    },
  })

  useEffect(() => {
    const checks = staleAnnotations({ annotations: rows, scope: document, url: window.location.href })
    for (const check of checks) {
      const key = `${check.id}:${check.revision}`
      if (checked.current.has(key)) continue
      checked.current.add(key)
      stale.mutate(check)
    }
  }, [rows, stale])

  const pick = ({ mode }: { readonly mode: 'element' | 'region' }): void => {
    setOpen(false)
    annotationsUi.beginPick({ sessionId, mode })
  }

  const insert = (): void => {
    const block = formatAnnotationBlock({ annotations: rows })
    if (block.length === 0) return
    const span = props.inputActions.captureInsertion()
    if (!props.inputActions.insertText(block, span)) return
    setOpen(false)
  }

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="Annotate an element"
            className="dshx-root dshx:relative dshx:text-muted-foreground dshx:hover:text-foreground dshx:data-[state=open]:bg-accent"
          >
            <CrosshairIcon className="dshx:size-4" />
            {count === 0 ? null : (
              <span className="dshx:absolute dshx:-top-1 dshx:-right-1 dshx:rounded-full dshx:bg-primary dshx:px-1 dshx:text-[10px] dshx:leading-4 dshx:text-primary-foreground">
                {count}
              </span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" side="top" className="dshx-root dshx:flex dshx:max-h-[460px] dshx:w-96 dshx:flex-col dshx:gap-0 dshx:p-0">
          <div className="dshx:flex dshx:items-center dshx:justify-between dshx:gap-2 dshx:border-b dshx:px-3 dshx:py-2">
            <div>
              <h2 className="dshx:text-sm dshx:font-semibold">Annotations</h2>
              <p className="dshx:text-xs dshx:text-muted-foreground">{count === 0 ? 'None yet in this thread' : `${count} open`}</p>
            </div>
            <div className="dshx:flex dshx:items-center dshx:gap-1">
              <Button type="button" size="sm" variant="secondary" onClick={() => pick({ mode: 'element' })}>
                <CrosshairIcon className="dshx:size-3.5" /> Pick element
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => pick({ mode: 'region' })} aria-label="Draw an area">
                <SquareDashedIcon className="dshx:size-3.5" />
              </Button>
            </div>
          </div>
          {intake.data !== undefined && intake.data.items.length > 0 ? (
            <div className="dshx:flex dshx:flex-col dshx:gap-1 dshx:border-b dshx:px-3 dshx:py-2">
              <p className="dshx:text-[11px] dshx:font-medium">From Chrome · {intake.data.items.length}</p>

              {intake.data.items.map(item => (
                <div key={item.id} className="dshx:flex dshx:items-center dshx:justify-between dshx:gap-2">
                  <span className="dshx:truncate dshx:text-[11px] dshx:text-muted-foreground">
                    {item.draft.note.length === 0 ? item.draft.target.selector : item.draft.note}
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="dshx:h-6 dshx:px-1.5 dshx:text-[11px]"
                    disabled={attach.isPending}
                    onClick={() => attach.mutate([item.id])}
                  >
                    Add to this thread
                  </Button>
                </div>
              ))}
            </div>
          ) : null}
          <details className="dshx:border-b dshx:px-3 dshx:py-2">
            <summary className="dshx:cursor-pointer dshx:text-[11px] dshx:text-muted-foreground">Chrome without an extension</summary>
            <p className="dshx:mt-1 dshx:text-[11px] dshx:text-muted-foreground">
              A DSH-owned Chrome profile with a loopback debugging port. Nothing is installed and your daily Chrome is untouched.
            </p>
            <div className="dshx:mt-1 dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={launchChrome.isPending || setupQuery.data?.chromePath === ''}
                onClick={() => launchChrome.mutate()}
              >
                {chromeStatus.data?.running === true ? 'Launch again' : 'Launch Chrome'}
              </Button>
              {chromeStatus.data?.running !== true ? null : (
                <>
                  <Button type="button" size="sm" variant="ghost" onClick={() => void chromeStatus.refetch()}>
                    Refresh tabs
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => stopChrome.mutate()}>
                    Stop
                  </Button>
                </>
              )}
            </div>
            <p className="dshx:mt-1 dshx:truncate dshx:font-mono dshx:text-[10px] dshx:text-muted-foreground">
              {chromeStatus.data?.running === true ? chromeStatus.data.endpoint : 'not running'}
            </p>
            {setupQuery.data?.chromePath === '' ? (
              <p className="dshx:mt-1 dshx:text-[11px] dshx:text-destructive">No Chrome found; set its path in Settings.</p>
            ) : null}
            {setupQuery.data?.pickActiveTab !== false && chromeStatus.data?.running === true ? (
              <div className="dshx:mt-1">
                <Button type="button" size="sm" disabled={pickActiveTab.isPending} onClick={() => pickActiveTab.mutate()}>
                  Pick on the active tab
                </Button>
              </div>
            ) : null}
            {setupQuery.data?.pickActiveTab !== false || chromeStatus.data === undefined || chromeStatus.data.pages.length === 0 ? null : (
              <ul className="dshx:mt-1 dshx:flex dshx:flex-col dshx:gap-1">
                {chromeStatus.data.pages.map(page => (
                  <li key={page.id} className="dshx:flex dshx:items-center dshx:justify-between dshx:gap-2">
                    <span className="dshx:truncate dshx:text-[11px]">{page.title}</span>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="dshx:h-6 dshx:px-1.5 dshx:text-[11px]"
                      disabled={pickOnChrome.isPending}
                      onClick={() => pickOnChrome.mutate(page.id)}
                    >
                      Pick
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            {pickOnChrome.isPending ? <p className="dshx:mt-1 dshx:text-[11px] dshx:text-muted-foreground">Waiting for a click in that tab…</p> : null}
          </details>
          <details className="dshx:border-b dshx:px-3 dshx:py-2">
            <summary className="dshx:cursor-pointer dshx:text-[11px] dshx:text-muted-foreground">Browser extension</summary>
            <p className="dshx:mt-1 dshx:text-[11px] dshx:text-muted-foreground">
              Chrome cannot install an unpacked extension for you. Once per Chrome profile:
            </p>
            <ol className="dshx:mt-1 dshx:list-decimal dshx:space-y-1 dshx:pl-4 dshx:text-[11px]">
              <li>
                In <code>chrome://extensions</code> with Developer mode on, drag this folder in:
                <div className="dshx:mt-0.5 dshx:flex dshx:items-center dshx:gap-1">
                  <code className="dshx:truncate dshx:font-mono dshx:text-[10px]">{setupQuery.data?.extensionPath ?? '…'}</code>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="dshx:h-6 dshx:px-1.5 dshx:text-[11px]"
                    onClick={() => void navigator.clipboard.writeText(setupQuery.data?.extensionPath ?? '')}
                  >
                    Copy
                  </Button>
                </div>
              </li>
              <li>
                Click <span className="dshx:font-medium">Pair extension</span> here, then <span className="dshx:font-medium">Pair with DSH</span> in the
                extension popup. No token to copy.
              </li>
            </ol>
            <div className="dshx:mt-1 dshx:flex dshx:items-center dshx:gap-2">
              <Button type="button" size="sm" variant="secondary" disabled={armPairing.isPending} onClick={() => armPairing.mutate()}>
                Pair extension
              </Button>
              {pairStatus.data?.pairedAt === undefined ? (
                pairingArmed ? (
                  <span className="dshx:text-[11px] dshx:text-muted-foreground">Waiting for the extension…</span>
                ) : null
              ) : (
                <span className="dshx:text-[11px] dshx:text-muted-foreground">Paired ✓</span>
              )}
            </div>
            <p className="dshx:mt-1 dshx:break-all dshx:font-mono dshx:text-[10px] dshx:text-muted-foreground">
              {location.origin}
              {INGEST_PATH}
            </p>
            <details className="dshx:mt-1">
              <summary className="dshx:cursor-pointer dshx:text-[11px] dshx:text-muted-foreground">Paste a token instead</summary>
              {tokenQuery.data === undefined ? (
                <Button type="button" size="sm" variant="ghost" className="dshx:h-6 dshx:px-1.5 dshx:text-[11px]" onClick={() => void tokenQuery.refetch()}>
                  Show token
                </Button>
              ) : (
                <div className="dshx:flex dshx:items-center dshx:gap-1">
                  <code className="dshx:truncate dshx:font-mono dshx:text-[10px]">{tokenQuery.data.token}</code>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="dshx:h-6 dshx:px-1.5 dshx:text-[11px]"
                    onClick={() => void navigator.clipboard.writeText(tokenQuery.data?.token ?? '')}
                  >
                    Copy
                  </Button>
                </div>
              )}
            </details>
          </details>
          {actionError === null ? null : <p className="dshx:border-b dshx:px-3 dshx:py-1 dshx:text-[11px] dshx:text-destructive">{actionError}</p>}
          <div className="dshx:min-h-0 dshx:flex-1 dshx:overflow-y-auto">
            {rows.length === 0 ? (
              <p className="dshx:px-3 dshx:py-6 dshx:text-center dshx:text-xs dshx:text-muted-foreground">
                Pick an element, write a note, then add it to the draft.
              </p>
            ) : (
              <ul className="dshx:flex dshx:flex-col">
                {rows.map(annotation => (
                  <li key={annotation.id} className="dshx:flex dshx:flex-col dshx:gap-1 dshx:border-b dshx:px-3 dshx:py-2">
                    <div className="dshx:flex dshx:items-center dshx:gap-2">
                      <span className="dshx:truncate dshx:font-mono dshx:text-[11px]">{selectorLabel(annotation)}</span>
                      <Badge variant={statusVariant(annotation)} className="dshx:text-[10px]">
                        {annotation.status === 'stale' ? `stale · ${annotation.target.staleReason ?? 'changed'}` : (annotation.severity ?? annotation.status)}
                      </Badge>
                      {annotation.intent === undefined ? null : <span className="dshx:text-[10px] dshx:text-muted-foreground">{annotation.intent}</span>}
                    </div>
                    {annotation.note.length === 0 ? null : <p className="dshx:line-clamp-2 dshx:text-xs dshx:text-muted-foreground">{annotation.note}</p>}
                    {annotation.target.source === undefined ? null : (
                      <p className="dshx:truncate dshx:font-mono dshx:text-[10px] dshx:text-muted-foreground">
                        {annotation.target.source.file}:{annotation.target.source.line}
                      </p>
                    )}
                    {annotation.thread.length === 0 ? null : (
                      <ul className="dshx:flex dshx:flex-col dshx:gap-0.5">
                        {annotation.thread.slice(-2).map(message => (
                          <li key={message.id} className="dshx:truncate dshx:text-[11px] dshx:text-muted-foreground">
                            <span className="dshx:font-medium">{message.role}</span>: {message.body}
                          </li>
                        ))}
                      </ul>
                    )}
                    {dismissing === annotation.id ? (
                      <div className="dshx:flex dshx:items-center dshx:gap-1">
                        <Input
                          autoFocus
                          value={reason}
                          onChange={event => setReason(event.target.value)}
                          placeholder="Why dismiss it?"
                          className="dshx:h-7 dshx:text-xs"
                        />
                        <Button
                          type="button"
                          size="sm"
                          variant="destructive"
                          disabled={reason.trim().length === 0 || dismiss.isPending}
                          onClick={() => dismiss.mutate({ id: annotation.id, text: reason.trim() })}
                        >
                          Dismiss
                        </Button>
                      </div>
                    ) : null}
                    {replying === annotation.id ? (
                      <div className="dshx:flex dshx:items-center dshx:gap-1">
                        <Input
                          autoFocus
                          value={reply}
                          onChange={event => setReply(event.target.value)}
                          placeholder="Reply to this annotation"
                          className="dshx:h-7 dshx:text-xs"
                        />
                        <Button
                          type="button"
                          size="sm"
                          disabled={reply.trim().length === 0 || sendReply.isPending}
                          onClick={() => sendReply.mutate({ id: annotation.id, body: reply.trim() })}
                        >
                          Reply
                        </Button>
                      </div>
                    ) : null}
                    <div className="dshx:flex dshx:items-center dshx:gap-1">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="dshx:h-6 dshx:px-1.5 dshx:text-[11px]"
                        onClick={() => resolve.mutate(annotation)}
                      >
                        Resolve
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="dshx:h-6 dshx:px-1.5 dshx:text-[11px]"
                        onClick={() => {
                          setReason('')
                          setDismissing(annotation.id)
                        }}
                      >
                        Dismiss
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="dshx:h-6 dshx:px-1.5 dshx:text-[11px]"
                        onClick={() => {
                          setReply('')
                          setReplying(annotation.id)
                        }}
                      >
                        Reply
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="dshx:flex dshx:items-center dshx:justify-end dshx:gap-2 dshx:border-t dshx:px-3 dshx:py-2">
            <Button type="button" size="sm" variant="ghost" onClick={() => setPreviewOpen(true)}>
              Preview HTML
            </Button>
            <Button type="button" size="sm" disabled={rows.length === 0} onClick={insert}>
              {rows.length === 0 ? 'Add to draft' : `Add ${rows.length} to draft`}
            </Button>
          </div>
        </PopoverContent>
      </Popover>
      <PreviewDialog open={previewOpen} onOpenChange={setPreviewOpen} sessionId={sessionId} />
    </>
  )
}
