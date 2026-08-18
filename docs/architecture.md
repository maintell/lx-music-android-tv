# LX Music 移动版 — 系统架构文档（Architecture）

> 本文档是 [design-doc.md](./design-doc.md) 第 3 章「系统架构」的**详细展开**，与设计文档保持一致并做更深入的论证。若二者冲突，以 design-doc 为准。
>
> - 文档版本：1.0
> - 适用范围：`lx-music-mobile` 源码（v1.8.4，versionCode 76）
> - 目标读者：贡献者 / 二次开发者 / 维护者

阅读本文档后，你将获得：

1. 一张完整的**分层地图**：UI → 核心 → 插件/工具 → 平台的依赖方向与数据流走向，知道「改一个功能应该动哪个目录」。
2. 四条关键运行机制的**实现级细节**：启动初始化管道、store 三件套状态管理、4 条事件总线、react-native-navigation 导航体系，均附真实文件路径与函数/事件名，可直接对照源码阅读。
3. 一条**端到端数据流实例**（播放一首歌）与模块边界约束，用于在改动时判断「这里该直接 import、该发事件、还是该改 store」。

---

## 1. 架构总览

### 1.1 分层图

```
┌──────────────────────────────────────────────────────────────────┐
│  UI 层                                                             │
│  src/screens（Home / PlayDetail / SonglistDetail / Comment）        │
│  src/components（common/ 通用组件、player/ 业务组件）                │
│  src/navigation（RNN 屏幕注册与导航封装）                            │
└───────────────────────┬──────────────────────────────────────────┘
                        │ ① 通过 store/hook 订阅状态、调用 action
                        │ ② 通过 core 导出函数发起业务动作
                        │ ③ 监听 global.*_event 被动刷新
┌───────────────────────▼──────────────────────────────────────────┐
│  业务核心层                                                       │
│  src/core：player / music / list / lyric / theme / sync / version │
│            / search / leaderboard / songlist / dislikeList /      │
│            userApi / apiSource / common                           │
│  src/store：按领域拆分的 state + action + hook（共享契约层）        │
└───────────────────────┬──────────────────────────────────────────┘
                        │ 函数导入协作 + 事件总线异步回调
┌───────────────────────▼──────────────────────────────────────────┐
│  插件适配层                                                       │
│  src/plugins：player(TrackPlayer) / sync(同步客户端) / storage     │
│               / lyric                                             │
│  src/utils：musicSdk(多源) / fs / request / nativeModules / log    │
│             / bootLog / data / listManage                         │
└───────────────────────┬──────────────────────────────────────────┘
                        │ 原生能力调用
┌───────────────────────▼──────────────────────────────────────────┐
│  平台层                                                           │
│  react-native 0.73 / react-native-navigation / react-native-track │
│  -player（原生 playback service）/ AsyncStorage / 自定义原生模块    │
└──────────────────────────────────────────────────────────────────┘
```

### 1.2 数据流总则

- **下行**（调用）：UI → core → plugins/utils → 平台，全部为**函数导入**，方向单一、不允许反向 import。
- **上行**（通知）：平台 → plugins → core → UI 一律通过**事件总线**（`global.state_event` / `global.app_event` 等）异步回流，解耦生产方与消费方。
- **旁路共享**：跨模块的运行时数据放在 `global.lx`（`src/config/globalData.ts` 实例化、`src/types/app.d.ts` 声明类型）；领域状态放在 `store/<domain>/state.ts` 单例，`state.ts` 被上下两层共同引用，是唯一的共享契约层。

### 1.3 一次「点击播放」的宏观路径（细节见第 8 章）

```
UI 点击歌曲
  → core/player/player.ts（业务决策：取 URL、重试、切歌）
  → core/music（区分在线/下载/本地，分发到 musicSdk 或文件系统）
  → plugins/player/playList.ts（构建 Track 并交予 TrackPlayer）
  → TrackPlayer 原生播放
  → service.ts 原生事件回调 → app_event 回流
  → core 更新 store/player/state → state_event 广播
  → UI hooks 重新渲染
```

---

## 2. 启动与初始化管道

### 2.1 入口链路

`index.js`（仅 `import './shim'` 与 `import './src/app'`）→ `src/app.ts`。

`src/app.ts` 的顶层 import 顺序本身就是初始化的一部分：

```ts
import '@/utils/errorHandle'   // ① 最先：注册 JS/原生异常兜底（setJSExceptionHandler）
import { init as initLog } from '@/utils/log'
import { bootLog, getBootLog } from '@/utils/bootLog'
import '@/config/globalData'    // ② 实例化 global.lx 与 4 条事件总线（副作用导入）
```

之后立即执行：

1. `listenLaunchEvent()`（`src/navigation/regLaunchedEvent.ts`）：提前注册 RNN 的 `registerAppLaunchedListener`，把回调存入 handlers 数组——保证在原生 launch 事件到达前已就位。
2. `Promise.all([getFontSize(), windowSizeTools.init()])`：并行加载字体缩放与窗口尺寸工具，成功后写入 `global.lx.fontSize` 并 `bootLog`。
3. 动态 `import('@/navigation')` 拿到 `init` 与 `navigations`，调用 `initNavigation(callback)`。

