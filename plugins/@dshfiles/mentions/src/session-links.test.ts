import { describe, expect, it } from 'vitest'
import { SessionLinks } from './session-links.js'

const mention = (label: string, sessionId: string): string => `@[${label}](dsh-session:${Buffer.from(JSON.stringify(sessionId), 'utf8').toString('base64url')})`

const recall = (references: readonly { readonly sessionId: string; readonly label: string }[]) => ({
  type: 'user/message',
  data: { source: { kind: 'session-reference', form: 'recall', version: 1, references } },
})

describe('SessionLinks', () => {
  it('reads the session id out of a canonical mention and ignores anything else', () => {
    expect(SessionLinks.idFromMention(mention('Add dsh-our-free-model to dsh setup', 'ses_01J9-abc'))).toBe('ses_01J9-abc')
    expect(SessionLinks.idFromMention('@Add dsh-our-free-model')).toBeUndefined()
    expect(SessionLinks.idFromMention('@[x](dsh-session:!!)')).toBeUndefined()
  })

  it('maps labels to the sessions a thread referenced, the latest reference winning', () => {
    const byLabel = SessionLinks.referencedSessions([
      { type: 'user/message', data: { source: { kind: 'user' } } },
      recall([{ sessionId: 's1', label: 'Fix deploy' }]),
      recall([
        { sessionId: 's2', label: 'Fix deploy' },
        { sessionId: 's3', label: 'Docs' },
      ]),
      { type: 'turn/end' },
    ])
    expect(Object.fromEntries(byLabel)).toEqual({ 'Fix deploy': 's2', Docs: 's3' })
  })

  it('finds the clicked label in a "Referenced session" line', () => {
    const text = 'Referenced session · Fix deploy, Docs'
    const labels = ['Fix deploy', 'Docs']
    expect(SessionLinks.labelAt({ text, offset: text.indexOf('Docs') + 1, labels })).toBe('Docs')
    expect(SessionLinks.labelAt({ text, offset: text.indexOf('deploy'), labels })).toBe('Fix deploy')
    expect(SessionLinks.labelAt({ text, offset: 2, labels })).toBeUndefined()
    expect(SessionLinks.labelAt({ text: 'Referenced session · Docs', offset: 0, labels })).toBe('Docs')
  })
})
