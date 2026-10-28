import { useId, useState } from 'react'
import { isApiOwnerMissing } from '@dshfiles/dshx/api'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { useAppForm } from '@dshfiles/plugin-ui/form'
import { errorMessage, useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import type { PackDefinition, ResourceRecord, ResourceRef } from './model.js'
import { MutationError, ResourceDialog } from './dialogs.js'
import { PropertyInput } from './editor-fields.js'
import { ResourceUiModel, type ResourcePacksClient } from './ui-helpers.js'

export function ResourceValuesForm(props: {
  api: ResourcePacksClient
  resource: ResourceRecord
  pack: PackDefinition
  references: readonly ResourceRecord[]
  onSaved: (resource: ResourceRecord) => void
  onCancel: () => void
}): JSX.Element {
  const mutation = useMutation({
    mutationFn: (draft: ReturnType<typeof ResourceUiModel.validatedValues>) =>
      props.api.setValues({
        resourceId: props.resource.id,
        expectedRevision: props.resource.revision,
        packId: props.pack.id,
        values: ResourceUiModel.validatedValues(props.pack, draft),
      }),
    onSuccess: props.onSaved,
  })
  const form = useAppForm({
    defaultValues: { values: ResourceUiModel.attachmentFor(props.resource, props.pack.id)?.values ?? {} },
    onSubmit: async ({ value }) => {
      await mutation.mutateAsync(value.values).catch(() => undefined)
    },
  })
  return (
    <form
      className="dshx:grid dshx:gap-4"
      onSubmit={event => {
        event.preventDefault()
        event.stopPropagation()
        void form.handleSubmit()
      }}
    >
      <p className="dshx:text-xs dshx:text-muted-foreground">
        Revision {props.resource.revision} is frozen for this draft. If another writer saves first, your save is refused; Cancel and reopen to load the latest
        values.
      </p>
      <form.Field name="values">
        {field => (
          <div className="dshx:grid dshx:gap-4">
            {props.pack.properties.map(property => (
              <PropertyInput
                key={property.id}
                property={property}
                value={Object.hasOwn(field.state.value, property.id) ? field.state.value[property.id] : undefined}
                resources={props.references}
                onChange={value => field.handleChange({ ...field.state.value, [property.id]: value })}
              />
            ))}
          </div>
        )}
      </form.Field>
      <MutationError error={mutation.error} />
      <div className="dshx:flex dshx:flex-wrap dshx:justify-end dshx:gap-2">
        <Button type="button" variant="outline" onClick={props.onCancel}>
          Cancel
        </Button>
        <form.AppForm>
          <form.SubmitButton disabled={mutation.isPending || props.pack.properties.every(property => property.readOnly)}>Save</form.SubmitButton>
        </form.AppForm>
      </div>
    </form>
  )
}

export function ResourceEditor(props: {
  api: ResourcePacksClient
  resourceId: string
  pack: PackDefinition | undefined
  references: readonly ResourceRecord[]
  openConversation: (ref: ResourceRef) => string | null
  onClose: () => void
  onSaved: () => void
}): JSX.Element {
  const queryClient = useQueryClient()
  // Separate one-open snapshot: page polling/invalidation must never replace an open Form draft or revision.
  const openToken = useId()
  const snapshotKey = ['resource-packs-editor', props.resourceId, openToken] as const
  const query = useQuery({
    queryKey: snapshotKey,
    queryFn: ({ signal }) => props.api.get({ resourceId: props.resourceId }, { signal }),
    retry: false,
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
  const [confirmDetach, setConfirmDetach] = useState(false)
  const [navigationError, setNavigationError] = useState<string | null>(null)
  const resource = query.data?.resource
  const attachment = resource === undefined || props.pack === undefined ? undefined : ResourceUiModel.attachmentFor(resource, props.pack.id)
  const change = useMutation({
    mutationFn: async (action: 'attach' | 'detach') => {
      if (resource === undefined || props.pack === undefined) throw new Error('Select an available property pack first.')
      const input = { resourceId: resource.id, expectedRevision: resource.revision, packId: props.pack.id }
      return action === 'attach' ? props.api.attach(input) : props.api.detach({ ...input, confirm: true })
    },
    onSuccess: updated => {
      queryClient.setQueryData(snapshotKey, { resource: updated, events: query.data?.events ?? [] })
      setConfirmDetach(false)
      void queryClient.invalidateQueries({ queryKey: ResourceUiModel.resourceKeys })
    },
  })
  return (
    <ResourceDialog heading="Edit resource" description="Edit local metadata. Save never runs an agent or changes native content." onClose={props.onClose}>
      {query.isPending && <p role="status">Loading resource…</p>}
      {query.error !== null && (
        <p role="alert">
          {isApiOwnerMissing(query.error) ? 'Resources unavailable: the Host plugin is not active.' : errorMessage(query.error, 'Could not load resource.')}
        </p>
      )}
      {resource !== undefined && (
        <div className="dshx:grid dshx:gap-4">
          <div>
            <h2 className="dshx:font-medium">{resource.label}</h2>
            <p className="dshx:break-all dshx:text-xs dshx:text-muted-foreground">{ResourceUiModel.refText(resource.ref)}</p>
            <p className="dshx:break-all dshx:text-xs dshx:text-muted-foreground">Resource ID: {resource.id}</p>
          </div>
          {resource.ref.provider === 'dsh' && resource.ref.kind === 'conversation' && (
            <Button variant="outline" onClick={() => setNavigationError(props.openConversation(resource.ref))}>
              Open conversation
            </Button>
          )}
          {navigationError !== null && <p role="alert">{navigationError}</p>}
          {props.pack === undefined ? (
            <p role="status">Choose a property pack to attach or edit its fields.</p>
          ) : (
            <>
              <h3 className="dshx:font-medium">
                {props.pack.label} · version {props.pack.version}
              </h3>
              {attachment?.attached !== true ? (
                <div className="dshx:grid dshx:gap-2">
                  <p className="dshx:text-sm dshx:text-muted-foreground">
                    {attachment === undefined ? 'This pack is not attached.' : 'Detached. Retained values will be restored when you reattach.'}
                  </p>
                  <Button disabled={change.isPending} onClick={() => change.mutate('attach')}>
                    Attach pack
                  </Button>
                  <Button variant="outline" onClick={props.onClose}>
                    Cancel
                  </Button>
                </div>
              ) : (
                <>
                  <ResourceValuesForm
                    key={`${resource.id}:${resource.revision}:${props.pack.id}`}
                    api={props.api}
                    resource={resource}
                    pack={props.pack}
                    references={props.references}
                    onCancel={props.onClose}
                    onSaved={() => {
                      props.onSaved()
                      props.onClose()
                    }}
                  />
                  {!confirmDetach ? (
                    <Button variant="outline" disabled={change.isPending} onClick={() => setConfirmDetach(true)}>
                      Detach pack
                    </Button>
                  ) : (
                    <div className="dshx:grid dshx:gap-2 dshx:rounded-md dshx:border dshx:p-3" role="group" aria-label="Confirm pack detachment">
                      <p>
                        Detach {props.pack.label} from {resource.label}? Values are retained and can be restored by reattaching. Any unsaved draft will be
                        discarded.
                      </p>
                      <div className="dshx:flex dshx:flex-wrap dshx:gap-2">
                        <Button variant="destructive" disabled={change.isPending} onClick={() => change.mutate('detach')}>
                          Confirm detach
                        </Button>
                        <Button variant="outline" disabled={change.isPending} onClick={() => setConfirmDetach(false)}>
                          Keep attached
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </>
          )}
          <MutationError error={change.error} />
          {query.data !== undefined && (
            <details>
              <summary>Metadata history</summary>
              <ul className="dshx:grid dshx:gap-1 dshx:text-xs">
                {query.data.events.length === 0 ? (
                  <li>No metadata events recorded.</li>
                ) : (
                  query.data.events.map(event => (
                    <li key={event.id}>
                      {event.action} · revision {event.revision} · {new Date(event.at).toLocaleString()}
                    </li>
                  ))
                )}
              </ul>
            </details>
          )}
        </div>
      )}
    </ResourceDialog>
  )
}
