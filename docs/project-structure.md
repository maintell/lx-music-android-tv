# 工程结构总览（Project Structure）

> 读者可从中获得什么：快速建立全仓文件地图——根目录每个文件的职责、`src/` 各目录的边界（与设计文档 3.2 节对齐）、四个页面的布局组织方式，以及播放核心 / 音乐源 / 同步客户端等典型代码的落点，拿到任务后能直接定位到正确的文件。
>
> 前置阅读：[docs/design-doc.md](./design-doc.md)（本文件是其 §3 的展开）。

---

## 1. 根目录文件速查

| 文件/目录 | 职责 |
|-----------|------|
| `package.json` | 项目元信息、脚本、依赖；**版本号/版本码唯一来源**（`version` + `versionCode`，构建时被 gradle 读取） |
| `index.js` | JS 入口：`import './shim'` → `import './src/app'` |
| `shim.js` | 注入 `global.Buffer`（Node Buffer polyfill） |
| `app.json` | RN 应用名（`LX Music` / `洛雪音乐助手`） |
| `src/` | 全部业务源码（见 §2） |
| `babel.config.js` | Babel 转译 + `babel-plugin-module-resolver`（`@/` → `src/`） |
| `tsconfig.json` | TypeScript 配置，`paths` 与 Babel 别名同步 |
| `metro.config.js` | Metro 打包配置（`buffer` 指向 `@craftzdog/react-native-buffer`） |
| `.eslintrc.cjs` | ESLint 配置（standard + TS 覆盖，见 code-style） |
| `.nvmrc` | Node 版本（`v18`），CI 按此安装 |
| `.editorconfig` | 编辑器统一风格 |
| `.ncurc.js` | `npm-check-updates` 忽略配置 |
| `Gemfile` | iOS 遗留 CocoaPods 配置（**Android 开发可忽略**） |
| `dependencies-patch.js` | 安装后修补依赖源码的脚本（patch 列表当前为空） |
| `android/` | Android 原生工程（`app/build.gradle` 读 package.json 的版本/签名，`gradle.properties` 定义 ABI/Hermes 等） |
| `ios/` | 历史遗留目录，**官方不支持 iOS**，勿投入 |
| `.github/` | CI：`workflows/`（release / beta-pack / build-test / publish-version-info）+ `actions/`（setup、upload-artifact）+ `ISSUE_TEMPLATE/` |
| `publish/` | 发布脚本与版本信息（`index.js`、`version.json`、`changeLog.md`） |
| `CHANGELOG.md` | 版本更新日志（Keep a Changelog 格式） |
| `README.md` | 项目说明（注意：其中「Redux」描述已过时，以代码为准） |
| `FAQ.md` / `LICENSE` / `test.js` | 常见问题 / Apache-2.0 许可 / 测试残留文件 |
| `docs/` | 开发者文档体系（本文档所在，顶层为 `design-doc.md`） |

## 2. src/ 目录职责速查

与 design-doc §3.2 一致：

| 目录 | 职责 |
|------|------|
| `src/screens/` | 页面级组件：Home / PlayDetail / SonglistDetail / Comment（见 §3） |
| `src/components/` | 通用 UI（`common/`）与业务组件（`player/`、`OnlineList/`、`MusicAddModal/`、`MetadataEditModal/`、`SearchTipList/` 等） |
| `src/navigation/` | RNN 屏幕注册（`registerScreens.tsx`）、屏幕名常量（`screenNames.ts`）、导航封装/hooks、弹窗组件（`components/` 下 `VersionModal` 等） |
| `src/store/` | 按领域拆分的轻量状态（`<域>/{state,action,hook}.ts`）+ Provider；领域：common、dislikeList、hotSearch、leaderboard、list、player、search、setting、songlist、sync、theme、userApi、version |
| `src/core/` | 业务逻辑核心：播放、列表、歌词、主题、同步、版本、搜索、排行榜、歌单、不喜欢列表、用户源、深链（`init/` 为启动初始化管道） |
| `src/plugins/` | 能力适配：`player/`（TrackPlayer 封装）、`sync/`（同步客户端）、`storage.ts`、`lyric.ts` |
| `src/utils/` | 工具集：`musicSdk/`（多源 SDK）、`hooks/`、`nativeModules/`、`fs.ts`、`request.js`、`log.ts`、`bootLog.ts`、`errorHandle.ts` 等 |
| `src/event/` | 事件总线实现与类型化接口（`Event.ts` 基类 + `stateEvent` / `appEvent` / `listEvent` / `dislikeEvent`） |
| `src/config/` | 设置 schema 与默认值（`defaultSetting.ts`）、常量（`constant.ts`，含 `storageDataPrefix`）、全局数据（`globalData.ts`）、迁移（`migrateSetting.ts` / `migrate.ts`） |
| `src/lang/` | i18n：语言包 `zh-cn.json`（fallback）/ `zh-tw.json` / `en-us.json` + 运行时（`i18n.ts` / `index.ts`） |
| `src/theme/` | 主题引擎：`Colors.js` / `Typography.js` / `index.js` 样式入口 + `themes/`（主题定义与 `createThemes.js` 生成脚本） |
| `src/types/` | 全局类型声明（`LX.*` 命名空间、`declare global`），按领域分 `.d.ts` 文件 |
| `src/resources/` | 静态资源：`fonts/`、`images/`、`medias/`（含占位音频） |

