# 播放引擎（core/player 与 plugins/player）

> 阅读本文你将获得：① 理解播放引擎"业务决策 / 原生执行 / 资源获取"三层分离的架构，看懂点击一首歌到声音响起之间发生了什么；② 掌握 TrackPlayer 事件如何回流为应用事件、切歌/失败重试/恢复播放等状态机的决策点；③ 能够排查"播放失败、切歌不生效、进度不动、恢复播放异常"等常见问题。

## 设计依据

- 顶层设计文档：[`../design-doc.md`](../design-doc.md) 的 **ADR-8**（播放列表逻辑与 UI 分离）、**5.1 播放引擎**（core/player + plugins/player 职责划分）、**4.4 播放模型**（`PlayMusicInfo`/`PlayInfo`/`Track` 等）。
- 系统架构文档：[`../architecture.md`](../architecture.md)（分层与事件总线机制）。

---

## 1. 架构分层

播放链路涉及三个层次，职责严格分离：

| 层 | 目录 | 职责 |
|----|------|------|
| 业务核心层 | `src/core/player/` | **播放决策**：play/pause/next/prev、播放列表状态机（playedList/tempPlayList）、URL 获取与延迟重试、进度/状态文本、定时退出 |
| 插件适配层 | `src/plugins/player/` | **原生执行**：TrackPlayer 封装（setupPlayer、轨道构建、队列管理、音量/倍速/元数据）、后台 playback service（事件 → `app_event` 映射） |
| 业务核心层 | `src/core/music/` | **资源获取**：在线/本地/下载三种来源的 URL、封面、歌词（含"切换源"降级） |
| 装配层 | `src/core/init/player/` | 启动时装配事件监听、恢复上次播放、进度轮询、预加载、定时退出、歌词联动 |

设计要点（design-doc 5.1）：**播放服务与 UI 完全解耦**——后台事件只通过 `app_event` 回流业务层；`core/player/player.ts` 负责业务决策（切歌、重试、超时），`plugins/player` 只负责原生执行。

启动装配顺序（`core/init/player/index.ts`）：

```
initPlayer(事件监听+恢复) → initLyric → initPlayInfo(恢复上次播放) → initPlayStatus
→ initPlayerEvent → initWatchList → initPlayProgress → initPreloadNextMusic
```

## 2. 播放状态模型

`src/store/player/state.ts` 是播放状态的唯一数据源（单例对象），`store/player/action.ts` 修改后经 `state_event` 广播（`playStateChanged` / `playMusicInfoChanged` / `playInfoChanged` / `playProgressChanged` / `playPlayedListChanged` / `playTempPlayListChanged` / `playStateTextChanged` / `playerMusicInfoChanged`）。

| 字段 | 类型 | 含义 |
|------|------|------|
| `playMusicInfo` | `{ musicInfo, listId, isTempPlay }` | **当前播放歌曲与来源列表**；`musicInfo` 可为 `LX.Download.ListItem`（下载项）；`isTempPlay` 标记是否来自"稍后播放" |
| `playInfo` | `{ playIndex, playerListId, playerPlayIndex }` | 播放位置：`playIndex` 为当前歌曲在其所属列表的下标；`playerListId` 为播放器当前列表 id；`playerPlayIndex` 为播放器内的下标 |
| `musicInfo` | `LX.Player.MusicInfo` | **UI 展示信息**：`id/pic/lrc/tlrc/rlrc/lxlrc/rawlrc/name/singer/album`（歌词四态 + 原文） |
| `isPlay` | `boolean` | 是否处于播放状态（UI 播放/暂停图标依据） |
| `volume` / `playRate` | `number` | 音量 / 倍速 |
| `statusText` | `string` | 状态文本（"正在获取URL / 加载中 / 缓冲中 / 播放出错"等） |
| `playedList` | `PlayMusicInfo[]` | 已播放列表（随机模式记忆，供上一曲回溯） |
| `tempPlayList` | `PlayMusicInfo[]` | 稍后播放队列（插入顶部/底部，自动播放） |
| `progress` | `{ nowPlayTime, maxPlayTime, progress, nowPlayTimeStr, maxPlayTimeStr }` | 播放进度（秒 + 格式化 `mm:ss` + 比例） |
| `loadErrorPicUrl` / `lastLyric` | — | 封面加载失败去重标记 / 最近一行歌词（通知栏标题） |

