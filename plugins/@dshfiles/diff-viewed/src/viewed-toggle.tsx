import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { changesSummaryUrl, parseChangesSummaryFiles, parseReviewCoordinates, type ChangesSummaryFiles } from './review-file.js'
import { viewedKey, type ViewedMarks } from './viewed-marks.js'
import { Checkbox } from '@dshfiles/plugin-ui/components/ui/checkbox'

interface ViewedToggleProps {
  readonly actionUrl: string
  readonly marks: ViewedMarks
  readonly t: Translate<'viewed' | 'markViewed' | 'markUnviewed' | 'progress'>
}

const useSummaryFiles = (summaryUrl: string | undefined): ChangesSummaryFiles | undefined => {
  const [loaded, setLoaded] = useState<{ readonly url: string; readonly files: ChangesSummaryFiles } | undefined>(undefined)
  useEffect(() => {
    if (summaryUrl === undefined) return
    const controller = new AbortController()
    fetch(summaryUrl, { signal: controller.signal })
      .then(response => (response.ok ? response.json() : undefined))
      .then(body => {
        const files = parseChangesSummaryFiles(body)
        if (files !== undefined) setLoaded({ url: summaryUrl, files })
      })
      .catch(() => undefined)
    return () => controller.abort()
  }, [summaryUrl])
  return loaded?.url === summaryUrl ? loaded?.files : undefined
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
      <span className="dshx:text-xs dshx:whitespace-nowrap dshx:text-muted-foreground dshx:tabular-nums" data-diff-viewed="progress">
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
