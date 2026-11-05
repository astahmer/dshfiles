import { writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import { dshxRegistryApi, isApiOwnerMissing } from '@dshfiles/dshx/api'
import { useApi } from '@dshfiles/dshx/client'
import { decodeSnapshot, mcpServersApi } from '@dshfiles/mcp-servers/api'
import { Page } from '@dshfiles/plugin-ui/components/page'
import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { CopyIcon, ExternalLinkIcon, PuzzleIcon, ServerIcon, SparklesIcon } from '@dshfiles/plugin-ui/icons'
import { useQuery } from '@dshfiles/plugin-ui/query'
import { useState, type ReactNode } from 'react'
import { CapabilitiesHub, type HubSection, type HubSectionId, type SkillGroup } from './hub-model.js'

const QUERY_ROOT = ['capabilities-hub'] as const

export interface PluginCount {
  readonly total: number
  readonly enabled: number
}

export interface CapabilitiesHubPanelProps {
  /** Whether a manager page is registered in this composition; an absent owner keeps its card but names the fix. */
  readonly hasPanel: (panelId: string) => boolean
  readonly openPanel: (panelId: string) => void
  readonly countPlugins: () => Promise<PluginCount>
}

const ICONS = { skills: SparklesIcon, mcp: ServerIcon, plugins: PuzzleIcon } as const satisfies Record<HubSectionId, typeof SparklesIcon>
const TRUST_VARIANT = { 'agent-instructions': 'info', 'tools-and-credentials': 'warning', 'executable-code': 'destructive' } as const
const GROUP_LABEL = { project: 'project', user: 'your home', plugin: 'plugins', other: 'other' } as const satisfies Record<SkillGroup, string>

const Status = (props: { readonly loading: boolean; readonly error: unknown; readonly ownerName: string; readonly children: ReactNode }): ReactNode => {
  if (props.loading) return <span className="dshx:text-xs dshx:text-muted-foreground">Counting…</span>
  if (props.error !== null && props.error !== undefined)
    return (
      <span className="dshx:text-xs dshx:text-muted-foreground">
        {props.error instanceof Error && isApiOwnerMissing(props.error)
          ? `Counts need ${props.ownerName}; add it to the profile to see them here.`
          : 'Could not read the count; open the manager to see it.'}
      </span>
    )
  return <span className="dshx:text-xs dshx:text-muted-foreground">{props.children}</span>
}

const SectionCard = (props: {
  readonly section: HubSection
  readonly status: ReactNode
  readonly available: boolean
  readonly onOpen: () => void
  readonly children?: ReactNode
}): ReactNode => {
  const { section } = props
  const Icon = ICONS[section.id]
  return (
    <section
      aria-labelledby={`capabilities-hub-${section.id}`}
      className="dshx:flex dshx:flex-col dshx:gap-3 dshx:rounded-lg dshx:border dshx:border-border dshx:p-4"
      data-hub-section={section.id}
    >
      <div className="dshx:flex dshx:flex-wrap dshx:items-start dshx:justify-between dshx:gap-3">
        <div className="dshx:flex dshx:min-w-0 dshx:items-start dshx:gap-3">
          <Icon aria-hidden className="dshx:mt-0.5 dshx:size-5 dshx:shrink-0 dshx:text-muted-foreground" />
          <div className="dshx:min-w-0">
            <h2 className="dshx:text-base dshx:font-semibold" id={`capabilities-hub-${section.id}`}>
              {section.label}
            </h2>
            <p className="dshx:text-sm dshx:text-muted-foreground">{section.summary}</p>
            {props.status}
          </div>
        </div>
        <Button className="dshx:shrink" disabled={!props.available} onClick={props.onOpen} size="sm" variant="outline">
          Open {section.manager.label}
        </Button>
      </div>
      <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2 dshx:text-xs" data-trust={section.trust}>
        <Badge variant={TRUST_VARIANT[section.trust]}>{section.trustLabel}</Badge>
        <span className="dshx:min-w-0 dshx:text-muted-foreground">{section.trustDetail}</span>
      </div>
      {props.available ? null : (
        <p className="dshx:text-xs dshx:text-warning">
          {section.manager.label} is not loaded in this profile. Add {section.manager.owner} to the profile and restart DSH to manage{' '}
          {section.label.toLowerCase()} here.
        </p>
      )}
      {props.children}
    </section>
  )
}

const SkillsShBlock = (): ReactNode => {
  const guidance = CapabilitiesHub.skillsSh
  const [copied, setCopied] = useState(false)
  return (
    <div className="dshx:flex dshx:flex-col dshx:gap-2 dshx:rounded-md dshx:bg-muted dshx:p-3" data-skills-sh>
      <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:justify-between dshx:gap-2">
        <span className="dshx:text-sm dshx:font-medium">Find more on skills.sh</span>
        <Button asChild size="sm" variant="ghost">
          <a href={guidance.url} rel="noopener noreferrer" target="_blank">
            <ExternalLinkIcon /> Open skills.sh
          </a>
        </Button>
      </div>
      <p className="dshx:text-xs dshx:text-muted-foreground">{guidance.inAppSearchReason}</p>
      <div className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-2">
        <code className="dshx:min-w-0 dshx:flex-1 dshx:overflow-x-auto dshx:rounded dshx:bg-background dshx:px-2 dshx:py-1 dshx:font-mono dshx:text-xs dshx:whitespace-nowrap">
          {guidance.command}
        </code>
        <Button
          aria-label="Copy install command"
          onClick={() => {
            void writeClipboard(guidance.command).then(() => setCopied(true))
          }}
          size="sm"
          variant="outline"
        >
          <CopyIcon /> {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <p className="dshx:text-xs dshx:text-muted-foreground">
        Telemetry is off in this command (DISABLE_TELEMETRY=1) and the CLI version is pinned to {guidance.cliVersion}. DSH never runs it for you.
      </p>
    </div>
  )
}

export const CapabilitiesHubPanel = (props: CapabilitiesHubPanelProps): ReactNode => {
  const registry = useApi(dshxRegistryApi)
  const mcp = useApi(mcpServersApi)
  const skills = useQuery({
    queryKey: [...QUERY_ROOT, 'skills'],
    queryFn: async ({ signal }) => (await registry.list({}, { signal })).skills,
    retry: false,
  })
  const servers = useQuery({
    queryKey: [...QUERY_ROOT, 'mcp'],
    queryFn: async ({ signal }) => decodeSnapshot(await mcp.list(undefined, { signal })).servers,
    retry: false,
  })
  const plugins = useQuery({ queryKey: [...QUERY_ROOT, 'plugins'], queryFn: props.countPlugins, retry: false })

  const skillCounts = CapabilitiesHub.skillCounts(skills.data ?? [])
  const skillTotal = skills.data?.length ?? 0
  const enabledServers = (servers.data ?? []).filter(server => server.enabled).length
  const open = (section: HubSection) => () => props.openPanel(section.manager.panelId)

  return (
    <main aria-label="Capabilities hub" className="dshx-root dshx:h-full">
      <Page
        scroll
        description="Skills, MCP servers and DSH plugins each have their own manager and their own risk. Open one to add, change or remove what it owns."
        heading="Capabilities hub"
      >
        <div className="dshx:flex dshx:max-w-3xl dshx:flex-col dshx:gap-4">
          {CapabilitiesHub.sections.map(section => {
            const available = props.hasPanel(section.manager.panelId)
            if (section.id === 'skills')
              return (
                <SectionCard
                  available={available}
                  key={section.id}
                  onOpen={open(section)}
                  section={section}
                  status={
                    <Status error={skills.error} loading={skills.isPending} ownerName="a dshx Host plugin">
                      {skillTotal === 0
                        ? 'No skills found for the current folder.'
                        : `${String(skillTotal)} installed: ${skillCounts.map(count => `${String(count.count)} ${GROUP_LABEL[count.group]}`).join(', ')}`}
                    </Status>
                  }
                >
                  <SkillsShBlock />
                </SectionCard>
              )
            if (section.id === 'mcp')
              return (
                <SectionCard
                  available={available}
                  key={section.id}
                  onOpen={open(section)}
                  section={section}
                  status={
                    <Status error={servers.error} loading={servers.isPending} ownerName="@dshfiles/mcp-servers">
                      {`${String(servers.data?.length ?? 0)} configured, ${String(enabledServers)} enabled`}
                    </Status>
                  }
                />
              )
            return (
              <SectionCard
                available={available}
                key={section.id}
                onOpen={open(section)}
                section={section}
                status={
                  <Status error={plugins.error} loading={plugins.isPending} ownerName="the plugin inventory">
                    {`${String(plugins.data?.total ?? 0)} loaded, ${String(plugins.data?.enabled ?? 0)} enabled`}
                  </Status>
                }
              />
            )
          })}
        </div>
      </Page>
    </main>
  )
}
