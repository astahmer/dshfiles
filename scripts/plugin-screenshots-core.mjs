/**
 * Pure decisions behind `scripts/plugin-screenshots.mjs`, so the gate's rules can be tested without a filesystem or a
 * scratch DSH: which plugin is a UI plugin, what a screenshot set is missing, how a capture is embedded, and which
 * catalog feature a capture walks.
 */

export const isUiBundle = catalog => catalog?.kind === 'bundle' && catalog.features.some(feature => feature.surfaces.includes('client'))

export const reachableFeatures = catalog => (catalog?.features ?? []).filter(feature => Array.isArray(feature.reach) && feature.reach.length > 0)

/** The plugins the check gates: UI bundles that do not declare, with a reason, that they render no surface. */
export const gatedPlugins = ({ catalogs, ignored }) =>
  catalogs
    .filter(catalog => isUiBundle(catalog.catalog) && ignored[catalog.name] === undefined)
    .map(catalog => ({ ...catalog, reachable: reachableFeatures(catalog.catalog) }))
    .sort((left, right) => left.name.localeCompare(right.name))

/**
 * A UI plugin needs one screenshot its README embeds. A plugin with no reach steps cannot be captured at all, which the
 * message says instead of asking for a hand-made image of an unverified screen.
 */
export const screenshotProblems = ({ reachable, screenshots, readme, sizeLimitBytes }) => {
  const problems = []
  if (screenshots.length === 0) problems.push(reachable === 0 ? 'no screenshot (catalog has no reach steps to capture)' : 'no screenshot')
  if (readme === undefined) problems.push('no README')
  else
    for (const screenshot of screenshots) {
      const reference = `${screenshot.directory}/${screenshot.file}`
      if (!readme.includes(reference)) problems.push(`${reference} not embedded in README`)
    }
  const large = screenshots.filter(screenshot => screenshot.bytes > sizeLimitBytes)
  if (large.length > 0) problems.push(`${large.map(screenshot => `${screenshot.file} ${Math.round(screenshot.bytes / 1024)} KB`).join(', ')} over 1 MB`)
  return problems
}

/** The screenshot goes under the README title, before the prose that describes the plugin. */
export const embedScreenshot = ({ readme, imagePath, alt }) => {
  if (readme.includes(imagePath)) return readme
  const lines = readme.split('\n')
  const heading = lines.findIndex(line => line.startsWith('# '))
  const insertion = heading === -1 ? 0 : heading + 1
  return [...lines.slice(0, insertion), '', `![${alt}](${imagePath})`, ...lines.slice(insertion)].join('\n')
}

/** `--feature` picks specific features; otherwise a plugin's own picks, or its first reachable feature. */
export const missingScreenshotPlugins = ({ plugins, screenshotsOf }) => plugins.filter(plugin => screenshotsOf(plugin).length === 0)

export const targetFeatures = ({ catalog, picked, primary }) => {
  const reachable = reachableFeatures(catalog).map(feature => feature.id)
  const named = picked.filter(feature => reachable.includes(feature))
  if (named.length > 0) return named
  const preferred = (primary ?? []).filter(feature => reachable.includes(feature))
  if (preferred.length > 0) return preferred
  const first = reachable[0]
  return first === undefined ? [] : [first]
}
