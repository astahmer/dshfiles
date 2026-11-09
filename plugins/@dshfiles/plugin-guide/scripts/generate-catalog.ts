/**
 * Build the Plugin Guide catalog from declarations that are already public:
 *
 * - the offline Client slot reference `dshx inspect slots --explain` reads (create-dshx `slot-capabilities`),
 * - every owned plugin's `dshx.config.ts` `modules` (the only contracts another plugin may import) and the
 *   `defineRegistry` / `defineContract` / `defineApi` tokens those modules export,
 * - the presentation surfaces the feature catalogs (`dshx.features.json`) use,
 * - a short allowlist of dshx SDK entry points, each checked against the dshx public index it is imported from.
 *
 * Nothing here reads a running Host. Run with `node --experimental-strip-types scripts/generate-catalog.ts`; pass
 * `--check` to fail instead of writing when the checked-in catalog is stale.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const pluginRoot = join(here, '..')
const repoRoot = join(pluginRoot, '..', '..', '..')
const pluginsDir = join(repoRoot, 'plugins', '@dshfiles')
const outFile = join(pluginRoot, 'src', 'generated', 'guide-catalog.ts')
const slotReferenceFile = join(repoRoot, 'tooling', 'dshx', 'packages', 'create-dshx', 'src', 'slot-capabilities.ts')
const featureSchemaFile = join(repoRoot, 'tooling', 'dshx', 'packages', 'dshx', 'src', 'project', 'features.ts')

const repoPath = (file: string): string => relative(repoRoot, file).split('\\').join('/')
const read = (file: string): string => readFileSync(file, 'utf8')
const lineOf = (text: string, index: number): number => text.slice(0, index).split('\n').length

type Risk = 'additive' | 'id-reuse-replaces' | 'replaces' | 'shell-owned'
type Kind = 'slot' | 'registry' | 'contract' | 'api' | 'module' | 'surface' | 'sdk'

interface Entry {
  readonly key: string
  readonly kind: Kind
  readonly title: string
  readonly summary: string
  readonly publicSymbol: string
  readonly importFrom: string
  readonly owner: string
  readonly scope: string
  readonly mode: string
  readonly registration: string
  readonly risk: Risk
  readonly riskNote: string
  readonly occupancy: 'static' | 'unavailable'
  readonly occupants: readonly string[]
  readonly details: readonly string[]
  readonly source: string
  readonly docs: string | null
  readonly command: string | null
}

const SUMMARY_LIMIT = 320
const clip = (text: string): string => (text.length <= SUMMARY_LIMIT ? text : `${text.slice(0, SUMMARY_LIMIT - 1).trimEnd()}…`)

/** The JSDoc block that ends right before `index`, flattened to one line; empty when there is none. */
const docBefore = (text: string, index: number): string => {
  const before = text.slice(0, index).trimEnd()
  if (!before.endsWith('*/')) return ''
  const start = before.lastIndexOf('/**')
  if (start < 0) return ''
  return clip(
    before
      .slice(start + 3, -2)
      .split('\n')
      .map(line => line.replace(/^\s*\*\s?/u, '').trim())
      .filter(line => !line.startsWith('@'))
      .join(' ')
      .replace(/\s+/gu, ' ')
      .trim(),
  )
}

/** The first JSDoc block of a file, when it opens the file before any statement. */
const fileDoc = (text: string): string => {
  const match = /^(?:\s*import[^\n]*\n)*\s*\/\*\*([\s\S]*?)\*\//u.exec(text)
  if (match?.[1] === undefined) return ''
  return clip(
    match[1]
      .split('\n')
      .map(line => line.replace(/^\s*\*\s?/u, '').trim())
      .join(' ')
      .replace(/\s+/gu, ' ')
      .trim(),
  )
}

// ---- Native Client slots -------------------------------------------------------------------------------------------

interface SlotReference {
  readonly name: string
  readonly declaredBy: readonly string[]
  readonly kind: 'single' | 'list' | 'keyed' | 'chain'
  readonly scope: string
  readonly identity?: 'id' | 'key'
  readonly registration: readonly string[]
  readonly registrationMetadata?: readonly string[]
  readonly ownerProps?: readonly string[]
  readonly purpose: string
  readonly shippedOccupants: readonly string[]
  readonly replaces: readonly string[]
  readonly childObligations: readonly string[]
  readonly declaration: string
}

