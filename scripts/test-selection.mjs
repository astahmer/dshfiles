import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { z } from 'zod'

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
  const result = spawnSync('pnpm', args, { cwd, stdio: 'inherit' })
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
  console.log(
    JSON.stringify(
      { files, sharedChecks, packages: selection.map(packageInfo => ({ name: packageInfo.name, mode: packageInfo.mode, files: packageInfo.files })) },
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
  const buildFilters = selection.map(packageInfo => `--filter=${packageInfo.name}`)
  if (files.some(path => path.startsWith('plugins/@dshfiles/') && /\.(ts|tsx|js|jsx|css|html)$/.test(path)))
    buildFilters.push('--filter=...@dshfiles/plugin-ui')
  run({ args: ['exec', 'turbo', 'run', 'build', ...buildFilters] })
  const full = selection.filter(packageInfo => packageInfo.mode === 'full')
  if (full.length > 0) run({ args: ['exec', 'turbo', 'run', 'test', ...full.map(packageInfo => `--filter=${packageInfo.name}`)] })
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
