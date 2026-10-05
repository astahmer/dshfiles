import { Button, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import { useApi } from '@dshfiles/dshx/client'
import { ConfirmDialog, EmptyState, Notice } from '@dshfiles/plugin-ui'
import { revalidateLogic, useAppForm } from '@dshfiles/plugin-ui/form'
import { useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { z } from 'zod'
import { multiHostApi, type HostSummary, type RuntimeSummary, type RuntimeStatus } from './api.js'
import styles from './multi-host.module.css'

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
  const visibleError = error ?? (directoryQuery.isFetching || directoryQuery.error === undefined ? null : errorMessage(directoryQuery.error))

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

  return (
    <main className={styles.panel}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Execution placement</p>
          <h1>Hosts and runtimes</h1>
          <p className={styles.subtitle}>
            Connect to full DSH runtimes. Sessions, workspaces, tools, and providers stay owned by each runtime, with browser storage scoped per runtime.
          </p>
        </div>
        <Button disabled={loading} onClick={() => void refresh()} size="sm" type="button" variant="outline">
          {loading ? 'Refreshing…' : 'Refresh'}
        </Button>
      </header>

      {visibleError !== null && <Notice tone="danger">{visibleError}</Notice>}
      {notice !== null && <Notice tone="success">{notice}</Notice>}

      <section className={styles.section} aria-labelledby="host-list-title">
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.eyebrow}>Machines</p>
            <h2 id="host-list-title">Host directory</h2>
          </div>
          <Tag tone="neutral">{directory.hosts.length}</Tag>
        </div>
        {directory.hosts.length === 0 ? (
          <EmptyState compact description="Record a local machine or SSH host to start attaching DSH runtimes." title="No hosts recorded yet" />
        ) : (
          <ul className={styles.hostList}>
            {directory.hosts.map(host => (
              <li className={styles.hostCard} key={host.id}>
                <div className={styles.hostCardMain}>
                  <span className={styles.hostGlyph} aria-hidden>
                    {host.connector.kind === 'local' ? '⌂' : '↗'}
                  </span>
                  <div>
                    <strong>{host.name}</strong>
                    <span>
                      {host.id} · {host.connector.kind} · {host.runtimeCount} runtime{host.runtimeCount === 1 ? '' : 's'}
                    </span>
                  </div>
                </div>
                <Button className={styles.removeButton} disabled={saving} onClick={() => setRemovingHost(host)} size="sm" type="button" variant="ghost">
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={styles.forms} aria-label="Add execution host and runtime">
        <form
          className={styles.formCard}
          noValidate
          onSubmit={event => {
            event.preventDefault()
            void hostForm.handleSubmit()
          }}
        >
          <div>
            <p className={styles.eyebrow}>Step 1</p>
            <h2>Add host</h2>
          </div>
          <hostForm.AppField name="id">
            {field => <field.TextField description="Letters, numbers, dots, underscores, and hyphens." label="Host id" placeholder="workstation" required />}
          </hostForm.AppField>
          <hostForm.AppField name="name">{field => <field.TextField label="Display name" placeholder="Workstation" required />}</hostForm.AppField>
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
                  {field => <field.TextField label="SSH target" placeholder="deploy@host.example" required />}
                </hostForm.AppField>
              ) : null
            }
          </hostForm.Subscribe>
          <hostForm.AppForm>
            <hostForm.SubmitButton disabled={saving}>{saving ? 'Saving…' : 'Record host'}</hostForm.SubmitButton>
          </hostForm.AppForm>
        </form>

        <form
          className={styles.formCard}
          noValidate
          onSubmit={event => {
            event.preventDefault()
            void runtimeForm.handleSubmit()
          }}
        >
          <div>
            <p className={styles.eyebrow}>Step 2</p>
            <h2>Attach runtime</h2>
          </div>
          <runtimeForm.AppField name="hostId">
            {field => (
              <field.SelectField
                label="Host"
                options={[
                  { value: '', label: 'Choose a host' },
                  ...directory.hosts.map(host => ({ value: host.id, label: `${host.name} · ${host.connector.kind}` })),
                ]}
                required
              />
            )}
          </runtimeForm.AppField>
          <runtimeForm.AppField name="name">{field => <field.TextField label="Runtime name" placeholder="Web profile" required />}</runtimeForm.AppField>
          {directory.hosts.find(host => host.id === runtimeHostId)?.connector.kind === 'local' ? (
            <runtimeForm.AppField name="launchUrl">
              {field => <field.TextField label="Tokenized launch URL" placeholder="Paste from DSH startup output" required type="password" />}
            </runtimeForm.AppField>
          ) : (
            <>
              {directory.hosts.find(host => host.id === runtimeHostId)?.connector.kind === 'ssh' && (
                <>
                  <runtimeForm.AppField name="unit">
                    {field => (
                      <field.TextField
                        description="Letters, numbers, dots, underscores, @, and hyphens."
                        label="systemd user unit"
                        placeholder="dsh-runtime"
                        required
                      />
                    )}
                  </runtimeForm.AppField>
                  <runtimeForm.AppField name="remoteHome">
                    {field => <field.TextField label="Remote DSH_HOME" placeholder="/home/user/.dsh/runtime" required />}
                  </runtimeForm.AppField>
                </>
              )}
            </>
          )}
          <runtimeForm.AppForm>
            <runtimeForm.SubmitButton disabled={saving}>{saving ? 'Connecting…' : 'Authenticate and pin identity'}</runtimeForm.SubmitButton>
          </runtimeForm.AppForm>
        </form>
      </section>

      <section className={styles.section} aria-labelledby="runtime-title">
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.eyebrow}>Execution targets</p>
            <h2 id="runtime-title">Registered runtimes</h2>
          </div>
          <Tag tone="neutral">{directory.runtimes.length}</Tag>
        </div>
        {directory.runtimes.length === 0 ? (
          <EmptyState compact description="Attach a runtime to enable remote workspace and Session placement." title="No runtimes registered" />
        ) : (
          <div className={styles.runtimeLayout}>
            <nav className={styles.runtimeList} aria-label="Runtimes">
              {directory.runtimes.map(item => (
                <button
                  key={item.id}
                  type="button"
                  className={`${styles.runtimeChoice} ${selectedRuntimeId === item.id ? styles.runtimeChoiceSelected : ''}`}
                  onClick={() => setPreferredRuntimeId(item.id)}
                >
                  <span className={status?.ok === true && status.runtime.id === item.id ? styles.onlineDot : styles.unknownDot} aria-hidden />
                  <span>
                    <strong>{item.name}</strong>
                    <small>
                      {item.identity?.profile ?? 'Identity not pinned'} · {item.hostId}
                    </small>
                  </span>
                </button>
              ))}
            </nav>

            <div className={styles.runtimeDetail}>
              {selectedRuntime === undefined ? (
                <EmptyState compact title="Choose a runtime" />
              ) : (
                <>
                  <div className={styles.runtimeTitle}>
                    <div>
                      <p className={styles.eyebrow}>{selectedHost?.name ?? selectedRuntime.hostId}</p>
                      <h3>{selectedRuntime.name}</h3>
                      <p className={styles.runtimeId}>{selectedRuntime.id}</p>
                    </div>
                    <Tag tone={status === null ? 'quiet' : status.ok ? 'success' : 'warning'}>
                      {status === null ? (runtimeStatusQuery.isFetching ? 'Checking' : 'Unavailable') : status.ok ? 'Online' : 'Stale'}
                    </Tag>
                  </div>
                  {status?.ok === true ? (
                    <>
                      <div className={styles.identityFacts}>
                        <span>
                          Profile <strong>{status.identity.profile}</strong>
                        </span>
                        <span>
                          DSH <strong>{status.identity.dshVersion}</strong>
                        </span>
                        <span>
                          Home <strong>{status.identity.homeLeaf}</strong>
                        </span>
                      </div>
                      <div className={styles.actions}>
                        <Button disabled={openViewRuntimeIds.has(selectedRuntime.id)} onClick={() => void openRuntimeView()} type="button" variant="primary">
                          {openViewRuntimeIds.has(selectedRuntime.id) ? 'Runtime view open' : 'Open native runtime view'}
                        </Button>
                        <Button onClick={() => void closeRuntimeViews()} disabled={viewWindows.current.size === 0} type="button" variant="outline">
                          Close runtime views
                        </Button>
                      </div>
                      <form
                        className={styles.inlineForm}
                        noValidate
                        onSubmit={event => {
                          event.preventDefault()
                          void workspaceForm.handleSubmit()
                        }}
                      >
                        <workspaceForm.AppField name="path">
                          {field => <field.TextField label="Open workspace path" placeholder="/absolute/path/on/runtime" required />}
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
                        className={styles.inlineForm}
                        noValidate
                        onSubmit={event => {
                          event.preventDefault()
                          void sessionForm.handleSubmit()
                        }}
                      >
                        <sessionForm.AppField name="cwd">
                          {field => <field.TextField label="New Session working directory" placeholder="Optional runtime-local path" />}
                        </sessionForm.AppField>
                        <sessionForm.Subscribe selector={state => [state.canSubmit, state.isSubmitting] as const}>
                          {([canSubmit, isSubmitting]) => (
                            <Button disabled={!canSubmit || isSubmitting || saving} type="submit" variant="outline">
                              Create Session here
                            </Button>
                          )}
                        </sessionForm.Subscribe>
                      </form>
                      <div className={styles.dataColumns}>
                        <section>
                          <h4>
                            Workspaces <Tag tone="quiet">{status.workspaces.length}</Tag>
                          </h4>
                          {status.workspaces.length === 0 ? (
                            <EmptyState compact title="No workspaces reported" />
                          ) : (
                            <ul className={styles.dataList}>
                              {status.workspaces.map(workspace => (
                                <li key={workspace.workspaceId}>
                                  <button type="button" className={styles.workspaceButton} onClick={() => sessionForm.setFieldValue('cwd', workspace.path)}>
                                    <strong>{workspace.title}</strong>
                                    <span>{workspace.path}</span>
                                  </button>
                                </li>
                              ))}
                            </ul>
                          )}
                        </section>
                        <section>
                          <h4>
                            Sessions <Tag tone="quiet">{status.sessions.length}</Tag>
                          </h4>
                          {status.sessions.length === 0 ? (
                            <EmptyState compact title="No sessions reported" />
                          ) : (
                            <ul className={styles.dataList}>
                              {status.sessions.map(session => (
                                <li key={session.sessionId}>
                                  <div className={styles.sessionRow}>
                                    <strong>{session.sessionId}</strong>
                                    <span>{session.running ? 'running' : session.blank ? 'blank' : 'idle'}</span>
                                  </div>
                                  <small>{session.cwd ?? 'No working directory'}</small>
                                </li>
                              ))}
                            </ul>
                          )}
                        </section>
                      </div>
                    </>
                  ) : (
                    <Notice tone="warning" title={status === null ? 'Checking runtime identity…' : status.message}>
                      {status?.lastSeenAt === undefined ? 'No successful connection yet.' : `Last verified ${new Date(status.lastSeenAt).toLocaleString()}.`}
                    </Notice>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </section>
      <ConfirmDialog
        busy={saving}
        cancelLabel="Keep host"
        closeLabel="Close remove host dialog"
        confirmLabel="Remove host"
        description="This removes the host and its local directory references. Remote runtime data stays intact."
        onCancel={() => setRemovingHost(null)}
        onConfirm={() => void removeHost()}
        open={removingHost !== null}
        title={removingHost === null ? 'Remove host?' : `Remove ${removingHost.name}?`}
        tone="danger"
      />
    </main>
  )
}
