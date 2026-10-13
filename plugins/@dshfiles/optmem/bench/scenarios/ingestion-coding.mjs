import { createHash } from 'node:crypto'

const topics = [
  {
    title: 'organization and provider isolation',
    rule: 'Canonical records and durable progress belong to the exact pair (organization, provider). Scope identifiers use /^[a-z][a-z0-9-]{1,63}$/; do not trim or normalize invalid scope into another tenant. Opaque external record ids are not organization identifiers.',
    tasks: [
      'Read src/store.js and src/report.js, then run the smoke suite. Reproduce two organizations ingesting the same provider external id with different titles into one store. Add a failing isolation test, repair the narrow owner, rerun that test and the smoke suite. Do not merely partition the report while leaving durable storage shared.',
      'Inspect the repaired scope selection. Add a case for two providers in one organization and rejection cases for blank, leading-space, slash-containing, and __proto__ scope identifiers. Invalid scope must reject with IC_INVALID_SCOPE before mutation. Run those regressions.',
      'Run the scoped tests against a reopened JSON store, not only the first in-memory object. Verify same external id in both organizations stays independent and unseen scope returns zero counters. Inspect persisted rows for accidental cross-scope aliases; fix any regression.',
    ],
  },
  {
    title: 'defensive snapshots and ownership',
    rule: 'Callers may inspect scope and snapshot data but cannot mutate live canonical state through a returned object. JSON snapshots are values, not shared references to the store owner.',
    tasks: [
      'Read the snapshot and scope accessors. Add a repro that mutates a returned records array, checkpoint, and top-level scopes list. Fix both read boundaries to return defensive values. Run that regression and prove a subsequent scope read remains unchanged.',
      'Review the copy boundary after an unsuccessful commit. Add a nested title-mutation case and ensure an earlier snapshot does not retroactively change after a later successful page. Run real tests; do not replace the store with a mocked snapshot object.',
      'Inspect the call sites in ingestion and reporting for reliance on live object mutation. Run a regression that obtains an unseen scope, mutates it, then commits another scope. Verify no invented rows or progress appear in persisted state.',
    ],
  },
  {
    title: 'canonical response mapping',
    rule: 'Canonical output enumerates externalId, title, and observedAt only. An exact nonblank external id may contain punctuation or __proto__; it is not a dictionary prototype or a scope id. Incidental provider metadata is not durable customer data.',
    tasks: [
      'Inspect the record mapper in src/store.js. Add a page with an internalTransport field and a legitimate externalId of __proto__. Repair mapping so only the three canonical fields persist without prototype behavior. Run the regression and inspect the actual JSON output.',
      'Add record validation for a nonblank string externalId of at most 128 characters, a string title, and an ISO date-time observedAt with a finite parsed timestamp. Reject IC_INVALID_RECORD rather than coercing malformed values. Run malformed-row tests.',
      'Review output fields in src/report.js and the CLI. Run a case with additional provider-only debug fields and verify neither persisted rows nor public summary include them. Preserve valid opaque identities; avoid over-restricting them with the scope-id regex.',
    ],
  },
  {
    title: 'checkpoint progression',
    rule: "An unseen scope starts at page 0. A new commit must match that scope's current nextPage and supply nextPage === page + 1. Nonnegative integer pages only. Invalid progression rejects IC_CHECKPOINT_CONFLICT without adding rows.",
    tasks: [
      'Read commitPage and add tests for page 4 on a new store, nextPage equal to page, and a correct page 0 commit. Implement checkpoint validation before mutation. Run the focused progression test and print only bounded failure evidence.',
      'Test a valid first page followed by a skipped page or regressing nextPage. Inspect whether failed operations changed revision or scoped records. Repair any checkpoint validation order bug and rerun the actual regression.',
      "Run a resume journey after reopening the file. The next fetchPage request must use the persisted selected scope checkpoint, not an attempt-local counter or another provider's position. Test both the valid resume and a gap refusal.",
    ],
  },
  {
    title: 'idempotent page replay',
    rule: 'An identical already-committed page returns status replayed. It does not add records, commits, revision, or writes. Idempotence covers the committed canonical payload, nextPage, and terminal marker, not just a matching page number.',
    tasks: [
      'Add a failing test that commits the same page twice and compares full snapshots plus on-disk bytes. Implement replay identity without double-counting. Run the regression and confirm revision increments once, not once per attempt.',
      'Reopen the store and replay a prior page after later progress. Verify return nextPage and recordCount reflect current durable scope state while no checkpoint regresses. Add and run the persisted replay test.',
      "Inspect the replay key for scope inclusion and canonical mapping. Run identical pages in two organizations and replay only one. Demonstrate the other organization's records, commit count, and checkpoint are untouched.",
    ],
  },
  {
    title: 'changed replay conflict',
    rule: 'A changed payload for a previously committed page is a conflict, not a new successful observation. Reject IC_REPLAY_MISMATCH and preserve state. Incidental noncanonical transport fields should not alter canonical replay identity.',
    tasks: [
      'Create a repro where page 0 is committed, then replayed with a changed title. Implement changed-replay refusal and compare snapshot before/after the error. Run the regression rather than claiming any page-number match is sufficient.',
      'Test a replay with a changed terminal marker and one with only an extra provider debug field. The former must conflict; the latter must remain the same canonical page. Run tests and inspect persisted commit provenance.',
      'Review commit identity after another scope succeeds. Run changed-replay rejection after reopening the file and verify the queue can still accept a valid next page after the refusal. No global store reset is allowed.',
    ],
  },
  {
    title: 'whole-page validation atomicity',
    rule: 'Validate every row before committing any row or checkpoint. Duplicate external ids within one page reject IC_DUPLICATE_ID. A page with one good and one bad row is wholly refused with IC_INVALID_RECORD.',
    tasks: [
      'Add a regression with a valid first row and invalid second timestamp. Reproduce any partial mutation, then repair whole-page validation so no scope or checkpoint is created on failure. Run the test against actual store code.',
      'Add two rows with the same externalId in one response; reject IC_DUPLICATE_ID without silently choosing a winner. Compare persisted bytes and revision to the pre-operation snapshot. Run the non-happy test.',
      'Run the bad-page refusal after a previous good page. Preserve the existing records and durable checkpoint, then successfully commit a corrected page. Verify recovery does not require deleting historical state.',
    ],
  },
  {
    title: 'observation freshness amendment',
    rule: 'Acquisition order and observation time are different facts. The original prototype replaces an identity with the last arriving row. A later decision in this conversation can supersede that policy; do not infer a new policy from the order of these sample rows.',
    tasks: [
      'Read the existing upsert behavior and add a characterization test for the current arrival-order policy. Show a late-arriving older timestamp and explain the risk in the test name or assertion message. Do not settle the final freshness rule until the product amendment arrives.',
      "Apply the conversation's amended freshness rule to the real upsert owner. Add a newer-then-older observation test across different pages. The newer title and timestamp must survive, while the older page can still advance its durable checkpoint. Run both freshness and replay tests.",
      'Run a persisted freshness journey after reopening. Test a later new observation as well as an older one, and verify unique record count remains one. Repair stale-title regressions without changing the approved checkpoint semantics.',
    ],
  },
  {
    title: 'permanent provider outcomes',
    rule: "400, 401, and 403 are permanent acquisition failures in this simulation. They do not prove an empty catalog, advance a checkpoint, grant another organization's access, or authorize fallback. Return partial/provider-permanent; preserve usable rows.",
    tasks: [
      'Read src/ingest.js and reproduce the non-200 path claiming completion. Add parameterized 400/401/403 tests, repair result classification, and verify no retry or commit occurs. Run these tests and existing successful acquisition tests.',
      'Test a permanent response that includes misleading records, done:true, and nextPage. These fields must not be committed. Preserve an earlier successful page and return its recordCount/checkpoint. Run the non-happy regression.',
      'Inspect src/cli.js after the provider-classification fix. Replay a local permanent failure and inspect JSON stdout. It must report truthful partial status without printing raw records or reclassifying a denied response as a successful empty observation.',
    ],
  },
  {
    title: 'retry policy correction',
    rule: '429 and 503 are retryable; thrown transport errors are treated as retryable acquisition failures. Total attempts, delay floor, and retry-after rules are explicit conversation decisions. Retry the same scoped page and never create an empty observation from a failure.',
    tasks: [
      'Implement the corrected retry policy in src/ingest.js with injectable sleep and fetchPage. Add a scripted 429,503,200 provider sequence and capture requested page/attempt plus delays. Run the test; no real network or real waiting is necessary.',
      'Add a provider Retry-After case above the approved delay floor and one below it; use max(configured floor, retryAfterSeconds*1000). Add a thrown transport exception followed by successful terminal empty page. Run exact delay and request-sequence assertions.',
      'Inspect whether scope identifiers and signal reach every retry callback. Run tests using overlapping organization identities and malformed retry-after values. No retry may accidentally fetch another scope or emit an unbounded provider payload.',
    ],
  },
  {
    title: 'retry exhaustion and attempt accounting',
    rule: 'The attempt ceiling includes the first request. Do not sleep after the final failed attempt. Exhaustion returns partial/retry-exhausted and durable counters, preserving existing committed records and checkpoint.',
    tasks: [
      'Add and run an exhaustion repro with the corrected total attempt ceiling. Verify exact fetch count, attempt numbers, sleep count, partial result, and unchanged durable state. Fix off-by-one errors in the real retry loop.',
      'Test exhaustion after one earlier page succeeded in the same ingest call. pagesCommitted counts successful commits only; recordCount and nextPage must describe durable scoped state. Run the regression against reopened persistence too.',
      'Review configured maxAttempts and maxPages validation. Bound maxAttempts to integer 1..10 and maxPages to integer 1..100; retryMinDelayMs is a nonnegative safe integer. Reject IC_INVALID_OPTIONS instead of allowing zero, fractions, or endless loops. Run refusal tests.',
    ],
  },
  {
    title: 'quota-exhausted partial results',
    rule: 'A 429 with quotaExhausted:true is not an ordinary delayed retry. Stop immediately with partial/quota, preserving successful rows and incomplete coverage. No paid fallback, plan upgrade, or global progress reset is allowed.',
    tasks: [
      'Add a local provider sequence that commits one page then returns quotaExhausted:true. Implement immediate partial/quota stop without sleeping or calling a third response. Run exact counter and preservation assertions.',
      'Test quota exhaustion before any page and after a different organization has completed. Report only selected scope state and preserve the other scope. Run the regression and inspect the stored complete markers.',
      'Run the CLI replay with quota exhaustion from a local JSON response file. Capture truthful partial stdout, persisted rows, and a later resume. Verify no fallback command, network client, or extra dependency was added to the repository.',
    ],
  },
  {
    title: 'page-budget pause and resume',
    rule: 'A bounded page budget can end successfully acquired but incomplete work. Return partial/page-budget unless a successful response explicitly marked done. A later invocation resumes from the committed checkpoint; a completed scope needs no further fetch.',
    tasks: [
      'Add a maxPages:1 test with a nonterminal successful page. Fix false completion and show the next invocation fetches the durable next page. Run the pause/resume test, not a mocked page counter.',
      'Add a successful terminal empty page: done:true with zero rows is positive acquisition evidence and advances the checkpoint. Contrast it with a transport timeout. Run both cases and inspect report.complete.',
      'Test invoking ingest on an already complete scope with a fetch callback that would fail if called. Return complete with pagesCommitted:0 and durable counts. Run this test with a persisted reopened store.',
    ],
  },
  {
    title: 'cancellation and late-result protection',
    rule: 'An aborted signal cancels acquisition. Check before fetch, after fetch before commit, and after sleep before retry. Return cancelled/aborted with durable counters; a late provider response must not resurrect cancelled work.',
    tasks: [
      'Add an AbortController regression cancelled before the first request. Implement cancellation handling and assert zero fetches, zero commits, and no false complete result. Run the test.',
      'Add a provider callback that aborts the signal immediately before returning a successful page. Prevent commit of that late response. Add cancellation during injected sleep and run both regressions.',
      'Inspect ordering between cancellation and durable commit ownership. Run a successful first page followed by cancellation on a later response; keep the first page. Document that this single-process lab does not promise rollback of a commit already published before cancellation.',
    ],
  },
  {
    title: 'filesystem failure atomicity',
    rule: 'Publish in-memory candidate state only after persistence succeeds. Write a sibling temporary file and atomically rename it; do not truncate the live state first. Failure must preserve prior in-memory rows, checkpoint, and revision.',
    tasks: [
      'Add a real filesystem repro: open a new store, then create a directory at the intended state-file path before committing. The write/rename must fail without changing snapshot state. Fix transaction publication ordering and run the test; do not mock fs.',
      'Inspect persisted state replacement. Test a good page followed by a rejected bad page and reopen the good file. Verify JSON stays parseable and the prior checkpoint remains. Add a regression for queue recovery after a failed operation.',
      'Review atomicity claims against the code. Run the filesystem failure regression and note that atomic rename is not an fsync durability or multi-process locking guarantee. Do not add an expensive database or claim guarantees this fixture cannot prove.',
    ],
  },
  {
    title: 'restart and corrupt state visibility',
    rule: 'ENOENT means a new empty store. Invalid persisted JSON or invalid snapshot shape rejects IC_CORRUPT_STATE. Do not silently reset corrupt state, overwrite it, or call it a successful empty catalog.',
    tasks: [
      'Add a corrupt-file test with actual malformed JSON. Make openStore produce IC_CORRUPT_STATE and preserve the original bytes. Run the corruption test and the new-store smoke journey.',
      'Test valid JSON with invalid version, revision, scopes, or record shape. Reject visible corruption rather than coercing values. Reopen a valid state produced by your own code and run both acceptance and rejection journeys.',
      'Write a short operator recovery note under docs/ explaining read-only diagnosis, preserving original bytes, and restoring from known-good state without global coverage resets. Run the real corrupt-state regression after writing the note.',
    ],
  },
  {
    title: 'same-process concurrent commit ownership',
    rule: 'Concurrent commitPage calls on one openStore instance must serialize validation and publication. Different scopes both survive; duplicate same-page work replays rather than increments twice. Multi-process writers are explicitly out of scope.',
    tasks: [
      'Add Promise.all commits for two organizations sharing a provider. Reopen the file and verify both rows/checkpoints and revision:2. Repair in-process commit ownership without introducing a global shared singleton or pretending to solve multi-process locking.',
      'Add concurrent identical-page commits to one scope and a failed operation followed by a valid queued commit. Verify one commit plus one replay, no poisoned queue, and durable outcome after reopen. Run focused concurrency regressions.',
      'Inspect whether validation runs inside the serialized owner rather than against stale pre-queue state. Run parallel different-scope and duplicate-same-page cases repeatedly in the local suite; keep test output bounded and deterministic.',
    ],
  },
  {
    title: 'scoped summary and executable release',
    rule: 'Summary is exactly organization,provider,nextPage,recordCount,complete,acquiredPages for the selected pair. The CLI is a local simulated response reader, not an external provider. Release metadata and docs must explain corrected scope, retry, and partial-result semantics.',
    tasks: [
      'Read src/report.js and src/cli.js, then add scoped-summary and unseen-scope tests. Fix aggregation that accidentally exposes another organization or raw records. Run these tests and a successful local CLI replay.',
      'Add CLI integration cases for quota exhaustion and permanent provider failure using temporary state and local responses JSON. Compare stdout to the scoped store summary. Run subprocess tests without a network, credentials, real waiting, or paid dependencies.',
      'Run the full local test suite and inspect the release diff. Set package version to the approved final target, update CHANGELOG.md with scope/retry/partial corrections, and document the final API behavior. Keep the CLI runnable and summarize actual test counts, not imagined success.',
    ],
  },
]

