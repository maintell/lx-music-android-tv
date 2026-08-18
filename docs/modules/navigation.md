# 导航体系（react-native-navigation）

> 读者对象：需要新增页面/弹窗、调试跳转失效、或理解启动到首页链路的贡献者。
> 读完本文你将掌握：RNN 屏幕注册与 `setRoot/push/showOverlay` 的用法、屏幕注册清单、`WrappedComponent` 的 Provider 注入、三个弹窗组件的注册与打开方式、导航封装与 hooks、屏幕弹出的 `componentId` 清理，以及深链（deeplink）与导航的衔接。
> 对应设计依据：[design-doc §2.3 ADR-1](./../design-doc.md)（RNN 而非 React Navigation）、[§3.4.1 启动流程](./../design-doc.md)、[§5.8 深链](./../design-doc.md)、[§7 扩展点"新页面"](./../design-doc.md)。

---

## 1. 技术选型与总体结构

项目使用 **react-native-navigation（RNN）7.39.2**，屏幕由**原生侧注册与托管**，不是 React Navigation 的 JS 栈（ADR-1）。导航相关代码全部位于 `src/navigation/`：

| 文件 | 职责 |
|------|------|
| `index.ts` | 导航初始化入口：注册屏幕、监听"屏幕弹出"事件、等待 app launched |
| `registerScreens.tsx` | 把 React 组件注册为原生屏幕（含 Provider 注入） |
| `screenNames.ts` | 屏幕名称常量（`'lxm.xxx'`） |
| `navigation.ts` | 跳转封装：`pushHomeScreen` / `pushPlayDetailScreen` / `pushSonglistDetailScreen` / `pushCommentScreen` |
| `utils.ts` | `pop` / `popToRoot` / `dismissOverlay` / 三个 modal 的打开函数 |
| `hooks.ts` | RNN 事件 hooks：`useNavigationCommandComplete` 等 |
| `event.ts` | `onModalDismissed` 一次性监听 |
| `regLaunchedEvent.ts` | app launched 监听与回调注册 |
| `components/` | `ModalContent` / `PactModal` / `SyncModeModal` / `VersionModal` / `Toast.js` |

启动衔接（design-doc §3.4.1）：`index.js` → `src/app.ts` 最先调用 `listenLaunchEvent()`，随后 `import('@/navigation')` 执行 `initNavigation(...)`，初始化完成后 `navigations.pushHomeScreen()` 推入首页。

启动到首页的完整时序（`src/app.ts` + `src/core/init/index.ts`）：

```
index.js
  └─> src/app.ts
        ├─ listenLaunchEvent()              // 注册 RNN appLaunched 监听（regLaunchedEvent.ts）
        ├─ Promise.all([getFontSize(), windowSizeTools.init()])
        │     └─> import('@/core/init') 懒加载初始化管道
        └─ import('@/navigation')
              └─ initNavigation(callback)
                    ├─ registerScreens()                    // 原生注册 7 个组件
                    ├─ registerScreenPoppedListener(removeComponentId)
                    └─ onAppLaunched(async () => {
                          await handleInit()                // 执行 core/init 管道（bootLog 逐步记录）
                          await navigations.pushHomeScreen() // setRoot 推入首页
                          void handlePushedHomeScreen()      // cheatTip → checkUpdate + initDeeplink | showPactModal
                       })
```

其中 `handlePushedHomeScreen`（`core/init/index.ts`）：先 `cheatTip()`（开发提示），再按 `common.isAgreePact` 分流——已同意则首次进入执行 `checkUpdate()`（`core/version`）与 `initDeeplink()`（`core/init/deeplink`）；未同意则 `showPactModal()` 弹出许可协议。任一步初始化抛错会弹带 bootLog 的失败对话框（`app.ts` 的 `tipDialog` 兜底）。

---

## 2. RNN 使用方式（原生注册）

### 2.1 初始化入口 `src/navigation/index.ts`

```ts
const init = (callback: () => void | Promise<void>) => {
  registerScreens()                     // ① 注册所有屏幕
  if (unRegisterEvent) unRegisterEvent.remove()
  Navigation.setDefaultOptions({})      // ② 全局默认选项
  unRegisterEvent = Navigation.events().registerScreenPoppedListener(({ componentId }) => {
    removeComponentId(componentId)      // ③ 屏幕被 pop 时清理 componentId 登记
  })
  onAppLaunched(() => { void callback() })  // ④ app launched 后执行回调
}
```

