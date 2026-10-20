# Shared view states — Task P3.6

`LoadingState`, `EmptyState` and `ErrorState` provide the same visual grammar for
paper search, source libraries, overview charts, preliminary analysis, direction
assessments, team selectors and the workspace's lazy-loading boundaries.

All three accept `title`, `description`, `compact` and `className`; empty and
error states also display the supplied `action`. A local error can instead use
`onRetry`, `retryLabel` and `retryDisabled` for the shared retry button. Messages
accept React content so existing numbers, qualifiers and actions stay intact.
Loading states use three decorative skeleton rows and a live busy status. Local
errors use a polite status region beside the retry action; `NoticeStack` owns the
workspace's single global error banner.

Source failures with no existing snapshot stop the loading state and preserve
the complete error and retry action. Existing snapshots remain visible after a
failed refresh. Empty results retain the existing suggestions to broaden filters
or inspect collection state, without claiming that the topic has no research.

The root `AppErrorBoundary` catches render failures, including a lazy module
that cannot load after an old deployment's hashed assets disappear. It uses
`ErrorState` inside the locale provider, so a readable Chinese/English recovery
action remains available instead of a blank page. Recovery requires the user's
explicit “刷新页面 / Reload page” action; it never automatically reloads or loops.
Reloading keeps the current URL hash and previously saved personal data, while
unsaved form input may be lost. The isolated chunk-recovery browser test injects
one missing module and checks that reloading restores the same entry; all other
uncaught errors and external requests still fail the test.

Verification: TypeScript passes. The original translated message expressions
are checked against the previous component source, and the shared components
have server-render checks for busy semantics, local error status, preserved
content and retry controls. Viewport and offline browser verification is tracked with the P3.7 audit.
