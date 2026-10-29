import { describe, expect, test } from 'vitest'
import { PromptLinkModel } from './prompt-link.js'

const origin = 'http://127.0.0.1:3080/'

describe('prompt links', () => {
  test('reads the prompt with its optional project and model', () => {
    const url = `${origin}?prompt=${encodeURIComponent('Fix the flaky test\nin CI')}&project=%2FUsers%2Fme%2Fapp&model=openrouter%2Fanthropic%2Fclaude`
    expect(PromptLinkModel.read(url)).toEqual({
      prompt: 'Fix the flaky test\nin CI',
      project: '/Users/me/app',
      model: { provider: 'openrouter', model: 'anthropic/claude' },
    })
  })

  test('a URL without a usable prompt is not a prompt link', () => {
    expect(PromptLinkModel.read(origin)).toBeUndefined()
    expect(PromptLinkModel.read(`${origin}?prompt=`)).toBeUndefined()
    expect(PromptLinkModel.read(`${origin}?prompt=%20%20&project=app`)).toBeUndefined()
    expect(PromptLinkModel.read(`${origin}?thread=session-1`)).toBeUndefined()
  })

  test('an unreadable model is dropped while the prompt still opens', () => {
    expect(PromptLinkModel.read(`${origin}?prompt=hi&model=no-slash`)).toEqual({ prompt: 'hi', project: undefined, model: undefined })
    expect(PromptLinkModel.read(`${origin}?prompt=hi&model=%2Fmodel`)?.model).toBeUndefined()
  })

  test('stripping removes only the prompt-link params', () => {
    expect(PromptLinkModel.strip(`${origin}?thread=session-1&prompt=hi&project=app&model=a%2Fb&token=keep#frag`)).toBe(
      `${origin}?thread=session-1&token=keep#frag`,
    )
    expect(PromptLinkModel.strip(`${origin}?prompt=hi`)).toBe(origin)
  })

  test('a project is found by its id, then by its folder path with or without a trailing slash', () => {
    const projects = [
      { workspaceId: 'ws-app', path: '/Users/me/app' },
      { workspaceId: 'ws-site', path: '/Users/me/site/' },
    ]
    expect(PromptLinkModel.projectFor({ projects, reference: 'ws-site' })?.workspaceId).toBe('ws-site')
    expect(PromptLinkModel.projectFor({ projects, reference: '/Users/me/app/' })?.workspaceId).toBe('ws-app')
    expect(PromptLinkModel.projectFor({ projects, reference: '/Users/me/site' })?.workspaceId).toBe('ws-site')
    expect(PromptLinkModel.projectFor({ projects, reference: '/Users/me/other' })).toBeUndefined()
  })
})
