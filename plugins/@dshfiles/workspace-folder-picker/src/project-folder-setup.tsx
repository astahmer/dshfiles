import { Alert, AlertDescription } from '@dshfiles/plugin-ui/components/ui/alert'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@dshfiles/plugin-ui/components/ui/dialog'
import { useContract } from '@dshfiles/dshx/client'
import { errorMessage, useMutation, useQuery } from '@dshfiles/plugin-ui/query'
import { useState } from 'react'
import type { FolderInspection, ProjectLifecycleClient } from './project-lifecycle-api.js'
import { RepositorySetup } from './repository-setup-contract.js'

const repositoryLine = (inspection: FolderInspection): string => {
  const root = inspection.repositoryRoot ?? inspection.path
  if (inspection.kind === 'none') return 'No repository'
  const kind = inspection.kind === 'git' ? 'Git checkout' : 'Jujutsu repository'
  const remote = inspection.remoteUrl === null ? '' : ` · ${inspection.remoteUrl}`
  return `${kind} · ${root}${remote}`
}

/**
 * The step between choosing a folder and adding it: says what the folder is, and offers the one action that makes the
 * composer's workspace and bookmark controls appear. It never initializes anything by itself.
 */
export const ProjectFolderSetup = (props: {
  readonly api: ProjectLifecycleClient
  readonly path: string
  readonly onAdded: (path: string) => void
  readonly onClose: () => void
}): JSX.Element => {
  const inspection = useQuery({
    queryKey: ['workspace-folder-picker', 'inspect', props.path],
    queryFn: () => props.api.inspect({ path: props.path }),
    retry: false,
  })
  const setup = useContract(RepositorySetup)
  const [error, setError] = useState<string | null>(null)
  const initialize = useMutation({
    mutationFn: () => props.api.initProject({ path: props.path }),
    onSuccess: project => props.onAdded(project.path),
    onError: cause => setError(errorMessage(cause, 'Could not initialize this folder.')),
  })
  const [enabling, setEnabling] = useState(false)
  const found = inspection.data

  const enableJujutsu = async (): Promise<void> => {
    if (setup.status !== 'active') return
    setEnabling(true)
    setError(null)
    try {
      await setup.value.enableJujutsu({ path: props.path })
      props.onAdded(props.path)
    } catch (cause) {
      setError(errorMessage(cause, 'Could not enable Jujutsu for this folder.'))
    } finally {
      setEnabling(false)
    }
  }

  const canEnable = found !== undefined && found.canEnableJujutsu && setup.status === 'active'
  const busy = enabling || initialize.isPending

  return (
    <Dialog open onOpenChange={(open: boolean) => (open ? undefined : props.onClose())}>
      <DialogContent className="dshx-root dshx:max-w-xl">
        <div className="dshx:flex dshx:flex-col dshx:gap-5">
          <DialogHeader>
            <DialogTitle>
              Add{' '}
              {props.path
                .split(/[/\\]/u)
                .filter(part => part.length > 0)
                .at(-1) ?? props.path}
            </DialogTitle>
            <DialogDescription className="dshx:sr-only">Choose how this folder joins the project list.</DialogDescription>
          </DialogHeader>
          <div aria-live="polite" className="dshx:flex dshx:flex-col dshx:gap-1">
            <span className="dshx:font-mono dshx:text-xs dshx:break-all">
              {repositoryLine(
                found ?? {
                  kind: 'none',
                  path: props.path,
                  repositoryRoot: null,
                  remoteUrl: null,
                  defaultBranch: null,
                  gitAbove: false,
                  brokenJjMetadata: false,
                  canEnableJujutsu: false,
                  reason: null,
                },
              )}
            </span>
            {found?.gitAbove === true && found.kind === 'git' && (
              <span className="dshx:text-xs dshx:text-muted-foreground">This folder sits inside that checkout; its threads work in the folder you chose.</span>
            )}
            {found?.reason !== null && found?.reason !== undefined && <span className="dshx:text-xs dshx:text-muted-foreground">{found.reason}</span>}
          </div>
          {found?.kind === 'none' && (
            <p className="dshx:text-sm dshx:text-muted-foreground">
              Nothing here is a repository yet. Initializing starts one in place: the files already in this folder stay, they become the first revision.
            </p>
          )}
          {error !== null && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {inspection.isError && (
            <Alert variant="destructive">
              <AlertDescription>{errorMessage(inspection.error, 'Could not read this folder.')}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button disabled={busy} onClick={props.onClose} type="button" variant="ghost">
              Cancel
            </Button>
            {found?.kind === 'none' ? (
              <>
                <Button disabled={busy} onClick={() => props.onAdded(props.path)} type="button" variant="outline">
                  Add without a repository
                </Button>
                <Button disabled={busy || found === undefined} onClick={() => initialize.mutate()} type="button">
                  {initialize.isPending ? 'Initializing…' : 'Initialize repository'}
                </Button>
              </>
            ) : (
              <>
                <Button disabled={busy || found === undefined} onClick={() => props.onAdded(props.path)} type="button" variant="outline">
                  Add project
                </Button>
                {canEnable && (
                  <Button disabled={busy} onClick={() => void enableJujutsu()} type="button">
                    {enabling ? 'Enabling…' : 'Enable Jujutsu and add'}
                  </Button>
                )}
              </>
            )}
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  )
}
