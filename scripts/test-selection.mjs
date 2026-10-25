import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { z } from 'zod'
import { turboCacheDir } from './turbo-cache.mjs'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifestSchema = z.object({
  name: z.string(),
  scripts: z.record(z.string(), z.string()).default({}),
  dependencies: z.record(z.string(), z.string()).default({}),
  devDependencies: z.record(z.string(), z.string()).default({}),
})
const isDocumentation = path => /\.(md|mdx)$/.test(path)
const globalInputs = new Set(['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'turbo.json', '.node-version'])
const fullSuitePackages = new Set([
  '@dshfiles/ai-accounts',
  '@dshfiles/queue-reorder',
  '@dshfiles/thread-sidebar',
  '@dshfiles/goal-stall-guard',
  '@dshfiles/jj-integration',
  '@dshfiles/jujutsu',
  '@dshfiles/dshx',
  'create-dshx',
])

export const selectTests = ({ packages, files, deletedFiles = [] }) => {
  const relevantFiles = files.filter(path => !isDocumentation(path))
  const globalChange = relevantFiles.some(
    path =>
      globalInputs.has(path) ||
      path.startsWith('tooling/dshx/e2e/') ||
      path.startsWith('tooling/dshx/scripts/') ||
      path.startsWith('profiles/') ||
      path === 'tooling/dshx/tsconfig.base.json' ||
      path === 'tsconfig.base.client.json' ||
      path === 'tooling/dshx/scratch-pnpm-policy.yaml' ||
      path === 'plugins/package.json' ||
      path === 'tooling/dshx/package.json',
  )
  const selected = new Map()
  for (const packageInfo of packages) {
    const ownFiles = relevantFiles.filter(path => path.startsWith(`${packageInfo.directory}/`))
    if (!globalChange && ownFiles.length === 0) continue
    const full =
      globalChange ||
      fullSuitePackages.has(packageInfo.name) ||
      ownFiles.some(
        path =>
          deletedFiles.includes(path) ||
          !/\.[cm]?[jt]sx?$/.test(path) ||
          /(^|\/)(fixtures|scripts|bench)\/|\.config\.|\/src\/(cli|project|scratch|tooling)\//.test(path),
      )
    selected.set(packageInfo.name, { ...packageInfo, mode: full ? 'full' : 'related', files: ownFiles })
  }
  for (let grew = true; grew;) {
    grew = false
    for (const packageInfo of packages) {
      if (!packageInfo.dependencies.some(name => selected.has(name))) continue
      const current = selected.get(packageInfo.name)
      if (current?.mode === 'full') continue
      selected.set(packageInfo.name, { ...packageInfo, mode: 'full', files: current?.files ?? [] })
      grew = true
    }
  }
  return [...selected.values()].filter(packageInfo => packageInfo.test !== undefined)
}

const testFilesOf = directory => {
  const files = []
  const walk = path => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.turbo') continue
      const entryPath = join(path, entry.name)
      if (entry.isDirectory()) walk(entryPath)
      else if (/\.(test|spec)\.(ts|tsx)$/.test(entry.name)) files.push(entryPath)
    }
  }
  if (existsSync(directory)) walk(directory)
  return files
}