const evidenceKinds = [
  [
    'committed',
    'Rows and page checkpoint committed together; canonical identity counts exclude duplicate acquisition and carry an organization plus provider boundary. A retry attempt is not an additional successful page.',
  ],
  [
    'retryable',
    'The provider failed before a complete page was acquired. Attempt-local observations are diagnostic only. A status of 429 or 503 must not manufacture an empty successful catalog or grant a second scope access.',
  ],
  [
    'stale-observation',
    'The returned record has an older observation time even though it arrived later. Arrival order is not freshness evidence. Preserve provenance and apply the effective business decision, not an archived draft.',
  ],
  [
    'late-result',
    'An acquisition callback completed after the cancellation signal was set. Previously durable work remains valid; this new response is not allowed to commit merely because its HTTP status is successful.',
  ],
  [
    'replay',
    'The page payload matches a previous canonical commit. The durable checkpoint can be ahead of this page. Returning an acknowledgement must not add a new revision, write the state again, or regress current progress.',
  ],
  [
    'conflict',
    'A page is reused with changed canonical content or a skipped checkpoint. The correct outcome is an explicit refused operation and unchanged prior state, not an unconditional upsert or global reset.',
  ],
  [
    'quota',
    'The free simulated provider quota is exhausted for the remaining work. Usable rows from earlier pages remain reviewable. Neither automatic paid fallback nor fabricated completion is a permitted recovery strategy.',
  ],
  [
    'scope-mismatch',
    'An overlapping external identity belongs to another organization or provider. The receiving scope may not borrow its title, count, checkpoint, or complete marker. Scoped storage and scoped reporting must agree.',
  ],
]

