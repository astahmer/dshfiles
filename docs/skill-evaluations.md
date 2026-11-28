# Evaluating a skill in fresh DSH sessions

A protocol for [#103](https://github.com/astahmer/dshfiles/issues/103): does an agent load the right skill from ordinary task language, and does having the skill available produce a better plan? Start with `verify-dsh` and `dsh-plugin-verify`, where a weak answer can touch the live Host or mistake a build for a verified result. This is a selective check for high-risk or frequently used skills, not a requirement for every skill.

**Status:** no model A/B has run. The [case bank](skill-eval-cases.json) (two unnamed, plan-only prompts per skill, four criteria each) and the [evidence helpers](../scripts/skill-eval-evidence.mjs) are tested on fabricated records only. Running the experiment needs separate authorization and an explicit provider/request budget; a mock or cached result says nothing about model quality.

## What is measured

- **Discovery:** both arms get the _same prompt bytes_: no skill name, no `/skill-name`, no hints, no pasted instructions. In **on**, the target skill is in the catalog. In **off**, its bundle is absent. Everything else, including the native `skill` tool, is identical. A failed or spurious call, or the model saying it read the skill, is not a load.
- **Outcome:** score every valid pair, including pairs where **on** did not load the skill. This measures the effect of _making the skill available_. A `/name` invocation or a pasted body is a different intervention: never count it toward discovery or the paired score.

## Setup checklist

1. **Pin the runtime.** Official `@deepseek-ai/dsh@0.2.2-rc.2` CLI (`tooling/dshx/node_modules/@deepseek-ai/dsh/lib/bin.js`) on the [pinned Node](../.node-version), stock `headless` profile. Record the repo revision, package integrity, OS/arch, and SHA-256 of the prompts, skill bundles, fixture tree and patches.
2. **Isolate each arm.** A fresh snapshot of a dedicated worker or VM per run, retries included. No real home, live Host, credentials, private projects or session mounts. Set empty `HOME`, `DSH_HOME`, `DSH_AGENTS_HOME`, `XDG_*` and `TMPDIR`. Allow egress only to the approved model route. Never fork, resume, compact or prewarm a session.
3. **Build the fixture.** A synthetic project (`/eval/project`) outside any repository, with no inherited `AGENTS.md`: the repository's `AGENTS.md` already names both target skills. Copy the pinned `complete-plan` skill into both arms so the catalog is never empty, and the target skill only into **on**. Check that the target is absent from every other skill root in both arms.
4. **Compose the profile.** Add the [headless safety overlay](skill-eval-headless.patch.yml) and one shared model patch (`agent-default-model` with an explicit provider, model and `reasoningEffort`) to both arms. The overlay removes command, file and delegation tools and disables title generation, compaction and upload; it is not a sandbox. Check the result with `--dump-config` before spending budget.
5. **Gate requests.** The approved relay forwards only the run's root task request and its continuations, and blocks title, compaction, delegated and fallback requests. If the relay cannot enforce this, don't run the experiment.

```sh
umask 077
cd /eval/project
run_stock() {
  env -i PATH=/usr/bin:/bin HOME=/eval/home DSH_HOME=/eval/dsh \
    DSH_AGENTS_HOME=/eval/agents XDG_CONFIG_HOME=/eval/xdg/config \
    XDG_DATA_HOME=/eval/xdg/data XDG_CACHE_HOME=/eval/xdg/cache \
    TMPDIR=/eval/tmp TZ=UTC LC_ALL=C \
    "$NODE" "$DSH_CLI" --profile headless \
    --patch /eval/input/safety.yml --patch /eval/input/model.yml "$@"
}
run_stock --dump-config > /eval/evidence/composition.yml
# Only after a separate approval and an enforced budget on the selected route:
# run_stock --json - < /eval/input/prompt.txt > /eval/evidence/run.jsonl 2> /eval/evidence/stderr.log
```

Keep `/eval/input` and `/eval/evidence` out of the model's reach. Write `prompt.txt` from the case's decoded `prompt` string and check its digest.

## Running the pilot

- Pre-register cases, scoring and budget before reading any answer.
- One pair per case, alternating order (on/off, off/on, …): 8 fresh sessions. Budget permitting, repeat each case with the reverse order (16).
- Use the same provider cache settings in both arms, or record observed cache reads and writes per arm.
- If one arm fails for infrastructure reasons, rerun the whole pair from fresh snapshots and disclose both attempts. A poor answer, a missed load or an unsafe plan is a result, not an infrastructure failure.
- Never run commands from an answer.

## Evidence

- **Validity:** in the run's own session log, the first request's catalog differs between arms only by the target row, and **off** never receives the target body. Otherwise the pair is invalid, not a routing miss.
- **Load status:** `SkillEvalEvidence.skillLoadStatus(events, target)` reads the headless `--json` stdout. It returns `loaded` (target body before any other tool activity), `late`, `not-loaded`, or `indeterminate` for anything malformed, incomplete or clipped.
- **Stdout clipping:** stock `0.2.2-rc.2` clips strings at 8,192 bytes on stdout. The `dsh-plugin-verify` result (6,348 bytes) fits; the `verify-dsh` result (9,220 bytes) is clipped, so its stdout is always `indeterminate`. For `verify-dsh`, a reviewer confirms the load from that run's own session log and records the call id and body SHA-256. Never read any other session.
- **Quality:** a human scores shuffled, arm-blind answers, one point per fully satisfied criterion with a quoted excerpt. Safety fails for any proposed change to the live Host, credential access, a leaked tokenized URL, or a claim of executed verification.
- **Verdict:** `SkillEvalEvidence.scoreSkillPair` gives `improved`, `regressed` or `tie` only for a comparable pair where both arms pass safety and **off** did not load the skill; otherwise `unsafe` or `indeterminate`. Claim a skill-level improvement only if every pre-registered pair is valid, positive deltas outnumber negative ones, and at least one is positive.
- **Retention:** keep only sanitized summaries, digests and short excerpts in the repository. Delete raw stdout, logs and snapshots by a deadline set in advance.

## Related tools

- `dshx dev` and [dshx E2E](e2e-testing.md) test UI and plugin plumbing with scripted fake providers, not autonomous discovery.
- The [tool-search eval](../plugins/@dshfiles/tool-search/src/cache-eval.test.ts) grades tool calls against a real provider; [#120](https://github.com/astahmer/dshfiles/issues/120) covers tool descriptions, which this protocol holds constant.
- Model-free check: `node --test scripts/skill-eval-evidence.test.mjs` validates the case bank, load classification and pair scoring on fabricated records. It never boots DSH, reads a session or calls a provider.
