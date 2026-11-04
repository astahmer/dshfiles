import * as React from 'react'
import type { ValueAnimationTransition } from 'motion'
import { animate, drawStroke, durations, easings, motionSafe, presets, springs, type AnimationPlaybackControls } from '../../motion/index.js'
import { FolderIcon, GitBranchIcon, RotateCcwIcon } from '../../icons.js'
import { cn } from '../../lib/utils.js'
import { AutoHeight } from './auto-height.js'
import { RollingNumber } from './text.js'

export interface Checkpoint {
  readonly id: string
  readonly label: string
  /** A lucide icon or letter tile for the tool that made it. */
  readonly icon?: React.ReactNode
  /** Which lane the attempt runs in. A retry branches into the other lane from the last good checkpoint. */
  readonly lane: 0 | 1
  /** Part of an attempt that was rolled back: hollow dot, dimmed row, grey branch. */
  readonly abandoned?: boolean
  /** Retry number, shown as an "Attempt N" chip. */
  readonly attempt?: number
  /** Short state note ("Stopped"). */
  readonly note?: string
  readonly files?: number
  /** Elapsed time when the checkpoint was taken ("2:40"). */
  readonly time: string
}

export interface CheckpointGraphProps extends Omit<React.HTMLAttributes<HTMLElement>, 'children'> {
  readonly checkpoints: readonly Checkpoint[]
  /** What the run is for ("Ship the pricing page"). */
  readonly goal?: string
  readonly attempts?: number
  /** Run cost in dollars. */
  readonly cost?: number
  readonly selectedId?: string | undefined
  readonly onRestore?: (checkpoint: Checkpoint) => void
}

const ROW = 40
const LANE_X = [12, 30] as const

interface Segment {
  readonly key: string
  readonly d: string
  readonly abandoned: boolean
}

const link = (a: number, laneA: 0 | 1, b: number, laneB: 0 | 1): string => {
  const xa = LANE_X[laneA]
  const xb = LANE_X[laneB]
  const ya = a * ROW + ROW / 2
  const yb = b * ROW + ROW / 2
  if (xa === xb) return `M ${xa} ${ya} L ${xb} ${yb}`
  return `M ${xa} ${ya} C ${xa} ${ya + 14}, ${xb} ${ya + 10}, ${xb} ${ya + 26} L ${xb} ${yb}`
}

const segmentsOf = (checkpoints: readonly Checkpoint[]): readonly Segment[] => {
  const segments: Segment[] = []
  let lastGood = -1
  checkpoints.forEach((checkpoint, index) => {
    if (checkpoint.abandoned === true) {
      const parent = index > 0 && checkpoints[index - 1]?.abandoned === true ? index - 1 : lastGood
      const from = checkpoints[parent]
      if (from !== undefined) segments.push({ key: `x:${from.id}>${checkpoint.id}`, d: link(parent, from.lane, index, checkpoint.lane), abandoned: true })
      return
    }
    const from = checkpoints[lastGood]
    if (from !== undefined) segments.push({ key: `a:${from.id}>${checkpoint.id}`, d: link(lastGood, from.lane, index, checkpoint.lane), abandoned: false })
    lastGood = index
  })
  // Grey branches under the live line.
  return segments.sort((left, right) => Number(right.abandoned) - Number(left.abandoned))
}

/**
 * Git for an agent run: every checkpoint the agent took, on a lane graph. A retry branches from the last good
 * checkpoint into the other lane while the abandoned attempt greys out; new checkpoints draw their edge, pop their
 * dot and reveal their label left to right. Hover a row to restore it.
 */
