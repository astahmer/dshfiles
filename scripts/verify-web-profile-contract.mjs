import { readFile, readdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const profileRoot = join(repositoryRoot, 'profiles/web')
const pluginsRoot = join(repositoryRoot, 'plugins/@dshfiles')
const profileManifestSchema = z
  .object({
    dependencies: z.record(z.string(), z.string()),
    dsh: z.object({ profile: z.object({ bundles: z.array(z.string()) }) }),
  })
  .passthrough()
const bundleManifestSchema = z
  .object({
    name: z.string(),
    dsh: z
      .object({
        client: z.object({ external: z.array(z.string()).default([]) }).optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough()

const readJson = async (path, schema) => schema.parse(JSON.parse(await readFile(path, 'utf8')))
const isOwnedPackage = packageId => /^@dshfiles\/[^/]+$/.test(packageId)
const packageIdFromExternal = external => /^@dshfiles\/[^/]+/.exec(external)?.[0]

/** A seeded profile reconciles only this region, so a stock-row override above it never reaches an existing profile. */
const managedRegion = patch => {
  const start = patch.indexOf('# BEGIN NIX-MANAGED DSH PLUGINS')
  const end = patch.indexOf('# END NIX-MANAGED DSH PLUGINS', start)
  return start === -1 || end === -1 ? '' : patch.slice(start, end)
}
const disablesStockRow = patch => /id:\s*['"]?session-query-sqlite['"]?[\s\S]{0,200}?disabled:\s*true/u.test(patch)

/**
 * One process may own the `sessionQuery` service, and the stock SQLite row registers before every owned bundle. While
 * it stays enabled it wins the service, so content search silently runs on the read path that freezes the Host instead
 * of the owned worker. Both layers are needed: the bundle patch covers a profile whose local layer never mentions the
 * row, and the seed's managed region covers a profile seeded while the row was still enabled locally.
 */
export const sessionSearchOwnershipErrors = ({ seedPatch, bundlePatch, bundles }) => {
  if (!bundles.includes('@dshfiles/session-search')) return []
  const errors = []
  if (!disablesStockRow(managedRegion(seedPatch))) {
    errors.push('profiles/web/cordis.patch.yml must disable session-query-sqlite inside the managed region: an existing profile only reconciles that region.')
  }
  if (!disablesStockRow(bundlePatch)) {
    errors.push('@dshfiles/session-search/cordis.patch.yml must disable session-query-sqlite so its own bundle wins the sessionQuery service.')
  }
  return errors
}

export const webProfileContractErrors = (profile, bundleManifests) => {
  const profileBundles = new Set(profile.dsh.profile.bundles)
  const sourceBundles = new Map(bundleManifests.map(manifest => [manifest.name, manifest]))
  const errors = []

  for (const packageId of profileBundles) {
    if (!isOwnedPackage(packageId)) continue

    const manifest = sourceBundles.get(packageId)
    if (manifest === undefined) {
      errors.push(`${packageId}: profile bundle has no source package manifest.`)
      continue
    }
    if (manifest.dsh === undefined) {
      errors.push(`${packageId}: source package has no DSH bundle metadata.`)
      continue
    }

    if (manifest.name !== packageId) errors.push(`${packageId}: source package declares name ${manifest.name}.`)
    if (profile.dependencies[packageId] === undefined) errors.push(`${packageId}: profile bundle has no dependency entry.`)

    for (const external of manifest.dsh.client?.external ?? []) {
      const provider = packageIdFromExternal(external)
      if (provider === undefined || provider === packageId) continue
      if (profile.dependencies[provider] === undefined) {
        errors.push(`${packageId}: external provider ${provider} is missing from profiles/web dependencies.`)
      }
      if (!profileBundles.has(provider)) {
        errors.push(`${packageId}: external provider ${provider} is missing from dsh.profile.bundles.`)
      }
    }
  }

  for (const manifest of bundleManifests) {
    if (manifest.dsh === undefined || profile.dependencies[manifest.name] === undefined) continue
    if (!profile.dependencies[manifest.name].startsWith('link:')) {
      errors.push(`${manifest.name}: local profile dependency must use a link: source.`)
    }
    if (!profileBundles.has(manifest.name)) errors.push(`${manifest.name}: profile dependency is not registered in dsh.profile.bundles.`)
  }

  return errors
}

const verifyWebProfileContract = async () => {
  const profile = await readJson(join(profileRoot, 'package.json'), profileManifestSchema)
  const sourceEntries = await readdir(pluginsRoot, { withFileTypes: true })
  const bundleManifests = []
  for (const entry of sourceEntries) {
    if (!entry.isDirectory()) continue
    const packagePath = join(pluginsRoot, entry.name, 'package.json')
    try {
      bundleManifests.push(await readJson(packagePath, bundleManifestSchema))
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') continue
      throw error
    }
  }

  return [
    ...webProfileContractErrors(profile, bundleManifests),
    ...sessionSearchOwnershipErrors({
      seedPatch: await readFile(join(profileRoot, 'cordis.patch.yml'), 'utf8'),
      bundlePatch: await readFile(join(pluginsRoot, 'session-search', 'cordis.patch.yml'), 'utf8'),
      bundles: profile.dsh.profile.bundles,
    }),
  ]
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const errors = await verifyWebProfileContract()
  if (errors.length > 0) {
    console.error('Web profile external-provider contract failed:')
    for (const error of errors) console.error(`  - ${error}`)
    process.exitCode = 1
  } else {
    console.log('Web profile bundle dependencies cover every local external provider.')
  }
}
