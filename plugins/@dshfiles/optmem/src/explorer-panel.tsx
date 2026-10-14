import { useApi } from '@dshfiles/dshx/client'
import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Input } from '@dshfiles/plugin-ui/components/ui/input'
import { ArrowDownIcon, ChevronDownIcon, ChevronRightIcon, SearchIcon } from '@dshfiles/plugin-ui/icons'
import { errorMessage, useQuery } from '@dshfiles/plugin-ui/query'
import { useDebouncedValue } from '@dshfiles/plugin-ui/hooks/debounced-value'
import { EntityLabels } from '@dshfiles/plugin-ui/hooks/entity-labels'
import { createStoredValue } from '@dshfiles/plugin-ui/hooks/stored-value'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { z } from 'zod'
import { useState, type ReactNode } from 'react'

import { optmemApi, type OptmemExplorerNode } from './api.ts'

type Tab = 'explore' | 'context' | 'pipeline'

type ExplorerPanelProps = {
  readonly currentPath: string | null
  readonly openSession: (sessionId: string) => void
}

const storedProject = createStoredValue({ key: 'dshfiles.optmem.explorer.project', schema: z.string().min(1), fallback: null })

const nodeLabel = (node: OptmemExplorerNode): string => node.text.replace(/\s+/g, ' ').slice(0, 120)
const formatTime = (value: number | null | undefined): string => (value === null || value === undefined ? 'Unknown' : new Date(value).toLocaleString())
const formatMoment = (value: number | null): string => (value === null ? 'none yet' : new Date(value).toLocaleString())
const formatNumber = (value: number): string => new Intl.NumberFormat().format(value)
const formatCoverage = (throughPos: number, streamLength: number): string =>
  streamLength === 0
    ? 'no stream entries yet'
    : `${((throughPos / streamLength) * 100).toFixed(1)}% · ${formatNumber(throughPos)} / ${formatNumber(streamLength)} positions`
const formatRateLimit = (callsLastMinute: number, rateLimitPerMinute: number): string =>
  `${formatNumber(callsLastMinute)} · ${rateLimitPerMinute === 0 ? 'limit off' : `limit ${formatNumber(rateLimitPerMinute)}/min`}`
const formatRecoveryInterval = (intervalMs: number): string => (intervalMs === 0 ? 'off · no automatic recovery' : `${formatNumber(intervalMs)} ms`)

