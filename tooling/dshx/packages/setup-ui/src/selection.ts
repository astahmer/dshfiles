import type { SetupPreset, SetupRequest, SetupState } from './api.js'

/** What the Preset screen edits: the profile name, the chosen packs (Core implied) and whether to keep other plugins. */
export interface SetupSelection {
  readonly profile: string
  readonly packs: readonly string[]
  readonly extend: boolean
}

const sameSet = (left: readonly string[], right: readonly string[]): boolean => left.length === right.length && left.every(id => right.includes(id))

/** The default selection: the CLI's --packs, else its --preset, else nothing beyond Core. */
const initial = (state: SetupState): SetupSelection => ({
  profile: state.defaults.profile,
  packs: state.defaults.packs ?? state.presets.find(preset => preset.id === state.defaults.preset)?.packs ?? [],
  extend: false,
})

/** The preset whose packs are exactly the selection; an edited list matches none. */
const presetOf = (selection: SetupSelection, presets: readonly SetupPreset[]): SetupPreset | undefined =>
  presets.find(preset => sameSet(preset.packs, selection.packs))

const withPreset = (selection: SetupSelection, presets: readonly SetupPreset[], id: string): SetupSelection => ({
  ...selection,
  packs: presets.find(preset => preset.id === id)?.packs ?? selection.packs,
})

const toggle = (selection: SetupSelection, pack: string, on: boolean): SetupSelection => ({
  ...selection,
  packs: on ? [...new Set([...selection.packs, pack])] : selection.packs.filter(id => id !== pack),
})

/** The same rule as the server's profile name schema: a plain directory name. */
const validName = (name: string): boolean => /^[A-Za-z0-9._-]+$/u.test(name)

const requestOf = (selection: SetupSelection): SetupRequest => ({ profile: selection.profile, packs: selection.packs, extend: selection.extend })

export class SelectionModel {
  static readonly initial = initial
  static readonly presetOf = presetOf
  static readonly withPreset = withPreset
  static readonly toggle = toggle
  static readonly validName = validName
  static readonly requestOf = requestOf
}