其中 `onAppLaunched` 来自 `regLaunchedEvent.ts`：`listenLaunchEvent()`（在 `app.ts` 最早调用）注册 RNN 的 `registerAppLaunchedListener`，把 `launched` 置 true 后派发所有已注册 handler；`onAppLaunched(handler)` 则允许**在 launch 事件之后**再注册回调（若已 launched 则立即执行）。

### 2.2 屏幕注册 `registerScreens.tsx`

RNN 的 `Navigation.registerComponent(名称, () => 组件工厂)` 完成原生注册，组件工厂返回 React 组件（每次原生创建该屏幕时调用）。见 §4。

### 2.3 常用命令

| RNN API | 用途 | 项目内封装 |
|---------|------|-----------|
| `Navigation.setRoot({ root })` | 设置根布局（首次进入首页） | `pushHomeScreen` |
| `Navigation.push(componentId, layout)` | 在当前栈上压入新屏 | `pushPlayDetailScreen` 等 |
| `Navigation.showOverlay({ component })` | 显示覆盖层（弹窗） | `showPactModal` 等 |
| `Navigation.dismissOverlay(componentId)` | 关闭覆盖层 | `dismissOverlay` |
| `Navigation.pop(componentId)` | 弹出当前屏 | `pop` |
| `Navigation.popToRoot(componentId)` / `popTo` | 弹回根/指定屏 | `popToRoot` / `popTo` |
| `Navigation.events().registerScreenPoppedListener(cb)` | 屏幕被 pop 事件 | `index.ts` |
| `Navigation.events().registerComponentListener(listener, componentId)` | 组件生命周期事件 | `hooks.ts` |

---

## 3. 屏幕注册清单

`src/navigation/screenNames.ts` 与 `registerScreens.tsx` 一一对应：

| screenName 常量 | 值 | 组件 | 说明 |
|-----------------|----|------|------|
| `HOME_SCREEN` | `'lxm.HomeScreen'` | `Home`（`@/screens`） | 主界面（搜索/歌单/排行/收藏/设置五个 tab），`setRoot` 的根屏幕 |
| `PLAY_DETAIL_SCREEN` | `'lxm.PlayDetailScreen'` | `PlayDetail` | 播放详情页，含横/竖屏双布局 |
| `SONGLIST_DETAIL_SCREEN` | `'lxm.SonglistDetailScreen'` | `SonglistDetail` | 在线歌单详情页 |
| `COMMENT_SCREEN` | `'lxm.CommentScreen'` | `Comment` | 歌曲评论区 |
| `VERSION_MODAL` | `'lxm.VersionModal'` | `VersionModal` | 版本更新弹窗（overlay） |
| `PACT_MODAL` | `'lxm.PactModal'` | `PactModal` | 许可协议弹窗（overlay） |
| `SYNC_MODE_MODAL` | `'lxm.SyncModeModal'` | `SyncModeModal` | 同步模式选择弹窗（overlay） |

> `SETTING_SCREEN`、`TOAST_SCREEN` 常量存在但被注释；`Setting` 页面未注册（作为 Home 内 tab 存在）。`Toast.js` 是 RNN 官方 demo 遗留，未在任何地方注册，勿依赖。

---

## 4. WrappedComponent 注入 Provider

`registerScreens.tsx` 中，所有屏幕都被 `WrappedComponent` 包裹：

```tsx
function WrappedComponent(Component: any) {
  return function inject(props: Record<string, any>) {
    const EnhancedComponent = () => (
      <Provider>
        <Component {...props} />
      </Provider>
    )
    return <EnhancedComponent />
  }
}

Navigation.registerComponent(HOME_SCREEN, () => WrappedComponent(Home))
// ...其余屏幕同理
```

作用：把自研 store 的 `Provider`（即 `ThemeProvider`，见 [state-management.md](./state-management.md) §6）注入每个原生屏幕，使屏幕内组件能通过 `useTheme()`（`ThemeContext`）拿到响应式主题。**每个屏幕实例拥有独立的 Provider**，屏幕间主题同步依赖 `state_event.themeUpdated` 总线，而非全局 Context 树。RNN 会把 `componentId`、`passProps` 等作为 props 传给被注册组件。

---

## 5. 导航封装 `src/navigation/navigation.ts`

