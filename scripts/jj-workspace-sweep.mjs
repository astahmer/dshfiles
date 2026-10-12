#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { z } from "zod";

const jjwListSchema = z.object({
  workspaces: z.array(
    z.object({
      name: z.string(),
      repository: z.string(),
      path: z.string(),
      commit: z.string(),
      last_change: z.string(),
      created: z.string(),
      age_days: z.number(),
      state: z.string(),
      action: z.string(),
    }),
  ),
});

const flag = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
};

const apply = process.argv.includes("--apply");
const abandonEmpty = process.argv.includes("--abandon-empty");
const proveClean = process.argv.includes("--prove-clean");
const olderThanDays = Number(flag("--older-than-days", "30"));
const spine = flag("--spine", "integration-spine");

if (!Number.isFinite(olderThanDays)) {
  console.error(`jj:sweep: --older-than-days must be a number, got ${flag("--older-than-days", "30")}`);
  process.exit(2);
}

// Every read passes --ignore-working-copy: a sweep that snapshots the workspace
// it inspects is a writer, and a writer racing a live agent is how uncommitted
// files get replaced by a stale checkout.
const jj = (args) =>
  execFileSync("jj", ["--ignore-working-copy", ...args], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).trimEnd();

const repoRoot = jj(["root"]);
const jjwArgs = ["list", "--format", "json", "--with-default", "--root", dirname(repoRoot)];
if (proveClean) jjwArgs.push("--check-state");
const detected = spawnSync("jjw", jjwArgs, { encoding: "utf8", maxBuffer: 128 * 1024 * 1024 });
if (detected.error?.code === "ENOENT") {
  console.error("jj:sweep: jjw is not on PATH (the nix profile provides it)");
  process.exit(2);
}
if (detected.status !== 0) {
  console.error(`jj:sweep: jjw failed: ${detected.stderr.trim()}`);
  process.exit(2);
}
const detectedWorkspaces = jjwListSchema.parse(JSON.parse(detected.stdout)).workspaces;

const workspaceRows = jj([
  "workspace",
  "list",
  "-T",
  String.raw`name ++ "\t" ++ target.commit_id() ++ "\t" ++ target.empty() ++ "\n"`,
])
  .split("\n")
  .filter(Boolean)
  .map((line) => {
    const [name, commit, empty] = line.split("\t");
    return { name, commit, empty: empty === "true" };
  });

const targetsPerCommit = new Map();
for (const row of workspaceRows) {
  targetsPerCommit.set(row.commit, (targetsPerCommit.get(row.commit) ?? 0) + 1);
}
const stateByName = new Map(workspaceRows.map((row) => [row.name, row]));
const spineCommits = new Set(
  jj(["log", "-r", `::${spine}`, "--no-graph", "-T", String.raw`commit_id ++ "\n"`])
    .split("\n")
    .filter(Boolean),
);
const headCommits = new Set(
  jj(["log", "-r", "heads(all())", "--no-graph", "-T", String.raw`commit_id ++ "\n"`])
    .split("\n")
    .filter(Boolean),
);
const bookmarkedCommits = new Set(
  jj(["log", "-r", "bookmarks()", "--no-graph", "-T", String.raw`commit_id ++ "\n"`])
    .split("\n")
    .filter(Boolean),
);

const candidates = detectedWorkspaces
  .filter((entry) => entry.repository === repoRoot && entry.name !== "default")
  .map((entry) => {
    const row = stateByName.get(entry.name);
    const landing = row === undefined ? "unknown" : row.empty ? "empty" : spineCommits.has(row.commit) ? "on-spine" : "unique-work";
    const stale = entry.age_days >= olderThanDays || entry.action === "review";
    // `target.empty()` describes the recorded working-copy commit, never the files
    // on disk, so it is not a safety proof. A workspace is sweepable only once
    // jjw has actually inspected the directory (state "clean").
    const provenClean = entry.state === "clean";
    const decision = !stale
      ? "keep:recent"
      : landing === "unknown"
        ? "keep:unknown"
        : landing === "unique-work"
          ? "keep:unique-work"
          : !provenClean
            ? "keep:unproven"
            : "sweep";
    return { ...entry, row, landing, decision, stale, provenClean };
  })
  .sort((a, b) => a.decision.localeCompare(b.decision) || b.age_days - a.age_days);

for (const entry of candidates) {
  console.log(
    `${entry.name.padEnd(44)}  ${entry.commit.slice(0, 12)}  ${entry.last_change}  ${String(entry.age_days).padStart(4)}d  ${entry.decision.padEnd(16)}  ${entry.state.padEnd(10)}  ${entry.path}`,
  );
}

const sweepable = candidates.filter((entry) => entry.decision === "sweep");
console.log(
  `\n${candidates.length} candidate(s) | ${sweepable.length} sweepable at >=${olderThanDays}d | ` +
    `${candidates.filter((entry) => entry.decision === "keep:unique-work").length} holding unique work | ` +
    `${candidates.filter((entry) => entry.decision === "keep:unproven").length} unproven (directory state not checked)`,
);

if (!apply) {
  console.log("dry run: every read used --ignore-working-copy, so nothing was snapshotted or rewritten");
  console.log("to sweep: re-run with --apply --prove-clean (add --abandon-empty to drop their empty slots)");
  process.exit(0);
}
if (!proveClean) {
  console.error(
    "\njj:sweep: refusing --apply without --prove-clean.\n" +
      "  Without it jjw reports every workspace as state=unchecked, so the directory was never inspected\n" +
      "  and unsaved work is invisible. --prove-clean asks jjw to check each workspace (a preserving\n" +
      "  snapshot) and keeps every dirty or unknown one.",
  );
  process.exit(2);
}
if (sweepable.length === 0) process.exit(0);

const recovery = [];
for (const entry of sweepable) {
  const proof = entry.row?.commit ?? "";
  const { status } = spawnSync("jj", ["workspace", "forget", entry.name], {
    stdio: "inherit",
    env: { ...process.env, JJ_ISOLATION_FORGET_PROOF: proof },
  });
  if (status !== 0) process.exit(status ?? 1);
  recovery.push({ name: entry.name, commit: proof, path: entry.path });
  console.log(`  forgot ${entry.name}; directory kept at ${entry.path}`);
  if (!abandonEmpty || !entry.row?.empty) continue;
  const shared = (targetsPerCommit.get(entry.row.commit) ?? 0) > 1;
  if (shared || bookmarkedCommits.has(entry.row.commit) || !headCommits.has(entry.row.commit)) {
    console.log(`  kept ${entry.row.commit.slice(0, 12)}: shared target, bookmarked, or has descendants`);
    continue;
  }
  const abandoned = spawnSync("jj", ["abandon", entry.row.commit], { stdio: "inherit" });
  if (abandoned.status !== 0) process.exit(abandoned.status ?? 1);
}
console.log("\nrecovery record (keep this; no operation log was rewritten):");
for (const entry of recovery) {
  console.log(`  workspace=${entry.name} commit=${entry.commit} path=${entry.path}`);
}
console.log("  re-attach with: jj workspace add <path> --name <name> -r <commit>");
