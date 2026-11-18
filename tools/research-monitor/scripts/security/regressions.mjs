import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { projectRoot, verifyPatch } from "./picomatch-patch.mjs";

// Each batch has an external deadline, so a regex regression cannot hang CI.
export const hostileCases = [
  ["+(*a)", "a"],
  ["+(*)", "a"],
  ["+([a]*)b", "a"],
  ["+(@(*a))", "a"],
  ["+(!(a))", "b"],
  ["+([ab]+)", "a"],
  ["+((a)+)", "a"],
  ["+(a.*)", "a"],
  ["+({a,aa})b", "a"],
  ["+(ab|abab)", "ab"],
  ["+(@(ab|abab))", "ab"],
  ["*(+([a]*))b", "a"],
];

export function checkRegressions(root = projectRoot, nodes = verifyPatch(root)) {
  const script = `
    const assert = require('node:assert/strict');
    const picomatch = require(process.argv[1]);
    const cases = JSON.parse(process.argv[2]);
    const options = [{}, {capture:true}, {windows:true}, {bash:true}, {fastpaths:false}];
    for (const [pattern, unit] of cases) {
      for (const opts of options) {
        const match = picomatch(pattern, opts);
        assert.equal(match(unit.repeat(4096) + 'c'), false, pattern);
      }
    }
    for (const [pattern, input, expected] of [
      ['**/*.{ts,tsx}', 'src/view.tsx', true],
      ['**/*.{ts,tsx}', 'src/view.css', false],
      ['**/node_modules/**', 'a/node_modules/vite/index.js', true],
      ['+(foo)', 'foofoo', true],
      ['+([0-9])', '12345', true],
      ['+(a|b)', 'abba', true],
      ['+(ab|cd)', 'abcdab', true],
      ['src/**/!(*.test).ts', 'src/nested/view.ts', true],
      ['src/**/!(*.test).ts', 'src/nested/view.test.ts', false]
    ]) assert.equal(picomatch(pattern)(input), expected, pattern);
  `;
  for (const node of nodes) {
    const result = spawnSync(
      process.execPath,
      ["-e", script, path.join(root, node), JSON.stringify(hostileCases)],
      {
        encoding: "utf8",
        timeout: 5000,
        maxBuffer: 1024 * 1024,
      },
    );
    assert.equal(result.error, undefined, `Security regression exceeded deadline: ${node}`);
    assert.equal(result.status, 0, `Security regression failed: ${node}\n${result.stderr}`);
  }
  return nodes.size * (hostileCases.length * 5 + 9);
}
