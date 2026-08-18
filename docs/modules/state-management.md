# 状态管理机制详解（store / event 总线）

> 读者对象：需要新增领域状态、调试 UI 不刷新、或理解"三件套范式"的贡献者。
> 读完本文你将掌握：`state.ts / action.ts / hook.ts` 三个文件的职责与写法、`state_event` 总线的类型化广播方式、Provider 的注入原理，以及新增一个领域状态的完整步骤。
> 对应设计依据：[design-doc §3.4.2 状态管理机制](./../design-doc.md)、[§3.4.3 事件总线](./../design-doc.md)、ADR-2（自研轻量状态管理）、ADR-3（全局事件总线）。

---

## 1. 总体思路

项目**不使用 Redux**（`src/store/Provider/Provider.tsx` 中的 Redux Provider 已被整体注释，见 design-doc 风险清单第 3 条），而是自研了一套"**单例状态 + 事件总线**"的轻量方案，对应 design-doc ADR-2：

- **状态不放在 React 内部**，而是放在模块级单例对象（`state.ts`）里，任何 JS 代码（core / plugins / 组件）都能同步读到最新值。
- **修改必须经过 action**（`action.ts`），action 在改完 state 后通过全局事件总线（`global.state_event`）广播变更。
- **组件通过 hook**（`hook.ts`）订阅对应事件，把单例值"映射"为 React 响应式状态，驱动重渲染。

每个领域一个 `src/store/<domain>/` 目录，三个文件各司其职：

| 文件 | 职责 | 依赖方向 |
|------|------|----------|
| `state.ts` | 领域状态的唯一数据源（单例对象），`export default state` + 导出 `InitState` 类型 | 被 action / hook / core / 组件共同引用 |
| `action.ts` | 修改 state 的纯操作函数；修改后通过 `global.state_event` 广播 | 依赖 state |
| `hook.ts` | React hooks，订阅 `state_event`，将状态映射为组件可用的响应式值 | 依赖 state + 全局总线 |

分层上（对应 design-doc §3.3）：**UI 组件通过 hook 订阅**；**非 UI 逻辑（core / plugins）直接读 state 或调用 action**，不经过 hook。

---

## 2. 三件套范式详解

### 2.1 state.ts —— 状态单例

以 `src/store/list/state.ts` 为例：

```ts
import { LIST_IDS } from '@/config/constant'

export interface InitState {
  allMusicList: Map<string, LX.Music.MusicInfo[]>
  defaultList: LX.List.MyDefaultListInfo
  loveList: LX.List.MyLoveListInfo
  tempList: LX.List.MyTempListInfo
  userList: LX.List.UserListInfo[]
  activeListId: string
  allList: Array<LX.List.MyDefaultListInfo | LX.List.MyLoveListInfo | LX.List.UserListInfo>
  tempListMeta: { id: string }
  fetchingListStatus: Record<string, boolean>
}

const state: InitState = {
  allMusicList: new Map(),
  defaultList: { id: LIST_IDS.DEFAULT, name: '试听列表' },
  // ...
  activeListId: '',
  allList: [],
  // ...
}

state.allList = [state.defaultList, state.loveList]   // 模块加载时完成派生初始化

export default state
```

要点：

- **模块级单例**：`import state from './state'` 拿到的永远是同一个对象，跨模块共享。
- **`InitState` 接口与 `state` 对象并存**：接口描述形状，供 action 返回值、事件负载、hook 初值引用类型。
- 允许在模块加载时做一次**派生初始化**（如 `state.allList = [...]`），但不能有异步逻辑。
- 部分领域（`dislikeList`、`userApi`）采用命名导出 `export { state }` 而非 default 导出，写法略有差异，见 §5。

### 2.2 action.ts —— 修改并广播

以 `src/store/list/action.ts` 为例：

```ts
import state, { type InitState } from './state'

export default {
  setUserLists(userList: LX.List.UserListInfo[]) {
    state.userList = userList
    state.allList = [state.defaultList, state.loveList, ...state.userList]
    global.state_event.mylistUpdated(state.allList)   // ← 修改后广播
  },
  setActiveList(activeListId: string) {
    state.activeListId = activeListId
    global.state_event.mylistToggled(activeListId)
  },
  // ...
}
```

要点：

