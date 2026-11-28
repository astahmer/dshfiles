export async function selectProject(page, projectName) {
  const selected = page.getByRole('heading', { name: `What should we build in ${projectName}?`, exact: true })
  // The bound chip keeps the same aria-label. Only its placeholder means there is no project.
  const unselected = page.getByRole('button', { name: 'Choose project', exact: true }).filter({ hasText: /^\s*Choose project\s*$/ })
  await selected.or(unselected).filter({ visible: true }).first().waitFor()
  if (!(await selected.isVisible())) {
    await unselected.click()
    const search = page.getByRole('textbox', { name: 'Search projects or enter a folder path', exact: true })
    await search.fill(projectName)
    await page.getByRole('option').filter({ hasText: projectName }).first().click()
  }
  await selected.waitFor()
  const composer = page.getByRole('textbox', { name: 'Describe what you want to build, / commands, @ files or threads', exact: true }).filter({ visible: true })
  await composer.waitFor()
  return composer
}
