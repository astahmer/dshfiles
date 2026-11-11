import { useResource } from '@dshfiles/dshx/client'
import { useMemo } from 'react'
import { threadSidebarThreadDirectoriesApi } from './thread-directories-api.js'
import { type ThreadDirectories, WorkspacePaths } from './workspace-paths.js'

/**
 * Where the VCS providers put the listed projects' thread workspaces. Every caller on the page shares one read per
 * project set: the input is the sorted candidate paths, so registering a project asks again and a streaming list does not.
 */
export const useThreadDirectories = (workspaces: readonly { readonly path: string }[]): ThreadDirectories => {
  const pathsKey = useMemo(() => [...new Set(WorkspacePaths.projects({ rows: workspaces }).map(workspace => workspace.path))].sort().join('\n'), [workspaces])
  const input = useMemo(() => ({ projectPaths: pathsKey === '' ? [] : pathsKey.split('\n') }), [pathsKey])
  const reported = useResource(threadSidebarThreadDirectoriesApi, 'list', input, { enabled: pathsKey !== '' }).data?.directories
  return useMemo(() => WorkspacePaths.threadDirectoriesOf(reported ?? []), [reported])
}
