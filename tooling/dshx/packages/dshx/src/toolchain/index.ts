import { access, readFile } from 'node:fs/promises'
import { isBuiltin } from 'node:module'
import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'
import { dirname, resolve } from 'node:path'
import { execa } from 'execa'
import type { Writable } from 'node:stream'
import semver from 'semver'
import { DshxError, type DshxDiagnostic } from '../diagnostics.js'
import { decodeJson, jsonValueSchema } from '../json.js'
import { withUnknownProperties } from '../schema.js'
import type { JsonObject, JsonValue } from '../json.js'

export interface TestProjectOptions {
  readonly stdout?: Writable
  readonly stderr?: Writable
  readonly file?: string
}

/** Run the project's own Vitest installation. No profile or application process is needed. */
export async function testProject(root: string, options: TestProjectOptions = {}): Promise<number> {
  // Walk normal project/workspace node_modules locations. NODE_PATH can expose
  // the SDK's own runner; that is not this project's test dependency.
  let directory = resolve(root)
  let cli: string | undefined
  for (;;) {
    const candidate = resolve(directory, 'node_modules/vitest/vitest.mjs')
    try {
      await access(candidate)
      cli = candidate
      break
    } catch {
      const parent = dirname(directory)
      if (parent === directory) break
      directory = parent
    }
  }
  if (cli === undefined) {
    throw new DshxError('DSHX6401', 'This project has no Vitest installation.', {
      file: resolve(root, 'package.json'),
      hint: 'Run "pnpm add -D vitest", then add a *.test.ts or *.spec.ts file using @dshfiles/dshx/testing.',
    })
  }
  const subprocess = execa(process.execPath, [cli, 'run', ...(options.file === undefined ? [] : [options.file])], {
    cwd: root,
    reject: false,
  })
  // CLI IO can be a captured Writable without a file descriptor. Keep native
  // subprocess pipes and leave the caller's streams open across commands.
  if (options.stdout) subprocess.stdout?.pipe(options.stdout, { end: false })
  if (options.stderr) subprocess.stderr?.pipe(options.stderr, { end: false })
  const result = await subprocess
  if (result.exitCode === undefined)
    throw new DshxError('DSHX6404', 'The project test runner could not start or finish.', {
      file: cli,
      hint: 'Check your Node installation and rerun the project-local Vitest command directly for startup diagnostics.',
    })
  return result.exitCode ?? 1
}

interface PackMetadata {
  readonly filename: string
  readonly files: readonly { readonly path: string }[]
}

function packMetadata(stdout: string): PackMetadata {
  const parsed = decodeJson(jsonValueSchema, stdout)
  if (!Array.isArray(parsed) || parsed.length !== 1) throw new Error('npm returned an unexpected pack report')
  const value: JsonValue | undefined = parsed[0]
  if (
    typeof value !== 'object' ||
    value === null ||
    !('filename' in value) ||
    typeof value.filename !== 'string' ||
    !('files' in value) ||
    !Array.isArray(value.files)
  ) {
    throw new Error('npm returned an incomplete pack report')
  }
  const files = value.files.map(file => {
    if (typeof file !== 'object' || file === null || !('path' in file) || typeof file.path !== 'string') throw new Error('npm returned an invalid pack file')
    return { path: file.path }
  })
  return { filename: value.filename, files }
}