所有跳转函数都从 `themeState.theme` 读取当前主题生成 `options`（状态栏样式 `getStatusBarStyle(theme.isDark)`、`navigationBar` / `layout.componentBackgroundColor` 随主题），并用 `requestAnimationFrame` 包裹后再执行。

| 函数 | 底层命令 | 要点 |
|------|---------|------|
| `pushHomeScreen()` | `setRoot` | 根布局为单屏 stack；`topBar` 隐藏 |
| `pushPlayDetailScreen(componentId, skipAnimation?)` | `push` | 共享元素动画：`fromId/toId = NAV_SHEAR_NATIVE_IDS.playDetail_pic`，元素过渡 `playDetail_header` / `playDetail_player` |
| `pushSonglistDetailScreen(componentId, info: ListInfoItem)` | `push` | `passProps: { info }`；共享元素 id 带列表 id 后缀 `${songlistDetail_pic}_from_${info.id}` / `_to_`，pop 时反向 |
| `pushCommentScreen(componentId)` | `push` | 平移过渡动画 |

共享元素/过渡动画的 id 常量在 `src/config/constant.ts`：

```ts
export enum NAV_SHEAR_NATIVE_IDS {
  playDetail_pic = 'playDetail_pic',
  playDetail_header = 'playDetail_header',
  playDetail_player = 'playDetail_player',
  songlistDetail_pic = 'songlistDetail_pic',
  songlistDetail_title = 'songlistDetail_title',
}
```

组件侧需要在对应视图上设置同名 `nativeID` 才能让共享元素动画生效（如播放页封面图、歌单封面）。

### 通用导航工具 `src/navigation/utils.ts`

```ts
export const getStatusBarStyle = (isDark: boolean) => isDark ? 'light' : 'dark'
export const dismissOverlay = async (compId: string) => Navigation.dismissOverlay(compId)
export const pop = async (compId: string) => Navigation.pop(compId)
export const popToRoot = async (compId: string) => Navigation.popToRoot(compId)
export const popTo = async (compId: string) => Navigation.popTo(compId)
export const showPactModal = () => { /* Navigation.showOverlay({ name: PACT_MODAL, ... }) */ }
export const showVersionModal = () => { /* ...VERSION_MODAL */ }
export const showSyncModeModal = () => { /* ...SYNC_MODE_MODAL */ }
```

三个 modal 打开函数的共同配置：`layout.componentBackgroundColor: 'transparent'` + `overlay.interceptTouchOutside: true`（点击遮罩外可关闭），状态栏透明。

---

## 6. 弹窗组件（overlay）

### 6.1 通用外壳 `ModalContent.tsx`

半透明遮罩（`rgba(50,50,50,.3)`）+ 圆角卡片 + 顶部主题色条，`children` 为弹窗内容。三个 modal 都以它为外壳。

### 6.2 `PactModal.tsx` —— 许可协议

打开方式：`showPactModal()`（`navigation/utils.ts`），在 `core/init/index.ts` 的 `handlePushedHomeScreen` 中，当 `common.isAgreePact` 为 false 时弹出（design-doc §3.4.1 第 4 步）。

流程要点：

- **未同意**：底部"接受"按钮带 20 秒倒计时（`useState(time)` + 定时器），倒计时结束才可点击；"不接受"调 `exitApp()` 退出应用。
- **同意**：`handleConfirm` 调 `updateSetting({ 'common.isAgreePact': true })`（`core/common.ts`）→ `Navigation.dismissOverlay(componentId)` → 2 秒后 `Alert` 提示免费开源 → 点击确认后执行 `checkUpdate()`（`core/version`）与 `initDeeplink()`（`core/init/deeplink`）。
- 已同意时仅显示"关闭"按钮。

### 6.3 `VersionModal.tsx` —— 版本更新

打开方式：`showVersionModal()`；关闭：`hideModal(componentId)`（`core/version.ts`，内部 `dismissOverlay`）。

状态驱动：`useVersionInfo()` / `useVersionDownloadProgressUpdated()` / `useVersionInfoIgnoreVersionUpdated()`（`store/version/hook`）。界面按 `versionInfo.status` 状态机渲染（对应 `store/version/state.ts` 的 `status: LX.UpdateStatus`）：

