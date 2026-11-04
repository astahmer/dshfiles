import { useApi } from '@dshfiles/dshx/client'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@dshfiles/plugin-ui/components/ui/alert-dialog'
import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Switch } from '@dshfiles/plugin-ui/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@dshfiles/plugin-ui/components/ui/table'
import { revalidateLogic, useAppForm } from '@dshfiles/plugin-ui/form'
import { useCopyFeedback } from '@dshfiles/plugin-ui/hooks/copy-feedback'
import { errorMessage, useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { Schema } from 'effect'
import { useId, useState } from 'react'
import { publishStatusSchema, shareRowSchema, threadOptionSchema, threadShareApi, type PublishStatus, type ShareRow } from './share-api.js'
import { EXPIRY_PRESETS, PASSPHRASE_MAX, PASSPHRASE_MIN, type ExpiryPreset } from './share-policy-constants.js'

const keys = {
  list: (includeInactive: boolean) => ['thread-share', 'list', includeInactive] as const,
  all: ['thread-share', 'list'] as const,
  threads: ['thread-share', 'threads'] as const,
  publish: ['thread-share', 'publish'] as const,
}

const RESTART_HINT = 'The Thread sharing Host plugin did not answer. Restart DSH after installing it, then retry.'

const decodeRows = Schema.decodeUnknownSync(Schema.Struct({ shares: Schema.Array(shareRowSchema), routePath: Schema.String }))
const decodeThreads = Schema.decodeUnknownSync(Schema.Struct({ threads: Schema.Array(threadOptionSchema) }))
const decodePublish = Schema.decodeUnknownSync(publishStatusSchema)

const when = (epochMs: number | null): string => (epochMs === null ? 'Never' : new Date(epochMs).toLocaleString())

const CopyField = (props: { readonly label: string; readonly value: string }): JSX.Element => {
  const { copied, copy } = useCopyFeedback()
  return (
    <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-1">
      <span className="dshx:text-xs dshx:font-medium dshx:text-muted-foreground">{props.label}</span>
      <div className="dshx:flex dshx:min-w-0 dshx:items-start dshx:gap-2">
        <code className="dshx:min-w-0 dshx:flex-1 dshx:break-all dshx:rounded-md dshx:bg-muted dshx:px-2 dshx:py-1.5 dshx:text-xs">{props.value}</code>
        <Button type="button" size="sm" variant="outline" aria-label={`Copy ${props.label}`} onClick={() => void copy(props.value)}>
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
    </div>
  )
}

const Confirm = (props: {
  readonly trigger: string
  readonly triggerLabel?: string
  readonly heading: string
  readonly description: string
  readonly action: string
  readonly disabled: boolean
  readonly onConfirm: () => void
}): JSX.Element => (
  <AlertDialog>
    <AlertDialogTrigger asChild>
      <Button type="button" size="sm" variant="outline" disabled={props.disabled} aria-label={props.triggerLabel ?? props.trigger}>
        {props.trigger}
      </Button>
    </AlertDialogTrigger>
    <AlertDialogContent className="dshx-root" size="sm">
      <AlertDialogHeader>
        <AlertDialogTitle>{props.heading}</AlertDialogTitle>
        <AlertDialogDescription>{props.description}</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <AlertDialogAction variant="destructive" onClick={props.onConfirm}>
          {props.action}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
)

const createFormSchema = Schema.toStandardSchemaV1(
  Schema.Struct({
    sessionId: Schema.String.check(Schema.isMinLength(1, { message: 'Choose a thread.' })),
    kind: Schema.Literals(['live', 'snapshot']),
    access: Schema.Literals(['link', 'protected']),
    passphrase: Schema.String.check(Schema.isMaxLength(PASSPHRASE_MAX)),
    expiry: Schema.Literals(EXPIRY_PRESETS),
  }).check(
    Schema.makeFilter(value =>
      value.access === 'link' || value.passphrase.length >= PASSPHRASE_MIN ? undefined : `Use a passphrase of at least ${String(PASSPHRASE_MIN)} characters.`,
    ),
  ),
)

/** The Settings form draft: every choice the create method takes, with the passphrase always present as text. */
interface CreateValues {
  readonly sessionId: string
  readonly kind: 'live' | 'snapshot'
  readonly access: 'link' | 'protected'
  readonly passphrase: string
  readonly expiry: ExpiryPreset
}

const CREATE_DEFAULTS: CreateValues = { sessionId: '', kind: 'live', access: 'link', passphrase: '', expiry: '1d' }

interface Created {
  readonly share: ShareRow
  readonly links: ReadonlyArray<{ readonly label: string; readonly url: string }>
}

const downloadHtml = (input: { readonly fileName: string; readonly html: string }): void => {
  const url = URL.createObjectURL(new Blob([input.html], { type: 'text/html' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = input.fileName
  anchor.click()
  URL.revokeObjectURL(url)
}

const CreateShare = (): JSX.Element => {
  const api = useApi(threadShareApi)
  const queryClient = useQueryClient()
  const [created, setCreated] = useState<Created | undefined>(undefined)
  const threads = useQuery({
    queryKey: keys.threads,
    retry: false,
    queryFn: async ({ signal }) => decodeThreads(await api.threads({}, { signal })).threads,
  })
  const create = useMutation({
    mutationFn: async (input: CreateValues) =>
      input.access === 'protected'
        ? api.create({ sessionId: input.sessionId, kind: input.kind, access: 'protected', expiry: input.expiry, passphrase: input.passphrase })
        : api.create({ sessionId: input.sessionId, kind: input.kind, access: 'link', expiry: input.expiry }),
    onSuccess: result => {
      setCreated({
        share: result.share,
        links: [{ label: 'Share link', url: `${window.location.origin}${result.path}` }, ...result.links.filter(link => link.label !== 'DSH server')],
      })
      void queryClient.invalidateQueries({ queryKey: keys.all })
    },
  })
  const exportFile = useMutation({
    mutationFn: async (sessionId: string) => api.exportHtml({ sessionId }),
    onSuccess: downloadHtml,
  })
  const form = useAppForm({
    defaultValues: CREATE_DEFAULTS,
    validationLogic: revalidateLogic(),
    validators: { onDynamic: createFormSchema },
    onSubmit: async ({ value, formApi }) => {
      setCreated(undefined)
      await create.mutateAsync(value).catch(() => undefined)
      formApi.setFieldValue('passphrase', '')
    },
  })
  const threadOptions = (threads.data ?? []).map(thread => ({ value: thread.sessionId, label: thread.title }))
  return (
    <section
      aria-label="Create a share link"
      className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-3 dshx:rounded-xl dshx:border dshx:border-border dshx:p-4"
    >
      <h3 className="dshx:m-0 dshx:text-sm dshx:font-medium">Create a share link</h3>
      <form
        className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-3"
        onSubmit={event => {
          event.preventDefault()
          void form.handleSubmit()
        }}
      >
        <form.AppField name="sessionId">
          {field => (
            <field.SelectField
              label="Thread"
              required
              options={threadOptions}
              placeholder={
                threads.isPending ? 'Loading threads…' : threadOptions.length === 0 ? 'No threads yet: start one, then reopen this section' : 'Choose a thread'
              }
            />
          )}
        </form.AppField>
        <div className="dshx:grid dshx:min-w-0 dshx:grid-cols-3 dshx:gap-3 dshx:@max-pane-narrow:grid-cols-1">
          <form.AppField name="kind">
            {field => (
              <field.SelectField
                label="View"
                options={[
                  { value: 'live', label: 'Live' },
                  { value: 'snapshot', label: 'Snapshot' },
                ]}
              />
            )}
          </form.AppField>
          <form.AppField name="access">
            {field => (
              <field.SelectField
                label="Access"
                options={[
                  { value: 'link', label: 'Anyone with the link' },
                  { value: 'protected', label: 'Link + passphrase' },
                ]}
              />
            )}
          </form.AppField>
          <form.AppField name="expiry">
            {field => (
              <field.SelectField
                label="Expires"
                options={[
                  { value: '1h', label: 'In 1 hour' },
                  { value: '1d', label: 'In 1 day' },
                  { value: '7d', label: 'In 7 days' },
                  { value: 'never', label: 'Never' },
                ]}
              />
            )}
          </form.AppField>
        </div>
        <form.Subscribe selector={state => state.values.access}>
          {access =>
            access === 'protected' ? (
              <form.AppField name="passphrase">
                {field => (
                  <field.TextField
                    label="Passphrase"
                    type="password"
                    autoComplete="new-password"
                    required
                    description="Only a salted hash is kept. Send it to viewers separately from the link."
                  />
                )}
              </form.AppField>
            ) : null
          }
        </form.Subscribe>
        <p className="dshx:m-0 dshx:text-xs dshx:text-muted-foreground">
          The page shows only user and assistant messages (the latest 100). Secret-looking values and home paths are redacted, but review the thread before you
          share it.
        </p>
        <div className="dshx:flex dshx:flex-wrap dshx:gap-2">
          <form.AppForm>
            <form.SubmitButton disabled={create.isPending}>Create share link</form.SubmitButton>
          </form.AppForm>
          <form.Subscribe selector={state => state.values.sessionId}>
            {sessionId => (
              <Button type="button" variant="outline" disabled={sessionId === '' || exportFile.isPending} onClick={() => exportFile.mutate(sessionId)}>
                Download HTML
              </Button>
            )}
          </form.Subscribe>
        </div>
      </form>
      {created === undefined ? null : (
        <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-3">
          <p role="alert" className="dshx:m-0 dshx:text-xs dshx:font-medium">
            Copy the link now: DSH keeps only its hash and cannot show it again.
          </p>
          {created.links.map(link => (
            <CopyField key={link.label} label={link.label} value={link.url} />
          ))}
        </div>
      )}
      {threads.isError || create.isError || exportFile.isError ? (
        <p role="alert" className="dshx:m-0 dshx:text-sm dshx:text-destructive">
          {errorMessage(create.error ?? exportFile.error ?? threads.error, RESTART_HINT)}
        </p>
      ) : null}
    </section>
  )
}

const statusLabel = { active: 'Active', expired: 'Expired', revoked: 'Revoked' } as const satisfies Record<ShareRow['status'], string>

const ShareList = (): JSX.Element => {
  const api = useApi(threadShareApi)
  const queryClient = useQueryClient()
  const switchId = useId()
  const [includeInactive, setIncludeInactive] = useState(false)
  const list = useQuery({
    queryKey: keys.list(includeInactive),
    retry: false,
    refetchInterval: 30_000,
    queryFn: async ({ signal }) => decodeRows(await api.list({ includeInactive }, { signal })).shares,
  })
  const revoke = useMutation({
    mutationFn: async (id: string) => api.revoke({ id, confirm: true }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: keys.all }),
  })
  const rows = list.data ?? []
  return (
    <section aria-label="Shares" className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-3">
      <div className="dshx:flex dshx:min-w-0 dshx:items-center dshx:justify-between dshx:gap-3">
        <h3 className="dshx:m-0 dshx:text-sm dshx:font-medium">Shares</h3>
        <div className="dshx:flex dshx:items-center dshx:gap-2">
          <label className="dshx:text-xs dshx:text-muted-foreground" htmlFor={switchId}>
            Show expired and revoked
          </label>
          <Switch id={switchId} checked={includeInactive} onCheckedChange={setIncludeInactive} />
        </div>
      </div>
      {list.isPending ? (
        <p role="status" className="dshx:m-0 dshx:text-sm dshx:text-muted-foreground">
          Loading…
        </p>
      ) : rows.length === 0 ? (
        <p role="status" className="dshx:m-0 dshx:text-sm dshx:text-muted-foreground">
          No active shares. Create one above.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Thread</TableHead>
              <TableHead>Access</TableHead>
              <TableHead>Expires</TableHead>
              <TableHead>Views</TableHead>
              <TableHead>
                <span className="dshx:sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(row => (
              <TableRow key={row.id}>
                <TableCell className="dshx:min-w-0">
                  <div className="dshx:flex dshx:min-w-0 dshx:flex-col">
                    <span className="dshx:min-w-0 dshx:truncate dshx:font-medium">{row.title}</span>
                    <span className="dshx:text-xs dshx:text-muted-foreground">
                      {row.kind === 'live' ? 'Live' : 'Snapshot'} · created {when(row.createdAt)}
                    </span>
                  </div>
                </TableCell>
                <TableCell>{row.access === 'link' ? 'Anyone with link' : 'Passphrase'}</TableCell>
                <TableCell>{row.status === 'active' ? when(row.expiresAt) : <Badge variant="outline">{statusLabel[row.status]}</Badge>}</TableCell>
                <TableCell>{row.views}</TableCell>
                <TableCell>
                  {row.status === 'active' ? (
                    <Confirm
                      trigger="Revoke"
                      triggerLabel={`Revoke share of ${row.title}`}
                      heading="Revoke this share?"
                      description="The link stops working at once and a snapshot is deleted. This cannot be undone; create a new share to share again."
                      action="Revoke share"
                      disabled={revoke.isPending}
                      onConfirm={() => revoke.mutate(row.id)}
                    />
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {list.isError || revoke.isError ? (
        <div role="alert" className="dshx:flex dshx:flex-col dshx:items-start dshx:gap-2 dshx:text-sm dshx:text-destructive">
          <p className="dshx:m-0">{errorMessage(revoke.error ?? list.error, RESTART_HINT)}</p>
          <Button type="button" size="sm" variant="outline" onClick={() => void list.refetch()}>
            Retry
          </Button>
        </div>
      ) : null}
    </section>
  )
}

const providerLabel = { 'tailscale-funnel': 'Tailscale Funnel', cloudflared: 'cloudflared quick tunnel' } as const satisfies Record<
  'tailscale-funnel' | 'cloudflared',
  string
>

const PublishPanel = (): JSX.Element => {
  const api = useApi(threadShareApi)
  const queryClient = useQueryClient()
  const [provider, setProvider] = useState<'tailscale-funnel' | 'cloudflared'>('cloudflared')
  const [minutes, setMinutes] = useState<15 | 60 | 240>(60)
  const status = useQuery({
    queryKey: keys.publish,
    retry: false,
    refetchInterval: 5_000,
    queryFn: async ({ signal }): Promise<PublishStatus> => decodePublish(await api.publishStatus({}, { signal })),
  })
  const publish = (next: PublishStatus) => queryClient.setQueryData(keys.publish, next)
  const start = useMutation({ mutationFn: async () => decodePublish(await api.publishStart({ provider, minutes, confirm: true })), onSuccess: publish })
  const stop = useMutation({ mutationFn: async () => decodePublish(await api.publishStop({})), onSuccess: publish })
  const data = status.data
  const available = data === undefined ? false : provider === 'cloudflared' ? data.tools.cloudflared.available : data.tools.tailscale.available
  return (
    <section
      aria-label="Publish to the internet"
      className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-3 dshx:rounded-xl dshx:border dshx:border-border dshx:p-4"
    >
      <h3 className="dshx:m-0 dshx:text-sm dshx:font-medium">Publish to the internet (optional)</h3>
      <p className="dshx:m-0 dshx:text-xs dshx:text-muted-foreground">
        Share links work wherever this DSH is reachable. To reach people outside your network, run a tunnel for a limited time. It serves only share pages from
        a separate local listener, never the DSH app, and stops by itself.
      </p>
      {data === undefined ? null : (
        <div className="dshx:flex dshx:flex-wrap dshx:gap-2">
          <Badge variant={data.tools.cloudflared.available ? 'secondary' : 'outline'}>
            cloudflared {data.tools.cloudflared.available ? 'installed' : 'not installed'}
          </Badge>
          <Badge variant={data.tools.tailscale.available ? 'secondary' : 'outline'}>
            tailscale {data.tools.tailscale.available ? 'installed' : 'not installed'}
          </Badge>
        </div>
      )}
      {data?.active == null ? (
        <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2">
          <div className="dshx:flex dshx:gap-1" role="radiogroup" aria-label="Tunnel">
            {(['cloudflared', 'tailscale-funnel'] as const).map(option => (
              <Button
                key={option}
                type="button"
                size="sm"
                variant={provider === option ? 'default' : 'outline'}
                role="radio"
                aria-checked={provider === option}
                onClick={() => setProvider(option)}
              >
                {providerLabel[option]}
              </Button>
            ))}
          </div>
          <div className="dshx:flex dshx:gap-1" role="radiogroup" aria-label="Duration">
            {([15, 60, 240] as const).map(option => (
              <Button
                key={option}
                type="button"
                size="sm"
                variant={minutes === option ? 'default' : 'outline'}
                role="radio"
                aria-checked={minutes === option}
                onClick={() => setMinutes(option)}
              >
                {option < 60 ? `${String(option)} min` : `${String(option / 60)} h`}
              </Button>
            ))}
          </div>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button type="button" size="sm" disabled={!available || start.isPending}>
                Start publishing
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent className="dshx-root" size="sm">
              <AlertDialogHeader>
                <AlertDialogTitle>Publish share links on the internet?</AlertDialogTitle>
                <AlertDialogDescription>
                  Anyone with an active share link can open it through {providerLabel[provider]} for{' '}
                  {minutes < 60 ? `${String(minutes)} minutes` : `${String(minutes / 60)} hours`}. Only share pages are reachable; stop at any time.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => start.mutate()}>Publish</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      ) : (
        <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-2">
          <p role="status" className="dshx:m-0 dshx:text-sm">
            {providerLabel[data.active.provider]}:{' '}
            {data.active.state === 'published'
              ? `published until ${when(data.active.stopsAt)}`
              : data.active.state === 'starting'
                ? 'starting…'
                : 'stopped with an error'}
          </p>
          {data.active.publicUrl === null ? null : <CopyField label="Public base URL (append a share path)" value={data.active.publicUrl} />}
          {data.active.detail === null ? null : <p className="dshx:m-0 dshx:text-xs dshx:text-muted-foreground">{data.active.detail}</p>}
          <div>
            <Button type="button" size="sm" variant="outline" disabled={stop.isPending} onClick={() => stop.mutate()}>
              Stop publishing
            </Button>
          </div>
        </div>
      )}
      {!available && data !== undefined && data.active === null ? (
        <p className="dshx:m-0 dshx:text-xs dshx:text-muted-foreground">
          Install {provider === 'cloudflared' ? 'cloudflared (brew install cloudflared)' : 'Tailscale and enable Funnel for this machine'} to publish with it.
        </p>
      ) : null}
      {status.isError || start.isError || stop.isError ? (
        <p role="alert" className="dshx:m-0 dshx:text-sm dshx:text-destructive">
          {errorMessage(start.error ?? stop.error ?? status.error, RESTART_HINT)}
        </p>
      ) : null}
    </section>
  )
}

export const ShareSection = (): JSX.Element => (
  <section className="dshx-root dshx:@container dshx:flex dshx:min-w-0 dshx:max-w-2xl dshx:flex-col dshx:gap-4">
    <div>
      <h2 className="dshx:m-0 dshx:text-lg dshx:font-semibold">Thread sharing</h2>
      <p className="dshx:m-0 dshx:mt-1 dshx:text-sm dshx:text-muted-foreground">
        Share one thread as a read-only page. Viewers never get the DSH app, its tools or other threads.
      </p>
    </div>
    <CreateShare />
    <ShareList />
    <PublishPanel />
  </section>
)
