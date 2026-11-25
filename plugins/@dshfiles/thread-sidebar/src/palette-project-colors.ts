import type { PaletteProjectColorSource } from '@dshfiles/command-palette/palette-contract'
import { projectToneIndex } from '@dshfiles/plugin-ui/components/ui/project-mark'
import type { ProjectColorPalette } from './organization.js'
import type { ProjectChip } from './project-colors.js'
import { projectTextTone } from './project-tone.js'

/**
 * The command palette's project marks wear the thread list's colours, resolved as a row resolves them: the colour picked
 * for the project folder, else the palette tone its name hashes to. The palette cannot import the project picker (it
 * already depends on the palette), so the thread list hands its resolution over through the palette's registry.
 */
const sourceOf = (input: {
  readonly savedChipOf: (path: string) => ProjectChip | undefined
  readonly palette: ProjectColorPalette
}): PaletteProjectColorSource => ({
  colorOf: ({ path, title }) => {
    const saved = path === undefined ? undefined : input.savedChipOf(path)
    // A picked tone is one of the balanced palette's, as on the row; the palette draws the same ProjectMark tile.
    if (saved !== undefined) return saved.tone === undefined ? saved : { ...saved, palette: 'balanced' }
    return title.length === 0 ? undefined : { className: projectTextTone(title, input.palette), tone: projectToneIndex(title), palette: input.palette }
  },
})

export class PaletteProjectColorsModel {
  static readonly sourceOf = sourceOf
}
