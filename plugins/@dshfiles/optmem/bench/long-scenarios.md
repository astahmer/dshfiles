# Long OptMem scenario corpus

## Scope and loader contract

These scenarios **build** fictional operational transcripts because the existing short fixtures do not exercise sustained decision correction, acquisition uncertainty, interrupted work, and fresh-session handoff. They are not ports of either inspiration repository and contain no proprietary source, real incidents, account data, credentials, provider responses, or copied documents.

Each module exports `createScenario({ rep = 1, variant = 'long' } = {})`, returning an ordinary scenario object. The three entry points are [infra-rollout](scenarios/infra-rollout.mjs), [ingestion-incident](scenarios/ingestion-incident.mjs), and [product-support](scenarios/product-support.mjs). There is no `fixture`, preparation hook, or `compaction` property. `truth` is empty: all model-visible evidence is inline, not fetched from the evaluator oracle. The existing JSON driver can consume CLI-generated JSON without any generator-specific changes; module loading and repetition selection are the parent's harness responsibility.

Implementation sources are [domain definitions](long-scenario-data.mjs), [deterministic generator](long-scenarios.mjs), [offline CLI](generate-long-scenarios.mjs), and [focused tests](long-scenarios.test.mjs). Generated JSON is derived output and is intentionally not committed. Change those sources, then regenerate; do not patch exported JSON by hand.

Every long scenario has 68 user turns across three sequential sessions in one scratch project: discovery/correction (27), audit/rehearsal (33), and fresh-session handoff (8). There are 54 distinct topic/stage work packets, 18 topics revisited across discovery, contradictory audit, and acceptance rehearsal. Each packet contains domain prose and 18 structured tool-observation records, requiring concrete recommendations, a falsifiable check, and stop-halfway behavior. Records vary platform or organization scope, ownership, outcomes, counters, timestamps, provenance, and failure classifications. Repeated status schemas are intentional realistic log structure, not random prose padding. The synthetic records are pasted exported tool data, not actual live tool invocations; artifact creation and inspection are actual file/tool work during a run.

No artificial 40k compaction threshold or retain-token override is present. The model/provider's stock compaction policy remains the control. Total corpus size is not the same as maximum context in any one session, and cannot guarantee compaction on a provider with a larger window.

## Volume and repetitions

Repetition 1, generator version 1:

| Scenario                       | Long prompt bytes | Estimated long input tokens | Pilot turns | Estimated pilot input tokens |
| ------------------------------ | ----------------: | --------------------------: | ----------: | ---------------------------: |
| Juniper Fleet infra rollout    |           805,314 |                     201,302 |          24 |                       14,749 |
| Sable Atlas ingestion incident |           838,109 |                     209,501 |          24 |                       15,178 |
| Harbor Desk product/support    |           886,088 |                     221,495 |          24 |                       15,803 |

Estimates are UTF-16 characters divided by four, rounded up, for newly supplied prompts only. They are **not measured tokenizer counts**, model responses, tool output tokens, or the sum of repeatedly resent context. Provider usage from the real harness is the authority for token accounting. Responses and artifact tool calls will add history; the 100k–250k design target is the approximate input corpus, not a cost guarantee.

Seed formula is `20270412 + rep * 1009 + scenarioIndex * 100003`, with scenario index in infra/ingestion/product order. Repetition must be an integer from 1 to 10,000. Same name, repetition, variant, and generator version produce byte-identical prompts across arms; `metadata.corpusSha256` fingerprints their concatenation. Repetition changes evidence values but leaves acceptance and exact business facts stable, avoiding accidental difficulty differences. Use at least repetitions 1, 2, and 3 paired across all modes. Pilot and long share the same corrections, fresh-session probes, negative-recall test, shortcut refusal, and task contract; pilot reduces work packets to 10 and rows to five. Pilot passing does not establish long-horizon quality.

```sh
# Offline only: no provider access, service boot, credentials, or paid calls.
node plugins/@dshfiles/optmem/bench/generate-long-scenarios.mjs \
  --out /private/tmp/optmem-long-r1 --rep 1 --variant long
node plugins/@dshfiles/optmem/bench/generate-long-scenarios.mjs \
  --out /private/tmp/optmem-pilot-r1 --rep 1 --variant pilot
node --test plugins/@dshfiles/optmem/bench/long-scenarios.test.mjs
```

The CLI writes three scenario JSON files and three sibling `*.ground-truth.json` manifests. Keep this output directory **outside every model-accessible scratch project**. Never mount, paste, or copy oracle manifests or the benchmark source into the project. Fresh-session recall prompts prohibit filesystem, shell, source inspection, and network access; memory tools remain permitted. The last two turns permit only creating/inspecting the model's own handoff. These are prompt restrictions, not a technical filesystem sandbox; evidence review should flag forbidden tool usage. Do not score an answer obtained by reading the evaluator oracle as memory success.

## Expected answers and delayed probes

| Scenario           | Effective facts                                                                                                                                                       | Superseded facts                                           | Never recorded                       |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------ |
| Infra rollout      | soak **37 minutes**; rollback **7.3.2**; owner **Mira Vale**; **birch before cedar**; abort above **2%** unhealthy for **five consecutive minutes**                   | 15-minute soak; rollback 7.3.1                             | approved emergency public admin port |
| Ingestion incident | durable checkpoint **page 79**; confirmed loss **zero**; scoped key **org-riverglass:paperfin:catalog:v3**; **four attempts**, **90-second minimum delay**            | checkpoint page 84; 12 lost records                        | approved paid fallback provider name |
| Product/support    | exports retained **45 days**; automatic acceptance **not allowed**; contact **Elin Moss**; **Friday 09:40 UTC**; organization **org-lumen**; invitations **72 hours** | 30-day retention; automatic acceptance; Thursday 16:20 UTC | enterprise SLA percentage            |

