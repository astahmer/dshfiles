import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { z } from 'zod'

/**
 * `pnpm -r run <script>` silently skips a package without that script, so a
 * plugin missing `test` would pass the workspace check untested. This makes the
 * contract explicit: every package runs the same commands and compiles under
 * the same strictness. Every workspace manifest also names exact versions
 * outside peerDependencies, so an install never re-resolves a range, and the
 * package graph stays acyclic because pnpm and Turbo refuse a cyclic task graph.
 */

const workspaceRoot = join(import.meta.dirname, '..')
const packagesRoot = join(workspaceRoot, '@dshfiles')

const scriptsSchema = (required: readonly string[]) => z.object(Object.fromEntries(required.map(name => [name, z.string().min(1)])))

const bundleManifestSchema = z.object({ scripts: scriptsSchema(['build', 'test', 'typecheck']) })
const libraryManifestSchema = z.object({ scripts: scriptsSchema(['test', 'typecheck']) })
const clientBase = '../../../tsconfig.base.client.json'
const tsconfigBaseExceptions = new Map([['subprocess-local', '../../../tsconfig.base.json']])
const strictFlags = [
  'strict',
  'noUncheckedIndexedAccess',
  'exactOptionalPropertyTypes',
  'noImplicitOverride',
  'verbatimModuleSyntax',
  'isolatedModules',
] as const
const baseTsconfigSchema = z.object({ compilerOptions: z.object(Object.fromEntries(strictFlags.map(flag => [flag, z.literal(true)]))) })
// Client plugins inherit strict flags from the shared base; Host-only forks may declare an explicit base exception.
const tsconfigSchema = (base: string) =>
  z.object({
    extends: z.literal(base),
    compilerOptions: z.object(Object.fromEntries(strictFlags.map(flag => [flag, z.literal(true).optional()]))),
  })

const repositoryRoot = join(workspaceRoot, '..')
const exactVersion = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
const pinnedProtocol = /^(?:catalog|workspace|link|file):/
const pinnedFields = ['dependencies', 'devDependencies', 'optionalDependencies'] as const
// Ranges kept on purpose, keyed by `<package directory> <field> <dependency>`.
const rangeExceptions = new Map<string, string>([])

const projectManifestSchema = z.object({
  name: z.string().min(1),
  dependencies: z.record(z.string(), z.string()).optional(),
  devDependencies: z.record(z.string(), z.string()).optional(),
  optionalDependencies: z.record(z.string(), z.string()).optional(),
})

interface WorkspaceProject {
  readonly directory: string
  readonly name: string
  readonly manifest: z.infer<typeof projectManifestSchema>
}

const dependenciesOf = (project: WorkspaceProject): readonly string[] => pinnedFields.flatMap(field => Object.keys(project.manifest[field] ?? {}))

const workspaceProjects = (): readonly WorkspaceProject[] => {
  const listing = execFileSync('pnpm', ['ls', '--recursive', '--depth', '-1', '--parseable'], { cwd: repositoryRoot, encoding: 'utf8' })
  return listing
    .split('\n')
    .filter(path => path.length > 0)
    .map(packagePath => {
      const manifest = projectManifestSchema.parse(JSON.parse(readFileSync(join(packagePath, 'package.json'), 'utf8')))
      return { directory: relative(repositoryRoot, packagePath) || '.', name: manifest.name, manifest }
    })
}

const rangeProblems = (projects: readonly WorkspaceProject[]): string[] =>
  projects.flatMap(project =>
    pinnedFields.flatMap(field =>
      Object.entries(project.manifest[field] ?? {})
        .filter(
          ([name, specifier]) =>
            !exactVersion.test(specifier) && !pinnedProtocol.test(specifier) && !rangeExceptions.has(`${project.directory} ${field} ${name}`),
        )
        .map(
          ([name, specifier]) =>
            `${project.directory} package.json ${field}.${name}: ${JSON.stringify(specifier)} is a range; pin the locked version or use catalog:`,
        ),
    ),
  )

/** One cycle is enough to fail: it is deterministic over sorted names and edges, so the message names the same edges every run. */
const firstDependencyCycle = (projects: readonly WorkspaceProject[]): readonly string[] | undefined => {
  const names = new Set(projects.map(project => project.name))
  const edges = new Map(
    projects.map(
      project =>
        [
          project.name,
          dependenciesOf(project)
            .filter(dependency => names.has(dependency))
            .sort(),
        ] as const,
    ),
  )
  const state = new Map<string, 'visiting' | 'done'>()
  const stack: string[] = []
  const walk = (name: string): readonly string[] | undefined => {
    state.set(name, 'visiting')
    stack.push(name)
    for (const next of edges.get(name) ?? []) {
      const seen = state.get(next)
      if (seen === 'visiting') {
        const start = stack.indexOf(next)
        return [...stack.slice(start), next]
      }
      if (seen === undefined) {
        const cycle = walk(next)
        if (cycle !== undefined) return cycle
      }
    }
    stack.pop()
    state.set(name, 'done')
    return undefined
  }
  for (const name of [...names].sort()) {
    if (state.has(name)) continue
    const cycle = walk(name)
    if (cycle !== undefined) return cycle
  }
  return undefined
}

const cycleProblems = (projects: readonly WorkspaceProject[]): string[] => {
  const cycle = firstDependencyCycle(projects)
  return cycle === undefined
    ? []
    : [`workspace packages form a dependency cycle: ${cycle.join(' → ')} — break one edge; pnpm and Turbo refuse a cyclic task graph.`]
}

const problemsFor = (name: string): string[] => {
  const directory = join(packagesRoot, name)
  const isBundle = existsSync(join(directory, 'cordis.patch.yml'))
  const manifest = (isBundle ? bundleManifestSchema : libraryManifestSchema).safeParse(JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')))
  const tsconfig = tsconfigSchema(tsconfigBaseExceptions.get(name) ?? clientBase).safeParse(JSON.parse(readFileSync(join(directory, 'tsconfig.json'), 'utf8')))
  return [
    ...(manifest.success ? [] : manifest.error.issues.map(issue => `package.json ${issue.path.join('.')}: ${issue.message}`)),
    ...(tsconfig.success ? [] : tsconfig.error.issues.map(issue => `tsconfig.json ${issue.path.join('.')}: ${issue.message}`)),
  ].map(problem => `@dshfiles/${name} ${problem}`)
}

const baseTsconfig = baseTsconfigSchema.safeParse(JSON.parse(readFileSync(join(workspaceRoot, '..', 'tsconfig.base.client.json'), 'utf8')))
const projects = workspaceProjects()

const problems = [
  ...(baseTsconfig.success ? [] : baseTsconfig.error.issues.map(issue => `tsconfig.base.client.json ${issue.path.join('.')}: ${issue.message}`)),
  ...readdirSync(packagesRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && existsSync(join(packagesRoot, entry.name, 'package.json')))
    .flatMap(entry => problemsFor(entry.name)),
  ...rangeProblems(projects),
  ...cycleProblems(projects),
]

if (problems.length > 0) {
  console.error(problems.join('\n'))
  process.exit(1)
}
console.log(
  'Workspace contract: every package has its scripts, uses its declared strict tsconfig base, pins exact versions outside peers, and forms an acyclic package graph.',
)
