import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { changesSummaryUrl, parseChangesSummaryFiles, parseReviewCoordinates, type ChangesSummaryFiles } from './review-file.js'
import { viewedKey, type ViewedMarks } from './viewed-marks.js'
import styles from './diff-viewed.module.css'

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
  return (
    <span className={styles.root}>
      <span className={styles.progress} data-diff-viewed="progress">
        {props.t('progress', { viewed: viewedCount, total: files.length })}
      </span>
      <button
        type="button"
        className={styles.toggle}
        aria-pressed={isViewed}
        aria-label={props.t(isViewed ? 'markUnviewed' : 'markViewed', { name: file.display })}
        data-diff-viewed="toggle"
        onClick={() => props.marks.toggle({ sessionId: coordinates.sessionId, seq: coordinates.seq, path: file.path })}
      >
        <span className={styles.box} aria-hidden>
          {isViewed ? '✓' : ''}
        </span>
        {props.t('viewed')}
      </button>
    </span>
  )
}
