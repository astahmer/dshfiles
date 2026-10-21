import { ArrowLeftIcon, FolderGit2Icon, GitCommitHorizontalIcon, MessagesSquareIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useMemo, type ReactNode } from 'react'

import { useApi } from '@dshfiles/dshx/client'
import { useQuery } from '@dshfiles/plugin-ui/query'

import { backlogApi, BacklogViews, type BacklogSummaryView } from './api.js'
import type { BacklogStatus } from './item.js'
import { BacklogItemMenu } from './item-actions-menu.js'
import { ItemGlyphs } from './item-glyphs.js'
import type { StartThreadItem } from './start-thread.js'
import { BacklogQueries, type BacklogUpdateInput, useBacklogActions } from './use-backlog-actions.js'

const DAY_MS = 86_400_000
const NO_PROJECT = ''
const progressStatuses: readonly BacklogStatus[] = ['inbox', 'todo', 'doing', 'done']
const statusBar = {
  inbox: 'dshx:bg-muted-foreground/40',
  todo: 'dshx:bg-muted-foreground/70',
  doing: 'dshx:bg-warning',
  done: 'dshx:bg-violet',
  dropped: 'dshx:bg-muted',
} satisfies Record<BacklogStatus, string>

type Project = {
  readonly key: string
  readonly counts: Readonly<Record<BacklogStatus, number>>
  readonly needsYou: number
  readonly actors: readonly string[]
  readonly lastActivityAt: number
}

const ProgressBar = (props: { readonly counts: Readonly<Record<BacklogStatus, number>>; readonly className?: string }): JSX.Element => {
  const total = progressStatuses.reduce((sum, status) => sum + props.counts[status], 0)
  return (
    <div className={cn('dshx:flex dshx:h-1.5 dshx:w-full dshx:gap-0.5 dshx:overflow-hidden dshx:rounded-full dshx:bg-muted', props.className)}>
      {total === 0
        ? null
        : progressStatuses.map(status =>
            props.counts[status] === 0 ? null : (
              <span key={status} className={statusBar[status]} style={{ width: `${String((props.counts[status] / total) * 100)}%` }} />
            ),
          )}
    </div>
  )
}

const percentDone = (counts: Readonly<Record<BacklogStatus, number>>): number => {
  const total = progressStatuses.reduce((sum, status) => sum + counts[status], 0)
  return total === 0 ? 0 : Math.round((counts.done / total) * 100)
}

const ProjectTitle = (props: { readonly projectKey: string; readonly large?: boolean }): JSX.Element =>
  props.projectKey === NO_PROJECT ? (
    <span className="dshx:text-muted-foreground">No project</span>
  ) : (
    <span className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-2">
      <ItemGlyphs.ProjectDot project={props.projectKey} className={props.large === true ? 'dshx:size-2.5' : ''} />
      <span className="dshx:truncate">{ItemGlyphs.projectName(props.projectKey)}</span>
    </span>
  )

const Card = (props: { readonly title: string; readonly action?: ReactNode; readonly children: ReactNode; readonly className?: string }): JSX.Element => (
  <section className={cn('dshx:flex dshx:flex-col dshx:gap-3 dshx:rounded-xl dshx:border dshx:border-border dshx:bg-card dshx:p-4', props.className)}>
    <div className="dshx:flex dshx:items-center dshx:justify-between">
      <h3 className="dshx:text-[13px] dshx:font-semibold">{props.title}</h3>
      {props.action}
    </div>
    {props.children}
  </section>
)

const ItemLine = (props: {
  readonly item: BacklogSummaryView
  readonly select: (id: number) => void
  readonly startThread: (items: readonly StartThreadItem[]) => void
  readonly projectPaths: readonly string[]
  readonly update: (input: BacklogUpdateInput) => void
  readonly triage: (id: number) => void
}): JSX.Element => (
  <BacklogItemMenu
    item={props.item}
    projectPaths={props.projectPaths}
    update={props.update}
    triage={props.triage}
    startThread={props.startThread}
    openItem={props.select}
  >
    <li aria-label={`Item b:${String(props.item.id)}`}>
      <button
        type="button"
        onClick={() => props.select(props.item.id)}
        className="dshx:flex dshx:h-9 dshx:w-full dshx:items-center dshx:gap-2.5 dshx:rounded-md dshx:px-2 dshx:text-left dshx:text-[13px] dshx:transition-colors dshx:hover:bg-accent/50"
      >
        <ItemGlyphs.StatusIcon status={props.item.status} />
        <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate">{props.item.title}</span>
        <ItemGlyphs.AttentionBadge attention={props.item.attention} compact />
        <ItemGlyphs.ActorStack actorIds={props.item.actors.map(actor => actor.id)} max={2} />
        <span className="dshx:w-8 dshx:text-right dshx:text-[11px] dshx:text-muted-foreground">{ItemGlyphs.ago(props.item.lastActivityAt)}</span>
      </button>
    </li>
  </BacklogItemMenu>
)

