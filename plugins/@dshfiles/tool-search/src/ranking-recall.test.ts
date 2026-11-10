import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ToolSchema } from '@deepseek-ai/dsh-llm'
import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'
import { ToolSearchModel } from './search.js'

/** The 20 natural-language queries measured in docs/tool-diet.md on 2026-11-10. */
const documentedQueries: readonly (readonly [target: string, query: string])[] = [
  ['backlog_list', 'list backlog items'],
  ['backlog_list', 'show my open tasks'],
  ['backlog_capture', 'add a task to the backlog'],
  ['backlog_capture', 'create a new todo item in the task tracker'],
  ['jj_thread_status', 'jj thread workspace status'],
  ['jj_thread_status', 'what revisions does this thread have that are not on main'],
  ['jj_thread_rebase', 'land this thread onto main'],
  ['preview_open', 'open a page in the preview browser'],
  ['preview_open', 'open localhost url in headless browser'],
  ['preview_screenshot', 'take a screenshot of the page'],
  ['ai_accounts_quota', 'how much subscription quota is left'],
  ['memory_search', 'search memory of earlier threads'],
  ['traces_search', 'find slow traces for this session'],
  ['thread_create', 'start a new thread'],
  ['secret_list', 'which secrets are configured'],
  ['pull_request_create', 'open a GitHub pull request'],
  ['web_search', 'search the web'],
  ['schedule_create', 'remind me in an hour'],
  ['whiteboard_write', 'draw a diagram on a whiteboard'],
  ['project_checks_run', 'run the project tests check'],
]

/** Phrased by intent across the same families; written before the alias table, which was then tuned on all 40. */
const newQueries: readonly (readonly [target: string, query: string])[] = [
  ['backlog_ready', 'what should I work on next'],
  ['backlog_update', 'mark that item as done'],
  ['schedule_create', 'ping me tomorrow morning to check the build'],
  ['schedule_list', 'which reminders do I have'],
  ['usage_report', 'how much did I spend on tokens this week'],
  ['multi_host_list', 'which remote machines can run threads'],
  ['settings_set', 'change a setting value'],
  ['memory_note', 'remember that I prefer pnpm'],
  ['traces_error_groups', 'which errors keep failing in the last hour'],
  ['thread_rename', 'rename this conversation'],
  ['thread_archive', 'archive this thread'],
  ['background_jobs_board', 'is anything still running in the background'],
  ['jj_details', 'show the patch of a revision'],
  ['preview_click', 'click the button on the page'],
  ['find_threads', 'did we talk about the rate limiter before'],
  ['ai_accounts_quota', 'how much of my ChatGPT allowance is left'],
  ['secret_get', 'read the value of an API key'],
  ['whiteboard_list', 'list my diagrams'],
  ['pull_request_list', 'which pull requests are linked to this thread'],
  ['thread_fork', 'branch this conversation into a copy'],
]

const catalogSchema = Schema.Struct({
  schemas: Schema.Array(Schema.Struct({ name: Schema.String, description: Schema.String, parameters: Schema.Record(Schema.String, Schema.Unknown) })),
})
const liveCatalogSchema = Schema.Struct({
  tools: Schema.Array(Schema.Struct({ name: Schema.String, description: Schema.String, parameters: Schema.Record(Schema.String, Schema.Unknown) })),
})

/** The owned web bundles' schemas, or a live request header's tools captured as `{ tools }` (DSH_TOOL_SEARCH_CATALOG). */
const loadCatalog = (): readonly ToolSchema[] => {
  const livePath = process.env.DSH_TOOL_SEARCH_CATALOG
  if (livePath !== undefined) return Schema.decodeUnknownSync(Schema.fromJsonString(liveCatalogSchema))(readFileSync(livePath, 'utf8')).tools
  const fixture = join(import.meta.dirname, '../../../../tooling/dshx/e2e/fixtures/tool-schemas.json')
  return Schema.decodeUnknownSync(Schema.fromJsonString(catalogSchema))(readFileSync(fixture, 'utf8')).schemas
}

const recall = (catalog: readonly ToolSchema[], cases: readonly (readonly [string, string])[]) => {
  const names = new Set(catalog.map(schema => schema.name))
  const rows = cases
    .filter(([target]) => names.has(target))
    .map(([target, query]) => {
      const ranked = ToolSearchModel.rank(query, catalog).map(match => match.name)
      const rank = ranked.indexOf(target) + 1
      return { target, query, rank: rank === 0 ? undefined : rank, top: ranked.slice(0, 5) }
    })
  return { rows, hits: rows.filter(row => row.rank !== undefined && row.rank <= 5).length }
}

describe('tool-search ranking recall', () => {
  it('finds the target in the top 5 for at least 90% of the documented and new queries', () => {
    const catalog = loadCatalog()
    const documented = recall(catalog, documentedQueries)
    const added = recall(catalog, newQueries)
    if (process.env.DSH_TOOL_SEARCH_MEASURE === '1') {
      console.info(JSON.stringify({ tools: catalog.length, documented: { hits: documented.hits, of: documented.rows.length }, added: { hits: added.hits, of: added.rows.length } }))
      for (const row of [...documented.rows, ...added.rows]) console.info(`${row.rank ?? '-'}\t${row.target}\t"${row.query}"\t${row.top.join(', ')}`)
    }
    const total = documented.rows.length + added.rows.length
    expect(total).toBeGreaterThanOrEqual(30)
    expect((documented.hits + added.hits) / total).toBeGreaterThanOrEqual(0.9)
  })
})
