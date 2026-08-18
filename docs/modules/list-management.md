# 我的列表与歌单机制（core/list + store/list）

> 读者对象：需要修改列表增删改查、实现导入导出/备份恢复、或排查"列表改了界面不刷新/播放对不上列表"的贡献者。
> 读完本文你将掌握：列表模型与 `LIST_IDS` 含义、`@list__<id>` 存储形态、`core/list.ts` 的完整操作 API、`list_event` → `state_event`/`app_event` 的事件流、导入导出/备份恢复机制、播放与列表的衔接，以及新增列表类型的扩展步骤。
> 对应设计依据：[design-doc §4.3 列表模型](./../design-doc.md)、[§5.3 我的列表](./../design-doc.md)、ADR-3（list_event 总线）、ADR-6（AsyncStorage 分片）、[§5.6 同步](./../design-doc.md)。

---

## 1. 列表模型

### 1.1 内置列表与用户列表

`src/config/constant.ts`：

```ts
export const LIST_IDS = {
  DEFAULT: 'default',     // 试听列表（内置，不可删）
  LOVE: 'love',           // 我的收藏（内置，不可删）
  TEMP: 'temp',           // 临时列表（内置，承载"稍后播放/试听"等场景）
  DOWNLOAD: 'download',   // 下载列表（标识用，独立于我的列表存储，见 §4.4 下载模型）
  PLAY_LATER: null,       // 占位：稍后播放不是持久化列表
} as const
```

类型定义（`src/types/list.d.ts`）：

| 类型 | 说明 |
|------|------|
| `MyDefaultListInfo` | `{ id: 'default', name: '试听列表' }` |
| `MyLoveListInfo` | `{ id: 'love', name: '我的收藏' }` |
| `MyTempListInfo` | `{ id: 'temp', name: '临时列表', meta: { id?: string } }` |
| `UserListInfo` | `{ id, name, source?, sourceListId?, locationUpdateTime: number \| null }`（用户自建/收藏的在线歌单） |
| `MyListInfo` | `MyDefaultListInfo \| MyLoveListInfo \| UserListInfo` 联合 |
| `MyAllList` | `{ defaultList, loveList, userList: UserListInfo[], tempList: MyTempListInfo }` 聚合 |
| `ListDataFull` | `{ defaultList: MusicInfo[], loveList: MusicInfo[], userList: UserListInfoFull[], tempList: MusicInfo[] }` —— 各列表携带**完整歌曲数组**的导出形态 |
| `*Full` 变体 | `MyDefaultListInfoFull` 等 = 元信息 + `list: MusicInfo[]` |
| `ListMusics` | `LX.Music.MusicInfo[]`（列表内歌曲） |

要点：

- 内置列表（default/love/temp）的 id 是固定字符串，且不进入 `userList` 数组；`MyAllList` 是"导入导出/备份"时的聚合视图。
- `UserListInfo.source` / `sourceListId` 记录该用户列表来自哪个在线源与源内列表 id（用于自动更新在线歌单）。
- `temp` 是内存态列表（`store/list/state.ts` 中 `tempListMeta.id` 记录其来源），不同步到远端（见 §6）。

### 1.2 store 中的列表元数据

`src/store/list/state.ts` 是列表**元数据**的状态单例（歌曲数组不在这里，见 §2）：

```ts
export interface InitState {
  // allMusicList: 类型声明存在，但该字段是遗留字段——运行时从未被写入，
  // 歌曲数组的真实缓存是 utils/listManage.ts 的模块级 allMusicList Map（见 §2.3）
  defaultList: LX.List.MyDefaultListInfo
  loveList: LX.List.MyLoveListInfo
  tempList: LX.List.MyTempListInfo
  userList: LX.List.UserListInfo[]
  activeListId: string          // 当前激活列表 id
  allList: Array<...>           // [defaultList, loveList, ...userList]
  tempListMeta: { id: string }
  fetchingListStatus: Record<string, boolean>  // 在线歌单拉取中标记
}
```

