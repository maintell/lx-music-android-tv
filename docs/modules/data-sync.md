# 数据同步体系（Data Sync）

> 读者获益：本文档帮你理清「我的列表 / 不喜欢列表」是如何通过 lx-music-sync-server 在多端之间同步的——包括从启用到连上服务器的完整链路、客户端分层结构、事件采集与 RPC 消息协议，以及调试入口。读完本文你能独立排查「同步连不上」「同步不生效」「同步模式如何选择」三类问题，也知道哪些协议细节需要对照服务端仓库确认。

## 设计依据

本文档对应 [design-doc.md](../design-doc.md) 的以下内容：

- **5.6 数据同步（core/sync + plugins/sync）**：模块边界——`plugins/sync/client/` 是 lx-music-sync-server 的 WebSocket 客户端（`auth.ts` / `client.ts` / `utils.ts`），支持 `list`、`dislike`、`sync` 三个数据模块；`plugins/sync/` 承载本地事件采集、数据序列化、日志与常量；`core/sync.ts` 负责同步状态管理与同步模式选择弹窗流程；启用开关为 `sync.enable`（默认关闭），状态经 `state_event.syncStatusUpdated` 广播。
- **2.2 非功能约束 — 低侵入同步**：数据同步为可选开关，默认关闭；同步失败不影响本地使用。
- **1.2 核心目标 — 本地优先**：用户数据默认存储在本地，可通过可选的数据同步服务跨设备同步。

> 说明：本文所述协议细节（消息格式、服务端行为）以客户端源码为准；凡客户端代码注释缺失、只能推断的部分，均标注「**需对照 lx-music-sync-server 仓库确认**」。系统分层总览见 [architecture.md](../architecture.md)。

## 1. 同步设计目标

- **配套服务端**：客户端只对接 `lx-music-sync-server`（独立仓库），支持 `server` 与 `desktop-app`（桌面版）两类服务端类型（见 `src/types/sync.d.ts` 的 `ServerType`）。
- **同步内容**：我的列表（内置 default/love + 用户自建列表，临时列表 temp 除外）与不喜欢列表两个数据域。
- **低侵入**：`sync.enable` 默认关闭（`src/config/defaultSetting.ts`），启动时若未开启则完全跳过同步初始化；连接失败仅提示、不影响本地使用。
- **增量生效**：连接成功后本地任何列表/不喜欢变更都会被采集并实时推送到服务端，服务端下发的远端变更也会应用到本地。

## 2. 启用开关与核心流程

### 2.1 设置项

| 设置键 | 默认值 | 含义 |
|--------|--------|------|
| `sync.enable` | `false` | 同步总开关，持久化于设置存储（`@setting_v1`） |

同步相关的本地持久化数据（存储 key 见 `src/config/constant.ts`）：

| key | 内容 |
|-----|------|
| `@sync_host` | 服务端地址（http/https 链接） |
| `@sync_auth_key` | 按 serverId 保存的认证信息 `LX.Sync.KeyInfo`（`clientId` / `key` / `serverName`） |
| `@sync_host_history` | 历史地址列表（最多 20 条，`src/utils/data.ts`） |

> 注意：`constant.ts` 中 `storageDataPrefixOld`（v0.x 旧版 key）与新版 key 相同，同步三项无迁移差异；`src/config/migrateSetting.ts` 中 `sync.enable` 仅做对象属性 → 点分键的扁平化迁移。

### 2.2 启动流程（initSync）

初始化管道（`src/core/init/index.ts`）在 `initCommonState` 之后执行 `initSync`（`src/core/init/sync.ts`）：

```
initSync(setting)
  ├─ setting['sync.enable'] === false → 直接返回（不连接）
  ├─ getSyncHost() 读取 @sync_host
  │    └─ 无 host → updateSetting({ 'sync.enable': false }) 自动关闭开关
  └─ connectServer(host)（不传 authCode，走已有认证信息）
```

注意 `initSync` 是 `void` 调用（不 await）：同步初始化失败不阻塞启动流程（低侵入约束）。

### 2.3 用户手动启用流程（设置页）