### 2.2 初始化时序

```
app.ts
 │  listenLaunchEvent()                      // 注册 launch 监听
 │  Promise.all([getFontSize, windowSizeTools.init])
 │    └→ global.lx.fontSize = font; bootLog
 │  import('@/navigation') → init(callback)
 │    ├→ registerScreens()                   // 注册 7 个屏幕
 │    ├→ Navigation.setDefaultOptions
 │    ├→ registerScreenPoppedListener(removeComponentId)
 │    └→ onAppLaunched(callback)             // 等原生 launch
 ▼
callback：
 │  handleInit()
 │    ├→ initLog()
 │    ├→ import('@/core/init') → init()      // 初始化管道（见下）
 │    └→ 返回 handlePushedHomeScreen
 │  navigations.pushHomeScreen()             // Navigation.setRoot
 │    └→ handlePushedHomeScreen()            // 首帧后：检查更新 / 深链 / 协议弹窗
 ▼
init() 管道（src/core/init/index.ts），每步成功即 bootLog：
  commonActions.setFontSize            // 把字号写入 common store
  initSetting()                        // core/common → config/setting → store/setting
  initTheme(setting)                   // 应用主题 + 订阅系统深浅色变化
  initI18n(setting)                    // 创建 global.i18n，缺省语言回退设备语言
  initUserApi(setting)                 // 加载自定义音源脚本
  setApiSource(setting['common.apiSource'])  // 设定内置/自定义源
  registerPlaybackService()            // 注册 TrackPlayer 后台 playback service
  initPlayer(setting)                  // 播放器初始化（见 2.4）
  dataInit(setting)                    // 恢复列表/不喜欢/上次视图（见 2.5）
  initCommonState(setting)             // 动态背景图预取
  void initSync(setting)               // 同步为可选项，fire-and-forget
```

> 注意 `initSync` 是 `void` 调用：同步失败不影响其余初始化与主流程（design-doc 2.2「低侵入同步」）。

### 2.3 失败兜底（bootLog 对话框）

- 启动日志由 `src/utils/bootLog.ts` 实现：模块级数组环形缓冲，`bootLog(...)` 追加、`getBootLog()` 拼接返回，无外部依赖。
- `app.ts` 中 `handleInit` 的 try/catch：任一步抛错 → `tipDialog`（`src/utils/tools.ts`）弹出「初始化失败 (Init Failed)」，展示完整 bootLog + 错误堆栈，用户点 Exit 后 `exitApp()`（原生退出）。
- `pushHomeScreen` 失败同样走 `tipDialog` 后退出。
- 若 `getFontSize/windowSizeTools.init` 本身失败，最外层 `.catch` 兜底。
- 运行期 JS 异常由 `errorHandle.ts` 的 `setJSExceptionHandler` 处理（仅非 development 环境生效），fatal 错误弹 Alert 并写日志。

> design-doc 风险清单第 9 条：`tipDialog` 在失败兜底中承担关键作用，改动 `tools.ts` 需回归验证启动失败路径。

### 2.4 initPlayer 内部（src/core/init/player/index.ts）

按序执行 8 个子初始化，均在 `core/init/player/` 下：

| 文件 | 职责 |
|------|------|
| `player.ts` | 订阅 `app_event` 的 play/pause/error/stop/playerEnded/picUpdated 等，映射为播放状态与切歌行为 |
| `lyric.ts` | 歌词初始化 |
| `playInfo.ts` | 恢复 `playMusicInfo` / `playInfo` 播放位置状态 |
| `playStatus.ts` | 播放状态（isPlay/statusText）初始化 |
| `playerEvent.ts` | 播放器事件订阅 |
| `watchList.ts` | 监听列表变更联动播放 |
| `playProgress.ts` | 播放进度定时同步 |
| `preloadNextMusic.ts` | 下一曲预加载 |

### 2.5 dataInit 内部（src/core/init/dataInit.ts）

- `void musicSdkInit()`：初始化各内置源的 `init()`（`src/utils/musicSdk/index.js` 的 `init` 导出，对每个 source 执行其 `init`）。
- `setUserList(await getUserLists())`：从本地存储恢复用户列表到 `store/list/state`。
- `setDislikeInfo(await getDislikeInfo())`：恢复不喜欢列表。
- `setNavActiveId((await getViewPrevState()).id)`：恢复上次停留的底部导航。
- `void unlink(TEMP_FILE_PATH)`：清理临时文件目录。

### 2.6 handlePushedHomeScreen（首帧后）

- 先 `cheatTip()`（开发者提示）。
- 已同意协议：首次进入时 `void checkUpdate()`（`core/version.ts`）与 `void initDeeplink()`（`core/init/deeplink/`）。
- 未同意协议：`showPactModal()`（`core/common.ts` → `navigation` 弹窗）。

---

## 3. 状态管理机制详解

### 3.1 为什么不用 Redux（ADR-2 论证）

design-doc ADR-2 的完整论证：

