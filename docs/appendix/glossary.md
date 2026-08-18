# 术语表（Glossary）

> 面向贡献者/开发者的中英对照术语速查。技术名词以源码为准；**LX.** 开头的类型均来自全局类型声明（`src/types/*.d.ts` 的 `declare namespace LX`）。源码中的英文术语保持原文，中文为对照解释。

## 全局命名空间 LX.*

| 术语 | 类型位置 | 含义 |
|------|----------|------|
| `LX.Music.MusicInfo` | `types/music.d.ts` | 音乐信息联合类型（在线/本地，按 source 判别） |
| `LX.Music.MusicInfoOnline` | `types/music.d.ts` | 在线音乐信息（kw/wy 公共、kg、tx、mg 四类） |
| `LX.Music.MusicInfoLocal` | `types/music.d.ts` | 本地音乐信息（`meta.filePath`/`ext`） |
| `LX.Music.LyricInfo` | `types/music.d.ts` | 歌词信息 `{ lyric, tlyric?, rlyric?, lxlyric? }` |
| `LX.List.*` | `types/list.d.ts` | 列表相关类型（MyAllList、ListDataFull、ListAction* 等） |
| `LX.Player.*` | `types/player.d.ts` | 播放相关类型（PlayMusicInfo、PlayInfo、Track、SavedPlayInfo 等） |
| `LX.AppSetting` | `types/app_setting.d.ts` | 应用设置 schema（扁平点分式键） |
| `LX.Quality` | `types/common.d.ts` | 音质枚举：128k / 320k / flac / wav 等 |
| `LX.OnlineSource` / `LX.Source` | `types/common.d.ts` | 音乐源 id 类型（kw/kg/tx/wy/mg/…） |
| `LX.Download.*` | `types/download_list.d.ts` | 下载列表相关类型 |
| `LX.Sync.*` | `types/sync*.d.ts` | 数据同步相关类型 |
| `LX.Theme` / `LX.ActiveTheme` | `types/theme.d.ts` | 主题定义 / 激活主题 |
| `LX.Dislike.*` | `types/dislike_list*.d.ts` | 不喜欢列表相关类型 |
| `LX.UserApi.*` | `types/user_api.d.ts` | 自定义音源（user_api）相关类型 |
| `LX.GlobalData` | `types/app.d.ts` | `global.lx` 全局运行时对象类型 |

## 核心概念

| 术语 | 含义 | 备注 |
|------|------|------|
| **apiSource** | 当前激活的音乐源 id（设置键 `common.apiSource`） | `core/apiSource.ts` 的 `setApiSource` 负责切换 |
| **musicSdk** | 多音乐源的统一抽象模块 | `src/utils/musicSdk/` |
| **user_api（自定义源/用户源）** | 用户导入的脚本型音源，id 以 `user_api` 前缀标识 | `core/userApi.ts`、`core/init/userApi/` |
| **内置源** | kw(酷我)、kg(酷狗)、tx(QQ)、wy(网易云)、mg(咪咕)、xm | `musicSdk/index.js` 的 `sources.sources` 列表 |
| **toggleMusicInfo** | `MusicInfoMetaBase` 上的可选字段，用于跨源替换播放（移动端当前无写入点，见 player 文档疑点） | `types/music.d.ts` |
| **playedList** | 已播放列表（播放历史，供切歌/恢复用） | `core/player/playedList.ts` |
| **tempPlayList** | 稍后播放队列（临时播放列表） | `core/player/tempPlayList.ts` |
| **playInfo** | 播放位置状态 `{ playIndex, playerListId, playerPlayIndex }` | `store/player/state.ts` |
| **playMusicInfo** | 当前播放歌曲信息 `{ musicInfo, listId, isTempPlay }` | `store/player/state.ts` |
| **我的列表** | default（试听列表）/ love（我的收藏）/ temp（临时列表）/ userList（用户自建） | `types/list.d.ts`、`core/list.ts` |
| **LIST_IDS** | 内置列表 id 常量：DEFAULT/LOVE/TEMP/DOWNLOAD | `config/constant.ts` |
| **storageDataPrefix** | 存储 key 前缀表（setting/list/lyric/musicUrl 等） | `config/constant.ts` |
| **state_event** | 状态变更事件总线（`global.state_event`） | `event/stateEvent.ts` |
| **app_event** | 应用/播放器行为事件总线（`global.app_event`） | `event/appEvent.ts` |
| **list_event** | 列表动作事件总线（`global.list_event`） | `event/listEvent.ts` |
| **dislike_event** | 不喜欢列表事件总线（`global.dislike_event`） | `event/dislikeEvent.ts` |
| **store 三件套** | 每领域 `store/<域>/{state,action,hook}.ts` 的状态管理范式 | `docs/modules/state-management.md` |
| **RNN** | react-native-navigation（原生导航库） | `src/navigation/` |
| **TrackPlayer** | react-native-track-player（播放引擎） | `src/plugins/player/` |
| **bootLog** | 启动日志采集（初始化失败兜底输出） | `utils/bootLog.ts` |
| **deep link / 深链** | 通过 URL scheme 触发应用内动作 | `core/init/deeplink/` |
| **S2T** | 简体转繁体（设置 `player.isS2t`） | 见 i18n 文档 |
| **桌面歌词（desktopLyric）** | Android 悬浮窗歌词（`desktopLyric.*` 设置组） | `core/desktopLyric.ts`、`utils/nativeModules/lyricDesktop.ts` |
| **数据同步（sync）** | 与 lx-music-sync-server 的多端同步（`sync.enable` 开关） | `docs/modules/data-sync.md` |
| **qualityList** | 当前源的可用音质表（`global.lx.qualityList`） | `config/globalData.ts` |

## 设置键前缀（LX.AppSetting）

| 前缀 | 含义 | 示例 |
|------|------|------|
| `common.*` | 通用（语言、音源、主题跟随、界面基础） | `common.langId`、`common.apiSource` |
| `player.*` | 播放器（切歌模式、音质、音量、歌词显示） | `player.togglePlayMethod`、`player.playQuality` |
| `theme.*` | 主题（当前/亮/暗主题、动态背景、字体阴影） | `theme.id`、`theme.dynamicBg` |
| `playDetail.*` | 播放详情页（歌词对齐、字号） | `playDetail.style.align` |
| `desktopLyric.*` | 桌面歌词（开关、位置、字号、颜色） | `desktopLyric.enable` |
| `search.*` | 搜索（热词/历史显示） | `search.isShowHotSearch` |
| `list.*` | 列表（显示列、添加位置、滚动恢复） | `list.addMusicLocationType` |
| `download.*` | 下载（文件命名） | `download.fileName` |
| `sync.*` | 数据同步 | `sync.enable` |

> 完整 schema 见 `src/types/app_setting.d.ts`，默认值见 `src/config/defaultSetting.ts`。

## 常用缩写

| 缩写 | 全称 / 含义 |
|------|-------------|
| kw | 酷我音乐 |
| kg | 酷狗音乐 |
| tx | QQ 音乐（腾讯） |
| wy | 网易云音乐 |
| mg | 咪咕音乐 |
| xm | 虾米音乐（stub，未启用） |
| bd | 百度音乐（已注释停用） |
| lrc / tlyric / rlyric / lxlyric | 原词 / 翻译 / 罗马音 / 逐字歌词 |
| S2T / T2S | 简体→繁体 / 繁体→简体 |
| ABI | Android 二进制接口（arm64-v8a / armeabi-v7a / x86_64 / x86） |
| versionCode | Android 版本码（package.json `versionCode`，用于升级判断） |
