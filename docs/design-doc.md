# LX Music 移动版 — 设计文档（Design Doc）

> 本文档是 `docs/` 开发者文档体系的**顶层设计依据**。其余所有文档（架构、模块、工程流程）均以本文档定义的背景、约束、架构决策与模块边界为基准展开；若文档间出现冲突，以本文档为准。
>
> - 文档版本：1.0
> - 适用范围：`lx-music-mobile` 源码（v1.8.4，versionCode 76）
> - 目标读者：贡献者 / 二次开发者 / 维护者
> - 配套索引：见 [docs/README.md](./README.md)

---

## 1. 项目概述

### 1.1 是什么

LX Music 移动版（洛雪音乐助手移动版）是一个基于 **React Native** 开发的在线音乐播放软件。它聚合多个公开音乐平台的数据源，提供搜索、歌单、排行榜、歌词、播放列表管理、数据同步与主题换肤等能力。

- 项目地址：<https://github.com/lyswhut/lx-music-mobile>
- 官方原始发布渠道：仅 GitHub Releases
- 数据同步服务（独立仓库）：<https://github.com/lyswhut/lx-music-sync-server>
- 桌面版（独立项目）：<https://github.com/lyswhut/lx-music-desktop>

### 1.2 核心目标

1. **多源聚合**：通过统一抽象（`musicSdk`）聚合酷我(kw)、酷狗(kg)、QQ(tx)、网易云(wy)、咪咕(mg) 等平台的能力，提供一致的搜索 / 歌单 / 排行榜 / 歌词 / 播放体验。
2. **本地优先**：用户数据（我的列表、收藏、播放历史、设置）默认存储在本地，可通过可选的数据同步服务跨设备同步。
3. **可扩展**：支持通过“自定义音源(user_api)”注入新的数据源能力，不修改主程序即可适配上游 API 变化。
4. **Android 优先**：目前仅支持 Android 5+（无 iOS / HarmonyOS NEXT 计划）。

### 1.3 非目标

- 不维护、不存储任何受版权保护的数据（见 README 项目协议：使用者需在 24 小时内清除使用过程中产生的版权数据）。
- 不对用户自定义源返回的音频链接做正确性校验——项目只负责把请求参数传递给“源”，并将返回的链接用于播放。
- 不以新手友好为默认目标（默认设置与 UI 操作偏向功能密度，详见官方使用文档）。

---

## 2. 背景与约束

### 2.1 技术约束

| 类别 | 约束 | 依据 |
|------|------|------|
| 运行时 | React Native 0.73.11 + React 18.2 | `package.json` |
| 导航 | `react-native-navigation` 7.39.2（原生屏幕注册，非 React Navigation 栈） | `src/navigation/` |
| 播放 | `react-native-track-player`（fork 版本）+ `react-native-background-timer` | `src/plugins/player/` |
| 存储 | `@react-native-async-storage/async-storage`，自带大值分片封装 | `src/plugins/storage.ts` |
| 语言 | TypeScript（`src/**/*.ts`）+ 少量历史 JS（`src/**/*.js`） | `tsconfig.json` |
| 构建 | Metro / Babel，`babel-plugin-module-resolver` 提供 `@/` 路径别名指向 `src/` | `babel.config.js`、`tsconfig.json` |
| 平台 | Android（`android/`），含 `ios/` 目录但官方不支持 iOS | README |
| Node | >= 18，npm >= 8.5.2 | `package.json` |

### 2.2 非功能约束

- **响应式布局**：需同时适配竖屏/横屏（大量 `Horizontal/`、`Vertical/` 双布局目录）。
- **后台播放**：依赖原生播放服务（TrackPlayer 注册的 playback service），支持锁屏控制、通知栏、蓝牙歌词。
- **离线可用**：核心功能（列表、播放）在无网络时仍可用（本地数据 + 缓存）。
- **启动可靠性**：初始化失败不得静默；通过 bootLog 采集启动日志，失败时弹出带日志的对话框并退出。
- **低侵入同步**：数据同步为可选开关，默认关闭；同步失败不影响本地使用。

### 2.3 关键设计决策（ADR 摘要）

> 详细论证见 `docs/architecture.md`；本表为决策速查。