`store/list/action.ts` 提供 `setUserLists`（重建 `allList` 并广播 `mylistUpdated`）、`setActiveList`（广播 `mylistToggled`）、`setTempListMeta`、`setFetchingListStatus`。

---

## 2. 列表存储与内存缓存

### 2.1 存储键（`src/config/constant.ts` 的 `storageDataPrefix`）

| 键前缀 | 内容 |
|--------|------|
| `'@user_list'` | 用户列表**元数据**数组（`UserListInfo[]`，不含歌曲） |
| `'@list__'` | 每个列表的歌曲数组：`@list__<listId>`（如 `@list__default`、`@list__love`、`@list__userlist_xxx`） |
| `'@list_scroll_position'` | 各列表滚动位置（`ListPositionInfo`） |
| `'@list_prev_select_id'` | 上次激活的列表 id（`@list_prev_select_id`） |
| `'@list_update_info'` | 在线歌单自动更新时间信息（`ListUpdateInfo`） |

读写封装在 `src/utils/data.ts`：

```ts
export const getUserLists = async (): Promise<LX.List.UserListInfo[]>   // 读 @user_list，含旧版数字 id 兼容修复
export const saveUserList = async (listInfo: LX.List.UserListInfo[])    // 写 @user_list
export const getListMusics = async (listId: string)                     // 读 @list__<id>，无则返回 []
export const saveListMusics = async (listData: Array<{ id, musics }>)   // 批量写 @list__<id>（>1 条走 saveDataMultiple）
export const removeListMusics = async (ids: string[])                   // 批量删 @list__<id>
export const saveListPrevSelectId = async (id)                          // 节流写上次激活列表
```

### 2.2 分片（ADR-6）

`src/plugins/storage.ts`：单值 JSON 序列化超过 `500000` 字符时自动拆分为 `@___PART_A___<key><i>` 分片，主键存分片 key 数组；读取时兼容旧分隔符格式（`@___PART___`）。大列表（如收藏上千首歌）的 `@list__love` 会自动走分片，`saveListMusics` 内部无感知。

### 2.3 内存缓存（`src/utils/listManage.ts`）

```ts
export const userLists: LX.List.UserListInfo[] = []        // 用户列表元数据（模块级数组）
export const allMusicList = new Map<string, LX.Music.MusicInfo[]>()  // 列表 id → 歌曲数组

export const getListMusics = async (listId: string): Promise<LX.Music.MusicInfo[]> => {
  if (!listId) return []
  if (allMusicList.has(listId)) return allMusicList.get(listId)!   // 缓存命中
  const list = await getListMusicsFromStore(listId)                 // 否则读存储
  return setMusicList(listId, list)                                 // 并回填缓存
}
```

所有列表操作（add/remove/move/update/clear/overwrite）都直接改 `allMusicList` 对应的数组（部分原地 splice），**歌曲变更后必须持久化**（见 §5 事件流）。

### 2.4 启动恢复时序（`src/core/init/dataInit.ts`）

```
core/init 管道（design-doc §3.4.1）
  └─> dataInit(setting)
        ├─ musicSdkInit()                              // 异步初始化音乐 SDK（不阻塞）
        ├─ setUserList(await getUserLists())           // ① 读 @user_list → store/list state → mylistUpdated
        ├─ setDislikeInfo(await getDislikeInfo())      // ② 恢复不喜欢列表
        ├─ setNavActiveId((await getViewPrevState()).id) // ③ 恢复上次所在 tab（nav_search 等）
        └─ unlink(TEMP_FILE_PATH)                      // 清理临时文件
```

播放器侧的列表恢复（`src/core/init/player/playInfo.ts`，在 `init/player/index.ts` 内、`dataInit` 之前执行）见 §6.3。注意：**歌曲数组是惰性加载**的——启动时只读元数据，某个列表的歌曲在第一次 `getListMusics(listId)` 时才从 `@list__<id>` 读入内存缓存。

---

## 3. core/list 核心操作 API