1. **样板代码与心智成本**：Redux 需要 action type 常量、reducer、selector、dispatch 包装层层拼接，而本项目绝大多数「状态变更」只需「改一个单例对象 + 通知订阅者」两步。
2. **与导航体系不匹配**：RNN 每个屏幕是独立注册的原生组件（见第 5 章），不共享 React 组件树根部；Redux Provider 需要挂在所有屏幕之上，而自研 store 的 state 是**模块级单例**，天然全局可达，不依赖组件树。
3. **事件驱动已足够**：本项目 UI 更新本质是「某领域状态变化 → 相关组件重渲染」。事件总线（ADR-3）天然承载这一语义，Redux 的 connect/mapStateToProps 反而是多余的中间层。
4. **历史沿革**：`src/store/Provider/Provider.tsx` 中保留了整段被注释的 react-redux Provider 代码（`Provider store={store}`），README 也仍提到 Redux——**这是历史残留，实际代码已完全脱离 Redux**（design-doc 风险第 1、3 条）。贡献者不要被注释代码误导。

### 3.2 store 三件套范式

每个领域一个目录 `src/store/<domain>/`，三个文件各司其职：

| 文件 | 职责 | 消费方 |
|------|------|--------|
| `state.ts` | 领域状态**唯一数据源**：导出 `InitState` 类型 + 单例 `state` 对象 | 上下两层都读 |
| `action.ts` | 修改 state 的纯操作函数；修改后调用 `global.state_event.xxx()` 广播 | core / UI 写路径 |
| `hook.ts` | React hooks：`useState(state.xxx)` 初始化 + `useEffect` 订阅 `state_event`，返回响应式值 | 仅 UI 层 |

**读写规则**：

```
写：core 或 UI → action.ts 函数 → 改 state 单例 → state_event.emit
读（非 UI）：core 直接 import state 读取
读（UI）：组件 → hook.ts → useState(初始值) + 订阅 state_event
```

### 3.3 实例：store/list（元数据）

`src/store/list/state.ts` 维护：

- `defaultList` / `loveList` / `tempList` / `userList` / `allList`：列表元数据（歌曲本体不在此，存于 `core/list` 的 `allMusicList`）。
- `activeListId`：当前激活列表。
- `fetchingListStatus`：各列表拉取状态。

`src/store/list/action.ts` 的典型实现：

```ts
setUserLists(userList) {
  state.userList = userList
  state.allList = [state.defaultList, state.loveList, ...state.userList]
  global.state_event.mylistUpdated(state.allList)   // 改完即广播
}
setActiveList(activeListId) {
  state.activeListId = activeListId
  global.state_event.mylistToggled(activeListId)
}
```

`src/store/list/hook.ts` 的典型实现（`useMyList`）：

```ts
const [lists, setList] = useState(state.allList)
useEffect(() => {
  global.state_event.on('mylistUpdated', setList)      // 订阅
  global.state_event.on('configUpdated', handleConfigUpdate) // 语言切换时重命名内置列表
  return () => {
    global.state_event.off('mylistUpdated', setList)   // 卸载必退订
    global.state_event.off('configUpdated', handleConfigUpdate)
  }
}, [])
return lists
```

要点：

- **hook 必须成对退订**：所有 hook 的 `useEffect` 返回值都调用 `off`，避免屏幕反复 push/pop 后事件泄漏。
- **跨总线订阅**：`useMusicList` 同时订阅 `state_event.mylistToggled` 与 `app_event.myListMusicUpdate`（后者由 `listEvent.ts` 的 `checkUpdateList` 发出）——说明「状态变更」与「列表内容变更」分属不同总线，UI 按需订阅。
- **懒加载歌曲**：`useMusicList` 不在 store 里存歌曲数组，而是在事件回调中 `getListMusics(activeListId)`（`core/list.ts`）异步拉取后 `setList([...list])`，保证 `state.ts` 不持有大体积数据。

### 3.4 Provider 包装方式

- `src/store/Provider/index.ts` 只有一行：`export { default as Provider } from './ThemeProvider'`。
- `ThemeProvider.tsx`：一个 `memo` 组件，持有 `themeState.theme` 的本地副本，订阅 `state_event.themeUpdated` 后 `requestAnimationFrame(() => setTheme(theme))`，通过 `ThemeContext.Provider`（`store/theme/state.ts`）下发主题。
- `src/store/Provider/Provider.tsx` **已废弃**：整文件是被注释的 react-redux Provider，**不要修改也不要删除**（design-doc 风险第 3 条）。
- 每个屏幕注册时被 `WrappedComponent` 包一层 Provider（见 5.2），保证任意屏幕内都能 `useContext(ThemeContext)` 取主题。

> 注意：这里 Provider 只提供**主题**。其他领域状态不依赖 Context，靠「模块单例 + 事件订阅」即可，这正是 3.1 论证的设计后果。

---

## 4. 事件总线体系

### 4.1 Event 基类（src/event/Event.ts）

```ts
export default class Event {
  listeners: Map<string, Array<(...args: any[]) => any>>
  on(eventName, listener)   // 追加监听
  off(eventName, listener)  // 按引用移除
  offAll(eventName)         // 移除某事件全部监听
  emit(eventName, ...args)  // setImmediate 异步分发
}
```

关键设计：**`emit` 用 `setImmediate` 异步执行**。调用 `emit` 立即返回，监听器在下一次事件循环批量执行。这带来两个性质：

