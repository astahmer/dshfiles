# dsh-superagent: a proactive agent for one GitHub repository

[deepseek-ai/dsh-superagent-prototype](https://github.com/deepseek-ai/dsh-superagent-prototype)
is DeepSeek's research prototype of a **super-agent**: a DSH bundle that watches one
GitHub repository (and optionally Feishu chats), turns requests from allowed people
into **Tickets**, works on each Ticket in its own DSH Session and directory, and
answers in the original conversation, for example with a pull request. A
**Superagent** panel in the sidebar shows what needs a person.

Its rule is *take as little human attention as possible, give as much value as
possible*: it acts only when someone on the allow list asks, or when a rule the team
wrote allows it, and speaks only when someone must act or can use the result. Proactive
work starts in `observe` mode, which records what it would do without doing it.

Upstream calls it research code, not an official product. Read its
[philosophy](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/docs/000-philosophy.md)
before giving it a repository.

## Why adopt, not port

It is a complete MIT bundle (about 11k lines, 1,197 tests) with its own Host, panel,
SQLite store, agent presets and service script, built for DSH `^0.2.1-alpha.2`.
Porting it into `plugins/@dshfiles/` would mean rewriting it onto dshx, Effect and our
workspace contract, then carrying that delta forever. It needs nothing from our owned
plugins either. So we **adopt it unchanged**: this repository pins the upstream commit,
builds it with its own lockfile and installs it into a dedicated stock profile.

| What                              | Where                                                                  |
| --------------------------------- | ---------------------------------------------------------------------- |
| Pinned upstream, version, license | [`scripts/superagent.pin.json`](../scripts/superagent.pin.json)        |
| Fetch, build, install, service    | [`scripts/superagent.mjs`](../scripts/superagent.mjs) (+ `.test.mjs`)  |
| Upstream checkout (machine-local) | `$XDG_DATA_HOME/dshfiles/dsh-superagent` (`--source`)                  |
| Profile                           | `$DSH_HOME/profiles/superagent` (`--profile`), from DSH's Web template |
| State: database, shims, worktrees | `$DSH_HOME/state/superagent` (`--state-dir`)                           |

## Why a separate profile

The bundle sets process-wide `PATH` shims and a git configuration for its agent
account, its two agent presets run with `danger-full-access`, and it restarts on its
own schedule. In the profile you work in, that would change your Sessions and restart
under your other agents. So:

- `scripts/superagent.mjs` refuses `web` and any profile seeded from `profiles/`.
- `pnpm profile:sync` refuses a profile that runs `dsh-superagent` (it would otherwise
  link every owned bundle into it); `--bundle @dshfiles/<name>` still adds one on purpose.
- It never starts, stops or restarts the live DSH; the service commands only drive the
  superagent profile's own tmux session through the upstream script, which refuses
  duplicates and never force-kills.

Its worker still runs as your OS user and can read your home directory. For real
isolation, run it under a dedicated OS account that holds only the agent's credentials.

## Install

Prerequisites (upstream): Node 22.19+ or 24+, pnpm, git 2.32+, tmux, Python 3.8+,
GitHub CLI 2.48+, and DSH within `engines.dsh`, with a model provider configured.

```sh
node scripts/superagent.mjs plan     # print every command and file write, change nothing
node scripts/superagent.mjs setup    # fetch the pin, build it, create + link the profile
node scripts/superagent.mjs start    # tmux session dsh-superagent; exit 3 = waiting for setup
```

`setup` is `fetch` + `build` + `install`, each runnable alone and idempotent:

- **fetch** clones the upstream (or fetches into an existing clean checkout whose
  origin is the pinned repository) and checks out the pinned commit detached.
- **build** refuses a checkout off the pin, then runs `pnpm install --frozen-lockfile && pnpm build`.
- **install** creates the profile with `dsh <profile> --from-default-profile web` only
  when it does not exist (that command would otherwise replace it), links the bundle with
  `dsh plugin --profile <profile> add link:<checkout>`, and adds the `webserver` (port 3082)
  and `dsh-superagent` (`stateDir`) rows to its `cordis.patch.yml`. An existing
  `dsh-superagent` row is the operator's configuration and is left alone; an existing
  `webserver` row is kept.

Then configure it. The accounts and allow lists are yours, so they stay out of this
repository. Ask an agent to read `SETUP.md` in the upstream checkout and follow it from step 2
(install is done). It asks one question at a time: which repository, which **dedicated**
agent GitHub account (never your own), who may ask for work, where Ticket checkouts come
from, and whether to auto-merge (recommended: no). Upstream's
[deployment guide](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/docs/006-deployment.md)
covers the `gh-agent` wrapper, the panel settings, the management API and troubleshooting.

Try it: from an allowed account, comment `@<agent login> <request>` on an issue. A Ticket
appears on the overview within about a minute.

## Operate

```sh
node scripts/superagent.mjs status    # 0 running, 1 down, 2 a part errors, 3 waiting for setup
node scripts/superagent.mjs restart   # graceful, waits up to five minutes for Executors
node scripts/superagent.mjs stop      # pauses automatic recovery until start
```

For the hourly self-repair check, ask an agent in **your normal profile** (not
`superagent`) to schedule the prompt in upstream's *Hourly check* section, with the
upstream checkout as `<checkout>`.

## Update policy

The pin moves only on purpose, in its own commit:

1. Read the upstream log since the pinned commit and its `engines.dsh` range against our DSH.
2. Update `commit` (and `version`) in `scripts/superagent.pin.json`.
3. Back up `<stateDir>/orchestrator.sqlite` (a migrated database cannot be opened by an
   older version), then `node scripts/superagent.mjs fetch && node scripts/superagent.mjs build && node scripts/superagent.mjs restart`.

## Verified

On 2026-11-08, on a scratch `HOME`/`DSH_HOME` with DSH 0.2.1-rc.2 installed locally (not globally):
`setup` created the profile, linked the bundle and composed `dsh-superagent`,
`dsh-superagent-github` and both presets; `start` booted it and exited 3 with
`The GitHub Source names no repository.`, the expected state before setup; a second `install` changed
nothing; `stop` stopped it. Upstream at the pin: typecheck and build pass; 1,196 of 1,197
tests pass. The failure is a timing-sensitive assertion in the optional Feishu Source
(`tests/sources.spec.ts:1097`), upstream's own.
