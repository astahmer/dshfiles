import { describe, expect, it } from 'vitest'
import { looksLikeCode } from './code-like.ts'

describe('looksLikeCode', () => {
  it('reads prose as prose', () => {
    expect(looksLikeCode('Can you fix the login page? It breaks on Safari.')).toBe(false)
    expect(looksLikeCode('First line of a note.\nSecond line, still prose.')).toBe(false)
    expect(looksLikeCode('[ok]')).toBe(false)
    expect(looksLikeCode('')).toBe(false)
  })

  it('reads JSON, fenced and indented code as code', () => {
    expect(looksLikeCode('{"command":"sleep 3 && echo done","description":"Wait three seconds"}')).toBe(true)
    expect(looksLikeCode('```ts\nconst a = 1\n```')).toBe(true)
    expect(looksLikeCode('{\n  "name": "dsh",\n  "version": "0.2.1"\n}')).toBe(true)
    expect(looksLikeCode('Run the checks.\n[[call bash {"command":"echo 1"}]]\n[[call bash {"command":"echo 2"}]]')).toBe(true)
  })
})