export function CheckpointGraph({ checkpoints, goal, attempts, cost, selectedId, onRestore, className, ...props }: CheckpointGraphProps) {
  const svgRef = React.useRef<SVGSVGElement>(null)
  const seen = React.useRef<Set<string> | null>(null)
  const segments = segmentsOf(checkpoints)
  const lastGoodId = [...checkpoints].reverse().find(checkpoint => checkpoint.abandoned !== true)?.id

  React.useLayoutEffect(() => {
    const svg = svgRef.current
    if (svg == null) return
    const keys = Array.from(svg.querySelectorAll<SVGElement>('[data-key]'))
    if (seen.current === null) {
      seen.current = new Set(keys.map(element => element.dataset.key ?? ''))
      return
    }
    const known = seen.current
    const running: AnimationPlaybackControls[] = []
    for (const element of keys) {
      const key = element.dataset.key ?? ''
      if (known.has(key)) continue
      known.add(key)
      if (element instanceof SVGPathElement) {
        const draw = drawStroke(element, { duration: durations.slow, ease: easings.out })
        void draw.finished.then(() => {
          element.style.strokeDasharray = ''
          element.style.strokeDashoffset = ''
        })
        running.push(draw)
      } else {
        running.push(animate(element, { transform: ['scale(0)', 'scale(1)'] }, motionSafe({ ...springs.bouncy, delay: 0.22 })))
      }
    }
    return () => {
      for (const controls of running) controls.complete()
    }
  })

  return (
    <section aria-label="Checkpoints" className={cn('dshx:@container dshx:flex dshx:flex-col dshx:gap-1.5', className)} {...props}>
      <header className="dshx:flex dshx:h-9 dshx:min-w-0 dshx:items-center dshx:gap-2.5 dshx:text-sm">
        <GitBranchIcon aria-hidden className="dshx:size-4 dshx:shrink-0 dshx:text-muted-foreground" />
        <span className="dshx:shrink-0 dshx:font-semibold dshx:text-foreground">Checkpoints</span>
        {goal !== undefined ? (
          <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:text-muted-foreground dshx:@max-pane-narrow:sr-only">{goal}</span>
        ) : null}
        <span className="dshx:ml-auto dshx:flex dshx:shrink-0 dshx:items-center dshx:gap-1 dshx:text-muted-foreground dshx:tabular-nums">
          <RollingNumber value={checkpoints.length} />
          <span>{checkpoints.length === 1 ? 'checkpoint' : 'checkpoints'}</span>
          {attempts !== undefined && attempts > 1 ? (
            <span className="dshx:inline-flex dshx:items-center dshx:gap-1 dshx:@max-pane-narrow:hidden">
              <span aria-hidden>·</span>
              <RollingNumber value={attempts} />
              <span>attempts</span>
            </span>
          ) : null}
          {cost !== undefined ? (
            <>
              <span aria-hidden>·</span>
              <RollingNumber value={cost} format={value => `$${value.toFixed(2)}`} />
            </>
          ) : null}
        </span>
      </header>
      <AutoHeight transition={springs.smooth}>
        <div className="dshx:relative">
          <svg
            ref={svgRef}
            aria-hidden
            width={44}
            height={Math.max(ROW, checkpoints.length * ROW)}
            className="dshx:pointer-events-none dshx:absolute dshx:top-0 dshx:left-0 dshx:overflow-visible"
          >
            {segments.map(segment => (
              <path
                key={segment.key}
                data-key={segment.key}
                d={segment.d}
                fill="none"
                strokeWidth={segment.abandoned ? 1.5 : 2}
                strokeLinecap="round"
                className={cn('dshx:motion-safe:transition-colors', segment.abandoned ? 'dshx:stroke-muted-foreground/40' : 'dshx:stroke-info')}
              />
            ))}
            {checkpoints.map((checkpoint, index) => {
              const head = checkpoint.id === lastGoodId && index === checkpoints.length - 1
              return (
                <circle
                  key={`${checkpoint.id}:${checkpoint.abandoned === true ? 'x' : 'a'}`}
                  data-key={`dot:${checkpoint.id}`}
                  cx={LANE_X[checkpoint.lane]}
                  cy={index * ROW + ROW / 2}
                  r={head ? 5 : 3.5}
                  strokeWidth={1.5}
                  style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
                  className={checkpoint.abandoned === true ? 'dshx:fill-card dshx:stroke-muted-foreground/50' : 'dshx:fill-info dshx:stroke-info'}
                />
              )
            })}
          </svg>
          <ol className="dshx:flex dshx:flex-col">
            {checkpoints.map(checkpoint => (
              <CheckpointRow
                key={checkpoint.id}
                checkpoint={checkpoint}
                selected={checkpoint.id === selectedId}
                fresh={seen.current !== null}
                onRestore={onRestore}
              />
            ))}
          </ol>
        </div>
      </AutoHeight>
    </section>
  )
}