const Overview = (props: {
  readonly project: Project
  readonly back: () => void
  readonly select: (id: number) => void
  readonly startThread: (items: readonly StartThreadItem[]) => void
  readonly projectPaths: readonly string[]
}): JSX.Element => {
  const api = useApi(backlogApi)
  const actions = useBacklogActions()
  const project = props.project
  const list = useQuery({
    queryKey: [BacklogQueries.key, 'list', 'project', project.key],
    queryFn: async ({ signal }) =>
      BacklogViews.list(await api.list({ project: project.key === NO_PROJECT ? null : project.key, freshness: 'all', limit: 500 }, { signal })),
  })
  const projectItems = list.data?.items ?? []
  const open = projectItems.filter(item => item.status !== 'done' && item.status !== 'dropped')
  const needsYou = projectItems.filter(item => item.attention !== 'none' || item.proposal !== null)
  const active = open
    .filter(item => item.attention === 'none')
    .sort((left, right) => Number(right.status === 'doing') - Number(left.status === 'doing') || right.lastActivityAt - left.lastActivityAt)
  const recent = [...projectItems]
    .filter(item => item.activity.last !== null)
    .sort((left, right) => right.lastActivityAt - left.lastActivityAt)
    .slice(0, 8)
  const threads = [...new Set(projectItems.flatMap(item => item.links.filter(link => link.type === 'thread').map(link => link.target)))]
  const revisions = [...new Set(projectItems.flatMap(item => item.links.filter(link => link.type === 'revision').map(link => link.target)))]
  const agents = project.actors.filter(actor => actor.startsWith('agent:'))
  const total = progressStatuses.reduce((sum, status) => sum + project.counts[status], 0)
  return (
    <div className="dshx:mx-auto dshx:flex dshx:w-full dshx:max-w-6xl dshx:flex-col dshx:gap-5 dshx:px-6 dshx:py-5">
      <header className="dshx:flex dshx:items-center dshx:gap-3">
        <button
          type="button"
          aria-label="All projects"
          onClick={props.back}
          className="dshx:rounded-md dshx:p-1.5 dshx:text-muted-foreground dshx:hover:bg-accent dshx:hover:text-foreground"
        >
          <ArrowLeftIcon className="dshx:size-4" />
        </button>
        <span className="dshx:inline-flex dshx:size-9 dshx:items-center dshx:justify-center dshx:rounded-lg dshx:border dshx:border-border dshx:bg-card">
          <FolderGit2Icon className="dshx:size-4 dshx:text-muted-foreground" />
        </span>
        <div className="dshx:min-w-0">
          <h2 className="dshx:text-lg dshx:font-semibold dshx:tracking-tight">
            <ProjectTitle projectKey={project.key} large />
          </h2>
          {project.key === NO_PROJECT ? null : <p className="dshx:truncate dshx:font-mono! dshx:text-[11px] dshx:text-muted-foreground">{project.key}</p>}
        </div>
        <span className="dshx:ml-auto">
          <ItemGlyphs.ActorStack actorIds={project.actors} max={5} />
        </span>
      </header>
      <div className="dshx:grid dshx:grid-cols-1 dshx:gap-4 dshx:@min-[56rem]:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-4">
          <Card
            title="Progress"
            action={
              <span className="dshx:text-xs dshx:text-muted-foreground">
                {project.counts.done} of {total} done
              </span>
            }
          >
            <div className="dshx:flex dshx:items-baseline dshx:gap-2">
              <span className="dshx:text-3xl dshx:font-semibold dshx:tabular-nums dshx:tracking-tight">{percentDone(project.counts)}%</span>
              {project.needsYou === 0 ? null : (
                <span className="dshx:rounded-md dshx:bg-warning/12 dshx:px-1.5 dshx:text-xs dshx:text-warning">{project.needsYou} need you</span>
              )}
            </div>
            <ProgressBar counts={project.counts} className="dshx:h-2" />
            <div className="dshx:flex dshx:flex-wrap dshx:gap-x-4 dshx:gap-y-1 dshx:text-xs dshx:text-muted-foreground">
              {progressStatuses.map(status => (
                <span key={status} className="dshx:flex dshx:items-center dshx:gap-1.5">
                  <ItemGlyphs.StatusIcon status={status} className="dshx:size-3" />
                  {ItemGlyphs.statusLabels[status]} <span className="dshx:text-foreground dshx:tabular-nums">{project.counts[status]}</span>
                </span>
              ))}
            </div>
          </Card>
          {needsYou.length === 0 ? null : (
            <Card title="Needs you">
              <ul className="dshx:-mx-2 dshx:flex dshx:flex-col">
                {needsYou.map(item => (
                  <ItemLine
                    key={item.id}
                    item={item}
                    select={props.select}
                    startThread={props.startThread}
                    projectPaths={props.projectPaths}
                    update={input => actions.update.mutate(input)}
                    triage={id => actions.triage.mutate(id)}
                  />
                ))}
              </ul>
            </Card>
          )}
          <Card title="Active work" action={<span className="dshx:text-xs dshx:text-muted-foreground">{active.length}</span>}>
            {active.length === 0 ? <p className="dshx:text-xs dshx:text-muted-foreground">Nothing open.</p> : null}
            <ul className="dshx:-mx-2 dshx:flex dshx:flex-col">
              {active.slice(0, 12).map(item => (
                <ItemLine
                  key={item.id}
                  item={item}
                  select={props.select}
                  startThread={props.startThread}
                  projectPaths={props.projectPaths}
                  update={input => actions.update.mutate(input)}
                  triage={id => actions.triage.mutate(id)}
                />
              ))}
            </ul>
          </Card>
        </div>
        <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-4">
          <Card title="Details">
            <dl className="dshx:grid dshx:grid-cols-[96px_minmax(0,1fr)] dshx:gap-y-2.5 dshx:text-[13px]">
              <dt className="dshx:text-muted-foreground">Items</dt>
              <dd className="dshx:tabular-nums">{progressStatuses.reduce((sum, status) => sum + project.counts[status], 0) + project.counts.dropped}</dd>
              <dt className="dshx:text-muted-foreground">Agents</dt>
              <dd>
                {agents.length === 0 ? <span className="dshx:text-muted-foreground">None yet</span> : <ItemGlyphs.ActorStack actorIds={agents} max={6} />}
              </dd>
              <dt className="dshx:flex dshx:items-center dshx:gap-1.5 dshx:text-muted-foreground">
                <MessagesSquareIcon className="dshx:size-3.5" /> Threads
              </dt>
              <dd className="dshx:tabular-nums">{threads.length}</dd>
              <dt className="dshx:flex dshx:items-center dshx:gap-1.5 dshx:text-muted-foreground">
                <GitCommitHorizontalIcon className="dshx:size-3.5" /> Revisions
              </dt>
              <dd className="dshx:flex dshx:flex-wrap dshx:gap-1">
                {revisions.length === 0 ? <span className="dshx:text-muted-foreground">None linked</span> : null}
                {revisions.slice(0, 6).map(revision => (
                  <span key={revision} className="dshx:rounded dshx:bg-muted dshx:px-1 dshx:font-mono! dshx:text-[11px]">
                    {revision.slice(0, 8)}
                  </span>
                ))}
              </dd>
              <dt className="dshx:text-muted-foreground">Last activity</dt>
              <dd>{ItemGlyphs.ago(project.lastActivityAt)} ago</dd>
            </dl>
          </Card>
          <Card title="Recent activity">
            <ol className="dshx:flex dshx:flex-col dshx:gap-3">
              {recent.map(item => (
                <BacklogItemMenu
                  key={item.id}
                  item={item}
                  projectPaths={props.projectPaths}
                  update={input => actions.update.mutate(input)}
                  triage={id => actions.triage.mutate(id)}
                  startThread={props.startThread}
                  openItem={props.select}
                >
                  <li aria-label={`Item b:${String(item.id)}`} className="dshx:flex dshx:gap-2.5 dshx:text-xs">
                    <ItemGlyphs.ActorAvatar actorId={item.activity.last?.actor} className="dshx:mt-0.5" />
                    <button
                      type="button"
                      onClick={() => props.select(item.id)}
                      className="dshx:min-w-0 dshx:flex-1 dshx:text-left dshx:text-muted-foreground dshx:hover:text-foreground"
                    >
                      <span className="dshx:font-medium dshx:text-foreground">{ItemGlyphs.actorName(item.activity.last?.actor)}</span>{' '}
                      {item.activity.last === null ? '' : ItemGlyphs.describeEvent(item.activity.last, item.attention)} ·{' '}
                      <span className="dshx:font-medium dshx:text-foreground">{item.title}</span>
                    </button>
                    <span className="dshx:shrink-0 dshx:text-[11px] dshx:text-muted-foreground">{ItemGlyphs.ago(item.lastActivityAt)}</span>
                  </li>
                </BacklogItemMenu>
              ))}
            </ol>
          </Card>
        </div>
      </div>
    </div>
  )
}

