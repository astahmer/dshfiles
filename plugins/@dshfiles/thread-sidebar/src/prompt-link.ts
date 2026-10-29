import { z } from 'zod'

/**
 * Prompt links: `?prompt=<text>[&project=<id or path>][&model=<provider>/<model>]` opens a new thread whose composer
 * holds the text. Nothing is sent; the person reads and sends it.
 */

const PROMPT_LINK_PARAMS = ['prompt', 'project', 'model'] as const

const MAX_PROMPT_CHARS = 100_000

const modelSchema = z
  .string()
  .regex(/^[^/\s]+\/\S.*$/u)
  .transform(value => {
    const slash = value.indexOf('/')
    return { provider: value.slice(0, slash), model: value.slice(slash + 1) }
  })

const promptLinkSchema = z.object({
  prompt: z
    .string()
    .max(MAX_PROMPT_CHARS)
    .refine(text => text.trim().length > 0),
  project: z.string().trim().min(1).max(4096).optional().catch(undefined),
  model: modelSchema.optional().catch(undefined),
})

export type PromptLink = z.infer<typeof promptLinkSchema>

const optionalParam = (url: URL, name: string): string | undefined => url.searchParams.get(name) ?? undefined

/** The prompt link in a URL, or undefined when it has none; an unreadable project or model is dropped, not fatal. */
const read = (currentUrl: string): PromptLink | undefined => {
  const url = new URL(currentUrl)
  const parsed = promptLinkSchema.safeParse({
    prompt: optionalParam(url, 'prompt'),
    project: optionalParam(url, 'project'),
    model: optionalParam(url, 'model'),
  })
  return parsed.success ? parsed.data : undefined
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
