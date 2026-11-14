export interface PreflightOptions {
  readonly sourceRoot: string
  readonly dshHome: string
  readonly profile: string
  readonly coreEntry: string
  readonly nodeBinary: string
  readonly coreEntrySource?: string
  readonly env?: NodeJS.ProcessEnv
  readonly apply?: boolean
  readonly hostsRunning?: () => readonly number[]
}

export interface PreflightResult {
  readonly ok: boolean
  readonly problems: readonly { readonly check: 'core' | 'node' | 'presets' | 'composition'; readonly message: string }[]
  readonly notes: readonly string[]
  readonly migrated: readonly { readonly file: string; readonly backup: string | null }[]
}

/** Startup preflight for a source checkout launch. */
export declare class Preflight {
  static run(options: PreflightOptions): PreflightResult
  static format(result: PreflightResult, options: { readonly profile: string }): string[]
  static checkoutCoreEntry(sourceRoot: string): string
  static corePackageOf(entry: string): { readonly directory: string; readonly version: string; readonly engines: Record<string, string> } | undefined
}