类型定义见 `src/types/player.d.ts`：`PlayMusic = MusicInfo | Download.ListItem`；`Track extends RNTrack` 增加 `musicId`。

### 2.1 状态广播（state_event 映射）

`store/player/action.ts` 每次修改后广播对应事件，UI 通过 `store/player/hook.ts` 订阅：

| action 方法 | state_event | 携带数据 |
|-------------|-------------|----------|
| `setIsPlay` | `playStateChanged` | `isPlay` |
| `setStatusText` | `playStateTextChanged` | `statusText` |
| `setPlayMusicInfo` | `playMusicInfoChanged` | `playMusicInfo` |
| `setMusicInfo` | `playerMusicInfoChanged` | `musicInfo` |
| `updatePlayIndex` / `setPlayListId` | `playInfoChanged` | `playInfo` |
| `setNowPlayTime` / `setMaxplayTime` / `setProgress` | `playProgressChanged` | `progress`（含格式化时间串） |
| `addPlayedList` / `removePlayedList` / `clearPlayedList` | `playPlayedListChanged` | `playedList` |
| `addTempPlayList` / `removeTempPlayList` / `clearTempPlayeList` | `playTempPlayListChanged` | `tempPlayList` |

> 注意 `setProgress` 的 `progress` 比例计算是 `nowPlayTime / currentTime`（action.ts 第 63 行），即"当前时间占传入总时间"的比例——`nowPlayTime` 与 `totalTime` 语义需区分，属已知实现细节。

## 3. 轨道构建机制（plugins/player/playList.ts）

`buildTracks(musicInfo, url?, duration?)` 为每首歌构建**双轨道**：

| 轨道 | id 格式 | url | 作用 |
|------|---------|-----|------|
| 真实轨道 | `` `${mInfo.id}__//${Math.random()}__//${url}` `` | 实际播放地址 | 主播放轨道 |
| 占位轨道 | `` `${mInfo.id}__//${Math.random()}__//default` `` | `defaultUrl`（`src/resources/medias/Silence02s.mp3`，2 秒静音，见 `src/config/index.js`） | 兜底占位 |

轨道字段：`title/artist/album/artwork`（通知栏元数据，受 `player.isShowNotificationImage` 控制）、`userAgent`（固定 Android Chrome UA）、`musicId`、`lyric`（蓝牙完整歌词，受 `player.isShowBluetoothFullLyric` 控制）、`duration`。

