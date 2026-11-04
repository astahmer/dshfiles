// @vitest-environment jsdom
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PluginQueryProvider, QueryClient } from '@dshfiles/plugin-ui/query'
import { createHostApiClient } from '@dshfiles/dshx/host'
import { createTestHost, type TestHost } from '@dshfiles/dshx/testing'
import { resourcePacksApi } from './api.js'
import { AddResourceDialog, NewPackDialog } from './dialogs.js'
import { ResourceEditor, ResourceValuesForm } from './editor.js'
import { PropertyInput } from './editor-fields.js'
import { createResourcePacksPlugin } from './host.js'
import { ResourcesPanel } from './panel.js'
import { ResourceTable } from './table.js'
import { trackingPack, type PackDefinition, type PropertyDefinition, type ResourceRecord, type ResourceRef } from './model.js'
import { ResourceUiModel } from './ui-helpers.js'

const owner = '@dshfiles/resource-packs'
const guiPackage = '@test/resources-gui'
const ignore = () => undefined
let dshHome: string
let previousDshHome: string | undefined
const hosts: TestHost[] = []

beforeAll(() => {
  Element.prototype.scrollIntoView = ignore
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})
beforeEach(() => {
  previousDshHome = process.env['DSH_HOME']
  dshHome = mkdtempSync(join(tmpdir(), 'resource-packs-ui-'))
  process.env['DSH_HOME'] = dshHome
})
afterEach(async () => {
  cleanup()
  await Promise.all(hosts.splice(0).map(host => host.dispose()))
  if (previousDshHome === undefined) Reflect.deleteProperty(process.env, 'DSH_HOME')
  else process.env['DSH_HOME'] = previousDshHome
  rmSync(dshHome, { recursive: true, force: true })
})

const resource: ResourceRecord = {
  id: '01900000-0000-7000-8000-000000000001',
  label: 'Conversation review',
  ref: { provider: 'dsh', kind: 'conversation', id: 'fixture-thread' },
  revision: 3,
  attachments: [{ packId: 'tracking', attached: true, values: { assignee: 'Original' } }],
  createdAt: 0,
  updatedAt: 0,
}
const target: ResourceRecord = {
  ...resource,
  id: '01900000-0000-7000-8000-000000000002',
  label: 'Spec file',
  ref: { provider: 'local', kind: 'file', id: '/work/spec.md' },
  attachments: [],
}

/** A real Host serving the plugin, a GUI client, the pack owner, and the two fixture resources registered through the API. */
const seededHost = async () => {
  const host = await createTestHost()
  hosts.push(host)
  await host.mount(createResourcePacksPlugin(), { packageId: owner })
  const api = createHostApiClient(host.ctx, resourcePacksApi, guiPackage)
  const ownerApi = createHostApiClient(host.ctx, resourcePacksApi, owner)
  const registered = await api.registerResource({ ref: resource.ref, label: resource.label })
  const attached = await api.attach({ resourceId: registered.id, expectedRevision: registered.revision, packId: 'tracking' })
  const review = await api.setValues({ resourceId: attached.id, expectedRevision: attached.revision, packId: 'tracking', values: { assignee: 'Original' } })
  const spec = await api.registerResource({ ref: target.ref, label: target.label })
  return { host, api, ownerApi, review, spec }
}

function provider(children: React.ReactNode, queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })) {
  return { ...render(<PluginQueryProvider client={queryClient}>{children}</PluginQueryProvider>), queryClient }
}
async function choose(label: string, option: string | RegExp): Promise<void> {
  const trigger = screen.getByRole('combobox', { name: label })
  fireEvent.click(trigger)
  fireEvent.click(await screen.findByRole('option', { name: option }))
  // Wait for Radix close autofocus before opening another picker (like a real user).
  await waitFor(() => expect(document.activeElement).toBe(trigger))
}

const extraProperties: PropertyDefinition[] = [
  { id: 'count', label: 'Count', type: 'number', description: '', readOnly: false },
  { id: 'checked', label: 'Checked', type: 'checkbox', description: '', readOnly: false },
  { id: 'time', label: 'Appointment', type: 'datetime', description: '', readOnly: false },
  {
    id: 'tags',
    label: 'Tags',
    type: 'multiselect',
    description: '',
    readOnly: false,
    options: [
      { id: 'one', label: 'First' },
      { id: 'two', label: 'Second' },
    ],
  },
  { id: 'links', label: 'Links', type: 'references', description: '', readOnly: false },
  { id: 'source.value', label: 'Owner value', type: 'text', description: '', readOnly: true },
]
const allTypes: PackDefinition = { ...trackingPack, version: 2, properties: [...trackingPack.properties, ...extraProperties] }