| # | 决策 | 理由（简述） |
|---|------|--------------|
| ADR-1 | 使用 react-native-navigation 而非 React Navigation | 原生导航栈、性能更好，项目历史沿用 |
| ADR-2 | 自研轻量状态管理（store/<域>/{state,action,hook}.ts）而非 Redux | 避免样板代码，配合事件总线驱动 UI 更新 |
| ADR-3 | 全局事件总线（`global.state_event` / `app_event` / `list_event` / `dislike_event`） | 解耦核心逻辑与 UI 层，跨模块通信 |
| ADR-4 | `musicSdk` 统一抽象所有音乐源 + `user_api` 自定义源机制 | 单一入口、可插拔、适配上游变化 |
| ADR-5 | 扁平点分式设置键（`'player.playQuality'` 等） | 便于持久化、迁移与按前缀分组 |
| ADR-6 | AsyncStorage 分片存储大值（>500KB 拆片） | 规避 AsyncStorage 单值限制 |
| ADR-7 | 全局对象 `global.lx` 承载跨模块运行时状态 | 减少模块间显式依赖，服务共享运行期数据 |
| ADR-8 | 播放列表逻辑（playedList / tempPlayList / playInfo）与 UI 分离 | 保证播放服务在后台独立运行 |

---

## 3. 系统架构

### 3.1 分层概览

```
┌──────────────────────────────────────────────────────────┐
│  UI 层  src/screens + src/components + src/navigation      │
│  首页/播放详情/歌单详情/评论 + 通用组件 + 屏幕注册导航       │
└───────────────┬──────────────────────────────────────────┘
                │ store hooks 订阅事件 / 调用 core
┌───────────────▼──────────────────────────────────────────┐
│  业务核心层  src/core + src/store                         │
│  player / music / list / lyric / theme / sync / version   │
│  search / leaderboard / songlist / dislikeList / userApi  │
└───────────────┬──────────────────────────────────────────┘
                │ 调用插件适配层
┌───────────────▼──────────────────────────────────────────┐
│  插件适配层  src/plugins + src/utils                       │
│  player(TrackPlayer) / sync(client) / storage / lyric      │
│  musicSdk(多源) / fs / request / nativeModules             │
└───────────────┬──────────────────────────────────────────┘
                │ 原生能力
┌───────────────▼──────────────────────────────────────────┐
│  平台层  react-native 核心 + 原生模块 + AsyncStorage       │
└──────────────────────────────────────────────────────────┘
```

### 3.2 目录职责速查（src/）

| 目录 | 职责 |
|------|------|
| `src/screens/` | 页面级组件（Home / PlayDetail / SonglistDetail / Comment），其中 Home、PlayDetail 含横竖屏双布局（`Horizontal/`、`Vertical/`） |
| `src/components/` | 通用 UI 组件（`common/`）、业务组件（`player/`、`OnlineList/` 等） |
| `src/navigation/` | RNN 屏幕注册、导航封装、hooks、屏幕名称常量、弹窗组件 |
| `src/store/` | 按领域拆分的轻量状态（`state.ts` + `action.ts` + `hook.ts`）与 Provider |
| `src/core/` | 业务逻辑核心：播放、列表、歌词、主题、同步、版本、搜索、用户源等 |
| `src/plugins/` | 能力适配：player（TrackPlayer 封装）、sync（同步客户端）、storage、lyric |
| `src/utils/` | 工具集：`musicSdk`（多源 SDK）、hooks、nativeModules、fs、request、log 等 |
| `src/event/` | 事件总线实现与类型化接口（stateEvent / appEvent / listEvent / dislikeEvent） |
| `src/config/` | 设置 schema 与默认值（`defaultSetting.ts`）、常量（`constant.ts`）、全局数据（`globalData.ts`） |
| `src/lang/` | i18n：语言包（zh-cn / zh-tw / en-us）与运行时 |
| `src/theme/` | 主题引擎：配色、字体、主题生成脚本 |
| `src/types/` | 全局类型声明（`LX.*` 命名空间） |
| `src/resources/` | 静态资源（字体、图片、占位音频） |

### 3.3 模块依赖方向

- 依赖方向**自上而下**：`screens/components` → `core` → `plugins/utils` → 平台。
- `store` 的 `state.ts` 被上下两层共同引用（下层写、上层订阅），属于共享契约层。
- `core` 与 `plugins` 之间通过函数导入协作；跨模块异步事件统一走 `global.*_event` 总线。
- 全局运行时数据（`global.lx`）在 `src/config/globalData.ts` 初始化，类型契约在 `src/types/app.d.ts` 声明。