```ts
// 轨道 id 示例（id 三段式：音乐id + 随机数 + url 标记）
`${musicInfo.id}__//${Math.random()}__//${url}`     // 真实轨道
`${musicInfo.id}__//${Math.random()}__//default`    // 占位轨道
```

**设计意图**：真实轨道播放失败时 TrackPlayer 会切到占位轨道；`utils.ts` 通过 id 后缀判别：

```ts
const emptyIdRxp = /\/\/default$/
const tempIdRxp  = /\/\/default$|\/\/default\/\/restorePlay$/
isEmpty(trackId)  // 当前是否为占位轨道（播放失败/无 URL 状态）
isTempId(trackId) // 占位轨道 或 恢复播放占位
```

队列管理（`handlePlayMusic`）：`TrackPlayer.add(双轨道)` → `skip` 到真实轨道 → `seekTo(time)` → `play()`；若 `queue.length > 2` 则移除最旧轨道，**队列最多保留 2 个轨道**。快速切歌通过 `playPromise` 链 + `actionId` 丢弃过期播放请求；通知栏元数据用 `debounceUpdateMetaInfoTools` 防抖更新（解决快速切歌信息错位）。

## 4. 播放服务与事件映射（plugins/player/service.ts）

`registerPlaybackService()` 注册 TrackPlayer 后台 service，将原生事件映射为 `app_event`：

| TrackPlayer 事件 | 触发条件 | 映射动作 |
|------------------|----------|----------|
| `RemotePlay` | 通知栏/耳机播放 | `play()` |
| `RemotePause` | 通知栏/耳机暂停 | `pause()` |
| `RemoteNext` | 下一曲 | `playNext()` |
| `RemotePrevious` | 上一曲 | `playPrev()` |
| `RemoteStop` | 停止 | `handleExitApp('Remote Stop')`（退出应用） |
| `RemoteSeek` | 进度拖动 | `app_event.setProgress(position)` |
| `PlaybackError` | 原生播放错误 | `app_event.error()` + `app_event.playerError()` |
| `PlaybackState` | 状态变化 | 见下表 |
| `PlaybackTrackChanged` | 轨道切换 | 记录 `global.lx.playerTrackId`；`isPlayedStop` 则退出；若 `isEmpty()` → 暂停 + `playerPause/pause/playerEnded/playerEmptied` |

`PlaybackState` 状态 → 事件映射（`gettingUrlId` 或占位轨道期间跳过）：

| TP 状态 | app_event |
|---------|-----------|
| `Ready` / `Stopped` / `Paused` | `playerPause()` + `pause()` |
| `Playing` | `playerPlaying()` + `play()` |
| `Buffering` | `pause()` + `playerWaiting()` |
| `Connecting` | `playerLoadstart()` |

> 注：`service.ts` 中保留了大量**被注释的旧重试/切歌逻辑**（design-doc §8 风险 2），当前重试决策已全部上移 `core/player`，改动时勿依赖注释代码。

### 4.1 播放器初始化参数（plugins/player/index.ts）

`playerInitial`（首次播放时在 `handlePlay` 中触发，`global.lx.playerStatus.isIniting/isInitialized` 防重入）传入 `TrackPlayer.setupPlayer`：

| 参数 | 来源设置 | setupPlayer 选项 |
|------|----------|------------------|
| `volume` | `player.volume` | —（随后 `setVolume`） |
| `playRate` | `player.playbackRate` | —（随后 `setRate`） |
| `cacheSize` | `player.cacheSize`（MB） | `maxCacheSize: cacheSize * 1024` |
| `isHandleAudioFocus` | `player.isHandleAudioFocus` | `handleAudioFocus` |
| `isEnableAudioOffload` | `player.isEnableAudioOffload` | `audioOffload` |
| 固定值 | — | `maxBuffer: 1000`、`waitForBuffer: true`、`autoUpdateMetadata: false` |

初始化前还会执行 `migratePlayerCache()`（`utils.ts`：把旧 `temporaryDirectoryPath/TrackPlayer` 缓存迁移到 `privateStorageDirectoryPath`，并 toast 提示）；随后 `updateOptions()` 注册通知栏能力（Play/Pause/Stop/SeekTo/SkipToNext/SkipToPrevious）。

## 5. 核心播放流程（点击歌曲 → 出声）

```
用户点击歌曲 playList(listId, index) / playListById(listId, id)
  │  setPlayListId → setPlayMusicInfo（广播 musicToggled）
  │  切列表/开启自动清理 → clearPlayedList / clearTempPlayeList
  ▼
handlePlay()  (core/player/player.ts)
  │ 未初始化 → playerInitial（setupPlayer: maxCacheSize=cacheSize*1024,
  │              maxBuffer=1000, waitForBuffer, audioOffload...）
  │ restorePlayInfo 存在 → handleRestorePlay（§8 恢复播放），结束
  │ 否则：
  │   await setStop() → app_event.pause()
  │   clearDelayNextTimeout / clearLoadTimeout
  │   random 模式 → addPlayedList
  ▼
debouncePlay(musicInfo)  （200ms 防抖）
  ├─ setMusicUrl(musicInfo)        ① 获取播放 URL
  ├─ getPicPath(...) → setMusicInfo({pic}) → app_event.picUpdated()  ② 封面
  └─ getLyricInfo(...) → setMusicInfo({lrc,tlrc,...}) → app_event.lyricUpdated() ③ 歌词
  │
  ▼
