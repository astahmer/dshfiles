import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Checkbox } from '@dshfiles/plugin-ui/components/ui/checkbox'
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@dshfiles/plugin-ui/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@dshfiles/plugin-ui/components/ui/popover'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { CheckIcon, FolderIcon, GitBranchIcon } from '@dshfiles/plugin-ui/icons'
import { useQuery } from '@dshfiles/plugin-ui/query'
import { ProjectFolderPicker, type RegisteredProject } from '@dshfiles/project-folder-picker'
import {
  multiHostKeys,
  multiHostQueries,
  remoteDirectoryPicker,
  setHostDestination,
  type HostDestination,
  type MultiHostClient,
} from '@dshfiles/multi-host/destination'
import { useState } from 'react'
import { z } from 'zod'
import type { DestinationView } from './api.js'
import type { JjIntegrationTranslate } from './locales.js'

type RuntimeDestination = Extract<HostDestination, { kind: 'runtime' }>

const remoteProjectsSchema = z.object({ projects: z.array(z.object({ workspaceId: z.string(), title: z.string(), path: z.string() })) })
const remoteWorkspaceClassificationSchema = z.object({ jjWorkspaceIds: z.array(z.string()) }).strict()
const remoteDestinationSchema = z.object({
  vcs: z.enum(['jj', 'none']),
  bookmark: z.string().nullable(),
  bookmarks: z.array(z.string()),
  isolateByDefault: z.boolean(),
}) satisfies z.ZodType<Pick<DestinationView, 'vcs' | 'bookmark' | 'bookmarks' | 'isolateByDefault'>>
const provisionedSchema = z.object({ workspaceId: z.string(), isolated: z.boolean() })

const chipClassName = 'dshx:h-7 dshx:gap-1.5 dshx:px-2 dshx:text-sm dshx:font-medium'
const baseName = (path: string): string => path.split('/').filter(Boolean).at(-1) ?? path

/** The host's jj view of the chosen folder, through the host's own jj-integration; null when the host has none. */
const useRemoteJj = (api: MultiHostClient, destination: RuntimeDestination) =>
  useQuery({
    queryKey: ['jj-integration', 'remote-destination', destination.runtimeId, destination.folder ?? ''],
    enabled: destination.folder !== undefined,
    retry: false,
    queryFn: async ({ signal }) => {
      const opened = await api.runtimeOpenFolder({ runtimeId: destination.runtimeId, path: destination.folder ?? '' }, { signal })
      if (!opened.ok) return null
      const described = await api.runtimePluginCall(
        { runtimeId: destination.runtimeId, method: 'destination', input: { workspaceId: opened.workspaceId } },
        { signal },
      )
      if (!described.ok) return null
      const parsed = remoteDestinationSchema.safeParse(described.value)
      return parsed.success ? { ...parsed.data, workspaceId: opened.workspaceId, path: opened.path } : null
    },
  })

/**
 * Folder, bookmark and isolation for a thread that starts on another host. The host's own jj-integration answers;
 * a host without it (or without jj) gets a folder only.
 */
