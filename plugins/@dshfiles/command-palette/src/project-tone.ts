// Chart tokens follow the Host theme, so each tone reads in light and dark.
const glyphTones = [
  'dshx:bg-chart-1/15 dshx:text-chart-1',
  'dshx:bg-chart-2/15 dshx:text-chart-2',
  'dshx:bg-chart-3/15 dshx:text-chart-3',
  'dshx:bg-chart-4/15 dshx:text-chart-4',
  'dshx:bg-chart-5/15 dshx:text-chart-5',
] as const

const textTones = ['dshx:text-chart-1/85', 'dshx:text-chart-2/85', 'dshx:text-chart-3/85', 'dshx:text-chart-4/85', 'dshx:text-chart-5/85'] as const

/** Stable per project name, so a project keeps its tone across reloads and devices. */
const toneIndex = (project: string): number => {
  let hash = 0
  for (const character of project) hash = (hash * 31 + character.charCodeAt(0)) | 0
  return Math.abs(hash) % glyphTones.length
}

const projectGlyphTone = (project: string): string => glyphTones[toneIndex(project)] ?? glyphTones[0]

const projectTextTone = (project: string): string => textTones[toneIndex(project)] ?? textTones[0]

export class ProjectTone {
  static readonly glyph = projectGlyphTone
  static readonly text = projectTextTone
}