/** npm's real pack list for this project, refused when it would omit a file the plugin needs to load. */
const inspectPack = async (root: string, requiredFiles: readonly string[]): Promise<PackMetadata> => {
  const preview = await execa('npm', ['pack', '--dry-run', '--ignore-scripts', '--json'], { cwd: root, reject: false })
  if (preview.exitCode !== 0)
    throw new DshxError('DSHX6402', 'npm could not inspect this plugin package.', {
      file: resolve(root, 'package.json'),
      hint: preview.stderr || 'Fix package.json and rerun dshx package.',
    })
  const metadata = packMetadata(preview.stdout)
  const included = new Set(metadata.files.map(file => file.path))
  const missing = requiredFiles.map(file => file.replace(/^\.\//, '')).filter(file => !included.has(file))
  if (missing.length > 0)
    throw new DshxError('DSHX6403', `The package would omit required plugin files: ${missing.join(', ')}.`, {
      file: resolve(root, 'package.json'),
      hint: 'Include the build output and cordis.patch.yml in package.json files, and remove conflicting .npmignore rules.',
    })
  return metadata
}

/** Validate npm's real pack list, then produce an ordinary native bundle tarball without publishing. */
export async function packageProject(root: string, requiredFiles: readonly string[]): Promise<string> {
  await inspectPack(root, requiredFiles)
  const packed = await execa('npm', ['pack', '--ignore-scripts', '--json'], { cwd: root, reject: false })
  if (packed.exitCode !== 0)
    throw new DshxError('DSHX6402', 'npm could not package this plugin.', {
      file: resolve(root, 'package.json'),
      hint: packed.stderr || 'Fix the reported npm problem and rerun dshx package.',
    })
  const filename = packMetadata(packed.stdout).filename
  if (dirname(filename) !== '.') throw new Error('npm returned a package filename outside the project directory')
  return resolve(root, filename)
}

const publishManifestSchema = withUnknownProperties({
  name: Schema.optional(Schema.String),
  version: Schema.optional(Schema.String),
  private: Schema.optional(Schema.Boolean),
  license: Schema.optional(Schema.String),
  main: Schema.optional(Schema.String),
  dependencies: Schema.Record(Schema.String, Schema.String).pipe(Schema.withDecodingDefaultType(Effect.succeed({}))),
  optionalDependencies: Schema.Record(Schema.String, Schema.String).pipe(Schema.withDecodingDefaultType(Effect.succeed({}))),
  peerDependencies: Schema.Record(Schema.String, Schema.String).pipe(Schema.withDecodingDefaultType(Effect.succeed({}))),
})

/** Line-anchored so the docs that bundled packages keep in comments never read as imports; rolldown writes each import on one line. */
const staticImportPattern = /^(?:import\s*|(?:import|export)\b[^'"\n]*?\bfrom\s*)["']([^"'\n]+)["']/gmu

const bareImports = (source: string): readonly string[] => {
  const packages = [...source.matchAll(staticImportPattern)].flatMap(([, specifier]) => {
    if (specifier === undefined || specifier.startsWith('.') || specifier.startsWith('/') || isBuiltin(specifier)) return []
    const [first = '', second] = specifier.split('/')
    return [first.startsWith('@') && second !== undefined ? `${first}/${second}` : first]
  })
  return [...new Set(packages)]
}

/**
 * A package name the Host bundle imports but no install would provide. The monorepo resolves these by accident; an
 * installed package only sees its own `dependencies`, and `@deepseek-ai/*` from the DSH that loads it. A peer does
 * not help: profiles keep `autoInstallPeers` off, so nothing installs it.
 */
const undeclaredHostImports = async (root: string, hostEntry: string, declared: Readonly<Record<string, string>>): Promise<readonly string[]> => {
  const source = await readFile(resolve(root, hostEntry), 'utf8').catch(() => undefined)
  if (source === undefined) return []
  return bareImports(source).filter(name => !name.startsWith('@deepseek-ai/') && !Object.hasOwn(declared, name))
}

export interface PublishPreview {
  readonly name: string | null
  readonly version: string | null
  readonly filename: string
  readonly files: number
  readonly diagnostics: readonly DshxDiagnostic[]
}

/** What a registry publish would upload and whether a registry install could use it; nothing is written or uploaded. */
export const previewPublish = async (root: string, manifest: JsonObject, requiredFiles: readonly string[]): Promise<PublishPreview> => {
  const pack = await inspectPack(root, requiredFiles)
  const file = resolve(root, 'package.json')
  const fields = Schema.decodeUnknownSync(publishManifestSchema)(manifest)
  const diagnostics: DshxDiagnostic[] = []
  if (fields.private === true)
    diagnostics.push({
      code: 'DSHX6405',
      severity: 'error',
      message: 'package.json sets "private": true, so the registry refuses it.',
      file,
      hint: 'Remove "private" from a package you mean to publish; keep it on packages that only ship through this repository.',
    })
  if (fields.version === undefined || semver.valid(fields.version) === null)
    diagnostics.push({
      code: 'DSHX6406',
      severity: 'error',
      message: `package.json has no valid semver version${fields.version === undefined ? '' : ` (${fields.version})`}.`,
      file,
      hint: 'Set "version" to a semver release such as 0.1.0.',
    })
  for (const [name, specifier] of Object.entries({ ...fields.peerDependencies, ...fields.optionalDependencies, ...fields.dependencies })) {
    if (/^(?:link|file):/u.test(specifier))
      diagnostics.push({
        code: 'DSHX6407',
        severity: 'error',
        message: `${name} points at a local path (${specifier}), which no registry install can resolve.`,
        file,
        hint: 'Publish that package too and depend on its version, or bundle it into the Host entry.',
      })
    if (/^(?:workspace|catalog):/u.test(specifier))
      diagnostics.push({
        code: 'DSHX6407',
        severity: 'warning',
        message: `${name} uses ${specifier}; only pnpm publish rewrites it to a version, npm publish uploads it verbatim.`,
        file,
        hint: 'Publish with pnpm publish, or replace the specifier with a version range.',
      })
  }
  for (const name of await undeclaredHostImports(root, fields.main ?? 'dist/index.js', fields.dependencies))
    diagnostics.push({
      code: 'DSHX6409',
      severity: 'error',
      message: `The Host bundle imports ${name}, which an installed package cannot resolve, so DSH would report "did not activate".`,
      file,
      hint: `Add ${name} to host.bundleDependencies in dshx.config.ts, or to "dependencies" in package.json.`,
    })
  if (fields.license === undefined)
    diagnostics.push({
      code: 'DSHX6408',
      severity: 'warning',
      message: 'package.json declares no license.',
      file,
      hint: 'Add a "license" field such as "MIT".',
    })
  return { name: fields.name ?? null, version: fields.version ?? null, filename: pack.filename, files: pack.files.length, diagnostics }
}