setMusicUrl  (core/player/player.ts)
  │ diffCurrentMusicInfo 去重：id 或 gettingUrlId 变化 → 丢弃
  │ global.lx.gettingUrlId = createGettingUrlId(musicInfo)  // `${id}_${toggleMusicInfo?.id}`
  ▼
getMusicPlayUrl(musicInfo, isRefresh)
  │ 状态文本 player__getting_url；启动 100s 加载超时 addLoadTimeout
  │ toggleMusicInfo 存在 → getMusicUrl(toggleMusicInfo, allowToggleSource:false)
  │ 否则/失败 → getMusicUrl(musicInfo, onToggleSource: 提示 toggle_source_try)
  │      ├─ 内部：quality 选择 → 缓存(url) → musicSdk[source].getMusicUrl
  │      │   （core/music: online/local/download 分流 + getOtherSource 切换源）
  │      ├─ 失败分类：cancelRequest/已切歌/isPlayedStop → 返回 null
  │      ├─ tooManyRequests('服务器繁忙') → delayRetry（随机 2~6s 后重试，
  │      │     状态文本 player__getting_url_delay_retry）
  │      └─ 其它错误 → 重试一次（isRetryed 标记）→ 仍失败则抛出
  ▼
setResource(musicInfo, url, progress.nowPlayTime)
  └─ plugins/player setResource → playMusic（800ms 防抖，链式串行）
       └─ handlePlayMusic：buildTracks → TrackPlayer.add → skip → seekTo(time) → play()
  ▼
TrackPlayer 原生播放
  └─ PlaybackState: Playing → app_event.playerPlaying/play
       └─ core/init/player/player.ts setPlayStatus → setIsPlay(true)
       └─ playProgress.ts：startUpdateTimeout（1s/倍速 轮询 getPosition）
