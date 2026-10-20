import { expect, type Page } from '@playwright/test'
import { Then } from '../bdd.js'
import { finishJourneyAssertions, recordAssertion } from '../steps.js'

const toolkit = (page: Page) => page.getByTestId('agent-toolkit')

Then('the Agent toolkit shows the third-party source and frame behavior', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'tweet-context-tool-is-available-to-the-agent', async () => {
    const tools = toolkit(page).getByRole('region', { name: /^Tools \(\d+\)$/ })
    const tweetContextTool = tools.getByRole('row').filter({ hasText: 'tweet_context' })
    await expect(tweetContextTool).toContainText('api.fxtwitter.com')
    await expect(tweetContextTool).toContainText('sampled image frames')
  })
  await finishJourneyAssertions(page)
})
