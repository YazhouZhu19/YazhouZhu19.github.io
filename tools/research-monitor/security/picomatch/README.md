# Temporary picomatch mitigation

This repository still installs **official picomatch 4.0.7** from the registry,
using the unchanged lockfile integrity. As of 2026-11-18, the registry has no
patched release for [GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf).
The package is a development dependency of Vite/tinyglobby/fdir, and is absent
from the browser bundle.

`npm ci` applies a local parser mitigation during `postinstall`. Its starting
point is the emitted-repetition guard in [upstream PR #274](https://github.com/micromatch/picomatch/pull/274),
pinned to commit `3975e4a0e6b4c4fb2c0119863b243ce04612c5e3` (not an official
release or merged fix). Local verification found remaining ambiguous branches,
including `+({a,aa})b` and `+(ab|abab)`, so the local patch also restricts repeated
extglobs to provably simple branches. The upstream MIT license is included.

## Behavior and scope

- Repeated wildcard, negated, regex-quantified, ambiguous, and complex nested
  extglobs use picomatch's existing **literal fallback**. Such patterns may match
  differently from unpatched picomatch. This is a deliberate conservative boundary.
- Ordinary build globs, fixed literal repetitions, simple positive character
  classes, and prefix-free literal alternatives remain supported. Existing safe
  character-class rewrites remain available.
- The upstream explicit `maxExtglobRecursion: false` escape hatch remains for
  trusted patterns. The application never enables it. This patch does not claim
  to make arbitrary user-supplied regular-expression syntax safe.
- No application UI, analysis algorithm, source data, Vite version, or runtime
  dependency is changed by this mitigation.

## Enforcement and audit transparency

`manifest.json` pins the official package integrity and original executable file
hashes, the local replacement text, and the resulting parser hash. Installation
checks all locked and installed picomatch copies before writing. Unknown versions,
modified files, missing or extra instances, and dependency symlinks fail closed.
Reapplying the exact patch is safe. Build, development, tests, and browser-test
preparation verify it again; `npm ci --ignore-scripts` alone is insufficient.

`npm run audit:security` first verifies those hashes and runs externally bounded
regressions, then runs the real `npm audit --json --audit-level=high` command.
**Raw npm audit still reports this advisory** because the official version is
retained. The wrapper reports it as locally mitigated only for verified nodes;
transitive findings must resolve exclusively to that exact advisory. Unknown
advisories, unrelated high/critical findings, malformed responses, broken chains,
and audit/network failures still block CI. It does not use `npm audit --omit=dev`,
an npm ignore list, a version disguise, or a forced Vite downgrade.

Regression tests include a timeout-bounded positive control against the original
parser, adversarial wildcard/brace/alternation variants, safe build-glob behavior,
installation without the patch, tampering, nested copies, symlinks, upgrades, and
negative audit-policy cases. A timing ceiling prevents a regression from hanging
the test job; it is not a claim of universal complexity bounds.

## Retirement

When an official fix is released, review its source and rerun the hostile and
compatibility cases before upgrading the lockfile. The version/hash gate
intentionally fails on any different version. Once verified, remove the local
replacement, installer hooks, and advisory-specific classification, restore the
plain npm audit CI step, and keep appropriate regression coverage. Do not change
the manifest merely to admit an unreviewed version or a second advisory.