1. 生产者不必关心当前是否有监听者、监听者执行多久；
2. 同一 tick 内的多次 emit 不会产生同步重入（例如 state 被连续修改时，UI 在下一 tick 统一重渲染）。

基类只提供 `string` 事件的通用实现，类型安全由子类补齐。

### 4.2 类型化契约机制（Omit 技巧）

以 `src/event/stateEvent.ts` 为例：

```ts
export class StateEvent extends Event {
  configUpdated(keys, setting) { this.emit('configUpdated', keys, setting) }
  playStateChanged(state)      { this.emit('playStateChanged', state) }
  // ...其余触发方法
}

type EventMethods = Omit<EventType, keyof Event>

declare class EventType extends StateEvent {
  on<K extends keyof EventMethods>(event: K, listener: EventMethods[K]): any
  off<K extends keyof EventMethods>(event: K, listener: EventMethods[K]): any
}

export type StateEventTypes = Omit<EventType, keyof Omit<Event, 'on' | 'off'>>
export const createStateEventHub = (): StateEventTypes => new StateEvent()
```

机制拆解：

1. 子类把每个事件声明为**带类型参数的触发方法**（`emit` 的封装），同时它自己就是「参数签名」；
2. `declare class EventType` 用映射类型把 `on/off` 重载为 `on<事件名>(事件名, 对应监听器)`——编译期强制事件名与参数类型匹配；
3. `*EventTypes` 剔除 Event 基类方法后，就是挂在 `global` 上的对外类型。

**消费端收益**：`global.state_event.on('playStateChanged', (isPlay) => ...)` 中 `isPlay` 自动推断为 `PlayerState['isPlay']`；写错事件名或参数类型直接编译报错。

### 4.3 四条总线一览

在 `src/config/globalData.ts` 末尾实例化并挂到 `global`：

| 总线 | 挂载点 | 语义 | 触发者 → 消费方 |
|------|--------|------|-----------------|
| `state_event` | `global.state_event` | 领域状态变更通知 | store/action 或 core → UI hooks / 其他 core |
| `app_event` | `global.app_event` | 应用/播放器行为事件 | core、plugins/player/service → core、UI |
| `list_event` | `global.list_event` | 列表内部变更事件（含同步远端操作） | core/list 与 plugins/sync → plugins/sync、core |
| `dislike_event` | `global.dislike_event` | 不喜欢列表变更事件 | core/dislikeList 与 plugins/sync → plugins/sync、core |

### 4.4 state_event 典型事件清单（src/event/stateEvent.ts）

| 类别 | 事件名 | 参数 |
|------|--------|------|
| 设置/外观 | `configUpdated` | `(keys, setting)` |
| | `languageChanged` | `(locale)` |
| | `fontSizeUpdated` | `(size)` |
| | `statusbarHeightUpdated` | `(size)` |
| | `apiSourceUpdated` | `(apiId)` |
| | `themeUpdated` | `(theme)` |
| | `bgPicUpdated` | `(bgPic)` |
| 播放 | `playerMusicInfoChanged` | `(musicInfo)` |
| | `playMusicInfoChanged` | `(playMusicInfo)` |
| | `playInfoChanged` | `(playInfo)` |
| | `playStateTextChanged` | `(text)` |
| | `playStateChanged` | `(isPlay)` |
| | `playProgressChanged` | `(progress)` |
| | `playPlayedListChanged` | `(playedList)` |
| | `playTempPlayListChanged` | `(tempPlayList)` |
| 列表 | `mylistUpdated` | `(lists)` |
| | `mylistToggled` | `(id)` |
| | `fetchingListStatusUpdated` | `(status)` |
| 其他 | `syncStatusUpdated` / `versionInfoUpdated` / `versionInfoIgnoreVersionUpdated` / `versionDownloadProgressUpdated` / `componentIdsUpdated` / `navActiveIdUpdated` / `sourceNamesUpdated` | 对应状态类型 |

### 4.5 app_event 典型事件清单（src/event/appEvent.ts）

- **播放器行为**：`play` / `pause` / `stop` / `error`、`setProgress(progress, maxPlayTime?)`、`setVolume`、`setVolumeIsMute`。
- **播放器原始状态（service.ts 回流）**：`playerPlaying` / `playerPause` / `playerEnded` / `playerError` / `playerLoadstart` / `playerEmptied` / `playerWaiting`。
- **内容更新**：`picUpdated` / `lyricUpdated` / `lyricOffsetUpdate` / `musicInfoUpdate` / `myListMusicUpdate(ids)` / `downloadListUpdate`。
- **界面联动**：`focus` / `musicToggled` / `changeMenuVisible` / `jumpListPosition` / `changeLoveListVisible` / `searchTypeChanged` / `showSonglistTagList` / `hideSonglistTagList` / `songlistTagInfoChange` / `selectSyncMode`。

> ⚠️ 源码怪癖（请人工核对）：`AppEvent.mylistToggled(id)` 内部 `this.emit('listToggled', id)`——事件名与 `state_event.mylistToggled` 不同。当前未见监听 `'listToggled'` 的代码，疑似历史遗留；改动前先 `grep "listToggled"`。

