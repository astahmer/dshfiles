import * as Schema from 'effect/Schema'

/** How a surface reacts to a new registration: the question "will this add mine, or replace what ships?". */
export const GUIDE_RISKS = ['additive', 'id-reuse-replaces', 'replaces', 'shell-owned'] as const
export const GUIDE_KINDS = ['sdk', 'slot', 'registry', 'contract', 'api', 'module', 'surface'] as const

export type GuideRisk = (typeof GUIDE_RISKS)[number]
export type GuideKind = (typeof GUIDE_KINDS)[number]

export const guideEntrySchema = Schema.Struct({
  key: Schema.String,
  kind: Schema.Literals(GUIDE_KINDS),
  title: Schema.String,
  summary: Schema.String,
  publicSymbol: Schema.String,
  importFrom: Schema.String,
  owner: Schema.String,
  scope: Schema.String,
  mode: Schema.String,
  registration: Schema.String,
  risk: Schema.Literals(GUIDE_RISKS),
  riskNote: Schema.String,
  /** V1 never says `live`: occupants are the shipped composition at build time, or unknown. */
  occupancy: Schema.Literals(['static', 'unavailable']),
  occupants: Schema.Array(Schema.String),
  details: Schema.Array(Schema.String),
  /** Repository path (with line) of the declaration this entry was generated from. */
  source: Schema.String,
  docs: Schema.NullOr(Schema.String),
  command: Schema.NullOr(Schema.String),
})

export const guideCatalogSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  /** The DSH release the catalog was generated against. */
  dshVersion: Schema.String,
  /** The DSH release create-dshx's slot reference says its facts were checked against. */
  slotFactsCheckedAgainst: Schema.String,
  generatedFrom: Schema.Array(Schema.String),
  entries: Schema.Array(guideEntrySchema),
})

export type GuideEntry = typeof guideEntrySchema.Type
export type GuideCatalog = typeof guideCatalogSchema.Type

export const KIND_LABEL = {
  sdk: 'SDK entry points',
  slot: 'Native slots',
  registry: 'Registries',
  contract: 'Client contracts',
  api: 'Host APIs',
  module: 'Shared modules',
  surface: 'Catalog surfaces',
} as const satisfies Record<GuideKind, string>

export const RISK_LABEL = {
  additive: 'Additive',
  'id-reuse-replaces': 'Replaces if the id is reused',
  replaces: 'Replaces shipped UI',
  'shell-owned': 'Shell-owned · high risk',
} as const satisfies Record<GuideRisk, string>

export interface GuideFreshness {
  readonly catalogDshVersion: string
  /** The DSH this Host runs, when it could be read; null when unknown. */
  readonly runtimeDshVersion: string | null
  /** Catalog and running DSH differ, or slot facts were checked against another release. */
  readonly stale: boolean
  readonly reasons: readonly string[]
}

export interface GuideQuery {
  readonly query?: string | undefined
  readonly kind?: GuideKind | undefined
  readonly limit?: number | undefined
}

export interface GuideSearchResult {
  readonly total: number
  readonly entries: readonly GuideEntry[]
}

const DEFAULT_LIMIT = 40
const DRAFT_LIMIT = 4_000

export class PluginGuide {
  static freshness(catalog: GuideCatalog, runtimeDshVersion: string | null): GuideFreshness {
    const reasons: string[] = []
    if (runtimeDshVersion !== null && runtimeDshVersion !== catalog.dshVersion)
      reasons.push(`The catalog was generated for DSH ${catalog.dshVersion}; this Host runs ${runtimeDshVersion}. Rebuild @dshfiles/plugin-guide.`)
    if (catalog.slotFactsCheckedAgainst !== catalog.dshVersion)
      reasons.push(
        `Native slot facts were last checked against DSH ${catalog.slotFactsCheckedAgainst}, not ${catalog.dshVersion}. Confirm a slot with \`dshx inspect slots --root <slot>\` on a running DSH.`,
      )
    return { catalogDshVersion: catalog.dshVersion, runtimeDshVersion, stale: reasons.length > 0, reasons }
  }

  /** Up to `limit` entries whose title, symbol, import path, owner or summary contain every word of the query. */
  static search(catalog: GuideCatalog, input: GuideQuery): GuideSearchResult {
    const matches = PluginGuide.matching(catalog, input)
    return { total: matches.length, entries: matches.slice(0, Math.max(1, Math.min(input.limit ?? DEFAULT_LIMIT, 200))) }
  }

  static matching(catalog: GuideCatalog, input: GuideQuery): readonly GuideEntry[] {
    const words = (input.query ?? '')
      .toLowerCase()
      .split(/\s+/u)
      .filter(word => word !== '')
    return catalog.entries.filter(entry => {
      if (input.kind !== undefined && entry.kind !== input.kind) return false
      if (words.length === 0) return true
      const haystack = `${entry.title} ${entry.publicSymbol} ${entry.importFrom} ${entry.owner} ${entry.summary} ${entry.key}`.toLowerCase()
      return words.every(word => haystack.includes(word))
    })
  }

  /** The bounded text "Draft for agent" puts in a new thread's composer: facts and links, never an instruction to send. */
  static draft(entry: GuideEntry, catalog: GuideCatalog): string {
    const lines = [
      `Plugin Guide · ${KIND_LABEL[entry.kind]} · ${entry.title} (static catalog, DSH ${catalog.dshVersion})`,
      entry.summary,
      `Symbol: ${entry.publicSymbol}`,
      `Import: ${entry.importFrom}`,
      `Owner: ${entry.owner}`,
      `Scope: ${entry.scope} · Mode: ${entry.mode}`,
      `Registration: ${entry.registration}`,
      `Risk: ${RISK_LABEL[entry.risk]}. ${entry.riskNote}`,
      ...entry.details,
      `Source: ${entry.source}`,
      ...(entry.docs === null ? [] : [`Docs: ${entry.docs}`]),
      ...(entry.command === null ? [] : [`Check: ${entry.command}`]),
      `Occupancy: ${entry.occupancy === 'static' ? `static (build-time): ${entry.occupants.join(', ') || 'none recorded'}` : 'unavailable'} — not live.`,
    ]
    const text = lines.join('\n')
    return text.length <= DRAFT_LIMIT ? text : `${text.slice(0, DRAFT_LIMIT - 1)}…`
  }

  /** The agent tool's text: one line per entry, then the freshness note. */
  static render(result: { readonly freshness: GuideFreshness; readonly total: number; readonly entries: readonly GuideEntry[] }): string {
    const lines = result.entries.map(
      entry =>
        `${entry.kind} · ${entry.title} · ${entry.importFrom} · ${RISK_LABEL[entry.risk]} · ${entry.source}${entry.docs === null ? '' : ` · docs ${entry.docs}`}`,
    )
    return [
      `Static catalog for DSH ${result.freshness.catalogDshVersion}; occupancy is never live. ${String(result.entries.length)} of ${String(result.total)} matching entries.`,
      ...result.freshness.reasons,
      ...lines,
    ].join('\n')
  }
}
