import type { DshCompatibility } from '../compat/types.js'
import type { ResolvedDshxConfig } from '../config/types.js'
import type { JsonObject, JsonValue } from '../json.js'
import type { BuildClientOptions } from './client/build.js'
import type { BuildHostOptions } from './host/build.js'

const isJsonObject = (value: JsonValue | undefined): value is JsonObject => typeof value === 'object' && value !== null && !Array.isArray(value)

/** `dsh.client.external` or `dsh.client.inject` from the package manifest; a malformed list counts as none. */
const clientManifestArray = (project: ResolvedDshxConfig, field: 'external' | 'inject'): readonly string[] => {
  const dsh = project.manifest.dsh
  if (!isJsonObject(dsh)) return []
  const client = dsh.client
  if (!isJsonObject(client)) return []
  const value = client[field]
  if (!Array.isArray(value)) return []
  const strings = value.filter((item): item is string => typeof item === 'string')
  return strings.length === value.length ? strings : []
}

interface FaceTarget {
  readonly project: ResolvedDshxConfig
  readonly compatibility: DshCompatibility
  readonly outDir: string
}

/** `hostHmr` stamps the dev Host generation so `dshx dev` can hot-swap it; a publishing build never carries one. */
const host = (target: FaceTarget & { readonly hostHmr: boolean }): BuildHostOptions => {
  const project = target.project
  return {
    packageId: project.packageId,
    logicalName: project.name,
    root: project.root,
    ...(project.hostEntry !== undefined && { entry: project.hostEntry }),
    outDir: target.outDir,
    sourcemap: project.build.sourcemap,
    declarations: project.build.declarations ?? true,
    bundleDependencies: project.hostBundleDependencies ?? [],
    ...(project.hostDshxRuntime !== undefined && { dshxRuntime: project.hostDshxRuntime }),
    ...(project.hostVitePlugins !== undefined && { vite: { plugins: project.hostVitePlugins } }),
    compatibility: target.compatibility,
    ...(target.hostHmr && project.dev.hostHmr !== undefined && { generation: { hostContractVersion: project.dev.hostHmr.hostContractVersion } }),
  }
}

const client = (target: FaceTarget & { readonly entry: string }): BuildClientOptions => {
  const project = target.project
  return {
    packageId: project.packageId,
    logicalName: project.name,
    root: project.root,
    entry: target.entry,
    outDir: target.outDir,
    sourcemap: project.build.sourcemap,
    declarations: project.build.declarations ?? true,
    minify: project.build.minify ?? false,
    bundleDependencies: project.clientBundleDependencies ?? [],
    ...(project.clientShared !== undefined && { shared: project.clientShared }),
    ...(project.clientSharedRuntime !== undefined && { sharedRuntime: project.clientSharedRuntime }),
    ...(project.clientSharedDshxRuntime === true && { sharedDshxRuntime: true }),
    ...(project.clientDshxRuntime !== undefined && { dshxRuntime: project.clientDshxRuntime }),
    ...(project.clientVitePlugins !== undefined && { vite: { plugins: project.clientVitePlugins } }),
    external: clientManifestArray(project, 'external'),
    inject: clientManifestArray(project, 'inject'),
    compatibility: target.compatibility,
  }
}

/** One projection from a resolved dshx config to the Host and Client compiler options `dshx build` and `dshx dev` share. */
export class FaceBuildOptions {
  static readonly host = host
  static readonly client = client
}