设置入口：`src/screens/Home/Views/Setting/settings/Sync/index.tsx`（`IsEnable.tsx` + `History.tsx`）。

`IsEnable.tsx` 的交互流程：

1. 勾选「启用同步」→ `handleSetEnableSync(true)`：写 `sync.enable` → `addSyncHostHistory(host)` → `connectServer(host)`。
2. `connectServer` 失败（如缺认证码）会通过 `syncStatusUpdated` 把 `SYNC_CODE.missingAuthCode` / `authFailed` 等消息回传，UI 据此弹出认证码输入框（`ConfirmAlert`），确认后 `connectServer(host, authCode)` 重试。
3. 取消勾选 → `disconnectServer()`。
4. 地址输入框：校验 `^https?:\/\/\S+`，合法才写入；连接期间输入框禁用。
5. 状态文本：`status` memo 按 message 优先级展示——`Blocked IP` / `Auth failed` 显示本地化文案，其它情况显示 message 原文，无 message 时按 `status` 显示「已连接/未连接」。

`SyncModeModal` 标题中的服务端名称（`serverName`）来自认证返回的 `KeyInfo.serverName`，随 `setServerInfo` 写入 `store/sync/state`。

### 2.4 历史地址管理（History.tsx）

- 「历史记录」按钮（同步未启用时可用）弹出 Popup 列表（`setting_sync_history_title`）。
- 点击条目 → `setSyncHost(item)` 写入 `@sync_host` 并回填输入框；删除条目 → `removeSyncHostHistory(index)`。
- 空列表显示 `setting_sync_history_empty`。

### 2.5 连接核心链路

`src/plugins/sync/client/index.ts` 的 `connectServer(host, authCode?)`：

```
sendSyncStatus({ status: false, message: 'Connecting...' })
  → disconnectServer(false)（断开旧连接，但不重置状态）
  → parseUrl(host) 解析为 UrlInfo（https 自动映射 wss / http 映射 ws）
  → handleAuth(urlInfo, authCode)   // 认证，见 §3
  → socketConnect(urlInfo, keyInfo) // 建立 WebSocket，见 §4
失败 → sendSyncStatus({ status: false, message: err.message })，部分错误仅告警不打断（SYNC_CODE.connectServiceFailed / missingAuthCode）
```

`connectId` 自增计数用于防止并发连接竞态：每次 `connectServer` 都会使 `connectId` 变化，异步步骤之间用 `id != connectId` 判断本次操作是否已被更新的连接取代。

### 2.6 对外 API 面（`plugins/sync/index.ts`）

| 导出 | 来源 | 说明 |
|------|------|------|
| `connectServer(host, authCode?)` | `client/index.ts` | 连接（含认证），失败 reject 并回传状态消息 |
| `disconnectServer(isResetStatus?)` | `client/index.ts` | 断开；`isResetStatus=true`（默认）时重置状态并清空 message |
| `getStatus()` | `client/client.ts` | 返回当前 `LX.Sync.Status` |
| `setSyncMessage(message)` | `core/sync.ts` | 手动设置状态消息（认证码弹窗取消后清空 message 用） |

另有两类内部状态写入：`sendSyncStatus`（client.ts 内，状态+消息）与 `setSyncStatus`（core/sync 转发到 store action）。

## 3. 客户端架构

### 3.1 目录结构