describe('Resources UI', () => {
  it('selects a registered reference with its object value', async () => {
    const changes: unknown[] = []
    render(<PropertyInput property={trackingPack.properties[3]!} value={null} resources={[target]} onChange={value => changes.push(value)} />)
    await choose('Related resource', /Spec file/)
    expect(changes).toEqual([target.ref])
  })
  it('uses definition columns even when no values exist and shows unknown references as readable text', () => {
    provider(
      <ResourceTable
        resources={[{ ...resource, attachments: [{ packId: 'tracking', attached: true, values: {} }] }]}
        pack={allTypes}
        references={[target]}
        onEdit={ignore}
        onOpenReference={ignore}
      />,
    )
    for (const property of allTypes.properties)
      expect(screen.getByRole('columnheader', { name: `${property.label}${property.readOnly ? ' (read-only)' : ''}` })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Edit Conversation review' })).toBeDefined()
    expect(screen.getByRole('region', { name: 'Resource table' }).tabIndex).toBe(0)
    const reference = trackingPack.properties.find(property => property.id === 'related')!
    expect(ResourceUiModel.displayValue(reference, target.ref, [target])).toBe('Spec file')
    expect(ResourceUiModel.displayValue(reference, { provider: 'other', kind: 'record', id: 'missing' }, [])).toBe(
      'Unregistered reference: other / record / missing',
    )
  })

  it('opens readonly single and multiple conversation references explicitly and reports unavailable targets without opening an editor', async () => {
    const seeded = await seededHost()
    const missing: ResourceRef = { provider: 'dsh', kind: 'conversation', id: 'unavailable-conversation' }
    await seeded.ownerApi.registerPack({
      definition: {
        ...trackingPack,
        version: 2,
        properties: [
          ...trackingPack.properties,
          { id: 'source', label: 'Related conversation', type: 'reference', readOnly: true, description: '' },
          { id: 'links', label: 'Linked resources', type: 'references', readOnly: true, description: '' },
        ],
      },
    })
    const registered = await seeded.api.registerResource({ ref: { provider: 'local', kind: 'record', id: 'review-row' }, label: 'Review metadata' })
    const attached = await seeded.api.attach({ resourceId: registered.id, expectedRevision: registered.revision, packId: 'tracking' })
    const row = await seeded.ownerApi.setValues({
      resourceId: attached.id,
      expectedRevision: attached.revision,
      packId: 'tracking',
      values: { source: resource.ref, links: [missing, target.ref] },
    })
    const opened: ResourceRef[] = []
    const openConversation = (ref: ResourceRef) => {
      opened.push(ref)
      return ref.id === missing.id ? 'This conversation is unavailable. Its reference has been preserved.' : null
    }
    provider(<ResourcesPanel api={seeded.api} openConversation={openConversation} />)
    const known = await screen.findByRole('button', { name: 'Open conversation Conversation review' })
    expect(known.hasAttribute('disabled')).toBe(false)
    expect(opened).toEqual([])
    fireEvent.click(known)
    expect(opened).toEqual([resource.ref])
    fireEvent.click(screen.getByRole('button', { name: 'Open conversation Unregistered reference: dsh / conversation / unavailable-conversation' }))
    expect(opened).toEqual([resource.ref, missing])
    expect(await screen.findByRole('status')).toHaveProperty('textContent', 'This conversation is unavailable. Its reference has been preserved.')
    expect(screen.queryByRole('button', { name: 'Open conversation Spec file' })).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect((await seeded.api.get({ resourceId: row.id })).resource).toEqual(row)
  })

  it('renders all nine editors, submits native reference objects and excludes owner-only values', async () => {
    const seeded = await seededHost()
    await seeded.ownerApi.registerPack({ definition: allTypes })
    const current = await seeded.ownerApi.setValues({
      resourceId: seeded.review.id,
      expectedRevision: seeded.review.revision,
      packId: 'tracking',
      values: { 'source.value': 'Owner' },
    })
    const saved: unknown[] = []
    provider(
      <ResourceValuesForm
        api={seeded.api}
        resource={current}
        pack={allTypes}
        references={[seeded.spec]}
        onSaved={value => saved.push(value)}
        onCancel={ignore}
      />,
    )
    fireEvent.change(screen.getByLabelText('Assignee'), { target: { value: 'Alice' } })
    fireEvent.change(screen.getByLabelText('Count'), { target: { value: '2.5' } })
    fireEvent.change(screen.getByLabelText('Due date'), { target: { value: '2027-04-21' } })
    fireEvent.change(screen.getByLabelText('Appointment'), { target: { value: '2027-04-21T13:30' } })
    fireEvent.click(screen.getByLabelText('Checked'))
    fireEvent.click(screen.getByLabelText('First'))
    await choose('Status', 'In progress')
    await choose('Related resource', /Spec file/)
    expect(screen.getByRole('combobox', { name: 'Related resource' }).textContent).toContain('Spec file')
    fireEvent.click(screen.getByRole('button', { name: 'Add Links reference' }))
    expect(screen.getByRole('combobox', { name: 'Related resource' }).textContent).toContain('Spec file')
    await choose('Links 1', /Spec file/)
    expect(screen.getByRole('combobox', { name: 'Related resource' }).textContent).toContain('Spec file')
    expect(screen.getByLabelText('Owner value (read-only)').hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(saved).toHaveLength(1))
    const stored = await seeded.api.get({ resourceId: current.id })
    expect(stored.resource.revision).toBe(current.revision + 1)
    expect(stored.resource.attachments[0]?.values).toEqual({
      assignee: 'Alice',
      count: 2.5,
      due: '2027-04-21',
      time: new Date('2027-04-21T13:30').toISOString(),
      checked: true,
      status: 'doing',
      related: target.ref,
      links: [target.ref],
      tags: ['one'],
      'source.value': 'Owner',
    })
    expect(stored.events[0]).toMatchObject({ action: 'values-updated', actor: guiPackage })
  })

  it('validates current definitions without overwriting unknown or stale values', () => {
    expect(() => ResourceUiModel.validatedValues(trackingPack, { status: 'removed-choice' })).toThrow('Status:')
    expect(() => ResourceUiModel.validatedValues(trackingPack, { due: '2027-02-30' })).toThrow('Due date:')
    expect(() => ResourceUiModel.validatedValues(trackingPack, { related: target.id })).toThrow('Related resource:')
    expect(() => ResourceUiModel.validatedValues(allTypes, { count: 'Infinity' })).toThrow('Count:')
    const constructorPack: PackDefinition = {
      ...trackingPack,
      properties: [{ id: 'constructor', label: 'Constructor', type: 'text', readOnly: false, description: '' }],
    }
    expect(ResourceUiModel.validatedValues(constructorPack, {})).toEqual({ constructor: null })
    expect(ResourceUiModel.validatedValues(trackingPack, { status: '', assignee: '', related: null })).toEqual({
      status: null,
      assignee: null,
      due: null,
      related: null,
    })
    expect(ResourceUiModel.refKey(target.ref)).not.toBe(target.id)
  })

  it('keeps open drafts and their revision during page cache refresh; a stale save stays visible', async () => {
    const seeded = await seededHost()
    let closed = 0
    const { queryClient } = provider(
      <ResourceEditor
        api={seeded.api}
        resourceId={seeded.review.id}
        pack={trackingPack}
        references={[seeded.spec]}
        openConversation={() => 'Archived or unavailable.'}
        onClose={() => {
          closed += 1
        }}
        onSaved={ignore}
      />,
    )
    const assignee = await screen.findByLabelText('Assignee')
    fireEvent.change(assignee, { target: { value: 'Unsaved draft' } })
    const concurrent = await seeded.ownerApi.setValues({
      resourceId: seeded.review.id,
      expectedRevision: seeded.review.revision,
      packId: 'tracking',
      values: { assignee: 'Concurrent writer' },
    })
    await queryClient.invalidateQueries({ queryKey: ['resource-packs'] })
    expect(screen.getByLabelText('Assignee')).toHaveProperty('value', 'Unsaved draft')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'This resource changed. Reload it before editing its metadata.')
    expect((await seeded.api.get({ resourceId: seeded.review.id })).resource).toEqual(concurrent)
    expect(closed).toBe(0)
    fireEvent.click(screen.getByRole('button', { name: 'Open conversation' }))
    expect(screen.getByText('Archived or unavailable.')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(closed).toBe(1)
  })

  it('requires explicit detach confirmation and can reattach retained metadata', async () => {
    const seeded = await seededHost()
    provider(
      <ResourceEditor
        api={seeded.api}
        resourceId={seeded.review.id}
        pack={trackingPack}
        references={[]}
        openConversation={() => null}
        onClose={ignore}
        onSaved={ignore}
      />,
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Detach pack' }))
    expect((await seeded.api.get({ resourceId: seeded.review.id })).resource.revision).toBe(seeded.review.revision)
    fireEvent.click(screen.getByRole('button', { name: 'Confirm detach' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Attach pack' }))
    expect(await screen.findByLabelText('Assignee')).toHaveProperty('value', 'Original')
    const stored = await seeded.api.get({ resourceId: seeded.review.id })
    expect(stored.resource).toMatchObject({ revision: seeded.review.revision + 2, attachments: [{ packId: 'tracking', attached: true }] })
    expect(stored.events.slice(0, 2).map(event => event.action)).toEqual(['attached', 'detached'])
  })

  it('reports a missing API owner without requesting resource data or polling', async () => {
    const host = await createTestHost()
    hosts.push(host)
    const absent = createHostApiClient(host.ctx, resourcePacksApi, '@dshfiles/resource-packs-ui-test')
    const view = provider(<ResourcesPanel api={absent} openConversation={() => null} />)
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Resources unavailable: the Host plugin is not active. No background retries will run. Reopen this page after the plugin is activated.',
    )
    const cache = view.queryClient.getQueryCache()
    const catalogQuery = cache.find({ queryKey: ['resource-packs', 'catalog'] })
    expect(catalogQuery?.getObserversCount()).toBe(1)
    const resourceRequests = cache.getAll().filter(query => query !== catalogQuery)
    expect(resourceRequests.map(query => [query.state.fetchStatus, query.state.dataUpdateCount, query.state.errorUpdateCount])).toEqual([
      ['idle', 0, 0],
      ['idle', 0, 0],
    ])
    view.unmount()
    view.queryClient.clear()
  })

  it('keeps unassociated resources visible with Tracking selected', async () => {
    const seeded = await seededHost()
    provider(<ResourcesPanel api={seeded.api} openConversation={() => null} />)
    expect(await screen.findByRole('heading', { name: 'Resources' })).toBeDefined()
    expect(await screen.findByRole('button', { name: 'Edit Spec file' })).toBeDefined()
    expect(screen.getByRole('combobox', { name: 'Property pack' }).textContent).toContain('Tracking')
  })

  it('registers source references without reading or opening native contents', async () => {
    const seeded = await seededHost()
    const created: unknown[] = []
    provider(<AddResourceDialog api={seeded.api} onClose={ignore} onCreated={value => created.push(value)} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Provider' }), { target: { value: 'local' } })
    await choose('Kind', 'file')
    fireEvent.change(screen.getByRole('textbox', { name: 'Native ID' }), { target: { value: '/work/example.md' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Resource label' }), { target: { value: 'Example file' } })
    fireEvent.click(screen.getByRole('button', { name: 'Register resource' }))
    await waitFor(() => expect(created).toHaveLength(1))
    const listed = await seeded.api.list({ query: '/work/example.md' })
    expect(listed).toMatchObject({
      total: 1,
      resources: [{ label: 'Example file', ref: { provider: 'local', kind: 'file', id: '/work/example.md' }, attachments: [] }],
    })
  })

  it('builds a reusable select pack with editable stable field and option IDs', async () => {
    const seeded = await seededHost()
    const catalog = await seeded.api.catalog()
    const created: unknown[] = []
    provider(<NewPackDialog api={seeded.api} packs={catalog.packs} onClose={ignore} onCreated={value => created.push(value)} />)
    fireEvent.change(screen.getByLabelText('Pack label'), { target: { value: 'Review' } })
    expect(screen.getByLabelText('Pack ID')).toHaveProperty('value', 'review')
    fireEvent.change(screen.getByLabelText('Field 1 label'), { target: { value: 'Decision' } })
    await choose('Field 1 type', 'select')
    fireEvent.change(screen.getByLabelText('Field 1 option 1 label'), { target: { value: 'To review' } })
    fireEvent.change(screen.getByLabelText('Field 1 option 1 ID'), { target: { value: 'todo' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add option to field 1' }))
    fireEvent.change(screen.getByLabelText('Field 1 option 2 label'), { target: { value: 'Approved' } })
    fireEvent.change(screen.getByLabelText('Field 1 option 2 ID'), { target: { value: 'done' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create pack' }))
    await waitFor(() => expect(created).toHaveLength(1))
    const review = (await seeded.api.catalog()).packs.find(pack => pack.definition.id === 'review')
    expect(review).toMatchObject({
      owner: guiPackage,
      definition: {
        id: 'review',
        label: 'Review',
        version: 1,
        description: '',
        properties: [
          {
            id: 'decision',
            label: 'Decision',
            description: '',
            readOnly: false,
            type: 'select',
            options: [
              { id: 'todo', label: 'To review' },
              { id: 'done', label: 'Approved' },
            ],
          },
        ],
      },
    })
  })
})
