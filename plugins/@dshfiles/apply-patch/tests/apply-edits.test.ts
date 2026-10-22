import { describe, expect, it } from 'vitest'
import { applyEdits, describeEditsFailure } from '../src/apply-edits.js'

const content = ['const a = 1', 'const b = 2', 'const c = 3', ''].join('\n')

describe('applyEdits', () => {
  it('replaces one literal match and reports it as exact', () => {
    const result = applyEdits({ content, edits: [{ old: 'const b = 2', new: 'const b = 20' }] })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.content).toContain('const b = 20')
    expect(result.value).toMatchObject({ exact: 1, fuzzy: 0 })
  })

  it('refuses an ambiguous literal match and names the lines', () => {
    const repeated = 'x\ny\nx\n'
    const result = applyEdits({ content: repeated, edits: [{ old: 'x', new: 'z' }] })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toEqual({ kind: 'ambiguous', edit: 0, lines: [1, 3] })
    expect(describeEditsFailure(result.error)).toContain('lines 1, 3')
  })

  it('replaces every occurrence when replaceAll is set', () => {
    const result = applyEdits({ content: 'x\ny\nx\n', edits: [{ old: 'x', new: 'z', replaceAll: true }] })
    expect(result.ok && result.value.content).toBe('z\ny\nz\n')
  })

  it('finds a reindented block after the literal match fails', () => {
    const source = ['function f() {', '  if (ready) {', '    run()', '  }', '}'].join('\n')
    const result = applyEdits({ content: source, edits: [{ old: 'if (ready) {\n  run()\n}', new: 'if (ready) {\n  runTwice()\n}' }] })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.content).toContain('runTwice()')
    expect(result.value.fuzzy).toBe(1)
  })

  it('absorbs a moved line break between the same words', () => {
    const result = applyEdits({ content: 'const a = 1\nconst b = 2\n', edits: [{ old: 'const a = 1 const b = 2', new: 'combined();' }] })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.content).toContain('combined();')
  })

  it('fails with missing when no literal or whitespace match exists', () => {
    const result = applyEdits({ content, edits: [{ old: 'const d = 4', new: 'const d = 40' }] })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe('missing')
  })

  it('rejects empty and unchanged needles before touching the file', () => {
    expect(applyEdits({ content, edits: [{ old: '', new: 'x' }] })).toMatchObject({ ok: false, error: { kind: 'empty-old' } })
    expect(applyEdits({ content, edits: [{ old: 'a', new: 'a' }] })).toMatchObject({ ok: false, error: { kind: 'unchanged' } })
  })

  it('applies edits in order so a later anchor sees the earlier result', () => {
    const result = applyEdits({
      content,
      edits: [
        { old: 'const a = 1', new: 'const a = 1\nconst d = 4' },
        { old: 'const d = 4', new: 'const d = 40' },
      ],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.content).toContain('const a = 1\nconst d = 40')
  })

  it('preserves CRLF line endings', () => {
    const result = applyEdits({ content: 'a\r\nb\r\n', edits: [{ old: 'a\nb', new: 'c' }] })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.content).toBe('c\r\n')
  })
})