// SAFETY: slot-capabilities.ts exports CLIENT_SLOT_REFERENCES typed as ClientSlotReference[], which SlotReference restates field for field.
const slotModule = (await import(pathToFileURL(slotReferenceFile).href)) as { readonly CLIENT_SLOT_REFERENCES: readonly SlotReference[] }
const slotText = read(slotReferenceFile)
/** The DSH release the slot facts were last checked against, from the reference's own header. */
const slotFactsCheckedAgainst = /against the installed ([0-9][^\s]*)\s+(?:\*\s+)?declarations/u.exec(slotText)?.[1] ?? 'unknown'

/** Shell slots: replacing one removes shipped UI and its inner seats. */
const SHELL_SLOTS = new Set(['root', 'sidebar'])

interface SlotRiskNote {
  readonly risk: Risk
  readonly note: string
}

const slotRisk = (slot: SlotReference): SlotRiskNote => {
  if (SHELL_SLOTS.has(slot.name))
    return { risk: 'shell-owned', note: 'Shell-owned: any registration replaces shipped shell UI and the seats it declares. Prefer an additive panel or seat.' }
  if (slot.kind === 'single')
    return { risk: 'replaces', note: `Holds one occupant: registering replaces ${slot.shippedOccupants.join(', ') || 'the shipped occupant'}.` }
  if (slot.replaces.length > 0)
    return {
      risk: 'id-reuse-replaces',
      note: `Additive with a new ${slot.identity ?? 'id'}; reusing "${slot.replaces.join('", "')}" replaces the shipped occupant.`,
    }
  return { risk: 'additive', note: 'Additive: each registration adds an entry.' }
}

const slotEntries: Entry[] = slotModule.CLIENT_SLOT_REFERENCES.map(slot => {
  const { risk, note } = slotRisk(slot)
  return {
    key: `slot:${slot.name}`,
    kind: 'slot',
    title: slot.name,
    summary: slot.purpose,
    publicSymbol: `ctx.slots.register({ name: '${slot.name}'${slot.identity === undefined ? '' : `, ${slot.identity}: …`} }, Component)`,
    importFrom: slot.declaredBy.map(owner => `import type {} from '${owner}'`).join('; '),
    owner: slot.declaredBy.join(', '),
    scope: slot.scope,
    mode: slot.kind,
    registration: [...slot.registration, ...(slot.registrationMetadata ?? [])].join(', ') || 'component only',
    risk,
    riskNote: note,
    occupancy: 'static',
    occupants: slot.shippedOccupants,
    details: [
      ...(slot.ownerProps === undefined ? [] : [`Owner props: ${slot.ownerProps.join('; ')}`]),
      ...slot.childObligations.map(obligation => `When replacing: ${obligation}`),
      `Declared at ${slot.declaration}`,
    ],
    source: `${repoPath(slotReferenceFile)}:${String(lineOf(slotText, slotText.indexOf(`name: '${slot.name}'`)))}`,
    docs: 'tooling/dshx/docs/guides/client.md',
    command: `dshx inspect slots --explain --root ${slot.name}`,
  }
})

// ---- Owned dshx modules ---------------------------------------------------------------------------------------------

/** `modules: { name: 'src/file.ts', … }` of one dshx.config.ts, comments removed. */
const modulesOf = (config: string): ReadonlyMap<string, string> => {
  const block = /modules:\s*\{([^}]*)\}/u.exec(config.replace(/\/\/[^\n]*/gu, ''))?.[1] ?? ''
  const modules = new Map<string, string>()
  for (const match of block.matchAll(/['"]?([\w-]+)['"]?\s*:\s*['"]([^'"]+)['"]/gu)) {
    const [, name, file] = match
    if (name !== undefined && file !== undefined) modules.set(name, file)
  }
  return modules
}

const NO_OCCUPANTS: readonly string[] = []
const DEFINE = /export const (\w+)\s*=\s*(defineRegistry|defineContract|defineApi)\b/gu

interface ApiFacts {
  readonly id: string
  readonly details: readonly string[]
}

const apiDetails = (text: string, from: number): ApiFacts => {
  const body = text.slice(from)
  const id = /id:\s*'([^']+)'/u.exec(body)?.[1] ?? 'unknown'
  const methodsStart = body.indexOf('methods:')
  const methodText = methodsStart < 0 ? '' : body.slice(methodsStart)
  // A method is `name: method(` or `name: Something.method(` at the method map's indentation.
  const methods = [...methodText.matchAll(/^\s{4}(\w+):\s*(?:\w+\.)?method\b/gmu)].map(match => match[1] ?? '')
  const tools = [...methodText.matchAll(/tool:\s*\{\s*name:\s*'([^']+)'(?:,\s*readOnly:\s*(true))?/gu)].map(match =>
    match[2] === 'true' ? `${match[1] ?? ''} (read-only)` : (match[1] ?? ''),
  )
  return {
    id,
    details: [...(methods.length === 0 ? [] : [`Methods: ${methods.join(', ')}`]), ...(tools.length === 0 ? [] : [`Agent tools: ${tools.join(', ')}`])],
  }
}