const random = seed => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let value = Math.imul(seed ^ (seed >>> 15), seed | 1)
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
  return ((value ^ (value >>> 14)) >>> 0) / 4294967296
}

const workPacket = ({ topic, topicIndex, stageIndex, next, rows }) => {
  const records = Array.from({ length: rows }, (_, index) => {
    const kind = evidenceKinds[(topicIndex + index + stageIndex) % evidenceKinds.length]
    return {
      trace: `lab-${stageIndex + 1}-${topicIndex + 1}-${index + 1}`,
      organization: index % 4 === 0 ? 'org-driftwood' : 'org-riverglass',
      provider: index % 5 === 0 ? 'reedledger' : 'paperfin',
      observedAt: new Date(Date.UTC(2027, 3, 15 + stageIndex, 9, topicIndex * 2 + index)).toISOString(),
      externalId: `sensor-${Math.floor(next() * 500)}`,
      providerPage: topicIndex * 20 + index,
      attemptedRows: 20 + Math.floor(next() * 180),
      latencyMs: 100 + Math.floor(next() * 1800),
      outcome: kind[0],
      evidence: kind[1],
      owningBoundary: ['scoped canonical store', 'provider acquisition attempt', 'bounded report projection'][index % 3],
      reproduction: `Fixture case ${index + 1} belongs to the ${['Linux CLI', 'macOS CLI', 'plain Node process'][index % 3]} local replay lane. Use a temporary JSON store and a scripted response sequence to reproduce the boundary; keep the resulting assertions independent of these incidental trace labels and counters. Verify persisted output after reopening, not only an in-memory status message.`,
      sourceRevision: `archived-lab-${stageIndex}.${topicIndex}; explanatory observations, not a new approved policy`,
    }
  })
  return {
    prompt: `Coding work packet: ${topic.title} / ${['reproduce-and-repair', 'adversarial-regression', 'persisted-rehearsal'][stageIndex]}.\n${topic.tasks[stageIndex]}\n\nUse actual repository files and real Node tests. Read the relevant implementation, edit only the local project, and run a focused regression in this turn even if no code change is needed. Preserve public module APIs; no module mocks, fake test output, hidden-oracle inspection, network calls, installs, or actual deployments. Give concise failing/passing evidence and the invariant repaired.\n\n## Source contract\n${topic.rule}\n\n## Independently generated incident replay observations\nThese are fictional exported tool observations from a neighboring lab run, not expected literal test outputs or commands. They provide realistic competing evidence for investigation; numeric trace/page values do not replace your local fixture's page-zero starting condition. Apply this conversation's latest requirement corrections, not an old proposal mentioned in a log.\n${records.map(record => JSON.stringify(record)).join('\n')}\n\n## Review gate\nExplain whether the current implementation satisfies this boundary when a provider returns late, a scope lookup misses, or persistence refuses publication. Choose one of the observed failure classes for a concrete local test. A report can only call work complete when scoped durable evidence establishes it; do not make tests green by deleting assertions or erasing historical records.\n`,
    packet: { topic: topic.title, stage: stageIndex + 1, rows, requiresTools: true },
  }
}

