import { Schema } from 'effect'
import { unsupportedDomain, type Registration, type UnsupportedRecord } from './unsupported.js'

type PluginOptions = Readonly<{ [key: string]: typeof Schema.Json.Type }>
type DomainValue = object

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
export type Domains = Partial<Record<DomainName, (input: DomainInput) => DomainValue>>

export const createContext = (input: DomainInput & { readonly options: PluginOptions; readonly domains: Domains; readonly version?: string }) => {
  const domain = (name: DomainName): DomainValue => input.domains[name]?.(input) ?? unsupportedDomain({ ...input, domain: name })
  return {
    agent: domain('agent'),
    aisdk: domain('aisdk'),
    command: domain('command'),
    credential: domain('credential'),
    event: domain('event'),
    experimental: domain('experimental'),
    integration: domain('integration'),
    mcp: domain('mcp'),
    model: domain('model'),
    generate: domain('generate'),
    permission: domain('permission'),
    plugin: domain('plugin'),
    provider: domain('provider'),
    reference: domain('reference'),
    rpc: domain('rpc'),
    session: domain('session'),
    shell: domain('shell'),
    skill: domain('skill'),
    storage: domain('storage'),
    tool: domain('tool'),
    vcs: domain('vcs'),
    websearch: domain('websearch'),
    worktree: domain('worktree'),
    location: domain('location'),
    options: Object.freeze(input.options),
    app: Object.freeze({ name: 'dsh', version: input.version ?? 'unknown', channel: 'opencode-compat' }),
  }
}

// OpenCode MIT: packages/plugin/src/promise/plugin.ts, commit 67139d6827af.
export type PluginContext = ReturnType<typeof createContext>