### 2.1 分层与依赖方向

```
screens / components / navigation
        ↓ store hooks 订阅事件 / 调用 core
core + store（业务核心层）
        ↓ 调用插件适配层
plugins + utils（musicSdk / sync / storage / fs / request…）
        ↓ 原生能力
react-native 核心 + 原生模块 + AsyncStorage
```

依赖方向**自上而下**：screens/components → core → plugins/utils → 平台；`store/<域>/state.ts` 是上下两层共享的契约层；跨模块异步事件统一走 `global.*_event` 总线（design-doc §3.3）。

### 2.2 core 模块职责速查

| 模块 | 主要文件 | 职责 |
|------|----------|------|
| 播放 | `core/player/`（`player.ts`、`playedList.ts`、`tempPlayList.ts`、`timeoutExit.ts`…） | 播放控制、播放列表状态机、定时退出、URL 获取与重试 |
| 我的列表 | `core/list.ts` | 列表增删改查、歌曲管理、导入导出、存储恢复 |
| 歌词 | `core/lyric.ts` | 歌词获取/解析/进度映射/偏移/翻译合并/S2T |
| 主题 | `core/theme.ts` | 亮/暗/跟随系统切换、动态背景、字体阴影 |
| 同步 | `core/sync.ts` | 同步状态管理、同步模式选择 |
| 版本 | `core/version.ts` | 版本信息获取、更新检查、忽略版本、下载进度 |
| 搜索 | `core/search/`（`music.ts`、`search.ts`、`songlist.ts`） | 音乐/歌单搜索、搜索历史 |
| 排行榜 | `core/leaderboard.ts` | 各源排行榜 |
| 歌单 | `core/songlist.ts` | 在线歌单详情 |
| 不喜欢列表 | `core/dislikeList.ts` | 全局不喜欢过滤（含同步） |
| 音源切换 | `core/apiSource.ts` | 内置源/自定义源切换与失败回退 |
| 自定义音源 | `core/userApi.ts` | 用户脚本加载与执行 |
| 深链 | `core/init/deeplink/` | 文件/音乐/播放器/歌单 action 分发 |
| 启动初始化 | `core/init/`（`index.ts`、`dataInit.ts`、`player/`、`userApi/`…） | design-doc §3.4.1 初始化管道 |

### 2.3 扩展点落点（新增功能去哪改）

| 想做什么 | 落点 | 参考 |
|----------|------|------|
| 新增音乐源 | `src/utils/musicSdk/<源>/` 实现统一能力 + 在 `musicSdk/index.js` 注册 | design-doc §5.2 / §7 |
| 新增页面 | `src/screens/<Page>/` + `navigation/registerScreens.tsx` 注册 + `navigation/screenNames.ts` 声明名称 | design-doc §7 |
| 新增领域状态 | `src/store/<域>/{state,action,hook}.ts` | design-doc §3.4.2 |
| 新事件 | 在对应总线子类加类型化方法 + `app.d.ts` 暴露 `on/off` | design-doc §3.4.3 |
| 新主题 | `src/theme/themes/` 添加定义后 `npm run build:theme` | design-doc §7 |
| 新语言 | `src/lang/` 加语言包 + `index.ts` 注册 | design-doc §6.3 |

## 3. screens 页面清单

| 页面 | 目录 | 布局 | 说明 |
|------|------|------|------|
| 首页 | `src/screens/Home/` | `Horizontal/` + `Vertical/` 双布局 | `Views/` 下挂 6 个 Tab 视图：Download / Leaderboard / Mylist / Search / Setting / SongList |
| 播放详情 | `src/screens/PlayDetail/` | `Horizontal/` + `Vertical/` 双布局 | `Vertical/Player/` 为竖屏播放器，`components/SettingPopup/` 为播放页设置弹层 |
| 歌单详情 | `src/screens/SonglistDetail/` | 单布局 | `ActionBar.tsx` / `Header.tsx` / `MusicList.tsx` |
| 评论 | `src/screens/Comment/` | 单布局 | `CommentHot.tsx`（热门评论）+ `CommentNew.tsx`（最新评论） |

