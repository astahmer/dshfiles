import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import type { InlineConfig, Plugin, PluginOption, ResolvedConfig, Rollup } from 'vite'
import { DshxError } from '../diagnostics.js'
import { resolveVitePlugins } from '../config/vite-plugins.js'
import type { BuildArtifact, BuildReport, BuildWatcher } from './types.js'

interface KernelBoundary {
  readonly face: 'host' | 'client'
  readonly root: string
  readonly input: string
  readonly target: string
  readonly assetsInlineLimit: NonNullable<NonNullable<InlineConfig['build']>['assetsInlineLimit']>
  readonly external: NonNullable<NonNullable<NonNullable<InlineConfig['build']>['rollupOptions']>['external']>
  readonly output: Record<string, unknown>
  readonly cssCodeSplit?: boolean
}

/** Resolve native Vite PluginOption nesting while retaining its declared order. */
const resolveUserPlugins = async (options: readonly PluginOption[] | undefined, watch: boolean): Promise<Plugin[]> => {
  return resolveVitePlugins(options, watch)
}

type ViteBuildResult = Awaited<ReturnType<(typeof import('vite'))['build']>>

function outputRecord(config: ResolvedConfig): Rollup.OutputOptions {
  const output = config.build.rollupOptions.output
  if (Array.isArray(output)) {
    throw new DshxError('DSHX1403', 'A Vite plugin replaced the single DSHX output with multiple outputs.')
  }
  return output ?? {}
}

/** Assert that user config hooks did not escape the bounded extension surface. */
const kernelBoundaryPlugin = (boundary: KernelBoundary): Plugin => {
  const fail = (field: string): never => {
    throw new DshxError('DSHX1403', `A Vite plugin attempted to override protected ${boundary.face} build field ${field}.`, {
      hint: 'DSHX plugins may transform modules, but cannot replace root, entries, protocol output, target, chunking, externals, or asset policy.',
    })
  }
  const assertOutput = (output: Rollup.OutputOptions): void => {
    const actual = new Map<string, unknown>(Object.entries(output))
    for (const [field, expected] of Object.entries(boundary.output)) {
      if (actual.get(field) !== expected) fail(`build.rollupOptions.output.${field}`)
    }
    if (output.manualChunks !== undefined) fail('build.rollupOptions.output.manualChunks')
  }
  return {
    name: `dshx-${boundary.face}-kernel-boundary`,
    enforce: 'post',
    configResolved(config) {
      if (config.command !== 'build') fail('command')
      if (config.root !== boundary.root) fail('root')
      if (config.configFile !== undefined) fail('configFile')
      if (config.publicDir !== '') fail('publicDir')
      if (config.build.target !== boundary.target) fail('build.target')
      if (config.build.assetsInlineLimit !== boundary.assetsInlineLimit) fail('build.assetsInlineLimit')
      if (boundary.cssCodeSplit !== undefined && config.build.cssCodeSplit !== boundary.cssCodeSplit) fail('build.cssCodeSplit')
      if (config.build.rollupOptions.input !== boundary.input) fail('build.rollupOptions.input')
      if (config.build.rollupOptions.external !== boundary.external) fail('build.rollupOptions.external')
      assertOutput(outputRecord(config))
    },
    outputOptions(output) {
      assertOutput(output)
      return null
    },
  }
}

function declarationSource(): string {
  return [
    "import type { Context } from '@deepseek-ai/cordis'",
    '',
    'export declare const name: string',
    'export declare const inject: readonly string[] | Readonly<Record<string, unknown>> | undefined',
    'export declare const Config: unknown',
    'export declare function apply(ctx: Context, config?: unknown): unknown',
    '',
  ].join('\n')
}

/** Materialize declarations for the actual module shape loaded by DSH/Cordis. */
const artifactDeclarationPlugin = (face: 'host' | 'client', outDir: string, enabled: boolean): Plugin => {
  const fileName = face === 'host' ? 'index.d.ts' : 'client.d.ts'
  return {
    name: `dshx-${face}-artifact-declaration`,
    enforce: 'post',
    async writeBundle() {
      if (!enabled) {
        await rm(resolve(outDir, fileName), { force: true })
        return
      }
      await mkdir(outDir, { recursive: true })
      await writeFile(resolve(outDir, fileName), declarationSource(), 'utf8')
    },
  }
}

