import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Council round 23, item 9: a turn a notice opened (a subagent's failed run) sat 77px of ink under the reply before it on
 * a desktop (a 32px row reserved for actions that show only on hover, the tail's 12px, the turn's 28px) and 18px over its
 * own "Worked for". Measured in a scratch DSH at 1440 px: the reply's last line ends 3px above its seat's edge, the
 * notice's text sits 2px inside its seat, the next row's text at its seat's edge.
 */
const css = readFileSync(new URL('./native/chat/ChatView.module.css', import.meta.url), 'utf8')

const TAIL = '.flowItem[data-chat-flow-kind="turn-tail"]'
const TRIGGER = '.flowItem[data-chat-flow-kind="turn-trigger"]'
const PROCESS = '.flowItem[data-chat-flow-kind="turn-process"]'
const ACTIONS_ONLY_TAIL = `${TAIL}:has([data-actions-reveal="hover"]):not(:has([data-actions-reveal] > [data-slot] > *))`

/** The declarations of the first rule whose selector list holds `selector`, inside `scope` when given. */
const declarations = (selector: string, scope = css): Readonly<Record<string, string>> => {
  const rules = [...scope.matchAll(/([^{}]+)\{([^{}]*)\}/gu)]
  const rule = rules.find(([, selectors]) =>
    (selectors ?? '')
      .replace(/\/\*[\s\S]*?\*\//gu, '')
      .split(',')
      .map(part => part.trim())
      .includes(selector),
  )
  if (rule === undefined) return {}
  return Object.fromEntries(
    (rule[2] ?? '')
      .split(';')
      .map(line => line.split(':').map(part => part.trim()))
      .filter((pair): pair is [string, string] => pair.length === 2 && pair[0] !== ''),
  )
}

const hoverBlock = (): string => {
  const marker = css.indexOf(`${TAIL}:has(+ ${TRIGGER})`)
  const start = css.lastIndexOf('@media (hover: hover)', marker)
  return start === -1 || marker === -1 ? '' : css.slice(start, css.indexOf('\n}\n', marker) + 3)
}

const px = (value: string | undefined): number => Number.parseFloat(value ?? 'NaN')

describe('the space around a notice that opens a turn (council round 23, item 9)', () => {
  it('puts as much ink under the notice as over it, on a desktop and a phone', () => {
    const below = 2 + px(declarations(`${TRIGGER} + ${PROCESS}`)['--dsh-chat-flow-gap'])
    // A phone keeps the reply's actions visible: the notice opens 22px under that row, plus its 2px padding.
    const abovePhone = px(declarations(`${TAIL} + ${TRIGGER}`)['--dsh-chat-flow-gap']) + 2
    // A pointer device hides them until hover: the actions-only tail takes no height, so the reply's 3px, the tail's
    // 12px, the notice's gap and its 2px.
    const hover = hoverBlock()
    expect(declarations(`${TAIL}:has(+ ${TRIGGER}):has([data-actions-reveal="hover"]):not(:has([data-actions-reveal] > [data-slot] > *))`, hover).height).toBe('0')
    const aboveDesktop = 3 + 12 + px(declarations(`${ACTIONS_ONLY_TAIL} + ${TRIGGER}`, hover)['--dsh-chat-flow-gap']) + 2
    expect(below).toBe(24)
    expect(abovePhone).toBe(below)
    expect(aboveDesktop).toBe(below)
  })

  it('keeps the hidden actions reachable: their row sits at the row end, above the notice', () => {
    const actions = declarations(`${TAIL}:has(+ ${TRIGGER}) [data-actions-reveal="hover"]:not(:has(> [data-slot] > *))`, hoverBlock())
    expect(actions).toMatchObject({ position: 'relative', 'z-index': '1', width: 'fit-content', 'margin-left': 'auto' })
  })
})
