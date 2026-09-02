/**
 * English bundle.
 *
 * Keys mirror locales/zh-CN.js exactly; zh-CN is the source of truth. A key
 * missing here falls back to the zh-CN value at runtime, so gaps degrade to
 * readable Chinese rather than to blank UI.
 *
 * Translations are machine-drafted and pending human review — in particular the
 * app's space-themed naming (深空观测台 / 星际会话 / 发射控制), where keeping the
 * imagery in English is a product decision rather than a translation one.
 */
window.__dshLocales = window.__dshLocales || {};
window.__dshLocales['en-US'] = {
  // ---- Session row context menu / inline actions ----
  'session.action.rename': 'Rename',
  'session.action.fork': 'Fork from here',
  'session.action.delete': 'Delete',
  'session.action.showInFolder': 'Show in folder',
  'session.showInFolder.noCwd': 'This session has no recorded working directory',

  // ---- Session row markers ----
  'session.blank.title': 'Blank new session',
  'session.blank.badge': 'new',
  'session.running': 'Running',
  'session.delete.title': 'Delete this session from history',
  'session.list.empty': 'No sessions yet',
  'session.list.emptyHint': 'Click “+ New session” to start',

  // ---- Workspace grouping ----
  'workspace.unnamed': 'Unnamed workspace',
  'workspace.ungrouped': 'Ungrouped',

  // ---- Rename ----
  'session.rename.empty': 'Name cannot be empty',
  'session.rename.failed': 'Rename failed: {error}',

  // ---- Full-text search ----
  'session.search.placeholder': 'Search session content…',
  'session.search.clear': 'Clear search',
  'session.search.empty': 'No matching sessions',
  'session.search.truncated': 'Results truncated (at most {n} sessions) — refine your query',
  'session.search.failed': 'Search failed: {error}',
  'session.search.resultCount': '{n} sessions matched',
  'session.search.disabled.title': 'Full-text search is not enabled',
  'session.search.disabled.body': 'Session full-text search is an opt-in engine capability that ships disabled, and the desktop app cannot turn it on from the UI. Append the snippet below to ~/.dsh/profiles/web/cordis.patch.yml (replacing the empty array [] currently there), save, then restart Harness.',
  'session.search.disabled.copy': 'Copy config snippet',
  'session.search.disabled.copied': 'Copied',
  'session.search.disabled.copyFailed': 'Copy failed — select it manually',

  // ---- Fork ----
  'session.fork.menuTitle': 'Fork a new session from the last completed turn; the original is left untouched',
  'session.fork.done': 'Forked a new session from “{title}”',
  'session.fork.unavailable': 'This session has no completed turn yet, so it cannot be forked',
  'session.fork.notFound': 'Session does not exist or has been removed',
  'session.fork.failed': 'Fork failed: {error}',

  // ---- Markdown code blocks ----
  'md.copy': 'Copy',
  'md.copied': 'Copied',
  'md.copyFailed': 'Copy failed',

  // ---- Open path (host.openPath, gated on canOpenPath) ----
  'host.openPath.failed': 'Open failed: {error}',
  'host.openPath.unavailable': 'This engine deployment cannot open local paths from the UI',

  // ---- Tool cards: status ----
  'tool.card.pending': 'Running…',
  'tool.card.done': '✓ Done',
  'tool.card.error': '⚠ Failed',
  'tool.card.noOutput': '(no output)',
  'tool.card.output': 'View output ({n} chars)',
  'tool.card.outputFull': 'Expand all ({n} chars)',
  'tool.card.outputCollapse': 'Collapse',
  'tool.card.rawInput': 'View arguments',
  'tool.card.openFile': 'Open',

  // ---- Tool cards: terminal ----
  'tool.card.exit': 'exit {code}',
  'tool.card.signal': 'killed by {signal}',

  // ---- Tool cards: diff ----
  'tool.card.newFile': 'New file (no prior content to diff against)',
  'tool.card.diffTooLarge': 'File too large ({old} → {new} lines; line-diff cap is {cap}), showing the new content in full instead',
  'tool.card.diffGap': '⋯ {n} unchanged lines ⋯',

  // ---- Tool cards: search ----
  // The contract forbids presenting a capped result as complete, so a truncated
  // search must show both the total and what is actually displayed.
  'tool.card.searchTotal': '{total} matches',
  'tool.card.searchTruncated': '{total} matches, truncated to {shown} shown',
  'tool.card.searchFileCount': '{n}',
  'tool.card.pathsTotal': '{total} paths',
  'tool.card.pathsTruncated': '{total} paths, truncated to {shown} shown',

  // ---- Tool cards: read ----
  'tool.card.readRange': 'lines {from}–{to} of {total}',

  // ---- Tool cards: web ----
  'tool.card.webSources': '{n} sources',
  'tool.card.webSourcesTruncated': '{n} sources (capped)',
  'tool.card.fetchTruncated': 'content truncated',
};
