import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@dshfiles/plugin-ui/components/ui/dialog'
import { Input } from '@dshfiles/plugin-ui/components/ui/input'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Alert, AlertDescription } from '@dshfiles/plugin-ui/components/ui/alert'
import { useMutation, useQueryClient } from '@dshfiles/plugin-ui/query'
import { useState } from 'react'
import type { RuntimeSummary } from '../api.js'
import { multiHostKeys, type MultiHostClient } from './queries.js'

export const CloneProjectDialog = (props: {
  readonly api: MultiHostClient
  readonly runtime: RuntimeSummary | undefined
  readonly hostName: string | undefined
  readonly onClose: () => void
}) => {
  const queryClient = useQueryClient()
  const [repositoryUrl, setRepositoryUrl] = useState('')
  const [destinationPath, setDestinationPath] = useState('')
  const clone = useMutation({
    mutationFn: async () => {
      if (props.runtime === undefined) throw new Error('This host has no remote runtime.')
      const result = await props.api.runtimeCloneProject({
        runtimeId: props.runtime.id,
        repositoryUrl,
        destinationPath: clonePath,
      })
      if (!result.ok) throw new Error(result.message)
      return result
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: multiHostKeys.all })
      props.onClose()
    },
  })
  const repositoryName = repositoryUrl
    .trim()
    .split(/[/:]/u)
    .at(-1)
    ?.replace(/\.git$/u, '')
  const suggestedPath = `~/${repositoryName || 'project'}`
  const clonePath = destinationPath.trim() || suggestedPath
  const disabled = clone.isPending || repositoryUrl.trim().length === 0

  return (
    <Dialog open={props.runtime !== undefined} onOpenChange={open => (open ? undefined : props.onClose())}>
      <DialogContent className="dshx:max-w-xl">
        <form
          className="dshx:flex dshx:flex-col dshx:gap-5"
          onSubmit={event => {
            event.preventDefault()
            clone.mutate()
          }}
        >
          <DialogHeader>
            <DialogTitle>Clone project{props.hostName === undefined ? '' : ` to ${props.hostName}`}</DialogTitle>
            <DialogDescription>
              Clone a Git repository onto this machine and add it to its projects. Local ignored and uncommitted files are not copied.
            </DialogDescription>
          </DialogHeader>
          <label className="dshx:flex dshx:flex-col dshx:gap-2 dshx:text-sm">
            Git repository URL
            <Input autoFocus value={repositoryUrl} onChange={event => setRepositoryUrl(event.target.value)} placeholder="git@github.com:owner/repo.git" />
          </label>
          <label className="dshx:flex dshx:flex-col dshx:gap-2 dshx:text-sm">
            Folder on {props.hostName ?? 'remote host'}
            <Input value={destinationPath} onChange={event => setDestinationPath(event.target.value)} placeholder={suggestedPath} />
          </label>
          {clone.isError ? (
            <Alert variant="destructive">
              <AlertDescription>{clone.error.message}</AlertDescription>
            </Alert>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={props.onClose}>
              Cancel
            </Button>
            <Button disabled={disabled} type="submit">
              {clone.isPending ? 'Cloning…' : 'Clone project'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
