#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const DEFAULT_MAX_COUNT = 60;
const SLOT_POLICY = {
  targetBusyPercent: "70-85",
  minReserveSlots: 2,
  maxReserveSlots: 4
};
const FIX_SUBJECT_RE = /\b(fix|test|typecheck|lint|build|ci|smoke|guard|harden|restore|repair|regression)\b/i;
const FEATURE_SUBJECT_RE = /\b(add|prototype|implement|introduce|create|convert|extend|improve|simplify)\b/i;
const SHARED_FILE_RE = /(^pnpm-lock\.yaml$|^package\.json$|^pnpm-workspace\.yaml$|^vite\.config\.|^tsconfig|^tests\/|\/catalog\.test\.|\/browser-smoke\.mjs$|\/package\.json$)/;

const args = parseArgs(process.argv.slice(2));
const maxCount = integerArg(args["max-count"], DEFAULT_MAX_COUNT);
const since = stringArg(args.since, null);
const format = stringArg(args.format, "markdown");
const outputPath = stringArg(args.out, null);
const ciPath = stringArg(args["ci-json"], null);

if (!["json", "markdown"].includes(format)) {
  fail(`Unsupported --format ${format}. Use "json" or "markdown".`);
}

const commits = readRecentCommits({ maxCount, since });
const ciRows = ciPath ? readCiRows(ciPath) : [];
const report = buildReport({ commits, ciRows, maxCount, since, ciPath });
const rendered = format === "json" ? `${JSON.stringify(report, null, 2)}\n` : renderMarkdown(report);

if (outputPath) {
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, rendered, "utf8");
} else {
  process.stdout.write(rendered);
}

function readRecentCommits({ maxCount, since }) {
  const fields = ["%H", "%h", "%aI", "%s"].join("%x1f");
  const gitArgs = ["log", `--max-count=${maxCount}`, `--pretty=format:%x1e${fields}`, "--name-only"];
  if (since) {
    gitArgs.splice(1, 0, `--since=${since}`);
  }

  const raw = execFileSync("git", gitArgs, { encoding: "utf8" });
  return raw
    .split("\x1e")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map(parseCommitEntry);
}

function parseCommitEntry(entry) {
  const lines = entry.split(/\r?\n/).filter((line) => line.trim() !== "");
  const [header, ...files] = lines;
  const [hash, shortHash, authoredAt, subject] = header.split("\x1f");
  const uniqueFiles = [...new Set(files)];
  return {
    hash,
    shortHash,
    authoredAt,
    subject,
    files: uniqueFiles,
    scopes: [...new Set(uniqueFiles.map(topLevelScope))],
    kind: classifySubject(subject)
  };
}

