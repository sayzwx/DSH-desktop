// dsh-xingkong-theme —— host 半身（极简）
//
// 本主题是纯 token 主题：配色全部走官方 --dsw-* 变量，host 侧无需注册资源路由。
// 保留 host 半身是为了符合 bundle 形态：包 main = host.js，浏览器半身 = ./client 导出。
export default {
  name: 'xingkong-theme',
  apply(ctx) {
    // 只留一行日志，便于在引擎启动日志里确认插件已加载
    try { ctx.logger?.info?.('[xingkong-theme] host half active（纯 token 主题，无资源路由）'); } catch { /* 忽略 */ }
  },
};