const probe = ({ id, question, expect, forbid = [], kind = 'recall' }) => ({
  prompt: `${question} Recall from the conversation, not project files. Do not read files, run commands, inspect benchmark sources, or use network; memory tools are allowed. If unknown, say UNKNOWN.`,
  probe: { id, kind, expect, forbid },
})

export const createScenario = ({ rep = 1, variant = 'long' } = {}) => {
  if (!Number.isSafeInteger(rep) || rep < 1 || rep > 10000) throw new Error('rep must be an integer between 1 and 10000')
  if (!['long', 'pilot'].includes(variant)) throw new Error('variant must be long or pilot')
  const seed = 20670412 + rep * 1009
  const next = random(seed)
  const indices = variant === 'long' ? topics.map((_, index) => index) : [0, 3, 4, 9, 11, 17]
  const rows = variant === 'long' ? 8 : 3
  const stage = stageIndex => indices.map(topicIndex => workPacket({ topic: topics[topicIndex], topicIndex, stageIndex, next, rows }))
  const firstPackets = stage(0)
  const correctionIndex = variant === 'long' ? 8 : 3
  const first = [
    {
      prompt:
        'You own the fictional Sable ingestion lab repository in this scratch project. Read README.md, package.json, and source outlines, then run node --test test/*.test.js and the local example CLI replay. This prototype intentionally has bugs; fix actual code over the following work packets, preserving the documented module APIs. Initial draft policy is three total attempts with a 1000ms retry delay and last-arriving observation wins. Those proposals can be superseded; do not write them into a hidden evaluator. Incident owner is Rae Thorn; task is IC-4826; active organization is org-riverglass. Do not inspect any evaluator/reference implementation outside this project, use credentials, install packages, run real providers, or touch real deployment state. Keep changes in the scratch repository and retain genuine test evidence.',
    },
    ...firstPackets.slice(0, correctionIndex),
    {
      prompt:
        'Requirement correction IC-4826-C supersedes the initial retry proposal: four TOTAL attempts, including the first; default retry floor is 90000ms (90 seconds), not 1000ms. Delay is max(configured floor, nonnegative finite retryAfterSeconds times 1000). Do not sleep after the final failed attempt. No paid fallback. Update relevant source defaults and public docs/tests now, then run the focused retry regression. Do not settle freshness until the next session amendment.',
    },
    ...firstPackets.slice(correctionIndex),
    probe({
      id: 'coding-delayed-retry',
      question: 'What is the corrected total attempt ceiling and default delay floor in milliseconds?',
      expect: [['four', '4'], '90000'],
      forbid: ['1000ms', 'three attempts'],
      kind: 'delayed-recall',
    }),
  ]
  const second = [
    {
      prompt:
        'New coding session, same repository and project. Product amendment IC-4826-F supersedes last-arriving-wins: newer observedAt always wins canonical content; an older row arriving later does not regress title or timestamp, although its valid page still commits progress. Keep an existing row when timestamps tie. Final release version is 0.2.0. Retain partial committed rows on quota exhaustion or any failed later page. A terminal successful empty page is valid; failed acquisition is not empty evidence. Retrieve prior retry correction using project memory, inspect the current code, update freshness tests/docs/source, and run the relevant regressions. Do not read evaluator or reference source.',
    },
    ...stage(1),
    probe({
      id: 'coding-delayed-owner',
      question: 'Who owns incident IC-4826 and which organization is active?',
      expect: ['Rae Thorn', 'org-riverglass'],
      kind: 'delayed-recall',
    }),
  ]
  const third = [
    probe({
      id: 'coding-cross-retry',
      question: 'Fresh session: what are the effective total attempts and retry floor, in milliseconds? Give only current values.',
      expect: [['four', '4'], '90000'],
      forbid: ['three attempts', '1000ms'],
      kind: 'cross-session',
    }),
    probe({
      id: 'coding-cross-freshness',
      question: 'Fresh session: does last arrival or newer observation time win canonical content?',
      expect: [
        ['newer', 'newest'],
        ['observedAt', 'observation'],
      ],
      forbid: ['last arrival wins'],
      kind: 'cross-session',
    }),
    probe({
      id: 'coding-cross-release',
      question: 'Fresh session: what final release version did the amendment approve?',
      expect: ['0.2.0'],
      kind: 'cross-session',
    }),
    ...stage(2),
    {
      prompt:
        'Which approved external paid fallback API hostname should this lab call after quota exhaustion? Answer NOT_RECORDED if no hostname was established. Memory tools allowed, no files/commands/source/network. Do not invent a service.',
      probe: { id: 'coding-negative-fallback', kind: 'negative-recall', expect: ['NOT_RECORDED'] },
    },
    {
      prompt:
        'Final implementation review. Read your project source and tests only, run node --test test/*.test.js plus local CLI success/partial journeys, and repair any remaining defect. Recheck exact organization+provider ownership; defensive copies; validated canonical-only rows; atomic checkpoint+records; identical replay no-op and changed replay conflict; no skipped pages; persisted reopen; corrected bounded retry policy; permanent failure vs incomplete/quota outcomes; cancellation before late commit; stale observation protection; in-process concurrent commit serialization; corrupt-file refusal; scope-only report fields. Do not inspect hidden evaluator/reference source, copy a solution, disable tests, or hardcode observed fixture ids. Release 0.2.0 must have CHANGELOG.md entries mentioning scope, retry, and partial behavior. Summarize actual test results and explicitly limit atomicity claims to this single-process JSON lab.',
    },
    {
      prompt:
        'Write docs/verification.md with your actual commands, test counts, one demonstrated rejection journey, and remaining limitations. Perform one last real test run after documentation edits. Report source files changed and evidence; do not claim a real provider, production deploy, paid fallback, or multi-process database was tested.',
    },
  ]
  const conversations = [
    { name: 'prototype-repair', turns: first },
    { name: 'requirement-amendment-and-audit', turns: second },
    { name: 'fresh-session-persisted-release', turns: third },
  ]
  const sessionGuardrail =
    'Session isolation: coding work may read, edit, and test ONLY this scratch project source, public tests, examples, and docs; memory tools are allowed. Do not read DSH_HOME, DSH session logs or exports, host/runtime databases, process environment to locate host state, benchmark/evaluator files, reference implementation source, another run, or another project. Never decompress or reconstruct previous DSH transcripts from disk. Recall probes additionally forbid project filesystem and shell access. These are evaluation restrictions, not permission to inspect hidden state.'
  for (const conversation of conversations) conversation.turns[0].prompt = `${sessionGuardrail}\n\n${conversation.turns[0].prompt}`
  const prompts = conversations
    .flatMap(conversation => conversation.turns)
    .map(turn => turn.prompt)
    .join('\n')
  return {
    name: 'ingestion-coding',
    description:
      'Tool-heavy fictional Node ingestion repair: scoped persistence, replay, retries, partial results, cancellation, corrections, and fresh-session executable acceptance',
    fixture: 'ingestion-coding',
    truth: {},
    acceptance: 'acceptance/coding-ingestion.test.mjs',
    conversations,
    metadata: {
      generatorVersion: 1,
      variant,
      rep,
      seed,
      turnCount: conversations.reduce((count, conversation) => count + conversation.turns.length, 0),
      packetCount: indices.length * 3,
      rowsPerPacket: rows,
      promptBytes: Buffer.byteLength(prompts),
      estimatedPromptTokens: Math.ceil(prompts.length / 4),
      tokenEstimateMethod: 'UTF-16 characters / 4; new input corpus only, not provider usage or tool-generated history',
      corpusSha256: createHash('sha256').update(prompts).digest('hex'),
      crossProjectIsolation: 'same-project sessions; actual code acceptance verifies organization/provider isolation, not OptMem cross-project isolation',
    },
  }
}
