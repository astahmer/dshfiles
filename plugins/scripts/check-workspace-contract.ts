import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { SchemaIssue } from 'effect'
import * as Schema from 'effect/Schema'
import { ScriptJson } from '../../scripts/json.ts'

/**
 * `pnpm -r run <script>` silently skips a package without that script, so a
 * plugin missing `test` would pass the workspace check untested. This makes the
 * contract explicit: every package runs the same commands and compiles under
 * the same strictness. Every workspace manifest also names exact versions
 * outside peerDependencies, so an install never re-resolves a range, and the
 * package graph stays acyclic because pnpm and Turbo refuse a cyclic task graph.
 * A Host bundle that spawns through DSH's `subprocess` service injects it, or
 * Cordis may activate the bundle before that service exists.
 */

const workspaceRoot = join(import.meta.dirname, '..')
const packagesRoot = join(workspaceRoot, '@dshfiles')

const nonEmptyString = Schema.String.check(Schema.isMinLength(1))

const scriptsSchema = (required: readonly string[]) => Schema.Struct(Object.fromEntries(required.map(name => [name, nonEmptyString])))

const bundleManifestSchema = Schema.Struct({ scripts: scriptsSchema(['build', 'test', 'typecheck']) })
const libraryManifestSchema = Schema.Struct({ scripts: scriptsSchema(['test', 'typecheck']) })
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
const baseTsconfigSchema = Schema.Struct({
  compilerOptions: Schema.Struct(Object.fromEntries(strictFlags.map(flag => [flag, Schema.Literal(true)]))),
})
// Client plugins inherit strict flags from the shared base; Host-only forks may declare an explicit base exception.
const tsconfigSchema = (base: string) =>
  Schema.Struct({
    extends: Schema.Literal(base),
    compilerOptions: Schema.Struct(Object.fromEntries(strictFlags.map(flag => [flag, Schema.optional(Schema.Literal(true))]))),
  })

const repositoryRoot = join(workspaceRoot, '..')
const exactVersion = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
const pinnedProtocol = /^(?:catalog|workspace|link|file):/
const pinnedFields = ['dependencies', 'devDependencies', 'optionalDependencies'] as const
// Ranges kept on purpose, keyed by `<package directory> <field> <dependency>`.
const rangeExceptions = new Map<string, string>([])

const projectManifestSchema = Schema.Struct({
  name: nonEmptyString,
  dependencies: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  devDependencies: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  optionalDependencies: Schema.optional(Schema.Record(Schema.String, Schema.String)),
})

interface WorkspaceProject {
  readonly directory: string
  readonly name: string
  readonly manifest: Schema.Schema.Type<typeof projectManifestSchema>
}

/** The first three failed paths as `path: message`, the shape a manifest reader can act on. */
const describeFailure = (error: Schema.SchemaError): readonly string[] =>
  SchemaIssue.makeFormatterStandardSchemaV1()(error.issue).issues.map(issue => {
    const path = (issue.path ?? []).map(segment => String(segment instanceof Object ? segment.key : segment)).join('.')
    return path === '' ? issue.message : `${path}: ${issue.message}`
  })

const dependenciesOf = (project: WorkspaceProject): readonly string[] => pinnedFields.flatMap(field => Object.keys(project.manifest[field] ?? {}))

const workspaceProjects = (): readonly WorkspaceProject[] => {
  const listing = execFileSync('pnpm', ['ls', '--recursive', '--depth', '-1', '--parseable'], { cwd: repositoryRoot, encoding: 'utf8' })
  return listing
    .split('\n')
    .filter(path => path.length > 0)
    .map(packagePath => {
      const manifest = ScriptJson.decodeJson(projectManifestSchema, readFileSync(join(packagePath, 'package.json'), 'utf8'))
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

const sourceFiles = (directory: string): readonly string[] =>
  readdirSync(directory, { withFileTypes: true, recursive: true })
    .filter(entry => entry.isFile() && /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name))
    .map(entry => join(entry.parentPath, entry.name))

const subprocessInjectProblems = (directory: string): string[] => {
  const source = join(directory, 'src')
  if (!existsSync(source)) return []
  const texts = sourceFiles(source).map(file => readFileSync(file, 'utf8'))
  const spawns = texts.some(text => text.includes("'@dshfiles/dshx/effect/child-process-spawner'"))
  const injects = texts.some(text => /inject:\s*\[[^\]]*'subprocess'/.test(text))
  return spawns && !injects ? ["uses DshChildProcessSpawner without inject: ['subprocess'] — add it to DshxPlugin.make so Cordis waits for the service."] : []
}

const problemsFor = (name: string): string[] => {
  const directory = join(packagesRoot, name)
  const isBundle = existsSync(join(directory, 'cordis.patch.yml'))
  const manifest = ScriptJson.decodeJsonSafe(isBundle ? bundleManifestSchema : libraryManifestSchema, readFileSync(join(directory, 'package.json'), 'utf8'))
  const tsconfig = ScriptJson.decodeJsonSafe(
    tsconfigSchema(tsconfigBaseExceptions.get(name) ?? clientBase),
    readFileSync(join(directory, 'tsconfig.json'), 'utf8'),
  )
  return [
    ...(manifest.success ? [] : describeFailure(manifest.error).map(problem => `package.json ${problem}`)),
    ...(tsconfig.success ? [] : describeFailure(tsconfig.error).map(problem => `tsconfig.json ${problem}`)),
    ...(isBundle ? subprocessInjectProblems(directory) : []),
  ].map(problem => `@dshfiles/${name} ${problem}`)
}

const baseTsconfig = ScriptJson.decodeJsonSafe(baseTsconfigSchema, readFileSync(join(workspaceRoot, '..', 'tsconfig.base.client.json'), 'utf8'))
const projects = workspaceProjects()

const problems = [
  ...(baseTsconfig.success ? [] : describeFailure(baseTsconfig.error).map(problem => `tsconfig.base.client.json ${problem}`)),
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
  'Workspace contract: every package has its scripts, uses its declared strict tsconfig base, pins exact versions outside peers, injects the services it spawns through, and forms an acyclic package graph.',
)