```
src/plugins/sync/
├── constants.ts        # 协议常量（SYNC_CODE / SYNC_CLOSE_CODE / LIST_IDS / TRANS_MODE / File / FeaturesList / ENV_PARAMS）
├── data.ts             # 认证信息与 host 持久化（转发 @/utils/data）
├── listEvent.ts        # 列表域：本地数据读取/写入 + 本地事件采集 + 远端动作分发
├── dislikeEvent.ts     # 不喜欢域：同上
├── log.ts              # 同步日志（受 global.lx.isEnableSyncLog 控制）
├── utils.ts            # AES / RSA 加解密（对接原生 crypto 模块）
├── index.ts            # 对外入口：connectServer / disconnectServer / getStatus
└── client/
    ├── index.ts        # connectServer / disconnectServer 编排（认证 + 建连）
    ├── auth.ts         # hello → /id → /ah 三步认证
    ├── client.ts       # WebSocket 连接、心跳、重连、message2call RPC 收发、状态维护
    ├── utils.ts        # request（带超时）、gzip 压缩（cg_）、parseUrl
    ├── modules/        # 数据模块（list / dislike），见 §3.2
    │   ├── index.ts    # callObj 合并各模块 handler；modules 清单；featureVersion
    │   ├── list/
    │   │   ├── index.ts       # 导出 handler + localEvent
    │   │   ├── handler.ts     # 暴露给服务端调用的方法（list_sync_* 系列）
    │   │   └── localEvent.ts  # 注册/注销本地事件转发
    │   └── dislike/（同上三件套）
    └── sync/
        ├── index.ts    # callObj = sync handler + modules callObj
        └── handler.ts  # getEnabledFeatures（特性协商）
```

### 3.2 数据模块的 index / handler / localEvent 三件套

每个数据模块（`modules/list`、`modules/dislike`）固定由三个文件组成：

| 文件 | 职责 |
|------|------|
| `index.ts` | 导出 `handler` 与 `localEvent` 的公共 API，是模块对外唯一入口 |
| `handler.ts` | **服务端可调用的 RPC 方法集**（`list_sync_*` / `dislike_sync_*`）。第一个参数固定为当前 socket 对象（`WarpSyncHandlerActions` 注入），方法名即消息路由名 |
| `localEvent.ts` | 订阅本地事件总线（`list_event` / `dislike_event`），把本地变更打包成 action 通过 socket 发送；连接关闭时注销 |

> design-doc 风险清单第 7 条提示：`client/` 下 `modules/{list,dislike}/` 与顶层 `sync/` 并存，**以 `client/modules/index.ts` 为实际入口核对**。`client/sync/index.ts` 只是把 sync 级 handler（`getEnabledFeatures`）与各模块 handler 合并成最终 `callObj`，供 `client.ts` 的 message2call 注册。

### 3.3 handler 与 localEvent 的协作

```
本地用户操作列表
  → core/list 触发 global.list_event.<action>(data, isRemote=false)
  → modules/list/localEvent.ts 的 registerListActionEvent(sendListAction)
       └─ 过滤 isRemote / temp 列表（防止回环）
       └─ 经 socket.remoteQueueList.onListSyncAction(action) 发给服务端（队列化 RPC）
  → 服务端处理后再广播给其它设备
  → 本端收到远端 action：client.ts message2read → onListSyncAction → handleRemoteListAction(action)
       └─ 以 isRemote=true 调用 global.list_event.<action>，localEvent 侧因 isRemote=true 跳过转发，避免回环
```

**防回环机制**：所有本地事件监听器都以 `isRemote` 标记区分来源——本地触发（false）才向服务端发送；远端下发的动作（true）直接应用并跳过转发。

### 3.4 数据模块清单

| 模块 | 同步内容 | 本地事件 | handler（RPC 方法） |
|------|----------|----------|---------------------|
| `list` | 我的列表：defaultList / loveList / userList（不含 tempList） | `global.list_event` 的 11 个动作：`list_data_overwrite`、`list_create`、`list_remove`、`list_update`、`list_update_position`、`list_music_overwrite`、`list_music_add`、`list_music_move`、`list_music_remove`、`list_music_update`、`list_music_clear` | `list_sync_get_md5`、`list_sync_get_sync_mode`、`list_sync_get_list_data`、`list_sync_set_list_data`、`list_sync_finished`、`onListSyncAction` |
| `dislike` | 不喜欢规则文本（`LX.Dislike.DislikeRules`，即 dislikeInfo.rules） | `global.dislike_event` 的 3 个动作：`dislike_data_overwrite`、`dislike_music_add`、`dislike_music_clear` | `dislike_sync_get_md5`、`dislike_sync_get_sync_mode`、`dislike_sync_get_list_data`、`dislike_sync_set_list_data`、`dislike_sync_finished`、`onDislikeSyncAction` |

两个模块的协议行为对称（md5 → 同步模式 → 全量数据 → 完成 → 增量事件），类型契约见 `src/types/sync_common.d.ts`（`ClientSyncHandlerListActions` / `ClientSyncHandlerDislikeActions`）。

