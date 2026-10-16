const textTones = ['dshx:text-chart-1/85', 'dshx:text-chart-2/85', 'dshx:text-chart-3/85', 'dshx:text-chart-4/85', 'dshx:text-chart-5/85'] as const

/** Stable per project name, so a project keeps its tone across reloads and devices. */
const toneIndex = (project: string): number => {
  let hash = 0
  for (const character of project) hash = (hash * 31 + character.charCodeAt(0)) | 0
  return Math.abs(hash) % textTones.length
}

export const projectTextTone = (project: string): string => textTones[toneIndex(project)] ?? textTones[0]