export const ExplorerPanel = (props: ExplorerPanelProps): JSX.Element => {
  const api = useApi(optmemApi)
  const [tab, setTab] = useState<Tab>('explore')
  const projectId = storedProject.useValue()
  const [searchText, setSearchText] = useState('')
  const [offset, setOffset] = useState(0)
  const [selectedAddress, setSelectedAddress] = useState<string | null>(null)
  const [expandedAddress, setExpandedAddress] = useState<string | null>(null)
  const [previewSession, setPreviewSession] = useState('')
  const debouncedSearch = useDebouncedValue({ value: searchText, delayMs: 180 })
  const projects = useQuery({
    queryKey: ['optmem', 'explorer', 'projects'],
    queryFn: ({ signal }) => api.projects(undefined, { signal }),
    retry: false,
  })
  const projectList = projects.data ?? []
  const currentProject = useQuery({
    queryKey: ['optmem', 'explorer', 'current-project', props.currentPath],
    queryFn: ({ signal }) => api.projectForPath({ path: props.currentPath ?? '' }, { signal }),
    enabled: props.currentPath !== null,
    staleTime: 30_000,
    retry: false,
  })
  // A thread workspace opens on its repository's memory: that is where the project's history accumulates.
  const currentProjectPath = projectList.find(project => project.projectId === currentProject.data)?.path ?? null
  const resolvedCurrentProjectId =
    currentProjectPath !== null && EntityLabels.isThreadWorkspace(currentProjectPath)
      ? (projectList.find(project => project.path === EntityLabels.repositoryPath(currentProjectPath))?.projectId ?? currentProject.data ?? null)
      : (currentProject.data ?? null)
  const projectGroups = EntityLabels.groupByRepository(projectList)
  const unregisteredProjects = projectList.filter(project => project.path === null)
  const projectOption = (project: (typeof projectList)[number], label: string): JSX.Element => (
    <option key={project.projectId} value={project.projectId}>
      {label}
      {project.path !== null && project.path === props.currentPath ? ' · current' : ''}
    </option>
  )
  const availableSelection = projectList.some(project => project.projectId === projectId)
    ? projectId
    : props.currentPath !== null
      ? projectList.some(project => project.projectId === resolvedCurrentProjectId)
        ? resolvedCurrentProjectId
        : null
      : (projectList.find(project => !EntityLabels.isThreadWorkspace(project.path))?.projectId ?? projectList[0]?.projectId ?? null)
  const selectedProject = projectList.find(project => project.projectId === availableSelection)

  const view = useQuery({
    queryKey: ['optmem', 'explorer', 'view', availableSelection],
    queryFn: ({ signal }) => api.projectView({ projectId: availableSelection ?? '' }, { signal }),
    enabled: tab === 'explore' && availableSelection !== null && debouncedSearch.trim().length === 0,
    retry: false,
  })
  const search = useQuery({
    queryKey: ['optmem', 'explorer', 'search', availableSelection, debouncedSearch, offset],
    queryFn: ({ signal }) => api.projectSearch({ projectId: availableSelection ?? '', query: debouncedSearch, offset, limit: 25 }, { signal }),
    enabled: tab === 'explore' && availableSelection !== null && debouncedSearch.trim().length > 0,
    retry: false,
  })
  const detail = useQuery({
    queryKey: ['optmem', 'explorer', 'node', availableSelection, selectedAddress],
    queryFn: ({ signal }) => api.projectZoom({ projectId: availableSelection ?? '', address: selectedAddress ?? '' }, { signal }),
    enabled: tab === 'explore' && availableSelection !== null && selectedAddress !== null,
    retry: false,
  })
  const preview = useQuery({
    queryKey: ['optmem', 'explorer', 'context', availableSelection, previewSession],
    queryFn: ({ signal }) =>
      api.contextPreview(
        previewSession.trim().length === 0
          ? { projectId: availableSelection ?? '' }
          : { projectId: availableSelection ?? '', conversationId: previewSession.trim() },
        { signal },
      ),
    enabled: tab === 'context' && availableSelection !== null,
    retry: false,
  })
  const pipeline = useQuery({
    queryKey: ['optmem', 'explorer', 'pipeline', availableSelection],
    queryFn: ({ signal }) => api.projectPipeline({ projectId: availableSelection ?? '' }, { signal }),
    enabled: tab === 'pipeline' && availableSelection !== null,
    refetchInterval: 5_000,
    retry: false,
  })

  const changeProject = (next: string): void => {
    storedProject.set(next)
    setSelectedAddress(null)
    setExpandedAddress(null)
    setOffset(0)
  }

  const changeSearch = (next: string): void => {
    setSearchText(next)
    setOffset(0)
    setSelectedAddress(null)
    setExpandedAddress(null)
  }

  const selectAddress = (address: string): void => setSelectedAddress(address)
  const toggleExpanded = (address: string): void => {
    setSelectedAddress(address)
    setExpandedAddress(current => (current === address ? null : address))
  }

  const searchResults = search.data?.hits ?? []
  const viewNodes = view.data ?? []
  const selectedDetails = detail.data
  const selectedEvent = selectedDetails?.kind === 'event' ? selectedDetails : undefined
  const selectedNode = selectedDetails?.kind === 'node' ? selectedDetails : undefined

  const switchTab = (next: Tab): void => setTab(next)
  const handleTabKey = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    const tabs: readonly Tab[] = ['explore', 'context', 'pipeline']
    const index = tabs.indexOf(tab)
    const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : (index + tabs.length - 1) % tabs.length
    setTab(tabs[next] ?? 'explore')
  }

  return (
    <main className="dshx-root dshx:flex dshx:h-full dshx:min-h-0 dshx:flex-col dshx:bg-background dshx:text-foreground">
      <header className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-3 dshx:border-b dshx:border-border dshx:px-4 dshx:py-3">
        <div className="dshx:flex dshx:min-w-52 dshx:flex-col dshx:gap-0.5">
          <span className="dshx:text-xs dshx:text-muted-foreground">Project memory</span>
          <select
            aria-label="Memory project"
            className="dshx:h-8 dshx:max-w-96 dshx:truncate dshx:rounded-md dshx:border dshx:border-input dshx:bg-background dshx:px-2 dshx:text-sm dshx:text-foreground"
            value={availableSelection ?? ''}
            onChange={event => changeProject(event.currentTarget.value)}
          >
            {projectList.length === 0 ? <option value="">No projects found</option> : null}
            {projectGroups.map(group =>
              group.threads.length === 0 && group.project !== null ? (
                projectOption(group.project, group.project.title)
              ) : (
                <optgroup key={group.repositoryPath} label={group.project?.title ?? group.repositoryPath.split('/').at(-1) ?? group.repositoryPath}>
                  {group.project === null ? null : projectOption(group.project, group.project.title)}
                  {group.threads.map(thread => projectOption(thread, `↳ ${thread.path?.split('/').at(-1) ?? thread.title}`))}
                </optgroup>
              ),
            )}
            {unregisteredProjects.length === 0 ? null : (
              <optgroup label="Unregistered">
                {unregisteredProjects.map(project =>
                  projectOption(project, `Unregistered project · ${EntityLabels.shortId(project.projectId.replace(/^workspace:/u, ''))}`),
                )}
              </optgroup>
            )}
          </select>
        </div>
        {selectedProject ? (
          <span
            className="dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:text-xs dshx:text-muted-foreground"
            title={selectedProject.path ?? selectedProject.projectId}
          >
            {selectedProject.path ?? selectedProject.projectId} · {formatNumber(selectedProject.eventCount)} events
          </span>
        ) : (
          <span className="dshx:flex-1" />
        )}
        <div role="tablist" aria-label="OptMem views" className="dshx:flex dshx:items-center dshx:gap-1" onKeyDown={handleTabKey}>
          {(['explore', 'context', 'pipeline'] as const).map(item => (
            <button
              key={item}
              type="button"
              role="tab"
              aria-selected={tab === item}
              tabIndex={tab === item ? 0 : -1}
              className={`dshx:rounded-md dshx:px-3 dshx:py-1.5 dshx:text-xs dshx:capitalize dshx:transition-colors ${tab === item ? 'dshx:bg-accent dshx:text-foreground' : 'dshx:text-muted-foreground dshx:hover:bg-muted'}`}
              onClick={() => switchTab(item)}
            >
              {item === 'context' ? 'Context preview' : item === 'explore' ? 'Explore' : 'Pipeline'}
            </button>
          ))}
        </div>
      </header>

      {tab === 'explore' ? (
        <section className="dshx:grid dshx:min-h-0 dshx:flex-1 dshx:grid-cols-[minmax(260px,0.85fr)_minmax(0,1.4fr)] dshx:divide-x dshx:divide-border">
          <aside className="dshx:flex dshx:min-h-0 dshx:flex-col">
            <div className="dshx:flex dshx:items-center dshx:gap-2 dshx:border-b dshx:border-border dshx:p-3">
              <SearchIcon className="dshx:size-4 dshx:text-muted-foreground" />
              <Input
                aria-label="Search project memories"
                className="dshx:h-8 dshx:font-mono! dshx:text-xs"
                placeholder="Search this project's memory…"
                value={searchText}
                onChange={event => changeSearch(event.currentTarget.value)}
              />
            </div>
            <div className="dshx:min-h-0 dshx:flex-1 dshx:overflow-auto dshx:p-2" aria-label="Memory hierarchy">
              <p className="dshx:px-2 dshx:pb-2 dshx:text-[11px] dshx:text-muted-foreground">Committed main view; unfinished leaves are counted in Pipeline.</p>
              {availableSelection === null ? <EmptyState text="Choose a project to browse its memory." /> : null}
              {debouncedSearch.trim().length === 0 ? (
                <>
                  {availableSelection !== null && view.isPending ? <EmptyState text="Loading memory tree…" /> : null}
                  {view.error ? <ErrorState text={errorMessage(view.error, 'Memory tree unavailable.')} /> : null}
                  {!view.isPending && !view.error && viewNodes.length === 0 ? <EmptyState text="This project has no summarized memory yet." /> : null}
                  {viewNodes.map(node => (
                    <TreeRow
                      key={node.address}
                      address={node.address}
                      text={nodeLabel(node)}
                      selected={selectedAddress === node.address}
                      expanded={expandedAddress === node.address}
                      onSelect={() => selectAddress(node.address)}
                      onExpand={() => toggleExpanded(node.address)}
                    />
                  ))}
                  {expandedAddress === selectedAddress && selectedNode ? (
                    <div className="dshx:ml-5 dshx:border-l dshx:border-border dshx:pl-2">
                      {selectedNode.lines.map(line => {
                        const [address, text] = line.split('|')
                        if (!address) return null
                        const childAddress = address.trim()
                        return (
                          <TreeRow
                            key={childAddress}
                            address={childAddress}
                            text={(text ?? '').trim().slice(0, 120)}
                            selected={selectedAddress === childAddress}
                            expanded={expandedAddress === childAddress}
                            onSelect={() => selectAddress(childAddress)}
                            onExpand={() => toggleExpanded(childAddress)}
                          />
                        )
                      })}
                    </div>
                  ) : null}
                </>
              ) : (
                <>
                  {search.isPending ? <EmptyState text="Searching…" /> : null}
                  {search.error ? <ErrorState text={errorMessage(search.error, 'Search failed.')} /> : null}
                  {!search.isPending && !search.error && searchResults.length === 0 ? <EmptyState text="No memory matches this search." /> : null}
                  {searchResults.map(hit => (
                    <button
                      key={hit.eventId}
                      type="button"
                      className={`dshx:mb-1 dshx:block dshx:w-full dshx:rounded-md dshx:p-2 dshx:text-left dshx:hover:bg-muted ${selectedAddress === (hit.address ?? `${hit.pos}+1`) ? 'dshx:bg-accent' : ''}`}
                      onClick={() => selectAddress(hit.address ?? `${hit.pos}+1`)}
                    >
                      <span className="dshx:block dshx:text-xs dshx:leading-5">{hit.snippet}</span>
                      <span className="dshx:block dshx:text-[11px] dshx:text-muted-foreground">
                        {hit.role} · {formatTime(hit.createdAt)} · session {hit.conversationId.slice(0, 8)}
                      </span>
                    </button>
                  ))}
                  <div className="dshx:flex dshx:items-center dshx:justify-between dshx:pt-2">
                    <Button variant="ghost" size="xs" disabled={offset === 0 || search.isFetching} onClick={() => setOffset(Math.max(0, offset - 25))}>
                      Previous
                    </Button>
                    <span className="dshx:text-[11px] dshx:text-muted-foreground">
                      {offset + (searchResults.length === 0 ? 0 : 1)}–{offset + searchResults.length}
                    </span>
                    <Button
                      variant="ghost"
                      size="xs"
                      disabled={!search.data?.hasMore || search.isFetching}
                      onClick={() => setOffset(search.data?.nextOffset ?? offset)}
                    >
                      Next
                    </Button>
                  </div>
                </>
              )}
            </div>
          </aside>

          <article className="dshx:min-h-0 dshx:overflow-auto dshx:p-4">
            {selectedAddress === null ? <EmptyState text="Select a memory node to inspect its content and sources." /> : null}
            {detail.isPending && selectedAddress !== null ? <EmptyState text="Loading memory details…" /> : null}
            {detail.error ? <ErrorState text={errorMessage(detail.error, 'Memory details unavailable.')} /> : null}
            {selectedNode ? (
              <div className="dshx:flex dshx:flex-col dshx:gap-4">
                <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2">
                  <h2 className="dshx:font-mono dshx:text-sm">{selectedNode.address}</h2>
                  <Badge variant="outline">{selectedNode.model}</Badge>
                  <span className="dshx:text-xs dshx:text-muted-foreground">
                    {selectedNode.bytes} bytes · updated {formatTime(selectedNode.createdAt)}
                  </span>
                </div>
                <pre className="dshx:whitespace-pre-wrap dshx:break-words dshx:rounded-md dshx:bg-muted/40 dshx:p-3 dshx:font-mono dshx:text-xs dshx:leading-5">
                  {selectedNode.text}
                </pre>
                <div className="dshx:flex dshx:flex-wrap dshx:gap-2 dshx:text-xs">
                  {selectedNode.parentAddress === null ? (
                    <span className="dshx:text-muted-foreground">Root node</span>
                  ) : (
                    <button type="button" className="dshx:text-primary dshx:hover:underline" onClick={() => selectAddress(selectedNode.parentAddress ?? '')}>
                      Parent {selectedNode.parentAddress}
                    </button>
                  )}
                  {selectedNode.childAddresses.map(address => (
                    <button key={address} type="button" className="dshx:text-primary dshx:hover:underline" onClick={() => toggleExpanded(address)}>
                      Child {address}
                    </button>
                  ))}
                </div>
                <section className="dshx:flex dshx:flex-col dshx:gap-2">
                  <h3 className="dshx:text-xs dshx:font-medium">Source events · {formatNumber(selectedNode.sourceCount)}</h3>
                  {selectedNode.sources.length === 0 ? (
                    <p className="dshx:text-xs dshx:text-muted-foreground">No source records are available for this node.</p>
                  ) : null}
                  {selectedNode.sources.map(source => (
                    <div key={source.eventId} className="dshx:flex dshx:items-center dshx:gap-2 dshx:text-xs">
                      <button
                        type="button"
                        className="dshx:font-mono dshx:text-primary dshx:hover:underline"
                        onClick={() => props.openSession(source.conversationId)}
                      >
                        #{source.eventId} · session {source.conversationId.slice(0, 8)}
                      </button>
                      <span className="dshx:text-muted-foreground">
                        {source.role} · {formatTime(source.createdAt)}
                      </span>
                    </div>
                  ))}
                  {selectedNode.sourcesTruncated ? <p className="dshx:text-xs dshx:text-muted-foreground">Showing the first 50 source events.</p> : null}
                </section>
              </div>
            ) : null}
            {selectedEvent ? (
              <div className="dshx:flex dshx:flex-col dshx:gap-3">
                <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2">
                  <h2 className="dshx:font-mono dshx:text-sm">{selectedEvent.address}</h2>
                  <Badge variant="outline">{selectedEvent.role}</Badge>
                  <span className="dshx:text-xs dshx:text-muted-foreground">
                    event #{selectedEvent.eventId} · {formatTime(selectedEvent.createdAt)}
                  </span>
                </div>
                <pre className="dshx:whitespace-pre-wrap dshx:break-words dshx:rounded-md dshx:bg-muted/40 dshx:p-3 dshx:font-mono dshx:text-xs dshx:leading-5">
                  {selectedEvent.text}
                </pre>
                {selectedEvent.truncated ? (
                  <p className="dshx:text-xs dshx:text-muted-foreground">Stored event text is truncated; open the source session for full context.</p>
                ) : null}
                <Button variant="outline" size="sm" className="dshx:w-fit" onClick={() => props.openSession(selectedEvent.conversationId)}>
                  Open source session <ArrowDownIcon />
                </Button>
              </div>
            ) : null}
          </article>
        </section>
      ) : null}

      {tab === 'context' ? (
        <section className="dshx:flex dshx:min-h-0 dshx:flex-1 dshx:flex-col dshx:gap-3 dshx:overflow-auto dshx:p-4">
          <div className="dshx:flex dshx:flex-wrap dshx:items-end dshx:gap-3">
            <label className="dshx:flex dshx:min-w-64 dshx:flex-1 dshx:flex-col dshx:gap-1 dshx:text-xs dshx:text-muted-foreground">
              Session id (optional)
              <Input
                className="dshx:h-8 dshx:font-mono! dshx:text-xs"
                placeholder="Use project-wide context"
                value={previewSession}
                onChange={event => setPreviewSession(event.currentTarget.value)}
              />
            </label>
            <Badge variant="outline">Simulated · read-only</Badge>
            {preview.data ? (
              <span className="dshx:text-xs dshx:text-muted-foreground">
                {preview.data.estimatedTokens} estimated tokens / {preview.data.budgetBytes} byte budget
              </span>
            ) : null}
          </div>
          {availableSelection === null ? <EmptyState text="Choose a project to preview its context." /> : null}
          {availableSelection !== null && preview.isPending ? <EmptyState text="Assembling the same compact view used for injection…" /> : null}
          {preview.error ? <ErrorState text={errorMessage(preview.error, 'Context preview unavailable.')} /> : null}
          {preview.data && preview.data.text.length === 0 ? <EmptyState text="No compact memory is currently available for injection." /> : null}
          {preview.data?.text ? (
            <pre className="dshx:min-h-48 dshx:whitespace-pre-wrap dshx:break-words dshx:rounded-md dshx:border dshx:border-border dshx:bg-muted/30 dshx:p-3 dshx:font-mono dshx:text-xs dshx:leading-5">
              {preview.data.text}
            </pre>
          ) : null}
          {preview.data ? (
            <p className="dshx:text-xs dshx:text-muted-foreground">
              Source nodes: {preview.data.sourceAddresses.join(', ') || 'none'}. Token count is an estimate (bytes ÷ 4). This preview is not a recorded
              injection and does not resume or modify a session.
            </p>
          ) : null}
        </section>
      ) : null}

      {tab === 'pipeline' ? (
        <section className="dshx:flex dshx:min-h-0 dshx:flex-1 dshx:flex-col dshx:gap-4 dshx:overflow-auto dshx:p-4">
          {availableSelection === null ? <EmptyState text="Choose a project to inspect its pipeline." /> : null}
          {availableSelection !== null && pipeline.isPending ? <EmptyState text="Loading project pipeline status…" /> : null}
          {pipeline.error ? <ErrorState text={errorMessage(pipeline.error, 'Pipeline status unavailable.')} /> : null}
          {pipeline.data ? (
            <>
              <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2">
                <h2 className="dshx:text-sm dshx:font-medium">Summary pipeline</h2>
                <Badge variant={pipeline.data.health === 'degraded' ? 'destructive' : 'secondary'}>{pipeline.data.health}</Badge>
                <span className="dshx:text-xs dshx:text-muted-foreground">Read-only diagnostics · refreshes every 5 seconds</span>
              </div>
              <div className="dshx:flex dshx:flex-col dshx:gap-4">
                <PipelineGroup title="Backlog progress">
                  <PipelineFact label="Injected view covers" value={formatCoverage(pipeline.data.viewThroughPos, pipeline.data.streamLength)} />
                  <PipelineFact label="Pending stream entries" value={formatNumber(pipeline.data.pendingLeafJobs)} />
                  <PipelineFact label="Estimated leaf model calls" value={formatNumber(pipeline.data.estimatedLeafSummaryCalls)} />
                  <PipelineFact label="Ready merge summaries" value={formatNumber(pipeline.data.pendingMergeJobs)} />
                  <PipelineFact label="Oldest pending event" value={formatTime(pipeline.data.oldestPendingAt)} />
                  <PipelineFact label="Completed summary nodes" value={formatNumber(pipeline.data.completedSummaryNodes)} />
                  <PipelineFact label="Paused" value={pipeline.data.paused ? 'Yes' : 'No'} />
                </PipelineGroup>
                <PipelineGroup title="Throughput">
                  <PipelineFact label="Summary nodes / min · this project (10m)" value={(pipeline.data.summariesLastTenMinutes / 10).toFixed(1)} />
                  <PipelineFact label="Summary nodes / min · all streams (10m)" value={(pipeline.data.globalSummariesLastTenMinutes / 10).toFixed(1)} />
                  <PipelineFact label="Last summary produced" value={formatMoment(pipeline.data.lastSummaryAt)} />
                  <PipelineFact label="Fallbacks to clipped text (this process)" value={formatNumber(pipeline.data.fallbacks)} />
                </PipelineGroup>
                <PipelineGroup title="Failures">
                  <PipelineFact label="Failed summary jobs" value={formatNumber(pipeline.data.failedJobs)} />
                  <PipelineFact label="Retrying summary jobs" value={formatNumber(pipeline.data.retryingJobs)} />
                  <PipelineFact label="Unsummarized nodes (clipped text)" value={formatNumber(pipeline.data.unsummarizedNodes)} />
                  <PipelineFact label="Last error" value={pipeline.data.lastError ?? 'none'} danger={pipeline.data.lastError !== null} />
                </PipelineGroup>
                <PipelineGroup title="Cost and recovery">
                  <PipelineFact
                    label="Model calls last minute (limit/min)"
                    value={formatRateLimit(pipeline.data.callsLastMinute, pipeline.data.rateLimitPerMinute)}
                  />
                  <PipelineFact label="Recovery sweep interval" value={formatRecoveryInterval(pipeline.data.catchUpIntervalMs)} />
                  <PipelineFact label="Recovery sweep last scan" value={formatMoment(pipeline.data.catchUpLastScanAt)} />
                </PipelineGroup>
              </div>
              <p className="dshx:max-w-3xl dshx:text-xs dshx:text-muted-foreground">
                Pending stream entries counts missing level-0 nodes per stream and equals distinct pending events inside a single stream; the same captured
                event can still land in both a conversation and a project stream, so the pair diverges only across a whole project. The estimate counts unique
                oversized events that do not already have a leaf summary. It does not count future parent work or guarantee the configured route is available.
                Nodes rebuilt from clipped head+tail text after repeated failures are kept and served, but are not model-summarized.
              </p>
            </>
          ) : null}
        </section>
      ) : null}
    </main>
  )
}