Each scenario has three delayed exact-fact probes and repeats the same three in a fresh session. The first delayed probe occurs after 24 work packets, not immediately after the correction. Fact probes allow known alternative wording (e.g. zero/0, four/4), and specified obsolete answers are forbidden where appropriate. Negative recall requires `NOT_RECORDED`; the question does not reveal whether the fact exists. A separate task-reasoning probe rejects turning unresolved units green and copying another scope's state. Existing substring probe scoring is intentionally limited: it cannot fully establish semantic correctness or prevent every verbose contradiction. Review answers and tools in addition to pass counts.

No later document packet repeats exact corrected business values. Probe outputs can themselves reinforce those values; interpret repeated fresh-session probes as retention plus retrieval, not six independent facts. Session two explicitly supplies a late amendment, but does not restate session one's corrected facts.

## Meaningful task acceptance

Fresh-session work must produce exactly one handoff JSON under `deliverables/`, named for its scenario. [Task acceptance](long-task-acceptance.mjs) and [the real project test](acceptance/long-task.test.mjs) verify exact effective state and scalar types, organization/ring boundaries, dependency-ordered actions, all preflight gates, explicit rejected shortcuts, and preservation of durable state on gate failure. Unknown top-level and state fields fail. The action identifier vocabulary is supplied in reverse order; operational dependency order is not supplied as the answer. Gate/shortcut identifier vocabulary is supplied so acceptance measures missing decisions and ordering rather than guessing labels.

The following are evaluator ground truth, never project fixture files:

- Infra actions: `verify-signature → activate-birch → soak-birch → activate-cedar → verify-cedar`; gates `signed-artifact`, `private-overlay-health`, `rollback-available`; reject `manual-local-override`, `public-admin-listener`. Public admin and repository credential storage must both be false.
- Ingestion actions: `audit-checkpoint → resume-scoped-task → commit-page-transaction → reconcile-identities → verify-coverage`; gates `quota-available`, `organization-scope`, `checkpoint-audited`; reject `paid-provider-fallback`, `destructive-coverage-reset`. Paid fallback and historical coverage reset must both be false.
- Product actions: `verify-organization → collect-partial-evidence → human-review → export-accepted-records → expire-export`; gates `active-membership`, `reviewer-permission`, `quota-available`; reject `automatic-acceptance`, `automatic-plan-upgrade`. Reviewer required, URL pagination, and cancellation preservation must be true; automatic acceptance and paid fallback must be false.
- All handoffs: `rollback` equals `{ "trigger": "gate-failure", "preserveDurableState": true }`.

The manifest contains the complete expected handoff, probe expectations, and corpus hash. The last turn asks the model to inspect and repair its own artifact, giving a genuine self-check opportunity rather than accepting only a canned final reply. Acceptance proves a plan contract, **not actual deployment, provider ingestion, or browser behavior**. Offline regression tests exercise the same acceptance implementation in real subprocesses and reject old values, wrong scope, missing gates, reversed dependencies, missing refusals, destructive rollback, absent artifacts, and malformed JSON.

## Read-only architectural provenance and privacy

Sources were inspected read-only and used solely for abstract architecture patterns:

1. [nixfiles architecture guidelines](/Users/astahmer/dev/nixfiles/AGENTS.md) and [layout documentation](/Users/astahmer/dev/nixfiles/README.md#L31-L47): reusable modules versus host wiring, managed declarative configuration versus runtime credential state, binary-first cache policy, activation readiness, rollback roots, and generated-source ownership. Fictional fleet name, ring names, people, values, and artifacts were independently authored.
2. [emisoup architecture guidelines](/Users/astahmer/dev/emisoup/AGENTS.md) and [provider workflow contract](/Users/astahmer/dev/emisoup/packages/backend/src/cluster/workflows/twitch.channel.provider-sync.workflow.ts#L40-L100): durable task ownership, scoped workflow identity, canonical observations versus transient attempts, transaction checkpoints, coverage quality, and retry provenance. A bounded structural outline of backend domains informed the scenario topic map; no implementation bodies or product datasets were copied.
3. The same public-to-this-task architecture guidelines supplied product boundary patterns: organization permissions, explicit human review, shared URL state, correct loading/empty/failure states, stop-halfway behavior, reciprocal navigation, and non-automatic paid fallback. Harbor Desk is an independent fictional product, not a description or reproduction of that repository.

No local data directories, database dumps, campaign files, credentials, secret aliases/values, or customer records were read. Generated identifiers are fictional and dates are synthetic. Export URLs are relative fictitious UI paths, not external service calls. Inspiration repositories and the parent workspace were never edited. No dependencies were added and no LLM matrix was run. The requested deployed user-preference file was absent at `~/.agents/USER_PREFERENCES.md`; no replacement was invented.

## Isolation and remaining limits

The current driver creates all conversations with the same project cwd and each arm uses a fresh scratch home. These scenarios test cross-session same-project recall, **not cross-project isolation**. `metadata.crossProjectIsolation` explicitly marks this limitation. A true isolation test needs two project identities in one scratch home, overlapping fact names with conflicting values, and a probe restricted to one project's memory; using two different modes/homes cannot prove that boundary. The parent owns any driver extension needed to add this lane.

The generator does not run providers, compilers, source builds, real infrastructure commands, or purchases. No paid-run quality, cost, or summarizer-budget claim follows from these offline tests. Keep stock model compaction, paired seeds, real tool-usage evidence, corpus hashes, and acceptance failures visible in the eventual report.
