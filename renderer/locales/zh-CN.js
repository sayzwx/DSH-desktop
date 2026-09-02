/**
 * 简体中文语言包 —— 唯一真值源。
 *
 * 键名用 `域.动作` 或 `域.动作.细节` 分层，与功能轨道对应，便于抽取与查漏。
 * 占位符统一 `{name}` 形式，由 t(key, params) 替换。
 * 存量界面文案的抽取见 Phase 0.2b；本文件当前只含新增功能的键。
 */
window.__dshLocales = window.__dshLocales || {};
window.__dshLocales['zh-CN'] = {
  // ---- 会话行右键菜单 / 行内操作 ----
  'session.action.rename': '重命名',
  'session.action.fork': '从此处分叉',
  'session.action.archive': '归档',
  'session.action.delete': '删除',
  'session.action.showInFolder': '在文件夹中显示',

  // ---- 重命名 ----
  'session.rename.placeholder': '输入新名称，回车保存 / Esc 取消',
  'session.rename.empty': '名称不能为空',
  'session.rename.failed': '重命名失败：{error}',

  // ---- 全文搜索 ----
  'session.search.placeholder': '搜索会话内容…',
  'session.search.empty': '没有匹配的会话',
  'session.search.truncated': '结果已截断（最多 {n} 个会话），请细化关键词',
  'session.search.failed': '搜索失败：{error}',
  'session.search.resultCount': '{n} 个会话命中',

  // ---- 分叉 ----
  'session.fork.done': '已从「{title}」分叉出新会话',
  'session.fork.unavailable': '该会话还没有完成的回合，无法分叉',
  'session.fork.notFound': '会话不存在或已被删除',
  'session.fork.failed': '分叉失败：{error}',

  // ---- 打开路径（host.openPath，受 canOpenPath 门控）----
  'host.openPath.failed': '打开失败：{error}',
  'host.openPath.unavailable': '当前引擎部署不支持从界面打开本地路径',
};