`src/core/list.ts` 是列表操作的**统一入口**（业务层/UI 都通过它，不直接调 `list_event`）：

| 函数 | 签名 | 说明 |
|------|------|------|
| `overwriteListFull` | `(data: ListActionDataOverwrite)` | 整体覆盖全部列表（备份恢复/同步用），`tempList` 可选 |
| `createUserList` | `(position: number, listInfos: UserListInfo[])` | 批量创建用户列表 |
| `removeUserList` | `(ids: string[])` | 删除用户列表及其歌曲 |
| `updateUserList` | `(listInfos: UserListInfo[])` | 更新用户列表元信息 |
| `updateUserListPosition` | `(position: number, ids: string[])` | 移动用户列表位置 |
| `addListMusics` | `(id, musicInfos, addMusicLocationType)` | 批量加歌（按位置策略） |
| `moveListMusics` | `(fromId, toId, musicInfos, addMusicLocationType)` | 跨列表移动歌曲 |
| `removeListMusics` | `(listId, ids: string[])` | 批量删歌 |
| `updateListMusics` | `(infos: Array<{ id, musicInfo }>)` | 批量更新歌曲信息 |
| `updateListMusicPosition` | `(listId, position, ids)` | 批量移动歌曲位置 |
| `overwriteListMusics` | `(listId, musicInfos)` | 覆盖列表内歌曲 |
| `clearListMusics` | `(ids: string[])` | 清空多个列表 |
| `overwriteList` | `(listInfoFull)` | 覆盖单个列表（含元信息：userList 走 updateUserList + 歌曲 overwrite） |
| `createList` | `({ name, id?, list?, source?, sourceListId?, position? })` | 便捷创建（默认 id `userlist_${Date.now()}`，默认位置末尾） |
| `setActiveList` | `(id)` | 切换激活列表（写 `@list_prev_select_id`） |
| `setUserList` | `(lists: UserListInfo[])` | 直接覆盖元数据 state（初始化/恢复用） |
| `setTempList` | `(id, list: MusicInfoOnline[])` | 设置临时列表内容 |
| `setFetchingListStatus` | `(id, status)` | 标记在线歌单拉取状态 |
| `getUserLists` / `getListMusics` | — | 从 `@/utils/listManage` 转发导出 |

所有变更类函数都只是**转发到 `global.list_event` 的动作方法**（`await global.list_event.list_music_add(...)` 等），真正执行、持久化、广播都在 `ListEvent` 类中完成（§5）。这样保证了"改状态 → 落盘 → 通知"的单一链路。

---

## 4. 事件流：list_event → state_event / app_event

### 4.1 `src/event/listEvent.ts` 的 ListEvent 类

`ListEvent` 是 `list_event` 总线的实现类，含 12 个动作方法：`list_data_overwrite` / `list_create` / `list_remove` / `list_update` / `list_update_position` / `list_music_overwrite` / `list_music_add` / `list_music_move` / `list_music_remove` / `list_music_update` / `list_music_clear` / `list_music_update_position`。每个方法内部都是**三段式**：

1. 调用 `@/utils/listManage` 的纯操作函数修改 `userLists` / `allMusicList`；
2. 持久化 + 广播下游事件；
3. `this.emit('同名事件', ..., isRemote)` 通知 list_event 的订阅者（同步插件等）。

关键内部函数：

```ts
const updateUserList = async (userLists) => {
  await saveUserList(userLists)     // ① 元数据落盘 @user_list
  setUserList(userLists)            // ② core/list.setUserList → store action
}                                   //    → global.state_event.mylistUpdated(state.allList) ← UI 列表刷新

const checkUpdateList = async (changedIds) => {
  if (!changedIds.length) return
  await saveListMusics(changedIds.map(id => ({ id, musics: allMusicList.get(id) })))  // ① 歌曲落盘 @list__<id>
  global.app_event.myListMusicUpdate(changedIds)   // ② 通知 UI/播放器/下载等下游"这些列表的歌曲变了"
}

const checkListExist = (changedIds) => {
  // 若当前激活列表被删除且 allList 中已不存在 → 回退激活到 LIST_IDS.DEFAULT
}
```

