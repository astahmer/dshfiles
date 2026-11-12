import { describe, expect, it } from 'vitest'
import type { SetupCheck } from './api.js'
import { CheckModel } from './check-model.js'

const check = (id: string, state: SetupCheck['state'], detail: string): SetupCheck => ({
  id,
  label: id,
  state,
  detail,
  path: null,
  fix: state === 'ok' ? null : `fix ${id}`,
})

describe('check rows', () => {
  it('reads a healthy Node, its build and fnm as one row', () => {
    const rows = CheckModel.rows([
      check('node-version', 'ok', 'v24.11.1'),
      check('node-origin', 'ok', 'From fnm'),
      check('fnm', 'ok', 'fnm 1.38.1'),
      check('pnpm', 'ok', '12.5.1'),
    ])
    expect(rows.map(row => [row.id, row.detail])).toEqual([
      ['node', '24.11.1 from fnm'],
      ['pnpm', '12.5.1'],
    ])
  })

  it('keeps the Node rows apart while one needs attention, and lists problems first', () => {
    const rows = CheckModel.rows([
      check('node-version', 'ok', 'v24.11.1'),
      check('node-origin', 'fail', 'A Nix build'),
      check('fnm', 'ok', 'fnm 1.38.1'),
      check('gh', 'warn', 'Not found'),
    ])
    expect(rows.map(row => row.id)).toEqual(['node-origin', 'gh', 'node-version', 'fnm'])
  })

  it('leads with what blocks setup, else what is optional', () => {
    expect(CheckModel.summary([check('node-origin', 'fail', ''), check('gh', 'warn', '')])).toBe('One thing to fix before setup can continue.')
    expect(CheckModel.summary([check('gh', 'warn', ''), check('jj', 'warn', '')])).toBe('Ready to set up. 2 optional tools are missing.')
    expect(CheckModel.summary([check('pnpm', 'ok', '')])).toBe('Everything setup needs is here.')
  })
})
