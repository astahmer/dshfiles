import { describe, expect, it } from 'vitest'
import { parsePastedComposerText } from '../src/paste-references.js'

const sessionMention = (label: string, sessionId: string): string =>
  `@[${label}](dsh-session:${btoa(JSON.stringify(sessionId)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')})`

describe('parsePastedComposerText', () => {
  it('turns canonical session mentions into structured references and preserves surrounding text', () => {
    const mention = sessionMention('Fix project picker', 'session-42')
    const parts = parsePastedComposerText(`look at ${mention} conclusion`)

    expect(parts).toEqual([
      { kind: 'text', text: 'look at ' },
      {
        kind: 'reference',
        wireText: mention,
        reference: {
          source: 'reference',
          ref: mention,
          label: 'Fix project picker',
          appearance: 'session',
          clipboardText: mention,
        },
      },
      { kind: 'text', text: ' conclusion' },
    ])
  })

  it('keeps malformed and non-session mention syntax as plain text', () => {
    const text = '@[not a session](dsh-session:invalid) @[file](file:///README.md)'
    expect(parsePastedComposerText(text)).toEqual([{ kind: 'text', text }])
  })

  it('rejects a session payload that does not decode to a plain session id', () => {
    const objectPayload = btoa('{"sessionId":"session-42"}').replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
    const escapedPayload = btoa('"a\\u0042"').replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
    const text = `@[object](dsh-session:${objectPayload}) @[escaped](dsh-session:${escapedPayload})`
    expect(parsePastedComposerText(text)).toEqual([{ kind: 'text', text }])
  })

  it('preserves adjacent references and intervening line breaks', () => {
    const first = sessionMention('First', 'session-1')
    const second = sessionMention('Second', 'session-2')
    const parts = parsePastedComposerText(`${first}\n${second}`)

    expect(parts.map(part => (part.kind === 'reference' ? part.reference.label : part.text))).toEqual(['First', '\n', 'Second'])
  })
})
