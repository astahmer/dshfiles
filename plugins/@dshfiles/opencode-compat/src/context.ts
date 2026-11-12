import { unsupportedDomain, type Registration, type UnsupportedRecord } from './unsupported.js'

// OpenCode MIT: packages/plugin/src/promise/plugin.ts, commit 67139d6827af.
export interface PluginContext {
  readonly app: { readonly name: string; readonly version: string; readonly channel: string }
  readonly options: Readonly<Record<string, unknown>>
  readonly [domain: string]: unknown
}

export interface DomainInput {
  readonly pluginId: string
  readonly onUnsupported: 'report' | 'fail'
  readonly records: UnsupportedRecord[]
  readonly register: (registration: Registration) => Registration
  readonly contributions: { readonly tools: string[]; readonly skills: string[]; readonly hooks: string[] }
}

const domains = [
  'agent',
  'aisdk',
  'command',
  'credential',
  'event',
  'experimental',
  'integration',
  'mcp',
  'model',
  'generate',
  'permission',
  'plugin',
  'provider',
  'reference',
  'rpc',
  'session',
  'shell',
  'skill',
  'storage',
  'tool',
  'vcs',
  'websearch',
  'worktree',
  'location',
] as const

export type DomainName = (typeof domains)[number]
export type Domains = Partial<Record<DomainName, (input: DomainInput) => unknown>>

export const createContext = (
  input: DomainInput & { readonly options: Record<string, unknown>; readonly domains: Domains; readonly version?: string },
): PluginContext => {
  const members = Object.fromEntries(domains.map(domain => [domain, input.domains[domain]?.(input) ?? unsupportedDomain({ ...input, domain })]))
  return {
    ...members,
    options: Object.freeze(input.options),
    app: Object.freeze({ name: 'dsh', version: input.version ?? 'unknown', channel: 'opencode-compat' }),
  }
}
