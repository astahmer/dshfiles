import { identityToneClass, identityToneIndex } from '@dshfiles/plugin-ui/components/palette-picker'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useSyncExternalStore } from 'react'

/**
 * An agent's identity colour: the slot it stores, else the slot its handle hashes to with the shared project hash
 * (`identityToneIndex`), so an agent saved before colours keeps one stable colour on every surface.
 */
const slotOf = (agent: { readonly handle: string; readonly tone?: number | null | undefined }): number => agent.tone ?? identityToneIndex(agent.handle)


/**
 * The chosen colours by handle, for the chips: a chip knows only its handle, and the registry list the reference
 * decorations already read fills this. A handle missing here takes its hashed default.
 */
let chosen: ReadonlyMap<string, number> = new Map()
const listeners = new Set<() => void>()

const setAgents = (agents: readonly { readonly handle: string; readonly tone?: number | undefined }[]): void => {
  const next = new Map(agents.flatMap(agent => (agent.tone === undefined ? [] : [[agent.handle, agent.tone] as const])))
  const same = next.size === chosen.size && [...next].every(([handle, tone]) => chosen.get(handle) === tone)
  if (same) return
  chosen = next
  for (const listener of listeners) listener()
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The slot one handle paints with, re-rendering when the registry list changes it. */
const useSlot = (handle: string): number => useSyncExternalStore(subscribe, () => slotOf({ handle, tone: chosen.get(handle) }))

export class AgentTone {
  static readonly slotOf = slotOf
  /** The kit's identity tone class: `color` is the active theme's slot, so the wash and the ink follow the theme. */
  static readonly toneClass = identityToneClass
  static readonly setAgents = setAgents
  static readonly useSlot = useSlot
}

/** Ink for text on the tone's own wash: the tone pulled toward the label colour, which holds AA (as `ProjectMark`). */
export const AGENT_TONE_INK = 'dshx-project-mark-letters'

/**
 * An agent's glyph on its identity tile: the tone at 18% behind the glyph, like `ProjectMark`. An emoji keeps its own
 * colours; a text glyph or the name's first letter takes the AA ink. Decoration: the name beside it is the label.
 */
export const AgentGlyph = (props: {
  readonly glyph: string
  readonly name: string
  readonly slot: number
  /** `dense` is a 16px tile for buttons, `default` 20px for a list row, `large` the 36px card tile. */
  readonly size?: 'dense' | 'default' | 'large' | undefined
  readonly className?: string | undefined
}): JSX.Element => {
  const size = props.size ?? 'default'
  const text = props.glyph === '' ? props.name.slice(0, 1).toUpperCase() : props.glyph
  return (
    <span
      aria-hidden
      data-slot="agent-glyph"
      data-tone={props.slot}
      className={cn(
        'dshx:inline-flex dshx:shrink-0 dshx:items-center dshx:justify-center dshx:bg-current/18 dshx:leading-none dshx:whitespace-nowrap dshx:select-none',
        size === 'large' && 'dshx:size-9 dshx:rounded-xl dshx:text-lg',
        size === 'default' && 'dshx:h-5 dshx:min-w-5 dshx:rounded-sm dshx:px-0.5 dshx:text-xs',
        size === 'dense' && 'dshx:h-4 dshx:min-w-4 dshx:rounded-sm dshx:px-0.5 dshx:text-2xs',
        identityToneClass(props.slot),
        props.className,
      )}
    >
      <span className={cn(AGENT_TONE_INK, props.glyph === '' && 'dshx:font-semibold')}>{text}</span>
    </span>
  )
}
