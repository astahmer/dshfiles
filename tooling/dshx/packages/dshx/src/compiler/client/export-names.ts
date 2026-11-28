import type { Rollup } from 'vite'

const STAR_REEXPORT = /export\s*\*\s*from\s*(['"])([^'"]+)\1/gu

/**
 * Every name a module of the current build exports. Rolldown's `ModuleInfo.exports` can leave out names an
 * `export * from` brings in (a star over a virtual module, such as plugin-ui/query over the shared runtime's
 * react-query facade), so the star sources are followed. `undefined` when the module is not in the build or a star
 * source is external: those names exist only at runtime.
 */
export const exportNames = async (context: Rollup.PluginContext, id: string, seen: Set<string> = new Set()): Promise<readonly string[] | undefined> => {
  if (seen.has(id)) return []
  seen.add(id)
  const info = context.getModuleInfo(id)
  if (info === null) return undefined
  if (info.inputFormat === 'cjs') return info.exports
  const names = new Set(info.exports)
  for (const match of (info.code ?? '').matchAll(STAR_REEXPORT)) {
    const source = match[2]
    if (source === undefined) continue
    const target = await context.resolve(source, id)
    if (target === null || target.external !== false) return undefined
    const starred = await exportNames(context, target.id, seen)
    if (starred === undefined) return undefined
    for (const name of starred) if (name !== 'default') names.add(name)
  }
  return [...names]
}