function buildReport({ commits, ciRows, maxCount, since, ciPath }) {
  const scopeStats = new Map();
  const fileStats = new Map();
  const fixPatterns = [];
  const sharedTouches = [];

  for (const commit of commits) {
    for (const scope of commit.scopes) {
      const row = getOrCreate(scopeStats, scope, () => ({
        scope,
        commits: 0,
        files: new Set(),
        fixLikeCommits: 0,
        featureLikeCommits: 0,
        sharedTouches: 0,
        subjects: []
      }));
      row.commits += 1;
      row.fixLikeCommits += commit.kind === "fix" ? 1 : 0;
      row.featureLikeCommits += commit.kind === "feature" ? 1 : 0;
      row.sharedTouches += commit.files.some(isSharedFile) ? 1 : 0;
      row.subjects.push(commit.subject);
      for (const file of commit.files) {
        if (topLevelScope(file) === scope) {
          row.files.add(file);
        }
      }
    }

    if (commit.kind === "fix") {
      fixPatterns.push({
        commit: commit.shortHash,
        authoredAt: commit.authoredAt,
        subject: commit.subject,
        scopes: commit.scopes,
        files: commit.files
      });
    }

    for (const file of commit.files) {
      const row = getOrCreate(fileStats, file, () => ({
        file,
        scope: topLevelScope(file),
        commits: 0,
        fixLikeCommits: 0,
        subjects: []
      }));
      row.commits += 1;
      row.fixLikeCommits += commit.kind === "fix" ? 1 : 0;
      row.subjects.push(commit.subject);

      if (isSharedFile(file)) {
        sharedTouches.push({
          commit: commit.shortHash,
          subject: commit.subject,
          file
        });
      }
    }
  }

  const scopes = [...scopeStats.values()]
    .map((row) => ({
      ...row,
      files: row.files.size,
      churnScore: churnScore(row)
    }))
    .sort((a, b) => b.commits - a.commits || b.churnScore - a.churnScore || a.scope.localeCompare(b.scope));

  const repeatedFiles = [...fileStats.values()]
    .filter((row) => row.commits > 1 || isSharedFile(row.file))
    .sort((a, b) => b.commits - a.commits || Number(isSharedFile(b.file)) - Number(isSharedFile(a.file)) || a.file.localeCompare(b.file))
    .slice(0, 25);

  const churnyScopes = scopes
    .filter((row) => row.commits > 1 || row.sharedTouches > 0 || row.fixLikeCommits > 0)
    .map((row) => ({
      scope: row.scope,
      commits: row.commits,
      files: row.files,
      fixLikeCommits: row.fixLikeCommits,
      sharedTouches: row.sharedTouches,
      churnScore: row.churnScore
    }));

  const recommendations = recommend(scopes, repeatedFiles);
  const ci = summarizeCi(ciRows, commits, ciPath);

  return {
    report: "royal-agent-throughput",
    generatedAt: new Date().toISOString(),
    git: {
      head: commits[0]?.hash ?? null,
      commitsAnalyzed: commits.length,
      maxCount,
      since
    },
    commitsByTopLevelScope: scopes.map(({ subjects, ...row }) => row),
    likelyConflictingOrChurnyScopes: churnyScopes,
    fixAfterFeaturePatterns: fixPatterns,
    repeatedTouchedFiles: repeatedFiles.map((row) => ({
      file: row.file,
      scope: row.scope,
      commits: row.commits,
      fixLikeCommits: row.fixLikeCommits,
      shared: isSharedFile(row.file),
      recentSubjects: [...new Set(row.subjects)].slice(0, 5)
    })),
    sharedWorktreeDirtyStateSignals: summarizeSharedTouches(sharedTouches),
    ci,
    recommendations
  };
}

function recommend(scopes, repeatedFiles) {
  const serializedScopes = scopes
    .filter((row) => row.churnScore >= 5 || row.sharedTouches > 1)
    .map((row) => row.scope);
  const parallelizableScopes = scopes
    .filter((row) => row.churnScore <= 2 && row.commits <= 2 && row.sharedTouches === 0)
    .map((row) => row.scope);
  const serializedFiles = repeatedFiles
    .filter((row) => row.commits > 1 || isSharedFile(row.file))
    .slice(0, 10)
    .map((row) => row.file);

  return {
    parallelizableScopes,
    serializedScopes,
    serializedFiles,
    slotPolicy: recommendSlotPolicy(scopes, repeatedFiles),
    notes: [
      "Use separate worker worktrees for broad app/package changes so dirty state does not block unrelated workers.",
      "Serialize lockfiles, root configs, package-boundary tests, and example catalogs when multiple workers are active.",
      "Require a focused typecheck/test gate before handoff for any commit touching serialized scopes.",
      "Run a close sweep after wait/status checks and before new spawn batches; count active worker slots separately from open descendants.",
      "Prefer claims for exact shared paths; keep isolated research directories claim-light."
    ]
  };
}

