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
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@dshfiles/plugin-ui/components/ui/select'
import { Switch } from '@dshfiles/plugin-ui/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@dshfiles/plugin-ui/components/ui/tabs'
import { useCopyFeedback } from '@dshfiles/plugin-ui/hooks/copy-feedback'
import { errorMessage, useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { Schema } from 'effect'
import { useId, useState } from 'react'
import { clientSetups } from './client-setup.js'
import { endpointStatusSchema, mcpEndpointApi, pluginToolsSchema, type EndpointStatus, type PluginToolsMode } from './endpoint-api.js'

const statusKey = ['mcp-endpoint', 'status'] as const

const CopyField = (props: { readonly label: string; readonly value: string }): JSX.Element => {
  const { copied, copy } = useCopyFeedback()
  return (
    <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-1">
      <span className="dshx:text-xs dshx:font-medium dshx:text-muted-foreground">{props.label}</span>
      <div className="dshx:flex dshx:min-w-0 dshx:items-start dshx:gap-2">
        <code className="dshx:min-w-0 dshx:flex-1 dshx:whitespace-pre-wrap dshx:break-all dshx:rounded-md dshx:bg-muted dshx:px-2 dshx:py-1.5 dshx:text-xs">
          {props.value}
        </code>
        <Button type="button" size="sm" variant="outline" aria-label={`Copy ${props.label}`} onClick={() => void copy(props.value)}>
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
    </div>
  )
}

const Confirm = (props: {
  readonly trigger: string
  readonly heading: string
  readonly description: string
  readonly action: string
  readonly disabled: boolean
  readonly destructive?: boolean
  readonly onConfirm: () => void
}): JSX.Element => (
  <AlertDialog>
    <AlertDialogTrigger asChild>
      <Button type="button" size="sm" variant={props.destructive === true ? 'outline' : 'default'} disabled={props.disabled}>
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
        <AlertDialogAction variant={props.destructive === true ? 'destructive' : 'default'} onClick={props.onConfirm}>
          {props.action}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
)

const EndpointControls = (props: { readonly status: EndpointStatus }): JSX.Element => {
  const api = useApi(mcpEndpointApi)
  const queryClient = useQueryClient()
  const lanId = useId()
  const [issuedToken, setIssuedToken] = useState<string | undefined>(undefined)
  const publish = (status: EndpointStatus) => queryClient.setQueryData(statusKey, status)
  const rotate = useMutation({
    mutationFn: async () => api.rotateToken({}),
    onSuccess: result => {
      setIssuedToken(result.token)
      publish(Schema.decodeUnknownSync(endpointStatusSchema)(result.status))
    },
  })
  const revoke = useMutation({
    mutationFn: async () => Schema.decodeUnknownSync(endpointStatusSchema)(await api.revokeToken({ confirm: true })),
    onSuccess: status => {
      setIssuedToken(undefined)
      publish(status)
    },
  })
  const lan = useMutation({
    mutationFn: async (enabled: boolean) => Schema.decodeUnknownSync(endpointStatusSchema)(await api.setLanAccess({ enabled })),
    onSuccess: publish,
  })
  const pluginTools = useMutation({
    mutationFn: async (mode: PluginToolsMode) => Schema.decodeUnknownSync(endpointStatusSchema)(await api.setPluginTools({ mode })),
    onSuccess: publish,
  })
  const { status } = props
  const url = status.localUrl ?? `${window.location.origin}${status.path}`
  const pending = rotate.isPending || revoke.isPending
  const failure = rotate.error ?? revoke.error ?? lan.error ?? pluginTools.error
  return (
    <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-4">
      <CopyField label="Endpoint URL" value={url} />
      {status.lanUrl === null ? null : <CopyField label="LAN URL" value={status.lanUrl} />}
      <section aria-label="Bearer token" className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-3 dshx:rounded-xl dshx:border dshx:border-border dshx:p-4">
        <div className="dshx:flex dshx:min-w-0 dshx:items-center dshx:justify-between dshx:gap-3">
          <div className="dshx:min-w-0">
            <h3 className="dshx:m-0 dshx:text-sm dshx:font-medium">Bearer token</h3>
            <p role="status" className="dshx:m-0 dshx:mt-1 dshx:text-xs dshx:text-muted-foreground">
              {status.token === null ? 'No token: every client is refused.' : `Issued ${new Date(status.token.createdAt).toLocaleString()}`}
            </p>
          </div>
          <div className="dshx:flex dshx:shrink-0 dshx:gap-2">
            {status.token === null ? (
              <Button type="button" size="sm" disabled={pending} onClick={() => rotate.mutate()}>
                Generate token
              </Button>
            ) : (
              <>
                <Confirm
                  trigger="Rotate"
                  heading="Rotate the MCP token?"
                  description="Clients using the current token are refused until you give them the new one."
                  action="Rotate token"
                  disabled={pending}
                  onConfirm={() => rotate.mutate()}
                />
                <Confirm
                  trigger="Revoke"
                  heading="Revoke the MCP token?"
                  description="Every MCP client is refused until you generate a new token."
                  action="Revoke token"
                  disabled={pending}
                  destructive
                  onConfirm={() => revoke.mutate()}
                />
              </>
            )}
          </div>
        </div>
        {issuedToken === undefined ? null : (
          <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-3">
            <p role="alert" className="dshx:m-0 dshx:text-xs dshx:font-medium">
              Copy it now: DSH keeps only its hash and cannot show it again.
            </p>
            <CopyField label="Token" value={issuedToken} />
          </div>
        )}
      </section>
      <section aria-label="Connect a client" className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-3">
        <h3 className="dshx:m-0 dshx:text-sm dshx:font-medium">Connect a client</h3>
        <Tabs defaultValue="claude" className="dshx:min-w-0">
          <TabsList aria-label="Client" className="dshx:h-auto! dshx:max-w-full dshx:flex-wrap dshx:justify-start">
            {clientSetups({ url, token: issuedToken }).map(client => (
              <TabsTrigger className="dshx:min-h-11" key={client.id} value={client.id}>
                {client.label}
              </TabsTrigger>
            ))}
          </TabsList>
          {clientSetups({ url, token: issuedToken }).map(client => (
            <TabsContent key={client.id} value={client.id} className="dshx:min-w-0 dshx:space-y-2">
              <CopyField label={client.label} value={client.snippet} />
              {'installUrl' in client && client.installUrl !== undefined ? (
                <Button asChild variant="outline" className="dshx:min-h-11">
                  <a href={client.installUrl}>Add to {client.label}</a>
                </Button>
              ) : null}
            </TabsContent>
          ))}
        </Tabs>
        <p className="dshx:m-0 dshx:text-sm">
          Use <code>dshx tools</code> for scripts on this machine; no token is needed.
        </p>
      </section>
      <div className="dshx:flex dshx:min-w-0 dshx:items-center dshx:justify-between dshx:gap-4">
        <label className="dshx:text-sm dshx:font-medium" htmlFor={lanId}>
          LAN access
        </label>
        <Switch id={lanId} checked={status.lanEnabled} disabled={lan.isPending} onCheckedChange={checked => lan.mutate(checked)} />
      </div>
      <div className="dshx:flex dshx:min-w-0 dshx:items-center dshx:justify-between dshx:gap-4">
        <span className="dshx:text-sm dshx:font-medium">Plugin tools</span>
        <Select
          value={status.pluginTools}
          disabled={pluginTools.isPending}
          onValueChange={value => {
            const mode = Schema.decodeUnknownOption(pluginToolsSchema)(value)
            if (mode._tag === 'Some') pluginTools.mutate(mode.value)
          }}
        >
          <SelectTrigger aria-label="Plugin tools">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="off">Off</SelectItem>
            <SelectItem value="read-only">Read-only</SelectItem>
            <SelectItem value="read-write">Read-write</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {failure === null ? null : (
        <p role="alert" className="dshx:m-0 dshx:text-sm dshx:text-destructive">
          {errorMessage(failure, 'The MCP endpoint did not answer. Restart DSH if the plugin was just installed, then try again.')}
        </p>
      )}
    </div>
  )
}

export const EndpointSection = (): JSX.Element => {
  const api = useApi(mcpEndpointApi)
  const query = useQuery({
    queryKey: statusKey,
    retry: false,
    queryFn: async ({ signal }) => Schema.decodeUnknownSync(endpointStatusSchema)(await api.status({}, { signal })),
  })
  return (
    <section className="dshx-root dshx:@container dshx:flex dshx:min-w-0 dshx:max-w-2xl dshx:flex-col dshx:gap-4">
      <h2 className="dshx:m-0 dshx:text-lg dshx:font-semibold">MCP endpoint</h2>
      {query.isPending ? (
        <p role="status" className="dshx:m-0 dshx:text-sm dshx:text-muted-foreground">
          Loading…
        </p>
      ) : null}
      {query.isError ? (
        <div role="alert" className="dshx:flex dshx:flex-col dshx:items-start dshx:gap-2 dshx:text-sm dshx:text-muted-foreground">
          <p className="dshx:m-0">The MCP endpoint Host plugin is not running. Restart DSH after installing it, then retry.</p>
          <Button type="button" size="sm" variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}>
            Retry
          </Button>
        </div>
      ) : null}
      {query.data === undefined ? null : <EndpointControls status={query.data} />}
    </section>
  )
}
