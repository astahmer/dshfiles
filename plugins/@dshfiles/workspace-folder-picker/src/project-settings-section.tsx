import { useApi, useRegistry } from '@dshfiles/dshx/client'
import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Label } from '@dshfiles/plugin-ui/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@dshfiles/plugin-ui/components/ui/radio-group'
import { useCopyFeedback } from '@dshfiles/plugin-ui/hooks/copy-feedback'
import { errorMessage, useQuery } from '@dshfiles/plugin-ui/query'
import { useState } from 'react'
import { projectLifecycleApi, type LoadedProjectConfigOutput } from './project-lifecycle-api.js'
import { projectCheckSnippet, projectSettingRows } from './project-settings.js'
import { ProjectSettingsPanels, type ProjectSettingsPanelProps } from './project-settings-panels.js'

const projectsKey = ['workspace-folder-picker', 'projects'] as const

const projectConfigKey = (path: string) => ['workspace-folder-picker', 'project-config', path] as const

const CopyEntry = (props: { readonly yaml: string; readonly name: string; readonly disabled: boolean }): JSX.Element => {
  const { copied, copy } = useCopyFeedback()
  return (
    <Button type="button" size="sm" variant="outline" disabled={props.disabled} onClick={() => void copy(props.yaml)}>
      {copied ? 'Copied' : 'Copy entry'}
      <span className="dshx:sr-only"> for {props.name}</span>
    </Button>
  )
}

const SettingList = (props: { readonly config: LoadedProjectConfigOutput }): JSX.Element => (
  <dl className="dshx:m-0 dshx:grid dshx:grid-cols-[minmax(0,12rem)_minmax(0,1fr)] dshx:gap-x-4 dshx:gap-y-2 dshx:text-sm">
    {projectSettingRows(props.config.config).map(row => (
      <div
        key={row.key}
        className="dshx:col-span-2 dshx:grid dshx:grid-cols-subgrid dshx:items-baseline dshx:gap-x-4 dshx:border-t dshx:border-border dshx:py-2 dshx:first:border-t-0"
      >
        <dt className="dshx:flex dshx:min-w-0 dshx:flex-wrap dshx:items-center dshx:gap-2 dshx:font-medium">
          {row.label}
          <Badge variant={row.tier === 'file' ? 'secondary' : 'muted'}>{row.tierLabel}</Badge>
        </dt>
        <dd className="dshx:m-0 dshx:min-w-0">
          {row.declared === null ? (
            <span className="dshx:text-muted-foreground">{row.fallback}</span>
          ) : (
            <span className="dshx:break-words">{row.declared}</span>
          )}
          {row.overriddenBy === null ? null : <p className="dshx:m-0 dshx:text-xs dshx:text-muted-foreground">{row.overriddenBy}</p>}
        </dd>
      </div>
    ))}
  </dl>
)

const SuggestedScripts = (props: { readonly config: LoadedProjectConfigOutput }): JSX.Element | null => {
  const scripts = props.config.config?.scripts
  if (scripts === undefined || scripts.length === 0) return null
  const root = props.config.path
  return (
    <section aria-label="Suggested scripts" className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-3 dshx:rounded-xl dshx:border dshx:border-border dshx:p-4">
      <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-1">
        <h3 className="dshx:m-0 dshx:text-sm dshx:font-medium">Suggested scripts</h3>
        <p className="dshx:m-0 dshx:text-xs dshx:text-muted-foreground">
          Nothing is imported automatically. Each button copies the trusted project-checks entry for that script, which an operator adds to the profile's
          actions row; the file itself never runs a command.
        </p>
      </div>
      {scripts.map(script => {
        const snippet = projectCheckSnippet({ root, script })
        return (
          <div
            key={script.name}
            className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-2 dshx:border-t dshx:border-border dshx:pt-3 dshx:first:border-t-0 dshx:first:pt-0"
          >
            <div className="dshx:flex dshx:min-w-0 dshx:items-start dshx:justify-between dshx:gap-3">
              <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-0.5">
                <span className="dshx:truncate dshx:text-sm dshx:font-medium">{script.name}</span>
                <code className="dshx:break-all dshx:text-xs dshx:text-muted-foreground">{script.command}</code>
                {script.hint === undefined ? null : <span className="dshx:text-xs dshx:text-muted-foreground">{script.hint}</span>}
              </div>
              <CopyEntry disabled={snippet.problem !== null} name={script.name} yaml={snippet.yaml} />
            </div>
            {snippet.problem === null ? null : (
              <p role="alert" className="dshx:m-0 dshx:text-xs dshx:text-destructive">
                {snippet.problem} Fix the command in dsh.project.json, then reopen this section.
              </p>
            )}
          </div>
        )
      })}
    </section>
  )
}

