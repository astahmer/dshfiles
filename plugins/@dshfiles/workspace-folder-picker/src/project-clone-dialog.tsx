import { Alert, AlertDescription } from '@dshfiles/plugin-ui/components/ui/alert'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@dshfiles/plugin-ui/components/ui/dialog'
import { Progress } from '@dshfiles/plugin-ui/components/ui/progress'
import { errorMessage, useMutation, useQuery } from '@dshfiles/plugin-ui/query'
import { useEffect, useState } from 'react'
import { z } from 'zod'
import { TextInput } from './text-input.js'
import { localCloneUrlSchema, projectFolderNameSchema, type CloneJob, type ProjectLifecycleClient } from './project-lifecycle-api.js'

const cloneFormSchema = z.object({
  repositoryUrl: localCloneUrlSchema,
  parentPath: z.string().trim().min(1, 'Enter the folder to clone into.'),
  name: projectFolderNameSchema,
})

type CloneForm = z.input<typeof cloneFormSchema>
type CloneFormErrors = Partial<Record<keyof CloneForm, string>>

/** `https://host/owner/repo.git` → `repo`, so the folder name follows the URL until the user edits it. */
const folderNameFromUrl = (url: string): string =>
  url
    .trim()
    .split(/[/:]/u)
    .filter(part => part.length > 0)
    .at(-1)
    ?.replace(/\.git$/u, '') ?? ''

const formErrors = (error: z.ZodError): CloneFormErrors => {
  const errors: CloneFormErrors = {}
  for (const issue of error.issues) {
    const key = cloneFormSchema.keyof().safeParse(issue.path[0])
    if (key.success && errors[key.data] === undefined) errors[key.data] = issue.message
  }
  return errors
}

const phaseLabels: Record<CloneJob['phase'], string> = {
  cloning: 'Cloning',
  colocating: 'Setting up jj',
  registering: 'Adding the project',
  done: 'Done',
}

export const ProjectCloneDialog = (props: {
  readonly api: ProjectLifecycleClient
  readonly home: string | undefined
  readonly onCloned: (path: string) => void
  readonly onClose: () => void
}): JSX.Element => {
  const [form, setForm] = useState<CloneForm>({ repositoryUrl: '', parentPath: props.home ?? '~/', name: '' })
  const [nameEdited, setNameEdited] = useState(false)
  const [errors, setErrors] = useState<CloneFormErrors>({})
  const [jobId, setJobId] = useState<string | null>(null)
  const start = useMutation({
    mutationFn: (input: z.output<typeof cloneFormSchema>) => props.api.startClone(input),
    onSuccess: job => setJobId(job.id),
  })
  const jobs = useQuery({
    queryKey: ['workspace-folder-picker', 'clone-jobs'],
    queryFn: () => props.api.cloneJobs({}),
    enabled: jobId !== null,
    refetchInterval: query => (query.state.data?.jobs.find(job => job.id === jobId)?.state === 'running' ? 500 : false),
  })
  const job = jobs.data?.jobs.find(candidate => candidate.id === jobId) ?? start.data
  const cancel = useMutation({ mutationFn: (id: string) => props.api.cancelClone({ jobId: id, confirm: true }) })

  useEffect(() => {
    if (job?.state === 'succeeded') props.onCloned(job.path)
  }, [job?.state])

  const change = (patch: Partial<CloneForm>): void => {
    setForm(current => ({ ...current, ...patch }))
    setErrors({})
  }
  const submit = (): void => {
    const parsed = cloneFormSchema.safeParse(form)
    if (!parsed.success) return setErrors(formErrors(parsed.error))
    start.mutate(parsed.data)
  }

  const running = job?.state === 'running'
  const error = job?.state === 'failed' ? job.error : start.isError ? errorMessage(start.error, 'Could not start the clone.') : null

  return (
    <Dialog open onOpenChange={(open: boolean) => (open ? undefined : props.onClose())}>
      <DialogContent className="dshx-root dshx:max-w-xl">
        <form
          className="dshx:flex dshx:flex-col dshx:gap-5"
          noValidate
          onSubmit={event => {
            event.preventDefault()
            submit()
          }}
        >
          <DialogHeader>
            <DialogTitle>Clone repository</DialogTitle>
            <DialogDescription className="dshx:sr-only">Clone a Git repository into a new folder and add it as a project.</DialogDescription>
          </DialogHeader>
          <TextInput
            error={errors.repositoryUrl}
            id="clone-repository-url"
            label="Repository URL"
            onChange={repositoryUrl => change(nameEdited ? { repositoryUrl } : { repositoryUrl, name: folderNameFromUrl(repositoryUrl) })}
            placeholder="git@github.com:owner/repo.git"
            value={form.repositoryUrl}
          />
          <div className="dshx:grid dshx:grid-cols-[2fr_1fr] dshx:gap-3">
            <TextInput
              error={errors.parentPath}
              id="clone-parent-path"
              label="Parent folder"
              onChange={parentPath => change({ parentPath })}
              value={form.parentPath}
            />
            <TextInput
              error={errors.name}
              id="clone-folder-name"
              label="Folder name"
              onChange={name => {
                setNameEdited(true)
                change({ name })
              }}
              value={form.name}
            />
          </div>
          {job !== undefined && job.state !== 'failed' && (
            <div aria-live="polite" className="dshx:flex dshx:flex-col dshx:gap-2">
              <div className="dshx:flex dshx:items-center dshx:justify-between dshx:gap-2 dshx:text-sm">
                <span>{job.state === 'cancelled' ? 'Cancelled' : phaseLabels[job.phase]}</span>
                <span className="dshx:min-w-0 dshx:truncate dshx:font-mono dshx:text-xs dshx:text-muted-foreground">{job.progress.message}</span>
              </div>
              <Progress value={job.progress.percent ?? 0} />
            </div>
          )}
          {error !== null && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            {running ? (
              <Button disabled={cancel.isPending} onClick={() => cancel.mutate(job.id)} type="button" variant="outline">
                Cancel clone
              </Button>
            ) : (
              <Button onClick={props.onClose} type="button" variant="outline">
                Close
              </Button>
            )}
            <Button disabled={running || start.isPending} type="submit">
              {job?.state === 'failed' || job?.state === 'cancelled' ? 'Try again' : 'Clone'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
