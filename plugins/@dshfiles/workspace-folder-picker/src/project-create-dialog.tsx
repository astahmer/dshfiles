import { Alert, AlertDescription } from '@dshfiles/plugin-ui/components/ui/alert'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Checkbox } from '@dshfiles/plugin-ui/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@dshfiles/plugin-ui/components/ui/dialog'
import { errorMessage, useMutation } from '@dshfiles/plugin-ui/query'
import * as Schema from 'effect/Schema'
import { useState } from 'react'
import { projectFolderNameSchema, type ProjectLifecycleClient } from './project-lifecycle-api.js'
import { initialProjectParent } from './project-defaults.js'
import { defaultProjectTone } from './project-tone.js'
import { ProjectTonePicker } from './project-tone-picker.js'
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
  /** Remembered parent folder from the picker settings; absent means the Host home. */
  readonly defaultParent?: string | undefined
  /** Remember the parent field as the default for the next project. */
  readonly onRememberParent?: ((parent: string) => void) | undefined
  readonly onCreated: (path: string, tone: number) => void
  readonly onClose: () => void
}): JSX.Element => {
  const [form, setForm] = useState<CreateForm>({ parentPath: initialProjectParent({ defaultParent: props.defaultParent, home: props.home }), name: '', createGitHubRepository: false })
  const [chosenTone, setChosenTone] = useState<number | null>(null)
  const [remembered, setRemembered] = useState(false)
  const [errors, setErrors] = useState<FormFieldErrors>({})
  const tone = chosenTone ?? defaultProjectTone(form.name)
  const create = useMutation({
    mutationFn: (input: CreateForm) => props.api.createProject(input),
    onSuccess: created => {
      if (created.warning === null) props.onCreated(created.path, tone)
    },
  })
  const change = (patch: Partial<CreateForm>): void => {
    setForm(current => ({ ...current, ...patch }))
    setErrors({})
    setRemembered(false)
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
            <DialogTitle>Create project</DialogTitle>
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
          {props.onRememberParent === undefined ? null : (
            <div className="dshx:flex dshx:items-center dshx:gap-2">
              <Button
                className="dshx:text-xs"
                disabled={remembered || form.parentPath.trim().length === 0}
                onClick={() => {
                  props.onRememberParent?.(form.parentPath)
                  setRemembered(true)
                }}
                size="sm"
                type="button"
                variant="ghost"
              >
                {remembered ? 'Default parent folder saved' : 'Use this parent folder by default'}
              </Button>
            </div>
          )}
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
          <ProjectTonePicker name={form.name === '' ? 'New project' : form.name} onChange={setChosenTone} tone={tone} />          <DialogFooter>
            <Button onClick={props.onClose} type="button" variant="outline">
              Close
            </Button>
            {created !== undefined && created.warning !== null ? (
              <Button onClick={() => props.onCreated(created.path, tone)} type="button">
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
