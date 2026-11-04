import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const pluginsDirectory = 'plugins/@dshfiles'
const staticImportPattern = /\b(?:import|export)\s+(type\s+)?(?:[^'";]*?\s+from\s*)?['"]([^'"]+)['"]/gsu
const dynamicImportPattern = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/gu
const ownPackagePattern = /^@dshfiles\/([^/]+)(?:\/(.+))?$/u

const readText = path => {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return undefined
  }
}

const runtimeSpecifiers = source => {
  const specifiers = []
  for (const match of source.matchAll(staticImportPattern)) {
    if (match[1] === undefined) specifiers.push(match[2])
  }
  for (const match of source.matchAll(dynamicImportPattern)) specifiers.push(match[1])
  return specifiers
}

const sourceCandidates = base => {
  const withoutRuntimeExtension = base.replace(/\.(?:[cm]?js)$/u, '')
  return [base.replace(/\.js$/u, '.ts').replace(/\.mjs$/u, '.mts'), base, `${withoutRuntimeExtension}.ts`, join(base, 'index.ts')]
}

const existingSource = base => sourceCandidates(base).find(candidate => /\.[cm]?ts$/u.test(candidate) && !candidate.endsWith('.d.ts') && existsSync(candidate))

const hostEntry = packageRoot => {
  const config = readText(join(packageRoot, 'dshx.config.ts'))
  const entry = config?.match(/\bhost\s*:\s*\{[^}]*?\bentry\s*:\s*['"]([^'"]+)['"]/su)?.[1]
  return entry === undefined ? undefined : existingSource(join(packageRoot, entry))
}

const exportTarget = (packageRoot, subpath) => {
  const manifest = readText(join(packageRoot, 'package.json'))
  if (manifest === undefined) return undefined
  const target = JSON.parse(manifest).exports?.[subpath === undefined ? '.' : `./${subpath}`]
  const path = typeof target === 'string' ? target : (target?.types ?? target?.import ?? target?.default)
  if (typeof path !== 'string') return undefined
  if (/\.[cm]?ts$/u.test(path) && !path.endsWith('.d.ts')) return existingSource(join(packageRoot, path))
  return subpath === undefined ? hostEntry(packageRoot) : existingSource(join(packageRoot, 'src', subpath))
}

const resolveSpecifier = ({ repositoryRoot, from, specifier }) => {
  if (specifier.startsWith('.')) return existingSource(resolve(dirname(from), specifier))
  const ownPackage = specifier.match(ownPackagePattern)
  if (ownPackage === null) return undefined
  const packageRoot = join(repositoryRoot, pluginsDirectory, ownPackage[1])
  return existsSync(packageRoot) ? exportTarget(packageRoot, ownPackage[2]) : undefined
}

const pluginRoots = repositoryRoot => {
  const directory = join(repositoryRoot, pluginsDirectory)
  if (!existsSync(directory)) return []
  return readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => join(directory, entry.name))
}

export const runtimeImportTargets = ({ repositoryRoot, file }) =>
  runtimeSpecifiers(readText(file) ?? '')
    .map(specifier => resolveSpecifier({ repositoryRoot, from: file, specifier }))
    .filter(target => target !== undefined)

const computeHostFiles = repositoryRoot => {
  const reached = new Set()
  const pending = pluginRoots(repositoryRoot)
    .map(hostEntry)
    .filter(entry => entry !== undefined)
  while (pending.length > 0) {
    const file = pending.pop()
    if (reached.has(file)) continue
    reached.add(file)
    for (const target of runtimeImportTargets({ repositoryRoot, file })) {
      if (!reached.has(target)) pending.push(target)
    }
  }
  return reached
}

const cache = new Map()

export const hostFiles = repositoryRoot => {
  const root = resolve(repositoryRoot)
  if (!cache.has(root)) cache.set(root, computeHostFiles(root))
  return cache.get(root)
}

export const repositoryRootOf = filename => {
  const index = filename.replaceAll('\\', '/').indexOf(`/${pluginsDirectory}/`)
  return index === -1 ? undefined : filename.slice(0, index)
}
