When('the right column is set to the global dock in the plugin settings', async ({ page }: { page: Page }) => {
  await globalPanel(page, 'Plugins').click()
  await page.getByRole('button', { name: 'View @dshfiles/workbench', exact: true }).click()
  await page.getByRole('combobox', { name: 'Right panel', exact: true }).selectOption({ label: 'Global dock (persistent panels in the right column)' })
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
})

When('a thread is started and the New Session screen opens again', async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: 'New session', exact: true }).first().click()
  await sendMessage(page, 'dock thread one')
  // Back to the screen with no thread on it: the dock must not depend on a session at all.
  await page.getByRole('button', { name: 'New session', exact: true }).first().click()
  await expect(page.getByRole('textbox', { name: 'Describe what you want to build, / commands, @ files or sessions', exact: true })).toBeVisible()
})

When('the global dock page is reloaded outside any thread', async ({ page }: { page: Page }) => {
  await StartupDialogs.reloadPastProviderSetup(page)
  await expect(page.getByRole('heading', { name: 'Panels', exact: true })).toBeVisible()
})

Then('the global dock shows the Jujutsu panel', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'workbench-global-dock-opens-its-default-panel', async () => {
    await expect(page.getByRole('heading', { name: 'Panels', exact: true })).toBeVisible()
    await expect(dockRegion(page).getByRole('region', { name: 'Jujutsu', exact: true })).toBeVisible()
  })
})

Then('the global dock still shows the Jujutsu panel outside a thread', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'workbench-global-dock-outlives-the-thread-view', async () => {
    await expect(dockRegion(page).getByRole('region', { name: 'Jujutsu', exact: true })).toBeVisible()
  })
})

Then('the global dock still shows the Jujutsu panel after a reload', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'workbench-global-dock-survives-a-reload', async () => {
    await expect(dockRegion(page).getByRole('region', { name: 'Jujutsu', exact: true })).toBeVisible()
    // The surface saves the layout it restored or applied, so the dock's own key holds the panel it shows.
    expect(await page.evaluate(key => localStorage.getItem(key) ?? '', DOCK_LAYOUT_KEY)).toContain('dshfiles-jujutsu.dock')
  })
})

When('the Jujutsu panel is moved to the main view from the dock', async ({ page }: { page: Page }) => {
  await dockRegion(page).getByRole('button', { name: 'Move to main view', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Jujutsu', exact: true }).click()
})

Then('the main view shows the Jujutsu page and the dock no longer shows it', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'workbench-global-dock-moves-a-panel-to-the-main-view', async () => {
    await expect(page.locator('[data-slot="main"]').getByRole('heading', { name: 'Jujutsu', exact: true })).toBeVisible()
    await expect(dockRegion(page).getByRole('region', { name: 'Jujutsu', exact: true })).toHaveCount(0)
  })
  await finishJourneyAssertions(page)
})
