export const scenarioDefinitions = {
  'infra-rollout': {
    title: 'Juniper Fleet declarative infrastructure rollout',
    project: 'Juniper Fleet',
    initial:
      'Change JF-2048 upgrades fictional Linux collectors and macOS engineering agents using a pinned declarative release. Production ring is cedar, preview ring is birch. Initial proposal: rollout soak 15 minutes, owner Mira Vale, rollback package 7.3.1. Public listener is not allowed; admin traffic stays on the private overlay. The release artifact is signed and checked before activation. These are planning facts, not permission to deploy a real system.',
    correction:
      'Approved correction JF-2048-C: soak is 37 minutes, not 15. Rollback package is 7.3.2, not 7.3.1. Mira Vale remains release owner. The archived proposal is superseded, even if old tool output still mentions it. Abort when unhealthy collectors exceed 2 percent for five consecutive minutes; do not increase that threshold to make the rollout pass.',
    lateCorrection:
      'Final CAB amendment: birch must precede cedar. Never activate cedar if birch has not completed its 37-minute soak. After cedar activation, verify readiness using private-overlay reachability and a completed collector heartbeat. Fleet configuration is repository-owned; local manual overrides are forbidden. Credential contents and provider login state are runtime-owned and must never enter the repository or the support bundle.',
    exact: [
      {
        question: 'What is the effective soak duration and rollback package? Return just the effective values, not the old proposal.',
        expect: ['37', '7.3.2'],
        forbid: ['7.3.1', '15 minutes'],
      },
      { question: 'Which ring goes first and who owns the release?', expect: ['birch', 'Mira Vale'] },
      { question: 'What precise condition aborts rollout?', expect: ['2', 'five'], alternatives: [['five', '5']] },
    ],
    negative: 'What exact emergency public admin port did CAB approve? Return NOT_RECORDED if the requested fact was never established.',
    state: {
      soakMinutes: 37,
      rollbackVersion: '7.3.2',
      releaseOwner: 'Mira Vale',
      ringOrder: ['birch', 'cedar'],
      maxUnhealthyPercent: 2,
      unhealthyWindowMinutes: 5,
      publicAdmin: false,
      credentialsInRepository: false,
    },
    actions: ['verify-signature', 'activate-birch', 'soak-birch', 'activate-cedar', 'verify-cedar'],
    prerequisites: ['signed-artifact', 'private-overlay-health', 'rollback-available'],
    rejected: ['manual-local-override', 'public-admin-listener'],
    topics: [
      [
        'release manifest',
        'Two platform builds share one release identity but separate checksums. Architecture mismatch must fail before activation; a successful download is not evidence of signature validity.',
        'Compare package provenance with host architecture, identify unsupported targets, and propose the smallest blocking gate.',
      ],
      [
        'cache availability audit',
        'A warm operator machine can hide missing binary-cache coverage. Measure cold retrieval for each target; never silently compile a large dependency on production hosts.',
        'Separate cache misses from signature failures and decide which ring can proceed.',
      ],
      [
        'module ownership review',
        'Reusable modules own defaults and activation behavior. Host entries wire modules and machine-specific values. Moving credentials into a common module is not an acceptable simplification.',
        'Find duplicated ownership and give a repository-local correction without copying secrets.',
      ],
      [
        'activation health export',
        'Service readiness, process existence, and successful activation are different facts. Readiness depends on private-overlay reachability and a completed collector heartbeat.',
        'Classify readiness evidence and identify any activation that only looks successful.',
      ],
      [
        'platform compatibility notes',
        'Linux uses a service manager and macOS uses per-user launch agents. Similar configuration names do not imply interchangeable restart commands or ownership.',
        'Write platform-specific verification steps and explain which evidence can be shared.',
      ],
      [
        'rollout risk register',
        'A stalled ring must not cause automatic promotion. One unavailable endpoint may be a local network issue; aggregate unhealthy proportion must be evaluated across the eligible ring.',
        'Rank operational risks using the observation window rather than one alarming sample.',
      ],
      [
        'private overlay routes',
        'Administrative connections terminate on private addresses. An absent route is a deployment blocker, not a reason to publish an unauthenticated listener.',
        'Identify route conflicts and draft an escalation that preserves the network boundary.',
      ],
      [
        'generated profile reconciliation',
        'Managed rows are replaced by reconciliation; user-local rows remain outside that region. A stale generated output must be repaired at its source rather than edited in place.',
        'Explain ownership of each row and propose a drift check with an explicit repair path.',
      ],
      [
        'rollback rehearsal',
        'Rollback availability includes artifact retrieval, state compatibility, and health verification. Previous package presence alone is insufficient proof that downgrade is safe.',
        'Review rehearsal evidence and list missing rollback proof without authorizing production commands.',
      ],
      [
        'maintenance communications',
        'Operators need ring, expected impact, abort criteria, and a contact. Customer-facing language must not imply zero downtime before the soak has produced evidence.',
        'Draft two distinct messages for operators and customers; keep uncertainty explicit.',
      ],
      [
        'disk pressure diagnostics',
        'Store cleanup can remove rollback roots. Retain known-good activation artifacts through the rollout window; separate temporary download cache from deployment history.',
        'Recommend a bounded read-only disk audit and explain what must remain protected.',
      ],
      [
        'host inventory reconciliation',
        'A host that is retired must not count toward active-ring health. An unreachable active host cannot simply be reclassified as retired to improve the reported percentage.',
        'Reconcile inventory status with recent evidence and identify denominator manipulation.',
      ],
      [
        'change approval minutes',
        'Approval applies to a particular revision and ring sequence. A newer artifact with the same display version still needs checksum reconciliation and documented review.',
        'Determine which evidence is stale and draft a precise approval clarification.',
      ],
      [
        'observability field review',
        'Correlation fields identify release, ring, and work unit. Bounded error categories are useful; raw environment dumps and credential values are not acceptable diagnostic fields.',
        'Propose a redacted activation event and distinguish one work-unit event from duplicate adapter logs.',
      ],
      [
        'config precedence audit',
        'Repository defaults, host overrides, and runtime credentials have separate owners. A local override may explain observed behavior without becoming an endorsed persistent configuration.',
        'Describe precedence and the source change needed to restore reproducibility.',
      ],
      [
        'canary anomaly triage',
        'CPU spikes during cold startup may settle. A failed heartbeat remains unhealthy even if CPU is low; trend data must not erase the readiness condition.',
        'Compare time windows and recommend wait, stop, or promote with falsifiable reasons.',
      ],
      [
        'disaster recovery tabletop',
        'Recovery should work without the operator laptop. Artifact identity and documented ownership belong in the recovery packet; reusable authentication material does not.',
        'Design a recovery handoff that retains reproducibility without retaining secrets.',
      ],
      [
        'post-rollout review',
        'A successful rollout can still expose a missing gate. Follow-up changes need an owner and evidence of improvement; avoid rewriting the incident history to make the process look perfect.',
        'Write a concise retrospective with verified outcomes, open risks, and measurable follow-ups.',
      ],
    ],
  },
  'ingestion-incident': {
    title: 'Sable Atlas provider-ingestion incident and recovery',
    project: 'Sable Atlas',
    initial:
      'Incident SA-731 concerns provider catalog ingestion for organization org-riverglass. Provider is fictional Paperfin; the ingestion task is task-6024. Initial hypothesis says newest durable checkpoint is page 84 and 12 records were lost. Task state, provider attempts, canonical records, and coverage evidence have different owners. Never make a transport error into a factual empty catalog.',
    correction:
      'Correction after transactional audit: durable checkpoint is page 79, not page 84. The apparent 12 missing records are duplicates of canonical identities; confirmed lost records is zero. A successful page must commit rows and checkpoint in one transaction. HTTP 429 is retryable acquisition failure, not evidence that the catalog is empty or access-restricted.',
    lateCorrection:
      'Recovery decision SA-731-R: retry ceiling is four attempts with a 90-second minimum delay. Resume from page 79 with organization-scoped idempotency key org-riverglass:paperfin:catalog:v3. No paid provider fallback, no automatic upgrade, and no destructive reset of historical coverage. After provider quota exhaustion, preserve partial results and pause the remaining work.',
    exact: [
      {
        question: 'What is the audited durable checkpoint and confirmed loss count? Do not repeat the discarded hypothesis.',
        expect: ['79', 'zero'],
        alternatives: [['zero', '0']],
        forbid: ['page 84', '12 lost'],
      },
      { question: 'Give the exact organization-scoped recovery idempotency key.', expect: ['org-riverglass:paperfin:catalog:v3'] },
      { question: 'Give the retry ceiling and minimum retry delay.', expect: ['four', '90'], alternatives: [['four', '4']] },
    ],
    negative: 'What approved paid fallback provider should recovery use? Return NOT_RECORDED for an unstated provider name; do not invent a provider.',
    state: {
      checkpointPage: 79,
      confirmedLostRecords: 0,
      organization: 'org-riverglass',
      idempotencyKey: 'org-riverglass:paperfin:catalog:v3',
      retryAttempts: 4,
      retryMinDelaySeconds: 90,
      paidFallback: false,
      resetCoverage: false,
    },
    actions: ['audit-checkpoint', 'resume-scoped-task', 'commit-page-transaction', 'reconcile-identities', 'verify-coverage'],
    prerequisites: ['quota-available', 'organization-scope', 'checkpoint-audited'],
    rejected: ['paid-provider-fallback', 'destructive-coverage-reset'],
    topics: [
      [
        'provider response ledger',
        'Acquisition outcomes distinguish success, throttling, unavailable transport, and explicit access restriction. A status code without resource evidence cannot establish catalog visibility.',
        'Classify outcomes and decide which results are partial rather than empty.',
      ],
      [
        'checkpoint transaction audit',
        'Checkpoint progress must correspond to committed canonical records. Attempt-local positions can advance before commit and must not be used as durable resume coordinates.',
        'Reconstruct the commit boundary and identify any unsafe restart point.',
      ],
      [
        'identity collision review',
        'Provider display names are not stable identities. Match source identifiers within organization scope, retaining alias history separately from canonical identity.',
        'Find false duplicate claims and propose a scoped identity reconciliation query.',
      ],
      [
        'retry attempt timeline',
        'Retries have bounded attempts and an explicit earliest execution time. A task can remain live while waiting for quota; lack of recent rows is not enough to declare it abandoned.',
        'Separate waiting, failed, and abandoned tasks using liveness evidence.',
      ],
      [
        'coverage quality ledger',
        'Sufficient evidence, proven insufficient evidence, and incomplete acquisition are distinct. Successful empty observations cannot be fabricated from a timed-out request.',
        'Identify coverage classifications that overstate certainty and give corrected outcomes.',
      ],
      [
        'index and query-plan audit',
        'Resume selection should use scoped indexed ordering with a stable tie-breaker. Fetching every record and sorting in application memory is not an acceptable repair at scale.',
        'Compare bounded query plans and identify the measured indexing opportunity.',
      ],
      [
        'operator recovery transcript',
        'A repair command needs a dry run, target scope, affected count, and a rollback story. Global checkpoint resets are not justified by a single organization incident.',
        'Review the transcript for blast radius and draft a safe read-only preflight.',
      ],
      [
        'provider quota dashboard',
        'Shared quota must be coordinated across workers. Process-local counters can look correct individually while exceeding the aggregate allowance during concurrent recovery.',
        'Calculate aggregate demand and propose a coordinated pause rather than fallback.',
      ],
      [
        'canonical record retention',
        'Durable observations survive retries. Attempt diagnostics are bounded and retained separately; deleting failed attempts must not delete usable historical records.',
        'Assign retention ownership and identify a cascade that would destroy evidence.',
      ],
      [
        'task reaper observations',
        'Stale-result protection must compare the active execution owner. A late completed attempt cannot overwrite a newer recovery task or reset its progress.',
        'Trace ownership changes and specify the conditional update needed to reject stale completion.',
      ],
      [
        'customer incident correspondence',
        'Customers need confirmed impact, what remains unknown, and recovery status. A data-loss claim from an early hypothesis must be corrected without burying the correction.',
        'Draft a transparent update separating verified facts from working hypotheses.',
      ],
      [
        'schema migration proposal',
        'Migrations derive from the canonical schema. A hand-edited generated SQL file can disagree with the schema and must not be treated as the authoritative repair.',
        'Assess whether a migration is necessary or a bounded data repair suffices.',
      ],
      [
        'partial result export',
        'Exports expose canonical outcomes and provenance, not raw provider payloads or transport credentials. A partial export must show incomplete coverage honestly.',
        'Design a bounded export contract and identify sensitive fields to omit.',
      ],
      [
        'scheduler slot collision',
        'Durable workflow identity includes scope and stable execution slot. A retry must retain intent while avoiding collision with an unrelated scheduled task.',
        'Explain identity collisions and propose deterministic scoped retry keys.',
      ],
      [
        'historical backfill boundaries',
        'New observations should not erase older coverage. Backfill windows and present-time refresh have different intent even when they use the same provider adapter.',
        'Review overlap handling and distinguish stale replacement from new history.',
      ],
      [
        'reconciliation counters',
        'Attempt counts, unique identities, committed records, and coverage windows measure different things. Summing all of them into a success number masks duplicate acquisition.',
        'Reconcile counters and state which denominator supports the customer impact claim.',
      ],
      [
        'redacted incident telemetry',
        'Incident diagnostics need organization, task, attempt, bounded error class, and correlation identifiers. Provider credentials and raw payloads stay outside logs.',
        'Specify one work-unit event and useful aggregate metrics with bounded cardinality.',
      ],
      [
        'recovery acceptance rehearsal',
        'Completion means reconciled canonical records and coverage, not merely an idle worker. Persisted checkpoint correctness must be verified against a repeatable scoped sample.',
        'Write acceptance gates and identify remaining evidence needed before closure.',
      ],
    ],
  },
  'product-support': {
    title: 'Harbor Desk long product and support design',
    project: 'Harbor Desk',
    initial:
      'Harbor Desk is a fictional organization-scoped research-review product. Customer Lumen Orchard has account HD-8806 on Team tier. Initial design proposes 30-day export retention and automatic acceptance of suggested entities. Customer contact is Elin Moss; support appointment is Thursday 16:20 UTC. Product reviews must separate provider acquisition from human acceptance.',
    correction:
      'Decision HD-8806-D supersedes the initial proposal: export retention is 45 days, not 30. Suggestions are never automatically accepted; a named human reviewer must accept them within the active organization. Customer appointment moved to Friday 09:40 UTC. Elin Moss is still the contact. An incomplete acquisition is not a negative qualification result.',
    lateCorrection:
      'Final scope agreement: active organization is org-lumen. Pagination and filters belong in shareable URL state. Stopping an export cancels the run without erasing already accepted records. Trial quota exhaustion preserves partial results; no paid fallback or automatic plan upgrade is allowed. Invitation expiry is 72 hours and expired invitations cannot grant membership.',
    exact: [
      {
        question: 'What is the effective export retention, and is automatic suggestion acceptance permitted?',
        expect: ['45', 'no'],
        forbid: ['30 days', 'yes'],
      },
      {
        question: 'Who is the customer contact, and when is the corrected appointment?',
        expect: ['Elin Moss', 'Friday', '09:40'],
        forbid: ['Thursday', '16:20'],
      },
      { question: 'Which organization owns this design, and how long do invitations remain valid?', expect: ['org-lumen', '72'] },
    ],
    negative:
      'Which exact enterprise SLA percentage was promised to Lumen Orchard? Return NOT_RECORDED if never established, rather than borrowing a percentage from another product.',
    state: {
      exportRetentionDays: 45,
      automaticAcceptance: false,
      reviewerRequired: true,
      organization: 'org-lumen',
      supportDay: 'Friday',
      supportTimeUtc: '09:40',
      invitationExpiryHours: 72,
      paginationInUrl: true,
      paidFallback: false,
      cancelPreservesAccepted: true,
    },
    actions: ['verify-organization', 'collect-partial-evidence', 'human-review', 'export-accepted-records', 'expire-export'],
    prerequisites: ['active-membership', 'reviewer-permission', 'quota-available'],
    rejected: ['automatic-acceptance', 'automatic-plan-upgrade'],
    topics: [
      [
        'customer discovery notes',
        'The customer wants to review evidence before adding records to its shortlist. Faster suggestions do not remove the need for a deliberate named-human acceptance action.',
        'Extract jobs-to-be-done, unresolved questions, and a minimum complete review flow.',
      ],
      [
        'organization permission matrix',
        'Membership, reviewer capability, and administrator rights are separate. Knowing a record identifier cannot grant access to an organization or its exports.',
        'Review the permission matrix and identify the least-privilege boundary for each action.',
      ],
      [
        'provider evidence semantics',
        'Candidate generation indicates possible relevance. Qualification requires bounded evidence; incomplete acquisition and proven insufficiency must look different in the review surface.',
        'Design labels that do not convert missing evidence into a negative factual claim.',
      ],
      [
        'URL-state navigation transcript',
        'Search, filters, sort, and page position must survive a shared link and browser back. A refreshed collection should not unexpectedly clear the active organization.',
        'Trace navigation and specify which state belongs in the URL and which is transient.',
      ],
      [
        'export cancellation journey',
        'Cancellation releases the active run owner and prevents stale result application. Already accepted records remain durable; partial unaccepted suggestions remain reviewable.',
        'Describe what the user sees when stopping halfway and when returning later.',
      ],
      [
        'invitation lifecycle review',
        'An invitation is not membership until accepted while valid. Cancelled or expired invitations must never silently become active on a later page refresh.',
        'Write acceptance and rejection journeys for invitation state transitions.',
      ],
      [
        'support escalation thread',
        'Support needs the customer-visible symptom and bounded evidence, not a raw environment dump. A proposed appointment can be superseded while the customer contact stays unchanged.',
        'Draft a support reply that distinguishes commitments from suggestions.',
      ],
      [
        'empty and loading state audit',
        'Initial unresolved data requires a loading state. A successful empty result, provider failure, and filtered-empty collection need distinct copy and recovery actions.',
        'Propose state-specific copy and identify any misleading no-data flash.',
      ],
      [
        'sortable table specification',
        'Every meaningful data column can be sorted, with a stable tie-breaker. Filters must apply to rows, count, and summary metrics so the collection does not contradict itself.',
        'Specify query behavior and browser checks for sort, filter, and reset-page interactions.',
      ],
      [
        'quota exhaustion experience',
        'Quota exhaustion is an ordinary partial outcome. It must not upgrade a plan, switch to a paid provider, or discard usable evidence to make the interface appear complete.',
        'Design the pause/resume experience and explain the preserved user work.',
      ],
      [
        'entity cross-link review',
        'Detail, collection, task, and export surfaces should link reciprocally while preserving useful safe navigation context. Technical identifiers are secondary to human-readable labels.',
        'Review missing links and specify their destination context without leaking another organization.',
      ],
      [
        'review actor ownership',
        'The active review session owns unsaved selection. A late response from a previously selected organization must not populate the current review, even if identifiers overlap.',
        'Trace stale response risks and define a cancellation and ownership contract.',
      ],
      [
        'privacy and deletion workshop',
        'Canonical accepted records, evidence provenance, and temporary diagnostics have distinct retention owners. An export expiry is not deletion of the customer shortlist.',
        'Separate lifecycle responsibilities and propose a deletion receipt without sensitive payloads.',
      ],
      [
        'billing boundary discussion',
        'A warning about quota is not permission to purchase capacity. Pricing copy must show user intent and an explicit action rather than implying automatic upgrades.',
        'Review upgrade language and write a non-coercive quota warning.',
      ],
      [
        'accessibility review transcript',
        'Keyboard users need meaningful focus after acceptance, cancellation, and page changes. Busy indicators must not hide the available stop action or erase existing content.',
        'Write keyboard journeys and identify acceptance criteria beyond visual screenshots.',
      ],
      [
        'launch scope negotiation',
        'A launch slice must include failure and stop-halfway behavior, not only the happy path. Deferred features need clear boundaries rather than mock controls that look operational.',
        'Define what ships and which visible controls must be removed or clearly deferred.',
      ],
      [
        'support knowledge-base draft',
        'A customer-facing article explains user actions and outcomes. Internal implementation names are not substitutes for explaining what persists after cancellation or quota exhaustion.',
        'Rewrite the article as user-visible behavior with concrete interrupted-flow examples.',
      ],
      [
        'release acceptance workshop',
        'The release requires permission, scope, stale-result, cancellation, and partial-evidence journeys. A typecheck cannot prove these product behaviors.',
        'Produce a small behavior-based acceptance suite with pass/fail evidence.',
      ],
    ],
  },
}