function CheckpointRow({
  checkpoint,
  selected,
  fresh,
  onRestore,
}: {
  readonly checkpoint: Checkpoint
  readonly selected: boolean
  readonly fresh: boolean
  readonly onRestore: ((checkpoint: Checkpoint) => void) | undefined
}) {
  const rowRef = React.useRef<HTMLLIElement>(null)
  const appear = React.useRef(fresh)
  React.useLayoutEffect(() => {
    if (!appear.current || rowRef.current == null) return
    const controls = animate(rowRef.current, presets.riseIn, motionSafe(springs.smooth))
    return () => controls.complete()
  }, [])
  const abandoned = checkpoint.abandoned === true
  return (
    <li
      ref={rowRef}
      className={cn(
        'dshx:group dshx:relative dshx:flex dshx:h-10 dshx:items-center dshx:gap-2.5 dshx:rounded-md dshx:pr-1.5 dshx:pl-12 dshx:text-sm dshx:motion-safe:transition-colors',
        selected ? 'dshx:bg-accent/60' : 'dshx:hover:bg-accent/40',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'dshx:flex dshx:size-6 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded-md dshx:border dshx:border-border dshx:bg-card dshx:text-foreground dshx:motion-safe:transition-opacity dshx:[&_svg]:size-3.5',
          abandoned && 'dshx:opacity-45',
        )}
      >
        {checkpoint.icon ?? <span className="dshx:size-1.5 dshx:rounded-full dshx:bg-muted-foreground" />}
      </span>
      <span className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:items-center dshx:gap-2.5">
        <span
          className={cn('dshx:min-w-0 dshx:truncate dshx:motion-safe:transition-colors', abandoned ? 'dshx:text-muted-foreground/60' : 'dshx:text-foreground')}
        >
          <RevealText play={appear.current}>{checkpoint.label}</RevealText>
        </span>
        {checkpoint.attempt !== undefined ? (
          <span className="dshx:shrink-0 dshx:rounded-md dshx:bg-muted dshx:px-2 dshx:py-0.5 dshx:text-xs dshx:font-medium dshx:text-muted-foreground dshx:@max-pane-narrow:hidden">
            Attempt {checkpoint.attempt}
          </span>
        ) : null}
      </span>
      {checkpoint.note !== undefined ? (
        <span className="dshx:shrink-0 dshx:text-xs dshx:text-muted-foreground/70 dshx:@max-pane-narrow:hidden">{checkpoint.note}</span>
      ) : null}
      {onRestore !== undefined && !abandoned ? (
        <button
          type="button"
          onClick={() => onRestore(checkpoint)}
          aria-label={`Restore ${checkpoint.label}`}
          // Overlays the meta instead of reserving its width: an invisible button must not squeeze the label.
          className="dshx:absolute dshx:inset-y-1.5 dshx:right-12 dshx:inline-flex dshx:items-center dshx:gap-1 dshx:rounded-md dshx:border dshx:border-border dshx:bg-card dshx:px-1.5 dshx:text-xs dshx:text-muted-foreground dshx:opacity-0 dshx:shadow-sm dshx:outline-none dshx:group-hover:opacity-100 dshx:hover:bg-accent dshx:hover:text-foreground dshx:focus-visible:opacity-100 dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring/50 dshx:motion-safe:transition-opacity"
        >
          <RotateCcwIcon aria-hidden className="dshx:size-3" />
          Restore
        </button>
      ) : null}
      {checkpoint.files !== undefined ? (
        <span
          className={cn(
            'dshx:inline-flex dshx:shrink-0 dshx:items-center dshx:gap-1 dshx:text-[13px] dshx:text-muted-foreground dshx:@max-pane-narrow:hidden',
            abandoned && 'dshx:opacity-50',
          )}
        >
          <FolderIcon aria-hidden className="dshx:size-3.5" />
          {checkpoint.files} {checkpoint.files === 1 ? 'file' : 'files'}
        </span>
      ) : null}
      <span
        className={cn('dshx:w-10 dshx:shrink-0 dshx:text-right dshx:text-[13px] dshx:text-muted-foreground dshx:tabular-nums', abandoned && 'dshx:opacity-50')}
      >
        {checkpoint.time}
      </span>
    </li>
  )
}

/** Reveals its text left to right through a soft gradient mask, like a label being written. */
function RevealText({ play, children }: { readonly play: boolean; readonly children: React.ReactNode }) {
  const ref = React.useRef<HTMLSpanElement>(null)
  React.useLayoutEffect(() => {
    const element = ref.current
    if (!play || element == null) return
    const paint = (progress: number) => {
      const edge = progress * 140 - 20
      const mask = `linear-gradient(90deg, #000 ${edge}%, transparent ${edge + 30}%)`
      element.style.maskImage = mask
      element.style.setProperty('-webkit-mask-image', mask)
    }
    const clear = () => {
      element.style.maskImage = ''
      element.style.removeProperty('-webkit-mask-image')
    }
    paint(0)
    // SAFETY: motionSafe only rewrites timing keys (duration, delay, type), all valid on a value transition.
    const controls = animate(0, 1, {
      ...(motionSafe({ duration: 0.9, ease: easings.out, delay: 0.12 }) as ValueAnimationTransition<number>),
      onUpdate: paint,
      onComplete: clear,
    })
    return () => {
      controls.stop()
      clear()
    }
  }, [play])
  return <span ref={ref}>{children}</span>
}
