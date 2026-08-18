# 贡献指南（Contributing）

> 读者可从中获得什么：掌握提 Issue 与提交 PR 的完整规则（新功能先 Issue、bug 附复现、dev 分支开发、PR 目标 dev）；了解 master / dev / beta 三分支与自动发布节奏；明确 PR 合并前的评审要点（lint、类型、事件总线、i18n、横竖屏布局、文档同步）以及 CI 会替你检查什么。
>
> 前置阅读：[docs/getting-started.md](./getting-started.md)、[docs/code-style.md](./code-style.md)、[docs/design-doc.md](./design-doc.md)。

---

## 1. 前置知识

在提交任何内容前，建议先通读：

- `docs/design-doc.md` —— 顶层设计依据，所有改动不得与其中的 ADR / 约束冲突（如状态管理自研 store + 事件总线模式，**项目早已不是 Redux**，README 中「Redux」字样属于过时描述，以代码为准）。
- `docs/code-style.md` —— 编码规范，评审会按此执行。
- `docs/project-structure.md` —— 目录职责，确保改动落在正确的层（依赖方向：screens/components → core → plugins/utils → 平台）。

## 2. 分支与发布节奏

| 分支 | 用途 | 发布行为 |
|------|------|----------|
| `master` | 发布分支（当前主线） | 推送即触发 `release.yml` 自动构建并发布 GitHub Release（打 `v<version>` tag） |
| `dev` | 开发分支 | **PR 的唯一目标分支**；向 dev 提 PR 会触发 `build-test.yml` 构建检查 |
| `beta` | 预发布分支 | 推送触发 `beta-pack.yml` 构建 Beta 包（上传产物，不发 Release） |

> 维护者发布流程见 [docs/build-and-release.md](./build-and-release.md) §7。

## 3. 提 Issue

项目提供两份 Issue 模板（`.github/ISSUE_TEMPLATE/`），请在对应入口提交：

| 模板 | 场景 | 必填项 |
|------|------|--------|
| `bug.yml` | 报告错误 | 已读常见问题与已搜索 Issue 列表、预期行为、实际行为、LX Music 版本、操作系统版本；可选：最后正常的版本、附加信息（可直接拖图/视频） |
| `feature.yml` | 功能请求 | 已读常见问题与已搜索 Issue 列表、问题描述、想要的解决方案；可选：替代方案、附加信息 |

### 3.1 高质量 Issue 的建议

| 要点 | 说明 |
|------|------|
| 版本信息完整 | 填「LX Music 版本」时带架构（如 `1.8.4 arm64-v8a`），与「最后正常的版本」对比可快速定位回归 |
| 复现步骤可执行 | 写明「做了什么 → 看到了什么 → 期望什么」，bug 模板的预期/实际行为两项分开填 |
| 缩小范围 | 能确认与某个音乐源（kw/kg/tx/wy/mg）或某个设置项相关的，在标题或描述中注明 |
| 截图/录屏 | 拖入编辑框即可；初始化失败场景可直接附错误对话框中的 bootLog |

## 4. 提交 PR 规则

依据 `README.md`「贡献代码」章节，PR 需满足：

| 类型 | 要求 |
|------|------|
| 新增功能 | **先创建 Issue 说明并确认该功能确实需要**，再提交 PR（避免白做） |
| 修复 bug | 附修复前后的说明及重现方式 |
| 其他类型 | 适当附上说明 |

通用规则：

- 开发在 `dev` 分支上进行，**PR 目标分支为 `dev`**（不是 master）；
- 提交前跑通本地 lint（`npm run lint`）与构建检查；
- 每个 PR 尽量小、聚焦单一变更，便于评审与回滚。

PR 描述建议包含：改动目的（关联 Issue 编号）、改动清单（涉及文件/模块）、验证方式（本地验证了什么、附截图/日志）、回归风险点。

## 5. 开发流程

1. **搭环境**：按 [docs/getting-started.md](./getting-started.md) 完成环境搭建，`npm run start` + `npm run dev` 能跑起调试包。
2. **建分支**：

   ```powershell
   git clone https://github.com/lyswhut/lx-music-mobile.git
   git checkout -b dev origin/dev   # 或基于 dev 新建功能分支
   ```

3. **开发**：遵守 [docs/code-style.md](./code-style.md)；涉及新文案时同步三个语言包（`src/lang/zh-cn.json`、`zh-tw.json`、`en-us.json`）。
4. **自检**：

   ```powershell
   npm run lint
   npm run build-test   # 本地验证 JS bundle 可打包（CI 同款检查）
   ```

5. **提交 PR**：目标 `dev` 分支，按 §4 规则附说明；PR 触发 CI（`build-test.yml`：lint + build-test），需全部通过。

### 5.1 提交信息与分支命名

- 提交信息遵循 **Conventional Commits**（`CHANGELOG.md` 头部声明：`Commit convention is based on Conventional Commits`），例如 `fix: 修复蓝牙歌词显示问题`、`feat: 新增 xxx 设置项`、`docs: 更新 xxx 文档`。
- 功能分支命名建议与提交内容对应：`fix/bluetooth-lyric`、`feat/setting-xxx` 等，便于 PR 归类。
- 变更日志基于 **Keep a Changelog** 格式（`CHANGELOG.md` 头部声明），正式版本日志由维护者经 `npm run publish` 生成，贡献者无需手写版本章节。

### 5.2 提交前的自检清单

