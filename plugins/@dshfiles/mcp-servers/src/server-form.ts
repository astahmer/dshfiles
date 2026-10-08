import { z } from 'zod'
import { serverDraftSchema, type ServerDraft, type ServerView } from './api.js'

export const serverTransports = ['streamable-http', 'stdio'] as const

const serverFormValuesSchema = z.object({
  id: z.string(),
  name: z.string(),
  serverName: z.string(),
  enabled: z.boolean(),
  transport: z.enum(serverTransports),
  url: z.string(),
  headerRefs: z.string(),
  oauth: z.boolean(),
  localStart: z.boolean(),
  startCommandLine: z.string(),
  startCwd: z.string(),
  startEnvRefs: z.string(),
  commandLine: z.string(),
  cwd: z.string(),
  envRefs: z.string(),
})

export type ServerFormValues = z.infer<typeof serverFormValuesSchema>
type ServerFormField = keyof ServerFormValues

interface ServerFormIssue {
  readonly field: ServerFormField | undefined
  readonly message: string
}

type ParsedServerForm = { readonly success: true; readonly draft: ServerDraft } | { readonly success: false; readonly issues: readonly ServerFormIssue[] }

const referenceTextSchema = z
  .string()
  .transform((text, context) => {
    try {
      const parsed: unknown = JSON.parse(text)
      return parsed
    } catch {
      context.addIssue({ code: 'custom', message: 'Enter a JSON object of names to credential references.' })
      return z.NEVER
    }
  })
  .pipe(
    z.record(z.string(), z.string({ error: 'Every credential reference must be a string.' }), {
      error: 'Enter a JSON object of names to credential references.',
    }),
  )

const startCommandFields = { commandLine: 'startCommandLine', cwd: 'startCwd', envRefs: 'startEnvRefs' } as const satisfies Record<string, ServerFormField>
const draftFields = new Set<PropertyKey>(['name', 'serverName', 'url', 'headerRefs', 'commandLine', 'cwd', 'envRefs'])

const isServerFormField = (key: PropertyKey | undefined): key is ServerFormField => key !== undefined && draftFields.has(key)

const formFieldForDraftPath = (path: readonly PropertyKey[]): ServerFormField | undefined => {
  const [head, nested] = path
  if (head === 'startCommand') return nested === 'cwd' || nested === 'envRefs' ? startCommandFields[nested] : startCommandFields.commandLine
  return isServerFormField(head) ? head : undefined
}

const referencesForPrefix = (server: ServerView, prefix: string): string =>
  JSON.stringify(
    Object.fromEntries(
      server.credentialReferences.filter(item => item.target.startsWith(prefix)).map(item => [item.target.slice(prefix.length), item.reference]),
    ),
    null,
    2,
  )

export const serverNameFromTitle = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32) || 'mcp-server'

/** A tool namespace derived from the title that no other configured server uses. */
export const uniqueServerName = (title: string, taken: readonly string[]): string => {
  const base = serverNameFromTitle(title)
  if (!taken.includes(base)) return base
  for (let index = 2; ; index += 1) {
    const suffix = `-${index}`
    const candidate = `${base.slice(0, 32 - suffix.length)}${suffix}`
    if (!taken.includes(candidate)) return candidate
  }
}

export const blankServerForm = (
  input: { readonly name?: string; readonly endpoint?: string; readonly oauth?: boolean; readonly headerRefs?: Record<string, string> } = {},
): ServerFormValues => ({
  id: '',
  name: input.name ?? '',
  serverName: serverNameFromTitle(input.name ?? ''),
  enabled: true,
  transport: 'streamable-http',
  url: input.endpoint ?? '',
  headerRefs: input.headerRefs === undefined ? '{}' : JSON.stringify(input.headerRefs, null, 2),
  oauth: input.oauth ?? false,
  localStart: false,
  startCommandLine: '',
  startCwd: '',
  startEnvRefs: '{}',
  commandLine: '',
  cwd: '',
  envRefs: '{}',
})

/** Edit values for a saved server: credential reference names only, never resolved values. */
export const serverFormFromView = (server: ServerView): ServerFormValues => {
  const base = { ...blankServerForm(), id: server.id, name: server.name, serverName: server.serverName, enabled: server.enabled }
  if (server.transport === 'stdio') {
    return { ...base, transport: 'stdio', commandLine: server.commandLine, cwd: server.cwd, envRefs: referencesForPrefix(server, 'environment:') }
  }
  return {
    ...base,
    url: server.url,
    headerRefs: referencesForPrefix(server, 'header:'),
    oauth: server.oauth !== 'not-used',
    localStart: server.startCommand !== undefined,
    startCommandLine: server.startCommand?.commandLine ?? '',
    startCwd: server.startCommand?.cwd ?? '',
    startEnvRefs: referencesForPrefix(server, 'local-environment:'),
  }
}

/** Builds the API draft for the active transport only, so fields of the other transport never block saving. */
export const parseServerForm = (values: ServerFormValues): ParsedServerForm => {
  const issues: ServerFormIssue[] = []
  const parseReferences = (field: ServerFormField): Record<string, string> => {
    const result = referenceTextSchema.safeParse(values[field])
    if (result.success) return result.data
    issues.push(...result.error.issues.map(issue => ({ field, message: issue.message })))
    return {}
  }
  const base = { id: values.id, name: values.name, serverName: values.serverName, enabled: values.enabled }
  const candidate =
    values.transport === 'stdio'
      ? { ...base, transport: values.transport, commandLine: values.commandLine, cwd: values.cwd, envRefs: parseReferences('envRefs') }
      : {
          ...base,
          transport: values.transport,
          url: values.url,
          headerRefs: parseReferences('headerRefs'),
          auth: values.oauth ? ('oauth' as const) : ('none' as const),
          startCommand: values.localStart ? { commandLine: values.startCommandLine, cwd: values.startCwd, envRefs: parseReferences('startEnvRefs') } : null,
        }
  const result = serverDraftSchema.safeParse(candidate)
  if (!result.success) issues.push(...result.error.issues.map(issue => ({ field: formFieldForDraftPath(issue.path), message: issue.message })))
  if (result.success && issues.length === 0) return { success: true, draft: result.data }
  return { success: false, issues }
}

export const serverFormSchema = serverFormValuesSchema.superRefine((values, context) => {
  const parsed = parseServerForm(values)
  if (parsed.success) return
  for (const issue of parsed.issues) context.addIssue({ code: 'custom', message: issue.message, path: issue.field === undefined ? [] : [issue.field] })
})

/** One-click draft for a hosted endpoint from the provider catalog or the public Registry. */
export const catalogServerDraft = (input: { readonly name: string; readonly url: string; readonly oauth: boolean; readonly taken: readonly string[] }): ServerDraft => ({
  id: '',
  name: input.name,
  serverName: uniqueServerName(input.name, input.taken),
  enabled: true,
  transport: 'streamable-http',
  url: input.url,
  headerRefs: {},
  auth: input.oauth ? 'oauth' : 'none',
  startCommand: null,
})
