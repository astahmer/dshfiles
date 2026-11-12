export const imageTitleFallback = (title: string): string => {
  const image = /^\s*!\[((?:\\.|[^\]\\])*)\]\([^()\n]+\)\s*$/u.exec(title)
  if (image === null) return title
  const label = (image[1] ?? '').replace(/\\([\\\]])/gu, '$1').trim()
  return label === '' ? 'Image' : `Image: ${label}`
}