- **修改永远直接改 state 单例**，没有 immutable 拷贝要求；但广播的负载（payload）通常会拷贝一份快照，如 `{ ...state.progress }`、`{ ...state.componentIds }`，避免订阅方拿到引用后反写单例。
- **每个会改变 UI 可见状态的 action 都要广播**；只改内部辅助字段（如 `setTempListMeta`）可以不广播。
- 广播不是裸的 `emit('字符串')`，而是调用 `global.state_event` 上的**类型化方法**（见 §3），payload 类型由此得到编译期检查。
- 命名约定：`setXxx` / `addXxx` / `removeXxx` / `clearXxx` / `updateXxx`。

### 2.3 hook.ts —— 订阅并映射为响应式值

以 `src/store/player/hook.ts` 中最典型的 `useIsPlay` 为例：

```ts
import { useEffect, useState } from 'react'
import state, { type InitState } from './state'

export const useIsPlay = () => {
  const [value, update] = useState(state.isPlay)   // ① 以单例当前值为初始值

  useEffect(() => {
    global.state_event.on('playStateChanged', update)   // ② 订阅
    return () => {
      global.state_event.off('playStateChanged', update) // ③ 卸载清理
    }
  }, [])

  return value
}
```

三个关键设计：

1. **初始值来自单例**：`useState(state.isPlay)`。这相当于"天然的事件重放"——即使事件在组件挂载之前就已经广播过，组件挂载时也能拿到最新值，不需要额外的 replay 机制。design-doc §3.4.2 的"hook 订阅"即此模式。
2. **订阅/清理严格对称**：`useEffect` 返回函数里必须 `off` 同一个监听函数引用，否则组件卸载后事件仍会调用已卸载组件的 `setState`，造成泄漏与警告。
3. **按需选择性更新**：监听函数直接复用 `setState`（`on('playStateChanged', update)`），因此事件 payload 就是组件状态本身。payload 与状态形状不一致时，则包一层转换函数（见 `useListFetching`、`useSettingValue`）。

#### 进阶模式（同一文件内可见的变体）

| 模式 | 示例 | 说明 |
|------|------|------|
| 选择性过滤 | `useSettingValue(key)` | 监听 `configUpdated`，只有 `keys.includes(key)` 才 `update` |
| 初始拉取 | `useMusicList`（list/hook.ts） | 挂载时主动 `handleToggle(state.activeListId)` 拉取一次，之后靠事件增量更新 |
| 前后值比较 | `useListFetching` | 记录 `prevStatus`，事件值不变时不触发 `setState` |
| 活性节流 | `useProgress` | 用 `isActive()`（`@/utils/tools`）判断应用是否前台，后台时放弃更新 |
| 异步回填 | `useMusicExistsList` | 事件驱动之外，在 `useEffect` 里做一次异步查询（`getListMusics`） |
| 派生计算 | `useRuleNum`（dislikeList） | 事件只发"变了"的信号，组件自己从 state 计算数值 |

> ⚠️ 注意 `useMyList`（list/hook.ts）：它直接改写 `lists[0].name = global.i18n.t('list_name_default')`。由于 `state.allList[0]` 与 `state.defaultList` 是同一对象引用，这实际上**改写了 state 单例**，用于在 UI 层用 i18n 名称覆盖内置列表的硬编码中文名。这是现存代码的副作用行为，新增内置列表时需留意（见 §8 疑点）。

---

## 3. 事件总线：Event.ts 与 state_event

### 3.1 基类 `src/event/Event.ts`

自研迷你事件总线，**未使用 mitt**（import 被注释）：

```ts
export default class Event {
  listeners: Map<string, Array<(...args: any[]) => any>>

  on(eventName, listener)      // 追加监听
  off(eventName, listener)     // 按引用移除
  emit(eventName, ...args) {   // setImmediate 异步派发
    setImmediate(() => { for (const listener of targetListeners) listener(...args) })
  }
  offAll(eventName)            // 清空某事件的所有监听
}
```

`emit` 用 `setImmediate` 把派发推迟到当前同步代码执行完之后，保证"改完 state 再广播"的语义，且 action 内部连续多次广播不会出现同步重入。

### 3.2 类型化子类：`src/event/stateEvent.ts`

每个子类声明**带类型的触发方法**，方法名即事件名：

```ts
import Event from './Event'
import type { InitState as ListState } from '@/store/list/state'
// ...

export class StateEvent extends Event {
  mylistUpdated(lists: Array<LX.List.MyDefaultListInfo | LX.List.MyLoveListInfo | LX.List.UserListInfo>) {
    this.emit('mylistUpdated', lists)
  }
  playStateChanged(state: PlayerState['isPlay']) {
    this.emit('playStateChanged', state)
  }
  // ... 共约 25 个方法
}

type EventMethods = Omit<EventType, keyof Event>

declare class EventType extends StateEvent {
  on<K extends keyof EventMethods>(event: K, listener: EventMethods[K]): any
  off<K extends keyof EventMethods>(event: K, listener: EventMethods[K]): any
}

export type StateEventTypes = Omit<EventType, keyof Omit<Event, 'on' | 'off'>>
export const createStateEventHub = (): StateEventTypes => new StateEvent()
```

