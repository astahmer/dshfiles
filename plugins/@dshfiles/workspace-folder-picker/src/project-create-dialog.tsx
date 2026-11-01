import { Alert, AlertDescription } from '@dshfiles/plugin-ui/components/ui/alert'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Checkbox } from '@dshfiles/plugin-ui/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@dshfiles/plugin-ui/components/ui/dialog'
import { errorMessage, useMutation } from '@dshfiles/plugin-ui/query'
import * as Schema from 'effect/Schema'
import { useState } from 'react'
import { projectFolderNameSchema, type ProjectLifecycleClient } from './project-lifecycle-api.js'
import { WorkspaceFolderPickerSchema, type FormFieldErrors } from './schema.js'
import { TextInput } from './text-input.js'

const createFormSchema = Schema.Struct({
  parentPath: WorkspaceFolderPickerSchema.trimmedText.check(
    Schema.makeFilter(value => (value.length > 0 ? true : 'Enter the folder to create the project in.')),
  ),
  name: projectFolderNameSchema,
  createGitHubRepository: Schema.Boolean,
})

type CreateForm = typeof createFormSchema.Type
const createFormFields: readonly (keyof FormFieldErrors)[] = ['parentPath', 'name']

export const ProjectCreateDialog = (props: {
  readonly api: ProjectLifecycleClient
  readonly home: string | undefined
  readonly gitHubAvailable: boolean
  readonly onCreated: (path: string) => void
  readonly onClose: () => void
}): JSX.Element => {
  const [form, setForm] = useState<CreateForm>({ parentPath: props.home ?? '~/', name: '', createGitHubRepository: false })
  const [errors, setErrors] = useState<FormFieldErrors>({})
  const create = useMutation({
    mutationFn: (input: CreateForm) => props.api.createProject(input),
    onSuccess: created => {
      if (created.warning === null) props.onCreated(created.path)
    },
  })
  const change = (patch: Partial<CreateForm>): void => {
    setForm(current => ({ ...current, ...patch }))
    setErrors({})
    create.reset()
  }
  const submit = (): void => {
    const parsed = WorkspaceFolderPickerSchema.validateForm(createFormSchema, form)
    if (parsed.ok) return create.mutate(parsed.value)
    setErrors(WorkspaceFolderPickerSchema.fieldMessages(parsed.issues, createFormFields))
  }
  const created = create.data

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
            <DialogTitle>New project</DialogTitle>
            <DialogDescription className="dshx:sr-only">
              Create a folder with a jj repository, a README and a first commit, and add it as a project.
            </DialogDescription>
          </DialogHeader>
          <div className="dshx:grid dshx:grid-cols-[2fr_1fr] dshx:gap-3">
            <TextInput
              error={errors.parentPath}
              id="create-parent-path"
              label="Parent folder"
              onChange={parentPath => change({ parentPath })}
              value={form.parentPath}
            />
            <TextInput
              error={errors.name}
              id="create-folder-name"
              label="Project name"
              onChange={name => change({ name })}
              placeholder="my-project"
              value={form.name}
            />
          </div>
          {props.gitHubAvailable && (
            <label className="dshx:flex dshx:items-center dshx:gap-2 dshx:text-sm">
              <Checkbox
                checked={form.createGitHubRepository}
                onCheckedChange={(checked: boolean | 'indeterminate') => change({ createGitHubRepository: checked === true })}
              />
              Create a private GitHub repository
            </label>
          )}
          {create.isError && (
            <Alert variant="destructive">
              <AlertDescription>{errorMessage(create.error, 'Could not create the project.')}</AlertDescription>
            </Alert>
          )}
          {created !== undefined && created.warning !== null && (
            <Alert variant="warning">
              <AlertDescription>{created.warning}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button onClick={props.onClose} type="button" variant="outline">
              Close
            </Button>
            {created !== undefined && created.warning !== null ? (
              <Button onClick={() => props.onCreated(created.path)} type="button">
                Open project
              </Button>
            ) : (
              <Button disabled={create.isPending} type="submit">
                {create.isPending ? 'Creating…' : 'Create'}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
