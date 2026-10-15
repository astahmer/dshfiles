import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { z } from 'zod'

/**
 * `pnpm -r run <script>` silently skips a package without that script, so a
 * plugin missing `test` would pass the workspace check untested. This makes the
 * contract explicit: every package runs the same commands and compiles under
 * the same strictness. Every workspace manifest also names exact versions
 * outside peerDependencies, so an install never re-resolves a range.
 */

const workspaceRoot = join(import.meta.dirname, '..')
const packagesRoot = join(workspaceRoot, '@dshfiles')

const scriptsSchema = (required: readonly string[]) => z.object(Object.fromEntries(required.map(name => [name, z.string().min(1)])))

const bundleManifestSchema = z.object({ scripts: scriptsSchema(['build', 'test', 'typecheck']) })
const libraryManifestSchema = z.object({ scripts: scriptsSchema(['test', 'typecheck']) })
const clientBase = '../../../tsconfig.base.client.json'
const strictFlags = [
  'strict',
  'noUncheckedIndexedAccess',
  'exactOptionalPropertyTypes',
  'noImplicitOverride',
  'verbatimModuleSyntax',
  'isolatedModules',
] as const
const baseTsconfigSchema = z.object({ compilerOptions: z.object(Object.fromEntries(strictFlags.map(flag => [flag, z.literal(true)]))) })
// Every plugin inherits the strict flags from the shared client base and may not turn one off.
const tsconfigSchema = z.object({
  extends: z.literal(clientBase),
  compilerOptions: z.object(Object.fromEntries(strictFlags.map(flag => [flag, z.literal(true).optional()]))),
})

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'))

const repositoryRoot = join(workspaceRoot, '..')
const exactVersion = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
const pinnedProtocol = /^(?:catalog|workspace|link|file):/
const pinnedFields = ['dependencies', 'devDependencies', 'optionalDependencies'] as const
// Ranges kept on purpose, keyed by `<package directory> <field> <dependency>`.
const rangeExceptions = new Map<string, string>([])

const dependencyManifestSchema = z.object(Object.fromEntries(pinnedFields.map(field => [field, z.record(z.string(), z.string()).optional()])))

const rangeProblems = (): string[] => {
  const listing = execFileSync('pnpm', ['ls', '--recursive', '--depth', '-1', '--parseable'], { cwd: repositoryRoot, encoding: 'utf8' })
  return listing
    .split('\n')
    .filter(path => path.length > 0)
    .flatMap(packagePath => {
      const directory = relative(repositoryRoot, packagePath) || '.'
      const manifest = dependencyManifestSchema.parse(readJson(join(packagePath, 'package.json')))
      return pinnedFields.flatMap(field =>
        Object.entries(manifest[field] ?? {})
          .filter(
            ([name, specifier]) => !exactVersion.test(specifier) && !pinnedProtocol.test(specifier) && !rangeExceptions.has(`${directory} ${field} ${name}`),
          )
          .map(
            ([name, specifier]) =>
              `${directory} package.json ${field}.${name}: ${JSON.stringify(specifier)} is a range; pin the locked version or use catalog:`,
          ),
      )
    })
}

const problemsFor = (name: string): string[] => {
  const directory = join(packagesRoot, name)
  const isBundle = existsSync(join(directory, 'cordis.patch.yml'))
  const manifest = (isBundle ? bundleManifestSchema : libraryManifestSchema).safeParse(readJson(join(directory, 'package.json')))
  const tsconfig = tsconfigSchema.safeParse(readJson(join(directory, 'tsconfig.json')))
  return [
    ...(manifest.success ? [] : manifest.error.issues.map(issue => `package.json ${issue.path.join('.')}: ${issue.message}`)),
    ...(tsconfig.success ? [] : tsconfig.error.issues.map(issue => `tsconfig.json ${issue.path.join('.')}: ${issue.message}`)),
  ].map(problem => `@dshfiles/${name} ${problem}`)
}

const baseTsconfig = baseTsconfigSchema.safeParse(readJson(join(workspaceRoot, '..', 'tsconfig.base.client.json')))

const problems = [
  ...(baseTsconfig.success ? [] : baseTsconfig.error.issues.map(issue => `tsconfig.base.client.json ${issue.path.join('.')}: ${issue.message}`)),
  ...readdirSync(packagesRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && existsSync(join(packagesRoot, entry.name, 'package.json')))
    .flatMap(entry => problemsFor(entry.name)),
  ...rangeProblems(),
]

if (problems.length > 0) {
  console.error(problems.join('\n'))
  process.exit(1)
}
console.log('Workspace contract: every package has its scripts, extends the strict client tsconfig base, and pins exact versions outside peers.')
