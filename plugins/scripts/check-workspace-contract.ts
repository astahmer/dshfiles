import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'

/**
 * `pnpm -r run <script>` silently skips a package without that script, so a
 * plugin missing `test` would pass the workspace check untested. This makes the
 * contract explicit: every package runs the same commands and compiles under
 * the same strictness.
 */

const workspaceRoot = join(import.meta.dirname, '..')
const packagesRoot = join(workspaceRoot, '@dshfiles')

const scriptsSchema = (required: readonly string[]) =>
  z.object(Object.fromEntries(required.map(name => [name, z.string().min(1)])))

const bundleManifestSchema = z.object({ scripts: scriptsSchema(['build', 'test', 'typecheck']) })
const libraryManifestSchema = z.object({ scripts: scriptsSchema(['test', 'typecheck']) })
const tsconfigSchema = z.object({
  compilerOptions: z.object({ strict: z.literal(true), noUncheckedIndexedAccess: z.literal(true) }),
})

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'))

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

const problems = readdirSync(packagesRoot, { withFileTypes: true })
  .filter(entry => entry.isDirectory())
  .flatMap(entry => problemsFor(entry.name))

if (problems.length > 0) {
  console.error(problems.join('\n'))
  process.exit(1)
}
console.log('Workspace contract: every package has its scripts and strict compiler options.')