| # | 检查项 | 命令 / 位置 |
|---|--------|-------------|
| 1 | lint 通过（零 error） | `npm run lint` |
| 2 | 类型检查通过 | `npx tsc --noEmit` |
| 3 | JS bundle 可打包 | `npm run build-test` |
| 4 | 新文案已同步三个语言包 | `src/lang/zh-cn.json`、`zh-tw.json`、`en-us.json` |
| 5 | 新增事件已类型化并登记 | `src/event/*.ts` + `src/types/app.d.ts` |
| 6 | 新增存储 key 已登记前缀 | `src/config/constant.ts` → `storageDataPrefix` |
| 7 | 涉及 UI 时验证过竖屏/横屏 | Home、PlayDetail 需双布局自查 |
| 8 | 改动涉及文档所述机制时同步更新文档 | `docs/`（见 §6 文档列） |

## 6. 代码评审要点

| 检查项 | 要点 | 依据 |
|--------|------|------|
| ESLint | `npm run lint` 零 error | `.eslintrc.cjs`、CI 强制 |
| 类型 | 提交前 `npx tsc --noEmit` 自检；新增类型放入 `src/types/` 的 `LX.*` 命名空间 | `tsconfig.json`、[code-style.md](./code-style.md) |
| 状态管理 | 状态放 `store/<域>/state.ts`，修改走 `action.ts` 并广播事件；**不要**新建 Redux 代码 | design-doc ADR-2 / §3.4.2 |
| 事件总线 | `on/off` 成对（hook 中在 `useEffect` cleanup 注销）；新事件必须加类型化方法并同步 `src/types/app.d.ts` | design-doc §3.4.3 |
| i18n | 文案不硬编码，走 `global.i18n.t('key')` / `useI18n`；key 在 `zh-cn.json`（fallback）必须存在，`zh-tw`、`en-us` 同步补 | design-doc §6.3 |
| 响应式布局 | 涉及页面级 UI 时同时验证竖屏/横屏（Home、PlayDetail 有 `Horizontal/`、`Vertical/` 双布局；SonglistDetail、Comment 为单布局） | design-doc §2.2 |
| 存储 key | 新增持久化 key 统一登记在 `src/config/constant.ts` 的 `storageDataPrefix`（`@` 前缀） | design-doc §6.1 |
| 依赖方向 | screens/components → core → plugins/utils → 平台，禁止下层反向依赖 UI | design-doc §3.3 |
| 播放改动 | 播放服务与 UI 完全解耦：原生事件只经 `app_event` 回流业务层，`core/player` 做决策、`plugins/player` 只执行；改动后需回归后台播放、锁屏控制、切歌 | design-doc §5.1 |
| 文档同步 | 改接口/字段/配置时同步更新 `docs/` 对应文档 | design-doc §9 |

## 7. CI 会替你检查什么

向 `dev` 提 PR 后，`build-test.yml` 自动执行：

1. `actions/setup-node@v4` Node 20；
2. `npm ci` 安装依赖；
3. `npm run lint` —— 未过则 PR 无法合并；
4. `npm run build-test` —— 验证 JS bundle 打包（不等于完整原生构建）。

master 的完整原生构建与发布由 `release.yml` 负责（见 [build-and-release.md](./build-and-release.md)）。

## 8. 评审与沟通约定

- **评审流程**：作者提交 PR → CI 自动检查（lint + build-test）→ 维护者/协作者按 §6 要点评审 → 通过后合并至 `dev` → 维护者择机将 `dev` 合入 `master` 触发发布。PR 无需自己合入 master。
- **评审者视角**：按 §6 表格逐项核对；改动是否最小、是否与 design-doc 的 ADR / 模块边界冲突是首要问题。
- **作者响应**：评审意见逐条回复「已修改 / 说明原因」；重新 push 后 CI 会自动重跑，无需关闭重开 PR。
- **文档贡献**：docs 体系以 `design-doc.md` 为顶层依据；`docs/` 下其他文档（如模块文档）必须引用对应设计决策且不得与之冲突（design-doc §9）。改接口/字段/配置时同步改文档，术语以 `docs/appendix/glossary.md`（如存在）与源码为准。
- **不要做的事**：不要向 master 直接提交功能代码；不要修改 `publish/version.json` / `package.json` 的版本号（由维护者用 `npm run publish` 统一处理）；不要把 `android/keystore.properties` 或任何 `.keystore` 提交进仓库（`clear:full` 也会显式保留它们）。

## 9. 常见坑（接手前必读）

- 启动初始化失败调试：`src/app.ts` 的「Init Failed」对话框含完整 bootLog，按 design-doc §3.4.1 的步骤顺序对照定位。
- `src/plugins/player/service.ts` 有大量被注释的旧重试/切歌逻辑，改动播放服务前先确认行为已由 `core/player` 承担（design-doc §8）。
- `xm` 源已导出但不在内置源列表（界面不可选）、`api-source-info.ts` 内置源数组为空，均属现状而非 bug（design-doc §8）。
- `src/store/Provider/Provider.tsx` 为废弃的 Redux Provider（代码整体注释），实际入口是 `src/store/Provider/index.ts`（转发至 `ThemeProvider`），勿混用（design-doc §8）。
- 新增自定义音源脚本调试时，可在设置中开启用户源日志（`global.lx.isEnableUserApiLog`），配合 `src/utils/log.ts` 查看脚本执行日志。
- 真机调试热更新不生效时，先确认 Metro 端口可达或执行 `adb reverse tcp:8081 tcp:8081`（详见 getting-started §6 常见启动问题）。

## 10. 相关文档

- 代码规范：[./code-style.md](./code-style.md)
- 工程结构：[./project-structure.md](./project-structure.md)
- 构建与发布：[./build-and-release.md](./build-and-release.md)
- 设计文档：[./design-doc.md](./design-doc.md)
