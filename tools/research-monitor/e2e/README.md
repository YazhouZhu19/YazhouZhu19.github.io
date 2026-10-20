# Browser checks

Run `npm ci`, `npx playwright install chromium`, then `npm run e2e`.
Linux CI installs browser system dependencies with `npx playwright install --with-deps chromium`.

The test command builds `.e2e-dist`, writes 12 synthetic papers and 6 synthetic
signals using the production v1/v2/v3 and signals v2 snapshot writers, and serves
that isolated directory through Vite preview on port 4174. It does not overwrite
`dist` or collected data. Every browser request must stay on that local origin;
service workers are blocked and attempted external requests fail the test.
Fixture URLs identify synthetic evidence and are never visited.

Both Chinese and English run the five smoke flows: initial metrics, five main
entries, search/details, chart drill and return, and shareable hash/history
restoration. The drill test also checks its record set after back navigation.
Eight axe scans cover home, library, GitHub and PI pages. Serious/critical findings
fail and full JSON findings are attached to the Playwright report. Mobile tests
exercise the sidebar, advanced filters and details at 375px, including 40px
minimum hit targets for their primary controls.

The small fixture verifies behavior and accessibility; it is not a performance
dataset. For an existing production build, start `npm run preview -- --port 4173`
and run:

```sh
npm run e2e:full-data -- --url http://127.0.0.1:4173/research-monitor/ --min-papers 8000
```

The separate runner rejects a small snapshot, slows Chromium CPU by 4x, and
records Event Timing for dashboard/library direction changes and
library/search/detail/drill interactions in both languages. Each direction
change also reports the worst event duration within that control interaction.
`labInpCandidateMs` is the worst observed interaction in this short
lab session, not field INP. Inspect `under200ms`, long tasks and sample count in
`docs/screenshots/full-data-audit.json`; zero samples is not evidence of passing
performance. This runner reports performance and does not make the small-fixture
CI suite a full-data performance gate.

The runner also saves clean 375/768/1280/1920px screenshots in Chinese/English and
light/dark modes. Default screenshots cover home. Use
`--views home,library,github,news,outlook,teams` for the full page matrix, or
`--output /absolute/directory` to keep local review artifacts outside the repo.
Screenshots require human visual inspection; their existence does not establish
that responsive layout passes.
