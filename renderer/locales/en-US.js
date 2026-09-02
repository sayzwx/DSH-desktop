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
  'session.action.archive': 'Archive',
  'session.action.delete': 'Delete',
  'session.action.showInFolder': 'Show in folder',

  // ---- Rename ----
  'session.rename.placeholder': 'New name — Enter to save, Esc to cancel',
  'session.rename.empty': 'Name cannot be empty',
  'session.rename.failed': 'Rename failed: {error}',

  // ---- Full-text search ----
  'session.search.placeholder': 'Search session content…',
  'session.search.empty': 'No matching sessions',
  'session.search.truncated': 'Results truncated (at most {n} sessions) — refine your query',
  'session.search.failed': 'Search failed: {error}',
  'session.search.resultCount': '{n} sessions matched',

  // ---- Fork ----
  'session.fork.done': 'Forked a new session from “{title}”',
  'session.fork.unavailable': 'This session has no completed turn yet, so it cannot be forked',
  'session.fork.notFound': 'Session does not exist or has been removed',
  'session.fork.failed': 'Fork failed: {error}',

  // ---- Open path (host.openPath, gated on canOpenPath) ----
  'host.openPath.failed': 'Open failed: {error}',
  'host.openPath.unavailable': 'This engine deployment cannot open local paths from the UI',
};