### 3.5 client.ts 内部职责

| 子模块 | 职责 |
|--------|------|
| `message2read` | `createMsg2call<ServerSyncActions>`：解析服务端 RPC 调用（120s 超时）；`onCallBeforeParams` 注入 socket 为第一个参数；`onError` 打 `r_error` 日志 |
| `remote` / `remoteQueueList` / `remoteQueueDislike` | 客户端主动调用的 RPC 代理；后两者按模块队列化（`createQueueRemote`），保证同模块 action 串行有序 |
| `heartbeatTools` | ping 心跳、`reConnnect` 重连、连接超时兜底（详见 §4.3） |
| `client.onClose` | 订阅关闭事件的工具函数（返回取消订阅函数），供各 handler 注册清理逻辑 |
| `disconnect` | 关闭 socket（normal 码）、清空心跳计时器与失败计数 |

## 4. 同步协议要点

> 客户端与服务端的消息交互基于 `message2call` 库（RPC over WebSocket，见 `client.ts` 的 `createMsg2call`）。所有 RPC 调用带 120 秒超时。

### 4.1 协议常量（`constants.ts`）

| 常量 | 值 | 用途 |
|------|-----|------|
| `SYNC_CODE.helloMsg` | `Hello~::^-^::~v4~` | 握手标识（含协议版本 `v4`） |
| `SYNC_CODE.idPrefix` | `OjppZDo6` | 服务端 `/id` 接口返回的 id 前缀 |
| `SYNC_CODE.authMsg` | `lx-music auth::` | 认证消息体前缀 |
| `SYNC_CODE.msgConnect` | `lx-music connect` | WebSocket 查询参数 `t` 中加密的标识 |
| `SYNC_CODE.msgAuthFailed` / `msgBlockedIp` | `Auth failed` / `Blocked IP` | 认证失败 / IP 被屏蔽 |
| `SYNC_CLOSE_CODE.normal` / `failed` | `1000` / `4100` | 正常关闭 / 异常关闭 |
| `TRANS_MODE` | 双向往返映射 | 同步模式的"反向模式"换算表 |
| `FeaturesList` | `['list', 'dislike']` | 可启用特性列表 |
| `File` | serverInfo.json / users / devices.json / list/snapshot / dislike/snapshot 等 | 服务端文件布局（客户端侧仅为常量声明） |

### 4.2 认证流程（`client/auth.ts`）

三步认证（均为 HTTP 请求，`client/utils.ts` 的 `request` 带 10s 超时）：

| 步骤 | 接口 | 行为 |
|------|------|------|
| 1. hello | `GET {host}/hello` | 返回恰为 `Hello~::^-^::~v4~` 则通过；若返回其它 `Hello~::^-^::vN` 版本串，解析版本号比对——服务端版本高于客户端抛 `highServiceVersion`，低于则抛 `lowServiceVersion`；其它情况视为未通过 |
| 2. getServerId | `GET {host}/id` | 返回 `OjppZDo6<serverId>`，剥离前缀得到 serverId |
| 3a. codeAuth | `POST {host}/ah` | 输入了 authCode 时：`key = md5(authCode).substring(0,16)` base64 后作为 AES-128-ECB 密钥，加密 `authMsg + 公钥 + 设备名 + lx_music_mobile` 放 header `m`；响应用 RSA 私钥解密得到 `KeyInfo { clientId, key, serverName }` 并持久化 |
| 3b. keyAuth | `POST {host}/ah` | 已有 KeyInfo 时：用已有 key 加密 `authMsg + 设备名` 放 header `m`、`clientId` 放 header `i`；响应解密后须等于 `helloMsg` |

> 加解密细节：`sync/utils.ts` 使用 `@/utils/nativeModules/crypto` 的 `aesEncryptSync / rsaEncryptSync`（AES-128-ECB、RSA-OAEPWithSHA1AndMGF1Padding），替代被注释的 Node crypto 实现；另有 `react-native-quick-base64` 做 base64。

### 4.3 WebSocket 交互（`client/client.ts`）

