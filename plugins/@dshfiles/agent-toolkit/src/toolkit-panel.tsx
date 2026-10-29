import { dshxRegistryApi, isApiOwnerMissing } from '@dshfiles/dshx/api'
import { useApi } from '@dshfiles/dshx/client'
import { mcpServersApi, decodeSnapshot } from '@dshfiles/mcp-servers/api'
import { memoryApi } from '@dshfiles/memory/api'
import { Alert, AlertDescription } from '@dshfiles/plugin-ui/components/ui/alert'
import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { SearchInput } from '@dshfiles/plugin-ui/components/ui/search-input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@dshfiles/plugin-ui/components/ui/select'
import { Skeleton } from '@dshfiles/plugin-ui/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@dshfiles/plugin-ui/components/ui/table'
import { ToggleGroup, ToggleGroupItem } from '@dshfiles/plugin-ui/components/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { RefreshCwIcon, SettingsIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { useState, type ReactNode } from 'react'
import { agentToolkitApi } from './api.js'
import type { AgentToolkitKey } from './locales.js'
import { AgentToolkit, type SkillInvocation, type SkillOrigin, type ToolkitFilter, type ToolkitSource } from './toolkit-model.js'

type Translate = (key: AgentToolkitKey, params?: Record<string, string | number>) => string

export interface ToolkitThread {
  readonly id: string
  readonly title: string
  readonly cwd: string | undefined
}

export interface PluginInventoryEntry {
  readonly entryId: string
  readonly moduleName: string
  readonly title?: string | undefined
  readonly enabled: boolean
  readonly fiberPhase: string | null
}

const FILTER_LABEL = {
  all: 'filterAll',
  native: 'filterNative',
  plugin: 'filterPlugin',
  mcp: 'filterMcp',
  memory: 'filterMemory',
  skills: 'filterSkills',
} as const satisfies Record<ToolkitFilter, AgentToolkitKey>
const SOURCE_LABEL = { native: 'sourceNative', plugin: 'sourcePlugin', mcp: 'sourceMcp', memory: 'sourceMemory' } as const satisfies Record<
  ToolkitSource,
  AgentToolkitKey
>
const SOURCE_VARIANT = { native: 'muted', plugin: 'info', mcp: 'warning', memory: 'success' } as const satisfies Record<ToolkitSource, string>
const SKILL_ORIGIN_LABEL = {
  'project-dsh': 'skillProjectDsh',
  'project-agents': 'skillProjectAgents',
  'user-dsh': 'skillUserDsh',
  'user-agents': 'skillUserAgents',
  runtime: 'skillRuntime',
  custom: 'skillCustom',
  bundled: 'skillBundled',
  other: 'skillOther',
} as const satisfies Record<SkillOrigin, AgentToolkitKey>
const INVOCATION_LABEL = { both: 'invokeBoth', user: 'invokeUser', model: 'invokeModel', none: 'invokeNone' } as const satisfies Record<
  SkillInvocation,
  AgentToolkitKey
>
const QUERY_ROOT = ['agent-toolkit'] as const

const Section = (props: { readonly id: string; readonly title: string; readonly children: ReactNode }): ReactNode => (
  <section aria-labelledby={props.id} className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-2">
    <h2 id={props.id} className="dshx:text-sm dshx:font-semibold">
      {props.title}
    </h2>
    {props.children}
  </section>
)

const Muted = (props: { readonly children: ReactNode }): ReactNode => <p className="dshx:text-sm dshx:text-muted-foreground">{props.children}</p>

const Loading = (props: { readonly label: string }): ReactNode => (
  <div className="dshx:flex dshx:flex-col dshx:gap-2" aria-label={props.label}>
    <Skeleton className="dshx:h-6 dshx:w-full" />
    <Skeleton className="dshx:h-6 dshx:w-full" />
  </div>
)

