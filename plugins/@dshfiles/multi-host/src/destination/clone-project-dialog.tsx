import { Alert, AlertDescription } from '@dshfiles/plugin-ui/components/ui/alert'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Checkbox } from '@dshfiles/plugin-ui/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@dshfiles/plugin-ui/components/ui/dialog'
import { Input } from '@dshfiles/plugin-ui/components/ui/input'
import { revalidateLogic, useAppForm } from '@dshfiles/plugin-ui/form'
import { useMutation, useQueryClient } from '@dshfiles/plugin-ui/query'
import { useEffect, useRef, useState } from 'react'
import { z } from 'zod'
import type { LocalProjectFileCandidate, RuntimeSummary } from '../api.js'
import { multiHostKeys, type MultiHostClient } from './queries.js'

const maxLocalCopyFiles = 128
const maxLocalCopyBytes = 50 * 1024 * 1024

const cloneDialogFormSchema = z.object({
  repositoryUrl: z.string().trim().min(1, 'Enter a Git repository URL.'),
  destinationPath: z.string().trim(),
  copyLocalFiles: z.boolean(),
  copyFromPath: z.string().trim(),
  includeIgnored: z.boolean(),
})

export const CloneProjectDialog = (props: {
  readonly api: MultiHostClient
  readonly runtime: RuntimeSummary | undefined
  readonly hostName: string | undefined
  readonly localProjectPath?: string | undefined
  readonly onClose: () => void
}) => {
  const queryClient = useQueryClient()
  const [files, setFiles] = useState<readonly LocalProjectFileCandidate[]>([])
  const [selectedPaths, setSelectedPaths] = useState<string[]>([])
  const [completion, setCompletion] = useState<{ readonly copiedFileCount: number; readonly copyWarning: string | undefined } | null>(null)
  const scanController = useRef<AbortController | null>(null)
  const form = useAppForm({
    defaultValues: {
      repositoryUrl: '',
      destinationPath: '',
      copyLocalFiles: false,
      copyFromPath: props.localProjectPath ?? '',
      includeIgnored: false,
    },
    validationLogic: revalidateLogic({ mode: 'blur', modeAfterSubmission: 'change' }),
    validators: { onDynamic: cloneDialogFormSchema },
    onSubmit: ({ value }) => {
      if (props.runtime === undefined) return
      const input = {
        runtimeId: props.runtime.id,
        repositoryUrl: value.repositoryUrl,
        destinationPath:
          value.destinationPath ||
          `~/${
            value.repositoryUrl
              .trim()
              .split(/[/:]/u)
              .at(-1)
              ?.replace(/\.git$/u, '') || 'project'
          }`,
      }
      if (value.copyLocalFiles) {
        clone.mutate({
          ...input,
          copyFromPath: value.copyFromPath,
          copyPaths: selectedPaths,
          includeIgnored: value.includeIgnored,
        })
        return
      }
      clone.mutate(input)
    },
  })
  useEffect(() => {
    if (props.runtime === undefined) form.setFieldValue('copyFromPath', props.localProjectPath ?? '')
  }, [form, props.localProjectPath, props.runtime])
  const scan = useMutation({
    mutationFn: async (input: { readonly path: string; readonly includeIgnored: boolean }) => {
      scanController.current?.abort()
      const controller = new AbortController()
      scanController.current = controller
      const result = await props.api.localProjectFiles(input, { signal: controller.signal })
      if (!result.ok) throw new Error(result.message)
      return result
    },
    onSuccess: result => {
      setFiles(result.files)
      setSelectedPaths([])
    },
  })
  const clone = useMutation({
    mutationFn: async (input: {
      readonly runtimeId: string
      readonly repositoryUrl: string
      readonly destinationPath: string
      readonly copyFromPath?: string
      readonly copyPaths?: string[]
      readonly includeIgnored?: boolean
    }) => {
      const result = await props.api.runtimeCloneProject(input)
      if (!result.ok) throw new Error(result.message)
      return result
    },
    onSuccess: result => {
      void queryClient.invalidateQueries({ queryKey: multiHostKeys.all })
      setCompletion({ copiedFileCount: result.copiedFileCount ?? 0, copyWarning: result.copyWarning })
    },
  })
  const closeDialog = (): void => {
    if (clone.isPending) return
    scanController.current?.abort()
    scanController.current = null
    form.reset()
    form.setFieldValue('copyFromPath', props.localProjectPath ?? '')
    setFiles([])
    setSelectedPaths([])
    setCompletion(null)
    scan.reset()
    clone.reset()
    props.onClose()
  }
  const selectedBytes = files.filter(file => selectedPaths.includes(file.path)).reduce((total, file) => total + file.bytes, 0)
  const selectionOverLimit = selectedPaths.length > maxLocalCopyFiles || selectedBytes > maxLocalCopyBytes
  const scanFiles = (): void => {
    const path = form.getFieldValue('copyFromPath').trim()
    if (path.length === 0) return
    setFiles([])
    setSelectedPaths([])
    scan.mutate({ path, includeIgnored: form.getFieldValue('includeIgnored') })
  }
  const toggleFile = (path: string, checked: boolean): void => {
    setSelectedPaths(current => (checked ? [...new Set([...current, path])] : current.filter(selected => selected !== path)))
  }

  return (
    <Dialog open={props.runtime !== undefined} onOpenChange={open => (open ? undefined : closeDialog())}>
      <DialogContent className="dshx:max-w-xl">
        <form
          className="dshx:flex dshx:flex-col dshx:gap-5"
          noValidate
          onSubmit={event => {
            event.preventDefault()
            void form.handleSubmit()
          }}
        >
          <DialogHeader>
            <DialogTitle>Clone project{props.hostName === undefined ? '' : ` to ${props.hostName}`}</DialogTitle>
            <DialogDescription>
              Clone a Git repository and add it to this machine's projects. Optionally copy selected local files Git does not track.
            </DialogDescription>
          </DialogHeader>
          <form.AppField name="repositoryUrl">
            {field => <field.TextField label="Git repository URL" monospace placeholder="git@github.com:owner/repo.git" required />}
          </form.AppField>
          <form.AppField name="destinationPath">
            {field => <field.TextField label={`Folder on ${props.hostName ?? 'remote host'}`} monospace placeholder="~/project-name" />}
          </form.AppField>
          <form.Field name="copyLocalFiles">
            {field => (
              <label className="dshx:flex dshx:items-center dshx:gap-2 dshx:text-sm">
                <Checkbox
                  checked={field.state.value}
                  onCheckedChange={checked => {
                    field.handleChange(checked === true)
                    if (checked === true) return
                    scanController.current?.abort()
                    scanController.current = null
                    setFiles([])
                    setSelectedPaths([])
                    scan.reset()
                  }}
                />
                Copy selected local files
              </label>
            )}
          </form.Field>
          <form.Subscribe
            selector={state => ({
              enabled: state.values.copyLocalFiles,
              copyFromPath: state.values.copyFromPath,
              includeIgnored: state.values.includeIgnored,
            })}
          >
            {state =>
              state.enabled ? (
                <section className="dshx:flex dshx:flex-col dshx:gap-3">
                  <label className="dshx:flex dshx:flex-col dshx:gap-2 dshx:text-sm">
                    Local project folder
                    <form.Field
                      name="copyFromPath"
                      listeners={{
                        onChange: () => {
                          scanController.current?.abort()
                          scanController.current = null
                          setFiles([])
                          setSelectedPaths([])
                          scan.reset()
                        },
                      }}
                    >
                      {field => (
                        <Input
                          className="dshx:font-mono!"
                          placeholder="/path/to/project"
                          value={field.state.value}
                          onChange={event => field.handleChange(event.target.value)}
                        />
                      )}
                    </form.Field>
                  </label>
                  <form.Field name="includeIgnored">
                    {field => (
                      <label className="dshx:flex dshx:items-center dshx:gap-2 dshx:text-sm">
                        <Checkbox
                          checked={field.state.value}
                          onCheckedChange={checked => {
                            field.handleChange(checked === true)
                            scanController.current?.abort()
                            scanController.current = null
                            setFiles([])
                            setSelectedPaths([])
                            scan.reset()
                          }}
                        />
                        Also scan ignored files
                      </label>
                    )}
                  </form.Field>
                  <p className="dshx:text-xs dshx:text-muted-foreground">
                    Files are never selected automatically. Credential-like names are blocked; review each other file.
                  </p>
                  <Button disabled={scan.isPending || state.copyFromPath.trim().length === 0} type="button" variant="outline" onClick={scanFiles}>
                    {scan.isPending ? 'Scanning…' : 'Find files'}
                  </Button>
                  {scan.isError ? (
                    <Alert variant="destructive">
                      <AlertDescription>{scan.error.message}</AlertDescription>
                    </Alert>
                  ) : null}
                  {scan.data !== undefined ? (
                    <div className="dshx:flex dshx:max-h-40 dshx:flex-col dshx:gap-1 dshx:overflow-y-auto dshx:rounded-md dshx:border dshx:p-2">
                      {files.length === 0 ? (
                        <p className="dshx:text-sm dshx:text-muted-foreground">
                          {state.includeIgnored ? 'No local files to copy.' : 'No untracked files. Turn on “Also scan ignored files” to find ignored files.'}
                        </p>
                      ) : null}
                      {files.map(file => (
                        <label key={file.path} className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-2 dshx:text-sm">
                          <Checkbox
                            checked={selectedPaths.includes(file.path)}
                            disabled={!file.copyable}
                            onCheckedChange={checked => toggleFile(file.path, checked === true)}
                          />
                          <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:font-mono!">{file.path}</span>
                          <span className="dshx:shrink-0 dshx:text-xs dshx:text-muted-foreground">
                            {file.ignored ? 'ignored' : 'untracked'} ·{' '}
                            {file.copyReason === 'potential-secret'
                              ? 'possible credential; blocked'
                              : file.copyReason === 'too-large'
                                ? 'too large to copy'
                                : `${file.bytes} B`}
                          </span>
                        </label>
                      ))}
                      {scan.data.truncated ? <p className="dshx:text-xs dshx:text-muted-foreground">Showing first 256 files.</p> : null}
                    </div>
                  ) : null}
                  {selectionOverLimit ? (
                    <Alert variant="destructive">
                      <AlertDescription>Select no more than 128 files or 50 MB.</AlertDescription>
                    </Alert>
                  ) : null}
                </section>
              ) : null
            }
          </form.Subscribe>
          {clone.isError ? (
            <Alert variant="destructive">
              <AlertDescription>{clone.error.message}</AlertDescription>
            </Alert>
          ) : null}
          {completion !== null ? (
            <Alert>
              <AlertDescription>{completion.copyWarning ?? `Project cloned and added. Copied ${completion.copiedFileCount} local file(s).`}</AlertDescription>
            </Alert>
          ) : null}
          <DialogFooter>
            {completion === null ? (
              <Button type="button" variant="outline" disabled={clone.isPending} onClick={closeDialog}>
                Cancel
              </Button>
            ) : (
              <Button type="button" variant="outline" onClick={closeDialog}>
                Done
              </Button>
            )}
            <form.Subscribe selector={state => state.values}>
              {values => (
                <Button
                  disabled={
                    clone.isPending ||
                    completion !== null ||
                    values.repositoryUrl.trim().length === 0 ||
                    (values.copyLocalFiles && (scan.data === undefined || selectionOverLimit))
                  }
                  type="submit"
                >
                  {clone.isPending ? 'Cloning…' : 'Clone project'}
                </Button>
              )}
            </form.Subscribe>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