### 4.2 两条通知通道的分工

| 通道 | 事件 | 语义 | 消费者 |
|------|------|------|--------|
| `state_event` | `mylistUpdated(allList)` | 列表**元数据**集合变化（增删列表、改名、初始化） | `useMyList` 等列表侧 UI |
| `state_event` | `mylistToggled(id)` | 激活列表切换 | `useActiveListId`、`useMusicList` |
| `app_event` | `myListMusicUpdate(ids)` | 若干列表的**歌曲数组**变化 | `useMusicList`（重取歌曲）、播放器/下载同步列表 |
| `list_event` | `list_*`（同名 emit） | 动作完成通知（带 `isRemote`） | `plugins/sync/listEvent.ts`（远程同步回传，`isRemote` 防回环） |

### 4.3 典型时序：向列表添加歌曲

```
UI/业务调用
  core/list.addListMusics(id, musics, 'top')
    └─> global.list_event.list_music_add(id, musics, 'top')
          ├─ utils/listManage.listMusicAdd()      // 改 allMusicList（去重 + top/bottom 插入）
          ├─ checkUpdateList([id])                // saveListMusics 落盘 @list__<id>
          │     └─> app_event.myListMusicUpdate([id])
          │           └─ useMusicList 的 handleChange → getListMusics(id) 重取 → setState → 界面刷新
          ├─ this.emit('list_music_add', ...)     // sync 插件收到 → 推送远端
          └─ (无 isRemote) 完成
```

### 4.4 删除列表时序（含兜底）

```
core/list.removeUserList([id])
  └─> list_event.list_remove([id])
        ├─ userListsRemove([id])                  // 删元数据 + allMusicList + 滚动位置/更新信息
        ├─ updateUserList()                       // saveUserList + state_event.mylistUpdated
        ├─ removeListMusics([id])                 // 删 @list__<id>
        ├─ app_event.myListMusicUpdate([id])
        ├─ emit('list_remove', [id])
        └─ checkListExist([id])                   // 若删的是激活列表 → setActiveList('default')
```

### 4.5 同步模块的接入（design-doc §5.6）

`plugins/sync/listEvent.ts` 同时做了两件事：

- `registerListActionEvent(sendListAction)`：订阅 `list_event` 全部 12 个动作，本地操作后把动作序列化推送远端（`isRemote === true` 的动作跳过，防止回环；`TEMP` 列表相关动作被过滤）。
- `handleRemoteListAction({ action, data })`：收到远端动作后以 `isRemote = true` 重新调用 `global.list_event.xxx(...)`，走同一条执行链路（落盘 + 广播），保证本地与远端行为一致。
- `getLocalListData()` / `setLocalListData()`：构建/恢复 `ListDataFull` 形态的同步数据。

---

## 5. 导入导出 / 备份恢复

### 5.1 类型契约（`src/types/list.d.ts`）

```ts
type ListSaveType = 'myList' | 'downloadList'
type ListSaveInfo =
  | { type: 'myList',       data: Partial<MyAllList> }
  | { type: 'downloadList', data: LX.Download.ListItem[] }
```

- `ListSaveType` 区分"我的列表"与"下载列表"两类备份；
- `Partial<MyAllList>`：导出时把各列表元信息与歌曲合并（内部用 `ListDataFull` / `*Full` 形态，见 `plugins/sync/listEvent.ts` 的 `buildUserListInfoFull`）；
- 文件扩展名：`json` / `lxmc` / `bin`（`LXM_FILE_EXT_RXP`，`src/config/constant.ts`）。

### 5.2 恢复路径

