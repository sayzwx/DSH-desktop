# 这个目录的角色

**插件的 source of truth 是独立仓库**：<https://github.com/sayzwx/dsh-xingkong-theme>

本目录（`DS_harness/themes/dsh-xingkong-theme/`）是**部署与测试工作区**，不是发布源。
它存在的理由有两个，都只在这个仓库里成立：

- `deploy.sh` / `verify.sh` 依赖 `<repo>/themes/<name>/` 这一层相对路径，
  且需要本机的三个 profile（web / desktop / base）才能跑端到端校验；
- 渲染层冒烟断言（183 项 CSS 守卫、注册一致性、HTTP 链路）在 `DS_harness/.workbuddy/`，
  按设计不入库。

## 因此的纪律

**改动流程：先改独立仓库 → 同步回这里 → `deploy.sh` → `verify.sh`。**

直接在这里改会让「本地跑的和发布的不是同一份」，而这类不一致不会报错、
只会在用户装到市场版之后才显现。同步时至少要一起带：
`bundle/`、`package.json`、`cordis.patch.yml`、`screenshots.json`、`docs/screenshots/`。

发布相关的两件事在这里做不了，也不需要做：
- 打 tgz：在独立仓库根目录 `npm pack`（那里有 `.npmignore` 与逐文件白名单）
- 建 Release / 提市场收录 PR：都在独立仓库

独立仓库的 PR #（收录）已提交；桌面端仓库里那个含主题的 PR 已关闭、不合并，
所以主题代码不会进入桌面端 main，两边不会各自演化。
