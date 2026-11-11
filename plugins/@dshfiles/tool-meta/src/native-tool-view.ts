/** Which `tool.call.toolview` entry a file card falls back to when it has nothing better to show. */

interface ToolViewEntry {
  readonly options: { readonly key?: string | undefined; readonly priority?: number | undefined; readonly registrant?: string | undefined }
  readonly component: unknown
}

/**
 * The entry that renders `toolName` once this plugin's own cards step aside: the winning entry among the others.
 * The card's own entry wins the slot, so choosing it again would render the card inside itself without end, which
 * builds React fibers until the tab runs out of memory.
 * @param input.entries - every `tool.call.toolview` entry, as the slot ledger lists them.
 * @param input.toolName - the tool the card renders.
 * @param input.registrant - this plugin's registrant name.
 * @param input.own - the components this plugin registered there.
 * @returns the native entry, or undefined when no other plugin renders the tool.
 */
const pick = <Entry extends ToolViewEntry>(input: {
  readonly entries: readonly Entry[]
  readonly toolName: string
  readonly registrant: string
  readonly own: ReadonlySet<unknown>
}): Entry | undefined =>
  input.entries
    .filter(entry => entry.options.key === input.toolName && entry.options.registrant !== input.registrant && !input.own.has(entry.component))
    .toSorted((left, right) => (left.options.priority ?? 0) - (right.options.priority ?? 0))[0]

export class NativeToolView {
  static readonly pick = pick
}
