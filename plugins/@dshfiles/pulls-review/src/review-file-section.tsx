import type { ReviewFile } from './review-model.js'
import type { FileComparison } from './review-diff.js'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Checkbox } from '@dshfiles/plugin-ui/components/ui/checkbox'
import { RefreshCw, TriangleAlert } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { ReviewDiff, CommentCountBadge, DisclosureGlyph, type CommentBinding, type DiffLayout } from './review-diffs.js'

interface ReviewFileSectionProps {
  readonly file: ReviewFile
  /** A comparison the caller already holds, such as a parsed workspace patch. */
  readonly comparison: FileComparison | undefined
  /** Fetches the comparison once the section comes near the viewport. */
  readonly loadComparison: ((signal: AbortSignal) => Promise<FileComparison>) | undefined
  readonly collapsed: boolean
  readonly onToggleCollapsed: () => void
  readonly viewed: boolean
  readonly onToggleViewed: () => void
  readonly commentCount: number
  readonly comments: CommentBinding | undefined
  readonly layout: DiffLayout
  readonly wrap: boolean
  readonly onPassed: (path: string) => void
  readonly root: RefObject<HTMLElement | null>
}

/** A rough height so a review of many files keeps a stable scrollbar before its comparisons mount. */
const placeholderHeight = (file: ReviewFile): number => Math.min(640, 64 + Math.min(300, file.additions + file.deletions) * 18)

interface ComparisonState {
  readonly status: 'idle' | 'loading' | 'ready' | 'error'
  readonly data: FileComparison | undefined
}

const IDLE: ComparisonState = { status: 'idle', data: undefined }

export const ReviewFileSection = (props: ReviewFileSectionProps): ReactNode => {
  const section = useRef<HTMLElement | null>(null)
  const bottom = useRef<HTMLDivElement | null>(null)
  const [near, setNear] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<ComparisonState>(IDLE)
  const passed = useRef(false)
  const loader = useRef(props.loadComparison)
  loader.current = props.loadComparison
  const startedFor = useRef<string | undefined>(undefined)

  useEffect(() => {
    const element = section.current
    const root = props.root.current
    if (element === null || root === null) return
    if (typeof IntersectionObserver === 'undefined') {
      setNear(true)
      return
    }
    const observer = new IntersectionObserver(
      entries => {
        if (entries.some(entry => entry.isIntersecting)) {
          setNear(true)
          observer.disconnect()
        }
      },
      { root, rootMargin: '800px 0px 800px 0px' },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [props.root])

  useEffect(() => {
    if (props.comparison !== undefined || loader.current === undefined || !near) return
    const token = `${String(props.file.index)}:${String(attempt)}`
    if (startedFor.current === token) return
    startedFor.current = token
    const controller = new AbortController()
    setState({ status: 'loading', data: undefined })
    loader.current(controller.signal).then(
      data => {
        if (!controller.signal.aborted) setState({ status: 'ready', data })
      },
      () => {
        if (!controller.signal.aborted) setState({ status: 'error', data: undefined })
      },
    )
    return () => controller.abort()
  }, [near, attempt, props.comparison, props.file.index])

  useEffect(() => {
    const element = bottom.current
    const root = props.root.current
    if (element === null || root === null || passed.current) return
    if (typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      entries => {
        const entry = entries[0]
        if (entry === undefined || passed.current) return
        const rootTop = entry.rootBounds?.top ?? 0
        const sectionTop = section.current?.getBoundingClientRect().top ?? rootTop
        const scrolledInto = sectionTop < rootTop - 8
        const reachedEnd = entry.isIntersecting || entry.boundingClientRect.top < rootTop
        if (!scrolledInto || !reachedEnd) return
        passed.current = true
        props.onPassed(props.file.path)
      },
      { root },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [props.root, props.onPassed, props.file.path])

  const jump = useCallback(() => section.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }), [])
  const comparison = props.comparison ?? state.data
  const failed = props.comparison === undefined && state.status === 'error'

  return (
    <section
      ref={section}
      id={`review-file-${String(props.file.index)}`}
      data-review-file={props.file.path}
      className="dshx:min-w-0 dshx:border-b dshx:border-border"
    >
      <header
        data-review-file-header=""
        className="dshx:sticky dshx:top-0 dshx:z-10 dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2 dshx:border-b dshx:border-border dshx:bg-background/95 dshx:px-3 dshx:py-1.5 dshx:backdrop-blur"
      >
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={props.collapsed ? 'Expand file' : 'Collapse file'}
          aria-expanded={!props.collapsed}
          onClick={props.onToggleCollapsed}
        >
          <DisclosureGlyph open={!props.collapsed} />
        </Button>
        <button
          type="button"
          className="dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:text-start dshx:text-xs dshx:font-medium"
          onClick={jump}
          data-review-file-path=""
        >
          {props.file.display}
        </button>
        <span className="dshx:shrink-0 dshx:font-mono dshx:text-[11px] dshx:text-success">+{props.file.additions}</span>
        <span className="dshx:shrink-0 dshx:font-mono dshx:text-[11px] dshx:text-destructive">−{props.file.deletions}</span>
        <CommentCountBadge count={props.commentCount} />
        <label className="dshx:inline-flex dshx:shrink-0 dshx:cursor-pointer dshx:items-center dshx:gap-1.5 dshx:text-[11px] dshx:text-muted-foreground">
          <Checkbox
            aria-label={`Mark ${props.file.display} as viewed`}
            checked={props.viewed}
            className={cn('dshx:size-3.5 dshx:data-[state=checked]:border-success dshx:data-[state=checked]:bg-success')}
            data-review-viewed={props.file.path}
            onCheckedChange={props.onToggleViewed}
          />
          Viewed
        </label>
      </header>
      {props.collapsed ? null : !near ? (
        <div
          style={{ minHeight: placeholderHeight(props.file) }}
          aria-hidden
          className="dshx:flex dshx:items-center dshx:justify-center"
          data-review-placeholder=""
        >
          <span className="dshx:text-[11px] dshx:text-muted-foreground">Loading comparison…</span>
        </div>
      ) : failed ? (
        <div className="dshx:flex dshx:items-center dshx:gap-2 dshx:px-3 dshx:py-2 dshx:text-xs dshx:text-muted-foreground">
          <TriangleAlert className="dshx:size-3.5" aria-hidden />
          The comparison could not be loaded.
          <Button size="xs" variant="outline" onClick={() => setAttempt(value => value + 1)}>
            <RefreshCw aria-hidden /> Retry
          </Button>
        </div>
      ) : comparison === undefined ? (
        <div style={{ minHeight: placeholderHeight(props.file) }} className="dshx:flex dshx:items-center dshx:justify-center" role="status">
          <span className="dshx:text-[11px] dshx:text-muted-foreground">Loading comparison…</span>
        </div>
      ) : (
        <ReviewDiff path={props.file.path} comparison={comparison} layout={props.layout} wrap={props.wrap} comments={props.comments} />
      )}
      <div ref={bottom} aria-hidden />
    </section>
  )
}
