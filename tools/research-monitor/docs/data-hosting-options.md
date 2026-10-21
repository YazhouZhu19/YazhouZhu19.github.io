# Data hosting options — maintainer decision required

The site currently publishes from `main / (root)` at `/research-monitor/`.
No branch, history, schedule, credentials, Pages configuration or public data URL
is changed by this document. Both choices below need an explicit maintainer
decision and a tested migration plan before implementation.

## Current safeguards

Publication keeps the current and immediately preceding referenced shards for
v1, v2, v3 and the split GitHub/news format. Older orphan shards are removed from
the generated output only; no collected records are deleted. Every retained
reference is verified before cleanup. An 800,000,000-byte publication budget
fails the workflow before an oversized site can be pushed.

Pages serves the entire repository root, including the tracked archives in
`tools/research-monitor/data`. The sync workflow therefore also checks the
**complete staged Git tree** after `git add` and before committing or pushing,
with a separate 950,000,000-byte limit. This leaves 50 MB below a conservative
decimal 1 GB ceiling. The smaller publication-subtree check remains in place.
The index-based check counts a blob at every published path, even when Git
stores identical blobs only once. It does not traverse working-tree files or
include untracked/ignored dependencies, build output or `.git`. Symlinks,
submodules, merge conflicts, missing objects and unknown sizes fail the check.
Tracked source data is always counted; nothing is hidden to reduce the total.

This complete-tree gate runs in the final sync publication step. PR CI checks
the generated `dist` subtree; it does not claim that the old checked-in
publication plus an untracked new build is the final published tree.

Checkout and retry fetches use depth 1. Server-side GitHub compare requests
answer ancestry questions without relying on incomplete shallow history.
Normal publication remains an ordinary non-forced push; concurrent changes
still trigger a fresh collection and build.

## Option A: dedicated orphan data branch

An orphan branch such as `gh-data` could contain only one current data release,
with bounded compatibility generations. Replacing that branch would stop new
data revisions accumulating in `main`, but it would not remove existing blobs
from `main` history. Force-pushing this dedicated branch requires approval.

The existing Pages configuration serves only `main / (root)`. Merely creating
`gh-data` does **not** make it a second Pages data source. Before choosing this
option, decide how the data will actually be served: for example a separate
data repository/site or a controlled distribution origin. Verify public
permissions, CORS, caching, availability and cost, and preserve the existing
`data/papers.json` and `data/public-papers-v2.json` URLs during the agreed
compatibility period. A branch URL is not a substitute for a working public
endpoint. The loader's verified relative-path rules would also need an explicit
migration, rather than silently pointing manifests at arbitrary origins.

Rollback: retain a verified archive of the last working manifests, shards,
source revision and Pages configuration. Restore the previous endpoint mapping
and deploy that archived build. Keep the prior data origin available until the
rollback window and older-client cache window have elapsed.

## Option B: fewer commits on main

Keep the current serving model and batch routine metadata-only updates into a
daily data commit. Hourly collection can continue to check sources; decide
explicitly whether genuinely new records should trigger an additional hourly
commit or wait for the daily batch. That choice sets the site's freshness
guarantee and must appear in the UI's collection timestamps.

This approach changes when evidence is published, and needs a durable place to
retain intermediate successful collection results. Discarding hourly results
inside an ephemeral Actions checkout would violate preservation and could miss
short-lived upstream records. Failed-source metadata, security fixes, manual
refreshes and urgent corrections also need an agreed publication policy.

Rollback: revert the batching workflow to the present hourly publication
schedule and publish the complete retained archive through the ordinary
non-forced workflow. No branch-history rewrite is required.

## Existing history cleanup is a separate decision

`git filter-repo` can remove obsolete generated-data history, but rewrites commit
IDs and usually requires coordinated force-pushes. Existing clones, forks,
open pull requests, commit URLs, tags, release references and branch protection
rules may be affected. Shallow checkout reduces CI transfer; it does not shrink
the server's existing history.

Before any rewrite: pause competing publishers, make and independently verify
a full mirror backup, record all protected refs and Pages settings, dry-run the
rewrite in an isolated clone, and establish a restoration window. After a
rewrite, contributors should re-clone or follow a documented migration instead
of merging the old history back. Rollback means restoring the saved refs from
the verified mirror, restoring protection and workflow settings, and deploying
the last known-good public snapshot. None of those operations is executed here.

## Measurement and limits

Before these governance changes, the checked-out published directory contained
134 files with 517,108,812 logical file bytes; the source data directory contained
79 files with 368,759,490 bytes. These are local measurements of the saved
2026-10-20 snapshot, not a remote storage bill.

On the integrated local build containing v3 papers and split signals, exact
reference cleanup reduced output from 593,700,553 bytes / 474 files to
435,051,781 bytes / 436 files. It removed 38 unreferenced shards containing
158,648,772 bytes and retained 406 referenced shards. Afterwards all 8,326 papers
in v1/v2/v3 and all 50,790 GitHub/news records in the split format still matched
the source archives field for field. This comparison isolates cleanup within
the same build; the earlier published-directory measurement contains a
different set of transport formats.

The final resource measurement before screenshot additions reports a
435,254,911-byte generated monitor. Combining that with 368,759,490 bytes of
tracked source data and 8,022,116 bytes of other tracked files gives an estimated
**812,036,517 bytes for the whole root**. Screenshot files and later committed
changes add to that estimate; the final staged-tree check measures their actual
bytes rather than reserving or excluding them. The 96 review PNGs measured
15,132,523 bytes, bringing that estimate to 827,169,040 bytes before later code
and report changes. This is a projection with the new generated monitor;
the final gate checks the actual index after replacement. For example, a 700 MB monitor
subtree would pass the old 800 MB check while pushing this root above 1 GB.
The new 950 MB check prevents that publication.

The stable-shard simulation with five new current-month papers changed one
archive shard and one public shard, while preserving every older month's
hashes. Real historical re-collection can still change provenance and therefore
more shards. Checkout elapsed time and actual hourly commit deltas must be
compared on completed Actions runs after deployment; local tests cannot
establish those CI measurements, and no before/after timing is claimed here.
