import { projectToneIndex } from '@dshfiles/plugin-ui/components/ui/project-mark'

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
   * A tag chip: the tone at 14 % behind its text, no border. Its text takes the kit's identity-letter mix (the tone
   * pulled a quarter toward ink, `dshx-project-mark-letters`), which the kit tests for AA on that tint over bg, panel,
   * raised and selected in both schemes.
   */
  static readonly TAG_CHIP =
    'dshx:inline-flex dshx:h-5 dshx:shrink-0 dshx:items-center dshx:rounded-md dshx:bg-current/14 dshx:px-1.5 dshx:text-2xs dshx:font-medium'
}