function rollupOutput(result: ViteBuildResult, code: string) {
  if (Array.isArray(result) && result.length !== 1) {
    throw new DshxError(code, `Expected one build output, received ${result.length}.`)
  }
  const completed = Array.isArray(result) ? result[0] : result
  if (typeof completed !== 'object' || completed === null || !('output' in completed) || !Array.isArray(completed.output)) {
    throw new DshxError(code, 'Expected one completed build output.')
  }
  return completed
}

/** Convert Vite/Rolldown output to the stable DSHX report surface. */
const buildReport = (
  result: ViteBuildResult,
  face: 'host' | 'client',
  entryFile: string,
  outDir: string,
  declarations: boolean,
  errorCode: string,
): BuildReport => {
  const built = rollupOutput(result, errorCode)
  const output: BuildArtifact[] = built.output.map(item => ({
    fileName: item.fileName,
    type: item.type,
  }))
  if (declarations) output.push({ fileName: face === 'host' ? 'index.d.ts' : 'client.d.ts', type: 'declaration' })
  return { face, entryFile, outDir, output }
}

/** Validate the structural Vite watcher once at the compiler boundary. */
const buildWatcher = (result: ViteBuildResult, face: 'host' | 'client', errorCode: string): BuildWatcher => {
  if (
    Array.isArray(result) ||
    typeof result !== 'object' ||
    result === null ||
    !('on' in result) ||
    typeof result.on !== 'function' ||
    !('close' in result) ||
    typeof result.close !== 'function'
  ) {
    throw new DshxError(errorCode, `Expected one ${face} watcher result.`, {
      hint: 'Restart the dev session after updating the DSHX compiler.',
    })
  }
  return result
}

/**
 * Record the modules a bundle retained, so a checkout planner can decide which plugins a change
 * affects without reading a full source map (which also carries every source's contents). Real
 * files only: a virtual id cannot be matched against a changed checkout path.
 */
const dependencyManifestPlugin = (options: {
  readonly face: 'host' | 'client'
  readonly root: string
  readonly outDir: string
  readonly entryFile: string
}): Plugin => {
  let modules: readonly string[] = []
  return {
    name: `dshx-${options.face}-dependency-manifest`,
    enforce: 'post',
    generateBundle(_bundleOptions, bundle) {
      const chunk = Object.values(bundle).find(item => item.type === 'chunk' && item.isEntry)
      modules = chunk === undefined || chunk.type !== 'chunk' ? [] : Object.keys(chunk.modules)
    },
    async writeBundle() {
      const sources = [...new Set(modules.flatMap(id => (id.startsWith('\0') || !isAbsolute(id) ? [] : [relative(options.root, id)])))].sort()
      // Content hashes let a freshness check ignore a checkout that rewrote a source without changing it.
      const hashes = Object.fromEntries(
        await Promise.all(
          sources
            .filter(source => !source.includes('node_modules/'))
            .map(async source => {
              const content = await readFile(resolve(options.root, source)).catch(() => undefined)
              return [source, content === undefined ? null : createHash('sha256').update(content).digest('hex')] as const
            }),
        ),
      )
      await mkdir(options.outDir, { recursive: true })
      await writeFile(
        resolve(options.outDir, `${options.entryFile}.deps.json`),
        `${JSON.stringify({ version: 1, face: options.face, sources, hashes }, null, 2)}\n`,
        'utf8',
      )
    },
  }
}

/**
 * Rolldown reports a hook's thrown error inside an aggregate and moves its code to `pluginCode`. Rethrow the DshxError a
 * DSHX guard threw with its own code, file and hint, so the CLI prints the guard's diagnostic.
 */
const surfaceGuardError = (error: unknown): never => {
  const errors = typeof error === 'object' && error !== null && 'errors' in error && Array.isArray(error.errors) ? (error.errors as unknown[]) : []
  const guard = errors.find(item => item instanceof DshxError)
  if (guard === undefined) throw error
  const code = 'pluginCode' in guard && typeof guard.pluginCode === 'string' ? guard.pluginCode : guard.code
  throw new DshxError(code, guard.message.replace(/^DSHX\d+\n\n/u, ''), {
    cause: error,
    ...(guard.file !== undefined && { file: guard.file }),
    ...(guard.hint !== undefined && { hint: guard.hint }),
  })
}

export class CompilerKernel {
  static readonly resolveUserPlugins = resolveUserPlugins
  static readonly boundaryPlugin = kernelBoundaryPlugin
  static readonly artifactDeclarationPlugin = artifactDeclarationPlugin
  static readonly dependencyManifestPlugin = dependencyManifestPlugin
  static readonly buildReport = buildReport
  static readonly buildWatcher = buildWatcher
  static readonly surfaceGuardError = surfaceGuardError
}
