# LX Music 移动版 — 开发者文档中心

> 本目录为 **lx-music-mobile**（洛雪音乐助手移动版，React Native）的开发者文档体系，面向**贡献者 / 二次开发者 / 维护者**，全部使用简体中文。
>
> 官方终端用户文档见 <https://lyswhut.github.io/lx-music-doc/mobile>；本目录聚焦**源码层面**，与官方文档互补。

## 阅读路线

| 目的 | 推荐阅读 |
|------|----------|
| 先建立全局认识（为什么这么设计、模块边界） | [design-doc.md](./design-doc.md) → [architecture.md](./architecture.md) |
| 搭建环境、跑起项目 | [getting-started.md](./getting-started.md) |
| 打 APK、走发布流程 | [build-and-release.md](./build-and-release.md) |
| 提交代码 / PR | [contributing.md](./contributing.md) |
| 写代码前了解规范 | [code-style.md](./code-style.md) |
| 定位某个目录是干什么的 | [project-structure.md](./project-structure.md) |
| 深入某个子系统 | [modules/](#模块文档) |
| 术语含义、开发常见问题 | [appendix/glossary.md](./appendix/glossary.md)、[appendix/faq-dev.md](./appendix/faq-dev.md) |

## 文档目录

### 顶层文档

| 文档 | 内容 | 读者 |
|------|------|------|
| [design-doc.md](./design-doc.md) | **设计依据（本文档体系的根）**：项目目标、约束、架构决策（ADR）、模块边界、数据模型、扩展点、已知风险 | 所有人，先读 |
| [architecture.md](./architecture.md) | 系统架构详述：分层、启动管道、状态管理、事件总线、导航、播放链路、数据流时序 | 想理解全貌的开发者 |
| [getting-started.md](./getting-started.md) | 环境要求、依赖安装、运行调试、常见启动问题 | 新贡献者 |
| [build-and-release.md](./build-and-release.md) | 版本号管理、本地打包、CI 发布流程、产物说明 | 维护者 / 打包者 |
| [contributing.md](./contributing.md) | Issue/PR 规则、开发流程、代码评审要点 | 所有贡献者 |
| [code-style.md](./code-style.md) | ESLint/TS 规范、命名约定、事件总线与 store 使用规范 | 所有写代码的人 |
| [project-structure.md](./project-structure.md) | 根目录与 src/ 目录职责速查、页面清单 | 所有人 |

### 模块文档（docs/modules/）

| 模块 | 内容 | 对应源码 |
|------|------|----------|
| [modules/state-management.md](./modules/state-management.md) | 自研 store 三件套（state/action/hook）与事件总线机制 | `src/store/`、`src/event/` |
| [modules/navigation.md](./modules/navigation.md) | react-native-navigation 屏幕注册与导航体系 | `src/navigation/` |
| [modules/list-management.md](./modules/list-management.md) | 我的列表（default/love/temp/user）与歌单机制 | `src/core/list.ts`、`src/store/list/` |
| [modules/music-sources.md](./modules/music-sources.md) | 音乐源体系：musicSdk 内置源、音质、apiSource 切换、自定义源 | `src/utils/musicSdk/`、`src/core/apiSource.ts` |
| [modules/player.md](./modules/player.md) | 播放引擎：core/player 业务层、plugins/player 原生层、事件映射 | `src/core/player/`、`src/plugins/player/` |
| [modules/data-sync.md](./modules/data-sync.md) | 数据同步客户端（lx-music-sync-server 协议对接） | `src/plugins/sync/`、`src/core/sync.ts` |
| [modules/theme.md](./modules/theme.md) | 主题系统：定义、生成、动态配色、运行时切换 | `src/theme/`、`src/core/theme.ts` |
| [modules/i18n.md](./modules/i18n.md) | 国际化：语言包、运行时、新增语言流程 | `src/lang/` |
| [modules/tv-adaptation.md](./modules/tv-adaptation.md) | Android TV / 遥控器（媒体键 + D-pad）适配方案与分阶段计划 | `android/` 原生壳、`src/tv/`（规划） |

### 附录（docs/appendix/）

| 文档 | 内容 |
|------|------|
| [appendix/glossary.md](./appendix/glossary.md) | 术语表：LX 命名空间、核心概念中英对照 |
| [appendix/faq-dev.md](./appendix/faq-dev.md) | 开发者常见问题（代码级） |
| [modules/tv-adaptation.md](./modules/tv-adaptation.md) | **TV 适配**：遥控器媒体键 + D-pad 导航的方案与实施计划（扩展附录） |

## 文档维护约定

1. **design-doc.md 为根**：`docs/modules/*` 均引用 design-doc 的设计决策与模块边界；任何文档与 design-doc 冲突时，以 design-doc 为准并提示更新。
2. **文档即代码**：修改接口、设置键、事件名、存储 key 时，同步更新对应模块文档与 glossary；新增/重命名模块时更新本索引与 `project-structure.md`。
3. **代码演进导致文档失效**：优先修订 design-doc，再级联修订派生文档。
4. **事实核对**：文档中的文件路径、函数名、事件名、设置键均以源码为准；发现源码与文档不一致时，在对应文档「疑点」章节标注，勿直接断言。