const moduleEntries: Entry[] = []
for (const name of readdirSync(pluginsDir).sort()) {
  const configFile = join(pluginsDir, name, 'dshx.config.ts')
  if (!existsSync(configFile)) continue
  const packageName = `@dshfiles/${name}`
  for (const [moduleName, file] of modulesOf(read(configFile))) {
    const sourceFile = join(pluginsDir, name, file)
    if (!existsSync(sourceFile)) throw new Error(`${repoPath(configFile)} declares module ${moduleName} at ${file}, which does not exist.`)
    const text = read(sourceFile)
    const importFrom = `@dshfiles/${name}/${moduleName}`
    const defines = [...text.matchAll(DEFINE)]
    if (defines.length === 0) {
      const exported = [
        ...new Set([...text.matchAll(/^export (?:declare )?(?:const|function|class|interface|type|enum) (\w+)/gmu)].map(match => match[1] ?? '')),
      ]
      moduleEntries.push({
        key: `module:${importFrom}`,
        kind: 'module',
        title: importFrom,
        summary: fileDoc(text) || `Public module of ${packageName}.`,
        publicSymbol: exported.slice(0, 6).join(', ') || '(side-effect module)',
        importFrom,
        owner: packageName,
        scope: file.endsWith('.tsx') ? 'client' : 'client or host',
        mode: 'shared types and helpers',
        registration: 'import',
        risk: 'additive',
        riskNote: 'Importing it adds a dependency on its owner; it registers nothing by itself.',
        occupancy: 'unavailable',
        occupants: [],
        details: exported.length > 6 ? [`Also exports: ${exported.slice(6, 24).join(', ')}`] : [],
        source: repoPath(sourceFile),
        docs: 'docs/plugin-boundaries.md',
        command: null,
      })
      continue
    }
    for (const match of defines) {
      const [, symbol, define] = match
      if (symbol === undefined || define === undefined || match.index === undefined) continue
      const summary = docBefore(text, match.index)
      const base = {
        publicSymbol: symbol,
        importFrom,
        owner: packageName,
        source: `${repoPath(sourceFile)}:${String(lineOf(text, match.index))}`,
        occupancy: 'unavailable' as const,
        occupants: NO_OCCUPANTS,
      }
      if (define === 'defineRegistry') {
        const id = /defineRegistry<[^>]*>\(\s*'([^']+)'/u.exec(text.slice(match.index))?.[1] ?? symbol
        moduleEntries.push({
          ...base,
          key: `registry:${id}`,
          kind: 'registry',
          title: symbol,
          summary: summary || `Contribution registry owned by ${packageName}.`,
          scope: 'client',
          mode: 'many contributors',
          registration: `metadata?.plugin?.add(${symbol}, { … })`,
          risk: 'additive',
          riskNote: `Additive: each contribution adds an entry; ${packageName} renders nothing for it when absent.`,
          details: [`Registry id: ${id}`],
          docs: 'docs/plugin-boundaries.md',
          command: null,
        })
      } else if (define === 'defineContract') {
        const id = /defineContract<[^>]*>\(\s*'([^']+)'/u.exec(text.slice(match.index))?.[1] ?? symbol
        moduleEntries.push({
          ...base,
          key: `contract:${id}`,
          kind: 'contract',
          title: symbol,
          summary: summary || `Client service contract provided by ${packageName}.`,
          scope: 'client',
          mode: 'one provider',
          registration: `ctx.use(${symbol}) to consume; only ${packageName} provides it`,
          risk: 'additive',
          riskNote: `Consuming is additive. Providing it is ${packageName}'s job: a second provider would compete with the owner.`,
          details: [`Contract id: ${id}`],
          docs: 'docs/plugin-boundaries.md',
          command: null,
        })
      } else {
        const api = apiDetails(text, match.index)
        moduleEntries.push({
          ...base,
          key: `api:${packageName}:${api.id}`,
          kind: 'api',
          title: `${symbol} (${api.id})`,
          summary: summary || `Host API served by ${packageName}.`,
          scope: 'host, called from clients, other Host plugins and agents',
          mode: 'host methods',
          registration: `useApi(${symbol}) in a Client slot, or createHostApiClient(ctx, ${symbol}, packageId) on the Host`,
          risk: 'additive',
          riskNote: `Calling is additive; ${packageName} owns the handlers. Treat isApiOwnerMissing(error) as "feature absent".`,
          details: api.details,
          docs: 'tooling/dshx/docs/guides/api.md',
          command: null,
        })
      }
    }
  }
}

