import { useApi } from '@dshfiles/dshx/client'
import { Alert, AlertDescription, AlertTitle } from '@dshfiles/plugin-ui/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@dshfiles/plugin-ui/components/ui/alert-dialog'
import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@dshfiles/plugin-ui/components/ui/card'
import { CircleAlertIcon, CircleCheckIcon, MonitorIcon, RefreshCwIcon, ServerIcon, Trash2Icon, TriangleAlertIcon } from '@dshfiles/plugin-ui/icons'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@dshfiles/plugin-ui/components/ui/empty'
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemSeparator, ItemTitle } from '@dshfiles/plugin-ui/components/ui/item'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import { revalidateLogic, useAppForm } from '@dshfiles/plugin-ui/form'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { z } from 'zod'
import { multiHostApi, type HostSummary, type RuntimeSummary, type RuntimeStatus } from './api.js'

const SectionHeading = (props: { readonly id: string; readonly title: string; readonly meta: string }): JSX.Element => (
  <div className="dshx:flex dshx:items-baseline dshx:justify-between dshx:gap-4">
    <h2 className="dshx:text-sm dshx:font-semibold" id={props.id}>
      {props.title}
    </h2>
    <span className="dshx:text-xs dshx:text-muted-foreground">{props.meta}</span>
  </div>
)

const EmptyBlock = (props: { readonly title: string; readonly description?: string }): JSX.Element => (
  <Empty className="dshx:border dshx:p-6 dshx:md:p-8">
    <EmptyHeader>
      <EmptyTitle className="dshx:text-sm dshx:font-semibold">{props.title}</EmptyTitle>
      {props.description !== undefined && <EmptyDescription className="dshx:text-xs">{props.description}</EmptyDescription>}
    </EmptyHeader>
  </Empty>
)

const BorderedList = (props: { readonly children: ReactNode; readonly label?: string }): JSX.Element => (
  <ItemGroup aria-label={props.label} className="dshx:rounded-lg dshx:border dshx:bg-card">
    {props.children}
  </ItemGroup>
)

