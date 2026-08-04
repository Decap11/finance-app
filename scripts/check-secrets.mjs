// Blocks credentials from entering the repository.
//
// A hardcoded developer password reached a public GitHub repo through scratch/ and sat in
// the history for 33 commits. Rotating the password fixes that one incident; this script is
// what stops the next one. It runs in two places:
//
//   npm run check:secrets            -- scans staged content, wired to .githooks/pre-commit
//   npm run check:secrets -- --all   -- scans every tracked file, wired to CI
//
// Deliberately dependency-free and pure Node, matching the test runner: a guard that needs
// an install step is a guard that gets skipped.
import { execFileSync } from 'node:child_process';

// Ordered most to least specific. Each pattern targets a shape that has no legitimate reason
// to appear in a tracked file -- broad entropy heuristics were left out on purpose, because a
// guard that cries wolf gets bypassed with --no-verify and then protects nothing.
const RULES = [
  {
    name: 'Supabase service-role / secret key',
    // Bypasses Row Level Security completely. Never belongs anywhere but an env var.
    pattern: /sb_secret_[A-Za-z0-9_-]{16,}/g
  },
  {
    name: 'JWT (Supabase legacy service_role or anon key)',
    pattern: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g
  },
  {
    name: 'Hardcoded password assignment',
    // Catches `password: 'literal'` and `const devPassword = "literal"`. The value must be a
    // literal: process.env reads and template holes are the correct pattern and stay allowed.
    pattern: /\b(?:password|passwd|pwd)\w*\s*[:=]\s*(['"])(?!\s*$)(?!<)[^'"\n]{6,}\1/gi
  },
  {
    name: 'Private key block',
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/g
  },
  {
    name: 'GitHub token',
    pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}/g
  },
  {
    name: 'AWS access key id',
    pattern: /\bAKIA[0-9A-Z]{16}\b/g
  }
];

// This file necessarily contains every pattern it searches for, and .env.example plus the docs
// carry deliberate placeholders.
const SKIP_FILES = new Set([
  'scripts/check-secrets.mjs',
  '.env.example',
  '.gitleaks.toml',
  'package-lock.json'
]);

// A match whose value is obviously a placeholder is not a finding.
const PLACEHOLDER = /^(?:<.*>|\{\{.*\}\}|\$\{.*\}|x{3,}|\*{3,}|placeholder|changeme|example|your[-_ ]?\w*|redacted|todo|null|undefined|true|false)$/i;

const scanAll = process.argv.includes('--all');

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function listFiles() {
  const out = scanAll
    ? git(['ls-files', '-z'])
    : git(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z']);
  return out.split('\0').filter(Boolean);
}

function readFile(path) {
  // Staged content, not the working tree: those differ during a partial `git add -p`, and the
  // staged bytes are what the commit will actually carry.
  try {
    return scanAll ? git(['show', `HEAD:${path}`]) : git(['show', `:${path}`]);
  } catch {
    return null; // binary, deleted, or unreadable -- nothing to scan
  }
}

const findings = [];

for (const file of listFiles()) {
  if (SKIP_FILES.has(file)) continue;

  const content = readFile(file);
  if (content === null) continue;
  if (content.includes('\0')) continue; // binary

  const lines = content.split('\n');

  for (const rule of RULES) {
    for (const [index, line] of lines.entries()) {
      rule.pattern.lastIndex = 0;
      for (const match of line.matchAll(rule.pattern)) {
        // For quoted assignments the captured value is group-less, so pull the literal out.
        const value = match[0].replace(/^.*?[:=]\s*['"]?/s, '').replace(/['"]$/, '');
        if (PLACEHOLDER.test(value.trim())) continue;

        // Never echo the secret -- CI logs are as readable as the repo was, and a scanner
        // that reprints the credential into a public build log has moved it, not caught it.
        const redacted = line.trim().replaceAll(value, '*'.repeat(8));

        findings.push({
          file,
          line: index + 1,
          rule: rule.name,
          preview: redacted.length > 60 ? `${redacted.slice(0, 60)}...` : redacted
        });
      }
    }
  }
}

if (findings.length === 0) {
  console.log(`No credentials found in ${scanAll ? 'tracked files' : 'staged changes'}.`);
  process.exit(0);
}

console.error(`\nBlocked: ${findings.length} possible credential(s).\n`);
for (const f of findings) {
  console.error(`  ${f.file}:${f.line}`);
  console.error(`    ${f.rule}`);
  console.error(`    ${f.preview}\n`);
}
console.error('Move the value into .env (gitignored) and read it via process.env.');
console.error('If this is a false positive, add the file to SKIP_FILES in scripts/check-secrets.mjs.\n');
process.exit(1);
