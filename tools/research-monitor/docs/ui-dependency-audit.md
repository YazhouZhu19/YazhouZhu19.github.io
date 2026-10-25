# UI dependency audit — Task P2.1

Audited on 2026-10-21 before cleanup, and checked again after the formatting-only
commit `7461f2b`. The audit traversed TypeScript import/export declarations,
literal `import()` and `require()` calls, and local `new URL()` references from
`main.tsx`, every script/test entry, and build configuration. It resolved relative
paths and the `@/` alias, including indirect component imports. Repository text
searches then checked the removal candidates for additional references.

Of 61 files in `components/ui`, 13 remain reachable:

| Component   | Why it remains                                |
| ----------- | --------------------------------------------- |
| `badge`     | Paper library and workspace labels            |
| `button`    | Workspace, dashboards, dialogs and sidebar    |
| `dialog`    | Local data controls, team and library actions |
| `input`     | Workspace, library, team and sidebar controls |
| `label`     | Team and library forms                        |
| `select`    | Workspace, dashboard and analysis selectors   |
| `separator` | Indirect dependency of `sidebar`              |
| `sheet`     | Paper details and the mobile sidebar          |
| `sidebar`   | Main navigation                               |
| `skeleton`  | Workspace and sidebar loading states          |
| `table`     | Paper library and dashboard tables            |
| `textarea`  | Workspace, library and team forms             |
| `tooltip`   | Indirect dependency of `sidebar`              |

The following 48 files were unreachable and removed:

```text
accordion       alert-dialog    alert           aspect-ratio
attachment      avatar          breadcrumb      bubble
button-group    calendar        card            carousel
chart           checkbox        collapsible     combobox
command         context-menu    direction       drawer
dropdown-menu   empty           field           form
hover-card      input-group     input-otp       item
kbd             marker          menubar         message-scroller
message         native-select   navigation-menu pagination
popover         progress        radio-group     resizable
scroll-area     slider          sonner          spinner
switch          tabs            toggle-group    toggle
```

`components/trends-view.tsx` was also unreachable from all application,
script and test entries. It was the only remaining non-UI consumer of
`components/ui/chart.tsx` and Recharts, and was removed with that unused view.
Current source dashboards use the existing lightweight chart components.

## Dependencies

The regular npm uninstall command updated both package files with
`--ignore-scripts --offline --no-audit --no-fund`. No versions were upgraded and
no install scripts or network requests were needed. Direct runtime dependencies
decreased from 24 to 11; lockfile package entries decreased from 292 to 234
(including the root entry and platform-specific packages).

| Removed dependency       | Only former consumer, or no import        |
| ------------------------ | ----------------------------------------- |
| `@base-ui/react`         | `combobox`                                |
| `@hookform/resolvers`    | No imports                                |
| `@shadcn/react`          | `message-scroller`                        |
| `cmdk`                   | `command`                                 |
| `date-fns`               | No direct imports                         |
| `embla-carousel-react`   | `carousel`                                |
| `input-otp`              | `input-otp`                               |
| `next-themes`            | Unused UI `sonner` wrapper                |
| `react-day-picker`       | `calendar`                                |
| `react-hook-form`        | `form`                                    |
| `react-resizable-panels` | `resizable`                               |
| `recharts`               | `chart` and the unreachable `trends-view` |
| `vaul`                   | `drawer`                                  |

The `sonner` package remains: the workspace, library, team and local data controls
import it directly. Removing the unused UI wrapper does not remove notifications.
`radix-ui`, `class-variance-authority`, `clsx` and `tailwind-merge` remain necessary
for the reachable components.

## Styles and measurement

`tw-animate-css` remains imported. Dialog, select, sheet and tooltip use its
`animate-in/out`, fade, zoom and slide utilities. Tailwind's built-in pulse/spin
utilities are a separate concern.

The import of `vendor/shadcn-tailwind-4.13.0.css` was removed after checking all
reachable sources and application styles. Its custom `data-open`, `data-closed`,
`data-checked`, `data-unchecked`, `data-selected`, `data-disabled`, `data-active`,
`data-horizontal` and `data-vertical` variants, `scroll-fade`, `shimmer`,
`no-scrollbar` utilities and accordion animations have no remaining consumers.
Reachable components use Tailwind's explicit `data-[state=...]` variants instead.
The vendor source and license remain in the repository.

Unused UI files were already excluded from the JavaScript bundle by tree
shaking. This cleanup reduces installed dependencies and Tailwind's scanned
utility candidates; a JavaScript transfer-size reduction is not assumed.
The integration build measures final assets and reviews `budget.json`
separately. No snapshot records or personal-data fields are affected.
