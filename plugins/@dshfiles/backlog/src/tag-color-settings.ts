import { Effect } from 'effect'
import { BacklogSettingsTag } from './backlog-settings.js'
import { TagColors } from './tag-colors.js'

/** Choose (or, with `null`, clear) one tag's slot in Backlog settings; returns what the tag now uses. */
const set = (input: { readonly tag: string; readonly slot: number | null }) =>
  Effect.gen(function* () {
    const settings = yield* BacklogSettingsTag
    const entries = TagColors.withSlot((yield* settings.get).tagColors, input.tag, input.slot)
    yield* settings.update({ tagColors: entries })
    return { tag: input.tag, slot: TagColors.mapOf(entries).get(input.tag) ?? null }
  })

/** The `tagColors` a list answer carries for its items. */
const listed = (items: readonly { readonly tags: readonly string[] }[]) =>
  Effect.map(
    BacklogSettingsTag.use(settings => settings.get),
    value => TagColors.ofTags(TagColors.mapOf(value.tagColors), items),
  )

/** The Host side of tag colours: `backlog_set_tag_color` and `backlog_list`'s `tagColors`. */
export class TagColorSettings {
  static readonly set = set
  static readonly listed = listed
}
