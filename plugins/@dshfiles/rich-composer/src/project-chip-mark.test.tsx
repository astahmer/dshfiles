// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceChip } from './native/skeleton/EmptyHero.tsx'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  IconChevronDownOutlineRegular: () => null,
  IconFolderCloseRegular: () => <svg data-folder="closed" />,
  IconFolderOpenRegular: () => <svg data-folder="open" />,
  Tooltip: (props: { children: unknown }) => props.children,
}))

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

afterEach(() => {
  document.body.innerHTML = ''
})

const render = async (props: { readonly label: string | undefined; readonly marked?: boolean }): Promise<HTMLElement> => {
  const host = document.createElement('div')
  document.body.append(host)
  await act(async () => createRoot(host).render(<WorkspaceChip label={props.label} marked={props.marked ?? false} t={key => key} />))
  return host
}

const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'native/skeleton/ConversationContent.tsx'), 'utf8')
const between = (start: string, end: string): string => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)))

// Unslop round five, C5: the composer's project chips show the project's identity tile, as the thread list does.
describe('the composer project chip', () => {
  it("leads the started thread's summary chip and the phone place chip with the project's 16px mark", () => {
    const summary = between('data-run-summary=""', '</Tooltip>')
    expect(summary).toContain('<ProjectMark name={chipTitle} size="dense" />')
    expect(summary).not.toContain('IconFolderOpenRegular')
    expect(between('data-place-summary=""', '</button>')).toContain('<ProjectMark name={chipTitle} size="dense" />')
  })

  it("puts the new thread's mark beside the project chip, so the chip's text stays the project's name", async () => {
    const segment = between('data-run-segment="project"', '</Tooltip>')
    expect(segment).toContain('<ProjectMark name={chipTitle} size="dense" />')
    expect(segment.indexOf('<ProjectMark')).toBeLessThan(segment.indexOf('<WorkspaceChip'))
    expect(segment).toContain('marked={chipTitle !== undefined}')
    const marked = await render({ label: 'billing-api', marked: true })
    expect(marked.querySelector('button')?.textContent).toBe('billing-api')
    expect(marked.querySelector('[data-folder]')).toBeNull()
  })

  it('keeps the folders without a mark: closed while no project is chosen, open beside a name', async () => {
    expect((await render({ label: undefined })).querySelector('[data-folder]')?.getAttribute('data-folder')).toBe('closed')
    document.body.innerHTML = ''
    expect((await render({ label: 'billing-api' })).querySelector('[data-folder]')?.getAttribute('data-folder')).toBe('open')
  })

  it('reads the place chip\'s text without the mark\'s letters ("billing-api", never "BAbilling-api")', async () => {
    const { textWithoutMarks } = await import('./native/skeleton/ConversationContent.tsx')
    const segment = document.createElement('span')
    segment.innerHTML = '<span data-slot="project-mark" aria-hidden="true"><span>BA</span></span><button>billing-api</button>'
    expect(textWithoutMarks(segment)).toBe('billing-api')
    expect(segment.textContent).toBe('BAbilling-api')
  })
})
