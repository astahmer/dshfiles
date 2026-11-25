import { projectToneIndex } from '@dshfiles/plugin-ui/components/ui/project-mark'

const TONE_COUNT = 6
/** Balanced tones whose hues sit under 40° apart and read as one colour at chip size: 225°/195° and 305°/340°. */
const NEIGHBOUR = new Map([
  [0, 5],
  [5, 0],
  [3, 4],
  [4, 3],
])
/** A tag this long or shorter fits beside a title without pushing it into an early ellipsis. */
const INLINE_TAG_MAX = 16

interface FeedChips {
  readonly tags: readonly string[]
  readonly attention: string
  readonly proposal: unknown
  readonly project: string | null
  readonly attachments: readonly unknown[]
  readonly links: readonly unknown[]
  readonly activity: { readonly comments: number }
  readonly freshness: string
}

/** Presentation rules of the Backlog feed (round five P6). */
export class FeedLook {
  /** True when the rows have more than one author; with one, the avatar says nothing a row needs. */
  static readonly authorsDiffer = (items: readonly { readonly actors: readonly { readonly id: string; readonly role: string }[] }[]): boolean =>
    new Set(items.map(item => item.actors.find(actor => actor.role === 'owner')?.id ?? item.actors[0]?.id)).size > 1

  /**
   * A tag's identity tone: the kit's status-safe project palette, hashed from the tag so it never changes between
   * reloads. The class sets `color`; the chip tints its fill from it.
   */
  static readonly tagTone = (tag: string): string => `project-tone-balanced-${String(projectToneIndex(tag))}`

  /**
   * The tones of the tags on one screen. Each tag starts at its hashed tone; a tag whose tone is taken, or whose hue
   * neighbours a taken one, moves to the next free tone that does not, so two tags never share a colour while the
   * palette has room (#docs and #finance hashed to teal and cyan, council round 3, D2). Tags are placed in name order,
   * so the same set always gets the same tones whatever order the rows are in.
   */
  static readonly tagTones = (tags: Iterable<string>): ReadonlyMap<string, string> => {
    const used = new Set<number>()
    const tones = new Map<string, string>()
    for (const tag of [...new Set(tags)].sort()) {
      const own = projectToneIndex(tag)
      const order = Array.from({ length: TONE_COUNT }, (_, step) => (own + step) % TONE_COUNT)
      const neighbour = (tone: number): boolean => {
        const near = NEIGHBOUR.get(tone)
        return near !== undefined && used.has(near)
      }
      const tone = order.find(candidate => !used.has(candidate) && !neighbour(candidate)) ?? order.find(candidate => !used.has(candidate)) ?? own
      used.add(tone)
      tones.set(tag, `project-tone-balanced-${String(tone)}`)
    }
    return tones
  }

  /**
   * The one tag a row shows beside its title: only when it is the row's single chip and short, so the row stays one
   * 44 px line. Several chips, or a long tag, keep the line under the title.
   */
  static readonly inlineTag = (item: FeedChips): string | null => {
    const [tag, ...rest] = item.tags
    const alone =
      rest.length === 0 &&
      item.attention === 'none' &&
      item.proposal === null &&
      item.project === null &&
      item.attachments.length === 0 &&
      item.links.length === 0 &&
      item.activity.comments === 0 &&
      item.freshness === 'fresh'
    return alone && tag !== undefined && tag.length <= INLINE_TAG_MAX ? tag : null
  }

  /**
   * A tag chip: the tone at 14 % behind its text, no border. Its text takes the kit's identity-letter mix (the tone
   * pulled a quarter toward ink, `dshx-project-mark-letters`), which the kit tests for AA on that tint over bg, panel,
   * raised and selected in both schemes.
   */
  static readonly TAG_CHIP =
    'dshx:inline-flex dshx:h-5 dshx:shrink-0 dshx:items-center dshx:rounded-md dshx:bg-current/14 dshx:px-1.5 dshx:text-2xs dshx:font-medium'
}
