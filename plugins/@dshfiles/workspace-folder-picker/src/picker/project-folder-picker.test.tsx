// @vitest-environment jsdom
import { projectToneIndex } from '@dshfiles/plugin-ui/components/ui/project-mark'
import { PluginQueryProvider, QueryClient } from '@dshfiles/plugin-ui/query'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProjectFolderPicker, type DirectoryListing, type DirectoryPickerPort, type PickerAddAction, type RegisteredProject } from './project-folder-picker.js'

afterEach(cleanup)

const projects: RegisteredProject[] = [
  { workspaceId: 'w-web', title: 'web-app', canonicalPath: '/private/var/folders/3k/k0xz2zs57sq/T/r5-shots-fixtures/web-app' },
  { workspaceId: 'w-docs', title: 'docs-site', canonicalPath: '/srv/projects/docs-site' },
]

const directoryPicker = { pick: async () => null, list: async () => Promise.reject(new Error('unused')), createDirectory: async () => '' }

const open = (
  extra: {
    addActions?: readonly PickerAddAction[]
    projectColors?: { project: string; tone: number; color: string }[]
    projects?: readonly RegisteredProject[]
    directoryPicker?: DirectoryPickerPort
    onRemoveProject?: (project: RegisteredProject) => Promise<void>
  } = {},
) =>
  render(
    <PluginQueryProvider client={new QueryClient()}>
      <ProjectFolderPicker
        projects={projects}
        directoryPicker={directoryPicker}
        onRegisterWorkspace={vi.fn()}
        onSelect={vi.fn()}
        onClose={vi.fn()}
        showNativePicker={false}
        {...extra}
      />
    </PluginQueryProvider>,
  )

const mark = (title: string): HTMLElement => {
  const element = document.querySelector<HTMLElement>(`[data-picker-project-mark="${title}"]`)
  if (element === null) throw new Error(`no mark for ${title}`)
  return element
}

// Council round 34 A1: the phone project picker sheet.
describe('the project picker sheet', () => {
  it("draws each project with the kit's project mark: the letters and tone the thread list and the headline draw", () => {
    open()
    const web = mark('web-app')
    expect(web.getAttribute('data-slot')).toBe('project-mark')
    expect(web.textContent).toBe('WA')
    expect(web.className).toContain(`project-tone-balanced-${projectToneIndex('web-app')}`)
    expect(mark('docs-site').textContent).toBe('DS')
  })

  it('follows the colour saved for a project in Settings \u203a Projects', () => {
    open({ projectColors: [{ project: '/srv/projects/docs-site/', tone: 4, color: '' }, { project: projects[0]!.canonicalPath, tone: 0, color: '#123abc' }] })
    expect(mark('docs-site').className).toContain('project-tone-balanced-4')
    expect(mark('web-app').style.color).toBe('rgb(18, 58, 188)')
  })

  it("gives way in a path's middle: the parent folders truncate, the folder's own name stays whole", () => {
    open()
    const option = screen.getByRole('option', { name: /^web-app/u })
    const tail = option.querySelector('[data-picker-path-tail]')
    expect(tail?.textContent).toBe('/web-app')
    expect(tail?.className).toContain('dshx:shrink-0')
    expect(tail?.previousElementSibling?.className).toMatch(/dshx:min-w-0 dshx:truncate/u)
    expect(option.querySelector('[data-picker-path]')?.textContent).toBe(projects[0]!.canonicalPath)
  })

  it('keeps one shrinkable column, so nothing widens the sheet past a phone screen', () => {
    open()
    const sheet = document.querySelector('[data-slot="dialog-content"]')
    expect(sheet?.className).toContain('dshx:grid-cols-[minmax(0,1fr)]')
    expect(sheet?.className).toContain('dshx:@container')
    // The search field takes the first line of a narrow sheet; the scope and the add actions share the next.
    expect(screen.getByRole('textbox').parentElement?.className).toContain('dshx:@max-pane-narrow:basis-full')
    expect(document.querySelector('[data-picker-header]')?.className).toContain('dshx:flex-wrap')
    // A row gives way to its remove button instead of scrolling the list sideways.
    for (const option of screen.getAllByRole('option')) expect(option.className).toContain('dshx:min-w-0')
    // A placeholder too long for the field ends in an ellipsis, not a cut word.
    expect(screen.getByRole('textbox').className).toContain('dshx:text-ellipsis')
    // Short enough for a phone's field: WebKit cuts a focused field's placeholder without an ellipsis.
    expect(screen.getByRole('textbox').getAttribute('placeholder')).toBe('Search projects or type a path…')
  })

  it('shows the keyboard legend and \u2318 shortcuts only to a fine pointer', () => {
    open()
    expect(document.querySelector('[data-picker-legend]')?.className).toContain('dshx:pointer-coarse:hidden')
    const shortcut = document.querySelector('[data-slot="kbd-group"]')
    expect(shortcut?.className).toContain('dshx:pointer-coarse:hidden')
  })

  it('folds the add actions into one Add menu in a narrow sheet and keeps them as buttons in a wide one', () => {
    const create = vi.fn()
    open({
      addActions: [
        { id: 'create', label: 'Create project\u2026', icon: null, onSelect: create },
        { id: 'clone', label: 'Clone repository\u2026', icon: null, disabled: true, onSelect: vi.fn() },
      ],
    })
    const buttons = document.querySelector('[data-picker-add="buttons"]')
    expect(buttons?.className).toContain('dshx:@max-pane-narrow:hidden')
    expect([...(buttons?.querySelectorAll('button') ?? [])].map(button => button.textContent)).toEqual(['Create project\u2026', 'Clone repository\u2026'])
    const menu = document.querySelector('[data-picker-add="menu"]')
    expect(menu?.getAttribute('aria-label')).toBe('Add a project')
    expect(menu?.className).toMatch(/dshx:hidden .*dshx:@max-pane-narrow:inline-flex/u)
    // The scope and Add share a 44pt line on touch, as the search field above them.
    expect(menu?.className).toContain('dshx:pointer-coarse:h-11')
    expect(screen.getByRole('textbox').className).toContain('dshx:pointer-coarse:h-11')
  })
})

