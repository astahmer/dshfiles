import { realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import { build } from 'vite'
import { DshxError } from '../../diagnostics.js'
import { isHostExternal } from '../host/guards.js'

/** Options for one shared module other plugins import. */
export interface BuildModuleOptions {
  readonly packageId: string
  readonly name: string
  readonly entry: string
  readonly outDir: string
  readonly root?: string
  readonly sourcemap?: boolean
}

/** One built shared module artifact. */
export interface ModuleBuildResult {
  readonly output: readonly { readonly fileName: string }[]
}

const isInside = (parent: string, child: string): boolean => {
  const path = relative(parent, child)
  return path !== '' && !path.startsWith('..') && !isAbsolute(path)
}

/**
 * Build one shared entry point. Every bare import stays external so the
 * consumer resolves its own copy of `@dshfiles/dshx/api`, zod or cordis; only
 * the module's own source is bundled.
 */
export async function buildModule(options: BuildModuleOptions): Promise<ModuleBuildResult> {
  if (options.name.trim() === '' || !/^[a-z][a-z0-9-]*$/u.test(options.name)) {
    throw new DshxError('DSHX4007', `Invalid shared module name ${JSON.stringify(options.name)}.`)
  }
  const root = await realpath(resolve(options.root ?? process.cwd()))
  const outDir = resolve(root, options.outDir)
  const entry = await realpath(resolve(root, options.entry)).catch((cause: unknown) => {
    const file = resolve(root, options.entry)
    throw new DshxError('DSHX1301', `Shared module entry does not exist: ${file}`, { cause, file })
  })
  if (outDir === root || isInside(outDir, entry)) {
    throw new DshxError('DSHX1003', `Shared module output directory ${outDir} would overwrite project sources.`, {
      hint: 'Choose a dedicated output directory such as dist.',
    })
  }
  const result = await build({
    root,
    configFile: false,
    publicDir: false,
    appType: 'custom',
    mode: 'production',
    logLevel: 'error',
    build: {
      ssr: true,
      target: 'es2022',
      outDir,
      emptyOutDir: false,
      copyPublicDir: false,
      minify: false,
      sourcemap: options.sourcemap ?? true,
      watch: null,
      lib: { entry, formats: ['es'], fileName: () => `${options.name}.js` },
      rollupOptions: { external: isHostExternal, preserveEntrySignatures: 'strict' },
    },
  })
  const outputs = Array.isArray(result) ? result : [result]
  const output = outputs.flatMap(
    item =>
      (item as { readonly output?: readonly { readonly fileName?: string }[] }).output?.flatMap(entry =>
        entry.fileName === undefined ? [] : [{ fileName: entry.fileName }],
      ) ?? [],
  )
  const required = `${options.name}.js`
  if (!output.some(entry => entry.fileName === required)) {
    throw new DshxError('DSHX1302', `Shared module ${JSON.stringify(options.name)} did not emit ${required}.`)
  }
  return { output }
}