### 4.6 list_event / dislike_event（同步专用）

- `ListEvent`（`src/event/listEvent.ts`）声明了 12 个动作：`list_data_overwrite`、`list_create`、`list_remove`、`list_update`、`list_update_position`、`list_music_overwrite`、`list_music_add`、`list_music_move`、`list_music_remove`、`list_music_update`、`list_music_clear`、`list_music_update_position`，每个都带 `isRemote` 标志区分本地/远端操作。
- `DislikeEvent`（`src/event/dislikeEvent.ts`）：`dislike_changed`、`dislike_data_overwrite`、`dislike_music_add`、`dislike_music_clear`。
- 消费方是 `src/plugins/sync/listEvent.ts` 与 `dislikeEvent.ts`：它们 `on` 这些事件把本地变更发给同步服务器，同时远端消息又通过**同一批方法**（`isRemote=true`）回灌本地，形成闭环（`src/plugins/sync/client/modules/index.ts` 为远端分发入口，design-doc 风险第 7 条）。

### 4.7 全局挂载与类型声明

- 挂载：`src/config/globalData.ts` 末尾 `global.app_event = createAppEventHub()` 等 4 行，以及 `global.lx = {...}`。
- 类型：`src/types/app.d.ts` 的 `declare global` 声明了 `lx`、`i18n`、`app_event`、`list_event`、`dislike_event`、`state_event`、`isDev`、`Buffer`——这就是「任意模块可直接使用 `global.state_event` 且有类型提示」的原因。
- 顺带一提：`globalData.ts` 在无 `process.versions` 时注入 `{ app: version }`（取 `package.json` 的 version），供运行期读取应用版本。

---

## 5. 导航体系（react-native-navigation）

### 5.1 为什么是 RNN（ADR-1）

- RNN 使用**原生导航栈**（UINavigationController / Android Fragment/Activity 栈），屏幕切换不经过 JS 线程布局，性能优于 React Navigation 的纯 JS 栈；项目自始沿用。
- 代价：每个屏幕是**独立注册的原生组件**，不共享一个 React 根组件树——这直接影响了 Provider 包装方式（见 3.4）与事件驱动的状态订阅（见 3.1）。

### 5.2 屏幕注册（src/navigation/registerScreens.tsx）

```tsx
function WrappedComponent(Component) {
  return function inject(props) {
    const EnhancedComponent = () => (
      <Provider>          // 自研 store 的 ThemeProvider（index.ts 导出）
        <Component {...props} />
      </Provider>
    )
    return <EnhancedComponent />
  }
}

Navigation.registerComponent(HOME_SCREEN, () => WrappedComponent(Home))
Navigation.registerComponent(PLAY_DETAIL_SCREEN, () => WrappedComponent(PlayDetail))
// ...SONGLIST_DETAIL / COMMENT / VERSION_MODAL / PACT_MODAL / SYNC_MODE_MODAL
```

每个屏幕都被 `WrappedComponent` 包一层 `Provider`，保证主题 Context 可用。屏幕名称常量在 `src/navigation/screenNames.ts`（`lxm.*` 前缀），**新增页面三步**：`src/screens/` 建页面 → `registerScreens.tsx` 注册 → `screenNames.ts` 声明名称（design-doc 7 扩展点）。

### 5.3 导航封装（src/navigation/navigation.ts）

| 函数 | 操作 | 备注 |
|------|------|------|
| `pushHomeScreen` | `Navigation.setRoot` 推入首页 stack | 首页隐藏 topBar、状态栏 drawBehind |
| `pushPlayDetailScreen(componentId, skipAnimation?)` | push 播放详情 | 共享元素转场（`NAV_SHEAR_NATIVE_IDS.playDetail_pic`） |
| `pushSonglistDetailScreen(componentId, info)` | push 歌单详情 | 传 `passProps: { info }` |
| `pushCommentScreen(componentId)` | push 评论页 | 平移转场 |

所有 push 都包在 `requestAnimationFrame` 中，转场动画使用 `themeState.theme` 的当前主题色（说明导航层直接读 store 单例）。

### 5.4 启动与生命周期挂钩（src/navigation/index.ts + regLaunchedEvent.ts）

- `navigation/index.ts` 的 `init(callback)`：`registerScreens()` → `setDefaultOptions` → 注册 `registerScreenPoppedListener`（pop 后 `removeComponentId(componentId)` 清理 common store 中的组件 id）→ `onAppLaunched(callback)`。
- `regLaunchedEvent.ts`：维护 `handlers` 数组与 `launched` 标志。`listenLaunchEvent` 提前注册原生 launch 监听；`onAppLaunched` 若已 launch 则立即 `setImmediate` 执行。**这一抽象解决了「原生 launch 事件先于 JS 侧注册到达」的竞态**——app.ts 第 12 行就调用 `listenLaunchEvent()`，而 callback 注册发生在动态 import 之后。
- `navigation/index.ts` 同时 `export * from './utils' / './event' / './hooks'`，其中 `showPactModal` 被 `core/common.ts` 引用——**core 通过函数导入使用导航能力**（弹协议框），方向仍为 UI 层被 core 调用。

---