- **整库恢复**：`overwriteListFull(listData)` → `list_event.list_data_overwrite`（`ListEvent` 中先 `fixListIdType` 修复数字 id，再 `listDataOverwrite` 重建 `allMusicList` 与 `userLists`，清理被删除的列表存储，重写 `@list_scroll_position` / `@list_update_info`，最后广播 `app_event.myListMusicUpdate(changedIds)` + `checkListExist`）。
- **单列表恢复**：`overwriteList(listInfoFull)`：内置列表只覆盖歌曲；用户列表先 `updateUserList` 更新元信息再 `overwriteListMusics`。
- **文件深链导入**：`core/init/deeplink/fileAction.ts` 的 `handleFileLXMCAction` 处理 `json` / `lxmc` 文件（见 [navigation.md](./navigation.md) §9.2）。

### 5.3 备份文件格式与设置页实现

设置 → 备份（`src/screens/Home/Views/Setting/settings/Backup/actions.ts`）是导入导出的完整参考实现：

- **导出**：`handleExportList(path)` → `exportAllList` 输出 `lx_list.lxmc` 文件：

```jsonc
// lx_list.lxmc（实际为 JSON 文本，键序经 buildUserListInfoFull 类逻辑统一）
{
  "type": "playList_v2",
  "data": [
    { "id": "default", "name": "试听列表", "list": [ /* MusicInfo[] */ ] },
    { "id": "love", "name": "我的收藏", "list": [ /* MusicInfo[] */ ] },
    { "id": "userlist_xxx", "name": "...", "source": "kw",
      "sourceListId": "123", "locationUpdateTime": 1700000000000, "list": [] }
  ]
}
```

- **导入**：`handleImportList(path)` 按文件 `type` 字段分发（兼容多代格式）：

| type | 含义 | 处理 |
|------|------|------|
| `defautlList`（原代码拼写） | 0.6.2 及以前单列表 | `overwriteListMusics(LIST_IDS.DEFAULT, ...)` |
| `playList` / `allData` | 旧版列表/全量 | `importOldListData`（`toNewMusicInfo` 转换） |
| `playList_v2` / `allData_v2` | 新版列表/全量 | `importNewListData`（`fixNewMusicInfoQuality` 转换）→ `overwriteListFull` |
| `playListPart` / `playListPart_v2` | 单列表局部导入 | `handleImportListPart` → 存在则确认覆盖（`overwriteList`），否则 `createList` 新建 |

导入时对新数据做 `filterMusicList`（过滤无效条目）与 `fixNewMusicInfoQuality` / `toNewMusicInfo`（音质字段修复/形态转换），保证旧数据可安全落库。恢复本质就是调用 §3 的 `overwriteListFull` / `overwriteList` / `createList`，因此与同步恢复（§4.5）走同一套底层链路。

---

## 6. 播放与列表的关系

### 6.1 激活列表（activeListId）

- `store/list/state.ts` 的 `activeListId` 标记当前在"我的列表"页展示/播放的列表。
- `core/list.setActiveList(id)`：`listAction.setActiveList` → `state_event.mylistToggled(id)`，并 `saveListPrevSelectId(id)`（`@list_prev_select_id`，下次启动恢复）。
- 启动时 `core/init/dataInit.ts`：`setUserList(await getUserLists())` 恢复列表元数据；`setNavActiveId((await getViewPrevState()).id)` 恢复上次所在 tab。

### 6.2 播放上下文（PlayMusicInfo / PlayInfo）

- `LX.Player.PlayMusicInfo`：`{ musicInfo, listId, isTempPlay }` —— 当前播放歌曲**及其来源列表**（`store/player/state.ts` 的 `playMusicInfo`）。
- `LX.Player.PlayInfo`：`{ playIndex, playerListId, playerPlayIndex }` —— 播放位置状态（`store/player/action.ts` 的 `updatePlayIndex` / `setPlayListId` 更新）。
- 播放器每次切歌都会以"列表 id + 索引"持久化 `SavedPlayInfo`（`@play_info`，`utils/data.ts` 的 `savePlayInfo`）。

### 6.3 启动恢复（`src/core/init/player/playInfo.ts`）

```
getPlayInfo() → global.lx.restorePlayInfo = info
  → getListMusics(info.listId)        // 从缓存/存储取回列表歌曲
  → playList(info.listId, info.index) // 恢复播放位置
  → setting['player.startupAutoPlay'] && setTimeout(play)  // 可选自动播放
```

