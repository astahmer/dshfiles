#!/usr/bin/env node
// Generates plans/ade-ux/migration-map.md from every plugins/@dshfiles/*/dshx.features.json: per ADE destination the
// features that land there and where they live today, and per current left-nav entry where its features go.
// It also writes plugins/@dshfiles/thread-sidebar/src/moved-to.generated.ts, the data behind the sidebar's "Moved to…"
// help. `--check` fails when either committed file is stale. Classification lives in the catalogs (`surface`, `destination`,
// `currentSurface`); `features:check` validates the values.
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DESTINATIONS = [
  ['threads', 'Threads', 'rail destination (default)'],
  ['inbox', 'Inbox', 'rail destination'],
  ['land', 'Land', 'rail destination'],
  ['work', 'Work', 'rail destination'],
  ['agents', 'Agents', 'rail destination'],
  ['observe', 'Observe', 'rail destination'],
  ['knowledge', 'Knowledge', 'rail destination'],
  ['settings', 'Settings', 'rail destination (bottom)'],
  ['thread-panel', 'Thread panel', 'facets of the active thread'],
  ['composer', 'Composer', 'run row, chips, `/` and `@` sources'],
  ['transcript', 'Transcript', 'cards inline in the active thread'],
  ['none', 'No place of its own', 'palette commands, status items, agent tools, infrastructure'],
]

/**
 * Choices where plans/ade-ux/README.md reads two ways. Each names the features it covers so the map shows them next to
 * the decision; change the catalog and this list together.
 */
const DECISIONS = [
  [
    'agent-toolkit/agent-toolkit-page',
    'Thread panel › Context facet, not the Agents destination: the page shows what the agent can use in one thread (§4.4 Context lists agent-toolkit).',
  ],
  ['pulls-review/*', 'Thread panel › Changes facet scopes (§4.4), not a Land detail page; Land keeps the cross-thread queue and History.'],
  ['jujutsu/composer-context', 'Thread panel › Changes facet "vs main" scope, not a composer chip.'],
  [
    'jj-integration/thread-workspace-menu, jj-integration/rebase',
    'Thread panel › Changes › Land card; the header keeps only the workspace state text (§4.4 header).',
  ],
  [
    'ai-accounts/quota-auto-retry, thread-sidebar/usage-limit-group, thread-sidebar/interrupted-turn-threads',
    'attentionProvider (Needs you with Resume verbs, §6 "Interrupted / quota-blocked shown twice"), not transcript cards; the inline continuation card is rendered from the same item.',
  ],
  [
    'ai-accounts/account-lifecycle, ai-accounts/reference-dashboard, ai-accounts/model-routing',
    'Settings › Models & accounts; only the usage/quota/forecast views move to Observe.',
  ],
  ['ai-accounts/thread-account-switch', 'Composer: the model picker owns per-thread account choice (§6 model pickers).'],
  ['ai-accounts/disabled-account-preview, ai-accounts/active-chat-account', 'Status strip quota item, not Observe; the full quota view is Observe › Usage.'],
  ['activity-timeline/activity-condensation', 'attentionProvider: activity-timeline hosts the attention service (§7); the plain feed is Observe › Activity.'],
  ['traces/alert-rules', 'attentionProvider (a firing alert is a Needs you item); the rule editor stays a tab of Observe › Traces.'],
  ['memory/usage-telemetry', 'Knowledge › Memory analytics, not Observe › Usage: it judges memory quality, cost is secondary.'],
  [
    'hmr-gate/plugins-row, thread-sidebar/pending-host-restart, thread-sidebar/client-reload-banner',
    'statusItem; the matching inbox item arrives with Phase 2.',
  ],
  ['settings-shell/dsh-release-notice', 'Settings › About (release notes), not a status item.'],
  ['references/session-references, resource-packs/local-properties', 'Knowledge, although neither has a UI in the mounted profile today.'],
  ['policies/deny-policies', 'Settings › Security, although it has no UI today (agent tool only).'],
  ['workspace-folder-picker/*', 'Composer project picker (the one ProjectPicker of §6), not Settings › Projects; registration lists can move later.'],
  ['multi-host/runtime-directory, multi-host/host-management', 'Adding a host is Settings › Hosts & network; the live Hosts page is Observe › Hosts.'],
  [
    'workbench/*, main-tabs/*',
    'Docking and tab chrome are infrastructure owned by the shell; dockable-panel-layouts becomes the Settings layout mode, terminal-pages the Terminal facet.',
  ],
  [
    'agent-questions/parent-child-question, agent-questions/cross-thread-question-inbox',
    'attentionProvider (target, §6 questions), although today they are agent tools only.',
  ],
  ['preview/preview-browser, annotations/preview-file', 'Thread panel › Browser facet, although the first is driven by agent tools.'],
  ['chat/windowed-transcript', 'transcriptCard: it is the transcript renderer itself.'],
  [
    'entityProvider features',
    '§5 gives entityProvider no destination, so each lands in the destination that owns its entity (agents, work, knowledge, land, threads).',
  ],
]