const ProjectConfigDetail = (props: { readonly path: string }): JSX.Element => {
  const api = useApi(projectLifecycleApi)
  const query = useQuery({
    queryKey: projectConfigKey(props.path),
    retry: false,
    queryFn: ({ signal }) => api.readProjectConfig({ path: props.path }, { signal }),
  })
  if (query.isPending) {
    return (
      <p role="status" className="dshx:m-0 dshx:text-sm dshx:text-muted-foreground">
        Reading dsh.project.json…
      </p>
    )
  }
  if (query.isError) {
    return (
      <div role="alert" className="dshx:flex dshx:flex-col dshx:items-start dshx:gap-2 dshx:text-sm dshx:text-muted-foreground">
        <p className="dshx:m-0">
          {errorMessage(query.error, 'The Host did not read this project folder. Retry, and restart DSH if the plugin was just installed.')}
        </p>
        <Button type="button" size="sm" variant="outline" onClick={() => void query.refetch()}>
          Retry
        </Button>
      </div>
    )
  }
  const loaded = query.data
  return (
    <section aria-label="Declared project settings" className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-3">
      <code className="dshx:break-all dshx:text-xs dshx:text-muted-foreground">{loaded.file}</code>
      {loaded.invalid === null ? null : (
        <p role="alert" className="dshx:m-0 dshx:text-sm dshx:text-destructive">
          {loaded.invalid} Fix the JSON against the published schema; the file changes nothing until it is valid.
        </p>
      )}
      <SettingList config={loaded} />
      <SuggestedScripts config={loaded} />
    </section>
  )
}

/** Settings other plugins keep for this project (its main branch), above what the repository file declares. */
const ProvidedPanels = (props: ProjectSettingsPanelProps): JSX.Element | null => {
  const panels = [...useRegistry(ProjectSettingsPanels)].sort((left, right) => (left.order ?? 0) - (right.order ?? 0))
  if (panels.length === 0) return null
  return (
    <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-3">
      {panels.map(panel => (
        <panel.Panel key={panel.id} {...props} />
      ))}
    </div>
  )
}

const ProjectChoice = (props: { readonly project: { readonly workspaceId: string; readonly title: string; readonly path: string } }): JSX.Element => {
  const choiceId = `project-${props.project.workspaceId}`
  return (
    <div className="dshx:flex dshx:min-w-0 dshx:items-start dshx:gap-3 dshx:rounded-lg dshx:px-2 dshx:py-1.5 dshx:hover:bg-accent">
      <RadioGroupItem className="dshx:mt-0.5" id={choiceId} value={props.project.workspaceId} />
      <Label className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-col dshx:items-start dshx:gap-0.5 dshx:font-normal" htmlFor={choiceId}>
        <span className="dshx:max-w-full dshx:truncate dshx:text-sm dshx:font-medium">{props.project.title}</span>
        <span className="dshx:max-w-full dshx:truncate dshx:text-xs dshx:text-muted-foreground">{props.project.path}</span>
      </Label>
    </div>
  )
}

export const ProjectSettingsSection = (): JSX.Element => {
  const api = useApi(projectLifecycleApi)
  const [chosen, setChosen] = useState<string | null>(null)
  const query = useQuery({ queryKey: projectsKey, queryFn: () => api.projects({}), retry: false })
  if (query.isPending) {
    return (
      <section className="dshx-root dshx:@container dshx:flex dshx:min-w-0 dshx:max-w-2xl dshx:flex-col dshx:gap-4">
        <h2 className="dshx:m-0 dshx:text-lg dshx:font-semibold">Projects</h2>
        <p role="status" className="dshx:m-0 dshx:text-sm dshx:text-muted-foreground">
          Loading projects…
        </p>
      </section>
    )
  }
  if (query.isError) {
    return (
      <section className="dshx-root dshx:@container dshx:flex dshx:min-w-0 dshx:max-w-2xl dshx:flex-col dshx:gap-4">
        <h2 className="dshx:m-0 dshx:text-lg dshx:font-semibold">Projects</h2>
        <div role="alert" className="dshx:flex dshx:flex-col dshx:items-start dshx:gap-2 dshx:text-sm dshx:text-muted-foreground">
          <p className="dshx:m-0">
            {errorMessage(query.error, 'The Host did not list your projects. Restart DSH if the workspace plugin was just installed, then retry.')}
          </p>
          <Button type="button" size="sm" variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}>
            Retry
          </Button>
        </div>
      </section>
    )
  }
  const projects = query.data.projects
  const selected = projects.find(project => project.workspaceId === chosen) ?? projects[0]
  return (
    <section className="dshx-root dshx:@container dshx:flex dshx:min-w-0 dshx:max-w-2xl dshx:flex-col dshx:gap-4">
      <h2 className="dshx:m-0 dshx:text-lg dshx:font-semibold">Projects</h2>
      <p className="dshx:m-0 dshx:text-sm dshx:text-muted-foreground">
        Choose per-project settings, and see the values a repository declares in dsh.project.json with the tier that wins for each key. Nothing in that file
        runs.
      </p>
      {projects.length === 0 ? (
        <p role="status" className="dshx:m-0 dshx:text-sm dshx:text-muted-foreground">
          No registered projects yet. Add a folder from the workspace picker, then reopen Settings.
        </p>
      ) : (
        <RadioGroup
          aria-label="Projects"
          className="dshx:max-h-64 dshx:gap-0.5 dshx:overflow-y-auto"
          value={selected?.workspaceId ?? ''}
          onValueChange={(workspaceId: string) => setChosen(workspaceId)}
        >
          {projects.map(project => (
            <ProjectChoice key={project.workspaceId} project={project} />
          ))}
        </RadioGroup>
      )}
      {selected === undefined ? null : (
        <ProvidedPanels key={`panels-${selected.path}`} workspaceId={selected.workspaceId} name={selected.title} path={selected.path} />
      )}
      {selected === undefined ? null : <ProjectConfigDetail key={selected.path} path={selected.path} />}
    </section>
  )
}
