import { describe, expect, it } from 'vitest'

import { Redaction } from './redaction.ts'

describe('Redaction', () => {
  it('removes common credential shapes', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'
    const input = [
      'key sk-ant-api03-abcdefghijklmnopqrstuv',
      'gh ghp_abcdefghijklmnopqrstuvwxyz0123456789',
      `jwt ${jwt}`,
      'aws AKIAABCDEFGHIJKLMNOP',
      'Authorization: Bearer abcdefghijklmnop1234',
      'password = "hunter22hunter"',
      '-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----',
    ].join('\n')
    const result = Redaction.redact(input, [])
    for (const secret of ['sk-ant-api03', 'ghp_abc', jwt, 'AKIAABCD', 'abcdefghijklmnop1234', 'hunter22hunter', 'MIIabc']) expect(result.text).not.toContain(secret)
    expect(result.text).toContain('password = "[REDACTED:secret]"')
    expect(result.count).toBe(7)
  })

  it('redacts caller-supplied literals and ignores too-short ones', () => {
    const result = Redaction.redact('db pass is c0rrect-h0rse and id abc', ['c0rrect-h0rse', 'abc'])
    expect(result.text).toBe('db pass is [REDACTED:secret] and id abc')
  })

  it('leaves ordinary code alone', () => {
    const code = 'const token = parseToken(input)\nfunction tokenize(source) { return source.split(" ") }'
    expect(Redaction.redact(code, []).text).toBe(code)
  })
})
