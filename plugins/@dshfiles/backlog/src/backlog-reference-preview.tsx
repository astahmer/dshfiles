import { Markdown } from '@dshfiles/plugin-ui/components/markdown'
import { useApi } from '@dshfiles/dshx/client'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { errorMessage, useQuery } from '@dshfiles/plugin-ui/query'

import { BacklogReference } from './backlog-reference.js'
import { backlogApi, BacklogViews } from './api.js'
import { ItemGlyphs } from './item-glyphs.js'
import { AttachmentMedia } from './item-files.js'
import type { BacklogKind, BacklogStatus } from './item.js'

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

/** The backlog item card the shared reference preview draws for one `b:<ref>`. */
export const BacklogReferencePreview = (props: {
  /** The ref as written: `k3f9` or a legacy `12`. */
  readonly reference: string
  readonly close: () => void
  /** Opens the Backlog page on this item, the way the sidebar's Backlog row would. */
  readonly openInBacklog: (id: number) => void
}): JSX.Element => {
  const api = useApi(backlogApi)
  const preview = useQuery({
    queryKey: ['dshfiles-backlog', 'reference-preview', props.reference],
    retry: false,
    queryFn: async ({ signal }) => BacklogViews.detailResult(await api.get({ id: BacklogReference.requestId(props.reference) }, { signal })),
  })
  const detail = preview.data?.ok === true ? preview.data.value : undefined
  const missing = preview.data?.ok === false
  return (
    <div className="dshx:flex dshx:min-h-0 dshx:flex-col dshx:gap-2.5 dshx:p-4" data-dshfiles-backlog-preview>
      <h2 className="dshx:m-0 dshx:text-sm dshx:font-medium dshx:text-muted-foreground">Backlog · {BacklogReference.label(props.reference)}</h2>
      <div className="dshx:flex dshx:flex-col dshx:gap-2">
        {preview.isPending ? <p className="dshx:text-xs dshx:text-muted-foreground">Loading backlog item…</p> : null}
        {preview.isError ? (
          <p className="dshx:text-xs dshx:text-destructive" role="alert">
            {errorMessage(preview.error, 'Backlog item is unavailable. Open the Backlog page to search for it.')}
          </p>
        ) : null}
        {missing ? (
          <p className="dshx:text-xs dshx:text-muted-foreground">No backlog item {BacklogReference.label(props.reference)}. Search the Backlog page for it.</p>
        ) : null}
        {detail === undefined ? null : (
          <>
            <p className="dshx:text-sm dshx:font-medium">{detail.item.title}</p>
            <StatusLine kind={detail.item.kind} status={detail.item.status} project={detail.item.project} />
            {detail.item.body.trim() === '' ? null : (
              <div className="dshx:max-h-[40vh] dshx:overflow-auto">
                <Markdown text={detail.item.body} />
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
              if (detail !== undefined) props.openInBacklog(detail.item.id)
              props.close()
            }}
          >
            Open in Backlog
          </Button>
        )}
      </div>
    </div>
  )
}
