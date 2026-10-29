import type { ProjectColorPalette } from './organization.js'

const tonesPerPalette = 6

/** Stable per project name, so a project keeps its tone across reloads and devices. */
const toneIndex = (project: string): number => {
  let hash = 0
  for (const character of project) hash = (hash * 31 + character.charCodeAt(0)) | 0
  return Math.abs(hash) % tonesPerPalette
}

export const projectTextTone = (project: string, palette: ProjectColorPalette = 'balanced'): string => {
  return `project-tone-${palette}-${toneIndex(project)}`
}
