import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { z } from 'zod'

/**
 * Link owned bundles into a DSH profile and install it.
 *
 * `pnpm add <path>` cannot express a local bundle (see AGENTS.md), so this
 * declares `link:` dependencies and the bundle list in the profile manifest,
 * then runs `pnpm install` there. When the repository has a seed for the
 * profile (`profiles/<name>/package.json`), the profile gets exactly the seed's
 * `@dshfiles/*` bundles; otherwise it gets every owned bundle. `--bundle` adds
 * or refreshes the named bundles and leaves the other rows alone. Bundles link
 * to the checkout running this script; other `@dshfiles/*` rows are removed.
 */

const repositoryRoot = join(import.meta.dirname, '..')
const packagesRoot = join(repositoryRoot, 'plugins/@dshfiles')

const profileManifestSchema = z.looseObject({
  dependencies: z.record(z.string(), z.string()).default({}),
  dsh: z.looseObject({ profile: z.looseObject({ bundles: z.array(z.string()) }) }),
})

const readManifest = (path: string): z.infer<typeof profileManifestSchema> => profileManifestSchema.parse(JSON.parse(readFileSync(path, 'utf8')))

const { values } = parseArgs({
  options: {
    profile: { type: 'string', default: 'probe' },
    home: { type: 'string' },
    bundle: { type: 'string', multiple: true },
    'dry-run': { type: 'boolean', default: false },
  },
})
const profileDirectory = join(values.home ?? join(homedir(), '.dsh'), 'profiles', values.profile)
const manifestPath = join(profileDirectory, 'package.json')
if (!existsSync(manifestPath)) throw new Error(`Profile ${values.profile} has no package.json at ${manifestPath}.`)

const ownedBundles = readdirSync(packagesRoot, { withFileTypes: true })
  .filter(entry => entry.isDirectory() && existsSync(join(packagesRoot, entry.name, 'cordis.patch.yml')))
  .map(entry => ({ name: `@dshfiles/${entry.name}`, directory: join(packagesRoot, entry.name) }))
  .sort((left, right) => left.name.localeCompare(right.name))

const isOwned = (name: string): boolean => name.startsWith('@dshfiles/')

const seedDirectory = join(repositoryRoot, 'profiles', values.profile)
const seedManifestPath = join(seedDirectory, 'package.json')
const seedBundles = (): { name: string; directory: string }[] => {
  const seed = readManifest(seedManifestPath)
  return seed.dsh.profile.bundles.filter(isOwned).map(name => {
    const specifier = seed.dependencies[name]
    if (specifier === undefined || !specifier.startsWith('link:')) {
      throw new Error(`Seed ${seedManifestPath} lists bundle ${name} without a link: dependency.`)
    }
    const directory = resolve(seedDirectory, specifier.slice('link:'.length))
    if (!existsSync(join(directory, 'cordis.patch.yml'))) throw new Error(`Seed bundle ${name} links to ${directory}, which is not an owned bundle.`)
    return { name, directory }
  })
}

const selectedNames = values.bundle === undefined ? null : new Set(values.bundle)
if (selectedNames !== null) {
  const unknown = [...selectedNames].filter(name => !ownedBundles.some(bundle => bundle.name === name))
  if (unknown.length > 0) throw new Error(`Unknown owned bundles: ${unknown.join(', ')}`)
}
const selectedBundles =
  selectedNames !== null ? ownedBundles.filter(bundle => selectedNames.has(bundle.name)) : existsSync(seedManifestPath) ? seedBundles() : ownedBundles

const manifest = readManifest(manifestPath)

const dependencies = Object.fromEntries([
  ...Object.entries(manifest.dependencies).filter(([name]) => (selectedNames === null ? !isOwned(name) : !selectedNames.has(name))),
  ...selectedBundles.map(bundle => [bundle.name, `link:${bundle.directory}`]),
])
const bundles = [
  ...manifest.dsh.profile.bundles.filter(name => (selectedNames === null ? !isOwned(name) : !selectedNames.has(name))),
  ...selectedBundles.map(bundle => bundle.name),
]
const next = { ...manifest, dependencies, dsh: { ...manifest.dsh, profile: { ...manifest.dsh.profile, bundles } } }

const removed = manifest.dsh.profile.bundles.filter(name => isOwned(name) && !bundles.includes(name))
const added = bundles.filter(name => !manifest.dsh.profile.bundles.includes(name))
const source = selectedNames === null && existsSync(seedManifestPath) ? `the ${values.profile} seed` : 'the repository'
console.log(`profile ${values.profile}: ${selectedBundles.length} owned bundles from ${source} at ${repositoryRoot}`)
for (const name of added) console.log(`  + ${name}`)
for (const name of removed) console.log(`  - ${name}`)

if (values['dry-run']) process.exit(0)
writeFileSync(manifestPath, `${JSON.stringify(next, null, 2)}\n`)
execFileSync('pnpm', ['install'], { cwd: profileDirectory, stdio: 'inherit' })