| status | 标题 | 确认按钮行为 |
|--------|------|-------------|
| `checking` | 检查中 | 无确认按钮 |
| `idle` / `error` | 发现新版本 / 检查失败 | `downloadUpdate()`（下载更新） |
| `downloading` | 下载中（显示进度/百分比） | 禁用 |
| `downloaded` | 可更新 | `updateApp()`（`@/utils/version`） |
| `isLatest` / `isUnknown`（非 status，独立标志） | 已是最新 / 未知 | 重新 `checkUpdate()` |

"忽略此版本"按钮调 `setIgnoreVersion(...)`（`store/version/action`）。

### 6.4 `SyncModeModal.tsx` —— 同步模式选择

打开方式：`showSyncModeModal()`，由 `core/sync.ts` 的 `selectSyncMode(serverName, type)` 调用。该函数是**一个返回 Promise 的完整流程**（`src/core/sync.ts`）：

```ts
export const selectSyncMode = async <T extends keyof LX.Sync.ModeTypes>(serverName: string, type: T) =>
  new Promise<LX.Sync.ModeTypes[T]>((resolve, reject) => {
    removeSyncModeEvent()
    syncActions.setServerInfo(serverName, type)   // store/sync：记录服务器名与类型
    showSyncModeModal()                            // 打开弹窗

    const handleSelectMode = ({ mode }: LX.Sync.ModeType) => {
      removeListeners()
      closeSyncModeModal()                         // dismissOverlay(syncModeComponentId)
      resolve(mode as LX.Sync.ModeTypes[T])        // 用户选择 → resolve
    }
    global.app_event.on('selectSyncMode', handleSelectMode)

    // 弹窗被关闭（如点遮罩外）→ reject('cancel')
    let removeListener = onModalDismissed(syncState.syncModeComponentId, () => {
      syncActions.setSyncModeComponentId('')
      removeEvent?.()
    })
  })
```

即：**弹窗只是 UI 载体，选择结果通过 `app_event.selectSyncMode` 事件回流到 `core/sync` 的 Promise**。`onModalDismissed`（`navigation/event.ts`）监听弹窗被关闭（遮罩外点击等），此时 reject 取消同步流程。弹窗组件自身在挂载时 `setSyncModeComponentId(componentId)`（`core/sync`）记录实例 id，供 `closeSyncModeModal` 关闭。

按钮映射：

```ts
global.app_event.selectSyncMode({ type: 'list', mode })       // ListModeModal
global.app_event.selectSyncMode({ type: 'dislike', mode })    // DislikeModeModal
```

`mode` 取值：`merge_local_remote` / `merge_remote_local` / `overwrite_local_remote` / `overwrite_remote_local` / `cancel`（勾选"覆盖时全量覆盖"后 `overwrite_*` 会附加 `_full` 后缀）。`plugins/sync/client/modules/{list,dislike}/handler.ts` 调用 `selectSyncMode` 取得模式后执行对应同步策略。

### 6.5 `Toast.js` —— 遗留 demo

RNN 官方示例遗留：使用已废弃的 `useGetter`（`store/index.ts` 空壳），**未在 registerScreens 注册、无打开入口**。勿使用；如需 Toast 请走 `@/utils/tools` 的 `tipDialog` / toast 能力。

---

## 7. 导航 hooks 与事件监听

`src/navigation/hooks.ts`：

| 函数 | 说明 |
|------|------|
| `useNavigationCommandComplete(callback)` | RNN 导航命令完成时回调一次（一次性，执行后移除监听） |
| `useNavigationComponentDidAppear(componentId, callback)` | 组件出现（`componentDidAppear`）时回调 |
| `useNavigationComponentDidDisappear(componentId, callback)` | 组件消失（`componentDidDisappear`）时回调（useEffect 封装版） |
| `onNavigationComponentDidDisappearEvent(componentId, callback)` | 同上，但直接返回 `unsubscribe` 供手动管理 |

`src/navigation/event.ts`：

| 函数 | 说明 |
|------|------|
| `onModalDismissed(id, handler)` | modal 关闭事件的一次性监听，返回取消函数；匹配 `componentId` 后执行 handler 并自毁 |

> 说明：任务描述中提到的"`useNavigation`"在本仓库中**不存在同名函数**，实际可用的是上面 hooks.ts 的四个函数。组件获取 `componentId` 的常规方式是 RNN 注入的 `props.componentId`（如各屏幕 `index.tsx` 中的用法）。

#### 7.1 使用示例

