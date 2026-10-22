import { MarkdownText, type MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import { useApi } from '@dshfiles/dshx/client'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Popover, PopoverAnchor, PopoverContent, PopoverHeader, PopoverTitle } from '@dshfiles/plugin-ui/components/ui/popover'
import { errorMessage, useQuery } from '@dshfiles/plugin-ui/query'
import { useEffect, useState } from 'react'

import { BacklogAnchorModel } from './backlog-anchor.js'
import {
  backlogReferenceLabel,
  backlogReferencePreviewEvent,
  backlogReferencePreviewRequestSchema,
  type BacklogReferencePreviewRequest,
} from './backlog-reference.js'
import { backlogApi, BacklogViews } from './api.js'
import { ItemGlyphs } from './item-glyphs.js'
import { AttachmentMedia } from './item-files.js'
import type { BacklogKind, BacklogStatus } from './item.js'

const markdownLabels: MarkdownLabels = { code: { copyLabel: 'Copy', copiedLabel: 'Copied' }, footnotes: 'Footnotes' }

const StatusLine = (props: { readonly kind: BacklogKind; readonly status: BacklogStatus; readonly project: string | null }): JSX.Element => (
  <span className="dshx:flex dshx:items-center dshx:gap-2 dshx:text-xs dshx:text-muted-foreground">
    <span className="dshx:flex dshx:items-center dshx:gap-1">
      <ItemGlyphs.KindIcon kind={props.kind} />
      {ItemGlyphs.kindLabels[props.kind]}
    </span>
    <span className="dshx:flex dshx:items-center dshx:gap-1">
      <ItemGlyphs.StatusIcon status={props.status} />
      {ItemGlyphs.statusLabels[props.status]}
    </span>
    {props.project === null ? null : (
      <span className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-1">
        <ItemGlyphs.ProjectDot project={props.project} />
        <span className="dshx:truncate">{ItemGlyphs.projectName(props.project)}</span>
      </span>
    )}
  </span>
)

export const BacklogReferenceOverlay = (props: {
  /** Opens the Backlog page on this item, the way the sidebar's Backlog row would. */
  readonly openInBacklog: (id: number) => void
}): JSX.Element | null => {
  const api = useApi(backlogApi)
  const [request, setRequest] = useState<BacklogReferencePreviewRequest | null>(null)
  const [anchor, setAnchor] = useState<BacklogReferencePreviewRequest['anchor'] | null>(null)
  const preview = useQuery({
    queryKey: ['dshfiles-backlog', 'reference-preview', request?.id],
    enabled: request !== null,
    retry: false,
    queryFn: async ({ signal }) => {
      if (request === null) throw new Error('No backlog reference is selected.')
      return BacklogViews.detailResult(await api.get({ id: request.id }, { signal }))
    },
  })

  useEffect(() => {
    const open = (event: Event): void => {
      if (!(event instanceof CustomEvent)) return
      const parsed = backlogReferencePreviewRequestSchema.safeParse(event.detail)
      if (!parsed.success) return
      setAnchor(parsed.data.anchor)
      setRequest(parsed.data)
    }
    window.addEventListener(backlogReferencePreviewEvent, open)
    return () => window.removeEventListener(backlogReferencePreviewEvent, open)
  }, [])

  // A landing message scrolls the conversation; the card follows the reference instead of disappearing under it.
  useEffect(() => {
    if (request === null) return
    const remeasure = (): void => {
      const measurement = BacklogAnchorModel.measure(request.anchorId, window.innerHeight)
      if (measurement.kind === 'gone') return
      if (measurement.kind === 'offscreen') {
        setRequest(null)
        return
      }
      setAnchor(measurement.rect)
    }
    window.addEventListener('scroll', remeasure, true)
    window.addEventListener('resize', remeasure)
    return () => {
      window.removeEventListener('scroll', remeasure, true)
      window.removeEventListener('resize', remeasure)
    }
  }, [request])

  if (request === null) return null
  const detail = preview.data?.ok === true ? preview.data.value : undefined
  const missing = preview.data?.ok === false
  return (
    <Popover open onOpenChange={open => !open && setRequest(null)}>
      <PopoverAnchor asChild>
        <span
          aria-hidden
          style={{
            position: 'fixed',
            display: 'block',
            left: (anchor ?? request.anchor).left,
            top: (anchor ?? request.anchor).top,
            width: Math.max(1, (anchor ?? request.anchor).width),
            height: Math.max(1, (anchor ?? request.anchor).height),
            pointerEvents: 'none',
          }}
        />
      </PopoverAnchor>
      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={6}
        className="dshx-root dshx:w-[34rem] dshx:max-w-[calc(100vw-1rem)]"
        data-dshfiles-backlog-preview
      >
        <PopoverHeader>
          <PopoverTitle>Backlog · {backlogReferenceLabel(request.id)}</PopoverTitle>
        </PopoverHeader>
        <div className="dshx:flex dshx:flex-col dshx:gap-2">
          {preview.isPending ? <p className="dshx:text-xs dshx:text-muted-foreground">Loading backlog item…</p> : null}
          {preview.isError ? (
            <p className="dshx:text-xs dshx:text-destructive" role="alert">
              {errorMessage(preview.error, 'Backlog item is unavailable.')}
            </p>
          ) : null}
          {missing ? <p className="dshx:text-xs dshx:text-muted-foreground">No backlog item {backlogReferenceLabel(request.id)}.</p> : null}
          {detail === undefined ? null : (
            <>
              <p className="dshx:text-sm dshx:font-medium">{detail.item.title}</p>
              <StatusLine kind={detail.item.kind} status={detail.item.status} project={detail.item.project} />
              {detail.item.body.trim() === '' ? null : (
                <div className="dshx:max-h-[40vh] dshx:overflow-auto">
                  <MarkdownText text={detail.item.body} labels={markdownLabels} variant="compact" />
                </div>
              )}
              <AttachmentMedia itemId={detail.item.id} attachments={detail.item.attachments} />
            </>
          )}
        </div>
        <div className="dshx:flex dshx:justify-end">
          {missing ? null : (
            <Button
              size="xs"
              variant="outline"
              onClick={() => {
                props.openInBacklog(request.id)
                setRequest(null)
              }}
            >
              Open in Backlog
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
