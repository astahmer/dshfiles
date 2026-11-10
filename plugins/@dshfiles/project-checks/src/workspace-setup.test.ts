import { describe, expect, test } from 'vitest'
import { setupView } from './workspace-setup.js'

describe('workspace setup view', () => {
  const task = (status: 'queued' | 'running' | 'succeeded' | 'failed') => ({
    id: status,
    actionId: 'install',
    label: 'install',
    status,
    phase: 'queued' as const,
  })

  test('reports open work while anything is still queued or running', () => {
    expect(setupView([task('succeeded'), task('running')])).toMatchObject({ open: true, failed: false })
    expect(setupView([task('succeeded')])).toMatchObject({ open: false, failed: false })
  })

  test('reports a failure the card must show without holding the turn', () => {
    expect(setupView([task('failed')])).toMatchObject({ open: false, failed: true })
  })
})