export const RemoteDestinationChips = (props: {
  readonly api: MultiHostClient
  readonly destination: RuntimeDestination
  readonly hostName: string
  readonly pickerOpen: boolean
  readonly onPickerOpenChange: (open: boolean) => void
  readonly t: JjIntegrationTranslate
}) => {
  const { api, destination, t } = props
  const [branchOpen, setBranchOpen] = useState(false)
  const jj = useRemoteJj(api, destination)
  const status = useQuery({ ...multiHostQueries.status(api, destination.runtimeId, false), enabled: props.pickerOpen })
  const remoteProjects = useQuery({
    queryKey: ['jj-integration', 'remote-projects', destination.runtimeId],
    enabled: props.pickerOpen,
    retry: false,
    queryFn: async ({ signal }) => {
      const result = await api.runtimePluginCall({ runtimeId: destination.runtimeId, method: 'projects', input: {} }, { signal })
      return result.ok ? remoteProjectsSchema.safeParse(result.value).data?.projects : undefined
    },
  })
  const remoteWorkspaceIds = (status.data?.ok === true ? status.data.workspaces : []).map(workspace => workspace.workspaceId).sort()
  const remoteWorkspaceClassification = useQuery({
    queryKey: ['jj-integration', 'remote-workspace-classification', destination.runtimeId, remoteWorkspaceIds],
    enabled: props.pickerOpen && remoteWorkspaceIds.length > 0 && (remoteProjects.data === undefined || remoteProjects.data.length === 0),
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: async ({ signal }) => {
      try {
        const result = await api.runtimePluginCall(
          { runtimeId: destination.runtimeId, method: 'classifyWorkspaces', input: { workspaceIds: remoteWorkspaceIds } },
          { signal },
        )
        if (!result.ok) {
          signal.throwIfAborted()
          return []
        }
        const parsed = remoteWorkspaceClassificationSchema.safeParse(result.value)
        return parsed.success ? parsed.data.jjWorkspaceIds : []
      } catch (error) {
        if (signal.aborted) throw error
        return []
      }
    },
  })
  const threads = useQuery({ queryKey: multiHostKeys.threads, enabled: props.pickerOpen, queryFn: ({ signal }) => api.threadList(undefined, { signal }) })
  // The host's jj-integration knows its projects; without it, the host's registered workspaces stand in.
  const classifiedWorkspaceIds = new Set(remoteWorkspaceClassification.data ?? [])
  const projects: RegisteredProject[] =
    remoteProjects.data !== undefined && remoteProjects.data.length > 0
      ? remoteProjects.data.map(project => ({ workspaceId: project.workspaceId, title: project.title, canonicalPath: project.path }))
      : status.data?.ok === true
        ? status.data.workspaces.map(workspace => ({
            workspaceId: workspace.workspaceId,
            title: workspace.title,
            canonicalPath: workspace.path,
            isJjWorkspace: classifiedWorkspaceIds.has(workspace.workspaceId),
          }))
        : []
  const recentFolders = [
    ...new Set(
      [...(threads.data?.threads ?? [])]
        .reverse()
        .filter(thread => thread.runtimeId === destination.runtimeId)
        .map(thread => thread.cwd),
    ),
  ].filter(path => !projects.some(project => project.canonicalPath === path))
  const update = (next: Partial<RuntimeDestination>): void => setHostDestination({ ...destination, ...next })
  const remote = jj.data ?? null
  const isolated = destination.isolate ?? remote?.isolateByDefault ?? false
  const bookmark = destination.base ?? remote?.bookmark ?? null

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" className={chipClassName} onClick={() => props.onPickerOpenChange(true)} data-remote-folder="">
            <FolderIcon className="dshx:size-3.5" />
            {destination.folder === undefined ? t('chooseProject') : baseName(destination.folder)}
          </Button>
        </TooltipTrigger>
        <TooltipContent className="dshx:max-w-96">{destination.folder ?? t('chooseProject')}</TooltipContent>
      </Tooltip>
      {jj.isFetching ? <Spinner className="dshx:size-3.5" /> : null}
      {remote?.vcs === 'jj' ? (
        <span className="dshx:inline-flex dshx:items-center dshx:rounded-md">
          <Popover open={branchOpen} onOpenChange={setBranchOpen}>
            <Tooltip>
              <TooltipTrigger asChild>
                <PopoverTrigger asChild>
                  <Button variant="ghost" className={chipClassName}>
                    <GitBranchIcon className="dshx:size-3.5" />
                    {bookmark ?? '—'}
                  </Button>
                </PopoverTrigger>
              </TooltipTrigger>
              <TooltipContent>{t('bookmarkIsolates')}</TooltipContent>
            </Tooltip>
            <PopoverContent align="start" className="dshx:w-72 dshx:p-0">
              <Command>
                <CommandInput placeholder={t('searchBookmarks')} />
                <CommandList>
                  <CommandEmpty>{t('noBookmarks')}</CommandEmpty>
                  {remote.bookmarks.map(name => (
                    <CommandItem
                      key={name}
                      value={name}
                      onSelect={() => {
                        setBranchOpen(false)
                        update({ base: name, isolate: true })
                      }}
                    >
                      <span className="dshx:flex-1 dshx:truncate">{name}</span>
                      {name === bookmark ? <CheckIcon className="dshx:size-3.5" /> : null}
                    </CommandItem>
                  ))}
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
          <Tooltip>
            <TooltipTrigger asChild>
              <label className="dshx:flex dshx:cursor-pointer dshx:items-center dshx:gap-1.5 dshx:border-l dshx:px-2 dshx:text-sm">
                <Checkbox checked={isolated} onCheckedChange={checked => update({ isolate: checked === true })} />
                {t('workspace')}
              </label>
            </TooltipTrigger>
            <TooltipContent>{t('isolateHint')}</TooltipContent>
          </Tooltip>
        </span>
      ) : null}
      {props.pickerOpen ? (
        <ProjectFolderPicker
          projects={projects}
          directoryPicker={remoteDirectoryPicker(api, destination.runtimeId)}
          onRegisterWorkspace={async canonicalPath => ({ workspaceId: `folder:${canonicalPath}`, title: baseName(canonicalPath), canonicalPath })}
          onSelect={selection => {
            setHostDestination({ kind: 'runtime', runtimeId: destination.runtimeId, folder: selection.canonicalPath })
            props.onPickerOpenChange(false)
          }}
          onClose={() => props.onPickerOpenChange(false)}
          showNativePicker={false}
          recentFolders={recentFolders}
          machineName={props.hostName}
          heading={`${t('chooseProject')} · ${props.hostName}`}
        />
      ) : null}
    </TooltipProvider>
  )
}

/** The folder the thread starts in on the host: a fresh isolated jj workspace when asked for, else the folder itself. */
export const prepareRemoteFolder = async (api: MultiHostClient, destination: RuntimeDestination): Promise<string> => {
  if (destination.folder === undefined) throw new Error('Choose a folder on this host first.')
  if (destination.isolate !== true && destination.base === undefined) return destination.folder
  const opened = await api.runtimeOpenFolder({ runtimeId: destination.runtimeId, path: destination.folder })
  if (!opened.ok) throw new Error(opened.message)
  const provisioned = await api.runtimePluginCall({
    runtimeId: destination.runtimeId,
    method: 'provision',
    input: { workspaceId: opened.workspaceId, isolate: destination.isolate ?? true, ...(destination.base !== undefined && { base: destination.base }) },
  })
  if (!provisioned.ok) throw new Error(`${provisioned.message} (${provisioned.code})`)
  const workspaceId = provisionedSchema.parse(provisioned.value).workspaceId
  const status = await api.runtimeStatus({ runtimeId: destination.runtimeId })
  const path = status.ok ? status.workspaces.find(workspace => workspace.workspaceId === workspaceId)?.path : undefined
  if (path === undefined) throw new Error('The host created the thread workspace but did not report its folder.')
  return path
}