/** Projects come from where work was captured; nobody creates or administers them. */
export const ProjectsView = (props: {
  readonly selectedProject: string | null
  readonly setSelectedProject: (project: string | null) => void
  readonly select: (id: number) => void
  readonly now: number
  readonly startThread: (items: readonly StartThreadItem[]) => void
  readonly projectPaths: readonly string[]
}): JSX.Element => {
  const api = useApi(backlogApi)
  const query = useQuery({ queryKey: [BacklogQueries.key, 'projects'], queryFn: ({ signal }) => api.projects(undefined, { signal }) })
  const projects = useMemo(
    (): Project[] =>
      (query.data ?? [])
        .map(row => ({ key: row.project ?? NO_PROJECT, counts: row.counts, needsYou: row.needsYou, actors: row.actors, lastActivityAt: row.lastActivityAt }))
        .sort((left, right) => Number(left.key === NO_PROJECT) - Number(right.key === NO_PROJECT) || right.lastActivityAt - left.lastActivityAt),
    [query.data],
  )
  const selected = projects.find(project => project.key === props.selectedProject)
  return (
    <div className="dshx:@container dshx:min-h-0 dshx:flex-1 dshx:overflow-y-auto">
      {selected !== undefined ? (
        <Overview
          project={selected}
          back={() => props.setSelectedProject(null)}
          select={props.select}
          startThread={props.startThread}
          projectPaths={props.projectPaths}
        />
      ) : (
        <div className="dshx:mx-auto dshx:flex dshx:max-w-6xl dshx:flex-col dshx:gap-4 dshx:px-6 dshx:py-5">
          <div>
            <h2 className="dshx:text-lg dshx:font-semibold dshx:tracking-tight">Projects</h2>
            <p className="dshx:text-xs dshx:text-muted-foreground">Grouped from the repositories items were captured in. {projects.length} in total.</p>
          </div>
          <div className="dshx:grid dshx:grid-cols-1 dshx:gap-3 dshx:@min-[40rem]:grid-cols-2 dshx:@min-[64rem]:grid-cols-3">
            {projects.map(project => {
              const recent = props.now - project.lastActivityAt < 7 * DAY_MS
              return (
                <button
                  key={project.key}
                  type="button"
                  onClick={() => props.setSelectedProject(project.key)}
                  className="dshx:flex dshx:flex-col dshx:gap-3 dshx:rounded-xl dshx:border dshx:border-border dshx:bg-card dshx:p-4 dshx:text-left dshx:transition-[border-color,box-shadow,transform] dshx:duration-150 dshx:hover:-translate-y-px dshx:hover:border-input dshx:hover:shadow-md"
                >
                  <div className="dshx:flex dshx:items-start dshx:gap-3">
                    <span className="dshx:inline-flex dshx:size-8 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded-lg dshx:bg-muted">
                      <FolderGit2Icon className="dshx:size-4 dshx:text-muted-foreground" />
                    </span>
                    <div className="dshx:min-w-0 dshx:flex-1">
                      <p className="dshx:text-sm dshx:font-semibold">
                        <ProjectTitle projectKey={project.key} />
                      </p>
                      <p className="dshx:truncate dshx:font-mono! dshx:text-[11px] dshx:text-muted-foreground">
                        {project.key === NO_PROJECT ? 'Captured outside a repository' : project.key}
                      </p>
                    </div>
                    <span
                      className={cn(
                        'dshx:flex dshx:shrink-0 dshx:items-center dshx:gap-1 dshx:rounded-full dshx:px-1.5 dshx:text-[11px]',
                        recent ? 'dshx:bg-success/12 dshx:text-success' : 'dshx:bg-muted dshx:text-muted-foreground',
                      )}
                    >
                      <span aria-hidden className={cn('dshx:size-1.5 dshx:rounded-full', recent ? 'dshx:bg-success' : 'dshx:bg-muted-foreground')} />
                      {recent ? 'Active' : 'Quiet'}
                    </span>
                  </div>
                  <div className="dshx:flex dshx:flex-col dshx:gap-1.5">
                    <div className="dshx:flex dshx:items-center dshx:justify-between dshx:text-xs dshx:text-muted-foreground">
                      <span>
                        {project.counts.done} of {progressStatuses.reduce((sum, status) => sum + project.counts[status], 0)} done
                      </span>
                      <span className="dshx:tabular-nums">{percentDone(project.counts)}%</span>
                    </div>
                    <ProgressBar counts={project.counts} />
                  </div>
                  <div className="dshx:flex dshx:items-center dshx:gap-2 dshx:text-xs dshx:text-muted-foreground">
                    <ItemGlyphs.ActorStack actorIds={project.actors} max={4} />
                    {project.needsYou === 0 ? null : (
                      <span className="dshx:rounded-md dshx:bg-warning/12 dshx:px-1.5 dshx:text-warning">{project.needsYou} need you</span>
                    )}
                    <span className="dshx:ml-auto">{ItemGlyphs.ago(project.lastActivityAt)}</span>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
