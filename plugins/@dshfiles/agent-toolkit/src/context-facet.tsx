/**
 * The thread panel's **Context** facet (plan `docs/ade-ux` §4.4): what is loaded into this thread's model context and
 * roughly what it costs. Read-only; every number comes from the owner's existing Host API (DSH's instruction loader
 * through agent-toolkit, skills and tools from the dshx registry, MCP servers, memory's start block, references, the
 * thread's agent). An owner that is not loaded leaves its section out instead of failing the facet.
 */
import { agentsApi } from '@dshfiles/agents/contract'
import { dshxRegistryApi, isApiOwnerMissing, type RegistryListInput } from '@dshfiles/dshx/api'
import { useApi } from '@dshfiles/dshx/client'
import { decodeSnapshot, mcpServersApi } from '@dshfiles/mcp-servers/api'
import { memoryApi } from '@dshfiles/memory/api'
import { EmptyState, PageSection } from '@dshfiles/plugin-ui/components/page'
import { EntityList, EntityRow } from '@dshfiles/plugin-ui/components/entity-row'
import { errorMessage, useQuery, type UseQueryResult } from '@dshfiles/plugin-ui/query'
import { referencesApi } from '@dshfiles/references/api'
import type { ReactNode } from 'react'

import { agentToolkitApi } from './api.js'
import { ContextModel, type ContextSection, type ContextSectionId } from './context-model.js'
import { AgentToolkit } from './toolkit-model.js'

const QUERY_ROOT = ['dshfiles-agent-toolkit', 'context'] as const

/** A context section's heading, its one-line explanation and what it says when empty. */
interface SectionHeading {
  readonly title: string
  readonly description: string
  readonly empty: string
}

const headings = {
  instructions: {
    title: 'Instructions',
    description: 'AGENTS.md-compatible files DSH loads for this folder, user-global first. Default discovery settings.',
    empty: 'No instruction file applies to this folder.',
  },
  agent: { title: 'Agent', description: 'Instructions and routine of the agent that started this thread.', empty: 'No configured agent started this thread.' },
  memory: { title: 'Memory', description: 'The start block a new thread in this folder gets.', empty: 'Memory has no start block for this project.' },
  skills: {
    title: 'Skills',
    description: 'Each skill costs its catalog line; its instructions load only when it is used.',
    empty: 'No skills are available here.',
  },
  mcp: { title: 'MCP servers', description: "Enabled servers, costed by their tools' names and descriptions.", empty: 'No MCP server is enabled.' },
  references: {
    title: 'References',
    description: 'Attached references add one context line each; their files are read on demand.',
    empty: 'No reference is attached to this thread.',
  },
} satisfies Record<ContextSectionId, SectionHeading>

const tokensLabel = (section: { readonly tokens: number; readonly unknown: number }): string =>
  `≈ ${ContextModel.formatTokens(section.tokens)} tokens${section.unknown > 0 ? ' +' : ''}`

/** Absent owner: hide the section. Any other failure: say so with what to do next. */
const failureOf = (query: UseQueryResult<unknown>): string | null | 'hidden' => {
  if (!query.isError) return null
  if (isApiOwnerMissing(query.error)) return 'hidden'
  return errorMessage(query.error, 'This source did not answer. Reopen the Context tab to try again.')
}

const Section = (props: {
  readonly section: ContextSection | undefined
  readonly query: UseQueryResult<unknown>
  readonly id: ContextSectionId
}): ReactNode => {
  const heading = headings[props.id]
  const failure = failureOf(props.query)
  if (failure === 'hidden') return null
  return (
    <PageSection
      heading={heading.title}
      description={heading.description}
      meta={props.section === undefined ? undefined : tokensLabel(props.section)}
      data-context-section={props.id}
    >
      {props.query.isPending ? <p className="dshx:text-xs dshx:text-muted-foreground">Loading…</p> : null}
      {failure === null ? null : (
        <p role="alert" className="dshx:text-xs dshx:text-destructive">
          {failure}
        </p>
      )}
      {props.section === undefined ? null : props.section.rows.length === 0 ? (
        <p className="dshx:text-xs dshx:text-muted-foreground">{heading.empty}</p>
      ) : (
        <EntityList>
          {props.section.rows.map(row => (
            <EntityRow
              key={row.id}
              heading={<span className="dshx:font-mono dshx:text-xs">{row.name}</span>}
              description={row.detail}
              trailing={
                <span className="dshx:text-xs dshx:text-muted-foreground dshx:tabular-nums">
                  {row.tokens === null ? 'size unknown' : `≈ ${ContextModel.formatTokens(row.tokens)}`}
                </span>
              }
            />
          ))}
        </EntityList>
      )}
    </PageSection>
  )
}

