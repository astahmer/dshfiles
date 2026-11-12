import { parse } from 'pele'
import { describe, expect, it } from 'vitest'

/** The b:581 flowchart: a `subgraph`, `<br/>` in its labels and a labeled two-way edge. */
const FLOWCHART = [
  'flowchart LR',
  '  subgraph Host A',
  '    OL[(op-log + item cache<br/>sqlite)] --> Engine',
  '    Engine --> P1[linear adapter]',
  '    Engine --> P2[github adapter]',
  '    Engine --> P3[notion / jira / files / sqlite]',
  '  end',
  '  OL <-- "ops since cursor<br/>multi-host channel" --> OLB[(Host B op-log)]',
].join('\n')

describe('the b:581 flowchart', () => {
  it('parses with the installed renderer, its subgraph and labeled two-way edge intact', () => {
    const diagram = parse(FLOWCHART)
    expect(diagram.type).toBe('flowchart')
    if (diagram.type !== 'flowchart') throw new Error(`the block parsed as ${diagram.type}`)
    expect(diagram.edges).toHaveLength(5)
    expect(diagram.edges.find(edge => edge.type === 'double_arrow_point')).toMatchObject({
      start: 'OL',
      end: 'OLB',
      text: 'ops since cursor<br/>multi-host channel',
    })
  })
})