## 6. 全局运行时对象 global.lx

### 6.1 与类型声明的关系

- 实例：`src/config/globalData.ts`（`global.lx = {...}`）。
- 类型：`src/types/app.d.ts` 中 `interface GlobalData`，随后 `declare global { var lx: GlobalData }`。
- 规则：**新增字段必须两处同步**（实例 + 类型），否则 TS 编译报错。实例中被注释的字段（如 `windowInfo`、`syncKeyInfo`）说明已废弃，类型里同步注释。

### 6.2 字段速查表

| 字段 | 类型 | 含义 | 写入方（示例） |
|------|------|------|-----------------|
| `fontSize` | `number` | 全局字体缩放倍数 | `app.ts`（`getFontSize()` 后） |
| `playerStatus` | `{ isInitialized, isRegisteredService, isIniting }` | 播放器初始化/服务注册状态 | `plugins/player/index.ts` 的 `initial` |
| `restorePlayInfo` | `LX.Player.SavedPlayInfo \| null` | 上次播放恢复信息 | `core/player/playInfo` |
| `isScreenKeepAwake` | `boolean` | 屏幕常亮开关 | 播放详情/设置 |
| `isPlayedStop` | `boolean` | 是否播放完后退出（定时退出） | `core/player/player.ts` 的 `togglePlay` |
| `isEnableSyncLog` | `boolean` | 同步日志开关 | `core/sync.ts` |
| `isEnableUserApiLog` | `boolean` | 用户源日志开关 | 设置 |
| `playerTrackId` | `string` | 当前 Track 的 id（供 `isEmpty`/`isTempId` 判断） | `service.ts` 的 `PlaybackTrackChanged` |
| `gettingUrlId` | `string` | 正在获取 URL 的歌曲去重 id | `core/player/player.ts` 的 `setMusicUrl` |
| `qualityList` | `LX.QualityList` | 当前源支持的音质表 | `core/apiSource.ts` 的 `setApiSource` |
| `apis` | `Partial<LX.UserApi.UserApiSources>` | user_api 脚本注册的源能力 | `core/userApi.ts` |
| `apiInitPromise` | `[Promise<boolean>, boolean, fn]` | 音源初始化去重（并发切换防竞态） | `core/apiSource.ts` |
| `jumpMyListPosition` | `boolean` | 跳转我的列表位置标记 | `appEvent.jumpListPosition` |
| `settingActiveId` | `SettingScreenIds` | 设置页当前活动分区 | 设置页 |
| `homePagerIdle` | `boolean` | 首页是否空闲滚动（防误触播放） | 首页 |

### 6.3 典型用途

- **去重**：`gettingUrlId` 由 `createGettingUrlId(musicInfo)` 生成（`core/player/player.ts`），`diffCurrentMusicInfo` 用它判断「用户是否已切歌」——URL 异步返回时若已切歌则丢弃，避免旧歌覆盖新歌。
- **防重入**：`apiInitPromise` 是一个「promise + 标志 + resolve 回调」三元组，`setApiSource` 用它串行化内置源/自定义源的初始化，防止连续切换源时竞态。
- **后台可用**：`playerStatus` / `playerTrackId` 供**播放服务**（原生后台进程）读取——后台服务无法访问 React store，但可以读 `global`。

---

## 7. 播放链路架构

### 7.1 分工原则（ADR-8 的实现）

```
┌─────────────────────────────────────────────────────────────┐
│ core/player/（业务大脑，JS 主线程）                           │
│ player.ts   播放控制、切歌决策、URL 获取/延迟重试/超时         │
│ playInfo.ts 播放位置状态（playMusicInfo / playInfo）          │
│ playedList.ts 已播放列表     tempPlayList.ts 稍后播放队列     │
│ playStatus.ts 状态文本/isPlay      preloadNextMusic.ts 预加载 │
└──────────────────────────┬──────────────────────────────────┘
                           │ 函数导入（playList.ts / utils.ts）
┌──────────────────────────▼──────────────────────────────────┐
│ plugins/player/（原生执行，TrackPlayer 封装）                 │
│ index.ts    initial：setupPlayer + 缓存迁移 + 音量/倍速       │
│ playList.ts 构建 Track、队列管理、元数据更新                   │
│ utils.ts    setResource/setPlay/setPause/seek/音量/销毁       │
│ service.ts  后台 playback service：原生事件 → app_event 回流   │
└──────────────────────────┬──────────────────────────────────┘
                           │ 原生播放
┌──────────────────────────▼──────────────────────────────────┐
│ TrackPlayer（fork 版，后台音频会话）                           │
└─────────────────────────────────────────────────────────────┘
```

设计要点（design-doc 5.1 展开）：