/** The registry listing for this Session and workspace, naming only the parts that are known. */
const registryListInput = (sessionId: string | undefined, cwd: string | undefined): RegistryListInput => {
  if (sessionId !== undefined && cwd !== undefined) return { sessionId, cwd }
  if (sessionId !== undefined) return { sessionId }
  if (cwd !== undefined) return { cwd }
  return {}
}

export const ContextFacet = (props: { readonly sessionId: string | undefined; readonly cwd: string | undefined }): ReactNode => {
  const toolkit = useApi(agentToolkitApi)
  const registry = useApi(dshxRegistryApi)
  const mcp = useApi(mcpServersApi)
  const memory = useApi(memoryApi)
  const references = useApi(referencesApi)
  const agents = useApi(agentsApi)
  const { sessionId, cwd } = props
  const ready = sessionId !== undefined

  const instructions = useQuery({
    queryKey: [...QUERY_ROOT, 'instructions', cwd ?? null],
    queryFn: async ({ signal }) => ContextModel.instructions((await toolkit.instructionFiles({ cwd: cwd ?? '' }, { signal })).files),
    enabled: cwd !== undefined,
    retry: false,
  })
  const listing = useQuery({
    queryKey: [...QUERY_ROOT, 'registry', sessionId ?? null, cwd ?? null],
    queryFn: async ({ signal }) => AgentToolkit.decodeListing(await registry.list(registryListInput(sessionId, cwd), { signal })),
    enabled: ready,
    retry: false,
  })
  const servers = useQuery({
    queryKey: [...QUERY_ROOT, 'mcp'],
    queryFn: async ({ signal }) => decodeSnapshot(await mcp.list(undefined, { signal })),
    retry: false,
  })
  const startBlock = useQuery({
    queryKey: [...QUERY_ROOT, 'memory', cwd ?? null],
    queryFn: async ({ signal }) => ContextModel.memory(await memory.startBlock({ cwd: cwd ?? '' }, { signal })),
    enabled: cwd !== undefined,
    retry: false,
  })
  const attached = useQuery({
    queryKey: [...QUERY_ROOT, 'references', sessionId ?? null],
    queryFn: async ({ signal }) => {
      const result = await references.list({ sessionId: sessionId ?? '' }, { signal })
      return ContextModel.references(result.references.filter(reference => result.attached.includes(reference.name)))
    },
    enabled: ready,
    retry: false,
  })
  const agent = useQuery({
    queryKey: [...QUERY_ROOT, 'agent', sessionId ?? null],
    queryFn: async ({ signal }) => ContextModel.agent((await agents.threadAgent({ sessionId: sessionId ?? '' }, { signal })).agent),
    enabled: ready,
    retry: false,
  })

  if (!ready) {
    return (
      <div className="dshx-root dshx:p-4">
        <EmptyState>Open a thread to see what is loaded into its context.</EmptyState>
      </div>
    )
  }

  const skills = listing.data === undefined ? undefined : ContextModel.skills(listing.data.skills)
  const mcpSection =
    listing.data === undefined || servers.data === undefined
      ? undefined
      : ContextModel.mcp(
          AgentToolkit.mcpServers({ servers: servers.data.servers.filter(server => server.enabled), tools: listing.data.tools }).map(row => ({
            name: row.name,
            serverName: row.serverName,
            tools: row.tools.map(tool => ({ name: tool.name, description: tool.description })),
          })),
        )
  const sections = [instructions.data, agent.data, startBlock.data, skills, mcpSection, attached.data].filter(
    (section): section is ContextSection => section !== undefined,
  )
  const total = ContextModel.total(sections)

  return (
    <div className="dshx-root dshx:@container dshx:flex dshx:min-h-0 dshx:flex-col dshx:gap-5 dshx:overflow-auto dshx:p-4" data-context-facet>
      <header className="dshx:flex dshx:flex-col dshx:gap-1">
        <p className="dshx:text-sm dshx:font-semibold">
          {tokensLabel(total)} <span className="dshx:font-normal dshx:text-muted-foreground">loaded before your message</span>
        </p>
        <p className="dshx:text-xs dshx:text-muted-foreground">
          Estimates at {ContextModel.charsPerToken} characters per token; tool schemas and DSH&apos;s own system prompt are not counted. The Cost tab and Usage
          show billed tokens.
        </p>
      </header>
      <Section id="instructions" section={instructions.data} query={instructions} />
      <Section id="agent" section={agent.data} query={agent} />
      <Section id="memory" section={startBlock.data} query={startBlock} />
      <Section id="skills" section={skills} query={listing} />
      <Section id="mcp" section={mcpSection} query={servers.isError ? servers : listing} />
      <Section id="references" section={attached.data} query={attached} />
    </div>
  )
}
