import { describe, expect, it } from 'vitest'
import { shellMessages } from './locales.js'

/** Names and terms that keep their capital inside a sentence. */
const PROPER = new Set([
  'DSH',
  'JSON',
  'MCP',
  'Jev',
  'TypeSafe',
  'Backlog',
  'Memory',
  'Finder',
  'Editor',
  'Settings',
  'General',
  'Tools',
  'Plugins',
  'Form',
  'Insert',
  'Load',
  'Save',
  'ALIAS',
  'English',
  'I',
])

/** Words after the first that start with a capital and are not a name: the mark of Title Case. */
const titleCased = (text: string): readonly string[] =>
  text
    // A sentence also starts after a placeholder that stands for one ("Not changed. {reason} The …").
    .split(/(?<=[.:!?›→}])\s+|\n/u)
    .flatMap(sentence => sentence.split(/\s+/u).slice(1))
    .map(word => word.replace(/[^\p{L}]/gu, ''))
    .filter(word => /^\p{Lu}\p{Ll}+$/u.test(word) && !PROPER.has(word))

describe('settings shell copy', () => {
  const english = Object.entries(shellMessages.en)

  it('writes every label and message in sentence case', () => {
    expect(english.flatMap(([key, text]) => titleCased(text).map(word => `${key}: "${text}" (${word})`))).toEqual([])
  })

  it('asks nothing with "please" and labels the release summary in words', () => {
    expect(english.filter(([, text]) => /\bplease\b/iu.test(text)).map(([key]) => key)).toEqual([])
    expect(shellMessages.en['releaseNotice.showSummary']).toBe('Summary')
    expect(shellMessages.en['releaseNotice.hideSummary']).toBe('Hide summary')
  })

  it('counts search results in the singular and the plural, and says what to do when nothing matches', () => {
    expect(shellMessages.en['search.foundOne']).toBe('1 setting found')
    expect(shellMessages.en['search.found']).toBe('{count} settings found')
    expect(shellMessages.en['search.matchesOne']).toBe('1 matching setting')
    expect(shellMessages.en['search.none']).toBe('No settings match. Try another word, or clear the search.')
  })

  it('translates every key', () => {
    expect(Object.keys(shellMessages.zh).toSorted()).toEqual(Object.keys(shellMessages.en).toSorted())
  })
})
