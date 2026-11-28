import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AccountRows } from '../src/account-rows.js'
import { ModelPickerModel } from '../src/model-picker-model.js'

const luna = { id: 'gpt-6-luna', name: 'gpt-6-luna' }
// Catalog order puts Codex first; ai-accounts' priority puts CC2 before CC1.
const groups = [
  { id: 'codex', name: 'Codex 1', models: [luna] },
  { id: 'cc1', name: 'Command Code 1', models: [luna] },
  { id: 'cc2', name: 'Command Code 2', models: [luna] },
]
const accounts = [
  { instanceId: 'codex', kind: 'codex', enabled: true },
  { instanceId: 'cc2', kind: 'commandcode', enabled: true },
  { instanceId: 'cc1', kind: 'commandcode', enabled: true },
]

describe('the default account is where DSH routes a new thread on that model (council picker round 4, T13)', () => {
  it("takes the first enabled account of the route's service in ai-accounts' priority order, not catalog order", () => {
    expect(ModelPickerModel.defaultAccountFor({ groups, model: 'gpt-6-luna', provider: 'cc1', accounts })?.id).toBe('cc2')
    expect(ModelPickerModel.defaultAccountFor({ groups, model: 'gpt-6-luna', provider: 'codex', accounts })?.id).toBe('codex')
    const disabled = accounts.map(account => (account.instanceId === 'cc2' ? { ...account, enabled: false } : account))
    expect(ModelPickerModel.defaultAccountFor({ groups, model: 'gpt-6-luna', provider: 'cc1', accounts: disabled })?.id).toBe('cc1')
  })

  it('reads the trigger tag against that default: quiet on it, marked off it, absent when the service has one account', () => {
    expect(ModelPickerModel.triggerLabel({ groups, accounts, current: { provider: 'cc2', model: 'gpt-6-luna' } })?.offDefault).toBe(false)
    expect(ModelPickerModel.triggerLabel({ groups, accounts, current: { provider: 'cc1', model: 'gpt-6-luna' } })?.offDefault).toBe(true)
    expect(ModelPickerModel.triggerLabel({ groups, accounts, current: { provider: 'codex', model: 'gpt-6-luna' } })?.providerTag).toBeUndefined()
  })

  it('captions the default account "Default" in the account rows', () => {
    const html = renderToStaticMarkup(
      <AccountRows
        accents={new Map()}
        accounts={[
          { id: 'cc1', name: 'Command Code 1' },
          { id: 'cc2', name: 'Command Code 2' },
        ]}
        defaultId="cc2"
        onChoose={() => undefined}
        quotas={new Map()}
        selected="cc1"
      />,
    )
    expect(html.match(/data-model-account-default/gu) ?? []).toHaveLength(1)
    expect(html.indexOf('data-model-account-default')).toBeGreaterThan(html.indexOf('Command Code 2'))
  })
})