const NATIVE_LEFT_NAV = [
  ['Plugins', 'settings', 'Settings › Plugins (native page, not in a catalog)'],
  ['Schedules', 'work', 'Work › schedules (native page, not in a catalog)'],
]

/** Every left-nav entry today and the destinations its features go to, sorted by entry. */
export const leftNavMoves = features => {
  const navEntries = new Map()
  for (const feature of features) {
    const entry = leftNavEntry(feature.currentSurface)
    if (entry === undefined) continue
    const destinations = navEntries.get(entry) ?? new Set()
    destinations.add(feature.destination)
    navEntries.set(entry, destinations)
  }
  const order = DESTINATIONS.map(([id]) => id)
  return [
    ...[...navEntries].sort(([a], [b]) => a.localeCompare(b)).map(([entry, destinations]) => ({
      entry,
      destinations: [...destinations].sort((a, b) => order.indexOf(a) - order.indexOf(b)),
    })),
    ...NATIVE_LEFT_NAV.map(([entry, destination]) => ({ entry, destinations: [destination] })),
  ]
}

const quote = value => `'${String(value).replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`

/** The sidebar module that lists every former left-nav entry; its test checks each one has a home. */
export const renderMovedTo = features =>
  [
    '// Generated by `pnpm ade:migration-map` from the dshx.features.json catalogs; do not edit by hand.',
    '// Every left-nav entry before the rail (plans/ade-ux §4.2) and the destinations its features go to.',
    '',
    'export interface FormerNavigationEntry {',
    '  readonly entry: string',
    '  readonly destinations: readonly string[]',
    '}',
    '',
    'export const FORMER_NAVIGATION: readonly FormerNavigationEntry[] = [',
    ...leftNavMoves(features).map(
      ({ entry, destinations }) => `  { entry: ${quote(entry)}, destinations: [${destinations.map(quote).join(', ')}] },`,
    ),
    ']',
    '',
  ].join('\n')

const escapeCell = value => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ')

const leftNavEntry = currentSurface => {
  if (!currentSurface.startsWith('left-nav: ')) return undefined
  return currentSurface
    .slice('left-nav: '.length)
    .split(' › ')[0]
    .replace(/ \(.*\)$/u, '')
}

const region = currentSurface => {
  const index = currentSurface.indexOf(': ')
  return index < 0 ? currentSurface : currentSurface.slice(0, index)
}

