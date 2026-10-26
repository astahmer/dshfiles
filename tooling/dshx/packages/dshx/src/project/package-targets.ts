import { readFile, stat } from 'node:fs/promises'
import { z } from 'zod'
import { JsonDocumentModel, type JsonDocumentObject, type JsonDocumentValue } from './json-document.js'
import { isAbsolute, relative, resolve } from 'node:path'
import type { ResolvedDshxConfig } from '../config/types.js'
import type { DshxDiagnostic } from '../diagnostics.js'

interface PackageTarget {
  readonly field: string
  readonly target: string
}

function collectStrings(value: JsonDocumentValue | undefined, field: string, output: PackageTarget[]): void {
  const text = JsonDocumentModel.string(value)
  if (text !== undefined) {
    output.push({ field, target: text })
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectStrings(item, `${field}[${index}]`, output))
    return
  }
  if (!JsonDocumentModel.isObject(value)) return
  for (const [key, nested] of Object.entries(value)) collectStrings(nested, `${field}.${key}`, output)
}

/** Concrete npm entrypoints, including conditional types and executable exports. */
export function packageTargets(manifest: Record<string, unknown>): readonly PackageTarget[] {
  const targets: PackageTarget[] = []
  // This public utility also accepts raw resolver metadata; decode only the fields it consumes.
  const parsed = z
    .object({
      main: JsonDocumentModel.valueSchema.optional(),
      types: JsonDocumentModel.valueSchema.optional(),
      bin: JsonDocumentModel.valueSchema.optional(),
      exports: JsonDocumentModel.valueSchema.optional(),
    })
    .parse(manifest)
  collectStrings(parsed.main, 'main', targets)
  collectStrings(parsed.types, 'types', targets)
  collectStrings(parsed.bin, 'bin', targets)
  collectStrings(parsed.exports, 'exports', targets)
  return targets
}

function diagnostic(config: ResolvedDshxConfig, target: PackageTarget, message: string, hint: string): DshxDiagnostic {
  return { code: 'DSHX4192', severity: 'error', message: `${target.field}: ${message}`, file: config.packageFile, hint }
}

/** Verify every publish-facing package target after build materializes artifacts. */
export async function checkPackageTargets(config: ResolvedDshxConfig): Promise<DshxDiagnostic[]> {
  let manifest: JsonDocumentObject
  try {
    const parsed = JsonDocumentModel.parse(await readFile(config.packageFile, 'utf8'))
    if (!JsonDocumentModel.isObject(parsed)) throw new TypeError('package.json must contain an object')
    manifest = parsed
  } catch (error) {
    return [
      {
        code: 'DSHX4192',
        severity: 'error',
        message: `Cannot validate package targets: ${error instanceof Error ? error.message : String(error)}`,
        file: config.packageFile,
        hint: 'Restore a valid package.json, then rebuild.',
      },
    ]
  }

  const targets = packageTargets(manifest)
  const diagnostics: DshxDiagnostic[] = []
  // A shared module other plugins import must be reachable through its own export subpath.
  for (const shared of config.modules ?? []) {
    const subpath = `./${shared.name}`
    const exported = JsonDocumentModel.isObject(manifest.exports) ? manifest.exports[subpath] : undefined
    if (exported === undefined) {
      diagnostics.push({
        code: 'DSHX4192',
        severity: 'error',
        message: `exports: the shared module "${shared.name}" built by dshx.config.ts has no "${subpath}" subpath.`,
        file: config.packageFile,
        hint: `Add "${subpath}": { "types": "<source>", "default": "./dist/${shared.name}.js" } so another plugin can import it.`,
      })
    }
  }
  const checked = new Set<string>()
  for (const target of targets) {
    const key = `${target.field}\0${target.target}`
    if (checked.has(key)) continue
    checked.add(key)
    const exportTarget = target.field === 'exports' || target.field.startsWith('exports.')
    if (target.target.includes('*') || (exportTarget && !target.target.startsWith('./'))) {
      diagnostics.push(
        diagnostic(
          config,
          target,
          `target ${JSON.stringify(target.target)} is not one concrete package-relative path.`,
          exportTarget
            ? 'Use a concrete export target beginning with "./" so DSHX can verify the packed artifact.'
            : 'Use a concrete package-relative path so DSHX can verify the packed artifact.',
        ),
      )
      continue
    }
    const file = resolve(config.root, target.target)
    const path = relative(config.root, file)
    if (path.startsWith('..') || isAbsolute(path)) {
      diagnostics.push(
        diagnostic(config, target, `target escapes the package root: ${JSON.stringify(target.target)}.`, 'Keep publish targets inside the plugin package.'),
      )
      continue
    }
    try {
      if (!(await stat(file)).isFile()) throw new TypeError('target is not a file')
    } catch {
      diagnostics.push(
        diagnostic(
          config,
          target,
          `target does not exist on disk: ${JSON.stringify(target.target)}.`,
          'Build the artifact or remove the stale package.json target before packing.',
        ),
      )
    }
  }
  return diagnostics
}