> 屏幕名常量见 `src/navigation/screenNames.ts`（`lxm.HomeScreen` / `lxm.PlayDetailScreen` / `lxm.SonglistDetailScreen` / `lxm.CommentScreen` / `lxm.VersionModal` / `lxm.PactModal` / `lxm.SyncModeModal`），注册在 `registerScreens.tsx`。新增页面需同时改这两处（design-doc §7 扩展点）。

## 4. 典型文件路径示例

| 关注点 | 路径 |
|--------|------|
| 播放业务核心（切歌/重试/超时决策） | `src/core/player/player.ts`、`src/core/player/playedList.ts`、`src/core/player/tempPlayList.ts`、`src/core/player/timeoutExit.ts` |
| 播放器初始化恢复 | `src/core/init/player/`（`index.ts`、`playInfo.ts`、`playProgress.ts`、`preloadNextMusic.ts` 等） |
| TrackPlayer 封装（setup / service / 队列） | `src/plugins/player/`（`index.ts`、`service.ts`、`playList.ts`、`utils.ts`） |
| 音乐源 SDK（多源抽象） | `src/utils/musicSdk/`（`kw` / `kg` / `tx` / `wy` / `mg` / `bd`(停用)），能力如 `musicSearch` / `lyric.js` / `songList.js` |
| 自定义音源（user_api） | `src/core/userApi.ts`、`src/core/init/userApi/`、`src/utils/nativeModules/userApi.ts` |
| 音源切换 | `src/core/apiSource.ts`（`setApiSource`） |
| 我的列表 | `src/core/list.ts` + `src/store/list/`（`state/action/hook.ts`） |
| 数据同步客户端 | `src/plugins/sync/client/`（`auth.ts`、`client.ts`、`modules/{list,dislike}/`）+ `src/core/sync.ts` |
| 歌词 | `src/core/lyric.ts`、`src/plugins/lyric.ts`、`musicSdk/<源>/lyric.js` |
| 主题 | `src/core/theme.ts`、`src/theme/`（`Colors.js`、`themes/createThemes.js`） |
| 存储封装（分片） | `src/plugins/storage.ts`、key 前缀 `src/config/constant.ts` |
| 事件总线 | `src/event/`（`Event.ts` 基类 + 4 个类型化总线） |
| 启动初始化管道 | `src/app.ts` → `src/core/init/index.ts`（initSetting → … → initSync） |
| 版本检查 | `src/core/version.ts`、`src/store/version/`、`src/navigation/components/VersionModal.tsx` |

### 4.1 utils 常用工具速查

| 文件 | 用途 |
|------|------|
| `utils/musicSdk/` | 多源音乐 SDK（`kw` / `kg` / `tx` / `wy` / `mg` / `bd`(停用)） |
| `utils/nativeModules/` | 原生模块桥接：`utils.ts`（exitApp 等）、`userApi.ts`、`lyricDesktop.ts`、`cryptoTest` 等 |
| `utils/request.js` | 网络请求封装 |
| `utils/fs.ts` | 文件系统操作 |
| `utils/log.ts` / `bootLog.ts` / `errorHandle.ts` | 日志 / 启动日志 / 全局错误兜底 |
| `utils/tools.ts` | 通用工具（含 `tipDialog`，启动失败兜底依赖它） |
| `utils/hooks/` | 自定义 React hooks |
| `utils/windowSizeTools.ts` | 窗口尺寸工具（启动时初始化） |

### 4.2 navigation 目录速查

| 文件 | 职责 |
|------|------|
| `navigation/index.ts` | 导航初始化入口（供 `src/app.ts` 调用） |
| `navigation/registerScreens.tsx` | RNN 屏幕注册（含自研 store Provider 包装） |
| `navigation/screenNames.ts` | 屏幕名称常量（`lxm.HomeScreen` 等） |
| `navigation/navigation.ts` | RNN 原生导航栈封装（pushHomeScreen 等） |
| `navigation/regLaunchedEvent.ts` | App 启动事件监听（`listenLaunchEvent`） |
| `navigation/hooks.ts` / `event.ts` / `utils.ts` | 导航 hooks / 事件 / 工具 |
| `navigation/components/` | 弹窗组件：`VersionModal`（版本更新）、`PactModal`（协议）、`SyncModeModal`（同步模式）等 |

## 5. 相关文档

- 设计文档（架构与模块边界）：[./design-doc.md](./design-doc.md)
- 开发环境：[./getting-started.md](./getting-started.md)
- 代码规范：[./code-style.md](./code-style.md)
- 贡献指南：[./contributing.md](./contributing.md)
- 构建与发布：[./build-and-release.md](./build-and-release.md)
