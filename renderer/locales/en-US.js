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

  // ---- Common ----
  'common.save': 'Save',
  'common.cancel': 'Cancel',

  // ---- Context dock: todo ----
  'panel.todo.title': 'Task list',
  'panel.todo.progress': '{done} of {total} done',

  // ---- Context dock: goal ----
  'panel.goal.title': 'Current goal',
  'panel.goal.meta': '{phase} · round {round} of {max}',
  'panel.goal.blocked': 'Blocked: {reason}',
  'panel.goal.edit': 'Edit',
  'panel.goal.pause': 'Pause',
  'panel.goal.resume': 'Resume',
  'panel.goal.complete': 'Mark complete',
  'panel.goal.clear': 'Clear',
  'goal.phase.active': 'active',
  'goal.phase.paused': 'paused',
  'goal.phase.blocked': 'blocked',
  'goal.phase.complete': 'complete',
  'goal.actionFailed': 'Failed to {op} the goal: {error}',
  'goal.edit.title': 'Edit goal',
  'goal.edit.label': 'Objective (Ctrl+Enter to save, Esc to cancel)',
  'goal.edit.empty': 'Objective cannot be empty',

  // ---- Context dock: queue ----
  'panel.queue.title': 'Pending messages ({n})',
  'queue.placement.queued': 'queued',
  'queue.placement.steering': 'steering',
  'queue.action.steer': 'Steer',
  'queue.action.steerHint': 'Turn this queued message into a steering one, redirecting the current turn',
  'queue.action.remove': 'Remove',
  'queue.actionFailed': 'Queue action failed: {error}',
  'queue.item.nonText': '({n} non-text content blocks)',

  // ---- Context dock: background jobs ----
  'panel.jobs.title': 'Background jobs',
  'panel.jobs.titleActive': 'Background jobs ({n} running)',
  'job.status.running': 'running',
  'job.status.stopping': 'stopping',
  'job.status.completed': 'completed',
  'job.status.killed': 'killed',
  'job.status.failed': 'failed',

  // ---- Context dock: produced files ----
  'panel.files.title': 'Files produced this turn ({n})',
  'panel.files.more': '+{n} files',
  'panel.files.showInFolder': 'Show in folder',

  // ---- Plan mode ----
  'plan.chip': 'Plan ✕',
  'plan.chipHint': 'Plan mode is on — click to turn it off',
  'plan.placeholder': 'Describe your task to generate a plan…',
  'plan.exitFailed': 'Failed to exit plan mode: {error}',

  // ---- Status event visibility ----
  // The retry notice has to make clear the UI is not stuck, it is waiting on the provider;
  // before this the interface just went silent.
  'event.retry': '{provider} request failed, {attempt}, retrying in {seconds}s…',
  'event.retry.attempt': 'retry {n} of {max}',
  'event.retry.attemptNoMax': 'retry {n}',
  'event.compaction.start': 'Context compaction started…',
  'event.compaction.summary': 'Context compaction summary generated',
  'event.compaction.end': 'Context compaction finished',
  'event.compaction.prune': 'Pruned older tool results to free up context',
  'event.hook.invoked': 'Hook invoked: {name}',
  'event.hook.result': 'Hook returned: {name}',
  // Permission / sandbox / approval changes must be echoed: silently changing permissions is a safety issue
  'event.permission.changed': 'Permission preset changed to “{value}”',
  'event.sandbox.changed': 'Sandbox mode changed to “{value}”',
  'event.approval.changed': 'Approval policy changed to “{value}”',
  'event.agentPreset.changed': 'Agent preset switched to “{value}”',
  'event.subagent.descriptor': 'Subagent: {name}',
  'event.workflow.runStart': 'Workflow started: {name}',
  'event.workflow.runEnd': 'Workflow finished: {name}',
  'event.workflow.agent': 'Workflow member {phase} {name}',
  'event.codeDispatch': 'Code Mode dispatch',
  'event.streamError': 'Event stream error: {error}',

  // ---- Raw event debug drawer ----
  'raw.toggle': 'Raw events',
  'raw.drawerTitle': 'Raw events (event types without dedicated rendering, for debugging)',
  'raw.empty': 'No unclassified events in this session yet',
};
