import { test as bddTest, type Page } from 'playwright-bdd'
import { createBdd } from 'playwright-bdd'
import { readClientBootOutcome, type BrowserBootOptions, type BrowserBootOutcome } from '../../packages/dshx/src/project/browser-boot.js'

/**
 * createBdd() returns the Given/When/Then constructors this suite defines steps
 * with. The feature and step globs live in playwright.e2e.config.ts, which
 * generates one spec per feature; this module supplies the step vocabulary and
 * the one shared reader every boot step needs.
 *
 * The base test must be playwright-bdd's own, not @playwright/test's, because the
 * BDD fixtures are attached to it.
 */
export const { Given, When, Then, After } = createBdd(bddTest)

/** Read DSH's native readiness, expected manifest entries, audit, and Slot errors. */
export const readBootOutcome = (page: Page, options: BrowserBootOptions): Promise<BrowserBootOutcome> => readClientBootOutcome(page, options)