/** @param {readonly { plugin: string, id: string, title: string, surface: string, destination: string, currentSurface: string }[]} features */
export const renderMigrationMap = features => {
  const sorted = [...features].sort((a, b) => a.plugin.localeCompare(b.plugin) || a.id.localeCompare(b.id))
  const known = new Set(DESTINATIONS.map(([id]) => id))
  const unknown = sorted.filter(feature => !known.has(feature.destination))
  if (unknown.length > 0) throw new Error(`unknown destination: ${unknown.map(f => `${f.plugin}/${f.id}=${f.destination}`).join(', ')}`)
  const surfaces = [...new Set(sorted.map(feature => feature.surface))].sort()
  const lines = []
  const push = (...items) => lines.push(...items)

  push(
    '# ADE migration map',
    '',
    '<!-- Generated by `pnpm ade:migration-map` from the dshx.features.json catalogs; do not edit by hand. -->',
    '',
    'Where every catalog feature lands in the unified shell of [the ADE plan](README.md), and where it lives today. The',
    'classification is the `surface`, `destination` and `currentSurface` fields of each feature in',
    '`plugins/@dshfiles/*/dshx.features.json`; `features:check` validates them. Fix a row there, then regenerate.',
    '',
    `${String(sorted.length)} features from ${String(new Set(sorted.map(f => f.plugin)).size)} plugins.`,
    '',
    '## Counts',
    '',
    `| Destination | ${surfaces.join(' | ')} | Total |`,
    `| --- | ${surfaces.map(() => '---:').join(' | ')} | ---: |`,
  )
  for (const [id, label] of DESTINATIONS) {
    const inDestination = sorted.filter(feature => feature.destination === id)
    if (inDestination.length === 0) continue
    const counts = surfaces.map(surface => inDestination.filter(feature => feature.surface === surface).length || '')
    push(`| ${label} | ${counts.join(' | ')} | ${String(inDestination.length)} |`)
  }

  push(
    '',
    '## By current left-nav entry',
    '',
    "Every entry of today's Navigation list and where its features go. No entry survives as a rail item of its own.",
    '',
  )
  const navEntries = new Map()
  for (const feature of sorted) {
    const entry = leftNavEntry(feature.currentSurface)
    if (entry === undefined) continue
    navEntries.set(entry, [...(navEntries.get(entry) ?? []), feature])
  }
  push('| Left-nav entry today | Goes to | Features |', '| --- | --- | --- |')
  const destinationLabel = id => DESTINATIONS.find(([candidate]) => candidate === id)?.[1] ?? id
  for (const [entry, entryFeatures] of [...navEntries].sort(([a], [b]) => a.localeCompare(b))) {
    const targets = [...new Set(entryFeatures.map(feature => destinationLabel(feature.destination)))].join(', ')
    const list = entryFeatures.map(feature => `${feature.plugin}/${feature.id} → ${destinationLabel(feature.destination)} (${feature.surface})`).join('<br>')
    push(`| ${escapeCell(entry)} | ${escapeCell(targets)} | ${escapeCell(list)} |`)
  }
  for (const [entry, destination, note] of NATIVE_LEFT_NAV) push(`| ${entry} (native) | ${destinationLabel(destination)} | ${note} |`)

  push('', '## By current region', '', 'Features grouped by the region they occupy today (the prefix of `currentSurface`).', '')
  const regions = new Map()
  for (const feature of sorted) {
    const key = region(feature.currentSurface)
    regions.set(key, [...(regions.get(key) ?? []), feature])
  }
  push('| Region today | Features | Destinations |', '| --- | ---: | --- |')
  for (const [key, regionFeatures] of [...regions].sort(([a], [b]) => a.localeCompare(b))) {
    const counts = new Map()
    for (const feature of regionFeatures) counts.set(destinationLabel(feature.destination), (counts.get(destinationLabel(feature.destination)) ?? 0) + 1)
    const summary = [...counts]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([label, count]) => `${label} ${String(count)}`)
      .join(', ')
    push(`| ${escapeCell(key)} | ${String(regionFeatures.length)} | ${escapeCell(summary)} |`)
  }

  push('', '## By destination')
  for (const [id, label, description] of DESTINATIONS) {
    const inDestination = sorted.filter(feature => feature.destination === id)
    if (inDestination.length === 0) continue
    push('', `### ${label}`, '', `${description}; ${String(inDestination.length)} features.`, '', '| Feature | Surface | Today |', '| --- | --- | --- |')
    for (const feature of [...inDestination].sort(
      (a, b) => a.surface.localeCompare(b.surface) || a.plugin.localeCompare(b.plugin) || a.id.localeCompare(b.id),
    )) {
      push(`| ${escapeCell(`${feature.plugin}/${feature.id}`)}: ${escapeCell(feature.title)} | ${feature.surface} | ${escapeCell(feature.currentSurface)} |`)
    }
  }

  push('', '## Ambiguous choices', '', 'Where the plan reads two ways, the catalogs take this reading.', '', '| Features | Choice |', '| --- | --- |')
  for (const [subject, choice] of DECISIONS) push(`| ${escapeCell(subject)} | ${escapeCell(choice)} |`)
  return `${lines.join('\n')}\n`
}

const collectFeatures = async root => {
  const pluginsRoot = resolve(root, 'plugins/@dshfiles')
  const features = []
  const missing = []
  for (const entry of (await readdir(pluginsRoot, { withFileTypes: true })).filter(item => item.isDirectory())) {
    const source = await readFile(resolve(pluginsRoot, entry.name, 'dshx.features.json'), 'utf8').catch(error => {
      if (error?.code === 'ENOENT') return undefined
      throw error
    })
    if (source === undefined) continue
    for (const feature of JSON.parse(source).features) {
      const { id, title, surface, destination, currentSurface } = feature
      if (surface === undefined || destination === undefined || currentSurface === undefined) {
        missing.push(`${entry.name}/${id}`)
        continue
      }
      features.push({ plugin: entry.name, id, title, surface, destination, currentSurface })
    }
  }
  return { features, missing }
}

const main = async () => {
  const args = process.argv.slice(2)
  const check = args.includes('--check')
  const rootIndex = args.indexOf('--root')
  const root = rootIndex >= 0 ? resolve(args[rootIndex + 1] ?? '.') : resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const { features, missing } = await collectFeatures(root)
  if (missing.length > 0) process.stderr.write(`Left out ${String(missing.length)} unclassified features (run features:check): ${missing.join(', ')}\n`)
  const outputs = [
    ['plans/ade-ux/migration-map.md', renderMigrationMap(features)],
    ['plugins/@dshfiles/thread-sidebar/src/moved-to.generated.ts', renderMovedTo(features)],
  ]
  if (check) {
    for (const [relative, rendered] of outputs) {
      const current = await readFile(resolve(root, relative), 'utf8').catch(() => '')
      if (current !== rendered) {
        process.stderr.write(`${relative} is stale. Run \`pnpm ade:migration-map\` and commit the result.\n`)
        process.exitCode = 1
      }
    }
    if (process.exitCode !== 1) process.stdout.write(`The migration map and moved-to data are current (${String(features.length)} features).\n`)
    return
  }
  for (const [relative, rendered] of outputs) {
    await writeFile(resolve(root, relative), rendered)
    process.stdout.write(`Wrote ${relative} (${String(features.length)} features).\n`)
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