// ---- Presentation surfaces from the feature catalogs ----------------------------------------------------------------

// SAFETY: features.ts exports DSHX_PRESENTATION_SURFACES as a readonly tuple of string literals.
const featureSchema = (await import(pathToFileURL(featureSchemaFile).href)) as { readonly DSHX_PRESENTATION_SURFACES: readonly string[] }
const usage = new Map<string, { count: number; destinations: Set<string>; examples: string[] }>()
for (const name of readdirSync(pluginsDir).sort()) {
  const catalogFile = join(pluginsDir, name, 'dshx.features.json')
  if (!existsSync(catalogFile)) continue
  // SAFETY: features:check validates every dshx.features.json against the catalog schema; only id, surface and destination are read.
  const catalog = JSON.parse(read(catalogFile)) as {
    readonly features?: readonly { readonly id: string; readonly surface?: string; readonly destination?: string }[]
  }
  for (const feature of catalog.features ?? []) {
    if (feature.surface === undefined) continue
    const row = usage.get(feature.surface) ?? { count: 0, destinations: new Set<string>(), examples: [] }
    row.count += 1
    if (feature.destination !== undefined) row.destinations.add(feature.destination)
    if (row.examples.length < 4) row.examples.push(`@dshfiles/${name} › ${feature.id}`)
    usage.set(feature.surface, row)
  }
}

const SURFACE_NOTES = {
  command: 'A palette or slash command; no page of its own.',
  destinationSection: 'A page listed under a rail destination: a `main` panel plus one DestinationSections entry.',
  threadFacet: 'A tab of the active thread’s side panel.',
  detail: 'A detail view opened from a row or link.',
  rowDecorator: 'A badge or marker on an existing row.',
  rowAction: 'An action on an existing row (menu item or button).',
  transcriptCard: 'A card rendered in the conversation transcript.',
  composerContribution: 'A control in the composer row or dock.',
  statusItem: 'An item in the status strip.',
  settingsSection: 'A section of Settings.',
  attentionProvider: 'Items for the Inbox (Needs you).',
  entityProvider: 'Entities other plugins can reference or mention.',
  agentToolOnly: 'An agent tool with no UI beyond the tool itself.',
  infrastructure: 'Plumbing the user never addresses directly.',
} satisfies Record<string, string>
const surfaceNote = (surface: string): string | undefined => new Map<string, string>(Object.entries(SURFACE_NOTES)).get(surface)

const surfaceEntries: Entry[] = featureSchema.DSHX_PRESENTATION_SURFACES.map(surface => {
  const row = usage.get(surface)
  return {
    key: `surface:${surface}`,
    kind: 'surface',
    title: surface,
    summary: surfaceNote(surface) ?? 'Presentation surface from the feature catalog schema.',
    publicSymbol: `"surface": "${surface}"`,
    importFrom: 'dshx.features.json',
    owner: '@dshfiles/dshx (feature catalog schema)',
    scope: 'catalog',
    mode: 'presentation contract',
    registration: 'Declare it on the feature in dshx.features.json with destination and currentSurface.',
    risk: 'additive',
    riskNote: 'Catalog metadata only; features:check validates the surface/destination pair.',
    occupancy: 'static',
    occupants: row?.examples ?? [],
    details: [
      `Used by ${String(row?.count ?? 0)} catalog feature(s)`,
      ...(row === undefined || row.destinations.size === 0 ? [] : [`Destinations in use: ${[...row.destinations].sort().join(', ')}`]),
    ],
    source: repoPath(featureSchemaFile),
    docs: 'docs/observability.md',
    command: 'pnpm --dir tooling/dshx run features:check',
  }
})