// Council round 35 P3 (all three seats): the phone project picker's remove control, selected row, No folder and browse.
describe('the project picker sheet, round 35 polish', () => {
  const noFolder: RegisteredProject = { workspaceId: 'no-folder', title: 'No folder', canonicalPath: '~/.dsh/no-folder', removable: false, mark: 'folder' }
  const remove = vi.fn(async () => undefined)

  it('draws the remove \u2715 in the secondary ink with a 14px glyph, on the kit icon button that keeps its 44pt touch area', () => {
    open({ onRemoveProject: remove })
    const button = screen.getByRole('button', { name: 'Remove web-app from known projects' })
    expect(button.className).toContain('dshx:text-muted-foreground')
    // The kit's icon size: a coarse pointer answers its 44px hit area centred on it (plugin-ui styles.css).
    expect(button.getAttribute('data-size')).toBe('icon')
    expect(button.querySelector('svg')?.getAttribute('class')).toContain('dshx:size-3.5')
  })

  it("fills the whole highlighted row, the \u2715 column included, not only the option's own box", () => {
    open({ onRemoveProject: remove })
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'ArrowDown' })
    const option = screen.getByRole('option', { name: /^web-app/u })
    expect(option.getAttribute('aria-selected')).toBe('true')
    const row = option.parentElement
    expect(row?.getAttribute('role')).toBe('group')
    expect(row?.className).toContain('dshx:bg-accent')
    expect(option.className).not.toContain('dshx:bg-accent')
    expect(row?.contains(screen.getByRole('button', { name: 'Remove web-app from known projects' }))).toBe(true)
    // A row at rest has no fill.
    expect(screen.getByRole('option', { name: /^docs-site/u }).parentElement?.className).not.toContain('dshx:bg-accent')
  })

  it('gives No folder a neutral folder mark instead of coloured initials', () => {
    open({ projects: [noFolder, ...projects] })
    const row = screen.getByRole('group', { name: 'No folder' })
    expect(row.querySelector('[data-picker-project-mark]')).toBeNull()
    const mark = row.querySelector('[data-picker-folder-mark]')
    expect(mark).not.toBeNull()
    expect(mark?.className).toContain('dshx:bg-muted')
    expect(mark?.className).toContain('dshx:text-muted-foreground')
    // A project keeps its letters.
    expect(mark?.closest('[role="listbox"]')?.querySelector('[data-picker-project-mark="web-app"]')?.textContent).toBe('WA')
  })

  const listing: DirectoryListing = {
    path: '/srv/projects',
    home: '/home/dana',
    crumbs: [
      { name: '/', path: '/', hidden: false },
      { name: 'srv', path: '/srv', hidden: false },
      { name: 'projects', path: '/srv/projects', hidden: false },
    ],
    entries: [
      { name: 'api', path: '/srv/projects/api', hidden: false },
      { name: 'site', path: '/srv/projects/site', hidden: false },
    ],
    truncated: false,
  }
  const browsing = async (): Promise<HTMLElement> => {
    open({
      addActions: [{ id: 'create', label: 'Create project\u2026', icon: null, onSelect: vi.fn() }],
      directoryPicker: { ...directoryPicker, list: async () => listing },
    })
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '/srv/projects' } })
    return screen.findByRole('navigation', { name: 'Folder path' })
  }

  it("puts a narrow sheet's Add at the end of the breadcrumb row while browsing, not alone on a line", async () => {
    const crumbs = await browsing()
    const row = crumbs.parentElement
    const add = row?.querySelector('[data-picker-add="menu"]')
    expect(add).not.toBeNull()
    expect(add?.className).toMatch(/dshx:hidden .*dshx:@max-pane-narrow:inline-flex/u)
    // The crumbs take the row and scroll; Add keeps its seat at the end.
    expect(crumbs.className).toContain('dshx:min-w-0')
    expect(crumbs.className).toContain('dshx:flex-1')
    expect(row?.lastElementChild?.contains(add ?? null)).toBe(true)
    // The header keeps the search field only.
    expect(document.querySelector('[data-picker-header] [data-picker-add="menu"]')).toBeNull()
    // A wide sheet still offers the buttons in the header.
    expect(document.querySelector('[data-picker-header] [data-picker-add="buttons"]')).not.toBeNull()
  })

  it('drops the parent path under a folder listed directly in the open folder (the breadcrumbs already say it)', async () => {
    await browsing()
    const option = await screen.findByRole('option', { name: /^api/u })
    expect(within(option).queryByText('/srv/projects/api')).toBeNull()
    expect(option.textContent).toBe('api')
  })
})
