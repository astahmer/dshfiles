// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../src/components/ui/dialog.js'

afterEach(cleanup)

// Vitest runs each package from its root; jsdom gives import.meta.url a non-file scheme here.
const read = (path: string): string => readFileSync(join(process.cwd(), path), 'utf8')
const roles = read('src/color-roles.css')
const block = (selector: string): string => roles.match(new RegExp(`${selector.replace(/[[\]]/g, '\\$&')}\\s*\\{([^}]*)\\}`))?.[1] ?? ''

describe('dialog scrim (round five K8)', () => {
  it('is a warm ink at 32% in light and black at 50% in dark', () => {
    expect(block(':root')).toContain('--dshx-scrim: rgb(27 26 25 / 0.32);')
    expect(block('body[data-ds-dark-theme]')).toContain('--dshx-scrim: rgb(0 0 0 / 0.5);')
    expect(roles).toContain('--color-scrim: var(--dshx-scrim);')
  })

  it('dims behind every kit dialog, alert dialog and sheet', () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Delete</DialogTitle>
          <DialogDescription>Gone for good.</DialogDescription>
        </DialogContent>
      </Dialog>,
    )
    expect(document.querySelector('[data-slot="dialog-overlay"]')?.className.split(/\s+/)).toContain('dshx:bg-scrim')
    for (const file of ['dialog', 'alert-dialog', 'sheet']) {
      const source = read(`src/components/ui/${file}.tsx`)
      expect(source, file).toContain('dshx:bg-scrim')
      expect(source, file).not.toContain('dshx:bg-black/50')
    }
  })
})
