// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Page } from '../src/components/page.js'
import { Button } from '../src/components/ui/button.js'
import { Combobox } from '../src/components/ui/combobox.js'
import { Input } from '../src/components/ui/input.js'
import { InputGroup, InputGroupInput } from '../src/components/ui/input-group.js'
import { Select, SelectTrigger, SelectValue } from '../src/components/ui/select.js'
import { Tabs, TabsList, TabsTrigger } from '../src/components/ui/tabs.js'

// Council round 5 A1: one control height and one radius for every field, the segmented root and default-size buttons.
afterEach(cleanup)

const styles = readFileSync(join(process.cwd(), 'src/styles.css'), 'utf8')
const fieldLookCss = readFileSync(join(process.cwd(), 'src/field-look.css'), 'utf8')
const classes = (element: Element | null | undefined): readonly string[] => element?.className.split(/\s+/u) ?? []
const H = 'dshx:h-(--dshx-control-h)'

describe('one control height (council round 5 A1)', () => {
  it('declares --dshx-control-h at 32px, 44px on a coarse pointer', () => {
    expect(styles).toMatch(/:root \{[^}]*--dshx-control-h: 32px;/u)
    expect(styles).toMatch(/@media \(pointer: coarse\) \{\s*:root \{[^}]*--dshx-control-h: 44px;/u)
    expect(styles).toContain('--spacing-control-h: var(--dshx-control-h);')
  })

  it('sizes Input, InputGroup, Combobox and the default Select trigger by it, at the one 8px radius', () => {
    const view = render(
      <>
        <Input aria-label="name" />
        <InputGroup data-testid="group">
          <InputGroupInput aria-label="search" />
        </InputGroup>
        <Select>
          <SelectTrigger aria-label="model">
            <SelectValue placeholder="Model" />
          </SelectTrigger>
        </Select>
        <Combobox label="project" options={[]} value="" onValueChange={vi.fn()} />
      </>,
    )
    const fields = [
      view.getByRole('textbox', { name: 'name' }),
      view.getByTestId('group'),
      view.getByRole('combobox', { name: 'model' }),
      view.getByRole('combobox', { name: 'project' }),
    ]
    for (const field of fields) {
      const own = classes(field).join(' ')
      expect(own.includes(H) || own.includes(`dshx:data-[size=default]:h-(--dshx-control-h)`)).toBe(true)
      expect(own).not.toMatch(/(^| )dshx:(data-\[size=default\]:)?h-8( |$)/u)
      expect(classes(field)).toContain('dshx:rounded-lg')
    }
    expect(fieldLookCss).toContain('height: var(--dshx-control-h, 32px);')
  })

  it('sizes default and outline buttons by it, at the one radius; Page header actions use that size', () => {
    const view = render(
      <>
        <Button>Save</Button>
        <Button variant="outline">Cancel</Button>
        <Button size="sm">Small</Button>
      </>,
    )
    for (const name of ['Save', 'Cancel']) {
      expect(classes(view.getByRole('button', { name }))).toEqual(expect.arrayContaining([H, 'dshx:rounded-lg']))
    }
    // Every size shares the radius.
    expect(classes(view.getByRole('button', { name: 'Small' }))).toContain('dshx:rounded-lg')
    expect(classes(view.getByRole('button', { name: 'Small' }))).not.toContain('dshx:rounded-md')
    cleanup()
    const page = render(
      <Page
        heading="Review"
        primaryAction={{ id: 'summarize', label: 'Summarize', onSelect: vi.fn() }}
        actions={[{ id: 'refresh', label: 'Refresh', onSelect: vi.fn() }]}
      />,
    )
    for (const name of ['Summarize', 'Refresh']) expect(page.getByRole('button', { name }).getAttribute('data-size')).toBe('default')
  })

  it('sizes the segmented root by it with items inset 3px; underline tabs keep their own height', () => {
    const view = render(
      <Tabs defaultValue="a">
        <TabsList aria-label="views">
          <TabsTrigger value="a">A</TabsTrigger>
          <TabsTrigger value="b">B</TabsTrigger>
        </TabsList>
      </Tabs>,
    )
    const root = view.getByRole('tablist')
    expect(classes(root)).toEqual(expect.arrayContaining(['dshx:group-data-[orientation=horizontal]/tabs:h-(--dshx-control-h)', 'dshx:p-[3px]', 'dshx:rounded-lg']))
    expect(classes(view.getAllByRole('tab')[0])).toContain('dshx:h-full')
    cleanup()
    const line = render(
      <Tabs defaultValue="a">
        <TabsList variant="line" aria-label="sections">
          <TabsTrigger value="a">A</TabsTrigger>
        </TabsList>
      </Tabs>,
    )
    expect(classes(line.getByRole('tablist'))).not.toContain('dshx:group-data-[orientation=horizontal]/tabs:h-(--dshx-control-h)')
  })
})