function recommendSlotPolicy(scopes, repeatedFiles) {
  const highChurnScopes = scopes.filter((row) => row.churnScore >= 5 || row.sharedTouches > 1).length;
  const repeatedHotFiles = repeatedFiles.filter((row) => row.commits > 1).length;
  const sharedHotFiles = repeatedFiles.filter((row) => isSharedFile(row.file)).length;
  const pressure = highChurnScopes * 2 + repeatedHotFiles + sharedHotFiles;

  if (pressure >= 8) {
    return {
      targetBusyPercent: SLOT_POLICY.targetBusyPercent,
      recommendedBusyPercent: "70-75",
      reserveSlots: SLOT_POLICY.maxReserveSlots,
      mode: "conservative",
      reason: `${highChurnScopes} high-churn scopes, ${repeatedHotFiles} repeated files, ${sharedHotFiles} shared-risk files`
    };
  }

  if (pressure >= 4) {
    return {
      targetBusyPercent: SLOT_POLICY.targetBusyPercent,
      recommendedBusyPercent: "75-80",
      reserveSlots: 3,
      mode: "balanced",
      reason: `${highChurnScopes} high-churn scopes, ${repeatedHotFiles} repeated files, ${sharedHotFiles} shared-risk files`
    };
  }

  return {
    targetBusyPercent: SLOT_POLICY.targetBusyPercent,
    recommendedBusyPercent: "80-85",
    reserveSlots: SLOT_POLICY.minReserveSlots,
    mode: "open",
    reason: `${highChurnScopes} high-churn scopes, ${repeatedHotFiles} repeated files, ${sharedHotFiles} shared-risk files`
  };
}

function summarizeSharedTouches(sharedTouches) {
  const byFile = new Map();
  for (const touch of sharedTouches) {
    const row = getOrCreate(byFile, touch.file, () => ({
      file: touch.file,
      commits: 0,
      subjects: []
    }));
    row.commits += 1;
    row.subjects.push(touch.subject);
  }

  return [...byFile.values()]
    .sort((a, b) => b.commits - a.commits || a.file.localeCompare(b.file))
    .map((row) => ({
      file: row.file,
      commits: row.commits,
      recentSubjects: [...new Set(row.subjects)].slice(0, 5)
    }));
}

function summarizeCi(ciRows, commits, ciPath) {
  if (!ciPath) {
    return {
      source: "unavailable",
      note: "No --ci-json was provided; paste CI rows manually to estimate commit-to-green time."
    };
  }

  const rowsBySha = new Map(ciRows.map((row) => [String(row.sha ?? "").slice(0, 7), row]));
  const matched = commits
    .map((commit) => {
      const row = rowsBySha.get(commit.shortHash) ?? rowsBySha.get(commit.hash.slice(0, 7));
      if (!row) {
        return null;
      }
      const startedAt = Date.parse(row.startedAt ?? row.createdAt ?? "");
      const completedAt = Date.parse(row.completedAt ?? row.updatedAt ?? "");
      const minutesToGreen = Number.isFinite(startedAt) && Number.isFinite(completedAt) && row.status === "success"
        ? round((completedAt - startedAt) / 60_000, 2)
        : null;
      return {
        commit: commit.shortHash,
        status: row.status ?? "unknown",
        minutesToGreen
      };
    })
    .filter(Boolean);

  const greenRows = matched.filter((row) => row.minutesToGreen !== null);
  const averageMinutesToGreen = greenRows.length
    ? round(greenRows.reduce((sum, row) => sum + row.minutesToGreen, 0) / greenRows.length, 2)
    : null;

  return {
    source: ciPath,
    rowsProvided: ciRows.length,
    matchedCommits: matched.length,
    averageMinutesToGreen,
    rows: matched
  };
}