即"播放恢复"依赖列表恢复先行（`dataInit` 在播放器恢复前执行，design-doc §3.4.1 启动管道中 `dataInit` 在 `initPlayer` 之后、但播放器恢复属于 `init/player` 内部时序）。

### 6.4 添加位置策略（addMusicLocationType）

- `LX.AddMusicLocationType = 'top' | 'bottom'`（`src/types/app_setting.d.ts`）。
- 默认取自设置 `'list.addMusicLocationType'`（`core/list.createList` 中 `settingState.setting['list.addMusicLocationType']`）。
- 实现：`utils/listManage.listMusicAdd` 用 `arrUnshift` / `arrPush` 插入，并先去重（同 id 不重复添加）。

### 6.5 播放器对列表变更的响应

播放器/下载等下游订阅 `app_event.myListMusicUpdate(ids)`：当正在播放的列表歌曲变化（尤其当前播放歌曲被删除）时，由 `core/player` 依据 `playMusicInfo.listId` 与 `playInfo.playerListId` 决定是否切歌/兜底（对应 design-doc §5.1"播放列表状态机"）。`core/init/player/watchList.ts` 是具体实现之一：收到变更后用 `updatePlayIndex`（`core/player/playInfo`）校正播放索引；`core/player/utils.ts` 的 `getListMusicSync`（同步读 `allMusicList`）供播放器在切歌路径中取列表。

### 6.6 临时列表（temp）的使用场景

`setTempList(id, list)`（`core/list.ts`）把歌曲写入 `LIST_IDS.TEMP` 并记录 `tempListMeta.id`，用于"在线歌单试听/深链播歌单"这类不污染用户列表的播放：

- `src/screens/SonglistDetail/listAction.ts`：歌单详情页"试听全部"。
- `src/screens/Home/Views/Leaderboard/listAction.ts`：排行榜"试听全部"。
- `src/core/init/deeplink/playSonglist.ts`：深链播放歌单时若目标与当前临时列表不同则重建。

配合 `store/player` 的 `isTempPlay` 标记与 `tempPlayList`（稍后播放队列，`store/player/action.ts` 的 `addTempPlayList` / `clearTempPlayeList`），"临时列表"与"稍后播放"共同构成 ADR-8 中与正式列表分离的播放数据面。

---

## 7. 新增列表类型的扩展步骤

以新增一种内置列表类型（如 `'recent'` 最近播放列表，类比 `love`）为例：

1. **类型**：`src/types/list.d.ts` 增加 `MyRecentListInfo` 并在 `MyAllList`、`ListDataFull` 等聚合类型中登记。
2. **常量**：`src/config/constant.ts` 的 `LIST_IDS` 增加 `RECENT: 'recent'`。
3. **store**：`src/store/list/state.ts` 增加 `recentList` 字段与默认值；`store/list/action.ts` 增加对应 setter（并在 `setUserLists` 重建 `allList` 时纳入）。
4. **内存操作**：`src/utils/listManage.ts` 在 `listDataOverwrite`、`checkUpdateList` 涉及的 id 集合（`[LIST_IDS.DEFAULT, LIST_IDS.LOVE, ...]`）中补充新 id（注意 `ListEvent.list_data_overwrite` 中 `allListIds` 的构建逻辑）。
5. **事件流**：无需新增事件——歌曲变更仍走 `app_event.myListMusicUpdate`、元数据走 `state_event.mylistUpdated`；若新增**独立动作**（如"清空最近播放"），在 `ListEvent` 增加方法并在 `core/list.ts` 暴露包装函数。
6. **持久化**：确认 `saveListMusics` / `removeListMusics` 的调用路径覆盖新 id（若需要独立存储键，在 `utils/data.ts` 增加封装）。
7. **UI**：`store/list/hook.ts` 增加 `useRecentList` 等 hook；`useMyList` 若需展示 i18n 名称，同步处理（见疑点 1）。

