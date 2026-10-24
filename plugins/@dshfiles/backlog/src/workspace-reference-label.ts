export const workspaceReferenceLabel = (target: string): string => {
  let path = target
  try {
    path = decodeURIComponent(target)
  } catch {
    return target
  }
  return path.split(/[\\/]/u).filter(Boolean).at(-1) ?? target
}