export const AgentToolkitPanel = (props: {
  readonly threads: readonly ToolkitThread[]
  readonly threadId: string | null
  readonly selectThread: (threadId: string) => void
  readonly listPlugins: () => Promise<readonly PluginInventoryEntry[]>
  readonly openSettings: (entryId: string) => void
  readonly openMemoryPanel: () => void
  readonly t: Translate
}): ReactNode => {
  const { t } = props
  const registry = useApi(dshxRegistryApi)
  const toolkit = useApi(agentToolkitApi)
  const mcp = useApi(mcpServersApi)
  const memory = useApi(memoryApi)
  const queryClient = useQueryClient()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<ToolkitFilter>('all')
  const thread = props.threads.find(candidate => candidate.id === props.threadId) ?? props.threads[0]
  const cwd = thread?.cwd

  const listing = useQuery({
    queryKey: [...QUERY_ROOT, 'registry', thread?.id ?? null],
    queryFn: async ({ signal }) => {
      const input = {}
      if (thread !== undefined) Object.assign(input, { sessionId: thread.id })
      if (cwd !== undefined) Object.assign(input, { cwd })
      return AgentToolkit.listingSchema.parse(await registry.list(input, { signal }))
    },
    retry: false,
  })
  const inventory = useQuery({ queryKey: [...QUERY_ROOT, 'plugins'], queryFn: props.listPlugins, retry: false })
  const packages = AgentToolkit.pluginPackages(inventory.data ?? [])
  const versions = useQuery({
    queryKey: [...QUERY_ROOT, 'versions', packages],
    queryFn: ({ signal }) => toolkit.versions({ packages: [...packages] }, { signal }),
    enabled: packages.length > 0,
    retry: false,
  })
  const servers = useQuery({
    queryKey: [...QUERY_ROOT, 'mcp'],
    queryFn: async ({ signal }) => decodeSnapshot(await mcp.list(undefined, { signal })),
    retry: false,
  })
  const startBlock = useQuery({
    queryKey: [...QUERY_ROOT, 'memory', 'block', cwd ?? null],
    queryFn: ({ signal }) => memory.startBlock({ cwd: cwd ?? '' }, { signal }),
    enabled: cwd !== undefined,
    retry: false,
  })
  const project = startBlock.data?.project
  const notes = useQuery({
    queryKey: [...QUERY_ROOT, 'memory', 'notes', project ?? null],
    queryFn: ({ signal }) => memory.notes({ project: project ?? '', scope: '', type: '', query: '', thread: '', includeInvalid: false }, { signal }),
    enabled: project !== undefined,
    retry: false,
  })

  const tools = AgentToolkit.tools({ tools: listing.data?.tools ?? [], filter, query })
  const plugins = AgentToolkit.pluginsFor(AgentToolkit.plugins({ entries: inventory.data ?? [], versions: versions.data ?? {} }), filter, query)
  const mcpRows = AgentToolkit.mcpServers({ servers: servers.data?.servers ?? [], tools: listing.data?.tools ?? [] }).filter(row =>
    AgentToolkit.matches(query, row.name, row.serverName, ...row.tools.map(tool => tool.name)),
  )
  const methods = listing.data === undefined ? [] : AgentToolkit.apiMethods({ listing: listing.data, filter, query })
  const skills = (listing.data?.skills ?? []).filter(skill => AgentToolkit.matches(query, skill.name, skill.description, skill.provider))
  const noMatch = <Muted>{t('noMatch')}</Muted>

  return (
    <TooltipProvider>
      <main className="dshx-root dshx:@container dshx:flex dshx:h-full dshx:min-h-0 dshx:flex-col dshx:overflow-y-auto" data-testid="agent-toolkit">
        <div className="dshx:flex dshx:flex-col dshx:gap-3 dshx:border-b dshx:border-border dshx:px-6 dshx:py-4 dshx:@max-pane-narrow:px-3">
          <div className="dshx:flex dshx:items-start dshx:justify-between dshx:gap-3">
            <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-1">
              <h1 className="dshx:text-base dshx:font-semibold">{t('title')}</h1>
              <p className="dshx:text-sm dshx:text-muted-foreground dshx:@max-pane-narrow:sr-only">{t('subtitle')}</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="dshx:shrink"
              aria-label={t('refresh')}
              onClick={() => void queryClient.invalidateQueries({ queryKey: QUERY_ROOT })}
              disabled={listing.isFetching}
            >
              <RefreshCwIcon className={cn(listing.isFetching && 'dshx:animate-spin')} />
              <span className="dshx:@max-pane-compact:sr-only">{t('refresh')}</span>
            </Button>
          </div>
          <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2">
            {thread === undefined ? (
              <Muted>{t('noThread')}</Muted>
            ) : (
              <Select value={thread.id} onValueChange={props.selectThread}>
                <SelectTrigger aria-label={t('thread')} className="dshx:w-72 dshx:max-w-full dshx:@max-pane-narrow:w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {props.threads.map(candidate => (
                    <SelectItem key={candidate.id} value={candidate.id}>
                      {candidate.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <SearchInput
              className="dshx:h-8 dshx:min-w-48 dshx:flex-1"
              aria-label={t('searchLabel')}
              autoComplete="off"
              placeholder={t('searchPlaceholder')}
              type="search"
              value={query}
              onChange={event => setQuery(event.currentTarget.value)}
            />
          </div>
          <ToggleGroup
            aria-label={t('filterLabel')}
            className="dshx:flex-wrap"
            size="sm"
            type="single"
            value={filter}
            onValueChange={value => {
              const next = AgentToolkit.filters.find(candidate => candidate === value)
              if (next !== undefined) setFilter(next)
            }}
          >
            {AgentToolkit.filters.map(value => (
              <ToggleGroupItem key={value} value={value}>
                {t(FILTER_LABEL[value])}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>

        <div className="dshx:flex dshx:flex-col dshx:gap-6 dshx:px-6 dshx:py-4 dshx:@max-pane-narrow:px-3">
          {listing.isError ? (
            <Alert variant="destructive">
              <AlertDescription>{t('unavailable')}</AlertDescription>
            </Alert>
          ) : null}

          {AgentToolkit.shows(filter, 'tools') ? (
            <Section id="agent-toolkit-tools" title={t('tools', { count: tools.length })}>
              {listing.isPending ? <Loading label={t('loading')} /> : null}
              {listing.data === undefined ? null : (
                <Muted>
                  {listing.data.toolScope === undefined ? t('globalScope') : listing.data.toolScope.sessionId === thread?.id ? t('scope') : t('scopeOther')}
                </Muted>
              )}
              {listing.data !== undefined && tools.length === 0 ? noMatch : null}
              {tools.length === 0 ? null : (
                <Table className="dshx:table-fixed">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="dshx:w-2/5">{t('name')}</TableHead>
                      <TableHead className="dshx:w-1/4">{t('source')}</TableHead>
                      <TableHead className="dshx:@max-pane-compact:hidden">{t('description')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tools.map(tool => {
                      const source = AgentToolkit.sourceOf(tool)
                      return (
                        <TableRow key={tool.name} className={cn(!tool.enabled && 'dshx:opacity-60')}>
                          <TableCell className="dshx:align-top dshx:whitespace-normal">
                            <div className="dshx:flex dshx:flex-col dshx:gap-1">
                              <span className="dshx:font-mono dshx:text-xs dshx:break-all">{tool.name}</span>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="dshx:hidden dshx:text-xs dshx:text-muted-foreground dshx:line-clamp-2 dshx:@max-pane-compact:block">
                                    {tool.description}
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent className="dshx:max-w-96">{tool.description}</TooltipContent>
                              </Tooltip>
                            </div>
                          </TableCell>
                          <TableCell className="dshx:align-top dshx:whitespace-normal">
                            <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-1">
                              {source === 'native' ? (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span className="dshx:inline-flex">
                                      <Badge variant={SOURCE_VARIANT[source]}>{t(SOURCE_LABEL[source])}</Badge>
                                    </span>
                                  </TooltipTrigger>
                                  <TooltipContent>{t('sourceNativeHint')}</TooltipContent>
                                </Tooltip>
                              ) : (
                                <Badge variant={SOURCE_VARIANT[source]}>{t(SOURCE_LABEL[source])}</Badge>
                              )}
                              {tool.readOnly === undefined ? null : (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span className="dshx:inline-flex">
                                      <Badge variant="outline">{tool.readOnly ? t('readOnly') : t('writes')}</Badge>
                                    </span>
                                  </TooltipTrigger>
                                  <TooltipContent>{t('readOnlyHint')}</TooltipContent>
                                </Tooltip>
                              )}
                              {tool.enabled ? null : (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span className="dshx:inline-flex">
                                      <Badge variant="destructive">{t('restricted')}</Badge>
                                    </span>
                                  </TooltipTrigger>
                                  <TooltipContent>{t('restrictedHint')}</TooltipContent>
                                </Tooltip>
                              )}
                              {tool.owner === undefined ? null : (
                                <span className="dshx:w-full dshx:text-xs dshx:text-muted-foreground dshx:break-all">{tool.owner}</span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="dshx:align-top dshx:whitespace-normal dshx:text-xs dshx:text-muted-foreground dshx:@max-pane-compact:hidden">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="dshx:line-clamp-2">{tool.description}</span>
                              </TooltipTrigger>
                              <TooltipContent className="dshx:max-w-96">{tool.description}</TooltipContent>
                            </Tooltip>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              )}
            </Section>
          ) : null}

          {AgentToolkit.shows(filter, 'apis') ? (
            <Section id="agent-toolkit-apis" title={t('apis', { count: methods.length })}>
              {listing.data !== undefined && methods.length === 0 ? noMatch : null}
              {methods.length === 0 ? null : (
                <Table className="dshx:table-fixed">
                  <TableBody>
                    {methods.map(row => (
                      <TableRow key={row.key}>
                        <TableCell className="dshx:w-2/5 dshx:align-top dshx:whitespace-normal">
                          <div className="dshx:flex dshx:flex-col dshx:gap-1">
                            <span className="dshx:font-mono dshx:text-xs dshx:break-all">{row.path}</span>
                            <span className="dshx:text-xs dshx:text-muted-foreground dshx:break-all">{row.owner}</span>
                          </div>
                        </TableCell>
                        <TableCell className="dshx:align-top dshx:whitespace-normal dshx:text-xs dshx:text-muted-foreground">
                          <span className="dshx:line-clamp-2">{row.description ?? t('noDescription')}</span>
                        </TableCell>
                        <TableCell className="dshx:w-28 dshx:align-top">
                          {row.tool === undefined ? null : (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="dshx:inline-flex">
                                  <Badge variant="info">{t('agentTool')}</Badge>
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>{row.tool}</TooltipContent>
                            </Tooltip>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Section>
          ) : null}

          {AgentToolkit.shows(filter, 'plugins') ? (
            <Section id="agent-toolkit-plugins" title={t('plugins', { count: plugins.length })}>
              {inventory.isPending ? <Loading label={t('loading')} /> : null}
              {inventory.data !== undefined && plugins.length === 0 ? noMatch : null}
              {plugins.length === 0 ? null : (
                <Table className="dshx:table-fixed">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="dshx:w-1/2">{t('name')}</TableHead>
                      <TableHead>{t('version')}</TableHead>
                      <TableHead className="dshx:@max-pane-narrow:hidden">{t('state')}</TableHead>
                      <TableHead className="dshx:w-24 dshx:text-right">{t('settings')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {plugins.map(row => (
                      <TableRow key={row.entryId} className={cn(!row.enabled && 'dshx:opacity-60')}>
                        <TableCell className="dshx:align-top dshx:whitespace-normal">
                          <div className="dshx:flex dshx:flex-col dshx:gap-0.5">
                            <span className="dshx:font-mono dshx:text-xs dshx:break-all">{row.moduleName}</span>
                            {row.title === undefined ? null : <span className="dshx:text-xs dshx:text-muted-foreground">{row.title}</span>}
                          </div>
                        </TableCell>
                        <TableCell className="dshx:align-top dshx:font-mono dshx:text-xs">{row.version ?? t('unknownVersion')}</TableCell>
                        <TableCell className="dshx:align-top dshx:@max-pane-narrow:hidden">
                          <Badge variant={row.enabled ? (row.phase === 'active' ? 'success' : 'warning') : 'muted'}>
                            {row.enabled ? (row.phase ?? t('phaseUnknown')) : t('disabled')}
                          </Badge>
                        </TableCell>
                        <TableCell className="dshx:align-top dshx:text-right">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label={t('openSettings', { plugin: row.packageName })}
                                onClick={() => props.openSettings(row.entryId)}
                              >
                                <SettingsIcon aria-hidden />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>{t('openSettings', { plugin: row.packageName })}</TooltipContent>
                          </Tooltip>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Section>
          ) : null}

          {AgentToolkit.shows(filter, 'mcp') ? (
            <Section id="agent-toolkit-mcp" title={t('mcp', { count: mcpRows.length })}>
              {servers.isPending ? <Loading label={t('loading')} /> : null}
              {servers.isError ? <Muted>{isApiOwnerMissing(servers.error) ? t('mcpUnavailable') : t('unavailable')}</Muted> : null}
              {servers.data !== undefined && servers.data.servers.length === 0 ? <Muted>{t('mcpEmpty')}</Muted> : null}
              <ul className="dshx:flex dshx:flex-col dshx:gap-2">
                {mcpRows.map(row => (
                  <li key={row.id} className="dshx:flex dshx:flex-col dshx:gap-1 dshx:rounded-md dshx:border dshx:border-border dshx:p-3">
                    <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2">
                      <span className="dshx:min-w-0 dshx:truncate dshx:text-sm dshx:font-medium">{row.name}</span>
                      <Badge variant={row.lifecycle === 'loaded' ? 'success' : row.lifecycle === 'start-failed' ? 'destructive' : 'muted'}>
                        {row.enabled ? row.lifecycle : t('mcpOff')}
                      </Badge>
                      <span className="dshx:text-xs dshx:text-muted-foreground">{t('mcpToolCount', { count: row.tools.length })}</span>
                    </div>
                    {row.tools.length === 0 ? null : (
                      <p className="dshx:font-mono dshx:text-xs dshx:break-all dshx:text-muted-foreground">
                        {row.tools.map(tool => tool.name.slice(`mcp__${row.serverName}__`.length)).join(', ')}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}

          {AgentToolkit.shows(filter, 'skills') ? (
            <Section id="agent-toolkit-skills" title={t('skills', { count: skills.length })}>
              {listing.data !== undefined && skills.length === 0 ? noMatch : null}
              {skills.length === 0 ? null : (
                <Table className="dshx:table-fixed">
                  <TableBody>
                    {skills.map(skill => (
                      <TableRow key={`${skill.provider}/${skill.name}`}>
                        <TableCell className="dshx:w-2/5 dshx:align-top dshx:whitespace-normal">
                          <div className="dshx:flex dshx:flex-col dshx:items-start dshx:gap-1">
                            <span className="dshx:font-mono dshx:text-xs dshx:break-all">/{skill.name}</span>
                            <div className="dshx:flex dshx:flex-wrap dshx:gap-1">
                              <Badge variant="info">{t(SKILL_ORIGIN_LABEL[AgentToolkit.skillOrigin(skill)])}</Badge>
                              {skill.provider === '' ? null : <Badge variant="outline">{skill.provider}</Badge>}
                              <Badge variant="outline">{t(INVOCATION_LABEL[AgentToolkit.invocation(skill)])}</Badge>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="dshx:align-top dshx:whitespace-normal dshx:text-xs dshx:text-muted-foreground">
                          <span className="dshx:line-clamp-3">{skill.description}</span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Section>
          ) : null}

          {AgentToolkit.shows(filter, 'memory') ? (
            <Section id="agent-toolkit-memory" title={t('memory')}>
              {cwd === undefined ? <Muted>{t('memoryNoThread')}</Muted> : null}
              {startBlock.isError ? <Muted>{t('memoryUnavailable')}</Muted> : null}
              {startBlock.data === undefined ? null : (
                <div className="dshx:flex dshx:flex-col dshx:gap-3">
                  <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2">
                    <span className="dshx:text-xs dshx:text-muted-foreground">{t('memoryNotes')}</span>
                    {(notes.data === undefined ? [] : AgentToolkit.noteCounts(notes.data)).map(entry => (
                      <Badge key={entry.type} variant="secondary">
                        {entry.type} · {entry.count}
                      </Badge>
                    ))}
                    {notes.data?.length === 0 ? <span className="dshx:text-xs dshx:text-muted-foreground">{t('memoryNoNotes')}</span> : null}
                    <Button variant="link" size="sm" className="dshx:h-auto dshx:px-0" onClick={props.openMemoryPanel}>
                      {t('openMemory')}
                    </Button>
                  </div>
                  <p className="dshx:text-xs dshx:text-muted-foreground dshx:break-all">{t('memoryBlock', { project: startBlock.data.project })}</p>
                  {startBlock.data.text === '' ? (
                    <Muted>{t('memoryBlockEmpty')}</Muted>
                  ) : (
                    <pre className="dshx:max-h-72 dshx:overflow-auto dshx:rounded-md dshx:bg-muted dshx:p-3 dshx:font-mono dshx:text-xs dshx:whitespace-pre-wrap">
                      {startBlock.data.text}
                    </pre>
                  )}
                </div>
              )}
            </Section>
          ) : null}
        </div>
      </main>
    </TooltipProvider>
  )
}
