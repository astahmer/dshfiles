import { describe, expect, it } from 'vitest'
import { ACCOUNT_HUES, accountAccents } from '../src/account-color.js'
import { ModelPickerModel } from '../src/model-picker-model.js'

describe('accounts are told apart (council picker N2)', () => {
  it('gives each account of one service its own dot, keeping the first account on the service accent', () => {
    const accents = accountAccents([
      { instanceId: 'codex_work', kind: 'codex', accentColor: '#10A37F' },
      { instanceId: 'cc1', kind: 'commandcode', accentColor: '#0E7490' },
      { instanceId: 'cc2', kind: 'commandcode', accentColor: '#0E7490' },
      { instanceId: 'cc3', kind: 'commandcode', accentColor: '#0E7490' },
    ])
    expect(accents.get('codex_work')).toBe('#10A37F')
    expect(accents.get('cc1')).toBe('#0E7490')
    const commandCode = ['cc1', 'cc2', 'cc3'].map(id => accents.get(id))
    expect(new Set(commandCode).size).toBe(3)
    expect(ACCOUNT_HUES).toContain(accents.get('cc2'))
  })

  it('tags every account the same short way everywhere: its badge, else its initials with the number kept', () => {
    expect(ModelPickerModel.accountTag({ name: 'Command Code 2' })).toBe('CC2')
    expect(ModelPickerModel.accountTag({ name: 'Codex 1' })).toBe('C1')
    expect(ModelPickerModel.accountTag({ name: 'GitHub Copilot 1' })).toBe('GC1')
    expect(ModelPickerModel.accountTag({ name: 'Command Code 2', badge: 'OPS' })).toBe('OPS')
    expect(ModelPickerModel.accountTag({ name: 'Command Code 2', badge: ' ' })).toBe('CC2')
  })

  it('names the off-default account in the trigger with the same tag', () => {
    const groups = [
      { id: 'cc1', name: 'Command Code 1', models: [{ id: 'gpt-6-luna', name: 'gpt-6-luna' }] },
      { id: 'cc2', name: 'Command Code 2', models: [{ id: 'gpt-6-luna', name: 'gpt-6-luna' }] },
    ]
    expect(ModelPickerModel.triggerLabel({ groups, current: { provider: 'cc2', model: 'gpt-6-luna' } })?.providerTag).toBe('CC2')
  })
})
