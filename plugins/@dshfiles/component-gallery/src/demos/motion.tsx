import * as React from 'react'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { PresenceList } from '@dshfiles/plugin-ui/components/motion/presence-list'
import { animate, drawStroke, motionSafe, presets, springs, type MotionPreset } from '@dshfiles/plugin-ui/motion'
import { useCountUp, useEnter } from '@dshfiles/plugin-ui/motion/react'
import type { GalleryDemo } from './types.js'

function PresetsDemo() {
  // SAFETY: `presets` is a closed `as const` literal, so its own keys are exactly `MotionPreset`.
  const names = Object.keys(presets) as MotionPreset[]
  const ref = React.useRef<HTMLDivElement | null>(null)
  const play = (name: MotionPreset, element: HTMLElement) => animate(element, presets[name], motionSafe(springs.smooth))
  useEnter(ref, 'riseIn', { children: true, stagger: 0.04 })
  return (
    <div ref={ref} className="dshx:grid dshx:grid-cols-3 dshx:gap-2">
      {names.map(name => (
        <button
          key={name}
          type="button"
          onClick={event => play(name, event.currentTarget)}
          className="dshx:rounded-md dshx:border dshx:border-border dshx:bg-background dshx:px-2 dshx:py-3 dshx:font-mono! dshx:text-xs dshx:hover:bg-accent"
        >
          {name}
        </button>
      ))}
    </div>
  )
}

// SAFETY: `springs` is a closed `as const` literal, so its own entries pair each spring name with its options.
const lanes = Object.entries(springs) as [keyof typeof springs, (typeof springs)[keyof typeof springs]][]

function SpringsDemo() {
  const refs = React.useRef<(HTMLSpanElement | null)[]>([])
  const [right, setRight] = React.useState(false)
  React.useEffect(() => {
    refs.current.forEach((dot, index) => {
      const lane = lanes[index]
      if (dot == null || lane === undefined) return
      animate(dot, { left: right ? 'calc(100% - 14px)' : '0px' }, motionSafe(lane[1]))
    })
  }, [right])
  return (
    <div className="dshx:flex dshx:flex-col dshx:gap-3">
      {lanes.map(([name], index) => (
        <div key={name} className="dshx:flex dshx:items-center dshx:gap-3">
          <span className="dshx:w-14 dshx:font-mono dshx:text-xs dshx:text-muted-foreground">{name}</span>
          <div className="dshx:relative dshx:h-3.5 dshx:flex-1 dshx:rounded-full dshx:bg-muted">
            <span ref={el => (refs.current[index] = el)} className="dshx:absolute dshx:top-0 dshx:left-0 dshx:size-3.5 dshx:rounded-full dshx:bg-foreground" />
          </div>
        </div>
      ))}
      <Button size="sm" variant="outline" className="dshx:self-start" onClick={() => setRight(value => !value)}>
        Move
      </Button>
    </div>
  )
}

function PresenceDemo() {
  const counter = React.useRef(4)
  const [items, setItems] = React.useState(() => [1, 2, 3].map(n => ({ id: n, label: `Task ${n}` })))
  const add = () => setItems(list => [{ id: counter.current, label: `Task ${counter.current++}` }, ...list])
  const shuffle = () => setItems(list => [...list].sort(() => Math.random() - 0.5))
  const remove = (id: number) => setItems(list => list.filter(item => item.id !== id))
  return (
    <div className="dshx:flex dshx:flex-col dshx:gap-3">
      <div className="dshx:flex dshx:gap-2">
        <Button size="sm" variant="outline" onClick={add}>
          Add
        </Button>
        <Button size="sm" variant="outline" onClick={shuffle}>
          Shuffle
        </Button>
      </div>
      <PresenceList
        className="dshx:flex dshx:flex-col dshx:gap-1.5"
        items={items.map(item => ({
          key: String(item.id),
          node: (
            <div className="dshx:flex dshx:items-center dshx:justify-between dshx:rounded-md dshx:border dshx:border-border dshx:bg-background dshx:px-3 dshx:py-2 dshx:text-sm">
              {item.label}
              <Button size="xs" variant="ghost" onClick={() => remove(item.id)}>
                Remove
              </Button>
            </div>
          ),
        }))}
      />
    </div>
  )
}

function CountUpDemo() {
  const [value, setValue] = React.useState(12840)
  const tokens = useCountUp<HTMLSpanElement>(value)
  const cost = useCountUp<HTMLSpanElement>(value * 0.0000031, { format: n => `$${n.toFixed(4)}` })
  return (
    <div className="dshx:flex dshx:items-end dshx:gap-6">
      <div>
        <div className="dshx:text-xs dshx:text-muted-foreground">Tokens</div>
        <span ref={tokens} className="dshx:text-2xl dshx:font-semibold dshx:tabular-nums" />
      </div>
      <div>
        <div className="dshx:text-xs dshx:text-muted-foreground">Cost</div>
        <span ref={cost} className="dshx:text-2xl dshx:font-semibold dshx:tabular-nums" />
      </div>
      <Button size="sm" variant="outline" onClick={() => setValue(v => v + Math.round(2000 + Math.random() * 9000))}>
        Add usage
      </Button>
    </div>
  )
}

function DrawStrokeDemo() {
  const ref = React.useRef<SVGPathElement | null>(null)
  React.useLayoutEffect(() => {
    if (ref.current == null) return
    const controls = drawStroke(ref.current, { duration: 1.2 })
    return () => controls.stop()
  }, [])
  return (
    <svg viewBox="0 0 240 60" className="dshx:h-16 dshx:w-full dshx:text-foreground" aria-hidden>
      <path
        ref={ref}
        d="M4 50 C 40 50, 40 10, 80 10 S 120 50, 160 30 S 210 6, 236 14"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}

export const motionDemos: readonly GalleryDemo[] = [
  {
    id: 'motion-presets',
    title: 'Presets',
    description: 'Enter keyframes every component shares. Click one to play it.',
    source: "import { presets, springs, enter } from '@dshfiles/plugin-ui/motion'",
    render: () => <PresetsDemo />,
  },
  {
    id: 'motion-springs',
    title: 'Springs',
    description: 'snappy for chrome, smooth for content, bouncy for confirmation, gentle for big surfaces.',
    source: "import { springs } from '@dshfiles/plugin-ui/motion'",
    render: () => <SpringsDemo />,
  },
  {
    id: 'motion-presence-list',
    title: 'PresenceList',
    description: 'Keyed list with enter, exit-and-collapse and FLIP reorder. The base of queues and feeds.',
    source: "import { PresenceList } from '@dshfiles/plugin-ui/components/motion/presence-list'",
    render: () => <PresenceDemo />,
  },
  {
    id: 'motion-count-up',
    title: 'useCountUp',
    description: 'Numbers tick from their previous value: tokens, cost, durations.',
    source: "import { useCountUp } from '@dshfiles/plugin-ui/motion/react'",
    render: () => <CountUpDemo />,
  },
  {
    id: 'motion-draw-stroke',
    title: 'drawStroke',
    description: 'Draws an SVG path in: sparklines, graph edges, check marks.',
    source: "import { drawStroke } from '@dshfiles/plugin-ui/motion'",
    render: () => <DrawStrokeDemo />,
  },
]
