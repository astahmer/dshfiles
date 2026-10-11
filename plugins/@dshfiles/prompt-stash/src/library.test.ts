import { describe, expect, it } from 'vitest'
import {
  MAX_PROMPT_TEXT_LENGTH,
  defaultPromptTitle,
  readPromptLibrary,
  removePromptIfCurrent,
  serializePromptLibrary,
  writePromptIfCurrent,
  type SavedPrompt,
} from './library.js'

const firstPrompt: SavedPrompt = {
  id: '11f94d55-8639-4f42-94ca-7b218778e4a1',
  revision: '0ed39357-447e-4f84-b0e8-4e6d313e9233',
  title: 'Review a change',
  text: 'Check the behavior and tests.',
  updatedAt: 1,
}

describe('saved prompt library', () => {
  it('uses the first prompt line as an optional default label', () => {
    expect(defaultPromptTitle('  Review this patch\nCheck edge cases.')).toBe('Review this patch')
    expect(defaultPromptTitle('x'.repeat(120))).toBe(`${'x'.repeat(99)}…`)
    expect(defaultPromptTitle('  ')).toBe('Saved prompt')
  })

  it('starts empty when the browser has no saved library', () => {
    expect(readPromptLibrary(null)).toEqual({ ok: true, prompts: [] })
  })

  it('round-trips text without interpreting markup or changing whitespace', () => {
    const text = '  <script>do not execute</script>\\nCheck this patch.  '
    const serialized = serializePromptLibrary([{ ...firstPrompt, text }])
    expect(serialized).not.toBeNull()
    expect(readPromptLibrary(serialized ?? null)).toEqual({ ok: true, prompts: [{ ...firstPrompt, text }] })
  })

  it('leaves malformed and unsupported stored data unreadable', () => {
    expect(readPromptLibrary('{')).toEqual({ ok: false })
    expect(readPromptLibrary(JSON.stringify({ version: 2, prompts: [] }))).toEqual({ ok: false })
  })

  it('rejects oversized text and duplicate prompt identities', () => {
    expect(serializePromptLibrary([{ ...firstPrompt, text: 'x'.repeat(MAX_PROMPT_TEXT_LENGTH + 1) }])).toBeNull()
    expect(serializePromptLibrary([firstPrompt, { ...firstPrompt, revision: 'ac518568-9e7f-4a62-8adf-250208be6a4e' }])).toBeNull()
  })

  it('refuses to overwrite a prompt changed in another browser tab', () => {
    const updated = { ...firstPrompt, revision: 'ac518568-9e7f-4a62-8adf-250208be6a4e', text: 'New text' }
    expect(writePromptIfCurrent([firstPrompt], updated, 'b933e05b-00ea-4605-8f49-68c235ac0d91')).toEqual({
      kind: 'conflict',
      prompts: [firstPrompt],
    })
  })

  it('keeps the stored prompt when another tab changes it before deletion', () => {
    const updated = { ...firstPrompt, revision: 'ac518568-9e7f-4a62-8adf-250208be6a4e', text: 'New text' }
    expect(removePromptIfCurrent([updated], firstPrompt.id, firstPrompt.revision)).toEqual({
      kind: 'conflict',
      prompts: [updated],
    })
  })

  it('inserts a saved prompt without replacing the existing ordered library', () => {
    const next = { ...firstPrompt, id: '9b6a262c-ec58-45b9-b4e6-35ef2e691a21' }
    expect(writePromptIfCurrent([firstPrompt], next, null)).toEqual({
      kind: 'applied',
      prompts: [next, firstPrompt],
    })
  })

  it('reads a drafts payload left under the shared key as an empty library', () => {
    const drafts = JSON.stringify({ schemaVersion: 1, drafts: [{ id: 'x' }] })
    expect(readPromptLibrary(drafts)).toEqual({ ok: true, prompts: [] })
    expect(readPromptLibrary(JSON.stringify({ schemaVersion: 2 }))).toEqual({ ok: false })
  })
})
