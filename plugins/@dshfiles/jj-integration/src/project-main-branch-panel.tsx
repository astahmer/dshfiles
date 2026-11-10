import { useApi } from '@dshfiles/dshx/client'
import type { ProjectSettingsPanelProps } from '@dshfiles/workspace-folder-picker/project-settings-panels'
import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Combobox, type ComboboxOption } from '@dshfiles/plugin-ui/components/ui/combobox'
import { runHostRequest } from '@dshfiles/plugin-ui/lib/host-request'
import { errorMessage, useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { jjIntegrationApi, type ProjectBookmarkView } from './api.js'
import { ProjectBookmarkQuery } from './project-bookmark-query.js'
import { RepositoryBookmarks, type ProjectBookmarkSource } from './settings.js'

/** The Combobox value of “no choice of its own”: `usableName` refuses a name with a space, so no bookmark can take it. */
const AUTOMATIC = ' automatic'

/**
 * The jj-integration reads that name the main branch or compare against it; the Host drops its own cached views when
 * the setting changes. Other plugins refresh through `ProjectBookmarkQuery.announceChange`.
 */
const mainBranchReadKeys = [
  ProjectBookmarkQuery.root,
  ['jj-integration', 'repositories'],
  ['jj-integration', 'thread'],
  ['jj-integration', 'destination'],
  ['jj-integration', 'revision-graph'],
] as const

/** What the project resolves to with `override`, from the layers the Host already reported: what Automatic would pick. */
const withOverride = (resolved: ProjectBookmarkView, override: string | null): ProjectBookmarkView => ({
  ...resolved,
  ...RepositoryBookmarks.resolve({ override, declared: resolved.declared, detected: resolved.detected, fallback: resolved.fallback }),
  override,
})

const sourceLabels = {
  project: 'Chosen here',
  file: 'dsh.project.json',
  detected: 'Origin’s default branch',
  global: 'Global Bookmark setting',
} satisfies Record<ProjectBookmarkSource, string>

/** Settings › Projects: the bookmark this project's threads start from and land on, and views compare against. */
export const ProjectMainBranchPanel = (props: ProjectSettingsPanelProps): JSX.Element => {
  const api = useApi(jjIntegrationApi)
  const queryClient = useQueryClient()
  const query = useQuery({ ...ProjectBookmarkQuery.options({ api, path: props.path }), staleTime: 0 })
  // The Host writes the choice against the settings revision it read, so two windows or an agent saving at once keep both.
  const save = useMutation({
    mutationFn: (bookmark: string | null) =>
      runHostRequest({ timeoutMs: 30_000, request: signal => api.setProjectBookmark({ path: props.path, bookmark }, { signal }) }),
    onSuccess: async next => {
      queryClient.setQueryData(ProjectBookmarkQuery.key(props.path), next)
      ProjectBookmarkQuery.announceChange()
      await Promise.all(mainBranchReadKeys.map(queryKey => queryClient.invalidateQueries({ queryKey })))
    },
  })

  const heading = (
    <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-1">
      <h3 className="dshx:m-0 dshx:text-sm dshx:font-medium">Main branch</h3>
      <p className="dshx:m-0 dshx:text-xs dshx:text-muted-foreground">
        New thread workspaces start from it, Land advances it, and source control and Changes compare against it.
      </p>
    </div>
  )
  const frame = (body: JSX.Element): JSX.Element => (
    <section aria-label="Main branch" className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-3 dshx:rounded-xl dshx:border dshx:border-border dshx:p-4">
      {heading}
      {body}
    </section>
  )

  if (query.isPending)
    return frame(
      <p role="status" className="dshx:m-0 dshx:text-sm dshx:text-muted-foreground">
        Reading the repository…
      </p>,
    )
  if (query.isError)
    return frame(
      <div role="alert" className="dshx:flex dshx:flex-col dshx:items-start dshx:gap-2 dshx:text-sm dshx:text-muted-foreground">
        <p className="dshx:m-0">
          {errorMessage(
            query.error,
            'The Host could not read this project’s main branch. Check that the folder is a jj or git repository; after updating DSH, restart it to load this setting.',
          )}
        </p>
        <Button type="button" size="sm" variant="outline" onClick={() => void query.refetch()}>
          Retry
        </Button>
      </div>,
    )

  const resolved = query.data
  const automatic = withOverride(resolved, null)
  const options: readonly ComboboxOption[] = [
    { value: AUTOMATIC, label: `Automatic (${automatic.bookmark})`, description: sourceLabels[automatic.source] },
    ...[...new Set([...resolved.bookmarks, ...(resolved.override === null ? [] : [resolved.override])])]
      .filter(name => !name.startsWith('dsh/'))
      .sort()
      .map(name => ({ value: name, label: name, group: 'Bookmarks' })),
  ]

  const choose = (value: string): void => save.mutate(value === AUTOMATIC ? null : RepositoryBookmarks.usableName(value))

  return frame(
    <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-2">
      <div className="dshx:flex dshx:min-w-0 dshx:flex-wrap dshx:items-center dshx:gap-2">
        <Combobox
          label={`Main branch of ${props.name}`}
          matchTriggerWidth
          searchAbove={8}
          options={options}
          value={resolved.override ?? AUTOMATIC}
          disabled={save.isPending}
          onValueChange={choose}
        />
        <span className="dshx:text-sm">
          Using <code>{resolved.bookmark}</code>
        </span>
        <Badge variant={resolved.source === 'project' ? 'secondary' : 'muted'}>{sourceLabels[resolved.source]}</Badge>
      </div>
      {resolved.override !== null && !resolved.bookmarks.includes(resolved.override) ? (
        <p role="alert" className="dshx:m-0 dshx:text-xs dshx:text-warning">
          No local bookmark {resolved.override} exists. Fetch it or create it, or pick another branch; new threads cannot start until it exists.
        </p>
      ) : null}
      {save.isError ? (
        <p role="alert" className="dshx:m-0 dshx:text-xs dshx:text-destructive">
          {errorMessage(save.error, 'The main branch was not saved. Pick it again to retry; if it keeps failing, check the Host log.')}
        </p>
      ) : null}
    </div>,
  )
}
