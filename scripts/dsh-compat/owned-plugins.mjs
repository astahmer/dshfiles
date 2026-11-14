/**
 * Owned plugins this repository renamed or removed, and what a profile that
 * still selects one needs.
 *
 * Removing a plugin deletes its tracked sources, but its git-ignored `dist/`,
 * `node_modules` and `.turbo` stay in the checkout. A profile that still
 * selects it keeps linking that directory: a "build exists" check passes, DSH
 * then skips the bundle (no `package.json`) and every service it provided is
 * missing. A selected package whose sources are gone is therefore a problem,
 * but a missing directory alone never authorizes changing a profile: only a
 * change recorded here does, and anything else is an error the user resolves.
 *
 * Keep entries forever: a profile can skip many updates. Add one in the same
 * revision that renames or removes a plugin under `plugins/@dshfiles/`.
 */

/** @typedef {{ name: string, change: 'renamed', to: string, revision: string, date: string }} Rename */
/** @typedef {{ name: string, change: 'removed', revision: string, date: string, note: string }} Removal */

/** @type {readonly (Rename | Removal)[]} */
const CHANGES = [
  { name: '@dshfiles/pulls-review', change: 'renamed', to: '@dshfiles/diffs-review', revision: 'e75f8b8a', date: '2026-11-09' },
  {
    name: '@dshfiles/project-folder-picker',
    change: 'removed',
    revision: '00fda92f',
    date: '2026-11-04',
    note: 'its component moved into @dshfiles/workspace-folder-picker',
  },
  { name: '@dshfiles/plugin-marketplace', change: 'removed', revision: 'd8f555ff', date: '2026-11-04', note: 'the Framework Hub marketplace tab was removed' },
  {
    name: '@dshfiles/privacy-controls',
    change: 'removed',
    revision: 'ae3304a0',
    date: '2026-11-04',
    note: 'the feedback and upload switches page was removed',
  },
  { name: '@dshfiles/session-warming', change: 'removed', revision: '075e738d', date: '2026-11-04', note: 'the prompt-cache keep-alive plugin was removed' },
  { name: '@dshfiles/home', change: 'removed', revision: 'd83200bf', date: '2026-11-04', note: 'the New thread screen plugin was removed' },
  { name: '@dshfiles/sidebar-commands', change: 'removed', revision: 'bf714f53', date: '2026-10-29', note: 'its commands moved into the sidebar plugins' },
  { name: '@dshfiles/optmem', change: 'removed', revision: '67ad92ca', date: '2026-10-16', note: 'the standalone OptMem bundles were retired' },
  { name: '@dshfiles/optmem-sqlite', change: 'removed', revision: '67ad92ca', date: '2026-10-16', note: 'the standalone OptMem bundles were retired' },
  {
    name: '@dshfiles/settings-search',
    change: 'removed',
    revision: 'c76c1c6c',
    date: '2026-10-14',
    note: 'Settings search moved into @dshfiles/settings-shell',
  },
  { name: '@dshfiles/cursor-agent', change: 'removed', revision: '5db6070a', date: '2026-10-13', note: 'it needed a patched DSH core' },
  { name: '@dshfiles/dsh-core-agent-loop', change: 'removed', revision: '5db6070a', date: '2026-10-13', note: 'it needed a patched DSH core' },
  { name: '@dshfiles/dsh-core-runtime', change: 'removed', revision: '5db6070a', date: '2026-10-13', note: 'it needed a patched DSH core' },
  { name: '@dshfiles/bash-parallel', change: 'removed', revision: '2914786c', date: '2026-10-04', note: 'shortcuts claims chords itself now' },
]

const describe = entry =>
  entry.change === 'renamed'
    ? `${entry.name} was renamed ${entry.to} (${entry.revision}, ${entry.date}); its data moves with it`
    : `${entry.name} was removed (${entry.revision}, ${entry.date}): ${entry.note}; its stored data is kept on disk`

/**
 * Rewrite a profile manifest's owned selection for the plugins this checkout
 * no longer has. Pure: returns a new manifest, the changes made, and the
 * selected packages whose sources are gone for no recorded reason.
 *
 * A rename keeps the bundle's position and never duplicates a package the
 * profile already selects. A removal drops the bundle and its dependency and
 * adds nothing in its place, even when another plugin absorbed it: adding a
 * plugin is the user's choice.
 *
 * @param {{ dependencies?: Record<string, string>, dsh: { profile: { bundles: string[] } } }} manifest
 * @param {(name: string) => boolean} hasSource whether `plugins/<name>/package.json` exists in the checkout
 */
const migrateSelection = (manifest, hasSource) => {
  const next = structuredClone(manifest)
  next.dependencies ??= {}
  const changes = []
  const unknown = []
  const bundles = []
  for (const name of next.dsh.profile.bundles) {
    if (!name.startsWith('@dshfiles/') || hasSource(name)) {
      bundles.push(name)
      continue
    }
    const entry = CHANGES.find(candidate => candidate.name === name)
    if (entry === undefined) {
      unknown.push(name)
      bundles.push(name)
      continue
    }
    const specifier = next.dependencies[name]
    delete next.dependencies[name]
    if (entry.change === 'renamed') {
      if (!next.dsh.profile.bundles.includes(entry.to) && !bundles.includes(entry.to)) {
        bundles.push(entry.to)
        if (specifier !== undefined) next.dependencies[entry.to] = specifier.replace(name, entry.to)
      }
    }
    changes.push({ ...entry, message: describe(entry) })
  }
  // Dependencies of known changes that are no longer selected as bundles, so a stale link is not reinstalled.
  for (const name of Object.keys(next.dependencies)) {
    if (!name.startsWith('@dshfiles/') || hasSource(name) || bundles.includes(name)) continue
    const entry = CHANGES.find(candidate => candidate.name === name)
    if (entry === undefined) continue
    delete next.dependencies[name]
    if (!changes.some(change => change.name === name)) changes.push({ ...entry, message: describe(entry) })
  }
  next.dsh.profile.bundles = bundles
  return { manifest: next, changes, unknown }
}

/** The recovery for a selected package that has no sources and no recorded change. */
const unknownMessage = ({ name, root, manifestPath }) =>
  `${name} is selected in ${manifestPath}, but ${root}/plugins/${name} has no package.json (only build leftovers, if anything). ` +
  'No recorded rename or removal explains it. Update the checkout if it is behind, restore the plugin, or remove ' +
  `${name} from dsh.profile.bundles and dependencies in ${manifestPath}; nothing was started or changed.`

/** Owned plugin renames and removals, and the profile migration they imply. */
export class OwnedPlugins {
  static CHANGES = CHANGES
  static migrateSelection = migrateSelection
  static unknownMessage = unknownMessage
}
