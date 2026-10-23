import { describe, expect, it } from 'vitest'

import { formatBacklogMention, nextBacklogMention } from './backlog-mention-text.js'

const parse = (text: string, from = 0): ReturnType<typeof nextBacklogMention> => nextBacklogMention(text, from)

describe('backlog mention text', () => {
  it('reads a whole serialized mention back into its id and title', () => {
    const text = `Working on ${formatBacklogMention({ id: 12, title: 'Composer drops chips' })} next.`

    expect(parse(text)).toEqual({
      id: 12,
      title: 'Composer drops chips',
      start: 'Working on '.length,
      end: 'Working on '.length + 'b:12 "Composer drops chips" (backlog item; backlog_get has its details)'.length,
    })
  })

  it('keeps escaped quotes and newlines inside the title', () => {
    const title = 'in "new tab" we\nshould start'
    const text = formatBacklogMention({ id: 64, title })

    expect(text).toContain('\\"new tab\\"')
    expect(parse(text)).toMatchObject({ id: 64, title })
  })

  it('reads a bare item number written in prose', () => {
    expect(parse('Next: b:13, then done.')).toEqual({ id: 13, title: null, start: 6, end: 10 })
  })

  it('ignores words that only contain a token and ids that cannot exist', () => {
    expect(parse('a/b:12 and rb:12 and b:12abc stay text')).toBeUndefined()
    expect(parse('b:0 and b:99999999999 stay text')).toBeUndefined()
  })

  it('leaves a foreign suffix visible and finds the next valid mention', () => {
    const text = `b:12 "Title" (backlog item; something else) then b:13 "Other" (backlog item; backlog_get has its details)`

    const first = parse(text)
    expect(first).toEqual({ id: 12, title: null, start: 0, end: 4 })
    expect(parse(text, first?.end)).toMatchObject({ id: 13, title: 'Other' })
  })
})
