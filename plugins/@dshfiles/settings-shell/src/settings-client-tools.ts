import { defineClientTool, type ClientToolItem } from '@dshfiles/dshx/client'
import * as Schema from 'effect/Schema'
import type { OpenSettingsRequest } from './open-settings.js'

/** One Settings entry an Agent can open: a section, a plugin page or a linked page. */
export type SettingsDestination = {
  readonly id: string
  readonly label: string
  readonly group: string
}

const text = (max: number) => Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(max))

const openInput = Schema.Struct({
  section: Schema.optionalKey(text(200)).annotate({
    description:
      'Entry id from settings_sections ("market", "models", "plugin:dshfiles-main-tabs") or its exact label ("Plugin Market"). Omit for the Settings home.',
  }),
  target: Schema.optionalKey(text(200)).annotate({ description: 'A search entry id inside that section to scroll to.' }),
  query: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(200))).annotate({ description: 'Search Settings for this text.' }),
  newTab: Schema.optionalKey(Schema.Boolean).annotate({
    description: 'Open Settings in its own main tab beside the current one (when the user says “in a new tab”); otherwise the user’s usual place.',
  }),
})

/**
 * The entry a request names, by id or by label (case-insensitive).
 * @param destinations - the entries Settings lists now.
 * @param section - an id or label.
 * @returns the entry, or undefined when none matches.
 */
const resolve = (destinations: readonly SettingsDestination[], section: string): SettingsDestination | undefined => {
  const byId = destinations.find(entry => entry.id === section)
  if (byId !== undefined) return byId
  const wanted = section.trim().toLocaleLowerCase()
  return destinations.find(entry => entry.label.toLocaleLowerCase() === wanted)
}

/**
 * The client tools Settings offers Agents through the client bridge: list its entries, open one.
 * @param ports - the entries Settings lists now, and the same open path `dshfiles:open-settings` takes.
 * @returns the tools to add to `ClientTools`.
 */
const create = (ports: {
  readonly destinations: () => readonly SettingsDestination[]
  readonly open: (request: OpenSettingsRequest) => void
  /** Give Settings its own main tab beside the current one; false while tabs are off or not loaded. */
  readonly openInNewTab: () => boolean
}): readonly ClientToolItem[] => [
  defineClientTool({
    name: 'settings_sections',
    title: 'List Settings sections',
    description: 'The Settings entries this window can open (sections, plugin pages, linked pages) with their id, label and group. Read-only.',
    readOnly: true,
    input: Schema.Struct({}),
    execute: () => ({ sections: ports.destinations() }),
  }),
  defineClientTool({
    name: 'settings_open',
    title: 'Open Settings',
    description:
      'Open Settings in the user’s window at one entry, optionally scrolled to a control or searching; newTab: true gives it its own tab beside the current one. Call only when the user asked to see Settings.',
    readOnly: false,
    input: openInput,
    execute: input => {
      const request: { -readonly [Key in keyof OpenSettingsRequest]: OpenSettingsRequest[Key] } = {}
      let opened: SettingsDestination | undefined
      if (input.section !== undefined) {
        const destinations = ports.destinations()
        opened = resolve(destinations, input.section)
        if (opened === undefined)
          throw new Error(
            `Settings has no entry ${JSON.stringify(input.section)}. Entries: ${destinations.map(entry => `${entry.id} (${entry.label})`).join(', ')}.`,
          )
        request.section = opened.id
      }
      if (input.target !== undefined) request.target = input.target
      if (input.query !== undefined) request.query = input.query
      // The tab first, so the section opens in it rather than in the tab it replaces.
      const newTab = input.newTab === true ? ports.openInNewTab() : false
      ports.open(request)
      return {
        opened: opened ?? { id: 'home', label: 'Settings', group: '' },
        newTab,
        ...(input.newTab === true && !newTab && { note: 'Tabs are off in this window (Settings › Main tabs), so Settings opened in its usual place.' }),
      }
    },
  }),
]

export class SettingsClientTools {
  static readonly create = create
  static readonly resolve = resolve
}
