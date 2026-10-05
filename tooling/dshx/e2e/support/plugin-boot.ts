import { prepareBootProfile } from '../../packages/dshx/src/project/boot-profile.js'
import { buildPlugin, listLocalBootBundles, startScratchProfile, type BootedProfile } from './boot.js'

export interface PluginBoot extends BootedProfile {
  readonly pluginId: string
}

/** Bundles with DSH metadata, which is the package contract the profile composes. */
export const listPlugins = async (): Promise<readonly string[]> => (await listLocalBootBundles()).map(bundle => bundle.packageId)

/** Build and boot one owned bundle in its own disposable DSH profile. */
export const bootPluginAlone = async (pluginId: string, timeoutMs = 90_000): Promise<PluginBoot> => {
  const bundle = (await listLocalBootBundles()).find(candidate => candidate.packageId === pluginId)
  if (bundle === undefined) throw new Error(`No owned DSH bundle was found for ${pluginId}.`)
  await buildPlugin(bundle.projectRoot, bundle.packageId)
  const prepared = await prepareBootProfile(bundle.projectRoot, bundle.packageId)
  const expectedClientEntries = bundle.hasClient ? [bundle.packageId] : []
  const profile = await startScratchProfile(prepared, pluginId, expectedClientEntries, timeoutMs)
  return { ...profile, pluginId }
}