```

### 5.1 URL 获取去重：gettingUrlId

- `createGettingUrlId = ${musicInfo.id}_${meta.toggleMusicInfo?.id ?? ''}`。
- `global.lx.gettingUrlId` 标记"正在获取 URL 的歌曲"，用于：
  - `diffCurrentMusicInfo`：切歌后旧请求的异步结果直接丢弃（不覆盖新歌）。
  - service.ts 的 `PlaybackState` 处理：`gettingUrlId` 存在时跳过事件映射（避免占位状态干扰）。
  - 完成时（`finally`，且 `musicInfo === playMusicInfo.musicInfo`）清空。

## 6. 播放列表机制

### 6.1 已播放列表 playedList（core/player/playedList.ts）

- `addPlayedList`（随机模式播放/切歌时记录，`playInfo.ts`/`player.ts` 中 `togglePlayMethod == 'random'` 时调用）、`removePlayedList(index)`、`clearPlayedList()`。
- 设置 `player.isAutoCleanPlayedList`：播放新列表时自动清空。
- `player.togglePlayMethod` 变更时（`core/init/player/player.ts handleConfigUpdated`）：清空 playedList，若切到 random 则记录当前歌曲。

### 6.2 稍后播放 tempPlayList（core/player/tempPlayList.ts）

- `addTempPlayList(list)`：`isTop` 插入队首（`arrUnshift`），否则队尾（`arrPush`）；**若当前无播放歌曲则直接 `playNext()`**。
- `playNext()` 优先消费 `tempPlayList[0]`（`isTempPlay: true` 进入 `playMusicInfo`）。

### 6.3 切歌模式 togglePlayMethod（五种）

设置键 `player.togglePlayMethod`，在 `playNext`/`playPrev`/`getNextPlayMusicInfo` 中生效：

| 值 | 行为 |
|----|------|
| `listLoop` | 列表循环：末尾 → 回到开头 |
| `random` | 随机播放（记录 randomNextMusicInfo 供下一曲预取一致） |
| `list` | 列表播放：末尾停止 |
| `singleLoop` | 单曲循环（保持当前下标） |
| `none` | 不自动切换（`default` 分支返回 null） |

手动点下一曲（`isAutoToggle = false`）时，`list/singleLoop/none` 临时按 `listLoop` 处理；自动切歌（`isAutoToggle = true`）按设定模式执行。

### 6.4 候选过滤 filterList（core/player/utils.ts）

`filterList` → `filterMusicList` 按规则过滤出可播歌曲并定位当前下标：

- 排除：已播放列表中的歌曲（`playedList` 中同 listId 且非 isTempPlay）、下载项未完成（`isComplate === false`）、命中"不喜欢"规则的歌曲（`dislikeInfo`，当前播放歌曲被标记不喜欢则移除并调整下标）。
- 若过滤后为空但有 playedList 记录 → 清空 playedList，退回 `canPlayList`。

## 7. 切歌与错误处理（core/player/player.ts + init/player/playerEvent.ts）

### 7.1 playNext 决策顺序

```
tempPlayList 非空 → 播放队首（removeTempPlayList(0)）
playedList 非空 → 从当前歌曲在 playedList 中的位置向后找（并清理列表已删除的歌曲）
randomNextMusicInfo 已缓存 → 播放该信息（随机模式一致性）
否则 → filterList → 按 togglePlayMethod 计算 nextIndex → handlePlayNext
```

`playPrev` 对称：优先 playedList 向前回溯，再按模式计算（`random` 取随机，`list/listLoop` 循环向前）。

### 7.2 失败重试与超时（init/player/playerEvent.ts）

| 事件 | 处理 |
|------|------|
| `playerLoadstart`（Connecting） | 状态文本"加载中"，启动 **25s 加载超时**：超时后首次刷新 URL（`setMusicUrl(isRefresh:true)`），再次超时 `playNext(true)` |
| `playerWaiting`（Buffering） | 状态文本"缓冲中" |
| `playerPlaying` | 清空状态文本、取消加载超时 |
| `playerError` | 重试 <2 次 → 记录当前进度后刷新 URL（`player__refresh_url`）；否则 `setStop()` + 状态"播放出错"；前台 5s 后 `playNext(true)`，后台直接切歌 |
| `playerEnded` | `isPlayedStop` → 只显示"播放结束"；否则 `setProgress(0)` + `playNext(true)` |

另有 `core/player/player.ts` 内部的 5s 延迟切歌（`createDelayNextTimeout`，URL 获取失败时兜底）与 100s 加载超时（`addLoadTimeout`）。

## 8. 恢复播放（core/init/player/playInfo.ts + player.ts）

- 持久化：`savePlayInfo`（`utils/data.ts`）保存 `{ time, maxTime, listId, index }`（`playProgress.ts` 中 2s 节流保存；设置 `player.isSavePlayTime` 控制）。
- 恢复：启动时 `initPlayInfo` 读取 `getPlayInfo()` → 校验列表与下标存在 → `global.lx.restorePlayInfo = info` → `playList(listId, index)`。
- `handlePlay` 发现 `restorePlayInfo` → `handleRestorePlay`：
  - `app_event.setProgress(isSavePlayTime ? time : 0, maxTime)`；
  - `initTrackInfo`（构建**占位轨道**入队，不播放）；
  - 异步补封面/歌词（`getPicPath`/`getLyricInfo`）；
  - `plugins/player handlePlayMusic` 中 `restorePlayInfo` 存在 → `pause()`（**不自动播放**）并清空标记；
  - 设置 `player.startupAutoPlay` 时 `setTimeout(play)` 自动续播。
- 恢复进度写入：`init/player/playProgress.ts` 的 `setProgress(time)` → `setCurrentTime(time)`。

恢复播放时序：

```
启动 → core/init/player/playInfo.ts
  │ getPlayInfo() 读取本地存储 { time, maxTime, listId, index }
  │ 校验 listId / list[index] 存在
  ▼
global.lx.restorePlayInfo = info
  ▼
playList(listId, index) → handlePlay()
  │ 发现 restorePlayInfo → handleRestorePlay()
  │   app_event.setProgress(isSavePlayTime ? time : 0, maxTime)   ← 进度回填
  │   initTrackInfo() → buildTracks(仅占位轨道) → TrackPlayer.add + skip
  │   getPicPath / getLyricInfo → 封面与歌词异步装载（picUpdated/lyricUpdated）
  │   random 模式 → addPlayedList
  ▼
