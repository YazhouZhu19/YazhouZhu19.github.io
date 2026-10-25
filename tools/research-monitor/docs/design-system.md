# Shared styles and tokens — Task P3.3

`styles/tokens.css` owns the semantic palette, fonts, spacing, type sizes, radii
and elevation shadows. The light palette preserves the original teal primary
`#087d6a`; the competing neutral `:root` palette has been removed. The
`prefers-color-scheme: dark` block changes tokens only, including chart colors,
muted text, status surfaces, borders and shadows.

The spacing scale is 4/8/12/16/24/32 px, the type scale is
12/13/14/16/20/24/30 px, and the main radii are 6/10/14 px. Existing optical
adjustments use named aliases derived from these scales so this consolidation
does not change layout dimensions. Aliases such as the 22 px reading-card radius
remain explicit. There are two elevation levels, plus separate focus rings and
decorative inset effects; focus indication has not been replaced with elevation.

Legacy names such as `--living-ink` now refer to the shared semantic palette.
Translucent surfaces use `color-mix` with those tokens, so they follow dark mode
instead of retaining hardcoded white backgrounds. Reduced-transparency and
backdrop-filter fallbacks remain in place.

## Stylesheet ownership

- `globals.css` contains the application shell, controls and reading surfaces.
  It absorbs the global rules from `living.css` and the non-assessment shell
  rules from `foresight-shell.css`.
- `paper-library.css` owns the shared paper list, filtering and detail styles.
  Those three lazy modules import the same cached stylesheet.
  `monitor-views.css` contains source/team management and the preserved legacy
  layout rules, loaded only with that view.
- `dashboard-common.css` owns the `.dash-*` layout shared by the three source
  dashboards. Each dashboard imports it directly. Source-only summaries and
  identical GitHub/news declarations live with `source-dashboard-charts.css`.
  Unused older matrix/bar layouts remain in the lazy compatibility stylesheet;
  they no longer add to the initial dashboard payload.
- `analysis.css` combines the preliminary-analysis structure with its former
  `living-analysis.css` overrides. `paper-analysis.css` also receives its
  detail-only surface overrides. Each loads with its corresponding view.
  Bubble-chart styling and animation also load with preliminary analysis, the
  only view that renders that chart variant.
- `foresight.css` combines the assessment rules with the history portion of
  `foresight-shell.css`; assessment views import it.
- The AI component imports `ai-research.css`. It is no longer an entry-page
  import, nor an eager import in the public-source library.
- `main.tsx` imports shared globals, typography and accessibility styles.

Tailwind scans `components/` and `main.tsx` explicitly. Paper data, build scripts,
tests and documentation are not UI utility sources; their words should not
generate presentation rules. New rendering directories need an explicit
`@source` entry in `globals.css`.

Explicit cascade layers preserve base → surfaces → typography → view overrides
even when lazy chunks arrive in a different order. Fourteen adjacent identical
rules/selectors were consolidated; nonadjacent rules were not reordered merely
to reduce bytes. A selector/property audit, including each media/supports scope
and normalizing formatting whitespace, preserved all 5,404 preexisting
non-root selector/property pairs.

## Reproducible literal counts

Run `node --import tsx scripts/audit-styles.ts` for the current styles, or pass
another styles directory to compare a saved revision. The pre-change baseline
is revision `2a7ece5`. Counts are occurrences in declarations, excluding
`tokens.css`, custom-property definitions and media-query breakpoints. They
measure centralization, not fewer distinct layout dimensions or browser speed.

| Literal category                             | Before | After |
| -------------------------------------------- | -----: | ----: |
| Hex/RGB/HSL colors                           |    662 |     0 |
| Spacing lengths                              |  1,517 |     0 |
| Font-size lengths, including font shorthands |    556 |     0 |
| Radius lengths                               |    165 |     0 |
| Direct shadow effects                        |      6 |     3 |

Type checking, stylesheet parsing, token-reference inspection and Prettier
checks pass. The three remaining direct shadow effects are decorative/focus
insets rather than additional elevation levels. The light/dark body foreground,
muted text on cards, and primary-button foreground pairs all exceed 4.5:1
contrast (minimum 4.62:1 light and 8.03:1 dark). This is a token-pair check,
not a complete accessibility audit. Integration build sizes and
375/768/1280/1920 px screenshots in both languages are verified separately;
these source counts do not establish the ≤120 KB main-CSS target.
