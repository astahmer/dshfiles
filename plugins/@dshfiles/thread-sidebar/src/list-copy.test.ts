import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'

const locales = readFileSync(fileURLToPath(new URL('./locales.ts', import.meta.url)), 'utf8')
/** The English table is the first one in the file. */
const english = locales.slice(0, locales.indexOf('const zh'))

test('an unfiltered status reads "Any", not "None"', () => {
  // "Status: None" read as an error, or as "threads with no status"; the filter is simply not narrowing the list.
  expect(english).toContain("threadSidebarFilterNone: 'Any',")
})

test('an unsent draft is a new thread, not a chat', () => {
  // Glossary: thread, never chat. The row of the open blank draft read "New chat".
  expect(english).toContain("threadSidebarNewChat: 'New thread',")
})

test('the restart notice says what to do next when DSH cannot restart itself', () => {
  // "Restart DSH yourself to load them." named no step: the next action is in the terminal that runs DSH.
  expect(english).toMatch(/threadSidebarUpdatesManual: '[^']*stop DSH in the terminal[^']*start it again[^']*',/u)
})

test('row menu labels: a submenu has a chevron, not an ellipsis too, and no label says plugin', () => {
  expect(english).toContain("threadSidebarNotifyOnFinish: 'Notify when finished',")
  expect(english).toContain("threadSidebarOpenPluginInSidePanel: 'Open a view in side panel',")
})

/** Every quoted value of one locale table, without its key. */
const values = (table: string): string[] => [...table.matchAll(/^\s+(?:[A-Za-z]+:\s*)?'((?:[^'\\]|\\.)*)',$/gmu)].map(match => match[1] ?? '')
const chinese = locales.slice(locales.indexOf('const zh'))
const settings = readFileSync(fileURLToPath(new URL('./settings.ts', import.meta.url)), 'utf8')
const descriptions = [...settings.matchAll(/\.description\(\s*'((?:[^'\\]|\\.)*)'/gu)].map(match => match[1] ?? '')

test('lifecycle verbs follow the glossary: Done, Restore and Snooze', () => {
  // Settle, Unsettle and Park were three more words for "get this out of my way" (docs/ade-ux §3: done, Restore, Snooze).
  expect(english).toContain("threadSidebarSettle: 'Done',")
  expect(english).toContain("threadSidebarUnsettle: 'Restore',")
  expect(english).toContain("threadSidebarPark: 'Snooze',")
  expect(english).toContain("threadSidebarUnpark: 'Unsnooze',")
  // Mute and Archive are different actions (silence alerts; DSH's own hard close) and keep their names.
  expect(english).toContain("threadSidebarMute: 'Mute thread',")
  expect(english).toContain("threadSidebarArchive: 'Archive',")
})

test('no label, banner or setting text says settle or park', () => {
  const old = /\b(?:un)?settl(?:e|ed|es|ing)\b|\b(?:un)?park(?:ed|s)?\b/iu
  expect(values(english).filter(value => old.test(value))).toEqual([])
  expect(descriptions.filter(value => old.test(value))).toEqual([])
  // The other locale carries the same rename (沉淀 was Settle, 搁置 was Park).
  expect(values(chinese).filter(value => /沉淀|搁置|停驻/u.test(value))).toEqual([])
})

test('the settings section says thread, never session, and DSH for the server process', () => {
  expect(values(english).filter(value => /\bsessions?\b/iu.test(value))).toEqual([])
  expect(descriptions.filter(value => /\bsessions?\b/iu.test(value))).toEqual([])
  // "Host" names where a thread runs (the glossary's host); the process the user restarts is DSH.
  expect(values(english).filter(value => /\bHost\b/u.test(value))).toEqual([])
  expect(descriptions.filter(value => /\bHost\b/u.test(value))).toEqual([])
  expect(english).toContain("threadSidebarExcludedSessions: 'Excluded threads',")
  expect(english).toContain("threadSidebarNewChatInProject: 'New thread in {project}',")
})

test('status words come from the six states', () => {
  // Starting, Finished, Interrupted, Inactive, Input needed and Needs attention were a second vocabulary.
  expect(english).toContain("subagentPreviewStarting: 'Working',")
  expect(english).toContain("subagentPreviewFinished: 'Done',")
  expect(english).toContain("subagentPreviewInterrupted: 'Stopped',")
  expect(english).toContain("threadSidebarInactive: 'Idle',")
  expect(english).toContain("threadSidebarFilterAttention: 'Needs you',")
  expect(english).toContain("threadSidebarInputNotificationTitle: 'Needs you',")
  expect(values(english).filter(value => /^(Starting|Finished|Inactive|Input needed|Needs attention)$/u.test(value))).toEqual([])
})

test('a setting description is one or two sentences', () => {
  // The automatic-restart description ran to four sentences: trigger, off state, cost and dependency in one field.
  const sentences = (text: string): number => text.split(/[.!?](?:\s|$)/u).filter(part => part.trim() !== '').length
  expect(descriptions.filter(text => sentences(text) > 3)).toEqual([])
  expect(descriptions.some(text => text.startsWith('Restart DSH when idle to apply updates'))).toBe(true)
})