plugins/player handlePlayMusic（无真实 URL）
  │ currentTrackIndex == null && restorePlayInfo
  │   → TrackPlayer.pause()   ← 不自动播放，只就位
  │   → restorePlayInfo = null
  ▼
设置 player.startupAutoPlay → setTimeout(play) 自动续播
```

> 若恢复失败（列表/下标失效）：`initPlayInfo` 直接 return，`restorePlayInfo` 保持 null，不阻断启动。

## 9. 预加载下一首（init/player/preloadNextMusic.ts）

- 触发：`playProgressChanged` 且 `duration > 10`、`duration - nowPlayTime < 10`、未预加载中 → `preloadNextMusicUrl`。
- 流程：节流（距上次 <3s 跳过）→ `getNextPlayMusicInfo()`（与切歌同源决策）→ `getMusicUrl` 预取并校验 URL（`isCached` + `checkUrl`），URL 不可达则 `isRefresh` 重取。
- 切歌/改模式时重置预加载状态（`musicToggled`、`configUpdated`）。

## 10. 定时退出（core/player/timeoutExit.ts）

- `startTimeoutExit(time)`：`BackgroundTimer.setTimeout(time * 1000)` + 每秒 tick 回调（`useTimeoutExitTimeInfo` hook 供 UI 倒计时）。
- 到期 `exit()`：设置 `player.timeoutExitPlayed`（"到时退出已播放的歌曲后退出"）且正在播放 → `global.lx.isPlayedStop = true`（**播放完当前歌曲后退出**）；否则直接 `exitApp('Timeout Exit')`。
- `isPlayedStop` 标志在多处阻止自动切歌：`handleEnded`（不再 playNext）、`delayNextTimeout`、service 的 `PlaybackState`/`PlaybackTrackChanged`（`handleExitApp('Timeout Exit')`）。
- `cancelTimeoutExit()` 清除标志。

## 11. 歌词联动（init/player/lyric.ts + core/lyric）

| app_event | core/lyric 动作 |
|-----------|-----------------|
| `play` | `play()`（按当前进度推进歌词） |
| `pause` / `error` | `pause()` |
| `stop` / `musicToggled` | `stop()` |
| `lyricUpdated` | `setLyric()`（新歌词装载） |

- 歌词来源：`core/music` 的 `getLyricInfo`（在线/本地/下载分流，缓存优先），`player.ts` 中歌词就绪后 `setMusicInfo({lrc,tlrc,lxlrc,rlrc,rawlrc})` + `lyricUpdated`。
- 逐行播放 `onLyricLinePlay` → `updateRemoteLyric(text)`：更新通知栏标题为当前歌词行（`updateNowPlayingTitles`）+ `setLastLyric`（`player.ts` 构建轨道时 `title` 会用最近歌词行）。
- 蓝牙歌词：`player.isShowBluetoothLyric` → `showRemoteLyric(true)`；桌面歌词 `desktopLyric.enable` → `showDesktopLyric()`（失败自动关闭对应设置）。

## 12. 下载集成（core/music/download.ts）

- 下载项（`LX.Download.ListItem`，含 `progress` 字段与 `metadata.musicInfo`）在播放链路中与普通歌曲**统一**：`core/music/index.ts` 按 `'progress' in musicInfo` 分流到 `download.ts`。
- `download.ts` 实际**委托在线源**：`getMusicUrl/getPicUrl/getLyricInfo` 均基于 `musicInfo.metadata.musicInfo` 走 `online.ts`（缓存优先）。注意当前代码未实现"读下载文件本地播放"路径（对应逻辑被注释）。
- 播放"稍后播放"列表中的下载项同理：`PlayMusic` 联合类型涵盖下载项。
- **已知限制**：`core/player/playInfo.ts` 的 `getList` 对 `LIST_IDS.DOWNLOAD` 直接返回 `[]`，即 `playListById(listId, id)` 无法直接以 `'download'` 作为列表源起播；下载列表的播放需先经其它列表/稍后播放路径（待核对，见 §14）。
- 列表变更联动：`watchList.ts` 监听 `app_event.myListMusicUpdate` / `downloadListUpdate`，节流后 `updatePlayIndex()` 重算下标；当前播放歌曲被移出列表（`playIndex < 0`）→ 自动 `playNext(true)`。

## 13. 常见问题排查

| 现象 | 排查路径 |
|------|----------|
| 点了歌曲没声音 | 看状态文本：`player__getting_url` 卡住 → `getMusicUrl` 未返回（源不可用，见 `docs/modules/music-sources.md` §7.2：内置源 `apis` 抛 `Api is not found`，需 user_api）；随后 `delayRetry`/`playerError` 路径是否触发 |
| 一直"加载中/缓冲中" | `playerLoadstart` 25s 超时 → 首次刷新 URL；`playerWaiting` 时检查 `TrackPlayer.getBufferedPosition`；网络/UA 问题可看 `userAgent`（固定 Chrome UA） |
| 播一会自动切歌 | `playerEnded` → `playNext(true)`；若属意外，检查是否 `global.lx.isPlayedStop` 被设置（定时退出）或 dislike 过滤生效 |
| 快速切歌后信息错位 | `playPromise` 链 + `actionId` 丢弃过期请求；通知栏元数据经 `delayUpdateMusicInfo` 500ms 防抖，极端情况下等待刷新 |
| 进度不动 | `playProgress.ts` 轮询依赖 `app_event.play`（`startUpdateTimeout`）；`player.playbackRate` 变更会重建轮询；屏幕关闭（`isScreenOn`）暂停轮询；`AppState active` 兜底恢复 |
| 恢复播放无效 | 检查 `getPlayInfo()` 数据、`player.isSavePlayTime`；`restorePlayInfo` 在 `handlePlay` 中消费一次即清空 |
| 缓冲进度条（Buffer）不动 | `useBufferProgress`（`plugins/player/hook.ts`）：仅 `Buffering` 状态 1s 轮询 `getBufferedPosition/duration`，缓冲完成（buffered == duration）即停止轮询；`State.None` 归零 |
| 通知栏没歌词/封面 | `player.isShowBluetoothFullLyric`/`player.isShowNotificationImage` 设置；歌词行经 `onLyricLinePlay` 写入标题 |

### 13.1 播放相关设置键速查（src/types/app_setting.d.ts）

| 设置键 | 默认 | 影响 |
|--------|------|------|
| `player.playQuality` | — | 期望播放音质（`core/music/utils.ts getPlayQuality`） |
| `player.togglePlayMethod` | — | 切歌模式（§6.3 五种） |
| `player.isAutoCleanPlayedList` | — | 切列表时自动清空 playedList |
| `player.isSavePlayTime` | — | 是否保存/恢复播放进度 |
| `player.startupAutoPlay` | — | 恢复播放后自动续播 |
| `player.playbackRate` | — | 倍速（进度轮询周期 `1000/rate`） |
| `player.cacheSize` | — | 播放缓存上限（MB，setupPlayer maxCacheSize） |
| `player.isHandleAudioFocus` / `player.isEnableAudioOffload` | — | setupPlayer 音频焦点 / offload |
| `player.timeoutExitPlayed` | — | 定时退出：播完当前曲再退出 |
| `player.isShowNotificationImage` | — | 通知栏封面 |
| `player.isShowBluetoothFullLyric` / `player.isShowBluetoothLyric` | — | 蓝牙完整歌词 / 蓝牙歌词开关 |

## 14. 需人工核对的疑点

- `core/player/playInfo.ts` 的 `getList` 对下载列表返回 `[]`，`playListById` 起播下载列表会找不到歌曲——是设计如此（下载列表播放走其它入口）还是遗留，需确认。
- `core/music/download.ts` 的"读下载文件本地播放"路径整体注释（`getDownloadFilePath` 未启用），下载歌曲播放实际仍走在线 URL。
- `plugins/player/service.ts` 存在大量注释旧逻辑（design-doc §8 风险 2），重构时需以 `core/player` 当前行为为准。
- `init/player/playStatus.ts` 中 `buttons` 对象与 `setButtons` 仅剩 `updateMetaData` 副作用，桌面版残留逻辑较多，改动时注意回归通知栏按钮行为。
