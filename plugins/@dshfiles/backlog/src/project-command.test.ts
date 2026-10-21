import { describe, expect, it } from 'vitest'

import { BacklogProjectCommand } from './project-command.js'

describe('project command', () => {
  it('finds /project at the start or after a space, with the query being typed', () => {
    expect(BacklogProjectCommand.at('/project', 8)).toEqual({ query: '', start: 0, end: 8 })
    expect(BacklogProjectCommand.at('note /project wel', 17)).toEqual({ query: 'wel', start: 5, end: 17 })
    expect(BacklogProjectCommand.at('note\n/project welii', 19)).toEqual({ query: 'welii', start: 5, end: 19 })
  })

  it('ignores a slash inside a word or another command', () => {
    expect(BacklogProjectCommand.at('a/project', 9)).toBeNull()
    expect(BacklogProjectCommand.at('/projects', 9)).toBeNull()
    expect(BacklogProjectCommand.at('catch up', 8)).toBeNull()
  })

  it('removes the whole command and joins the surrounding text once', () => {
    const text = 'ship it /project welii please'
    const command = BacklogProjectCommand.at(text, 22)
    expect(command).toEqual({ query: 'welii', start: 8, end: 22 })
    expect(command === null ? '' : BacklogProjectCommand.strip(text, command)).toBe('ship it please')
    const only = '/project welii'
    const onlyCommand = BacklogProjectCommand.at(only, only.length)
    expect(onlyCommand === null ? '' : BacklogProjectCommand.strip(only, onlyCommand)).toBe('')
  })
})