### 3.4 关键运行机制

#### 3.4.1 启动流程（异步初始化管道）

`index.js` → `src/app.ts`：

1. 初始化错误处理、日志、bootLog、全局数据、字体大小、窗口尺寸工具。
2. 动态 `import('@/core/init')` 执行初始化管道：
   `initSetting → initTheme → initI18n → initUserApi → setApiSource → registerPlaybackService → initPlayer → dataInit → initCommonState → initSync`
3. 每步成功后写入 bootLog；任一步抛错 → 弹出带完整 bootLog 的失败对话框，可退出应用。
4. 初始化完成后通过 RNN 推入首页；首次进入时异步检查更新（`checkUpdate`）并初始化深链（`initDeeplink`）。

> 注意：`dataInit` 负责从本地存储恢复列表、播放进度等数据；播放器恢复逻辑位于 `src/core/init/player/`。

#### 3.4.2 状态管理机制

每个领域一个 `store/<domain>/` 目录，三个文件各司其职：

| 文件 | 职责 |
|------|------|
| `state.ts` | 领域状态的唯一数据源（单例对象），导出 `InitState` 类型 |
| `action.ts` | 修改 state 的纯操作函数；修改后通过 `global.state_event` 广播 |
| `hook.ts` | React hooks，订阅 `state_event`，将状态映射为组件可用的响应式值 |

UI 组件通过 `hook.ts` 的 hooks 获取状态；非 UI 逻辑（core）直接读 `state.ts` 或调用 `action.ts`。

#### 3.4.3 事件总线（解耦核心）

`src/event/` 定义了 4 个类型化总线，实例挂载在 `global` 上（见 `src/config/globalData.ts`）：

| 总线 | 挂载点 | 语义 |
|------|--------|------|
| `state_event` | `global.state_event` | 领域状态变更通知（如 `mylistUpdated`、`playStateChanged`） |
| `app_event` | `global.app_event` | 应用/播放器行为事件（如 `play`、`pause`、`playerError`、`myListMusicUpdate`） |
| `list_event` | `global.list_event` | 列表内部变更事件 |
| `dislike_event` | `global.dislike_event` | 不喜欢列表变更事件 |

总线基类 `src/event/Event.ts` 提供 `on/off/emit`；各总线子类声明带类型的触发方法，并在 `app.d.ts` 中导出类型化的 `on/off` 签名，保证编译期事件契约。

#### 3.4.4 全局运行时对象（global.lx）

`global.lx`（类型 `LX.GlobalData`，见 `src/types/app.d.ts`）承载跨模块共享的运行时状态，例如：

- `playerStatus`（播放器初始化/服务注册状态）
- `gettingUrlId` / `playerTrackId`（播放请求去重）
- `qualityList` / `apis` / `apiInitPromise`（音源与自定义源状态）
- `isScreenKeepAwake` / `isPlayedStop` / `homePagerIdle`（界面与播放联动标记）

---

## 4. 数据模型

> 完整类型见 `src/types/`；以下为核心模型速查。

### 4.1 音乐信息（LX.Music.MusicInfo）

按来源为判别联合（discriminated union），`meta` 字段因源而异：

| 类型 | 判别（`source`） | `meta` 特有字段 |
|------|-----------------|-----------------|
| `MusicInfoLocal` | `'local'` | `filePath`、`ext` |
| `MusicInfo_online_common` | `'kw' \| 'wy'` | `qualitys`、`_qualitys`、`albumId?` |
| `MusicInfo_kg` | `'kg'` | + `hash`（kg 特有音质/歌曲标识） |
| `MusicInfo_tx` | `'tx'` | + `strMediaMid`、`albumMid?` |
| `MusicInfo_mg` | `'mg'` | + `copyrightId`、`lrcUrl?`、`mrcUrl?`、`trcUrl?` |

公共字段：`id`（源内唯一）、`name`、`singer`、`source`、`interval`（格式化时长）、`meta`（`songId`、`albumName`、`picUrl?`、`toggleMusicInfo?`）。

**音质（LX.Quality）**：`128k / 320k / flac / wav` 等，各源支持列表见 `musicSdk/api-source-info.ts` 的 `supportQualitys`（当前内置源声明为空数组占位，实际能力由各源模块自身实现）。