// ---- dshx SDK entry points -------------------------------------------------------------------------------------------

const DSHX_SRC = join(repoRoot, 'tooling', 'dshx', 'packages', 'dshx', 'src')
const SDK_INDEX = {
  '@dshfiles/dshx/client': join(DSHX_SRC, 'client', 'index.ts'),
  '@dshfiles/dshx/api': join(DSHX_SRC, 'api', 'index.ts'),
  '@dshfiles/dshx/effect': join(DSHX_SRC, 'effect', 'index.ts'),
  '@dshfiles/dshx/host': join(DSHX_SRC, 'host', 'index.ts'),
  '@dshfiles/dshx/tracing': join(DSHX_SRC, 'tracing', 'index.ts'),
  '@dshfiles/dshx/settings': join(DSHX_SRC, 'settings', 'index.ts'),
} satisfies Record<string, string>

interface SdkSeed {
  readonly symbol: string
  readonly importFrom: keyof typeof SDK_INDEX
  readonly title: string
  readonly summary: string
  readonly scope: string
  readonly registration: string
  readonly docs: string
  readonly command?: string
}

const SDK_SEEDS: readonly SdkSeed[] = [
  {
    symbol: 'defineClient',
    importFrom: '@dshfiles/dshx/client',
    title: 'Client entry',
    summary: 'The browser half of a plugin: inject native services, register slots, add registry contributions.',
    scope: 'client',
    registration: "export default defineClient({ name, inject: ['slots', …], setup(ctx, decorate, metadata) { … } })",
    docs: 'tooling/dshx/docs/guides/client.md',
    command: 'dshx add ui',
  },
  {
    symbol: 'defineRegistry',
    importFrom: '@dshfiles/dshx/client',
    title: 'Own a registry',
    summary: 'Let other plugins contribute entries to a screen you own; publish the token as a dshx module.',
    scope: 'client',
    registration: "export const Things = defineRegistry<Thing>('@dshfiles/<plugin>.thing')",
    docs: 'docs/plugin-boundaries.md',
  },
  {
    symbol: 'defineContract',
    importFrom: '@dshfiles/dshx/client',
    title: 'Own a client service',
    summary: 'One provider, many consumers, in the browser; publish the token as a dshx module.',
    scope: 'client',
    registration: "export const Thing = defineContract<ThingService>('@dshfiles/<plugin>.thing', { owner })",
    docs: 'docs/plugin-boundaries.md',
  },
  {
    symbol: 'defineApi',
    importFrom: '@dshfiles/dshx/api',
    title: 'Host API with agent tools',
    summary: 'Typed Host methods for clients, other Host plugins and agents; `tool: { name, readOnly }` exposes a method as an agent tool.',
    scope: 'host',
    registration: 'defineApi({ id, version: 1, owner, methods: { read: method({ input, output, description, tool: { name, readOnly: true } }) } })',
    docs: 'tooling/dshx/docs/guides/api.md',
  },
  {
    symbol: 'DshxPlugin',
    importFrom: '@dshfiles/dshx/effect',
    title: 'Effect Host entry',
    summary: 'The Host half as an Effect program: a layer of services, an optional main fiber, and Api.bind handlers.',
    scope: 'host',
    registration: "export default DshxPlugin.make({ name: 'dshfiles-<plugin>', layer, apis: [Api.bind(api, handlers)] })",
    docs: 'tooling/dshx/docs/guides/effect.md',
  },
  {
    symbol: 'createHostApiClient',
    importFrom: '@dshfiles/dshx/host',
    title: 'Call another plugin from the Host',
    summary: 'Typed in-process client for another plugin’s dshx API; never grab its Cordis service or fetch over HTTP.',
    scope: 'host',
    registration: 'createHostApiClient(ctx, otherApi, packageId)',
    docs: 'tooling/dshx/docs/guides/api.md',
  },
  {
    symbol: 'defineSettings',
    importFrom: '@dshfiles/dshx/settings',
    title: 'Plugin settings',
    summary: 'A typed settings namespace; it must equal the Loader row id in cordis.patch.yml.',
    scope: 'host and client',
    registration: "defineSettings({ namespace: 'dshfiles-<plugin>', schema })",
    docs: 'tooling/dshx/docs/guides/settings.md',
  },
  {
    symbol: 'withSpan',
    importFrom: '@dshfiles/dshx/tracing',
    title: 'Telemetry span',
    summary: 'Wrap one unit of Host I/O in a span named `<subject> <verb>` and list it in the feature catalog.',
    scope: 'host',
    registration: "withSpan('thing fetch', { attributes }, run)",
    docs: 'tooling/dshx/docs/guides/tracing.md',
  },
]

