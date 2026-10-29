import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { parseSync } from 'oxc-parser'
import { SourceSyntax } from '../project/syntax.js'
import type { WorkspacePackage } from './workspace.js'

export interface PluginBoundaryViolation {
  readonly rule: 'relative-dist-import' | 'contract-imports-provider'
  /** Absolute path of the importing file. */
  readonly file: string
  readonly line: number
  readonly message: string
  readonly hint: string
}

interface SourceImport {
  readonly specifier: string
  readonly line: number
}

interface PluginSources {
  readonly plugin: WorkspacePackage
  readonly files: ReadonlyMap<string, readonly SourceImport[]>
}

const sourceExtensions = /\.(?:[cm]?[jt]sx?)$/
const skippedDirectories = new Set(['node_modules', 'dist', 'coverage'])
const contractDeclaration = /\bdefine(?:Contract|Registry)\s*[<(]/

const lineAt = (text: string, offset: number): number => text.slice(0, offset).split('\n').length

const unquoted = (text: string): string | undefined => /^(['"`])([^'"`]*)\1$/.exec(text.trim())?.[2]

const importsOf = (file: string): readonly SourceImport[] => {
  const text = readFileSync(file, 'utf8')
  const parsed = parseSync(file, text)
  const requests = [
    ...parsed.module.staticImports.map(item => item.moduleRequest),
    ...parsed.module.staticExports.flatMap(item => item.entries.flatMap(entry => (entry.moduleRequest === null ? [] : [entry.moduleRequest]))),
    ...parsed.module.dynamicImports.flatMap(item => {
      const value = unquoted(text.slice(item.moduleRequest.start, item.moduleRequest.end))
      return value === undefined ? [] : [{ value, start: item.moduleRequest.start }]
    }),
  ]
  return requests.map(request => ({ specifier: request.value, line: lineAt(text, request.start) }))
}

/** Source files a plugin owns: everything outside build output, dependencies and nested workspace packages. */
const sourceFiles = (directory: string, nestedPackages: ReadonlySet<string>): readonly string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name)
    if (entry.isDirectory())
      return skippedDirectories.has(entry.name) || entry.name.startsWith('.') || nestedPackages.has(path) ? [] : sourceFiles(path, nestedPackages)
    return entry.isFile() && sourceExtensions.test(entry.name) ? [path] : []
  })

/** The `modules` entries a plugin's dshx.config.ts declares, by subpath. */
const declaredModules = (configPath: string): ReadonlyMap<string, string> => {
  const program = SourceSyntax.parse({ file: configPath, source: readFileSync(configPath, 'utf8') })
  const config = SourceSyntax.defaultCall({ program, name: 'defineConfig' })?.arguments[0]
  if (config === undefined || config.type === 'SpreadElement') return new Map()
  const modules = SourceSyntax.objectProperty({ expression: SourceSyntax.unwrapExpression(config), name: 'modules' })
  if (modules === undefined || modules.value.type !== 'ObjectExpression') return new Map()
  return new Map(
    modules.value.properties.flatMap(property => {
      if (property.type !== 'Property') return []
      const name = SourceSyntax.propertyName(property.key)
      const entry = SourceSyntax.stringValue(property.value)
      return name === undefined || entry === undefined ? [] : [[name, resolve(dirname(configPath), entry)] as const]
    }),
  )
}

/** A relative specifier as a file on disk, trying the TypeScript sources a `.js` specifier compiles from. */
const resolveRelative = (from: string, specifier: string): string | undefined => {
  const base = resolve(dirname(from), specifier)
  const stem = base.replace(/\.[cm]?jsx?$/, '')
  const candidates = [
    base,
    ...['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx'].map(extension => `${stem}${extension}`),
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
  ]
  return candidates.find(candidate => existsSync(candidate) && sourceExtensions.test(candidate))
}

const isPlugin = (workspacePackage: WorkspacePackage): boolean => existsSync(join(workspacePackage.directory, 'dshx.config.ts'))

const importsPackage = (specifier: string, name: string): boolean => specifier === name || specifier.startsWith(`${name}/`)

/**
 * Two rules, both from incidents in this repository. A relative import of another plugin's `dist/` builds against
 * whatever that plugin last left there and hides the dependency from the package graph. A contract module that imports
 * the plugin filling it makes the two bundles build each other, which the contract exists to avoid.
 */
const check = (packages: readonly WorkspacePackage[]): readonly PluginBoundaryViolation[] => {
  const directories = new Set(packages.map(item => item.directory))
  const plugins = packages.filter(isPlugin)
  const owner = (path: string): WorkspacePackage | undefined =>
    packages
      .filter(item => path === item.directory || path.startsWith(`${item.directory}${sep}`))
      .sort((left, right) => right.directory.length - left.directory.length)[0]
  const sources: readonly PluginSources[] = plugins.map(plugin => {
    const nested = new Set([...directories].filter(directory => directory !== plugin.directory))
    return { plugin, files: new Map(sourceFiles(plugin.directory, nested).map(file => [file, importsOf(file)])) }
  })
  const violations: PluginBoundaryViolation[] = []

  for (const { plugin, files } of sources) {
    for (const [file, imports] of files) {
      for (const item of imports) {
        if (!item.specifier.startsWith('.')) continue
        const path = resolve(dirname(file), item.specifier)
        const target = owner(path)
        if (target === undefined || target === plugin || !isPlugin(target) || relative(target.directory, path).split(sep)[0] !== 'dist') continue
        violations.push({
          rule: 'relative-dist-import',
          file,
          line: item.line,
          message: `${plugin.name} imports ${target.name}'s build output by relative path (${item.specifier})`,
          hint: `Import "${target.name}" or a dshx \`modules\` subpath it publishes, and declare it in ${plugin.name}'s package.json.`,
        })
      }
    }
  }

  for (const { plugin, files } of sources) {
    for (const [subpath, entry] of declaredModules(join(plugin.directory, 'dshx.config.ts'))) {
      if (!existsSync(entry) || !contractDeclaration.test(readFileSync(entry, 'utf8'))) continue
      const moduleSpecifier = `${plugin.name}/${subpath}`
      const providers = sources
        .filter(other => other.plugin !== plugin && [...other.files.values()].some(imports => imports.some(item => item.specifier === moduleSpecifier)))
        .map(other => other.plugin.name)
      if (providers.length === 0) continue
      const reached = new Set<string>()
      const pending = [entry]
      for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
        if (reached.has(file)) continue
        reached.add(file)
        for (const item of files.get(file) ?? importsOf(file)) {
          if (item.specifier.startsWith('.')) {
            const next = resolveRelative(file, item.specifier)
            if (next !== undefined && owner(next) === plugin) pending.push(next)
            continue
          }
          const provider = providers.find(name => importsPackage(item.specifier, name))
          if (provider === undefined) continue
          violations.push({
            rule: 'contract-imports-provider',
            file,
            line: item.line,
            message: `contract module ${moduleSpecifier} imports ${provider}, which provides it`,
            hint: `Keep ${moduleSpecifier} free of ${provider}: the provider depends on the contract, never the reverse (docs/plugin-boundaries.md).`,
          })
        }
      }
    }
  }
  return violations
}

export class PluginBoundaries {
  static readonly check = check
}