```tsx
// 屏幕挂载时登记 componentId + 注册生命周期监听（以 Home 为例的模式）
const Home = ({ componentId }: { componentId: string }) => {
  useNavigationComponentDidAppear(componentId, () => {
    // 屏幕出现：登记组件、刷新数据等
    setComponentId(COMPONENT_IDS.home, componentId)
  })

  useNavigationComponentDidDisappear(componentId, () => {
    // 屏幕消失：暂停耗时任务、复位状态等
  })

  // ...
}
```

`useNavigationCommandComplete` 典型用于"导航动画结束后再执行副作用"（如滚动到指定位置）；`onNavigationComponentDidDisappearEvent` 的非 hook 版本供在回调/闭包内按需注册与手动移除（返回 `unsubscribe`）。注意 `componentDidDisappear` 在**被新屏覆盖**时也会触发（RNN 语义是"不可见"而非"销毁"），用 `usePageVisible`（`store/common/hook`）配合 `componentIds` 才能判断"整组页面是否都不在显示"。

---

## 8. 屏幕弹出的 componentId 清理

屏幕挂载时登记自己（如 `src/screens/Home/index.tsx`）：

```ts
setComponentId(COMPONENT_IDS.home, componentId)   // core/common.ts → store/common/action.setComponentId
```

`COMPONENT_IDS` 枚举（`src/config/constant.ts`）：`home` / `playDetail` / `songlistDetail` / `comment`。登记结果存于 `store/common/state.ts` 的 `componentIds: Partial<Record<COMPONENT_IDS, string>>`，并广播 `state_event.componentIdsUpdated`。

屏幕被 pop 时（`index.ts` 的 `registerScreenPoppedListener`）→ `removeComponentId(componentId)`（`core/common.ts` → `store/common/action.removeComponentId` 按 id 反查 name 删除）→ 再次广播 `componentIdsUpdated`。

`componentIds` 的典型消费方：

- `useComponentIds()`（`store/common/hook`）；
- `usePageVisible(visibleNames, onChange)`：比较"当前登记的组件集合"与目标集合，判定某组页面是否同时可见（用于 Home 与 PlayDetail 的联动状态）。

---

## 9. 深链入口与导航衔接

`src/core/init/deeplink/index.ts` 的 `initDeeplink()` 在启动完成后被调用（design-doc §3.4.1 第 4 步 / PactModal 同意后也会调用）：

```ts
export const initDeeplink = async () => {
  Linking.addEventListener('url', ({ url }) => { void runLinkAction(url) })
  const initialUrl = await Linking.getInitialURL()
  if (initialUrl == null) return
  void runLinkAction(initialUrl)   // 冷启动时的初始链接
}
```

### 9.1 协议链接 `lxmusic://`

`runLinkAction` → `handleLinkAction(link)` 解析 `lxmusic://<type>/<action>/<paths...>?data=...`：

| type | 处理函数 | action 示例 |
|------|---------|------------|
| `music` | `musicAction.js` `handleMusicAction` | 搜索/播放指定歌曲（`data` 为 JSON） |
| `songlist` | `songlistAction.js` `handleSonglistAction` | 打开/收藏指定歌单 |
| `player` | `playerAction.ts` `handlePlayerAction` | `play` / `pause` / `skipNext` / `skipPrev` / `togglePlay` / `collect` / `uncollect` / `dislike` |

URL 形态示例：

| 链接 | 效果 |
|------|------|
| `lxmusic://player/play` | 播放（等价 `core/player` 的 `play()`） |
| `lxmusic://player/skipNext` | 下一首 |
| `lxmusic://music/search?text=周杰伦&source=kw` | 按关键词搜索音乐 |
| `lxmusic://songlist/open?id=<listId>&source=kw` | 打开在线歌单详情 |
| `lxmusic://file/<path>`（`file://` / `content://`） | 导入列表备份 / 用户源脚本 / 本地音频 |

`playerAction.ts` 的 action 直接映射到 `core/player/player.ts` 的 `play()` / `pause()` / `playNext()` / `playPrev()` / `togglePlay()` / `collectMusic()` / `uncollectMusic()` / `dislikeMusic()`——即深链命令播放器**但不一定涉及导航跳转**；`music` / `songlist` 类 action 则可能通过 `setNavActiveId`、`app_event`（如 `jumpListPosition`）等间接驱动界面。