### 4.2 设置模型（LX.AppSetting）

- 扁平点分式键，按前缀分组：`common.*`、`player.*`、`theme.*`、`playDetail.*`、`desktopLyric.*`、`search.*`、`list.*`、`download.*`、`sync.*`。
- 默认值定义于 `src/config/defaultSetting.ts`；schema 类型见 `src/types/app_setting.d.ts`。
- 持久化：`src/core/init/dataInit` 或 `core/common` 的 `initSetting` 读取 `@setting_v1`（见 `constant.ts` 的 `storageDataPrefix`），迁移逻辑在 `src/config/migrateSetting.ts`（结构迁移）与 `src/config/migrate.ts`（数据迁移）。
- 设置修改统一走 `updateSetting`（`src/core/common.ts`），并触发 `state_event.configUpdated`。

### 4.3 列表模型（LX.List）

| 概念 | 说明 |
|------|------|
| 我的列表 | `default`（试听列表）、`love`（我的收藏）、`temp`（临时列表）为内置；`userList` 为用户自建列表 |
| `MyAllList` | `{ defaultList, loveList, userList, tempList }` 的聚合 |
| `ListDataFull` | 各列表携带完整歌曲数组的形态（用于导入导出/备份） |
| 下载列表 | `LX.Download.ListItem`，独立于我的列表存储 |

列表内歌曲存储于 `@list__<listId>`（见 `constant.ts` 的 `storageDataPrefix`）；列表操作（增删改查、移动、覆盖、清除）的动作契约定义在 `src/types/list.d.ts`（`ListAction*` 系列）。

### 4.4 播放模型（LX.Player）

- `PlayMusicInfo`：`{ musicInfo, listId, isTempPlay }` — 当前播放歌曲与来源列表。
- `PlayInfo`：`{ playIndex, playerListId, playerPlayIndex }` — 播放位置状态。
- `playedList` / `tempPlayList`：已播放列表 / 稍后播放队列。
- `Track`：TrackPlayer 轨道对象（`id`、`url`、`title`、`artist`、`album`、`artwork`、`musicId`、`lyric` 等）。
- 持久化：播放进度、恢复信息（`SavedPlayInfo`）见 `src/core/init/player/`。

### 4.5 歌词模型

- `LX.Music.LyricInfo`：`{ lyric, tlyric?, rlyric?, lxlyric? }` — 原词 / 翻译 / 罗马音 / 逐字歌词。
- 解析基于 `lrc-file-parser`，各源获取逻辑位于 `musicSdk/<源>/lyric.js`。
- 桌面歌词（`desktopLyric.*` 设置组）与蓝牙歌词（`player.isShowBluetoothLyric`）共用该模型。

---

## 5. 模块边界与职责

> 各模块的详细设计见 `docs/modules/` 对应文档。

### 5.1 播放引擎（core/player + plugins/player）