- **连接地址**：`{ws|wss}://{hostPath}/socket?i=<clientId>&t=<aes(msgConnect, key)>`。
- **消息格式**：`message2call` 结构化 RPC；传输前 `encryptMsg`——消息体超过 1024 字符则 gzip 并加 `cg_` 前缀（`client/utils.ts`），否则明文；接收时按 `cg_` 前缀决定解压。**注意：当前实现的 gzip 压缩不加密，密钥仅用于查询参数 `t` 与认证，实际 RPC 载荷明文传输——需对照 lx-music-sync-server 确认其是否加密校验**。
- **心跳**：服务端周期下发 `ping` 文本；客户端 `heartbeatTools.heartbeat()` 每次收到 ping 后重置 30s+1s 的 `pingTimeout`，超时未收到 ping 则主动 close（异常码）。
- **重连策略**：非 normal/failed 关闭码触发 `reConnnect()`——失败次数 `failedNum` 递增，等待 `min(2000 + floor(failedNum/2)*3000, 30000)` ms 后重连；连接建立另有 2 分钟 `connectTimeout` 兜底；`failedNum > maxTryNum(100000)` 时放弃并上报 `Connect error`。
- **模块就绪**：`socket.moduleReadys = { list: false, dislike: false }`，各模块 `*_sync_finished` 后置 true，此后该模块的本地事件才允许发送；`socket.isReady` 由 `finished()`（sync 级）置 true。
- **队列化发送**：`remoteQueueList` / `remoteQueueDislike` 由 `createQueueRemote('list'|'dislike')` 创建，保证同类 action 串行、有序送达。
- **状态回调**：`finished()` 弹 toast「Sync connected」并 `sendSyncStatus({ status: true })`。

### 4.4 同步握手时序（模块级）

```
服务端 → 客户端: getEnabledFeatures(serverType, supportedFeatures)
客户端 → 服务端: { list: {skipSnapshot: false}, dislike: {skipSnapshot: false} }（版本号 featureVersion 匹配才启用）

每个模块（以 list 为例）：
服务端 → 客户端: list_sync_get_md5
客户端 → 服务端: md5(JSON.stringify(本地列表数据))
服务端 → 客户端: list_sync_get_sync_mode        // 服务端判定两端不一致时询问
客户端 → 服务端: selectSyncMode() 的返回值（弹窗选择结果）
服务端 → 客户端: list_sync_get_list_data | list_sync_set_list_data   // 按模式方向拉取/下发全量数据
服务端 → 客户端: list_sync_finished              // 模块就绪，此后进入增量事件阶段
```

> 谁拉取、谁推送、md5 如何比较、快照（snapshot）如何组织——这些判定逻辑在服务端，**需对照 lx-music-sync-server 仓库确认**。客户端侧仅暴露上述方法供服务端按序调用（`featureVersion.list/dislike = 1`，`skipSnapshot: false` 表示不使用服务端快照跳过策略）。

### 4.5 状态消息与 UI 反馈映射

`IsEnable.tsx` 对 `syncStatus.message` 的消费：

| message | UI 行为 |
|---------|---------|
| `Auth failed` | toast `setting_sync_code_fail`，并弹出认证码输入框 |
| `Missing auth code` | 弹出认证码输入框 |
| `Blocked IP` | toast `setting_sync_code_blocked_ip` |
| 其它 | 原样显示在状态文本 |

## 5. 事件采集（listEvent / dislikeEvent）

### 5.1 本地数据读写

| 函数 | 位置 | 行为 |
|------|------|------|
| `getLocalListData()` | `listEvent.ts` | 并行读取 `default`、`love`、所有 `userLists` 的歌曲，返回 `LX.Sync.List.ListData`（不含 tempList） |
| `setLocalListData(data)` | `listEvent.ts` | 触发 `global.list_event.list_data_overwrite(data, true)`（远端语义） |
| `buildUserListInfoFull()` | `listEvent.ts` | 固定字段顺序构建用户列表信息，保证 md5 一致性 |
| `getLocalDislikeData()` | `dislikeEvent.ts` | 返回 `state.dislikeInfo.rules`（不喜欢规则文本） |
| `setLocalDislikeData(rules)` | `dislikeEvent.ts` | 触发 `global.dislike_event.dislike_data_overwrite(rules, true)` |

