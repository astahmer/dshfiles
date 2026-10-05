import { z } from 'zod'
import { useApi } from '@dshfiles/dshx/client'
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { multiHostApi, type HostSummary, type RuntimeSummary, type RuntimeStatus } from './api.js'
import styles from './multi-host.module.css'

type Directory = { readonly hosts: readonly HostSummary[]; readonly runtimes: readonly RuntimeSummary[] }
type ViewWindow = { readonly popup: Window; readonly timer: number; readonly runtimeId: string }

const sessionCreatedSchema = z.object({ sessionId: z.string().min(1) })

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
  const [directory, setDirectory] = useState<Directory>({ hosts: [], runtimes: [] })
  const [selectedRuntimeId, setSelectedRuntimeId] = useState('')
  const [status, setStatus] = useState<RuntimeStatus | null>(null)
  const [openViewRuntimeIds, setOpenViewRuntimeIds] = useState<ReadonlySet<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [hostKind, setHostKind] = useState<'local' | 'ssh'>('ssh')
  const [hostId, setHostId] = useState('')
  const [hostName, setHostName] = useState('')
  const [sshTarget, setSshTarget] = useState('')
  const [runtimeHostId, setRuntimeHostId] = useState('')
  const [runtimeName, setRuntimeName] = useState('')
  const [launchUrl, setLaunchUrl] = useState('')
  const [unit, setUnit] = useState('')
  const [remoteHome, setRemoteHome] = useState('')
  const [workspacePath, setWorkspacePath] = useState('')
  const [newSessionCwd, setNewSessionCwd] = useState('')
  const generations = useRef({ directory: 0, status: 0 })
  const viewWindows = useRef(new Map<string, ViewWindow>())
  const requestControllers = useRef(new Set<AbortController>())

  const selectedRuntime = useMemo(() => directory.runtimes.find(runtime => runtime.id === selectedRuntimeId), [directory.runtimes, selectedRuntimeId])
  const selectedHost = directory.hosts.find(host => host.id === selectedRuntime?.hostId)

  const refresh = useCallback(async (): Promise<void> => {
    const generation = ++generations.current.directory
    const controller = createRequestController(requestControllers.current)
    setLoading(true)
    setError(null)
    try {
      const next = await api.list(undefined, { signal: controller.signal })
      if (generation !== generations.current.directory) return
      setDirectory(next)
      setSelectedRuntimeId(current => (next.runtimes.some(runtime => runtime.id === current) ? current : (next.runtimes[0]?.id ?? '')))
      setRuntimeHostId(current => (next.hosts.some(host => host.id === current) ? current : (next.hosts[0]?.id ?? '')))
    } catch (reason) {
      if (!controller.signal.aborted && generation === generations.current.directory) setError(errorMessage(reason))
    } finally {
      releaseRequestController(requestControllers.current, controller)
      if (generation === generations.current.directory) setLoading(false)
    }
  }, [api])

  useEffect(() => {
    void refresh()
    return () => {
      generations.current.directory += 1
      for (const controller of requestControllers.current) controller.abort()
      requestControllers.current.clear()
    }
  }, [refresh])

  useEffect(() => {
    if (selectedRuntime === undefined) {
      setStatus(null)
      return
    }
    const generation = ++generations.current.status
    const controller = createRequestController(requestControllers.current)
    let current = true
    setStatus(null)
    void api
      .runtimeStatus({ runtimeId: selectedRuntime.id }, { signal: controller.signal })
      .then(value => {
        if (current && generation === generations.current.status) setStatus(value)
      })
      .catch(reason => {
        if (current && !controller.signal.aborted && generation === generations.current.status) {
          setStatus({
            ok: false,
            hostId: selectedRuntime.hostId,
            runtimeId: selectedRuntime.id,
            code: 'runtime-unavailable',
            message: errorMessage(reason),
            stale: true,
            ...(selectedRuntime.lastSeenAt === undefined ? {} : { lastSeenAt: selectedRuntime.lastSeenAt }),
          })
        }
      })
      .finally(() => releaseRequestController(requestControllers.current, controller))
    return () => {
      current = false
      controller.abort()
    }
  }, [api, selectedRuntime])

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

  const submitHost = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const connector = hostKind === 'local' ? { kind: 'local' as const } : { kind: 'ssh' as const, sshTarget: sshTarget.trim() }
      await api.hostUpsert({ id: hostId.trim(), name: hostName.trim(), connector })
      setHostId('')
      setHostName('')
      setSshTarget('')
      setNotice('Host recorded. Add one or more DSH runtimes to it.')
      await refresh()
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setSaving(false)
    }
  }

  const submitRuntime = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    const host = directory.hosts.find(item => item.id === runtimeHostId)
    if (host === undefined) {
      setError('Choose a recorded host first.')
      return
    }
    setSaving(true)
    setError(null)
    setNotice(null)
    const controller = createRequestController(requestControllers.current)
    try {
      const locator =
        host.connector.kind === 'local' ? { kind: 'local' as const, launchUrl } : { kind: 'ssh' as const, unit: unit.trim(), remoteHome: remoteHome.trim() }
      const registration = await api.runtimeUpsert({ hostId: host.id, name: runtimeName.trim(), locator }, { signal: controller.signal })
      if (!registration.ok) throw new Error(`${registration.code}: ${registration.message}`)
      const runtime = registration.runtime
      setSelectedRuntimeId(runtime.id)
      setRuntimeName('')
      setLaunchUrl('')
      setUnit('')
      setRemoteHome('')
      setNotice(`Runtime ${runtime.id} authenticated and identity pinned.`)
      await refresh()
    } catch (reason) {
      if (!controller.signal.aborted) setError(errorMessage(reason))
    } finally {
      releaseRequestController(requestControllers.current, controller)
      setSaving(false)
    }
  }

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

  const openWorkspace = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (selectedRuntime === undefined) return
    setSaving(true)
    setError(null)
    setNotice(null)
    const controller = createRequestController(requestControllers.current)
    try {
      const workspace = await api.workspaceOpen({ runtimeId: selectedRuntime.id, path: workspacePath.trim() }, { signal: controller.signal })
      setWorkspacePath('')
      setNewSessionCwd(workspace.path)
      setNotice(`Workspace ${workspace.workspaceId} opened on ${selectedRuntime.id}.`)
      setStatus(current =>
        current?.ok === true
          ? { ...current, workspaces: [...current.workspaces.filter(item => item.workspaceId !== workspace.workspaceId), workspace] }
          : current,
      )
    } catch (reason) {
      if (!controller.signal.aborted) setError(errorMessage(reason))
    } finally {
      releaseRequestController(requestControllers.current, controller)
      setSaving(false)
    }
  }

  const createSession = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (selectedRuntime === undefined) return
    setSaving(true)
    setError(null)
    setNotice(null)
    const controller = createRequestController(requestControllers.current)
    try {
      const cwd = newSessionCwd.trim()
      const result = await api.runtimeCall(
        {
          runtimeId: selectedRuntime.id,
          request: { namespace: 'session', method: 'create', args: { request: cwd === '' ? {} : { cwd } } },
        },
        { signal: controller.signal },
      )
      if (!result.ok) throw new Error(result.message)
      const created = sessionCreatedSchema.parse(result.value)
      setNotice(`Created Session ${created.sessionId} on ${selectedRuntime.id}.`)
      setStatus(current =>
        current?.ok === true
          ? {
              ...current,
              sessions: [
                ...current.sessions,
                {
                  runtimeId: selectedRuntime.id,
                  sessionId: created.sessionId,
                  ...(newSessionCwd.trim() === '' ? {} : { cwd: newSessionCwd.trim() }),
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
      setSaving(false)
    }
  }

  const removeHost = async (host: HostSummary): Promise<void> => {
    setSaving(true)
    setError(null)
    try {
      await api.hostRemove({ id: host.id, removeDirectory: true })
      setNotice(`Removed ${host.name} and its local directory references. Remote runtime data remains intact.`)
      await refresh()
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setSaving(false)
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
        <button type="button" className={styles.secondaryButton} disabled={loading} onClick={() => void refresh()}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </header>

      {error !== null && (
        <div className={styles.error} role="alert">
          {error}
        </div>
      )}
      {notice !== null && (
        <div className={styles.notice} role="status">
          {notice}
        </div>
      )}

      <section className={styles.section} aria-labelledby="host-list-title">
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.eyebrow}>Machines</p>
            <h2 id="host-list-title">Host directory</h2>
          </div>
          <span className={styles.count}>{directory.hosts.length}</span>
        </div>
        {directory.hosts.length === 0 ? (
          <p className={styles.empty}>No hosts recorded yet.</p>
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
                <button type="button" className={styles.textButton} disabled={saving} onClick={() => void removeHost(host)}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={styles.forms} aria-label="Add execution host and runtime">
        <form className={styles.formCard} onSubmit={event => void submitHost(event)}>
          <div>
            <p className={styles.eyebrow}>Step 1</p>
            <h2>Add host</h2>
          </div>
          <label>
            Host id
            <input
              required
              maxLength={64}
              pattern="[A-Za-z0-9][A-Za-z0-9._\-]*"
              value={hostId}
              onChange={event => setHostId(event.target.value)}
              placeholder="workstation"
            />
          </label>
          <label>
            Display name
            <input required maxLength={120} value={hostName} onChange={event => setHostName(event.target.value)} placeholder="Workstation" />
          </label>
          <label>
            Connection
            <select value={hostKind} onChange={event => setHostKind(event.target.value === 'local' ? 'local' : 'ssh')}>
              <option value="local">Local machine</option>
              <option value="ssh">SSH host</option>
            </select>
          </label>
          {hostKind === 'ssh' && (
            <label>
              SSH target
              <input
                required
                maxLength={255}
                value={sshTarget}
                onChange={event => setSshTarget(event.target.value)}
                placeholder="deploy@host.example"
                autoComplete="off"
              />
            </label>
          )}
          <button className={styles.primaryButton} type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Record host'}
          </button>
        </form>

        <form className={styles.formCard} onSubmit={event => void submitRuntime(event)}>
          <div>
            <p className={styles.eyebrow}>Step 2</p>
            <h2>Attach runtime</h2>
          </div>
          <label>
            Host
            <select required value={runtimeHostId} onChange={event => setRuntimeHostId(event.target.value)}>
              <option value="">Choose a host</option>
              {directory.hosts.map(host => (
                <option key={host.id} value={host.id}>
                  {host.name} · {host.connector.kind}
                </option>
              ))}
            </select>
          </label>
          <label>
            Runtime name
            <input required maxLength={120} value={runtimeName} onChange={event => setRuntimeName(event.target.value)} placeholder="Web profile" />
          </label>
          {directory.hosts.find(host => host.id === runtimeHostId)?.connector.kind === 'local' ? (
            <label>
              Tokenized launch URL
              <input
                required
                type="password"
                autoComplete="off"
                value={launchUrl}
                onChange={event => setLaunchUrl(event.target.value)}
                placeholder="Paste from DSH startup output"
              />
            </label>
          ) : (
            <>
              <label>
                systemd user unit
                <input
                  required
                  maxLength={128}
                  pattern="[A-Za-z0-9][A-Za-z0-9_.@\-]*"
                  value={unit}
                  onChange={event => setUnit(event.target.value)}
                  placeholder="dsh-runtime"
                />
              </label>
              <label>
                Remote DSH_HOME
                <input
                  required
                  maxLength={1024}
                  value={remoteHome}
                  onChange={event => setRemoteHome(event.target.value)}
                  placeholder="/home/user/.dsh/runtime"
                />
              </label>
            </>
          )}
          <button className={styles.primaryButton} type="submit" disabled={saving || directory.hosts.length === 0}>
            {saving ? 'Connecting…' : 'Authenticate and pin identity'}
          </button>
        </form>
      </section>

      <section className={styles.section} aria-labelledby="runtime-title">
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.eyebrow}>Execution targets</p>
            <h2 id="runtime-title">Registered runtimes</h2>
          </div>
          <span className={styles.count}>{directory.runtimes.length}</span>
        </div>
        {directory.runtimes.length === 0 ? (
          <p className={styles.empty}>Attach a runtime to enable remote workspace and Session placement.</p>
        ) : (
          <div className={styles.runtimeLayout}>
            <nav className={styles.runtimeList} aria-label="Runtimes">
              {directory.runtimes.map(item => (
                <button
                  key={item.id}
                  type="button"
                  className={`${styles.runtimeChoice} ${selectedRuntimeId === item.id ? styles.runtimeChoiceSelected : ''}`}
                  onClick={() => setSelectedRuntimeId(item.id)}
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
                <p className={styles.empty}>Choose a runtime.</p>
              ) : (
                <>
                  <div className={styles.runtimeTitle}>
                    <div>
                      <p className={styles.eyebrow}>{selectedHost?.name ?? selectedRuntime.hostId}</p>
                      <h3>{selectedRuntime.name}</h3>
                      <p className={styles.runtimeId}>{selectedRuntime.id}</p>
                    </div>
                    <span
                      className={`${styles.statusPill} ${status?.ok === true ? styles.statusOnline : status === null ? styles.statusChecking : styles.statusOffline}`}
                    >
                      {status === null ? 'Checking' : status.ok ? 'Online' : 'Stale'}
                    </span>
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
                        <button
                          className={styles.primaryButton}
                          type="button"
                          disabled={openViewRuntimeIds.has(selectedRuntime.id)}
                          onClick={() => void openRuntimeView()}
                        >
                          {openViewRuntimeIds.has(selectedRuntime.id) ? 'Runtime view open' : 'Open native runtime view'}
                        </button>
                        <button
                          className={styles.secondaryButton}
                          type="button"
                          onClick={() => void closeRuntimeViews()}
                          disabled={viewWindows.current.size === 0}
                        >
                          Close runtime views
                        </button>
                      </div>
                      <form className={styles.inlineForm} onSubmit={event => void openWorkspace(event)}>
                        <label>
                          Open workspace path
                          <input
                            required
                            maxLength={1024}
                            value={workspacePath}
                            onChange={event => setWorkspacePath(event.target.value)}
                            placeholder="/absolute/path/on/runtime"
                          />
                        </label>
                        <button className={styles.secondaryButton} type="submit" disabled={saving}>
                          Open workspace
                        </button>
                      </form>
                      <form className={styles.inlineForm} onSubmit={event => void createSession(event)}>
                        <label>
                          New Session working directory
                          <input
                            maxLength={1024}
                            value={newSessionCwd}
                            onChange={event => setNewSessionCwd(event.target.value)}
                            placeholder="Optional runtime-local path"
                          />
                        </label>
                        <button className={styles.secondaryButton} type="submit" disabled={saving}>
                          Create Session here
                        </button>
                      </form>
                      <div className={styles.dataColumns}>
                        <section>
                          <h4>
                            Workspaces <span>{status.workspaces.length}</span>
                          </h4>
                          {status.workspaces.length === 0 ? (
                            <p className={styles.empty}>No workspaces reported.</p>
                          ) : (
                            <ul className={styles.dataList}>
                              {status.workspaces.map(workspace => (
                                <li key={workspace.workspaceId}>
                                  <button type="button" className={styles.workspaceButton} onClick={() => setNewSessionCwd(workspace.path)}>
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
                            Sessions <span>{status.sessions.length}</span>
                          </h4>
                          {status.sessions.length === 0 ? (
                            <p className={styles.empty}>No sessions reported.</p>
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
                    <div className={styles.staleCard} role="status">
                      <strong>{status === null ? 'Checking runtime identity…' : status.message}</strong>
                      <span>
                        {status?.lastSeenAt === undefined ? 'No successful connection yet.' : `Last verified ${new Date(status.lastSeenAt).toLocaleString()}.`}
                      </span>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </section>
    </main>
  )
}
