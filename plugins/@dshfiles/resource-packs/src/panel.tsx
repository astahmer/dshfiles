import { useState } from 'react'
import { isApiOwnerMissing } from '@dshfiles/dshx/api'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Combobox } from '@dshfiles/plugin-ui/components/ui/combobox'
import { Input } from '@dshfiles/plugin-ui/components/ui/input'
import { useDebouncedValue } from '@dshfiles/plugin-ui/hooks/debounced-value'
import { errorMessage, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import type { ResourceRef } from './model.js'
import { AddResourceDialog, NewPackDialog } from './dialogs.js'
import { ResourceEditor } from './editor.js'
import { ResourceTable } from './table.js'
import { ResourceUiModel, type ResourcePacksClient } from './ui-helpers.js'

type DialogState = { kind: 'resource'; resourceId: string } | { kind: 'new-resource' } | { kind: 'new-pack' } | null

export function ResourcesPanel(props: { api: ResourcePacksClient; openConversation: (ref: ResourceRef) => string | null }): JSX.Element {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const debounced = useDebouncedValue({ value: search, delayMs: 200 })
  const [packId, setPackId] = useState('tracking')
  const [dialog, setDialog] = useState<DialogState>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const pollingInterval = (): number | false =>
    queryClient
      .getQueryCache()
      .findAll({ queryKey: ResourceUiModel.resourceKeys })
      .some(query => isApiOwnerMissing(query.state.error))
      ? false
      : 10_000
  const catalog = useQuery({
    queryKey: [...ResourceUiModel.resourceKeys, 'catalog'],
    queryFn: ({ signal }) => props.api.catalog(undefined, { signal }),
    retry: false,
    refetchInterval: pollingInterval,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  })
  const list = useQuery({
    queryKey: [...ResourceUiModel.resourceKeys, 'list', debounced],
    queryFn: ({ signal }) => props.api.list({ query: debounced, limit: 200 }, { signal }),
    enabled: catalog.isSuccess,
    retry: false,
    refetchInterval: pollingInterval,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  })
  const references = useQuery({
    queryKey: [...ResourceUiModel.resourceKeys, 'references'],
    queryFn: ({ signal }) => props.api.list({ limit: 200 }, { signal }),
    enabled: catalog.isSuccess,
    retry: false,
    refetchInterval: pollingInterval,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  })
  const unavailable = isApiOwnerMissing(catalog.error) || isApiOwnerMissing(list.error) || isApiOwnerMissing(references.error)
  const packs = catalog.data?.packs ?? []
  const pack = packs.find(pack => pack.definition.id === packId)?.definition
  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ResourceUiModel.resourceKeys })
  }
  const close = (): void => setDialog(current => (current === dialog ? null : current))
  return (
    <main className="dshx-root dshx:@container dshx:flex dshx:h-full dshx:min-h-0 dshx:min-w-0 dshx:flex-col dshx:gap-4 dshx:overflow-y-auto dshx:p-5">
      <header className="dshx:flex dshx:flex-wrap dshx:items-start dshx:justify-between dshx:gap-3">
        <div className="dshx:min-w-0">
          <h1 className="dshx:text-lg dshx:font-semibold">Resources</h1>
          <p className="dshx:text-sm dshx:text-muted-foreground">Standalone · local metadata only. No Notion sync. No action here runs an agent.</p>
        </div>
        <Button variant="outline" disabled={catalog.isFetching || unavailable} onClick={refresh}>
          Refresh resources
        </Button>
      </header>
      {unavailable ? (
        <p role="alert">
          Resources unavailable: the Host plugin is not active. No background retries will run. Reopen this page after the plugin is activated.
        </p>
      ) : (
        <>
          <div className="dshx:flex dshx:flex-wrap dshx:items-end dshx:gap-3">
            <div className="dshx:grid dshx:min-w-0 dshx:flex-1 dshx:gap-1">
              <label htmlFor="resource-search" className="dshx:text-sm">
                Search resources
              </label>
              <Input id="resource-search" value={search} onChange={event => setSearch(event.target.value)} />
            </div>
            <div className="dshx:min-w-0 dshx:w-60 dshx:max-w-full">
              <Combobox
                label="Property pack"
                value={packId}
                options={packs.map(pack => ({
                  value: pack.definition.id,
                  label: pack.definition.label,
                  description: `v${pack.definition.version} · ${pack.definition.properties.length} fields`,
                }))}
                onValueChange={setPackId}
                placeholder="Choose a property pack"
              />
            </div>
            <Button variant="outline" disabled={!catalog.isSuccess} onClick={() => setDialog({ kind: 'new-pack' })}>
              New pack
            </Button>
            <Button disabled={!catalog.isSuccess} onClick={() => setDialog({ kind: 'new-resource' })}>
              Add resource
            </Button>
          </div>
          {catalog.isPending && <p role="status">Loading property packs…</p>}
          {catalog.error !== null && <p role="alert">{errorMessage(catalog.error, 'Could not load packs.')}</p>}
          {list.error !== null && <p role="alert">{errorMessage(list.error, 'Could not load resources.')}</p>}
          {references.error !== null && (
            <p role="alert">{errorMessage(references.error, 'Reference choices could not be loaded. You can still enter a source reference.')}</p>
          )}
          {list.isFetching && <p role="status">Loading resources…</p>}
          {catalog.isSuccess && packs.length === 0 && <p role="status">No property packs registered. Create a pack to define reusable columns.</p>}
          {catalog.isSuccess && pack === undefined && packs.length > 0 && (
            <p role="status">The selected pack is unavailable. Choose a pack from the catalog.</p>
          )}
          {pack !== undefined && (
            <section aria-label="Selected pack" className="dshx:grid dshx:gap-1">
              <h2 className="dshx:text-sm dshx:font-medium">
                {pack.label} · version {pack.version}
              </h2>
              <p className="dshx:text-xs dshx:text-muted-foreground">
                {pack.description} · {pack.properties.length} fields. Unattached resources remain visible.
              </p>
            </section>
          )}
          {list.data !== undefined && (
            <>
              <p className="dshx:text-xs dshx:text-muted-foreground">
                Showing {list.data.resources.length} of {list.data.total} resources{list.data.total > 200 ? ' (first 200; refine your search)' : ''}.
              </p>
              <ResourceTable
                resources={list.data.resources}
                pack={pack}
                references={references.data?.resources ?? []}
                onOpenReference={ref => setNotice(props.openConversation(ref))}
                onEdit={resource => {
                  setNotice(null)
                  setDialog({ kind: 'resource', resourceId: resource.id })
                }}
              />
            </>
          )}
          {references.data !== undefined && references.data.total > 200 && (
            <p role="status">Reference picker shows the first 200 registered resources. Enter a source reference for other resources.</p>
          )}
          {notice !== null && <p role="status">{notice}</p>}
          {dialog?.kind === 'new-resource' && (
            <AddResourceDialog
              api={props.api}
              onClose={close}
              onCreated={() => {
                refresh()
                close()
                setNotice('Resource registered. Open its row to attach a pack.')
              }}
            />
          )}
          {dialog?.kind === 'new-pack' && (
            <NewPackDialog
              api={props.api}
              packs={packs}
              onClose={close}
              onCreated={created => {
                setPackId(created.definition.id)
                refresh()
                close()
                setNotice('Property pack created. Its stable IDs are now fixed.')
              }}
            />
          )}
          {dialog?.kind === 'resource' && (
            <ResourceEditor
              api={props.api}
              resourceId={dialog.resourceId}
              pack={pack}
              references={references.data?.resources ?? []}
              openConversation={props.openConversation}
              onClose={close}
              onSaved={() => {
                refresh()
                setNotice('Resource values saved.')
              }}
            />
          )}
        </>
      )}
    </main>
  )
}