类型化订阅的"戏法"在尾部：`declare class EventType` 用泛型 `on<K extends keyof EventMethods>` 重声明了 `on/off` 签名，使 `global.state_event.on('playStateChanged', cb)` 在编译期能校验事件名与回调参数类型；`Omit<EventType, keyof Omit<Event, 'on'|'off'>>` 剥离基类的运行时方法，得到纯 `on/off` 类型面。

### 3.3 挂载到 global

`src/config/globalData.ts`（在 `app.ts` 中最早被 import）：

```ts
global.app_event = createAppEventHub()       // src/event/appEvent.ts
global.list_event = createListEventHub()     // src/event/listEvent.ts
global.dislike_event = createDislikeEventHub() // src/event/dislikeEvent.ts
global.state_event = createStateEventHub()   // src/event/stateEvent.ts
```

类型声明在 `src/types/app.d.ts`：

```ts
declare global {
  var state_event: StateEventTypes
  var app_event: AppEventTypes
  var list_event: ListEventTypes
  var dislike_event: DislikeEventTypes
  // ...
}
```

四个总线的语义分工（design-doc §3.4.3）：

| 总线 | 挂载点 | 语义 |
|------|--------|------|
| `state_event` | `global.state_event` | 领域状态变更通知（`mylistUpdated`、`playStateChanged`、`configUpdated`…） |
| `app_event` | `global.app_event` | 应用/播放器行为事件（`play`、`pause`、`myListMusicUpdate`、`selectSyncMode`…） |
| `list_event` | `global.list_event` | 列表内部变更动作（`list_music_add`、`list_remove`…），是"命令 + 完成广播"双通道 |
| `dislike_event` | `global.dislike_event` | 不喜欢列表变更动作 |

> 注意：`list_event` 与 `dislike_event` 不是"先改后广播"的纯通知，而是**动作通道**——调用它们会触发完整业务逻辑（修改、持久化、再广播），详见 [list-management.md](./list-management.md)。

---

## 4. 各领域 state 概览

| 领域 | state 文件 | 核心状态 | 关键 state_event | 备注 |
|------|-----------|----------|-----------------|------|
| list | `store/list/state.ts` | `defaultList`、`loveList`、`tempList`、`userList`、`activeListId`、`allList`、`fetchingListStatus` | `mylistUpdated`、`mylistToggled`、`fetchingListStatusUpdated` | 歌曲数组的**真实缓存**在 `utils/listManage.ts` 的 `allMusicList` Map（模块级）；state 中的 `allMusicList` 字段是未使用的遗留字段 |
| player | `store/player/state.ts` | `musicInfo`、`playMusicInfo`、`playInfo`、`isPlay`、`progress`、`playedList`、`tempPlayList`、`statusText`、`volume`、`playRate` | `playerMusicInfoChanged`、`playMusicInfoChanged`、`playInfoChanged`、`playStateChanged`、`playProgressChanged`、`playPlayedListChanged`、`playTempPlayListChanged`、`playStateTextChanged` | 播放器原始事件走 `app_event`（`playerPlaying` 等），业务状态走 `state_event`（ADR-8 播放逻辑与 UI 分离） |
| setting | `store/setting/state.ts` | `setting: LX.AppSetting`（全量扁平设置） | `configUpdated(keys, setting)` | 修改统一经 `core/common.ts updateSetting` → action → `src/config/setting.ts mergeSetting` 做差异合并，只广播实际变化的 key |
| theme | `store/theme/state.ts` | `theme: LX.ActiveTheme`、`shouldUseDarkColors`，另导出 `ThemeContext` | `themeUpdated` | 主题对象是一大张颜色表（`buildActiveThemeColors` 生成）；组件经 Context 读取（§6） |
| sync | `store/sync/state.ts` | `status`、`serverName`、`type`、`syncModeComponentId` | `syncStatusUpdated` | `type` 为 `'list' \| 'dislike'`，驱动 SyncModeModal 分支 |
| common | `store/common/state.ts` | `fontSize`、`statusbarHeight`、`componentIds`、`navActiveId`、`lastNavActiveId`、`sourceNames`、`bgPic` | `fontSizeUpdated`、`statusbarHeightUpdated`、`componentIdsUpdated`、`navActiveIdUpdated`、`sourceNamesUpdated`、`bgPicUpdated` | `fontSize` 初始化自 `global.lx.fontSize` |
| search | `store/search/state.ts` | `temp_source`、`searchType`、`searchText`、`tipListInfo`、`historyList` | 无（无广播） | 页面直接读写 state/action |
| search/music | `store/search/music/state.ts` | `searchText`、`source`、`sources`、`listInfos`（按源分页列表）、`maxPages` | 无 | `listInfos.all` 为聚合源结果 |
| search/songlist | `store/search/songlist/state.ts` | 同上（歌单搜索形态） | 无 | |
| songlist | `store/songlist/state.ts` | `sources`、`sortList`、`tags`、`listInfo`、`listDetailInfo` | 无 | 歌单广场/详情 |
| leaderboard | `store/leaderboard/state.ts` | `sources`、`boards`、`listDetailInfo` | 无 | |
| hotSearch | `store/hotSearch/state.ts` | `sources`、`sourceList`（按源热门词） | 无 | |
| dislikeList | `store/dislikeList/state.ts` | `dislikeInfo`（`names/musicNames/singerNames` 三个 Set + `rules`） | 无（域内局部 event `dislike_changed`） | 见 §5 |
| userApi | `store/userApi/state.ts` | `list`、`status`、`apis` | 无（域内局部 event `status_changed`/`list_changed`） | 见 §5 |
| version | `store/version/state.ts` | `showModal`、`versionInfo`（含 `status`）、`ignoreVersion`、`progress` | `versionInfoUpdated`、`versionInfoIgnoreVersionUpdated`、`versionDownloadProgressUpdated` | 驱动 VersionModal |