- **core/player/**：播放控制（play/pause/next/prev）、播放列表状态机、定时退出（timeoutExit）、获取 URL 与延迟重试、进度/状态文本、已播放列表管理。
- **plugins/player/**：TrackPlayer 的封装 —— `initial`（setupPlayer + 缓存迁移）、`service.ts`（注册后台 playback service，将原生事件映射为 `app_event`）、`playList.ts`（轨道构建/队列）、`utils.ts`（音量/倍速/元数据/进度工具）。
- 设计要点：**播放服务与 UI 完全解耦**，后台事件只通过 `app_event` 回流业务层；`core/player/player.ts` 负责业务决策（切歌、重试、超时），`plugins/player` 只负责原生执行。

### 5.2 音乐源（utils/musicSdk）

- 目录结构：`musicSdk/<源>/`，每源提供统一能力：`musicSearch / songList / leaderboard / hotSearch / musicInfo / lyric / pic / comment / album / singer / tipSearch` 等（能力因源而异）。
- 内置源：`kw`（酷我）、`kg`（酷狗）、`tx`（QQ）、`wy`（网易云）、`mg`（咪咕）、`xm`；`bd`（百度）被注释停用。
- 自定义源：`core/userApi.ts` 加载用户脚本（`user_api` 前缀 id），脚本运行沙箱由 `utils/nativeModules/userApi.ts` 等提供能力（见 `src/core/init/userApi/`）。
- 切换机制：`core/apiSource.ts` 的 `setApiSource` 处理内置源与自定义源的切换、失败回退与 `state_event.apiSourceUpdated` 广播。

### 5.3 我的列表（core/list + store/list）

- `core/list.ts`：列表的增删改查、歌曲增删移、导入导出、存储与恢复。
- `store/list`：列表元数据状态（`allList`、`activeListId` 等）与 hooks。
- 列表变更通过 `state_event.mylistUpdated` / `app_event.myListMusicUpdate` 通知界面与下载/播放等下游。

### 5.4 歌词（core/lyric + plugins/lyric）

- `core/lyric.ts`：歌词获取、解析、进度映射、偏移调整、翻译/罗马音合并、S2T 转换。
- `plugins/lyric.ts`：歌词文本处理工具（时间轴解析、格式化）。
- 桌面歌词由 `utils/nativeModules/lyricDesktop.ts` 对接原生浮窗能力。

### 5.5 主题（core/theme + src/theme）

- `src/theme/themes/`：主题定义与生成脚本（`createThemes.js`，npm script `build:theme`）。
- `src/theme/`：`Colors.js`、`Typography.js`、`index.js` 提供应用层样式入口。
- `core/theme.ts`：主题切换（自动跟随系统 `common.isAutoTheme`、暗色硬编码兜底）、动态背景、字体阴影设置。⚠️ `theme.lightId` / `theme.darkId` 有 schema 与默认值，但运行时 `getTheme()` 未消费（旧逻辑被注释），见 `docs/modules/theme.md` 疑点。

### 5.6 数据同步（core/sync + plugins/sync）

- `plugins/sync/client/`：lx-music-sync-server 的 WebSocket 客户端（`auth.ts` / `client.ts` / `utils.ts`），支持 `list`、`dislike`、`sync` 三个数据模块。
- `plugins/sync/`：本地事件采集（`listEvent.ts` / `dislikeEvent.ts`）、数据序列化（`data.ts`）、日志（`log.ts`）、常量（`constants.ts`）。
- `core/sync.ts`：同步状态管理、同步模式选择弹窗流程。
- 启用开关：`sync.enable`（默认关闭）；状态经 `state_event.syncStatusUpdated` 广播。

### 5.7 版本与更新（core/version + store/version）

- `core/version.ts`：版本信息获取、更新检查、忽略版本、下载进度。
- 弹窗：`navigation/components/VersionModal.tsx`；状态：`store/version`。

### 5.8 其他核心模块

| 模块 | 文件 | 职责 |
|------|------|------|
| 搜索 | `core/search/` | 音乐/歌单搜索、热门搜索、搜索历史 |
| 排行榜 | `core/leaderboard.ts` | 各源排行榜获取 |
| 歌单 | `core/songlist.ts` | 在线歌单详情 |
| 不喜欢列表 | `core/dislikeList.ts` | 全局不喜欢过滤（含同步） |
| 深链 | `core/init/deeplink/` | 文件 / 音乐 / 播放器 / 歌单 action 分发 |
| 通用 | `core/common.ts` | 设置更新、退出、弹窗等公共能力 |
| 用户源 | `core/userApi.ts` | 自定义音源脚本的加载与执行 |

---

## 6. 关键工程机制

### 6.1 持久化（plugins/storage）

- 基于 AsyncStorage 的封装：`saveData / getData / removeData / getAllKeys / getDataMultiple / saveDataMultiple / removeDataMultiple / clearAll`。
- **分片策略**：单值 JSON 序列化后超过 `500000` 字符时，拆为 `@___PART_A___<key><i>` 分片存储，主键存分片 key 数组；兼容 1.4.0 之前的旧分隔符分片格式（`@___PART___`，读取时自动识别）。
- 存储 key 前缀统一定义于 `src/config/constant.ts` 的 `storageDataPrefix`。

### 6.2 日志与错误处理

- `src/utils/log.ts`：业务日志（含同步日志 / 用户源日志开关）。
- `src/utils/bootLog.ts`：启动日志采集（数组环形缓冲），初始化失败时输出到错误对话框。
- `src/utils/errorHandle.ts`：全局 JS 错误兜底（`src/app.ts` 最先引入）。

### 6.3 国际化（src/lang）

- 语言包：`zh-cn.json`（fallback）、`zh-tw.json`、`en-us.json`。
- 运行时：`createI18n` 生成 `global.i18n`，提供 `t(key, vals?)` / `getMessage` / `setLanguage`；组件侧通过 `useI18n` hook。
- 新增语言：向 `src/lang/` 增加语言包并按 `src/lang/Readme.md` 的 locale 列表命名，随后在 `src/lang/index.ts` 注册。
- 开发辅助：`.vscode/i18n-ally-custom-framework.yml` 配置了 i18n-ally 的自定义框架解析。

### 6.4 路径别名与构建

- `@/` → `src/`：`babel.config.js`（babel-plugin-module-resolver）与 `tsconfig.json` 的 `paths` 同步配置。
- lint：`npm run lint`（ESLint，standard 风格 + TypeScript 解析）。
- 主题生成：`npm run build:theme`（`node src/theme/themes/createThemes.js`）。

---

## 7. 扩展点设计

| 扩展点 | 方式 | 入口 |
|--------|------|------|
| 新增音乐源 | 在 `musicSdk/` 下新建源目录，实现统一能力接口，并在 `musicSdk/index.js` 注册 | `src/utils/musicSdk/` |
| 自定义音源 | 在设置中导入/编辑 user_api 脚本，脚本 id 以 `user_api` 前缀标识 | `src/core/userApi.ts`、`src/core/init/userApi/` |
| 新主题 | 在 `src/theme/themes/` 添加主题定义，重新运行 `build:theme` | `src/theme/themes/` |
| 新语言 | 新增语言包 + 注册（见 6.3） | `src/lang/` |
| 新页面 | 在 `src/screens/` 创建页面，`navigation/registerScreens.tsx` 注册，`navigation/screenNames.ts` 声明名称 | `src/navigation/` |

---

## 8. 已知风险与技术债

> 贡献者接手前请先了解以下事项，避免踩坑。

1. **README 技术栈描述过时**：README 提到 Redux，但实际已改为自研 store + 事件总线模式（见 ADR-2 / 3）。docs 以代码为准。
2. **播放服务遗留注释代码**：`src/plugins/player/service.ts` 中存在大量被注释的旧重试/切歌逻辑，属于历史代码，重构时需谨慎确认行为已由 `core/player` 承担。
3. **`src/store/Provider/Provider.tsx` 已废弃**：其中 Redux Provider 代码整体注释；实际 Provider 为 `src/store/Provider/index.ts`（`ThemeProvider` 包装），`navigation/registerScreens.tsx` 中 `WrappedComponent` 使用其包装每个已注册屏幕。
4. **iOS 目录存在但官方不支持**：`ios/` 仅为历史遗留，README 明确无 iOS 计划，勿投入 iOS 适配。
5. **`xm` 源注册但不在 `sources.sources` 列表中**：`musicSdk/index.js` 导出了 `xm`，但内置源列表不含它，界面不可选。
6. **`api-source-info.ts` 内置源数组为空**：`supportQualitys` 声明未填充实际数据，`api-source.js` 的 `apis()` 直接走 `getAPI`（当前同样为空，仅保留 user_api 路径），说明当前内置源能力完全由各源模块自身实现、`apiList` 机制已被注释停用。
7. **同步模块文件布局**：`plugins/sync/client/` 下 `modules/{list,dislike}/` 与顶层 `sync/` 并存，文档需以 `client/modules/index.ts` 为实际入口核对。
8. **`.bak` 文件**：`src/screens/Home/Views/Setting/settings/Sync/isEnable.tsx.bak` 为备份残留。
9. **启动路径中 `tipDialog` 依赖**：`src/utils/tools.ts` 的 `tipDialog` 在初始化失败兜底中承担关键作用，改动需回归验证启动失败路径。

---

## 9. 质量验收与文档一致性

- 所有 `docs/modules/*` 文档必须引用本 design-doc 对应的「设计决策 / 约束 / 模块边界」，不得与之冲突。
- 术语使用以 `docs/appendix/glossary.md` 为准；技术名词（如 MusicInfo、apiSource、playedList）保持与源码一致的中英文对照。
- 若代码演进导致本文档失效，优先更新本 design-doc，再同步各派生文档。

---

## 附录

- 文档索引：`docs/README.md`
- 系统架构详述：`docs/architecture.md`
- 模块文档：`docs/modules/`
- 术语表：`docs/appendix/glossary.md`
- 开发者 FAQ：`docs/appendix/faq-dev.md`
