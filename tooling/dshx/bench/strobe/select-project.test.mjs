import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chromium } from 'playwright'
import { selectProject } from './select-project.mjs'

const projectName = 'sample'

for (const bound of [true, false]) {
  test(`waits for the sample composer from a ${bound ? 'bound' : 'projectless'} draft`, async () => {
    const browser = await chromium.launch({ headless: true })
    try {
      const page = await browser.newPage()
      await page.setContent(`
        <button aria-label="Choose project" onclick="this.dataset.clicked = 'true'; picker.hidden = false">
          ${bound ? projectName : 'Choose project'}
        </button>
        <h2>${bound ? 'What should we build in sample?' : 'What should we build?'}</h2>
        <div id="picker" hidden>
          <input aria-label="Search projects or enter a folder path">
          <button role="option" onclick="selectSample()">sample</button>
        </div>
        <script>
          function mountComposer() {
            const composer = document.createElement('div')
            composer.contentEditable = 'true'
            composer.setAttribute('role', 'textbox')
            composer.setAttribute('aria-label', 'Describe what you want to build, / commands, @ files or threads')
            composer.textContent = 'Ready'
            document.body.append(composer)
          }
          function selectSample() {
            document.querySelector('h2').textContent = 'What should we build in sample?'
            document.querySelector('[aria-label="Choose project"]').textContent = 'sample'
            document.querySelector('#picker').hidden = true
            setTimeout(mountComposer, 100)
          }
          ${bound ? 'setTimeout(mountComposer, 100)' : ''}
        </script>
      `)
      await selectProject(page, projectName)
      const chip = page.getByRole('button', { name: 'Choose project', exact: true })
      assert.equal(await chip.getAttribute('data-clicked'), bound ? null : 'true')
      assert.equal(await page.getByRole('textbox', { name: /^Describe what you want to build/ }).isVisible(), true)
    } finally {
      await browser.close()
    }
  })
}
