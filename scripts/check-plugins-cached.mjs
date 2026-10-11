#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const gates = ["contract", "build", "typecheck", "test"];
const cacheDir = ".jj-gates";

const flag = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
};

const jj = (args) =>
  execFileSync("jj", args, { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).trimEnd();

const base = flag("--base", "main");
const rev = flag("--rev", "@");
const force = process.argv.includes("--force");

const content = jj(["diff", "--from", base, "--to", rev, "--git"]);
const fingerprint = createHash("sha256")
  .update(base)
  .update("\0")
  .update(content)
  .digest("hex")
  .slice(0, 16);
const cacheFile = `${cacheDir}/${fingerprint}.json`;

const printGates = (record, verb) => {
  for (const gate of gates) {
    const entry = record.gates[gate];
    const timing = entry.seconds === undefined ? "" : ` (${entry.seconds}s)`;
    console.log(`  ${entry.ok ? "PASS" : "FAIL"}  ${gate}${timing}`);
  }
  console.log(`check:plugins:cached: ${verb} ${fingerprint} on ${record.tree.slice(0, 12)}`);
};

const cached = existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, "utf8")) : undefined;
if (cached && !force) {
  printGates(cached, "carried over");
  console.log("  (tree content unchanged since that run; --force re-runs)");
  process.exit(gates.every((gate) => cached.gates[gate]?.ok) ? 0 : 1);
}

const results = {};
let failed = false;
for (const gate of gates) {
  if (failed) {
    results[gate] = { ok: false, skipped: true };
    continue;
  }
  const started = Date.now();
  const { status } = spawnSync("pnpm", ["--dir", "plugins", "run", gate], { stdio: "inherit" });
  const ok = status === 0;
  results[gate] = { ok, seconds: Number(((Date.now() - started) / 1000).toFixed(1)) };
  failed = !ok;
}

mkdirSync(cacheDir, { recursive: true });
const record = {
  fingerprint,
  base,
  rev,
  tree: jj(["log", "-r", rev, "--no-graph", "-T", "commit_id"]),
  recordedAt: new Date().toISOString(),
  gates: results,
};
writeFileSync(cacheFile, `${JSON.stringify(record, null, 2)}\n`);
printGates(record, failed ? "recorded (failed)" : "recorded");
process.exit(failed ? 1 : 0);
