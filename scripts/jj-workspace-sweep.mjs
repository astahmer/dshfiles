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
const olderThanDays = Number(flag("--older-than-days", "30"));
const spine = flag("--spine", "integration-spine");

const jj = (args) =>
  execFileSync("jj", args, { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).trimEnd();

const repoRoot = jj(["root"]);
const detected = spawnSync(
  "jjw",
  ["list", "--format", "json", "--with-default", "--root", dirname(repoRoot)],
  { encoding: "utf8", maxBuffer: 128 * 1024 * 1024 },
);
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
    const state = stateByName.get(entry.name);
    const landing = state === undefined ? "unknown" : state.empty ? "empty" : spineCommits.has(state.commit) ? "on-spine" : "unique-work";
    const stale = entry.age_days >= olderThanDays || entry.action === "review";
    const decision = !stale ? "keep:recent" : landing === "unknown" ? "keep:unknown" : landing === "unique-work" ? "keep:unique-work" : "sweep";
    return { ...entry, landing, decision, stale, state };
  })
  .sort((a, b) => a.decision.localeCompare(b.decision) || b.age_days - a.age_days);

for (const entry of candidates) {
  console.log(
    `${entry.name.padEnd(44)}  ${entry.commit.slice(0, 12)}  ${entry.last_change}  ${String(entry.age_days).padStart(4)}d  ${entry.decision.padEnd(16)}  ${entry.path}`,
  );
}

const sweepable = candidates.filter((entry) => entry.decision === "sweep");
console.log(
  `\n${candidates.length} candidate(s) | ${sweepable.length} sweepable at >=${olderThanDays}d | ${candidates.filter((entry) => entry.decision === "keep:unique-work").length} holding unique work`,
);

if (!apply) {
  console.log("dry run: re-run with --apply to forget the sweepable workspaces (add --abandon-empty to drop their empty slots)");
  process.exit(0);
}
if (sweepable.length === 0) process.exit(0);

console.log(`\nrollback point: jj op restore ${jj(["op", "log", "-n", "1", "-T", "id"])} (discards every agent's ops after it)`);
for (const entry of sweepable) {
  const { status } = spawnSync("jj", ["workspace", "forget", entry.name], { stdio: "inherit" });
  if (status !== 0) process.exit(status ?? 1);
  console.log(`  forgot ${entry.name}; directory kept at ${entry.path}`);
  if (!abandonEmpty || !entry.state?.empty) continue;
  const shared = (targetsPerCommit.get(entry.state.commit) ?? 0) > 1;
  if (shared || bookmarkedCommits.has(entry.state.commit) || !headCommits.has(entry.state.commit)) {
    console.log(`  kept ${entry.state.commit.slice(0, 12)}: shared target, bookmarked, or has descendants`);
    continue;
  }
  const abandoned = spawnSync("jj", ["abandon", entry.state.commit], { stdio: "inherit" });
  if (abandoned.status !== 0) process.exit(abandoned.status ?? 1);
}