const TreeRow = (props: {
  readonly address: string
  readonly text: string
  readonly selected: boolean
  readonly expanded: boolean
  readonly onSelect: () => void
  readonly onExpand: () => void
}): JSX.Element => (
  <div className={`dshx:mb-0.5 dshx:flex dshx:items-center dshx:gap-1 dshx:rounded-md dshx:pr-1 ${props.selected ? 'dshx:bg-accent' : 'dshx:hover:bg-muted'}`}>
    <button
      type="button"
      aria-label={`${props.expanded ? 'Collapse' : 'Expand'} ${props.address}`}
      className="dshx:flex dshx:size-7 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:text-muted-foreground"
      onClick={props.onExpand}
    >
      {props.expanded ? <ChevronDownIcon className="dshx:size-3.5" /> : <ChevronRightIcon className="dshx:size-3.5" />}
    </button>
    <button
      type="button"
      aria-current={props.selected ? 'true' : undefined}
      className="dshx:min-w-0 dshx:flex-1 dshx:py-1.5 dshx:text-left"
      onClick={props.onSelect}
    >
      <span className="dshx:block dshx:font-mono dshx:text-[11px] dshx:text-muted-foreground">{props.address}</span>
      <span className="dshx:block dshx:truncate dshx:text-xs">{props.text}</span>
    </button>
  </div>
)