const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? '' : 's'}`

type Directory = { readonly hosts: readonly HostSummary[]; readonly runtimes: readonly RuntimeSummary[] }
type ViewWindow = { readonly popup: Window; readonly timer: number; readonly runtimeId: string }

const emptyDirectory: Directory = { hosts: [], runtimes: [] }
const directoryQueryKey = ['multi-host', 'directory'] as const
const runtimeStatusQueryKey = (runtimeId: string) => ['multi-host', 'runtime-status', runtimeId] as const

const sessionCreatedSchema = z.object({ sessionId: z.string().min(1) })
const hostFormSchema = z
  .object({
    id: z
      .string()
      .trim()
      .min(1, 'Host id is required.')
      .max(64)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, 'Use letters, numbers, dots, underscores, or hyphens.'),
    name: z.string().trim().min(1, 'Display name is required.').max(120),
    kind: z.enum(['local', 'ssh']),
    sshTarget: z.string().trim().max(255),
  })
  .superRefine((value, context) => {
    if (value.kind === 'ssh' && value.sshTarget.length === 0) context.addIssue({ code: 'custom', path: ['sshTarget'], message: 'SSH target is required.' })
  })

const runtimeFormSchema = (hosts: readonly HostSummary[]) =>
  z
    .object({
      hostId: z.string().min(1, 'Choose a recorded host.'),
      name: z.string().trim().min(1, 'Runtime name is required.').max(120),
      launchUrl: z.string().trim().max(2048),
      unit: z.string().trim().max(128),
      remoteHome: z.string().trim().max(1024),
    })
    .superRefine((value, context) => {
      const host = hosts.find(item => item.id === value.hostId)
      if (host === undefined) return
      if (host.connector.kind === 'local' && value.launchUrl.length === 0) {
        context.addIssue({ code: 'custom', path: ['launchUrl'], message: 'Tokenized launch URL is required.' })
      }
      if (host.connector.kind === 'ssh') {
        if (!/^[A-Za-z0-9][A-Za-z0-9_.@-]*$/.test(value.unit)) context.addIssue({ code: 'custom', path: ['unit'], message: 'Enter a valid systemd user unit.' })
        if (value.remoteHome.length === 0) context.addIssue({ code: 'custom', path: ['remoteHome'], message: 'Remote DSH_HOME is required.' })
      }
    })

const workspaceFormSchema = z.object({ path: z.string().trim().min(1, 'Workspace path is required.').max(1024) })
const sessionFormSchema = z.object({ cwd: z.string().trim().max(1024) })

const errorMessage = (reason: unknown): string => (reason instanceof Error ? reason.message : 'The multi-host request failed.')

const createRequestController = (controllers: Set<AbortController>): AbortController => {
  const controller = new AbortController()
  controllers.add(controller)
  return controller
}

const releaseRequestController = (controllers: Set<AbortController>, controller: AbortController): void => {
  controllers.delete(controller)
}

export const MultiHostPanel = (): JSX.Element => {
  const api = useApi(multiHostApi)
  const queryClient = useQueryClient()
  const [preferredRuntimeId, setPreferredRuntimeId] = useState('')
  const [openViewRuntimeIds, setOpenViewRuntimeIds] = useState<ReadonlySet<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [removingHost, setRemovingHost] = useState<HostSummary | null>(null)
  const viewWindows = useRef(new Map<string, ViewWindow>())
  const requestControllers = useRef(new Set<AbortController>())
  const directoryQuery = useQuery({
    queryKey: directoryQueryKey,
    queryFn: ({ signal }) => api.list(undefined, { signal }),
    retry: false,
  })
  const directory = directoryQuery.data ?? emptyDirectory
  const selectedRuntimeId = directory.runtimes.some(runtime => runtime.id === preferredRuntimeId) ? preferredRuntimeId : (directory.runtimes[0]?.id ?? '')
  const selectedRuntime = useMemo(() => directory.runtimes.find(runtime => runtime.id === selectedRuntimeId), [directory.runtimes, selectedRuntimeId])
  const selectedHost = directory.hosts.find(host => host.id === selectedRuntime?.hostId)
  const runtimeStatusQuery = useQuery({
    queryKey: runtimeStatusQueryKey(selectedRuntimeId),
    enabled: selectedRuntime !== undefined,
    queryFn: async ({ signal }): Promise<RuntimeStatus> => {
      if (selectedRuntime === undefined) throw new Error('Choose a runtime first.')
      try {
        return await api.runtimeStatus({ runtimeId: selectedRuntime.id }, { signal })
      } catch (reason) {
        if (signal.aborted) throw reason
        return {
          ok: false,
          hostId: selectedRuntime.hostId,
          runtimeId: selectedRuntime.id,
          code: 'runtime-unavailable',
          message: errorMessage(reason),
          stale: true,
          ...(selectedRuntime.lastSeenAt === undefined ? {} : { lastSeenAt: selectedRuntime.lastSeenAt }),
        }
      }
    },
    retry: false,
    refetchOnWindowFocus: false,
  })
  const hostUpsertMutation = useMutation({ mutationFn: (input: Parameters<typeof api.hostUpsert>[0]) => api.hostUpsert(input) })
  const runtimeUpsertMutation = useMutation({
    mutationFn: (args: Parameters<typeof api.runtimeUpsert>) => api.runtimeUpsert(...args),
  })
  const workspaceOpenMutation = useMutation({
    mutationFn: (args: Parameters<typeof api.workspaceOpen>) => api.workspaceOpen(...args),
  })
  const sessionCreateMutation = useMutation({
    mutationFn: (args: Parameters<typeof api.runtimeCall>) => api.runtimeCall(...args),
  })
  const hostRemoveMutation = useMutation({ mutationFn: (input: Parameters<typeof api.hostRemove>[0]) => api.hostRemove(input) })
  const saving =
    hostUpsertMutation.isPending ||
    runtimeUpsertMutation.isPending ||
    workspaceOpenMutation.isPending ||
    sessionCreateMutation.isPending ||
    hostRemoveMutation.isPending
  const status = selectedRuntime === undefined ? null : (runtimeStatusQuery.data ?? null)
  const loading = directoryQuery.isFetching
  const visibleError = error ?? (directoryQuery.isFetching || directoryQuery.error === null ? null : errorMessage(directoryQuery.error))

  const refresh = useCallback(async (): Promise<void> => {
    setError(null)
    await queryClient.invalidateQueries({ queryKey: directoryQueryKey })
  }, [queryClient])

  useEffect(
    () => () => {
      for (const controller of requestControllers.current) controller.abort()
      requestControllers.current.clear()
    },
    [],
  )

  useEffect(
    () => () => {
      for (const [leaseId, view] of viewWindows.current) {
        clearInterval(view.timer)
        view.popup.close()
        void api.runtimeCloseView({ leaseId }).catch(() => undefined)
      }
      viewWindows.current.clear()
    },
    [api],
  )

  const hostForm = useAppForm({
    defaultValues: { id: '', name: '', kind: 'ssh' as 'local' | 'ssh', sshTarget: '' },
    validationLogic: revalidateLogic(),
    validators: { onDynamic: hostFormSchema },
    onSubmit: async ({ value }) => {
      setError(null)
      setNotice(null)
      try {
        const connector = value.kind === 'local' ? { kind: 'local' as const } : { kind: 'ssh' as const, sshTarget: value.sshTarget }
        await hostUpsertMutation.mutateAsync({ id: value.id, name: value.name, connector })
        hostForm.reset()
        setNotice('Host recorded. Add one or more DSH runtimes to it.')
        await refresh()
      } catch (reason) {
        setError(errorMessage(reason))
      }
    },
  })

  const runtimeSchema = useMemo(() => runtimeFormSchema(directory.hosts), [directory.hosts])
  const runtimeForm = useAppForm({
    defaultValues: { hostId: '', name: '', launchUrl: '', unit: '', remoteHome: '' },
    validationLogic: revalidateLogic(),
    validators: { onDynamic: runtimeSchema },
    onSubmit: async ({ value }) => {
      const host = directory.hosts.find(item => item.id === value.hostId)
      if (host === undefined) {
        setError('Choose a recorded host first.')
        return
      }
      setError(null)
      setNotice(null)
      const controller = createRequestController(requestControllers.current)
      try {
        const locator =
          host.connector.kind === 'local'
            ? { kind: 'local' as const, launchUrl: value.launchUrl }
            : { kind: 'ssh' as const, unit: value.unit, remoteHome: value.remoteHome }
        const registration = await runtimeUpsertMutation.mutateAsync([{ hostId: host.id, name: value.name, locator }, { signal: controller.signal }])
        if (!registration.ok) throw new Error(`${registration.code}: ${registration.message}`)
        setPreferredRuntimeId(registration.runtime.id)
        runtimeForm.reset()
        setNotice(`Runtime ${registration.runtime.id} authenticated and identity pinned.`)
        await refresh()
      } catch (reason) {
        if (!controller.signal.aborted) setError(errorMessage(reason))
      } finally {
        releaseRequestController(requestControllers.current, controller)
      }
    },
  })

  const runtimeHostId = directory.hosts.some(host => host.id === runtimeForm.state.values.hostId)
    ? runtimeForm.state.values.hostId
    : (directory.hosts[0]?.id ?? '')

  useEffect(() => {
    if (directory.hosts.some(host => host.id === runtimeForm.getFieldValue('hostId'))) return
    runtimeForm.setFieldValue('hostId', directory.hosts[0]?.id ?? '')
  }, [directory.hosts, runtimeForm])

  const workspaceForm = useAppForm({
    defaultValues: { path: '' },
    validationLogic: revalidateLogic(),
    validators: { onDynamic: workspaceFormSchema },
    onSubmit: async ({ value }) => {
      if (selectedRuntime === undefined) return
      setError(null)
      setNotice(null)
      const controller = createRequestController(requestControllers.current)
      try {
        const workspace = await workspaceOpenMutation.mutateAsync([{ runtimeId: selectedRuntime.id, path: value.path }, { signal: controller.signal }])
        workspaceForm.reset()
        sessionForm.setFieldValue('cwd', workspace.path)
        setNotice(`Workspace ${workspace.workspaceId} opened on ${selectedRuntime.id}.`)
        queryClient.setQueryData<RuntimeStatus>(runtimeStatusQueryKey(selectedRuntime.id), current =>
          current?.ok === true
            ? { ...current, workspaces: [...current.workspaces.filter(item => item.workspaceId !== workspace.workspaceId), workspace] }
            : current,
        )
      } catch (reason) {
        if (!controller.signal.aborted) setError(errorMessage(reason))
      } finally {
        releaseRequestController(requestControllers.current, controller)
      }
    },
  })

  const sessionForm = useAppForm({
    defaultValues: { cwd: '' },
    validationLogic: revalidateLogic(),
    validators: { onDynamic: sessionFormSchema },
    onSubmit: async ({ value }) => {
      if (selectedRuntime === undefined) return
      setError(null)
      setNotice(null)
      const controller = createRequestController(requestControllers.current)
      try {
        const result = await sessionCreateMutation.mutateAsync([
          {
            runtimeId: selectedRuntime.id,
            request: { namespace: 'session', method: 'create', args: { request: value.cwd === '' ? {} : { cwd: value.cwd } } },
          },
          { signal: controller.signal },
        ])
        if (!result.ok) throw new Error(result.message)
        const created = sessionCreatedSchema.parse(result.value)
        setNotice(`Created Session ${created.sessionId} on ${selectedRuntime.id}.`)
        queryClient.setQueryData<RuntimeStatus>(runtimeStatusQueryKey(selectedRuntime.id), current =>
          current?.ok === true
            ? {
                ...current,
                sessions: [
                  ...current.sessions,
                  {
                    runtimeId: selectedRuntime.id,
                    sessionId: created.sessionId,
                    ...(value.cwd === '' ? {} : { cwd: value.cwd }),
                    running: false,
                    blank: true,
                    updatedAt: Date.now(),
                  },
                ],
              }
            : current,
        )
      } catch (reason) {
        if (!controller.signal.aborted) setError(errorMessage(reason))
      } finally {
        releaseRequestController(requestControllers.current, controller)
      }
    },
  })

  const openRuntimeView = async (): Promise<void> => {
    if (selectedRuntime === undefined) return
    const popup = window.open('about:blank', '_blank')
    if (popup === null) {
      setError('Allow pop-ups to open the native runtime view.')
      return
    }
    popup.opener = null
    setError(null)
    setNotice(null)
    let leaseId: string | undefined
    const controller = createRequestController(requestControllers.current)
    try {
      const lease = await api.runtimeOpenView({ runtimeId: selectedRuntime.id }, { signal: controller.signal })
      leaseId = lease.leaseId
      const timer = window.setInterval(() => {
        if (!popup.closed) return
        const view = viewWindows.current.get(lease.leaseId)
        if (view !== undefined) clearInterval(view.timer)
        viewWindows.current.delete(lease.leaseId)
        setOpenViewRuntimeIds(current => {
          const next = new Set(current)
          next.delete(view?.runtimeId ?? selectedRuntime.id)
          return next
        })
        void api
          .runtimeCloseView({ leaseId: lease.leaseId })
          .catch(() => setError('Runtime view closed. Its tunnel will expire automatically if the host is unreachable.'))
      }, 1_000)
      viewWindows.current.set(lease.leaseId, { popup, timer, runtimeId: selectedRuntime.id })
      setOpenViewRuntimeIds(current => new Set(current).add(selectedRuntime.id))
      popup.location.replace(lease.launchUrl)
      setNotice(`Opened an isolated browser origin for ${selectedRuntime.id}. Close its tab to release the connection.`)
    } catch (reason) {
      if (leaseId !== undefined) {
        const view = viewWindows.current.get(leaseId)
        if (view !== undefined) clearInterval(view.timer)
        viewWindows.current.delete(leaseId)
        await api.runtimeCloseView({ leaseId }).catch(() => undefined)
      }
      popup.close()
      if (!controller.signal.aborted) setError(errorMessage(reason))
    } finally {
      releaseRequestController(requestControllers.current, controller)
    }
  }

  const closeRuntimeViews = async (): Promise<void> => {
    const openViews = [...viewWindows.current.entries()]
    viewWindows.current.clear()
    try {
      await Promise.all(
        openViews.map(async ([leaseId, view]) => {
          clearInterval(view.timer)
          view.popup.close()
          await api.runtimeCloseView({ leaseId })
        }),
      )
      setOpenViewRuntimeIds(new Set())
      setNotice('Closed all native runtime views and released their tunnels.')
    } catch (reason) {
      setOpenViewRuntimeIds(new Set())
      setError(errorMessage(reason))
    }
  }

  const removeHost = async (): Promise<void> => {
    if (removingHost === null) return
    const host = removingHost
    setError(null)
    try {
      await hostRemoveMutation.mutateAsync({ id: host.id, removeDirectory: true })
      setRemovingHost(null)
      setNotice(`Removed ${host.name} and its local directory references. Remote runtime data remains intact.`)
      await refresh()
    } catch (reason) {
      setError(errorMessage(reason))
    }
  }


  const runtimeHostKind = directory.hosts.find(host => host.id === runtimeHostId)?.connector.kind
  const statusLabel = status === null ? (runtimeStatusQuery.isFetching ? 'Checking' : 'Unavailable') : status.ok ? 'Online' : 'Stale'

  return (
    <div className="dshx-root dshx:h-full dshx:min-h-0 dshx:w-full dshx:overflow-y-auto dshx:bg-background">
      <main className="dshx:mx-auto dshx:flex dshx:w-full dshx:max-w-5xl dshx:flex-col dshx:gap-6 dshx:p-6 dshx:md:p-8">
        <header className="dshx:flex dshx:items-start dshx:justify-between dshx:gap-4">
          <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-1">
            <h1 className="dshx:text-xl dshx:font-semibold">Hosts and runtimes</h1>
            <p className="dshx:text-sm dshx:text-muted-foreground">
              Connect to full DSH runtimes. Sessions, workspaces, tools, and providers stay owned by each runtime, with browser storage scoped per runtime.
            </p>
          </div>
          <Button disabled={loading} onClick={() => void refresh()} type="button" variant="outline">
            {loading ? <Spinner /> : <RefreshCwIcon />}
            {loading ? 'Refreshing…' : 'Refresh'}
          </Button>
        </header>

        {visibleError !== null && (
          <Alert variant="destructive">
            <CircleAlertIcon />
            <AlertDescription className="dshx:text-destructive">{visibleError}</AlertDescription>
          </Alert>
        )}
        {notice !== null && (
          <Alert variant="success">
            <CircleCheckIcon />
            <AlertDescription className="dshx:text-foreground">{notice}</AlertDescription>
          </Alert>
        )}

        <section aria-label="Add execution host and runtime" className="dshx:grid dshx:gap-4 dshx:md:grid-cols-2">
          <Card>
            <CardHeader className="dshx:gap-1">
              <CardTitle className="dshx:text-sm">Add host</CardTitle>
              <CardDescription className="dshx:text-xs">Record a local machine or SSH host, then attach DSH runtimes to it.</CardDescription>
            </CardHeader>
            <CardContent>
              <form
                aria-label="Add host"
                className="dshx:flex dshx:flex-col dshx:gap-4"
                noValidate
                onSubmit={event => {
                  event.preventDefault()
                  void hostForm.handleSubmit()
                }}
              >
                <div className="dshx:grid dshx:gap-4 dshx:sm:grid-cols-2">
                  <hostForm.AppField name="id">
                    {field => <field.TextField description="Letters, numbers, dots, underscores, and hyphens." label="Host id" monospace placeholder="workstation" required />}
                  </hostForm.AppField>
                  <hostForm.AppField name="name">{field => <field.TextField label="Display name" placeholder="Workstation" required />}</hostForm.AppField>
                </div>
                <hostForm.AppField name="kind">
                  {field => (
                    <field.SelectField
                      label="Connection"
                      options={[
                        { value: 'local', label: 'Local machine' },
                        { value: 'ssh', label: 'SSH host' },
                      ]}
                    />
                  )}
                </hostForm.AppField>
                <hostForm.Subscribe selector={state => state.values.kind}>
                  {kind =>
                    kind === 'ssh' ? (
                      <hostForm.AppField name="sshTarget">
                        {field => <field.TextField label="SSH target" monospace placeholder="deploy@host.example" required />}
                      </hostForm.AppField>
                    ) : null
                  }
                </hostForm.Subscribe>
                <div className="dshx:flex dshx:justify-end">
                  <hostForm.AppForm>
                    <hostForm.SubmitButton disabled={saving}>{saving ? 'Saving…' : 'Record host'}</hostForm.SubmitButton>
                  </hostForm.AppForm>
                </div>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="dshx:gap-1">
              <CardTitle className="dshx:text-sm">Attach runtime</CardTitle>
              <CardDescription className="dshx:text-xs">Authenticate a DSH runtime on a recorded host and pin its identity.</CardDescription>
            </CardHeader>
            <CardContent>
              <form
                aria-label="Attach runtime"
                className="dshx:flex dshx:flex-col dshx:gap-4"
                noValidate
                onSubmit={event => {
                  event.preventDefault()
                  void runtimeForm.handleSubmit()
                }}
              >
                <div className="dshx:grid dshx:gap-4 dshx:sm:grid-cols-2">
                  <runtimeForm.AppField name="hostId">
                    {field => (
                      <field.SelectField
                        label="Host"
                        options={directory.hosts.map(host => ({ value: host.id, label: `${host.name} · ${host.connector.kind}` }))}
                        placeholder="Choose a host"
                        required
                      />
                    )}
                  </runtimeForm.AppField>
                  <runtimeForm.AppField name="name">{field => <field.TextField label="Runtime name" placeholder="Web profile" required />}</runtimeForm.AppField>
                </div>
                {runtimeHostKind === 'local' && (
                  <runtimeForm.AppField name="launchUrl">
                    {field => <field.TextField autoComplete="off" label="Tokenized launch URL" placeholder="Paste from DSH startup output" required type="password" />}
                  </runtimeForm.AppField>
                )}
                {runtimeHostKind === 'ssh' && (
                  <div className="dshx:grid dshx:gap-4 dshx:sm:grid-cols-2">
                    <runtimeForm.AppField name="unit">
                      {field => (
                        <field.TextField
                          description="Letters, numbers, dots, underscores, @, and hyphens."
                          label="systemd user unit"
                          monospace
                          placeholder="dsh-runtime"
                          required
                        />
                      )}
                    </runtimeForm.AppField>
                    <runtimeForm.AppField name="remoteHome">
                      {field => <field.TextField label="Remote DSH_HOME" monospace placeholder="/home/user/.dsh/runtime" required />}
                    </runtimeForm.AppField>
                  </div>
                )}
                <div className="dshx:flex dshx:justify-end">
                  <runtimeForm.AppForm>
                    <runtimeForm.SubmitButton disabled={saving}>{saving ? 'Connecting…' : 'Authenticate and pin identity'}</runtimeForm.SubmitButton>
                  </runtimeForm.AppForm>
                </div>
              </form>
            </CardContent>
          </Card>
        </section>

        <section aria-labelledby="host-list-title" className="dshx:flex dshx:flex-col dshx:gap-3">
          <SectionHeading id="host-list-title" meta={plural(directory.hosts.length, 'host')} title="Host directory" />
          {directory.hosts.length === 0 ? (
            <EmptyBlock description="Record a local machine or SSH host to start attaching DSH runtimes." title="No hosts recorded yet" />
          ) : (
            <BorderedList label="Hosts">
              {directory.hosts.map((host, index) => (
                <Fragment key={host.id}>
                  {index > 0 && <ItemSeparator />}
                  <Item role="listitem" size="sm">
                    <ItemMedia variant="icon">{host.connector.kind === 'local' ? <MonitorIcon /> : <ServerIcon />}</ItemMedia>
                    <ItemContent className="dshx:min-w-0 dshx:gap-0.5">
                      <ItemTitle>
                        {host.name}
                        <Badge variant="outline">{host.connector.kind === 'local' ? 'Local' : 'SSH'}</Badge>
                      </ItemTitle>
                      <ItemDescription className="dshx:font-mono dshx:text-xs">
                        {host.id}
                        {host.connector.kind === 'ssh' ? ` · ${host.connector.sshTarget}` : ''}
                      </ItemDescription>
                      <ItemDescription className="dshx:text-xs">{plural(host.runtimeCount, 'runtime')}</ItemDescription>
                    </ItemContent>
                    <ItemActions>
                      <Button
                        aria-label={`Remove ${host.name}`}
                        disabled={saving}
                        onClick={() => setRemovingHost(host)}
                        size="icon-sm"
                        title={`Remove ${host.name}`}
                        type="button"
                        variant="ghost"
                      >
                        <Trash2Icon />
                      </Button>
                    </ItemActions>
                  </Item>
                </Fragment>
              ))}
            </BorderedList>
          )}
        </section>

        <section aria-labelledby="runtime-title" className="dshx:flex dshx:flex-col dshx:gap-3">
          <SectionHeading id="runtime-title" meta={plural(directory.runtimes.length, 'runtime')} title="Registered runtimes" />
          {directory.runtimes.length === 0 ? (
            <EmptyBlock description="Attach a runtime to enable remote workspace and Session placement." title="No runtimes registered" />
          ) : (
            <div className="dshx:grid dshx:items-start dshx:gap-4 dshx:md:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]">
              <nav aria-label="Runtimes" className="dshx:flex dshx:flex-col dshx:gap-1 dshx:rounded-lg dshx:border dshx:bg-card dshx:p-1">
                {directory.runtimes.map(item => {
                  const selected = selectedRuntimeId === item.id
                  const online = status?.ok === true && status.runtime.id === item.id
                  return (
                    <Item
                      asChild
                      className={cn('dshx:cursor-pointer dshx:px-3 dshx:py-2 dshx:text-left dshx:hover:bg-accent/60', selected && 'dshx:bg-accent')}
                      key={item.id}
                      size="sm"
                    >
                      <button aria-current={selected ? 'true' : undefined} onClick={() => setPreferredRuntimeId(item.id)} type="button">
                        <ItemMedia>
                          <span aria-hidden className={cn('dshx:size-2 dshx:rounded-full', online ? 'dshx:bg-success' : 'dshx:bg-muted-foreground/40')} />
                        </ItemMedia>
                        <ItemContent className="dshx:min-w-0 dshx:gap-0.5">
                          <ItemTitle className="dshx:w-full dshx:truncate">{item.name}</ItemTitle>
                          <ItemDescription className="dshx:truncate dshx:text-xs">
                            {item.identity?.profile ?? 'Identity not pinned'} · {item.hostId}
                          </ItemDescription>
                        </ItemContent>
                      </button>
                    </Item>
                  )
                })}
              </nav>

              {selectedRuntime === undefined ? (
                <EmptyBlock title="Choose a runtime" />
              ) : (
                <Card>
                  <CardHeader className="dshx:gap-1">
                    <span className="dshx:text-xs dshx:text-muted-foreground">{selectedHost?.name ?? selectedRuntime.hostId}</span>
                    <div className="dshx:flex dshx:items-center dshx:justify-between dshx:gap-3">
                      <h3 className="dshx:text-base dshx:font-semibold">{selectedRuntime.name}</h3>
                      <Badge variant={status === null ? 'muted' : status.ok ? 'success' : 'warning'}>
                        {statusLabel}
                      </Badge>
                    </div>
                    <span className="dshx:font-mono dshx:text-xs dshx:text-muted-foreground">{selectedRuntime.id}</span>
                  </CardHeader>
                  <CardContent className="dshx:flex dshx:flex-col dshx:gap-5">
                    {status?.ok === true ? (
                      <>
                        <dl className="dshx:grid dshx:grid-cols-3 dshx:gap-3 dshx:rounded-md dshx:bg-muted/50 dshx:px-3 dshx:py-2">
                          {[
                            { label: 'Profile', value: status.identity.profile },
                            { label: 'DSH', value: status.identity.dshVersion },
                            { label: 'Home', value: status.identity.homeLeaf },
                          ].map(fact => (
                            <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-0.5" key={fact.label}>
                              <dt className="dshx:text-xs dshx:text-muted-foreground">{fact.label}</dt>
                              <dd className="dshx:truncate dshx:font-mono dshx:text-xs">{fact.value}</dd>
                            </div>
                          ))}
                        </dl>
                        <div className="dshx:flex dshx:flex-wrap dshx:gap-2">
                          <Button disabled={openViewRuntimeIds.has(selectedRuntime.id)} onClick={() => void openRuntimeView()} type="button">
                            {openViewRuntimeIds.has(selectedRuntime.id) ? 'Runtime view open' : 'Open native runtime view'}
                          </Button>
                          <Button disabled={openViewRuntimeIds.size === 0} onClick={() => void closeRuntimeViews()} type="button" variant="outline">
                            Close runtime views
                          </Button>
                        </div>
                        <form
                          aria-label="Open workspace"
                          className="dshx:flex dshx:items-end dshx:gap-2"
                          noValidate
                          onSubmit={event => {
                            event.preventDefault()
                            void workspaceForm.handleSubmit()
                          }}
                        >
                          <workspaceForm.AppField name="path">
                            {field => <field.TextField className="dshx:flex-1" label="Open workspace path" monospace placeholder="/absolute/path/on/runtime" required />}
                          </workspaceForm.AppField>
                          <workspaceForm.Subscribe selector={state => [state.canSubmit, state.isSubmitting] as const}>
                            {([canSubmit, isSubmitting]) => (
                              <Button disabled={!canSubmit || isSubmitting || saving} type="submit" variant="outline">
                                Open workspace
                              </Button>
                            )}
                          </workspaceForm.Subscribe>
                        </form>
                        <form
                          aria-label="Create Session"
                          className="dshx:flex dshx:items-end dshx:gap-2"
                          noValidate
                          onSubmit={event => {
                            event.preventDefault()
                            void sessionForm.handleSubmit()
                          }}
                        >
                          <sessionForm.AppField name="cwd">
                            {field => <field.TextField className="dshx:flex-1" label="New Session working directory" monospace placeholder="Optional runtime-local path" />}
                          </sessionForm.AppField>
                          <sessionForm.Subscribe selector={state => [state.canSubmit, state.isSubmitting] as const}>
                            {([canSubmit, isSubmitting]) => (
                              <Button disabled={!canSubmit || isSubmitting || saving} type="submit" variant="outline">
                                Create Session here
                              </Button>
                            )}
                          </sessionForm.Subscribe>
                        </form>
                        <div className="dshx:grid dshx:gap-4 dshx:lg:grid-cols-2">
                          <section aria-labelledby="runtime-workspaces-title" className="dshx:flex dshx:flex-col dshx:gap-2">
                            <SectionHeading id="runtime-workspaces-title" meta={String(status.workspaces.length)} title="Workspaces" />
                            {status.workspaces.length === 0 ? (
                              <EmptyBlock title="No workspaces reported" />
                            ) : (
                              <BorderedList>
                                {status.workspaces.map((workspace, index) => (
                                  <Fragment key={workspace.workspaceId}>
                                    {index > 0 && <ItemSeparator />}
                                    <Item asChild className="dshx:cursor-pointer dshx:text-left dshx:hover:bg-accent/50" role="listitem" size="sm">
                                      <button onClick={() => sessionForm.setFieldValue('cwd', workspace.path)} title="Use as Session working directory" type="button">
                                        <ItemContent className="dshx:min-w-0 dshx:gap-0.5">
                                          <ItemTitle className="dshx:w-full dshx:truncate">{workspace.title}</ItemTitle>
                                          <ItemDescription className="dshx:truncate dshx:font-mono dshx:text-xs">{workspace.path}</ItemDescription>
                                        </ItemContent>
                                      </button>
                                    </Item>
                                  </Fragment>
                                ))}
                              </BorderedList>
                            )}
                          </section>
                          <section aria-labelledby="runtime-sessions-title" className="dshx:flex dshx:flex-col dshx:gap-2">
                            <SectionHeading id="runtime-sessions-title" meta={String(status.sessions.length)} title="Sessions" />
                            {status.sessions.length === 0 ? (
                              <EmptyBlock title="No sessions reported" />
                            ) : (
                              <BorderedList>
                                {status.sessions.map((session, index) => (
                                  <Fragment key={session.sessionId}>
                                    {index > 0 && <ItemSeparator />}
                                    <Item role="listitem" size="sm">
                                      <ItemContent className="dshx:min-w-0 dshx:gap-0.5">
                                        <ItemTitle className="dshx:w-full dshx:truncate dshx:font-mono dshx:text-xs">{session.sessionId}</ItemTitle>
                                        <ItemDescription className="dshx:truncate dshx:font-mono dshx:text-xs">{session.cwd ?? 'No working directory'}</ItemDescription>
                                      </ItemContent>
                                      <ItemActions>
                                        <Badge variant={session.running ? 'info' : 'outline'}>
                                          {session.running ? 'running' : session.blank ? 'blank' : 'idle'}
                                        </Badge>
                                      </ItemActions>
                                    </Item>
                                  </Fragment>
                                ))}
                              </BorderedList>
                            )}
                          </section>
                        </div>
                      </>
                    ) : (
                      <Alert variant="warning">
                        {status === null ? <Spinner /> : <TriangleAlertIcon />}
                        <AlertTitle>{status === null ? 'Checking runtime identity…' : status.message}</AlertTitle>
                        <AlertDescription>
                          {status?.lastSeenAt === undefined ? 'No successful connection yet.' : `Last verified ${new Date(status.lastSeenAt).toLocaleString()}.`}
                        </AlertDescription>
                      </Alert>
                    )}
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </section>

        <AlertDialog
          onOpenChange={open => {
            if (!open && !saving) setRemovingHost(null)
          }}
          open={removingHost !== null}
        >
          <AlertDialogContent className="dshx-root">
            <AlertDialogHeader>
              <AlertDialogTitle>{removingHost === null ? 'Remove host?' : `Remove ${removingHost.name}?`}</AlertDialogTitle>
              <AlertDialogDescription>This removes the host and its local directory references. Remote runtime data stays intact.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={saving}>Keep host</AlertDialogCancel>
              <AlertDialogAction
                disabled={saving}
                onClick={event => {
                  event.preventDefault()
                  void removeHost()
                }}
                variant="destructive"
              >
                {saving ? 'Removing…' : 'Remove host'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </main>
    </div>
  )
}
