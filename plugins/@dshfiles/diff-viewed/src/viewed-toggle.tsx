import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import { useSyncExternalStore } from 'react'
import { changesSummaryUrl, parseChangesSummaryFiles, parseReviewCoordinates, type ChangesSummaryFiles } from './review-file.js'
import { viewedKey, type ViewedMarks } from './viewed-marks.js'
import { Checkbox } from '@dshfiles/plugin-ui/components/ui/checkbox'
import { useQuery } from '@dshfiles/plugin-ui/query'

interface ViewedToggleProps {
  readonly actionUrl: string
  readonly marks: ViewedMarks
  readonly t: Translate<'viewed' | 'markViewed' | 'markUnviewed' | 'progress'>
}

const useSummaryFiles = (summaryUrl: string | undefined): ChangesSummaryFiles | undefined =>
  useQuery({
    queryKey: ['diff-viewed', 'summary', summaryUrl],
    queryFn: async ({ signal }) => {
      const response = await fetch(summaryUrl ?? '', { signal })
      return response.ok ? (parseChangesSummaryFiles(await response.json()) ?? null) : null
    },
    enabled: summaryUrl !== undefined,
    retry: false,
  }).data ?? undefined

const RING_RADIUS = 5
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

const ProgressRing = (props: { readonly viewed: number; readonly total: number }): JSX.Element => {
  const ratio = props.total === 0 ? 0 : props.viewed / props.total
  return (
    <svg aria-hidden className="dshx:size-3.5 dshx:-rotate-90" viewBox="0 0 14 14">
      <circle className="dshx:fill-none dshx:stroke-border" cx="7" cy="7" r={RING_RADIUS} strokeWidth="2" />
      <circle
        className="dshx:fill-none dshx:stroke-success dshx:transition-[stroke-dashoffset]"
        cx="7"
        cy="7"
        r={RING_RADIUS}
        strokeDasharray={RING_CIRCUMFERENCE}
        strokeDashoffset={RING_CIRCUMFERENCE * (1 - ratio)}
        strokeLinecap="round"
        strokeWidth="2"
      />
    </svg>
  )
}

/** The review tab's file-action entry: a viewed toggle for the selected file and the turn's progress. */
export const ViewedToggle = (props: ViewedToggleProps): JSX.Element | null => {
  const coordinates = parseReviewCoordinates(props.actionUrl)
  const files = useSummaryFiles(coordinates === undefined ? undefined : changesSummaryUrl(coordinates))
  const viewed = useSyncExternalStore(props.marks.subscribe, props.marks.getSnapshot)
  const file = coordinates === undefined ? undefined : files?.[coordinates.index]
  if (coordinates === undefined || files === undefined || file === undefined) return null

  const isViewed = viewed.has(viewedKey({ sessionId: coordinates.sessionId, seq: coordinates.seq, path: file.path }))
  const viewedCount = files.filter(candidate => viewed.has(viewedKey({ sessionId: coordinates.sessionId, seq: coordinates.seq, path: candidate.path }))).length
  const label = props.t(isViewed ? 'markUnviewed' : 'markViewed', { name: file.display })
  return (
    <span className="dshx-root dshx:ms-1 dshx:inline-flex dshx:items-center dshx:gap-2">
      <span className="dshx:inline-flex dshx:items-center dshx:gap-1.5 dshx:text-xs dshx:whitespace-nowrap dshx:text-muted-foreground dshx:tabular-nums" data-diff-viewed="progress">
        <ProgressRing total={files.length} viewed={viewedCount} />
        {props.t('progress', { viewed: viewedCount, total: files.length })}
      </span>
      <label className="dshx:inline-flex dshx:h-7 dshx:cursor-pointer dshx:items-center dshx:gap-1.5 dshx:rounded-md dshx:border dshx:px-2 dshx:text-xs dshx:whitespace-nowrap dshx:text-muted-foreground dshx:hover:bg-accent dshx:has-[[data-state=checked]]:text-foreground">
        <Checkbox
          aria-label={label}
          checked={isViewed}
          className="dshx:size-3.5 dshx:data-[state=checked]:border-success dshx:data-[state=checked]:bg-success"
          data-diff-viewed="toggle"
          onCheckedChange={() => props.marks.toggle({ sessionId: coordinates.sessionId, seq: coordinates.seq, path: file.path })}
        />
        {props.t('viewed')}
      </label>
    </span>
  )
}
