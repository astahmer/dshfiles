// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { isSendButton } from './submit-target.js'

const button = (className: string, sendMode?: string): HTMLButtonElement => {
  const element = document.createElement('button')
  element.className = className
  if (sendMode !== undefined) element.dataset['sendMode'] = sendMode
  element.innerHTML = '<svg><path /></svg>'
  return element
}

describe('the first-send button guard', () => {
  it('finds the rich composer send button, whose CSS-module class is hashed after its name', () => {
    const send = button('_primary_fij92_599', 'send')
    expect(isSendButton(send)).toBe(true)
    expect(isSendButton(send.querySelector('path'))).toBe(true)
  })

  it('intercepts every rich composer mode that submits a draft, and no other', () => {
    for (const mode of ['send', 'queue', 'steer']) expect(isSendButton(button('_primary_fij92_599', mode))).toBe(true)
    for (const mode of ['stop', 'sending', 'continue']) expect(isSendButton(button('_primary_fij92_599', mode))).toBe(false)
  })

  it('still finds the stock composer send button by its class', () => {
    expect(isSendButton(button('uV2eYG_primary'))).toBe(true)
  })

  it('ignores other buttons and non-elements', () => {
    expect(isSendButton(button('_primary_fij92_599'))).toBe(false)
    expect(isSendButton(button('uV2eYG_add'))).toBe(false)
    expect(isSendButton(null)).toBe(false)
  })
})
