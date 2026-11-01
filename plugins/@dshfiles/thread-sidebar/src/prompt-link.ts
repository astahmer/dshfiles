import * as Schema from 'effect/Schema'
import * as SchemaGetter from 'effect/SchemaGetter'
import * as Option from 'effect/Option'

/**
 * Prompt links: `?prompt=<text>[&project=<id or path>][&model=<provider>/<model>]` opens a new thread whose composer
 * holds the text. Nothing is sent; the person reads and sends it.
 */

const PROMPT_LINK_PARAMS = ['prompt', 'project', 'model'] as const

const MAX_PROMPT_CHARS = 100_000

const modelSchema = Schema.String.check(Schema.isPattern(/^[^/\s]+\/\S.*$/u)).pipe(
  Schema.decodeTo(Schema.Struct({ provider: Schema.String, model: Schema.String }), {
    decode: SchemaGetter.transform(value => {
      const slash = value.indexOf('/')
      return { provider: value.slice(0, slash), model: value.slice(slash + 1) }
    }),
    encode: SchemaGetter.transform(value => `${value.provider}/${value.model}`),
  }),
)

const projectSchema = Schema.Trim.check(Schema.isMinLength(1)).check(Schema.isMaxLength(4096))
const promptSchema = Schema.String.check(
  Schema.isMaxLength(MAX_PROMPT_CHARS),
  Schema.makeFilter(text => text.trim().length > 0),
)

const promptLinkSchema = Schema.Struct({
  prompt: promptSchema,
  project: Schema.optional(projectSchema),
  model: Schema.optional(modelSchema),
})

export type PromptLink = typeof promptLinkSchema.Type

const optionalParam = (url: URL, name: string): string | undefined => url.searchParams.get(name) ?? undefined

/** The prompt link in a URL, or undefined when it has none; an unreadable project or model is dropped, not fatal. */
const read = (currentUrl: string): PromptLink | undefined => {
  const url = new URL(currentUrl)
  const parsed = Schema.decodeUnknownOption(promptSchema)(optionalParam(url, 'prompt'))
  if (Option.isNone(parsed)) return undefined
  const project = Schema.decodeUnknownOption(projectSchema)(optionalParam(url, 'project'))
  const model = Schema.decodeUnknownOption(modelSchema)(optionalParam(url, 'model'))
  return {
    prompt: parsed.value,
    project: Option.isSome(project) ? project.value : undefined,
    model: Option.isSome(model) ? model.value : undefined,
  }
}

/** The same URL without the prompt-link params, so a reload or a copied address never reopens the draft. */
const strip = (currentUrl: string): string => {
  const url = new URL(currentUrl)
  for (const name of PROMPT_LINK_PARAMS) url.searchParams.delete(name)
  return url.toString()
}

const trimTrailingSlashes = (path: string): string => path.replace(/\/+$/u, '') || '/'

interface ProjectRow {
  readonly workspaceId: string
  readonly path: string
}

/** A project named by its id or its folder path. */
const projectFor = <Project extends ProjectRow>(input: { readonly projects: readonly Project[]; readonly reference: string }): Project | undefined => {
  const byId = input.projects.find(project => project.workspaceId === input.reference)
  if (byId !== undefined) return byId
  const path = trimTrailingSlashes(input.reference)
  return input.projects.find(project => trimTrailingSlashes(project.path) === path)
}

export class PromptLinkModel {
  static readonly read = read
  static readonly strip = strip
  static readonly projectFor = projectFor
}