const PipelineFact = (props: { readonly label: string; readonly value: string; readonly danger?: boolean }): JSX.Element => (
  <>
    <dt className="dshx:text-muted-foreground">{props.label}</dt>
    <dd className={cn('dshx:break-all dshx:font-mono', props.danger === true ? 'dshx:text-destructive' : undefined)}>{props.value}</dd>
  </>
)

const PipelineGroup = (props: { readonly title: string; readonly children: ReactNode }): JSX.Element => (
  <section className="dshx:flex dshx:flex-col dshx:gap-1.5">
    <h3 className="dshx:text-xs dshx:font-medium dshx:text-muted-foreground">{props.title}</h3>
    <dl className="dshx:grid dshx:grid-cols-[max-content_minmax(0,1fr)] dshx:gap-x-5 dshx:gap-y-2 dshx:text-xs">{props.children}</dl>
  </section>
)

const EmptyState = (props: { readonly text: string }): JSX.Element => (
  <p className="dshx:px-2 dshx:py-3 dshx:text-xs dshx:text-muted-foreground">{props.text}</p>
)
const ErrorState = (props: { readonly text: string }): JSX.Element => (
  <p role="alert" className="dshx:px-2 dshx:py-3 dshx:text-xs dshx:text-destructive">
    {props.text}
  </p>
)
