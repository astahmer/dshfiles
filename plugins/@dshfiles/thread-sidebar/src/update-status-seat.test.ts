import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('update-dsh.tsx', import.meta.url), 'utf8')

describe('the status strip Update item', () => {
  it('renders nothing while DSH is up to date, so its strip seat draws no blank slot or divider', () => {
    const item = source.slice(source.indexOf('export const UpdateStatusItem'))
    // The button lives in the view, which returns null while nothing waits; the item adds no element of its own.
    expect(item).not.toContain('<button')
    expect(item).toContain('<UpdateStatusView {...props} />')
    expect(source).not.toContain('dshx:empty:hidden')
  })
})
