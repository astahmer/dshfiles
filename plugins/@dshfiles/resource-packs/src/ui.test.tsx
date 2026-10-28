// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { PluginQueryProvider, QueryClient } from '@dshfiles/plugin-ui/query'
import { createHostApiClient } from '@dshfiles/dshx/host'
import { createTestHost } from '@dshfiles/dshx/testing'
import { resourcePacksApi } from './api.js'
import { AddResourceDialog, NewPackDialog } from './dialogs.js'
import { ResourceEditor, ResourceValuesForm } from './editor.js'
import { PropertyInput } from './editor-fields.js'
import { ResourcesPanel } from './panel.js'
import { ResourceTable } from './table.js'
import { trackingPack, type PackDefinition, type PropertyDefinition, type ResourceRecord, type ResourceRef, type StoredPack } from './model.js'
import { ResourceUiModel, type ResourcePacksClient } from './ui-helpers.js'

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})
afterEach(cleanup)
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
const storedPack: StoredPack = { definition: trackingPack, owner: 'resource-packs', createdAt: 0, updatedAt: 0 }
function client(): ResourcePacksClient {
  return {
    catalog: vi.fn(async () => ({ packs: [storedPack] })),
    list: vi.fn(async () => ({ resources: [resource, target], total: 2 })),
    get: vi.fn(async () => ({ resource, events: [] })),
    registerPack: vi.fn(async ({ definition }) => ({ ...storedPack, definition })),
    registerResource: vi.fn(async ({ ref, label }) => ({ ...target, ref, label })),
    attach: vi.fn(async () => ({ ...resource, revision: 4 })),
    detach: vi.fn(async () => ({ ...resource, revision: 4, attachments: [{ packId: 'tracking', attached: false, values: { assignee: 'Original' } }] })),
    setValues: vi.fn(async () => ({ ...resource, revision: 4 })),
  }
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
const allTypes: PackDefinition = { ...trackingPack, properties: [...trackingPack.properties, ...extraProperties] }

describe('Resources UI', () => {
  it('selects a registered reference with its object value', async () => {
    const onChange = vi.fn()
    render(<PropertyInput property={trackingPack.properties[3]!} value={null} resources={[target]} onChange={onChange} />)
    await choose('Related resource', /Spec file/)
    expect(onChange).toHaveBeenCalledWith(target.ref)
  })
  it('uses definition columns even when no values exist and shows unknown references as readable text', () => {
    provider(
      <ResourceTable
        resources={[{ ...resource, attachments: [{ packId: 'tracking', attached: true, values: {} }] }]}
        pack={allTypes}
        references={[target]}
        onEdit={vi.fn()}
        onOpenReference={vi.fn()}
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
    const api = client()
    const missing: ResourceRef = { provider: 'dsh', kind: 'conversation', id: 'unavailable-conversation' }
    const referencePack: PackDefinition = {
      ...trackingPack,
      properties: [
        { id: 'related', label: 'Related conversation', type: 'reference', readOnly: true, description: '' },
        { id: 'links', label: 'Linked resources', type: 'references', readOnly: true, description: '' },
      ],
    }
    const row: ResourceRecord = {
      ...target,
      id: '01900000-0000-7000-8000-000000000003',
      label: 'Review metadata',
      ref: { provider: 'local', kind: 'record', id: 'review-row' },
      attachments: [{ packId: 'tracking', attached: true, values: { related: resource.ref, links: [missing, target.ref] } }],
    }
    vi.mocked(api.catalog).mockResolvedValue({ packs: [{ ...storedPack, definition: referencePack }] })
    vi.mocked(api.list).mockResolvedValue({ resources: [row, resource, target], total: 3 })
    const openConversation = vi.fn<(ref: ResourceRef) => string | null>(ref =>
      ref.id === missing.id ? 'This conversation is unavailable. Its reference has been preserved.' : null,
    )
    provider(<ResourcesPanel api={api} openConversation={openConversation} />)
    const known = await screen.findByRole('button', { name: 'Open conversation Conversation review' })
    expect(known.hasAttribute('disabled')).toBe(false)
    expect(openConversation).not.toHaveBeenCalled()
    fireEvent.click(known)
    expect(openConversation).toHaveBeenLastCalledWith(resource.ref)
    fireEvent.click(screen.getByRole('button', { name: 'Open conversation Unregistered reference: dsh / conversation / unavailable-conversation' }))
    expect(openConversation).toHaveBeenLastCalledWith(missing)
    expect(openConversation).toHaveBeenCalledTimes(2)
    expect(await screen.findByRole('status')).toHaveProperty('textContent', 'This conversation is unavailable. Its reference has been preserved.')
    expect(screen.queryByRole('button', { name: 'Open conversation Spec file' })).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(api.get).not.toHaveBeenCalled()
    expect(api.setValues).not.toHaveBeenCalled()
  })

  it('renders all nine editors, submits native reference objects and excludes owner-only values', async () => {
    const api = client()
    provider(
      <ResourceValuesForm
        api={api}
        resource={{ ...resource, attachments: [{ packId: 'tracking', attached: true, values: { 'source.value': 'Owner' } }] }}
        pack={allTypes}
        references={[target]}
        onSaved={vi.fn()}
        onCancel={vi.fn()}
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
    await waitFor(() => expect(api.setValues).toHaveBeenCalledOnce())
    expect(api.setValues).toHaveBeenCalledWith({
      resourceId: resource.id,
      packId: 'tracking',
      expectedRevision: 3,
      values: {
        assignee: 'Alice',
        count: 2.5,
        due: '2027-04-21',
        time: new Date('2027-04-21T13:30').toISOString(),
        checked: true,
        status: 'doing',
        related: target.ref,
        links: [target.ref],
        tags: ['one'],
      },
    })
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
    const api = client()
    vi.mocked(api.setValues).mockRejectedValue(new Error('Revision conflict: reload the resource before saving.'))
    const onClose = vi.fn()
    const { queryClient } = provider(
      <ResourceEditor
        api={api}
        resourceId={resource.id}
        pack={trackingPack}
        references={[target]}
        openConversation={() => 'Archived or unavailable.'}
        onClose={onClose}
        onSaved={vi.fn()}
      />,
    )
    const assignee = await screen.findByLabelText('Assignee')
    fireEvent.change(assignee, { target: { value: 'Unsaved draft' } })
    await queryClient.invalidateQueries({ queryKey: ['resource-packs'] })
    expect(api.get).toHaveBeenCalledOnce()
    expect(screen.getByLabelText('Assignee')).toHaveProperty('value', 'Unsaved draft')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Revision conflict: reload the resource before saving.')
    expect(api.setValues).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 3, values: expect.objectContaining({ assignee: 'Unsaved draft' }) }))
    expect(api.setValues).toHaveBeenCalledOnce()
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Open conversation' }))
    expect(screen.getByText('Archived or unavailable.')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('requires explicit detach confirmation and can reattach retained metadata', async () => {
    const api = client()
    provider(
      <ResourceEditor
        api={api}
        resourceId={resource.id}
        pack={trackingPack}
        references={[]}
        openConversation={() => null}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Detach pack' }))
    expect(api.detach).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm detach' }))
    await waitFor(() => expect(api.detach).toHaveBeenCalledWith({ resourceId: resource.id, packId: 'tracking', expectedRevision: 3, confirm: true }))
    fireEvent.click(await screen.findByRole('button', { name: 'Attach pack' }))
    await waitFor(() => expect(api.attach).toHaveBeenCalledWith({ resourceId: resource.id, packId: 'tracking', expectedRevision: 4 }))
    expect(await screen.findByLabelText('Assignee')).toHaveProperty('value', 'Original')
  })

  it('reports a missing API owner without requesting resource data or polling', async () => {
    const host = await createTestHost()
    try {
      const absent = createHostApiClient(host.ctx, resourcePacksApi, '@dshfiles/resource-packs-ui-test')
      const api = client()
      vi.mocked(api.catalog).mockImplementation(absent.catalog)
      const view = provider(<ResourcesPanel api={api} openConversation={() => null} />)
      expect(await screen.findByRole('alert')).toHaveProperty(
        'textContent',
        'Resources unavailable: the Host plugin is not active. No background retries will run. Reopen this page after the plugin is activated.',
      )
      expect(api.catalog).toHaveBeenCalledOnce()
      expect(api.list).not.toHaveBeenCalled()
      const catalogQuery = view.queryClient.getQueryCache().find({ queryKey: ['resource-packs', 'catalog'] })
      expect(catalogQuery?.getObserversCount()).toBe(1)
      view.unmount()
      view.queryClient.clear()
    } finally {
      await host.dispose()
    }
  })

  it('keeps unassociated resources visible with Tracking selected', async () => {
    const api = client()
    provider(<ResourcesPanel api={api} openConversation={() => null} />)
    expect(await screen.findByRole('heading', { name: 'Resources' })).toBeDefined()
    expect(await screen.findByRole('button', { name: 'Edit Spec file' })).toBeDefined()
    expect(api.list).toHaveBeenCalledWith({ query: '', limit: 200 }, expect.objectContaining({ signal: expect.any(AbortSignal) }))
    expect(screen.getByRole('combobox', { name: 'Property pack' }).textContent).toContain('Tracking')
  })

  it('registers source references without reading or opening native contents', async () => {
    const api = client()
    provider(<AddResourceDialog api={api} onClose={vi.fn()} onCreated={vi.fn()} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Provider' }), { target: { value: 'local' } })
    await choose('Kind', 'file')
    fireEvent.change(screen.getByRole('textbox', { name: 'Native ID' }), { target: { value: '/work/example.md' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Resource label' }), { target: { value: 'Example file' } })
    fireEvent.click(screen.getByRole('button', { name: 'Register resource' }))
    await waitFor(() =>
      expect(api.registerResource).toHaveBeenCalledWith({ ref: { provider: 'local', kind: 'file', id: '/work/example.md' }, label: 'Example file' }),
    )
  })

  it('builds a reusable select pack with editable stable field and option IDs', async () => {
    const api = client()
    provider(<NewPackDialog api={api} packs={[storedPack]} onClose={vi.fn()} onCreated={vi.fn()} />)
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
    await waitFor(() =>
      expect(api.registerPack).toHaveBeenCalledWith({
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
      }),
    )
  })
})
