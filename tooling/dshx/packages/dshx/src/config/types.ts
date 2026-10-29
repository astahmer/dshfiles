import type { PluginOption } from 'vite'
import type { JsonObject } from '../json.js'

/** The deliberately bounded Vite extension surface for one DSHX face. */
export interface DshxViteExtensions {
  readonly plugins?: readonly PluginOption[]
}

/** Enable and optionally relocate one conventional DSHX face. */
export interface DshxFaceConfig {
  readonly entry?: string
  readonly vite?: DshxViteExtensions
  readonly bundleDependencies?: readonly string[]
}

/** Host package roots that DSHX should embed in its single Host artifact. */
export interface DshxHostConfig extends DshxFaceConfig {}

/** Client face options, including the opt-in shared runtime on either side. */
export interface DshxClientConfig extends DshxFaceConfig {
  /**
   * Package id of a shared-runtime supplier. Every module it provides resolves to the supplier's copy instead of a
   * private one; the supplier must be listed in `dsh.client.external` and built first.
   */
  readonly shared?: string
  /** Make this package a shared-runtime supplier for the listed exact module specifiers. */
  readonly sharedRuntime?: {
    readonly provide: readonly string[]
  }
}

/** One extra shared entry point: an export subpath name and the source entry it builds from. */
export interface DshxModuleEntry {
  readonly name: string
  readonly entry: string
}

/** User-authored DSHX project exceptions. */
export interface DshxHostHmrConfig {
  readonly hostContractVersion: string
}

export interface DshxConfig {
  readonly name?: string
  readonly host?: false | DshxHostConfig
  readonly client?: false | DshxClientConfig
  /**
   * Extra entry points other plugins import, keyed by export subpath name
   * (`{ contract: 'src/contract.ts' }` builds `dist/contract.js`). Point the
   * package.json `types` condition at the source file; the built JavaScript
   * keeps every bare import external so consumers share one copy.
   */
  readonly modules?: Readonly<Record<string, string>>
  readonly profile?: string
  readonly dev?: {
    readonly hostRestart?: 'manual' | 'auto'
    readonly hostHmr?: DshxHostHmrConfig
  }
  readonly build?: {
    readonly sourcemap?: boolean
    readonly declarations?: boolean
    /** Minify the production Client chunk (not `dshx dev`). Defaults to false. */
    readonly minify?: boolean
  }
  readonly compatibility?: {
    readonly allowUnsupported?: boolean
  }
}

/** Options controlling project-root discovery. */
export interface ResolveDshxConfigOptions {
  readonly cwd?: string
}

/** Fully normalized project metadata consumed by later DSHX stages. */
export interface ResolvedDshxConfig {
  readonly root: string
  readonly packageFile: string
  readonly configFile?: string
  readonly configDependencies: readonly string[]
  readonly packageId: string
  readonly name: string
  readonly hostEntry?: string
  readonly clientEntry?: string
  readonly hostVitePlugins?: readonly PluginOption[]
  readonly hostBundleDependencies?: readonly string[]
  readonly clientBundleDependencies?: readonly string[]
  readonly clientVitePlugins?: readonly PluginOption[]
  readonly clientShared?: string
  readonly clientSharedRuntime?: readonly string[]
  readonly modules?: readonly DshxModuleEntry[]
  readonly outDir: string
  readonly profile: string
  readonly dev: {
    readonly hostRestart: 'manual' | 'auto'
    readonly hostHmr?: DshxHostHmrConfig
  }
  readonly build: {
    readonly sourcemap: boolean
    readonly declarations?: boolean
    readonly minify?: boolean
  }
  readonly compatibility: {
    readonly allowUnsupported: boolean
  }
  readonly manifest: JsonObject
}
