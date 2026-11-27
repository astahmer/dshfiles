import { expect, it } from 'vitest'
import { neutralSystemPrompt } from './antigravity-system-prompt.js'

const HARNESS_SOURCE =
  'The runtime context names the DeepSeek Harness implementation checkout. The checkout location and current working directory are separate values and may differ.'
const FROZEN_HARNESS_SOURCE =
  'The DeepSeek Harness implementation checkout is at /synthetic/checkout. The checkout location and current working directory are separate values and may differ.'
const WEB_SURFACE =
  'You are interacting with the user through the DeepSeek Harness Web GUI whose URL the runtime context names. When the user refers to "this page", they mean this GUI.'
const FROZEN_WEB_SURFACE =
  'You are interacting with the user through the DeepSeek Harness Web GUI at http://127.0.0.1:3080. When the user refers to "this page", they mean this GUI.'

it('opens with a neutral identity instead of the harness one', () => {
  expect(neutralSystemPrompt('You are an AI agent powered by DeepSeek Harness.\n\nYou are a coding agent.')).toBe(
    'You are an AI coding agent.\n\nYou are a coding agent.',
  )
})

it('leaves out the checkout and Web GUI paragraphs this installation adds', () => {
  const prompt = ['You are an AI agent powered by DeepSeek Harness.', HARNESS_SOURCE, WEB_SURFACE, 'Prefer the repository check command.'].join('\n\n')
  expect(neutralSystemPrompt(prompt)).toBe('You are an AI coding agent.\n\nPrefer the repository check command.')
})

it('leaves out the paragraphs an older release wrote into a resumed Session', () => {
  expect(neutralSystemPrompt(`You are an AI agent powered by DeepSeek Harness.\n\n${FROZEN_HARNESS_SOURCE}\n\n${FROZEN_WEB_SURFACE}`)).toBe(
    'You are an AI coding agent.',
  )
})

it('keeps a prompt that never carried the rejected parts unchanged', () => {
  const prompt = 'You are a coding agent.\n\nUse the tools the conversation offers.'
  expect(neutralSystemPrompt(prompt)).toBe(prompt)
})

it('keeps paragraphs that merely mention DSH', () => {
  const prompt = 'You are an AI agent powered by DeepSeek Harness.\n\nDSH turns `jj:<name>` into a link to a Jujutsu revision.'
  expect(neutralSystemPrompt(prompt)).toBe('You are an AI coding agent.\n\nDSH turns `jj:<name>` into a link to a Jujutsu revision.')
})
