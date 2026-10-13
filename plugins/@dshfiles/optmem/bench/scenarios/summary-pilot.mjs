import { readFile } from 'node:fs/promises'

export const createScenario = async () => {
  const support = JSON.parse(await readFile(new URL('./support.json', import.meta.url), 'utf8'))
  return {
    name: 'summary-pilot',
    fixture: support.fixture,
    description: 'Summary effort ablation using the existing support corpus, stock context policy, and bounded drafting responses.',
    conversations: [
      { name: 'main', turns: [...support.conversations[0].turns.slice(0, 13), ...support.conversations[0].turns.slice(18, 22)] },
      ...support.conversations.slice(1),
    ],
  }
}
