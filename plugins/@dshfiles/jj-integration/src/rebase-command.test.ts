import { describe, expect, it } from 'vitest'
import { rebaseCommand } from './host-hooks-promise.js'

describe('/rebase', () => {
  it('describes itself with the glossary: land, not rebase onto a bookmark', () => {
    expect(rebaseCommand.description).toBe('Land this thread’s work on the project’s main branch.')
  })
})
