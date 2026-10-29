import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Workspace packages must depend on each other in one direction. Turbo orders builds by dependencies and
 * devDependencies only, so a cycle that closes through a peer dependency builds against whatever stale `dist/` the
 * other side left (ai-accounts ⇄ usage did). Declare a contract or registry in the lower plugin instead; see
 * docs/plugin-boundaries.md.
 */
const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const workspaceGlobs = ['plugins/@dshfiles', 'tooling/dshx/packages']
const dependencyFields = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']

const readPackages = root => {
  const packages = new Map()
  for (const parent of workspaceGlobs) {
    const directory = join(root, parent)
    if (!existsSync(directory)) continue
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const manifestPath = join(directory, entry.name, 'package.json')
      if (!entry.isDirectory() || !existsSync(manifestPath)) continue
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
      packages.set(manifest.name, manifest)
    }
  }
  return packages
}

/** Strongly connected components with more than one package, or a package that depends on itself. */
export const findWorkspaceCycles = packages => {
  const edges = new Map(
    [...packages].map(([name, manifest]) => [
      name,
      [...new Set(dependencyFields.flatMap(field => Object.keys(manifest[field] ?? {})).filter(dependency => packages.has(dependency)))],
    ]),
  )
  let counter = 0
  const index = new Map()
  const low = new Map()
  const stack = []
  const onStack = new Set()
  const cycles = []
  const visit = name => {
    index.set(name, counter)
    low.set(name, counter)
    counter += 1
    stack.push(name)
    onStack.add(name)
    for (const next of edges.get(name) ?? []) {
      if (!index.has(next)) {
        visit(next)
        low.set(name, Math.min(low.get(name), low.get(next)))
      } else if (onStack.has(next)) low.set(name, Math.min(low.get(name), index.get(next)))
    }
    if (low.get(name) !== index.get(name)) return
    const component = []
    let member
    do {
      member = stack.pop()
      onStack.delete(member)
      component.push(member)
    } while (member !== name)
    if (component.length > 1 || (edges.get(name) ?? []).includes(name)) cycles.push(component.sort())
  }
  for (const name of [...edges.keys()].sort()) if (!index.has(name)) visit(name)
  return cycles
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const cycles = findWorkspaceCycles(readPackages(repositoryRoot))
  if (cycles.length === 0) console.log('Workspace dependencies have no cycles.')
  else {
    for (const cycle of cycles) console.error(`workspace dependency cycle: ${cycle.join(' ⇄ ')}`)
    console.error('Break it with a contract or registry owned by the lower plugin (docs/plugin-boundaries.md).')
    process.exitCode = 1
  }
}