### 9.2 文件链接 `file://` / `content://`

`handleFileAction` 按扩展名分发：`json`/`lxmc` → `handleFileLXMCAction`（导入列表备份）、`js` → `handleFileJSAction`（导入自定义源脚本）、`ogg/flac/wav/mp3` → `handleFileMusicAction`（本地歌曲）。

### 9.3 与导航的关系

- 深链是"业务动作入口"，最终效果（切 tab、弹窗、播放）多数通过 `core` 层与 `state_event`/`app_event` 体现，而非直接 `Navigation.push`。
- 失败时 `errorDialog(err.message)`（`deeplink/utils.js`）给出提示，不影响主界面。

---

## 10. 常见问题排查（FAQ）

| 现象 | 排查路径 |
|------|---------|
| 点了跳转没反应 | ① 确认目标屏幕已注册（`registerScreens.tsx` 有 `Navigation.registerComponent`）② 确认传入的 `componentId` 是**当前栈内屏幕**的 id（pop 过的 id 已失效）③ 若用了 `showOverlay` 而目标被注册为普通屏，检查 `screenNames` 拼写 |
| 新屏状态栏/背景色不对 | `push*` 函数的 `options` 里主题取自 `themeState.theme`（`store/theme/state`）；主题未初始化时取默认浅色主题。检查跳转是否发生在 `pushHomeScreen` 之前（此时主题可能还是初始值） |
| 返回后界面状态错乱 | 屏幕被 pop 时 `registerScreenPoppedListener` → `removeComponentId` 会广播 `componentIdsUpdated`；若依赖 `usePageVisible` 判断可见性，确认屏幕挂载时已 `setComponentId` 且未重复登记 |
| 弹窗点遮罩外关不掉 | 检查 `overlay.interceptTouchOutside`（三个 modal 均为 `true`）；若手动 `showOverlay` 未带此选项则无法通过遮罩关闭 |
| 深链无效 | 确认链接前缀为 `lxmusic://`（或 `file://` / `content://`）；`initDeeplink` 只在启动完成后（或 PactModal 同意后）执行过一次，热更新场景需重启应用重新绑定 |
| 共享元素动画异常 | `fromId` / `toId` 必须与视图的 `nativeID` 完全一致（含 `_from_${id}` / `_to_${id}` 后缀）；列表页与详情页两端都要设置，且两屏不能同时存在于动画不可见的层级 |

## 11. 新增页面的扩展步骤（对应 design-doc §7）

1. 在 `src/screens/` 下创建页面组件（`export default`，接收 `props.componentId`）。
2. 在 `src/screens/index.ts` 导出。
3. 在 `src/navigation/screenNames.ts` 声明名称常量（`'lxm.xxx'`）。
4. 在 `src/navigation/registerScreens.tsx` 用 `WrappedComponent` 注册：`Navigation.registerComponent(X_SCREEN, () => WrappedComponent(X))`。
5. 在 `src/navigation/navigation.ts` 或 `utils.ts` 增加跳转/打开封装（如需动画，用 `NAV_SHEAR_NATIVE_IDS`）。
6. 若页面需要"出现在屏幕集合判断"（如与 Home 联动），登记 `COMPONENT_IDS` 并接入 `usePageVisible`。

---

## 12. 疑点与注意事项（需人工核对）

1. **`useNavigation` 不存在**：实际 hooks 是 `hooks.ts` 中的四个函数，命名与任务假设有差异。
2. **`Toast.js` 未注册**：`TOAST_SCREEN` 常量被注释，Toast 组件不可达，疑似应删除或改造成可用工具。
3. **`SETTING_SCREEN` 被注释**：Setting 页面作为 Home 内 tab 存在，勿再按独立屏幕注册。
4. **动画配置较重**：`pushSonglistDetailScreen` 的 pop 共享元素动画依赖列表页与详情页都设置匹配的 `nativeID`（含 `_from_${id}` / `_to_${id}` 后缀），改动画需两端同步。
5. **`showOverlay` 与 `showModal` 的取舍**：三个弹窗都用 `showOverlay` + `interceptTouchOutside: true`，不要混用 `showModal`（两者生命周期事件不同，`onModalDismissed` 只监听 modal）。
6. **`registerScreenPoppedListener` 的清理**：`index.ts` 在重新 `init` 时会先 `unRegisterEvent.remove()`，避免热重载场景下重复注册。
