import type { Context } from '@deepseek-ai/cordis'
import type { PresetDefinition } from '@deepseek-ai/dsh-agent-preset-registry'
import type { LlmAdapter, LlmConfigurableProvider, LlmDiscoveredModel, LlmModelDiscoveryRequest } from '@deepseek-ai/dsh-llm'
import type { SkillRegistration } from '@deepseek-ai/dsh-skill'

/** A model provider: the adapter that serves `providers`, and the entries Settings › Models lists to configure them. */
export interface ProviderContribution {
  readonly providers: readonly string[]
  readonly adapter: LlmAdapter
  readonly configurable?: readonly LlmConfigurableProvider[]
}

/** The models a provider's settings namespace offers, listed on demand (Settings › Models "Refresh"). */
export interface ModelDiscoveryContribution {
  readonly settingsNs: string
  readonly discover: (request: LlmModelDiscoveryRequest, signal?: AbortSignal) => Promise<readonly LlmDiscoveredModel[]>
}

/** A profile `@deepseek-ai/dsh-mcp-client` row's config: optional fields take the row's defaults. */
type McpServerConfig = Parameters<(typeof import('@deepseek-ai/dsh-mcp-client'))['Config']>[0]

/** What `defineHost` registers into DSH's own registries besides tools, commands and prompts. */
export interface HostRegistrations {
  readonly agentPresets?: readonly PresetDefinition[]
  readonly providers?: readonly ProviderContribution[]
  readonly models?: readonly ModelDiscoveryContribution[]
  readonly skills?: readonly SkillRegistration[]
  /** One MCP client per server, as a profile `@deepseek-ai/dsh-mcp-client` row would start it. */
  readonly mcpServers?: readonly McpServerConfig[]
}

/** The Cordis services a definition's registrations need, for its `inject`. */
const servicesFor = (definition: HostRegistrations): string[] => [
  ...((definition.agentPresets?.length ?? 0) > 0 ? ['agentPresets'] : []),
  ...((definition.providers?.length ?? 0) > 0 || (definition.models?.length ?? 0) > 0 ? ['llm'] : []),
  ...((definition.skills?.length ?? 0) > 0 ? ['skills'] : []),
]

/** Register every contribution with the plugin's lifetime; DSH's registries own validation and duplicate refusal. */
const install = (ctx: Context, packageId: string, definition: HostRegistrations): void => {
  for (const provider of definition.providers ?? []) {
    ctx.effect(() => ctx.llm.registerAdapter([...provider.providers], provider.adapter), `${packageId}: provider ${provider.providers.join(', ')}`)
    const configurable = provider.configurable ?? []
    if (configurable.length > 0) ctx.effect(() => ctx.llm.registerConfigurableProviders(configurable), `${packageId}: configurable providers`)
  }
  for (const models of definition.models ?? [])
    ctx.effect(() => ctx.llm.registerModelDiscovery(models.settingsNs, models.discover), `${packageId}: models of ${models.settingsNs}`)
  for (const skill of definition.skills ?? []) ctx.effect(() => ctx.skills.register(skill), `${packageId}: skill ${skill.name}`)
  for (const preset of definition.agentPresets ?? []) {
    ctx.effect(() => {
      const registered = ctx.agentPresets.register(preset)
      return async () => {
        await (
          await registered
        )()
      }
    }, `${packageId}: agent preset ${preset.id}`)
  }
  const servers = definition.mcpServers ?? []
  if (servers.length > 0) {
    // Loaded only by a Host that starts MCP servers, from the Host installation.
    void import('@deepseek-ai/dsh-mcp-client').then(
      client => {
        for (const server of servers) ctx.plugin(client, server)
      },
      (cause: unknown) =>
        ctx.logger('dshx:registrations').warn(`${packageId}: MCP servers were not started: ${cause instanceof Error ? cause.message : String(cause)}`),
    )
  }
}

export class HostRegistrationsModel {
  static readonly servicesFor = servicesFor
  static readonly install = install
}