function renderMarkdown(report) {
  const lines = [];
  lines.push("# Agent Throughput Report");
  lines.push("");
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Head: ${report.git.head?.slice(0, 12) ?? "unknown"}`);
  lines.push(`Commits analyzed: ${report.git.commitsAnalyzed}`);
  lines.push("");

  lines.push("## Commits By Top-Level Scope");
  lines.push("");
  lines.push("| Scope | Commits | Files | Fix-like | Shared touches | Churn score |");
  lines.push("| --- | ---: | ---: | ---: | ---: | ---: |");
  for (const row of report.commitsByTopLevelScope) {
    lines.push(`| ${escapeMarkdown(row.scope)} | ${row.commits} | ${row.files} | ${row.fixLikeCommits} | ${row.sharedTouches} | ${row.churnScore} |`);
  }
  lines.push("");

  lines.push("## Likely Conflicting Or Churny Scopes");
  lines.push("");
  for (const row of report.likelyConflictingOrChurnyScopes.slice(0, 10)) {
    lines.push(`- ${row.scope}: ${row.commits} commits, ${row.fixLikeCommits} fix-like, ${row.sharedTouches} shared touches, score ${row.churnScore}`);
  }
  lines.push("");

  lines.push("## Fix-After-Feature Patterns");
  lines.push("");
  for (const row of report.fixAfterFeaturePatterns.slice(0, 12)) {
    lines.push(`- ${row.commit} ${row.subject} (${row.scopes.join(", ")})`);
  }
  lines.push("");

  lines.push("## Repeated Touched Files");
  lines.push("");
  for (const row of report.repeatedTouchedFiles.slice(0, 12)) {
    lines.push(`- ${row.file}: ${row.commits} commits${row.shared ? ", shared-risk" : ""}`);
  }
  lines.push("");

  lines.push("## CI");
  lines.push("");
  lines.push(report.ci.note ?? `CI rows: ${report.ci.rowsProvided}, matched commits: ${report.ci.matchedCommits}, average minutes to green: ${report.ci.averageMinutesToGreen ?? "n/a"}`);
  lines.push("");

  lines.push("## Recommendations");
  lines.push("");
  lines.push(`Parallelizable scopes: ${report.recommendations.parallelizableScopes.join(", ") || "none detected"}`);
  lines.push(`Serialized scopes: ${report.recommendations.serializedScopes.join(", ") || "none detected"}`);
  lines.push(`Slot policy: keep ${report.recommendations.slotPolicy.targetBusyPercent}% busy; current recommendation ${report.recommendations.slotPolicy.recommendedBusyPercent}% busy, reserve ${report.recommendations.slotPolicy.reserveSlots} slots (${report.recommendations.slotPolicy.mode}: ${report.recommendations.slotPolicy.reason}).`);
  lines.push("");
  for (const note of report.recommendations.notes) {
    lines.push(`- ${note}`);
  }
  lines.push("");

  return `${lines.join("\n")}\n`;
}

function classifySubject(subject) {
  if (FIX_SUBJECT_RE.test(subject)) {
    return "fix";
  }
  if (FEATURE_SUBJECT_RE.test(subject)) {
    return "feature";
  }
  return "other";
}

function topLevelScope(file) {
  const parts = file.split("/");
  if (parts[0] === "apps" || parts[0] === "packages") {
    return parts.slice(0, 2).join("/");
  }
  if (parts[0] === "research") {
    return parts.slice(0, 2).join("/");
  }
  return parts[0] || "(root)";
}

function churnScore(row) {
  return row.commits + row.fixLikeCommits * 2 + row.sharedTouches * 2 + Math.max(0, row.files.size - 3);
}

function isSharedFile(file) {
  return SHARED_FILE_RE.test(file);
}

function readCiRows(ciPath) {
  const parsed = JSON.parse(readFileSync(ciPath, "utf8"));
  if (!Array.isArray(parsed)) {
    fail("--ci-json must contain an array of CI rows.");
  }
  return parsed;
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      fail(`Unexpected positional argument: ${arg}`);
    }
    const [key, inlineValue] = arg.slice(2).split("=", 2);
    if (inlineValue !== undefined) {
      parsed[key] = inlineValue;
      continue;
    }
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = "true";
      continue;
    }
    parsed[key] = next;
    index += 1;
  }
  return parsed;
}

function integerArg(value, fallback) {
  if (value === undefined || value === null) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    fail(`Expected positive integer, got ${value}.`);
  }
  return parsed;
}

function stringArg(value, fallback) {
  if (value === undefined || value === null || value === "true") {
    return fallback;
  }
  return value;
}

function getOrCreate(map, key, createValue) {
  const existing = map.get(key);
  if (existing) {
    return existing;
  }
  const value = createValue();
  map.set(key, value);
  return value;
}

function escapeMarkdown(value) {
  return String(value).replaceAll("|", "\\|");
}

function round(value, decimals) {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
