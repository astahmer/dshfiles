import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = (file: string): string => readFileSync(new URL(`../src/native/chat/${file}`, import.meta.url), 'utf8')

/**
 * Council round 22, item 9: a row reads whether it sits in a run fold from its seat's `data-run-fold-member` (a provider
 * plugin's row drops its kind prefix there). The failed call a group's run takes in from after the group keeps its own
 * seat, so that seat must say it too, or the one row the run shows collapsed reads differently from the rest.
 */
describe('run fold member marker', () => {
  it('marks a seat the run took in from after its group as absorbed', () => {
    expect(source('ChatFlow.tsx')).toMatch(/runFoldAbsorbed=\{absorbed\.has\(entry\.key\)\}/)
    expect(source('ChatNodeSeat.tsx')).toMatch(/data-run-fold-member=\{runFold === undefined \? \(runFoldAbsorbed === true \? 'absorbed' : undefined\)/)
  })
})

describe('run fold absorbed row spacing (council round 22, item 9)', () => {
  it('keeps the run’s 2px pitch for the row it took in from after its group', () => {
    const css = readFileSync(new URL('../src/native/chat/ChatView.module.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    // It sat 4px under the run's other rows, the flow's gap after a group.
    expect(css).toMatch(/\.flowItem\[data-run-fold-member="absorbed"\]\s*\{\s*--dsh-chat-flow-gap:\s*2px;\s*\}/)
  })
})
