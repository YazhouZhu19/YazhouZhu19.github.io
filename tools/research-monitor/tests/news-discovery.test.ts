import { test } from "node:test";
import assert from "node:assert/strict";
import { NEWS_DISCOVERY_GROUPS, NEWS_DISCOVERY_VERSION, NEWS_QUERIES } from "../lib/news-discovery";

test("news routes preserve published source IDs and cover multilingual modalities, tasks and progress", () => {
  assert(NEWS_DISCOVERY_VERSION);
  assert(NEWS_QUERIES.length >= 18 && NEWS_QUERIES.length <= 24);
  assert.equal(new Set(NEWS_QUERIES.map(item => item.id)).size, NEWS_QUERIES.length);
  for (const id of ["google-news-imaging", "google-news-radiology", "google-news-zh"])
    assert(NEWS_QUERIES.some(item => item.id === id));
  assert(NEWS_QUERIES.some(item => item.hl === "zh-CN"));
  assert(NEWS_QUERIES.some(item => item.hl === "en-US"));
  assert.equal(new Set(NEWS_DISCOVERY_GROUPS.map(item => item.id)).size, NEWS_DISCOVERY_GROUPS.length);
  for (const item of NEWS_QUERIES) {
    assert.match(item.id, /^google-news-[a-z-]+$/);
    assert(item.query.length <= 500);
    assert(item.name && item.hl && item.gl && item.ceid);
    assert.equal((item.query.match(/"/g) ?? []).length % 2, 0);
    assert.equal((item.query.match(/\(/g) ?? []).length, (item.query.match(/\)/g) ?? []).length);
    const group = NEWS_DISCOVERY_GROUPS.find(group => group.id === item.groupId);
    assert(group?.labelZh && group?.labelEn);
    assert(group.queries.includes(item.query));
  }
  const allQueries = NEWS_QUERIES.map(item => item.query).join(" ");
  for (const term of ["MRI", "tomography", "SPECT", "ultrasound", "pathology", "retinal", "endoscopy", "dermoscopy", "microscopy", "DICOM", "dataset", "validation"])
    assert(allQueries.toLowerCase().includes(term.toLowerCase()), term);
});
