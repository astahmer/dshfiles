import { describe, expect, it } from 'vitest'
import { initialPickerFlow, pickerFlowReducer, type PickerFlowState } from './picker-flow.js'
import type { DirectoryListing } from './project-folder-picker.js'

const listing = ({
  path,
  home,
  names,
  truncated = false,
}: {
  readonly path: string
  readonly home: string
  readonly names: readonly string[]
  readonly truncated?: boolean
}): DirectoryListing => ({
  path,
  home,
  crumbs: [],
  entries: names.map(name => ({ name, path: path === '/' ? `/${name}` : `${path}/${name}`, hidden: false })),
  truncated,
})

const typed = (flow: PickerFlowState, query: string, current: DirectoryListing | null = null, directories = false): PickerFlowState =>
  pickerFlowReducer(flow, { type: 'query.typed', query, listing: current, pathStyle: 'posix', directories })

const loaded = (
  flow: PickerFlowState,
  input: { readonly path: string; readonly home?: string; readonly names: readonly string[]; readonly truncated?: boolean },
): PickerFlowState =>
  pickerFlowReducer(flow, {
    type: 'listing.loaded',
    listing: listing({ path: input.path, home: input.home ?? '/Users/me', names: input.names, truncated: input.truncated ?? false }),
    pathStyle: 'posix',
    directories: false,
  })

const root: PickerFlowState = { query: '', browse: { path: undefined } }

describe('pickerFlowReducer', () => {
  it('starts with no query and the browse target the mode asks for', () => {
    expect(initialPickerFlow('projects')).toEqual({ query: '', browse: null })
    expect(initialPickerFlow('directories')).toEqual({ query: '', browse: { path: undefined } })
  })

  it('opens the browsable root for an absolute path typed from the project list', () => {
    expect(typed(initialPickerFlow('projects'), '/Users/me/dev')).toEqual({ query: '/Users/me/dev', browse: { path: undefined } })
  })

  it('opens the browsable root for a home-relative path typed from the project list', () => {
    expect(typed(initialPickerFlow('projects'), '~/dev')).toEqual({ query: '~/dev', browse: { path: undefined } })
  })

  it('keeps browsing the same folder while the typed path stays inside it', () => {
    const browse = { path: '/Users/me/dev' }
    const next = typed({ query: '/Users/me/dev', browse }, '/Users/me/dev/dshfiles', listing({ path: '/Users/me/dev', home: '/Users/me', names: [] }))
    expect(next.query).toBe('/Users/me/dev/dshfiles')
    expect(next.browse).toBe(browse)
  })

  it('opens a uniquely matching folder of the already loaded listing on a keystroke', () => {
    const browse = { path: '/Users/me' }
    const loadedHome = listing({ path: '/Users/me', home: '/Users/me', names: ['dev', 'dshfiles'] })
    const ambiguous = typed({ query: '/Users/me/d', browse }, '/Users/me/d', loadedHome)
    expect(ambiguous.browse).toBe(browse)

    const unique = typed(ambiguous, '/Users/me/de', loadedHome)
    expect(unique).toEqual({ query: '/Users/me/de', browse: { path: '/Users/me/dev' } })
  })

  it('returns to the project list when the query stops being a path', () => {
    expect(typed({ query: '/Users/me/dev', browse: { path: '/Users/me/dev' } }, 'dshfiles')).toEqual({ query: 'dshfiles', browse: null })
  })

  it('rewrites the query to the loaded listing when it does not name a child folder', () => {
    const next = loaded({ query: '/opt/old', browse: { path: '/Users/me/dev' } }, { path: '/Users/me/dev', names: [] })
    expect(next).toEqual({ query: '/Users/me/dev', browse: { path: '/Users/me/dev' } })
  })

  it('keeps the typed query while it names a folder in the loaded listing', () => {
    const next = loaded({ query: '/Users/me/d', browse: { path: '/Users/me' } }, { path: '/Users/me', names: ['dev', 'dshfiles'] })
    expect(next.query).toBe('/Users/me/d')
    expect(next.browse).toEqual({ path: '/Users/me' })
  })

  it('opens the unique folder the typed path names in one transition', () => {
    expect(loaded({ query: '/Users/me/dev', browse: { path: '/Users/me' } }, { path: '/Users/me', names: ['dev', 'docs'] })).toEqual({
      query: '/Users/me/dev',
      browse: { path: '/Users/me/dev' },
    })
  })

  it('stays on the listing when several folders match the typed path', () => {
    const next = loaded({ query: '/Users/me/d', browse: { path: '/Users/me' } }, { path: '/Users/me', names: ['dev', 'docs'] })
    expect(next.browse).toEqual({ path: '/Users/me' })
    expect(next.query).toBe('/Users/me/d')
  })

  it('never auto-opens a match in a truncated listing', () => {
    const next = loaded({ query: '/Users/me/dev', browse: { path: '/Users/me' } }, { path: '/Users/me', names: ['dev'], truncated: true })
    expect(next.browse).toEqual({ path: '/Users/me' })
  })

  it('rewrites an empty query to the root listing and keeps an unmatched absolute query there', () => {
    expect(loaded(root, { path: '/Users/me', names: [] })).toEqual({ query: '/Users/me', browse: { path: undefined } })

    const unmatched: PickerFlowState = { query: '/opt/thing', browse: { path: undefined } }
    expect(loaded(unmatched, { path: '/Users/me', names: [] })).toEqual(unmatched)
  })

  it('does not rewrite or auto-open anything without a browse target', () => {
    const flow = initialPickerFlow('projects')
    expect(loaded(flow, { path: '/Users/me', names: ['dev'] })).toBe(flow)
  })

  it('keeps the browse target when the same folder is requested again', () => {
    const flow: PickerFlowState = { query: '/Users/me/dev', browse: { path: '/Users/me/dev' } }
    expect(pickerFlowReducer(flow, { type: 'browse.requested', path: '/Users/me/dev' })).toBe(flow)
  })

  it('settles after the auto-opened listing arrives', () => {
    const typedPath = typed(initialPickerFlow('projects'), '/Users/me/dev')
    const opened = loaded(typedPath, { path: '/Users/me', names: ['dev'] })
    expect(opened.browse).toEqual({ path: '/Users/me/dev' })

    const arrived = loaded(opened, { path: '/Users/me/dev', names: [] })
    expect(arrived).toBe(opened)
  })
})
