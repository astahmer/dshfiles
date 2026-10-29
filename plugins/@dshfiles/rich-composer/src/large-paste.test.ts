import { describe, expect, test } from 'vitest'
import { LargePasteModel } from './large-paste.ts'

describe('large paste', () => {
  test('a paste of 32 KiB or more counts as large, measured in UTF-8 bytes', () => {
    expect(LargePasteModel.isLarge('a'.repeat(32 * 1024 - 1))).toBe(false)
    expect(LargePasteModel.isLarge('a'.repeat(32 * 1024))).toBe(true)
    expect(LargePasteModel.isLarge('é'.repeat(16 * 1024))).toBe(true)
    expect(LargePasteModel.isLarge('é'.repeat(16 * 1024 - 1))).toBe(false)
  })

  test('the file is plain text named after the local paste time and holds the exact text', async () => {
    const text = 'line one\nline two\n'
    const file = LargePasteModel.fileFor({ text, at: new Date(2026, 9, 29, 21, 7, 5) })
    expect(file.name).toBe('pasted-20261029-210705.txt')
    expect(file.type).toBe('text/plain')
    expect(await file.text()).toBe(text)
  })
})