### 5.2 采集与过滤规则

- `registerListActionEvent(sendListAction)` 订阅 `list_event` 全部 11 个动作；`isRemote=true` 一律跳过。
- **temp 列表（`LIST_IDS.TEMP`）不参与同步**：`list_music_overwrite` / `list_music_remove` / `list_music_update_position` 对 `temp` 直接 return；`list_music_update` 先过滤掉 temp 项，剩余为空则 return。
- `registerDislikeActionEvent` 订阅 `dislike_event` 3 个动作，同样按 `isRemote` 过滤。
- 两处 `localEvent.ts` 在发送失败时：`moduleReadys.<模块> = false` 并 `socket.close(SYNC_CLOSE_CODE.failed)`（失败即断开，等待重连重来）。

### 5.3 远端动作分发

- `handleRemoteListAction`（`listEvent.ts`）：按 `action` switch 后以 `isRemote=true` 调用 `global.list_event` 对应方法；未知 action 抛 `unknown list sync action`。
- `handleRemoteDislikeAction`（`dislikeEvent.ts`）：同上，未知 action 抛 `unknown dislike sync action`。

## 6. 状态管理（store/sync）

遵循设计文档 3.4.2 的「state / action / hook」三文件模式：

| 文件 | 内容 |
|------|------|
| `state.ts` | `status: LX.Sync.Status { status, message }`、`serverName`、`type`（'list' \| 'dislike'）、`syncModeComponentId` |
| `action.ts` | `setStatus` / `setMessage`（写状态并广播 `state_event.syncStatusUpdated`）、`setServerInfo`、`setSyncModeComponentId` |
| `hook.ts` | `useStatus()`：订阅 `syncStatusUpdated` 返回当前状态；UI 据此显示连接状态文本 |

事件：`state_event.syncStatusUpdated({ status, message })`（`src/event/stateEvent.ts` 类型化触发）。

状态流转示例：

- `connectServer` 开始 → `{ status: false, message: 'Connecting...' }`
- 模块就绪完成 → `{ status: true, message: '' }`（设置页显示「已连接」）
- 断开 → `{ status: false, message: '' }`（设置页显示「未连接」）
- 认证失败 / IP 屏蔽 → message 为 `Auth failed` / `Blocked IP`，`IsEnable.tsx` 据此 toast 或弹认证码输入框

## 7. 同步模式选择（SyncModeModal）

### 7.1 模式类型

`src/types/list_sync.d.ts` / `dislike_list_sync.d.ts`：

| 模式 | 含义（客户端视角） |
|------|--------------------|
| `merge_local_remote` / `merge_remote_local` | 合并，方向分别指向「以本地为主合并到远端」/「以远端为主合并到本地」（具体合并规则由服务端实现） |
| `overwrite_local_remote` / `overwrite_remote_local` | 覆盖，方向分别为本地→远端 / 远端→本地 |
| `overwrite_local_remote_full` / `overwrite_remote_local_full` | 覆盖的「完整」变体（list 模块专有；SyncModeModal 勾选「完整覆盖」后追加 `_full` 后缀） |
| `cancel` | 取消同步流程（reject） |

`TRANS_MODE` 常量提供模式的双向映射（用于服务端换算反向模式；客户端 `client.ts` 中未直接使用，**用途需对照服务端确认**）。

### 7.2 selectSyncMode 流程（`src/core/sync.ts`）

```
selectSyncMode(serverName, type)
  ├─ removeSyncModeEvent() 清除旧的等待
  ├─ syncActions.setServerInfo(serverName, type)   // 供弹窗显示标题
  ├─ showSyncModeModal()                           // RNN overlay 弹出 SyncModeModal
  ├─ 监听 global.app_event 'selectSyncMode'
  │    └─ 收到 { mode } → 关弹窗、resolve(mode)
  ├─ onModalDismissed(syncModeComponentId) 兜底 → reject(new Error('cancel'))
  └─ socket.onClose 时 removeSyncModeEvent()（handler.ts 中注册）
```