const sdkEntries: Entry[] = SDK_SEEDS.map(seed => {
  const indexFile = SDK_INDEX[seed.importFrom]
  if (indexFile === undefined || !existsSync(indexFile)) throw new Error(`No dshx public index for ${seed.importFrom}.`)
  const indexText = read(indexFile)
  const at = indexText.search(new RegExp(`\\b${seed.symbol}\\b`, 'u'))
  if (at < 0) throw new Error(`${seed.symbol} is no longer exported from ${seed.importFrom} (${repoPath(indexFile)}); update the Plugin Guide allowlist.`)
  if (!existsSync(join(repoRoot, seed.docs))) throw new Error(`Plugin Guide entry ${seed.symbol} links ${seed.docs}, which does not exist.`)
  return {
    key: `sdk:${seed.importFrom}#${seed.symbol}`,
    kind: 'sdk',
    title: seed.title,
    summary: seed.summary,
    publicSymbol: seed.symbol,
    importFrom: seed.importFrom,
    owner: '@dshfiles/dshx',
    scope: seed.scope,
    mode: 'SDK entry point',
    registration: seed.registration,
    risk: 'additive',
    riskNote: 'Additive: it registers only what you declare.',
    occupancy: 'unavailable',
    occupants: [],
    details: [],
    source: `${repoPath(indexFile)}:${String(lineOf(indexText, at))}`,
    docs: seed.docs,
    command: seed.command ?? null,
  }
})

// ---- Write ------------------------------------------------------------------------------------------------------------

for (const entry of [...slotEntries, ...moduleEntries]) {
  if (entry.docs !== null && !existsSync(join(repoRoot, entry.docs))) throw new Error(`${entry.key} links ${entry.docs}, which does not exist.`)
}

// SAFETY: every npm package.json carries a string version; @deepseek-ai/dsh is a pinned devDependency of this package.
const dshPackage = JSON.parse(read(join(pluginRoot, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'))) as { readonly version: string }
const entries = [...sdkEntries, ...slotEntries, ...moduleEntries, ...surfaceEntries]
const keys = new Set<string>()
for (const entry of entries) {
  if (keys.has(entry.key)) throw new Error(`Duplicate Plugin Guide key ${entry.key}.`)
  keys.add(entry.key)
}

const catalog = {
  schemaVersion: 1,
  dshVersion: dshPackage.version,
  slotFactsCheckedAgainst,
  generatedFrom: [
    repoPath(slotReferenceFile),
    'plugins/@dshfiles/*/dshx.config.ts (modules)',
    'plugins/@dshfiles/*/dshx.features.json (surface)',
    'tooling/dshx/packages/dshx/src/**/index.ts (SDK allowlist)',
  ],
  entries,
}

const output = `// Generated by scripts/generate-catalog.ts from public declarations; run \`pnpm generate\`, never edit by hand.
import type { GuideCatalog } from '../catalog-model.js'

export const GUIDE_CATALOG: GuideCatalog = ${JSON.stringify(catalog, null, 2)}
`

const current = existsSync(outFile) ? read(outFile) : ''
if (process.argv.includes('--check')) {
  if (current !== output) {
    console.error(`${repoPath(outFile)} is stale: run \`pnpm --dir plugins/@dshfiles/plugin-guide generate\` and commit the result.`)
    process.exit(1)
  }
  console.log(`Plugin Guide catalog is current (${String(entries.length)} entries).`)
} else if (current === output) {
  console.log(`Plugin Guide catalog unchanged (${String(entries.length)} entries).`)
} else {
  writeFileSync(outFile, output)
  console.log(`Wrote ${repoPath(outFile)} (${String(entries.length)} entries).`)
}
