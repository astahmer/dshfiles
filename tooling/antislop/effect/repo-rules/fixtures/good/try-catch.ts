import { Effect } from 'effect'

export const parse = (input: string) => {
  try {
    return JSON.parse(input)
  } catch {
    return null
  }
}

export const program = Effect.succeed(parse('{}'))
