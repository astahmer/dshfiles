const pathParts = (path: string): readonly string[] => path.split(/[\\/]/u).filter(Boolean)

const projectName = (path: string): string => pathParts(path).at(-1) ?? path

const aliasAtDepth = (path: string, depth: number): string => {
  const parts = pathParts(path)
  return (parts.slice(-depth).join('-') || path).replace(/\s+/gu, '-')
}

const projectAliases = (projects: readonly string[]): ReadonlyMap<string, string> => {
  const uniqueProjects = [...new Set(projects)]
  const aliases = new Map<string, string>()
  for (const path of uniqueProjects) {
    let depth = 1
    let alias = aliasAtDepth(path, depth)
    while (uniqueProjects.some(other => other !== path && aliasAtDepth(other, depth) === alias)) {
      depth += 1
      alias = depth > pathParts(path).length ? `path:${encodeURIComponent(path)}` : aliasAtDepth(path, depth)
    }
    aliases.set(alias, path)
  }
  return aliases
}

export const projectReferenceDraftToken = (path: string, projects: readonly string[]): string => {
  const alias = [...projectAliases(projects)].find(([, candidate]) => candidate === path)?.[0] ?? projectName(path).replace(/\s+/gu, '-')
  return `@project:${alias}`
}

export const serializeProjectReferenceDraft = (text: string, projects: readonly string[]): string => {
  const aliases = projectAliases(projects)
  return text.replace(/(?<![\w@])@project:([^\s]+)/gu, (token, alias: string) => {
    const path = aliases.get(alias)
    if (path === undefined) return token
    const name = projectName(path).replace(/[\\[\]]/gu, '\\$&')
    return `[${name}](workspace:${encodeURIComponent(path)})`
  })
}