// A related run needs the owner's build when its tests load the built entry instead of source, or
// import their own package name (which resolves to dist). Everything else runs source directly.
const buildRequiredFor = ({ packages, sharedChecks }) => {
  if (sharedChecks) return { required: true, reason: 'shared repository inputs' }
  const full = packages.find(packageInfo => packageInfo.mode === 'full')
  if (full) return { required: true, reason: `${full.name} runs its full suite` }
  for (const packageInfo of packages) {
    for (const testFile of testFilesOf(join(repositoryRoot, packageInfo.directory))) {
      const content = readFileSync(testFile, 'utf8')
      if (/['"`][^'"`\n]*\/dist\//.test(content))
        return { required: true, reason: `${packageInfo.name} test loads dist: ${relative(repositoryRoot, testFile)}` }
      if (content.includes(`${packageInfo.name}/`) || content.includes(`'${packageInfo.name}'`))
        return { required: true, reason: `${packageInfo.name} test imports its built package name: ${relative(repositoryRoot, testFile)}` }
    }
  }
  for (const packageInfo of packages) {
    for (const dependencyName of packageInfo.dependencies) {
      const shortName = dependencyName.replace(/^@dshfiles\//, '')
      const dependencyDirectory = [`plugins/@dshfiles/${shortName}`, `tooling/dshx/packages/${shortName}`].find(candidate =>
        existsSync(join(repositoryRoot, candidate, 'package.json')),
      )
      if (dependencyDirectory === undefined) continue
      const dependencyManifest = JSON.parse(readFileSync(join(repositoryRoot, dependencyDirectory, 'package.json'), 'utf8'))
      const entry = dependencyManifest.exports?.['.']?.default ?? dependencyManifest.main
      if (entry !== undefined && !existsSync(join(repositoryRoot, dependencyDirectory, entry)))
        return { required: true, reason: `unbuilt workspace dependency ${dependencyName}` }
    }
  }
  return { required: false, reason: 'related tests import source only' }
}

const packageSourceEntry = name => {
  const shortName = name.replace(/^@dshfiles\//, '')
  for (const base of ['plugins/@dshfiles', 'tooling/dshx/packages'])
    for (const entry of ['src/index.ts', 'src/host.ts', 'src/client.ts'])
      if (existsSync(join(repositoryRoot, base, shortName, entry))) return join(repositoryRoot, base, shortName, entry)
  return null
}

const sourceImports = path => {
  const source = readFileSync(path, 'utf8')
  return [...source.matchAll(/(?:from\s+|import\s*\(\s*)['"]([^'"]+)['"]/g)].map(match => match[1])
}

const resolveSourceImport = (fromFile, specifier) => {
  if (specifier.startsWith('.')) {
    const base = resolve(dirname(fromFile), specifier)
    for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), base.replace(/\.js$/, '.ts')])
      if (existsSync(candidate)) return candidate
    return null
  }
  return specifier.startsWith('@dshfiles/') ? packageSourceEntry(specifier) : null
}

// A dependent test runs only when its static import closure reaches one of the changed packages.
const reachesChangedPackage = (startFile, changedPackages) => {
  const seen = new Set()
  const stack = [startFile]
  while (stack.length > 0) {
    const file = stack.pop()
    if (seen.has(file)) continue
    seen.add(file)
    for (const specifier of sourceImports(file)) {
      if (changedPackages.has(specifier) || [...changedPackages].some(name => specifier.startsWith(`${name}/`))) return true
      const next = resolveSourceImport(file, specifier)
      if (next !== null) stack.push(next)
    }
  }
  return false
}

const bootsBuiltBundle = path => {
  const content = readFileSync(path, 'utf8')
  return (
    /['"`][^'"`\n]*\/dist\//.test(content) ||
    /(spawnSync|spawn|execFileSync)\(\s*['"](dsh|node)['"]/.test(content) ||
    /(spawnSync|spawn|execFileSync)\(\s*process\.execPath/.test(content)
  )
}

const narrowDependentTests = ({ packages, changedPackages }) => {
  const narrowed = new Map()
  for (const packageInfo of packages) {
    if (packageInfo.mode !== 'full' || changedPackages.has(packageInfo.name) || !/^vitest run(?: |$)/.test(packageInfo.test ?? '')) continue
    const packageDirectory = join(repositoryRoot, packageInfo.directory)
    const tests = testFilesOf(packageDirectory)
    // A test that boots a built bundle can exercise code without importing it, so it always runs.
    const selected = tests
      .filter(testFile => reachesChangedPackage(testFile, changedPackages) || bootsBuiltBundle(testFile))
      .map(testFile => relative(packageDirectory, testFile))
    narrowed.set(packageInfo.name, selected)
  }
  return narrowed
}

const discoverPackages = () =>
  ['plugins/@dshfiles', 'tooling/dshx/packages'].flatMap(packageRoot =>
    readdirSync(join(repositoryRoot, packageRoot), { withFileTypes: true })
      .filter(entry => entry.isDirectory() && existsSync(join(repositoryRoot, packageRoot, entry.name, 'package.json')))
      .map(entry => {
        const directory = `${packageRoot}/${entry.name}`
        const manifest = manifestSchema.parse(JSON.parse(readFileSync(join(repositoryRoot, directory, 'package.json'), 'utf8')))
        return {
          name: manifest.name,
          directory,
          test: manifest.scripts.test,
          dependencies: Object.entries({ ...manifest.dependencies, ...manifest.devDependencies })
            .filter(([, specifier]) => specifier.startsWith('workspace:'))
            .map(([name]) => name),
        }
      }),
  )

const run = ({ args, cwd = repositoryRoot }) => {
  const result = spawnSync('pnpm', args, { cwd, stdio: 'inherit', env: { ...process.env, TURBO_CACHE_DIR: turboCacheDir() } })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

const main = () => {
  const { values, positionals } = parseArgs({
    options: {
      from: { type: 'string' },
      to: { type: 'string', default: '@' },
      'dry-run': { type: 'boolean', default: false },
      since: { type: 'string' },
      build: { type: 'string', default: 'auto' },
      consumers: { type: 'string', default: 'related' },
    },
    allowPositionals: true,
  })
  const [mode, ...requestedFiles] = positionals
  if (mode !== 'changed' && mode !== 'related') throw new Error('Expected changed or related mode.')
  if (mode === 'changed' && requestedFiles.length > 0) throw new Error('Use --from/--to for JJ revisions or --since for a Git base.')
  if (mode === 'related' && requestedFiles.length === 0) throw new Error('Pass at least one repository-relative source path.')
  if (values.since && (values.from || mode !== 'changed'))
    throw new Error('--since selects the comparison base; do not combine it with --from or related mode.')
  const comparisonBase = values.since ?? values.from ?? 'main'
  const changedOutput =
    mode === 'changed'
      ? execFileSync('jj', ['diff', '--from', comparisonBase, '--to', values.to, '--name-only'], { cwd: repositoryRoot, encoding: 'utf8' })
      : ''
  const files =
    mode === 'changed' ? changedOutput.split('\n').filter(Boolean) : requestedFiles.map(path => relative(repositoryRoot, resolve(process.cwd(), path)))
  if (files.some(path => path === '..' || path.startsWith('../') || isAbsolute(path))) throw new Error('Test paths must stay inside the repository.')
  if (values.to !== '@' && !values['dry-run']) throw new Error('Tests execute current files; --to must be @ unless using --dry-run.')
  if (mode === 'related' && files.some(path => !existsSync(join(repositoryRoot, path))))
    throw new Error('Related source paths must exist; use changed mode for deleted files.')
  const selection = selectTests({ packages: discoverPackages(), files, deletedFiles: files.filter(path => !existsSync(join(repositoryRoot, path))) })
  const changedPackages = new Set(selection.filter(packageInfo => packageInfo.files.length > 0).map(packageInfo => packageInfo.name))
  const sharedChecks = files.some(
    path =>
      !isDocumentation(path) &&
      (globalInputs.has(path) ||
        path.startsWith('scripts/') ||
        path.startsWith('plugins/scripts/') ||
        path.startsWith('tooling/dshx/e2e/') ||
        path.startsWith('tooling/dshx/scripts/') ||
        path.startsWith('profiles/')),
  )
  if (values.build !== 'always' && values.build !== 'auto') throw new Error('Expected --build always or auto.')
  if (values.consumers !== 'full' && values.consumers !== 'related') throw new Error('Expected --consumers full or related.')
  const narrowed = values.consumers === 'related' && !sharedChecks ? narrowDependentTests({ packages: selection, changedPackages }) : new Map()
  const buildDecision = buildRequiredFor({ packages: selection, sharedChecks })
  const build =
    narrowed.size > 0
      ? { required: true, reason: 'dependent tests load built packages' }
      : values.build === 'always'
        ? { required: true, reason: 'forced' }
        : buildDecision
  console.log(
    JSON.stringify(
      {
        files,
        sharedChecks,
        build,
        packages: selection.map(packageInfo => ({ name: packageInfo.name, mode: packageInfo.mode, files: packageInfo.files })),
        consumers: narrowed.size === 0 ? undefined : [...narrowed].map(([name, tests]) => ({ name, tests: tests.length, files: tests })),
      },
      null,
      2,
    ),
  )
  if (values['dry-run']) return
  if (sharedChecks) {
    run({ args: ['run', 'test:scripts'] })
    run({ args: ['run', 'typecheck:scripts'] })
    run({ args: ['--dir', 'plugins', 'run', 'contract'] })
    run({ args: ['run', 'test:tooling'] })
  }
  if (selection.length === 0) return
  if (!build.required) console.log(`test selection: skipped build (${build.reason}); pass --build=always on a cold workspace.`)
  if (build.required) {
    const buildTargets = narrowed.size > 0 && changedPackages.size > 0 ? [...changedPackages] : selection.map(packageInfo => packageInfo.name)
    const buildFilters = buildTargets.map(name => `--filter=${name}`)
    if (files.some(path => path.startsWith('plugins/@dshfiles/') && /\.(ts|tsx|js|jsx|css|html)$/.test(path)))
      buildFilters.push('--filter=...@dshfiles/plugin-ui')
    run({ args: ['exec', 'turbo', 'run', 'build', ...buildFilters] })
  }
  const full = selection.filter(packageInfo => packageInfo.mode === 'full' && !narrowed.has(packageInfo.name))
  if (full.length > 0) run({ args: ['exec', 'turbo', 'run', 'test', ...full.map(packageInfo => `--filter=${packageInfo.name}`)] })
  for (const [packageName, tests] of narrowed) {
    const packageInfo = selection.find(candidate => candidate.name === packageName)
    if (tests.length === 0) {
      console.log(`test selection: skipped full suite of ${packageName} (no test reaches the changed packages)`)
      continue
    }
    const commandMatch = /^vitest run(?: (.*))?$/.exec(packageInfo.test)
    const commandFlags = commandMatch === null ? [] : (commandMatch[1] ?? '').split(' ').filter(Boolean)
    run({ args: ['exec', 'vitest', 'run', ...tests, ...commandFlags, '--passWithNoTests'], cwd: join(repositoryRoot, packageInfo.directory) })
  }
  for (const packageInfo of selection.filter(packageInfo => packageInfo.mode === 'related')) {
    const match = /^vitest run(?: (.*))?$/.exec(packageInfo.test)
    if (!match) {
      run({ args: ['exec', 'turbo', 'run', 'test', `--filter=${packageInfo.name}`] })
      continue
    }
    const flags = (match[1] ?? '').split(' ').filter(Boolean)
    const args = values.since
      ? ['run', `--changed=${values.since}`]
      : ['related', '--run', ...packageInfo.files.map(path => relative(packageInfo.directory, path))]
    run({ args: ['exec', 'vitest', ...args, ...flags, '--passWithNoTests'], cwd: join(repositoryRoot, packageInfo.directory) })
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
