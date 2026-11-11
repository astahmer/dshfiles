/**
 * Rows of the repository's web seed (`profiles/web/cordis.patch.yml`) that compose a bundle under test from inside
 * another row. A bundle composed as an agent preset child (`@dshfiles/tool-ask-user` as `preset-standard`'s
 * `tool-ask-user`) has no row of its own, so a scratch profile without the seed's preset row never loads it: the
 * scratch copies that whole row, verbatim, so the composition is the one the seed ships.
 *
 * Top-level rows that only name the bundle itself are left out: a bundle's own `cordis.patch.yml` composes those.
 */

const escaped = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Split a patch into its column-0 list entries, each with its indented lines; column-0 comments end an entry. */
const topLevelEntries = (patch: string): readonly string[] => {
  const entries: string[][] = []
  let current: string[] | undefined
  for (const line of patch.replace(/\r\n?/g, '\n').split('\n')) {
    if (line.startsWith('- ')) {
      current = [line]
      entries.push(current)
    } else if (/^\S/.test(line)) {
      current = undefined
    } else if (current !== undefined) {
      current.push(line)
    }
  }
  return entries.map(lines => lines.join('\n').replace(/\s+$/, ''))
}

/**
 * The seed rows that name one of the bundles below their own first level.
 * @param seedPatch - The seed's `cordis.patch.yml` text.
 * @param bundleIds - Package ids of the bundles the scratch composes.
 * @returns The matching rows as patch text (empty when none), in seed order.
 */
export const seedRowsComposingNestedBundles = (seedPatch: string, bundleIds: readonly string[]): string => {
  if (bundleIds.length === 0) return ''
  const nestedName = new RegExp(`^ {4,}(?:- )?name:\\s*['"]?(?:${bundleIds.map(escaped).join('|')})['"]?\\s*$`, 'm')
  return topLevelEntries(seedPatch)
    .filter(entry => nestedName.test(entry))
    .join('\n')
}

/** A native fork composed in place of the upstream package it vendors. */
export interface NestedForkSwap {
  readonly packageId: string
  readonly upstreamPackage: string
}

/**
 * The seed rows that nest a fork's upstream package, with that child renamed to the fork. A preset-child fork the seed
 * leaves on the stock package (`@dshfiles/tool-fs` as `preset-standard`'s `tool-fs`) has no row of its own, so booting
 * it alone composes it the way opting in does: the seed's row with that one `name` swapped.
 * @param seedPatch - The seed's `cordis.patch.yml` text.
 * @param forks - The forks to swap in, each with the upstream package its `native-fork.json` names.
 * @returns The rewritten rows as patch text (empty when none), in seed order.
 */
export const seedRowsSwappingNestedForks = (seedPatch: string, forks: readonly NestedForkSwap[]): string =>
  topLevelEntries(seedPatch)
    .flatMap(entry => {
      let swapped = entry
      for (const fork of forks) {
        const nestedName = new RegExp(`^( {4,}(?:- )?name:\\s*)(['"]?)${escaped(fork.upstreamPackage)}\\2\\s*$`, 'gm')
        swapped = swapped.replace(nestedName, `$1$2${fork.packageId}$2`)
      }
      return swapped === entry ? [] : [swapped]
    })
    .join('\n')