1. **播放服务与 UI 完全解耦**：播放决策（何时切歌、失败是否重试、超时退出）全部在 `core/player`；`plugins/player/service.ts` **只做事件翻译**——把 TrackPlayer 的原生事件转成 `app_event`，不做任何业务判断。service.ts 中被注释的大段旧重试/切歌逻辑即历史遗留（design-doc 风险第 2 条），其行为已由 core/player 承担。
2. **core/player 通过 app_event 感知原生状态**：`core/init/player/player.ts` 订阅 `app_event` 的 `play/pause/error/stop/playerEnded/picUpdated` 等，把「播放器发生了什么」翻译为「业务状态与下一步动作」。例如 `playerEnded → handleEnded → playNext(true)`（自动切下一首）。
3. **UI 状态与原生状态分离**：`store/player/state.ts` 的 `isPlay` 由 `playerEnded/play` 事件驱动（playStatus 模块），UI 订阅 `state_event.playStateChanged` 刷新按钮；绝不直接从 TrackPlayer 轮询。

### 7.2 事件回流时序（原生 → app_event）

```
TrackPlayer 原生事件                service.ts 映射                    core 消费
─────────────────────────────     ────────────────────────          ───────────────────
RemotePlay (通知栏/蓝牙/耳机)   →   play()                →   setPlayStatus → isPlay=true
RemotePause                   →   void pause()           →   setPauseStatus
RemoteNext                    →   void playNext()        →   切歌流程
RemotePrevious                →   void playPrev()        →   上一曲流程
RemoteStop                    →   handleExitApp('Remote Stop') → exitApp()
RemoteSeek(position)          →   app_event.setProgress(position)
PlaybackError(err)            →   app_event.error() + playerError()
PlaybackState:
  Playing                    →   app_event.playerPlaying() + play()
  Paused/Ready/Stopped       →   app_event.playerPause() + pause()
  Buffering                  →   app_event.pause() + playerWaiting()
  Connecting                 →   app_event.playerLoadstart()
PlaybackTrackChanged         →   global.lx.playerTrackId = getCurrentTrackId()
                                → 若 isEmpty()：pause + playerPause/pause/
                                   playerEnded/playerEmptied
```

`core/init/player/player.ts` 中对应的订阅：

```ts
global.app_event.on('play', setPlayStatus)        // setIsPlay(true)
global.app_event.on('pause', setPauseStatus)      // setIsPlay(false)
global.app_event.on('error', setPauseStatus)
global.app_event.on('stop', setStopStatus)        // setStop() + 清状态文本
global.app_event.on('playerEnded', handleEnded)   // playNext(true) 或结束文本
global.app_event.on('picUpdated', updatePic)      // 通知栏封面
global.state_event.on('configUpdated', handleConfigUpdated) // 切歌方式变化联动 playedList
```

### 7.3 播放器初始化（plugins/player/index.ts `initial`）

- 防重入：`global.lx.playerStatus.isIniting || isInitialized` 双标志。
- 流程：`migratePlayerCache()`（缓存目录迁移）→ `TrackPlayer.setupPlayer({ maxCacheSize, maxBuffer: 1000, waitForBuffer: true, handleAudioFocus, audioOffload, autoUpdateMetadata: false })` → 置 `isInitialized` → `updateOptions()` → `setVolume` → `setPlaybackRate`。
- 惰性触发：`core/player/player.ts` 的 `handlePlay` 在首次播放时才调用 `playerInitial`（顺带检查通知权限与电池优化）。

---

## 8. 数据流示例：播放一首歌

场景：用户在我的列表中点击第 `index` 首歌。以下时序图各步骤均对应真实函数。

```
 UI 组件（我的列表，store/list/hook.ts 渲染）
 │  onPress → core/player/player.ts: playList(listId, index)
 ▼
 playList()                                     // core/player/player.ts:289
 │  setPlayListId(listId)                       // core/player/playInfo
 │  setPlayMusicInfo(listId, getList(listId)[index])
 │  clearPlayedList() / clearTempPlayeList()    // 按设置与列表切换清理
 │  await handlePlay()                          // :229
 ▼
 handlePlay()
 │  未初始化? → playerInitial({volume, playRate, cacheSize, ...})  // plugins/player/index.ts
 │  global.lx.isPlayedStop &&= false
 │  await setStop()                             // plugins/player/utils.ts:160
 │  global.app_event.pause()                    // 通知 UI 先切到暂停态
 │  debouncePlay(musicInfo)                     // 200ms 防抖（快速切歌去抖）
 ▼
 debouncePlay → setMusicUrl(musicInfo)          // core/player/player.ts:135
 │  global.lx.gettingUrlId = createGettingUrlId(musicInfo)  // 去重
 │  void getMusicPlayUrl(musicInfo)             // :96
 │     ├─ setStatusText('正在获取播放链接')       // store/player → state_event.playStateTextChanged
 │     ├─ addLoadTimeout()                      // 100s 加载超时 → playNext
 │     └─ getMusicUrl({musicInfo, onToggleSource})   // core/music/index.ts:22
 │           │ 在线 → core/music/online.ts → musicSdk[源].getMusicUrl(...) → 返回 URL
 │           │ 本地 → core/music/local.ts（文件路径）
 │           │ 下载 → core/music/download.ts
 │           失败 → ① 404/5xx → getMusicPlayUrl(..., isRetryed=true) 重试一次
 │                 ② tooManyRequests → delayRetry（随机 2-6s 后重试）
 │                 ③ 返回 null / 已切歌 → 丢弃
 │  .then(url) → setResource(musicInfo, url, nowPlayTime)   // plugins/player/utils.ts:153
 ▼
 setResource → playList.ts: handlePlayMusic(musicInfo, url, time)
 │  buildTracks()                               // 构造 Track（id/url/title/artist/artwork/musicId/lyric）
 │  TrackPlayer.reset() → TrackPlayer.add(tracks)
 │  TrackPlayer.play()                          // 原生开始播放
 ▼
 TrackPlayer 原生状态变化
 │  PlaybackState=Playing → service.ts → global.app_event.playerPlaying() + play()
 ▼
 core/init/player/player.ts
 │  setPlayStatus → setIsPlay(true) → store/player/state.isPlay = true
 │  → store/player/action 广播 state_event.playStateChanged(true)
 ▼
 UI hooks（播放条/播放详情）
 │  usePlayState 等订阅 state_event.playStateChanged → setState(true) → 重新渲染
 │
 └── 并行：debouncePlay 中 getPicPath → app_event.picUpdated → 封面更新
            getLyricInfo → app_event.lyricUpdated → 歌词更新
            PlaybackTrackChanged → playerTrackId 更新 → 通知栏/进度对齐
```

