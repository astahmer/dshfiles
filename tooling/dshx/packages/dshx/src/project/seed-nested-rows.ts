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
