import Schemastery from '@deepseek-ai/schemastery'
import type { ConfigForm, ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import { decodeJson } from '@dshfiles/dshx/json'
import type { SettingsPathOpView } from '@deepseek-ai/dsh-settings/types'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ShellTranslate } from '../native/locales.js'
import { jsonValueSchema, SettingsSchemaModel, type JsonValue } from './schema-model.js'
import { SettingsJsonEditor } from './settings-json-editor.js'

const text = (value: JsonValue | undefined): string => Schema.decodeUnknownOption(Schema.String)(value).pipe(Option.getOrElse(() => ''))
const schema = Schema.decodeUnknownSync(jsonValueSchema)(
  Schemastery.object({ maxTabs: Schemastery.natural().default(12), dense: Schemastery.boolean().default(false) }).toJSON(),
)
const fields = SettingsSchemaModel.settingFields({ schema, secrets: [], text })
const t: ShellTranslate = key => key

/** One namespace's user layer as the fake store keeps it. */
interface Overrides {
  [key: string]: JsonValue
}

/** An in-memory ConfigForm with the Host's revision fence: a write naming an older revision is refused. */
const createForm = (initial: { readonly user: Overrides; readonly revision: number }) => {
  let user: Overrides = { ...initial.user }
  let revision = initial.revision
  let refuseNext = false
  const listeners = new Set<() => void>()
  const snapshotOf = (): ConfigFormSnapshot<unknown> => ({
    status: 'ready',
    value: { maxTabs: 12, dense: false, ...user },
    base: { maxTabs: 12, dense: false },
    user,
    revision,
    writable: true,
  })
  let snapshot = snapshotOf()
  const publish = (): void => {
    snapshot = snapshotOf()
    for (const listener of listeners) listener()
  }
  const calls: { readonly ops: readonly SettingsPathOpView[]; readonly expectedRevision: number | undefined }[] = []
  const form: ConfigForm<unknown> = {
    getSnapshot: () => snapshot,
    subscribe: listener => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    mutate: async (ops, expectedRevision) => {
      calls.push({ ops, expectedRevision })
      if (refuseNext || (expectedRevision !== undefined && expectedRevision !== revision)) {
        refuseNext = false
        return false
      }
      const next: Overrides = { ...user }
      for (const op of ops) {
        const key = op.path[0]
        if (key === undefined) continue
        if (op.op === 'set') next[key] = op.value
        else delete next[key]
      }
      user = next
      revision += 1
      publish()
      return true
    },
    set: async () => true,
    unset: async () => true,
  }
  return {
    form,
    calls,
    refuseOnce: () => {
      refuseNext = true
    },
    changeElsewhere: (next: Overrides) => {
      user = next
      revision += 1
      publish()
    },
  }
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

const render = async (form: ConfigForm<unknown>): Promise<void> => {
  await act(async () => root.render(<SettingsJsonEditor fields={fields} form={form} namespace="example" t={t} />))
}

const editor = (): HTMLTextAreaElement => {
  const found = container.querySelector('textarea')
  if (found === null) throw new Error('no editor')
  return found
}

const type = async (value: string): Promise<void> => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(editor(), value)
    editor().dispatchEvent(new Event('input', { bubbles: true }))
  })
}

const button = (label: string): HTMLButtonElement => {
  const found = [...container.querySelectorAll('button')].find(candidate => candidate.textContent === label)
  if (found === undefined) throw new Error(`no button ${label}`)
  return found
}

const click = async (label: string): Promise<void> => {
  await act(async () => {
    button(label).click()
    await Promise.resolve()
  })
}

describe('SettingsJsonEditor', () => {
  it('saves only the changed fields, fenced by the revision the draft started from, then follows the store', async () => {
    const store = createForm({ user: { dense: true }, revision: 3 })
    await render(store.form)
    expect(decodeJson(jsonValueSchema, editor().value)).toEqual({ dense: true })
    await type('{ "dense": true, "maxTabs": 30 }')
    expect(container.textContent).toContain('json.unsaved')
    await click('json.save')
    expect(store.calls).toEqual([{ ops: [{ op: 'set', path: ['maxTabs'], value: 30 }], expectedRevision: 3 }])
    expect(decodeJson(jsonValueSchema, editor().value)).toEqual({ dense: true, maxTabs: 30 })
    expect(container.textContent).not.toContain('json.unsaved')
  })

  it('keeps the draft when the settings changed elsewhere and saves only its own fields over them', async () => {
    const store = createForm({ user: { dense: true }, revision: 3 })
    await render(store.form)
    await type('{ "dense": true, "maxTabs": 30 }')
    await act(async () => store.changeElsewhere({ dense: false }))
    expect(container.textContent).toContain('json.conflict')
    expect(button('json.save').disabled).toBe(true)
    expect(decodeJson(jsonValueSchema, editor().value)).toEqual({ dense: true, maxTabs: 30 })
    await click('json.saveOver')
    expect(store.calls.at(-1)).toEqual({ ops: [{ op: 'set', path: ['maxTabs'], value: 30 }], expectedRevision: 4 })
    expect(decodeJson(jsonValueSchema, editor().value)).toEqual({ dense: false, maxTabs: 30 })
  })

  it('drops the draft for the latest values on request', async () => {
    const store = createForm({ user: {}, revision: 1 })
    await render(store.form)
    await type('{ "maxTabs": 30 }')
    await act(async () => store.changeElsewhere({ dense: true }))
    await click('json.reload')
    expect(decodeJson(jsonValueSchema, editor().value)).toEqual({ dense: true })
    expect(store.calls).toEqual([])
  })

  it('keeps the draft and says so when the Host refuses, and blocks a draft with diagnostics', async () => {
    const store = createForm({ user: {}, revision: 1 })
    await render(store.form)
    await type('{ "maxTabs": 30 }')
    store.refuseOnce()
    await click('json.save')
    expect(container.textContent).toContain('json.refused')
    expect(decodeJson(jsonValueSchema, editor().value)).toEqual({ maxTabs: 30 })
    await type('{ "maxTabs": "many", "typo": 1 }')
    expect([...container.querySelectorAll('[data-diagnostic]')].map(item => item.getAttribute('data-diagnostic'))).toEqual(['type', 'unknown-key'])
    expect(button('json.save').disabled).toBe(true)
    await click('json.discard')
    expect(decodeJson(jsonValueSchema, editor().value)).toEqual({})
  })
})
