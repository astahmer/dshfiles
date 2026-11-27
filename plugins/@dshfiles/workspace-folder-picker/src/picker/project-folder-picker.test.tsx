// @vitest-environment jsdom
import { projectToneIndex } from '@dshfiles/plugin-ui/components/ui/project-mark'
import { PluginQueryProvider, QueryClient } from '@dshfiles/plugin-ui/query'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProjectFolderPicker, type PickerAddAction, type RegisteredProject } from './project-folder-picker.js'

afterEach(cleanup)

const projects: RegisteredProject[] = [
  { workspaceId: 'w-web', title: 'web-app', canonicalPath: '/private/var/folders/3k/k0xz2zs57sq/T/r5-shots-fixtures/web-app' },
  { workspaceId: 'w-docs', title: 'docs-site', canonicalPath: '/srv/projects/docs-site' },
]

const directoryPicker = { pick: async () => null, list: async () => Promise.reject(new Error('unused')), createDirectory: async () => '' }

const open = (extra: { addActions?: readonly PickerAddAction[]; projectColors?: { project: string; tone: number; color: string }[] } = {}) =>
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