观察：**hook.ts 只存在于需要 UI 响应式更新的领域**（list / player / setting / theme / sync / common / version / dislikeList / userApi）。search / songlist / leaderboard / hotSearch 这类"页面持有型"状态没有 hook，页面组件直接 `import state` 读取、调用 action 写入（action 通常返回新列表供调用方直接使用，如 `setListInfo` 返回排序后的 `list`）。

---

## 5. 两种"广播出口"并存

主范式（绝大多数领域）：**action 调 `global.state_event` 的类型化方法**。

例外（`dislikeList`、`userApi`）：使用**域内局部事件实例**，且 action 为命名导出函数而非 default 对象：

```ts
// store/dislikeList/event.ts —— 独立的小型 Event 子类
export const event: DislikeEventTypes = new DislikeEvent()   // dislike_changed()

// store/dislikeList/action.ts —— 命名导出 + 局部事件
export const setDislikeInfo = (dislikeInfo: LX.Dislike.DislikeInfo) => {
  state.dislikeInfo.rules = dislikeInfo.rules
  // ...
  event.dislike_changed()   // 不经过 global.state_event
}

// store/dislikeList/hook.ts —— 订阅局部事件
event.on('dislike_changed', handleUpdate)
```

注意区分两个不同的 `dislike` 事件源：

- `store/dislikeList/event.ts`：**store 层的 UI 通知**（只有 `dislike_changed`），供 `useRuleNum` 等 hook 使用。
- `global.dislike_event`（`src/event/dislikeEvent.ts`）：**core 层的动作通道**（`dislike_music_add` / `dislike_data_overwrite` / `dislike_music_clear`），被 `core/dislikeList.ts` 调用、被 `plugins/sync/` 订阅。两者是不同实例。

`userApi` 域同理（`store/userApi/event.ts` 的 `status_changed` / `list_changed`）。

---

## 6. Provider 注入原理

`src/store/Provider/index.ts`：

```ts
export { default as Provider } from './ThemeProvider'
```

`ThemeProvider.tsx` 是唯一真正生效的 Provider：订阅 `state_event.themeUpdated`，把主题放进 `ThemeContext.Provider`：

```tsx
export default memo(({ children }) => {
  const [theme, setTheme] = useState(themeState.theme)

  useEffect(() => {
    const handleUpdateTheme = (theme: LX.ActiveTheme) => {
      requestAnimationFrame(() => setTheme(theme))
    }
    global.state_event.on('themeUpdated', handleUpdateTheme)
    return () => { global.state_event.off('themeUpdated', handleUpdateTheme) }
  }, [])

  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>
})
```

