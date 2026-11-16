import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('reduced motion', () => {
  it('stops every looping spin or pulse when the user asks for less motion', () => {
    const loose = readdirSync(new URL('.', import.meta.url))
      .filter(name => /\.tsx?$/u.test(name) && !name.includes('.test.'))
      .flatMap(name =>
        readFileSync(new URL(name, import.meta.url), 'utf8')
          .split('\n')
          .map((line, index) => ({ name, line, number: index + 1 }))
          .filter(({ line }) => /animate-(spin|pulse)/u.test(line) && !/motion-(reduce|safe):/u.test(line))
          .map(({ name: file, number }) => `${file}:${String(number)}`),
      )
    expect(loose).toEqual([])
  })
})
