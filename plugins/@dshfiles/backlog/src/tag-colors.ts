/** The identity palette's slot count (the kit's six project tones, `IDENTITY_SLOT_COUNT`). */
const SLOT_COUNT = 6

/** One tag's chosen colour: a slot of the active theme's identity palette, so a theme switch recolours it. */
export interface TagColorEntry {
  readonly tag: string
  readonly slot: number
}

const isSlot = (slot: number): boolean => Number.isInteger(slot) && slot >= 0 && slot < SLOT_COUNT

/** Every chosen slot, keyed by the tag as items store it; an out-of-range stored slot is ignored, so the tag keeps its default. */
const mapOf = (entries: readonly TagColorEntry[]): ReadonlyMap<string, number> =>
  new Map(entries.filter(entry => entry.tag !== '' && isSlot(entry.slot)).map(entry => [entry.tag, entry.slot] as const))

/** The list with one tag's slot replaced or added; `null` removes it, so the tag returns to its hashed default. */
const withSlot = (entries: readonly TagColorEntry[], tag: string, slot: number | null): TagColorEntry[] => {
  const others = entries.filter(entry => entry.tag !== tag)
  return slot === null ? others : [...others, { tag, slot }]
}

/** The chosen slots of the tags these items carry, sorted by tag: what `backlog_list` reports beside them. */
const ofTags = (chosen: ReadonlyMap<string, number>, items: readonly { readonly tags: readonly string[] }[]): TagColorEntry[] =>
  [...new Set(items.flatMap(item => item.tags))]
    .sort()
    .flatMap(tag => {
      const slot = chosen.get(tag)
      return slot === undefined ? [] : [{ tag, slot }]
    })

/**
 * A Backlog tag's chosen identity colour (round eight, lane T), shared by the Host and the panel. Unpicked tags keep
 * `projectToneIndex(tag)`.
 */
export class TagColors {
  static readonly slotCount = SLOT_COUNT
  static readonly mapOf = mapOf
  static readonly withSlot = withSlot
  static readonly ofTags = ofTags
}
