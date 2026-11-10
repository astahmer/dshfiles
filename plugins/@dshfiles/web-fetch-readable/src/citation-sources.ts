import { Option, Schema } from 'effect'

/** One page a web tool returned: where it lives, the host it names and its title when the tool knew one. */
export interface CitationSource {
  readonly url: string
  readonly host: string
  readonly title: string | undefined
}

const searchMetaSchema = Schema.Struct({
  sources: Schema.Array(Schema.Struct({ url: Schema.String, title: Schema.optional(Schema.String) })),
})
const fetchMetaSchema = Schema.Struct({ url: Schema.String })

/** The readable article opens with its title as a level-one heading (see extract.ts). */
const FIRST_HEADING = /^#\s+(.+?)\s*#*\s*$/mu

const source = (url: string, title: string | undefined): Option.Option<CitationSource> => {
  if (!URL.canParse(url)) return Option.none()
  const parsed = new URL(url)
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return Option.none()
  const trimmed = title?.trim()
  return Option.some({ url: parsed.href, host: parsed.hostname.replace(/^www\./u, ''), title: trimmed === '' ? undefined : trimmed })
}

const unique = (sources: readonly CitationSource[]): readonly CitationSource[] => {
  const seen = new Set<string>()
  return sources.filter(entry => {
    if (seen.has(entry.url)) return false
    seen.add(entry.url)
    return true
  })
}

/** The sources a `web_search` result carries in its replayable meta, in result order, each URL once. */
// oxlint-disable-next-line antislop/no-unknown-parameters -- persisted Session metadata is decoded below.
const fromSearch = (meta: unknown): readonly CitationSource[] =>
  Option.match(Schema.decodeUnknownOption(searchMetaSchema)(meta), {
    onNone: () => [],
    onSome: decoded => unique(decoded.sources.flatMap(entry => Option.toArray(source(entry.url, entry.title)))),
  })

/** The page a `web_fetch` result landed on (after redirects), titled by the article heading in its text. */
const fromFetch = (input: { readonly meta: unknown; readonly text: string | undefined }): readonly CitationSource[] =>
  Option.match(Schema.decodeUnknownOption(fetchMetaSchema)(input.meta), {
    onNone: () => [],
    onSome: decoded => Option.toArray(source(decoded.url, input.text === undefined ? undefined : FIRST_HEADING.exec(input.text)?.[1])),
  })

/** What a settled tool call carries: the tool, the stage, and the result's meta and text. */
export interface WebCallFacts {
  readonly toolName: string
  readonly phase: 'preparing' | 'start' | 'result'
  readonly isError: boolean
  readonly meta: unknown
  readonly text: string | undefined
}

/** The sources a web call should show: none until it settled successfully, then its search hits or its fetched page. */
const citationSourcesOf = (input: WebCallFacts): readonly CitationSource[] => {
  if (input.phase !== 'result' || input.isError) return []
  if (input.toolName === 'web_search') return fromSearch(input.meta)
  if (input.toolName === 'web_fetch') return fromFetch({ meta: input.meta, text: input.text })
  return []
}

export class CitationSources {
  static readonly fromSearch = fromSearch
  static readonly fromFetch = fromFetch
  static readonly citationSourcesOf = citationSourcesOf
}
