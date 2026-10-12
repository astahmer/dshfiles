#!/usr/bin/env node
import { execFileSync } from "node:child_process";

const flag = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
};

const asJson = process.argv.includes("--json");
const strict = process.argv.includes("--strict");
const spine = flag("--spine", "integration-spine");

// The board is a read: without --ignore-working-copy every `pnpm run jj:workspaces`
// would snapshot the invoking workspace and, on a chained line, rebase every
// descendant working-copy slot.
const jj = (args) =>
  execFileSync("jj", ["--ignore-working-copy", ...args], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).trimEnd();

const rows = jj([
  "workspace",
  "list",
  "-T",
  String.raw`name ++ "\t" ++ target.commit_id() ++ "\t" ++ target.change_id().short() ++ "\t" ++ target.empty() ++ "\t" ++ target.conflict() ++ "\t" ++ target.committer().timestamp().local().format("%Y-%m-%d %H:%M") ++ "\t" ++ target.description().first_line() ++ "\n"`,
])
  .split("\n")
  .filter(Boolean)
  .map((line) => {
    const [name, commit, change, empty, conflict, updated, ...rest] = line.split("\t");
    return {
      name,
      commit,
      change,
      empty: empty === "true",
      conflict: conflict === "true",
      updated,
      description: rest.join("\t"),
    };
  });

const spineCommits = new Set(
  jj(["log", "-r", `::${spine}`, "--no-graph", "-T", String.raw`commit_id ++ "\n"`])
    .split("\n")
    .filter(Boolean),
);
const aheadCommits = new Set(
  jj(["log", "-r", `${spine}::`, "--no-graph", "-T", String.raw`commit_id ++ "\n"`])
    .split("\n")
    .filter(Boolean),
);

const childCount = new Map();
for (const line of jj([
  "log",
  "-r",
  "all()",
  "--no-graph",
  "-T",
  String.raw`commit_id ++ "\t" ++ parents.map(|p| p.commit_id()).join(" ") ++ "\n"`,
])
  .split("\n")
  .filter(Boolean)) {
  const [commit, parents] = line.split("\t");
  for (const parent of (parents ?? "").split(" ").filter(Boolean)) {
    childCount.set(parent, (childCount.get(parent) ?? 0) + 1);
  }
}

const workspaces = rows
  .map((row) => ({
    ...row,
    relation: spineCommits.has(row.commit) ? "on-spine" : aheadCommits.has(row.commit) ? "ahead" : "off-spine",
    head: (childCount.get(row.commit) ?? 0) === 0,
  }))
  .sort(
    (a, b) =>
      Number(a.relation !== "off-spine") - Number(b.relation !== "off-spine") ||
      Number(b.conflict) - Number(a.conflict) ||
      a.name.localeCompare(b.name),
  );

const offSpine = workspaces.filter((row) => row.relation === "off-spine");
const ahead = workspaces.filter((row) => row.relation === "ahead");
const conflicted = workspaces.filter((row) => row.conflict);
const heads = workspaces.filter((row) => row.head);

if (asJson) {
  console.log(
    JSON.stringify(
      {
        spine,
        spineCommits: spineCommits.size,
        offSpine: offSpine.length,
        ahead: ahead.length,
        conflicted: conflicted.length,
        heads: heads.length,
        workspaces,
      },
      null,
      2,
    ),
  );
} else {
  const width = (key) => Math.max(...workspaces.map((row) => row[key].length));
  const nameWidth = Math.max(width("name"), 9);
  for (const row of workspaces) {
    const flags = [
      row.relation === "off-spine" ? "OFF-SPINE" : "",
      row.relation === "ahead" ? "ahead" : "",
      row.conflict ? "conflict" : "",
      row.head ? "head" : "",
      row.empty ? "empty" : "",
    ]
      .filter(Boolean)
      .join(",");
    console.log(
      `${row.name.padEnd(nameWidth)}  ${row.commit.slice(0, 12)}  ${flags.padEnd(18)}  ${row.updated}  ${row.description}`,
    );
  }
  console.log(
    `\n${workspaces.length} workspaces | on spine ${workspaces.length - offSpine.length - ahead.length} | ahead ${ahead.length} | off spine ${offSpine.length} | conflicted ${conflicted.length} | on head ${heads.length}`,
  );
  if (offSpine.length > 0) {
    console.log("off-spine workspaces will fork the line when committing; rebase them onto the spine first.");
  }
}

if (strict && (offSpine.length > 0 || conflicted.length > 0)) process.exit(1);
