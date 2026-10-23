import { describe, expect, test } from 'vitest'
import { threadActionCommands } from './thread-actions-host.js'

describe('thread lifecycle slash commands', () => {
  test('registers settle and archive', () => {
    expect(threadActionCommands.map(command => command.name)).toEqual(['settle', 'archive'])
  })
})