`SyncModeModal.tsx` 根据 `syncState.type` 渲染列表模式或不喜欢模式两套按钮组；点按模式按钮调用 `global.app_event.selectSyncMode({ type, mode })`（list 模式先经 `_full` 后缀判断：勾选「完整覆盖」时对 overwrite 模式追加 `_full`）。cancel 按钮也走同一事件、模式为 `cancel`。

> 模式选择是**客户端侧交互**：服务端先询问（`*_sync_get_sync_mode`），客户端弹窗让用户选，返回值交给服务端执行。注意 `*_sync_get_sync_mode` 只有服务端判定两端数据不一致时才会调用——判定逻辑在服务端。

## 8. 日志与调试

- 全局开关：`global.lx.isEnableSyncLog`（默认 false，`src/config/globalData.ts`；设置页「其他 → 日志」中切换，`Other/Log.tsx`）。
- `src/plugins/sync/log.ts`：两类方法——`r_info/r_warn/r_error` 无条件写日志（重要错误，如认证失败、RPC 异常），`info/warn/error` 仅在 `isEnableSyncLog` 为 true 时写入；底层统一走 `@/utils/log` 写入 `error.log`。
- 调试线索：`client.ts` 的 `console.log('open')`、`dateFormat(...) + 'reconnnect...'`、`heartbeatTools connect`；`auth.ts` 的 `[auth] hello/getServerId/codeAuth/keyAuth` 前缀日志。
- 常见失败排查：`Connect error`（重连次数超限）、`Auth failed`（认证码错误/密钥不符）、`Blocked IP`（服务端封禁）、`low/highServiceVersion`（版本不匹配）。

### 8.1 排查清单

| 症状 | 排查方向 |
|------|----------|
| 勾选同步无反应 | `sync.enable` 是否写入；`@sync_host` 是否存在（`initSync` 无 host 会自动关闭开关） |
| 一直 Connecting... | 服务端地址不可达 / 端口未开放；`parseUrl` 后 `ws` 协议是否正确 |
| 弹认证码框 | `@sync_auth_key` 缺失（`missingAuthCode`）或已失效（`authFailed`） |
| 同步一会就断开 | 心跳超时（30s 无 ping）；发送失败触发 `close(failed)` |
| 日志无输出 | `global.lx.isEnableSyncLog` 未开启（重启后重置为 false） |

## 9. 冲突与合并策略

依据客户端代码事实：

- 客户端**不实现**任何合并/覆盖算法——它只负责「提供本地数据（`get_list_data`）、接受远端数据（`set_list_data`）、上报 md5、把用户选择的模式返回给服务端」。合并与覆盖的实际执行在服务端。
- 客户端对合并策略的唯一可见影响：`SyncModeModal` 的模式选择（含 `_full` 后缀变体）与 `TRANS_MODE` 的反向映射表。
- 服务端文件布局暗示了快照机制（`File.listSnapshotDir` / `snapshotInfo.json`），且 `getEnabledFeatures` 返回 `skipSnapshot: false`（不启用跳过快照），但快照如何生成、md5 如何比对，**需对照 lx-music-sync-server 仓库确认**。

## 10. 待人工核对的疑点

1. **RPC 载荷未加密**：`encryptMsg` 对 >1024 字符的消息只做 gzip（`cg_` 前缀）、不加密；需与服务端确认这是设计如此还是缺口。
2. **`TRANS_MODE` 的使用位置**：客户端 `client.ts` 未发现引用，仅常量声明；用途需对照服务端。
3. **`ENV_PARAMS` / `File` 常量**：客户端仅声明，服务端布局参考，未在客户端逻辑中使用。
4. **快照与 md5 判定**：`skipSnapshot: false` 的实际含义、快照生成与比对规则在服务端实现。
5. **`overwrite_*_full` 与普通覆盖的区别**：客户端只负责加 `_full` 后缀，语义差异在服务端。
6. **同步日志设置项位置**：`Other/Log.tsx` 中开关读写 `global.lx.isEnableSyncLog`，未持久化，重启后重置为 false。
