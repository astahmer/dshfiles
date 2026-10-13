import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { z } from 'zod'

/**
 * Link every owned bundle into a DSH profile and install it.
 *
 * `pnpm add <path>` cannot express a local bundle (see AGENTS.md), so this
 * declares `link:` dependencies and the bundle list in the profile manifest,
 * then runs `pnpm install` there. Bundles link to the checkout running this
 * script; `@dshfiles/*` rows that no longer exist are removed.
 */

const repositoryRoot = join(import.meta.dirname, '..')
const packagesRoot = join(repositoryRoot, 'plugins/@dshfiles')

const profileManifestSchema = z.looseObject({
  dependencies: z.record(z.string(), z.string()).default({}),
  dsh: z.looseObject({ profile: z.looseObject({ bundles: z.array(z.string()) }) }),
})

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

const selectedNames = values.bundle === undefined ? null : new Set(values.bundle)
if (selectedNames !== null) {
  const unknown = [...selectedNames].filter(name => !ownedBundles.some(bundle => bundle.name === name))
  if (unknown.length > 0) throw new Error(`Unknown owned bundles: ${unknown.join(', ')}`)
}
const selectedBundles = ownedBundles.filter(bundle => selectedNames === null || selectedNames.has(bundle.name))

const manifest = profileManifestSchema.parse(JSON.parse(readFileSync(manifestPath, 'utf8')))
const isOwned = (name: string): boolean => name.startsWith('@dshfiles/')

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
console.log(`profile ${values.profile}: ${selectedBundles.length} owned bundles from ${repositoryRoot}`)
for (const name of added) console.log(`  + ${name}`)
for (const name of removed) console.log(`  - ${name}`)

if (values['dry-run']) process.exit(0)
writeFileSync(manifestPath, `${JSON.stringify(next, null, 2)}\n`)
execFileSync('pnpm', ['install'], { cwd: profileDirectory, stdio: 'inherit' })
