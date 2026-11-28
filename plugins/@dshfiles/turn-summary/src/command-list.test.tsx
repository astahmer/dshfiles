import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TurnActivity } from './turn-activity.js'
import { CommandList } from './turn-summary-line.js'

const summary = {
  ...TurnActivity.empty,
  commands: 2,
  commandRuns: [
    { callId: 'call-build', label: 'Build the project', outcome: 'ok' },
    { callId: 'call-test', label: 'Run the tests', outcome: 'exit 1' },
  ],
  failedCommands: [{ callId: 'call-test', label: 'Run the tests', outcome: 'exit 1' }],
}

describe('the commands list under "Ran N commands"', () => {
  it('makes each command a button that opens its call in the transcript (round three F2)', () => {
    const markup = renderToStaticMarkup(<CommandList onlyFailed={false} openCall={() => {}} summary={summary} />)
    expect(markup.match(/<button\b/g)).toHaveLength(2)
    expect(markup).toMatch(/<button[^>]*aria-label="Show the output of Build the project"[^>]*>Build the project<\/button>/)
    expect(markup).toMatch(/<button[^>]*aria-label="Show the output of Run the tests"[^>]*>Run the tests<\/button>/)
  })

  it('keeps plain text where the transcript cannot be opened (a detached or stock transcript)', () => {
    const markup = renderToStaticMarkup(<CommandList onlyFailed={false} summary={summary} />)
    expect(markup).not.toContain('<button')
    expect(markup).toContain('Build the project')
  })
})
