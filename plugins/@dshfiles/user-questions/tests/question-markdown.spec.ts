import { describe, expect, test } from 'vitest'
import { QuestionMarkdownText } from '../src/rich/question-markdown.ts'

const { hasSyntax: hasMarkdownSyntax, parts: questionParts, plainText: questionPlainText, segments: questionSegments } = QuestionMarkdownText

describe('questionParts', () => {
  test('a one-line plain question is all heading, as the native form rendered it', () => {
    expect(questionParts('Which layout should the release notes use?')).toEqual({
      title: 'Which layout should the release notes use?',
      body: '',
    })
  })

  test('the first paragraph is the heading and the rest is the markdown body', () => {
    const text = '[#47](https://example.test/pull/47) keeps worlds apart\n\n![before](/tmp/a.png)\n\nWhat should happen to old maps?'
    expect(questionParts(text)).toEqual({
      title: '[#47](https://example.test/pull/47) keeps worlds apart',
      body: '![before](/tmp/a.png)\n\nWhat should happen to old maps?',
    })
  })

  test('a leading ATX heading loses its markers', () => {
    expect(questionParts('## Old maps ##\nPick one.')).toEqual({ title: 'Old maps', body: 'Pick one.' })
  })

  test('a question that opens with a block has no heading and keeps every line in the body', () => {
    const text = '```html preview\n<p>x</p>\n```\nKeep it?'
    expect(questionParts(text)).toEqual({ title: undefined, body: text })
    expect(questionParts('![chart](/tmp/c.png)\nKeep it?').title).toBeUndefined()
    expect(questionParts('- one\n- two').title).toBeUndefined()
  })

  test('a heading paragraph stops at the first block line', () => {
    expect(questionParts('Pick a plan\n- fast\n- safe')).toEqual({ title: 'Pick a plan', body: '- fast\n- safe' })
  })
})

describe('questionSegments', () => {
  test('an html preview fence becomes a preview between prose segments', () => {
    expect(questionSegments('Before\n\n```html preview Revenue\n<b>hi</b>\n```\n\nAfter')).toEqual([
      { kind: 'markdown', text: 'Before' },
      { kind: 'html-preview', html: '<b>hi</b>', title: 'Revenue' },
      { kind: 'markdown', text: 'After' },
    ])
  })

  test('an untitled preview has no title, and tilde fences work too', () => {
    expect(questionSegments('~~~~html preview\n<i>x</i>\n~~~~')).toEqual([{ kind: 'html-preview', html: '<i>x</i>', title: undefined }])
  })

  test('a plain html fence is code, not a page', () => {
    const text = '```html\n<script>alert(1)</script>\n```'
    expect(questionSegments(text)).toEqual([{ kind: 'markdown', text }])
  })

  test('an unclosed preview fence stays markdown, so a truncated argument never becomes a page', () => {
    const text = '```html preview\n<div>'
    expect(questionSegments(text)).toEqual([{ kind: 'markdown', text }])
  })

  test('a preview line inside another code block is code', () => {
    const text = '````md\n```html preview\n<p>x</p>\n```\n````'
    expect(questionSegments(text)).toEqual([{ kind: 'markdown', text }])
  })

  test('a closing fence must be at least as long as the opener', () => {
    expect(questionSegments('````html preview\n```\nstill html\n````')).toEqual([{ kind: 'html-preview', html: '```\nstill html', title: undefined }])
  })

  test('an empty preview renders nothing', () => {
    expect(questionSegments('```html preview\n\n```')).toEqual([])
  })
})

describe('hasMarkdownSyntax and questionPlainText', () => {
  test('plain prose keeps the plain renderer', () => {
    expect(hasMarkdownSyntax('Move them to the new folder?')).toBe(false)
    expect(hasMarkdownSyntax('Use `pnpm` here?')).toBe(true)
    expect(hasMarkdownSyntax('See https://example.test')).toBe(true)
  })

  test('the accessible name of an untitled question drops previews, images and markup', () => {
    expect(questionPlainText('```html preview\n<p>x</p>\n```\n![a](/a.png)\n**Keep** the [old](https://x.test) map?')).toBe('Keep the old map?')
  })
})