要点回顾：

- **整个链路 UI 只发起一次 `playList` 调用**，之后 UI 的每次刷新都来自事件回流，无轮询、无全局 setState。
- **错误与重试全在 core**：UI 不感知 URL 获取失败细节，只看到 `state_event.playStateTextChanged` 的状态文本（「正在获取播放链接」「链接获取失败，将在 n 秒后重试」）。
- **防呆**：`diffCurrentMusicInfo` + `gettingUrlId` 保证异步结果回来时若用户已切歌则整体丢弃；`isPlayedStop` 保证定时退出场景下不再继续切歌。

---

## 9. 模块依赖规则与边界约束

### 9.1 依赖方向（必须遵守）

```
screens / components / navigation
        │ import（向下允许）
        ▼
core ──────► store（state 单例是共享契约，上下都可引用）
        │ import
        ▼
plugins / utils
        │ import
        ▼
react-native / 原生模块
```

**禁止**：UI 层直接 import 原生模块/plugins 深层实现；core 反向 import screens；plugins 反向 import core（例外：`service.ts` 回调 core 的 `play/pause/playNext` 属**事件驱动的函数回调**，属于允许的协作方式——实际代码中 `core/player/player` 被 `service.ts` import，这是刻意为之的「服务回调业务」，注意保持该方向不变）。

### 9.2 跨模块通信两条规则

1. **同步协作走函数导入**：core 调 plugins（`setResource`、`getMusicUrl`）、core 调 core（`list → player`）都是直接 import。
2. **异步通知走事件总线**：凡是「A 改了状态，B/C/D 需要知道」的场景，一律 `global.*_event` 广播，禁止 A 直接 import B/C/D 去调用。典型：
   - 列表变化 → `state_event.mylistUpdated` + `app_event.myListMusicUpdate`（下载、播放、UI 各自订阅）。
   - 播放器原生状态 → `app_event.*`（core 播放状态机、歌词、UI 订阅）。
   - 列表/不喜欢变更（本地或远端）→ `list_event.*` / `dislike_event.*`（同步客户端订阅后推给服务器）。

### 9.3 store 是共享契约层

- `store/<domain>/state.ts` 是**唯一数据源**：任何模块不得再声明一份「领域状态副本」，只允许读它、经 action 改它。
- 两个例外层面的本地副本是允许的：UI 组件用 `useState` 持有**渲染快照**（hook.ts 的标准做法）；`ThemeProvider` 持有主题副本（因为要放进 Context）。
- 新增领域状态：在 `store/` 下建 `<domain>/` 三件套，并在 `stateEvent.ts` 增加对应事件方法；不得绕过事件直接改 UI。

### 9.4 global.lx 的使用边界

- 只放**跨模块运行期数据**（去重 id、初始化状态、开关标志），不放领域业务状态（那是 store 的职责），不放大体积数据（列表/歌曲在 core/list 的 `allMusicList` 与 AsyncStorage）。
- 新增字段必须同步 `globalData.ts` 实例与 `app.d.ts` 类型（见 6.1）。

### 9.5 改动时的自查清单

1. 要改的模块在分层图中属于哪一层？引用了下层之外的模块吗？
2. 状态变更要通知谁？确认走 `state_event`（状态）、`app_event`（行为）、还是 `list_event`/`dislike_event`（同步数据），不要发明新总线或直接 import 消费方。
3. 读 state 时用的是 `store/<domain>/state.ts` 单例还是 UI hook？core 里不要用 hook。
4. 新增事件时，在对应 `src/event/*.ts` 子类加触发方法 + 类型（Omit 机制自动导出类型），不要裸 `emit('随便字符串')`。
5. 新增页面：`screens` 建页 + `registerScreens.tsx` 注册 + `screenNames.ts` 声明，不要用 React Navigation。
6. 新增 `global.lx` 字段：实例 + 类型两处。

---

## 附录：相关文档

- 设计依据：`docs/design-doc.md`（本文档与之一致，冲突以 design-doc 为准）
- 模块详述：`docs/modules/`
- 术语表：`docs/appendix/glossary.md`
- 文档索引：`docs/README.md`