> 若只是**新增用户可见的普通列表**，无需以上全部：直接调 `core/list.createList(...)` / `addListMusics(...)` 即可，元数据与歌曲自动走现有链路。

---

## 8. 常见问题排查（FAQ）

| 现象 | 排查路径 |
|------|---------|
| 列表改了但界面不刷新 | 检查是否绕过了 `core/list` 直接改 `store/list/state` 或 `utils/listManage` 的数组——界面刷新依赖 `state_event.mylistUpdated`（元数据）与 `app_event.myListMusicUpdate`（歌曲）；两路广播都在 `list_event` 动作方法内完成 |
| 删除歌曲后正在播放的歌曲也"消失" | `app_event.myListMusicUpdate` 的消费者（如 `watchList.ts`）按 `playMusicInfo.listId` 过滤；若删的是当前播放列表且未触发 `playerListId` 兜底，检查 `core/player` 的索引校正逻辑 |
| 同步后列表对不上 | 同步动作带 `isRemote` 防回环；确认本地操作走 `registerListActionEvent` 已注册的通道，且未手动对 `plugins/sync` 传入 `isRemote: true` 的本地操作 |
| 导入备份后列表重复/丢失 | 备份恢复是**整体覆盖**语义（`overwriteListFull` 会清理不在新数据中的列表）；局部导入（`playListPart`）才是合并语义。误用整体恢复覆盖了本地列表属于预期行为 |
| 某列表歌曲读出来是空 | `@list__<id>` 键不存在 → `getListMusics` 返回 `[]` 并缓存空数组；确认写入路径（`checkUpdateList` 的 `saveListMusics`）是否覆盖了该 id（新列表类型易漏，见 §7 步骤 5/6） |
| 大列表（千首级）操作卡顿 | 存储分片（ADR-6）只在序列化超 500000 字符时生效；`saveListMusics` 为批量 `saveDataMultiple`，频繁单曲操作注意节流（参考 `utils/data.ts` 的 throttle 模式） |

## 9. 疑点与注意事项（需人工核对）

1. **内置列表名硬编码 + i18n 覆盖**：`MyDefaultListInfo.name = '试听列表'` 写在类型与 state 中，UI 层 `useMyList` 用 `global.i18n.t(...)` 直接改写 `state.allList[0].name`（引用同一对象）。新增加入 `allList` 的内置列表时必须同步该 hook，否则名称不随语言切换。
2. **TEMP 列表的"半参与"**：`ListDataFull.tempList` 可选；`list_data_overwrite` 只在 `tempList` 存在且缓存已有 TEMP 时才标记 changed；同步侧（`plugins/sync/listEvent.ts`）过滤所有涉及 TEMP 的动作——即**临时列表不跨设备同步**。
3. **`list_event` 是动作通道而非纯通知**：调用 `global.list_event.xxx()` 会直接执行修改 + 落盘 + 广播；`isRemote` 参数只用于区分来源，不改变执行语义。
4. **事件在持久化之后才 emit**：若 `saveListMusics` 抛错（如存储满），`list_event` 的 emit 与 UI 广播都不会执行，操作表现为"无响应"——错误处理依赖上层 try/catch。
5. **`checkListExist` 只回退激活列表**：删除列表不会自动删除正在播放列表中的歌曲，播放器的兜底由 `app_event.myListMusicUpdate` 消费者各自处理。
6. **`fixListIdType` 兼容逻辑**：`listEvent.ts` 与 `utils/data.getUserLists` 各自处理了 v2.3.0 之前的数字 id 问题（`.0` 后缀），新增导入路径时需保持一致的修复策略。
7. **`store/list/state.allMusicList` 是遗留字段**：类型声明里存在，但运行时从未被写入（`grep allMusicList` 可见：写入方只有 `utils/listManage.ts` 的模块级 Map）；`store/list/state.ts` 的该字段与真实缓存**不是同一引用**。勿使用该字段，统一走 `core/list` / `list_event` 链路与 `getListMusics` 读取。
