// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ChartFrame } from '../src/chart.js'

afterEach(cleanup)

describe('ChartFrame (round five K5)', () => {
  it('maps the TanStack chart palette onto the data ramp, not the status hues', () => {
    const view = render(
      <ChartFrame title="Tokens">
        <svg />
      </ChartFrame>,
    )
    const classes = view.container.querySelector('figure')!.className
    for (let n = 1; n <= 6; n += 1) expect(classes, `series ${n}`).toContain(`dshx:[--ts-chart-${n}:var(--dshx-data-${n})]`)
    expect(classes).not.toMatch(/--ts-chart-\d:var\(--dsw-alias-state-/)
  })
})