注入点在导航层 `src/navigation/registerScreens.tsx` 的 `WrappedComponent`：**每个注册屏幕都被 `<Provider>` 包一层**（详见 [navigation.md](./navigation.md) §4）。这意味着 ThemeContext 不是"应用级单一 Provider"，而是**每屏幕独立实例**——各屏幕通过共享的 `state_event.themeUpdated` 总线保持主题同步，这正是"事件驱动而非 Context 全局树"设计的一部分。

组件读取主题有两个途径：

- `useTheme()`（`store/theme/hook.ts`）：`useContext(ThemeContext)`，消费 Provider 注入的响应式主题。
- `useTextShadow()`：单独订阅 `configUpdated` 中 `theme.fontShadow` 键。

`src/store/Provider/Provider.tsx` 是废弃的 Redux Provider（整体注释），design-doc 风险清单第 3 条已说明，勿恢复使用。

---

## 7. 新增一个领域状态的完整步骤

以新增领域 `test`（例如"测试模式状态"）为例，**对照 store/list 从零实现**：

### 第 1 步：`src/store/test/state.ts`

```ts
export interface InitState {
  isEnabled: boolean
  count: number
}

const state: InitState = {
  isEnabled: false,
  count: 0,
}

export default state
```

### 第 2 步：`src/store/test/action.ts`

```ts
import state from './state'

export default {
  setEnabled(enabled: boolean) {
    state.isEnabled = enabled
    global.state_event.testEnabledUpdated(enabled)      // ← 事件名在下一步定义
  },
  setCount(count: number) {
    state.count = count
    global.state_event.testCountUpdated(count)
  },
}
```

### 第 3 步：在 `src/event/stateEvent.ts` 注册类型化广播

```ts
import type { InitState as TestState } from '@/store/test/state'
// ...
export class StateEvent extends Event {
  // ...现有方法
  testEnabledUpdated(enabled: boolean) { this.emit('testEnabledUpdated', enabled) }
  testCountUpdated(count: TestState['count']) { this.emit('testCountUpdated', count) }
}
```

### 第 4 步：`src/store/test/hook.ts`

```ts
import { useEffect, useState } from 'react'
import state, { type InitState } from './state'

export const useTestEnabled = () => {
  const [value, update] = useState(state.isEnabled)
  useEffect(() => {
    global.state_event.on('testEnabledUpdated', update)
    return () => { global.state_event.off('testEnabledUpdated', update) }
  }, [])
  return value
}
```

### 第 5 步：接入使用

- **core 逻辑**（如 `core/test.ts`）：`import testActions from '@/store/test/action'`，调用 `testActions.setCount(n)`；或直接 `import testState from '@/store/test/state'` 读取。
- **UI 组件**：`import { useTestEnabled } from '@/store/test/hook'`。

### 检查清单

- [ ] `InitState` 类型与默认值齐全，导出 default state
- [ ] action 修改后**至少广播一次**对应 `state_event` 方法
- [ ] `stateEvent.ts` 的 `StateEvent` 类新增了方法（事件名 = 方法名）
- [ ] hook 的 `on/off` 使用同一个监听函数引用，卸载必清理
- [ ] 若需要跨领域通知（如"test 变更后刷新列表"），在 `appEvent.ts` 的 `AppEvent` 类添加方法，而不是复用 `state_event`

---

## 8. 疑点与注意事项（需人工核对）

1. **`useMyList` 的写副作用**：`lists[0].name = global.i18n.t(...)` 直接改写了 state 单例中 `defaultList.name` / `loveList.name`（对象引用相同）。这是刻意为之的 i18n 覆盖，但语义上污染了单例；若新增内置列表，需同步处理该 hook。
2. **事件名无集中常量表**：`stateEvent.ts` 的方法名即事件名（字符串），`on('mylistUpdated')` 的字面量与类方法靠 `declare class EventType` 的泛型约束做编译期校验，但**emit 侧**不受约束，改事件名时需全局搜索字符串。
3. **`emit` 无参数校验**：`Event.emit` 是 `(...args: any[])`，类型安全完全依赖子类的方法包装，勿绕过 `global.state_event.xxx()` 直接 emit。
4. **两种广播出口并存**：`dislikeList` / `userApi` 用域内局部 event；其余领域用 `global.state_event`。新领域默认跟随主范式。
5. **`store/index.ts` 是空壳**：仅剩 `useGetter`（被遗留的 `Toast.js` 引用），属 Redux 迁移残留，勿作为入口使用。
6. **无 Redux DevTools**：状态变化只能通过日志或事件断点观察；调试 UI 不刷新时，优先检查"事件是否广播"与"hook 是否 off 过早"。
