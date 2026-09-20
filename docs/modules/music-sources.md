# 音乐源体系（musicSdk 与自定义源）

> 阅读本文你将获得：① 理解 `musicSdk` 如何统一聚合酷我/酷狗/QQ/网易云/咪咕多平台能力；② 掌握内置源、自定义源（user_api）的加载与切换机制，能够排查"源不可用 / 切源失败 / URL 获取失败"问题；③ 按文档步骤新增一个内置源或自定义源。

## 设计依据

- 顶层设计文档：[`../design-doc.md`](../design-doc.md) 的 **ADR-4**（`musicSdk` 统一抽象所有音乐源 + `user_api` 自定义源机制）、**5.2 音乐源**（目录结构与能力清单）、**4.1 音乐信息**（`LX.Music.MusicInfo` 判别联合与音质模型）、**7 扩展点设计**（新增音乐源/自定义音源入口）。
- 系统架构文档：[`../architecture.md`](../architecture.md)（分层与模块依赖方向）。

---

## 1. 概述与设计目标

`musicSdk`（`src/utils/musicSdk/`）是项目聚合多个公开音乐平台的**统一抽象层**，位于"插件适配层"（见 design-doc 3.1 分层概览）。设计目标：

1. **单一入口**：UI 与核心层不直接感知具体平台的 API 差异，统一通过 `musicSdk[source].xxx(...)` 调用。
2. **可插拔**：内置源以目录形式平铺（`musicSdk/<源>/`），新增一个源即新增一个目录并在 `index.js` 注册。
3. **适配上游变化**：平台 API 变更时，只需修改对应源模块或切换到自定义源脚本，主程序零改动。

与桌面版不同，移动版的 `apiList`（临时/直连 API 表）机制已被注释停用（见 design-doc §8 风险第 6 条），当前**内置源能力完全由各源模块自身实现**，`api-source.js` 的 `apis()` 仅保留 user_api 路径。

## 2. 目录与职责

| 路径 | 职责 |
|------|------|
| `src/utils/musicSdk/index.js` | 源注册表（`sources.sources` + 各源模块）、`init()`、跨源搜索 `searchMusic`、模糊匹配 `findMusic` |
| `src/utils/musicSdk/<源>/` | 各源能力实现（`kw` 等为目录，`xm` 为单文件 `xm.js`） |
| `src/utils/musicSdk/api-source.js` | `apis(source)` 路由（user_api 判定）与 `supportQuality` 导出 |
| `src/utils/musicSdk/api-source-info.ts` | 内置源信息声明（当前为空数组，见 §5） |
| `src/utils/musicSdk/options.js` | 公共请求头（`User-Agent`、`bHh` 头）与超时（15s） |
| `src/utils/musicSdk/utils.js` | 音质降级 `getMusicType`、`toMD5`、`formatSingerName` |

`index.js` 导出结构：

```js
export default {
  sources: { sources: [...], kw, kg, tx, wy, mg, xm },  // bd 被注释
  supportQuality,
}
export const init = () => { /* 遍历 sources.sources 执行 sm.init() */ }
export const searchMusic = ...   // 跨源搜索（排除当前源与 xm）
export const findMusic = ...     // 多源模糊匹配
```

`init()` 在 `src/core/init/dataInit.ts` 中被调用（`void musicSdkInit()`），各源当前 `init` 均为注释状态，任务列表为空。

### 跨源搜索 searchMusic

```js
searchMusic({ name, singer, source: s, limit = 25 })
```

遍历 `sources.sources`，跳过：当前播放源（`source.id == s`）、`xm`（`excludeSource` 硬编码）、无 `musicSearch` 的源；对每个源调用 `musicSearch.search('歌曲名 歌手', 1, limit)`，单个源失败不阻塞整体（`.catch(_ => null)`）。

### 模糊匹配 findMusic

`findMusic(musicInfo)` 先调 `searchMusic`，再按「时长 ±5s → 歌名 → 歌手 → 专辑」多级规则打分排序，用于"源切换"（`getOtherSource`，见 §9）与本地歌曲匹配。匹配字段会做过滤（去空白/标点/大小写归一）与多歌手分隔符归一（`、 & ; / , |` 等）。

## 3. 统一能力接口

每个源模块导出**能力对象**（部分能力直接挂方法，如 `getMusicUrl`/`getLyric`/`getPic`）。以下是能力清单（design-doc 5.2 所列能力的子集，能力因源而异）：

| 能力 | 说明 | 返回值 |
|------|------|--------|
| `musicSearch` | 歌曲搜索 | `{ list: MusicInfo[] }` 等 |
| `songList` | 歌单详情/分类 | 歌单列表 |
| `leaderboard` | 排行榜 | 榜单列表 |
| `hotSearch` | 热门搜索词 | 热词列表 |
| `tipSearch` | 搜索建议（输入联想） | 建议列表 |
| `comment` | 歌曲评论 | `getComment` / `getHotComment` |
| `getMusicUrl(songInfo, type)` | 播放地址 | `{ promise: Promise<{ url, type }>, canceleFn }` |
| `getLyric(songInfo)` | 歌词 | `{ promise: Promise<LyricInfo> }` |
| `getPic(songInfo)` | 封面 | `Promise<string>` |
| `getMusicInfo(songInfo)` | 歌曲详情（kw/wy 特有） | Promise |
| `getMusicDetailPageUrl(songInfo)` | 源站歌曲页链接 | `string` |
| `handleMusicInfo` / `getMusicUrls` | kw 特有辅助 | — |

### 各源能力支持矩阵（依据源码导出核对）

| 能力 | kw | kg | tx | wy | mg | xm |
|------|----|----|----|----|----|----|
| 搜索 `musicSearch` | ✔ | ✔ | ✔ | ✔ | ✔ | ✘ |
| 歌单 `songList` | ✔ | ✔ | ✔ | ✔ | ✔ | ✘ |
| 排行榜 `leaderboard` | ✔ | ✔ | ✔ | ✔ | ✔ | ✘ |
| 热词 `hotSearch` | ✔ | ✔ | ✔ | ✔ | ✔ | ✘ |
| 建议 `tipSearch` | ✔ | 注释停用 | 注释停用 | 注释停用 | 注释停用 | ✘ |
| 评论 `comment` | ✔ | ✔ | ✔ | ✔ | ✔ | stub |
| `getMusicUrl` | ✔(apis) | ✔(apis) | ✔(apis) | ✔(apis) | ✔(apis) | 恒 reject |
| `getLyric` | ✔ | ✔ | ✔ | ✔ | ✔ | 恒 reject |
| `getPic` | ✔ | ✔ | ✔ | ✔ | ✔ | 恒 reject |
| `getMusicInfo` | ✔ | ✘ | ✘ | ✘（仅内部用于 `getPic`） | ✘ | ✘ |

> 说明：`kw`/`kg`/`tx`/`wy`/`mg` 的 `getMusicUrl` 均委托 `apis('<源>')`（见 §7）；`xm` 是**占位 stub**（`src/utils/musicSdk/xm.js`，所有方法 `Promise.reject(new Error('fail'))`），详见 §4。

## 4. 内置源清单

`index.js` 中的注册状态：

| id | 名称 | 在 `sources.sources`（可选列表） | 导出 | 状态 |
|----|------|------|------|------|
| `kw` | 酷我音乐 | ✔ | ✔ | 正常 |
| `kg` | 酷狗音乐 | ✔ | ✔ | 正常 |
| `tx` | QQ音乐 | ✔ | ✔ | 正常 |
| `wy` | 网易音乐 | ✔ | ✔ | 正常 |
| `mg` | 咪咕音乐 | ✔ | ✔ | 正常 |
| `bd` | 百度音乐 | 注释 | 注释 | **已停用**（import 与注册均被注释） |
| `xm` | 虾米 | ✘ 不在列表 | ✔（单文件 stub） | **导出但不可选**（design-doc §8 风险 5）；且 `xm.js` 方法全部 reject，实际不可用 |

注意 `LX.OnlineSource` 类型（`src/types/common.d.ts`）也只声明了 `'kw' | 'kg' | 'tx' | 'wy' | 'mg'`，不含 `bd`/`xm`——类型与运行时可选项保持一致。

## 5. 音质体系

### 5.1 LX.Quality

```ts
// src/types/common.d.ts
type OnlineSource = 'kw' | 'kg' | 'tx' | 'wy' | 'mg'
type Source = OnlineSource | 'local'
type Quality = '128k' | '320k' | 'flac' | 'flac24bit' | '192k' | 'ape' | 'wav'
type QualityList = Partial<Record<LX.Source, LX.Quality[]>>
```

设计文档 4.1 节以 `128k / 320k / flac / wav` 为代表；完整枚举见上方类型。设置项 `player.playQuality` 即该枚举之一。

### 5.2 supportQualitys 现状（重要）

- `api-source-info.ts` 的 `sources` 数组**当前为空**，`disabled`/`supportQualitys` 字段存在但未填充（design-doc §8 风险 6）。
- 因此 `api-source.js` 中 `supportQuality = {}`（`for (const api of apiSourceInfo)` 空循环），内置源路径下 `global.lx.qualityList` 恒为 `{}`。
- **影响**：`core/music/utils.ts` 的 `getPlayQuality` 依赖 `global.lx.qualityList[source]` 判定高音质是否可选，当前内置源下该表为空 → 播放高音质时实际按 `meta._qualitys` 与 `TRY_QUALITYS_LIST` 降级逻辑回退；`assertApiSupport(source)`（`tools.ts`）也依赖 `qualityList[source] != null`，内置源下返回 `false`，会跳过"切换源"候选。
- user_api 路径下 `qualityList` 由脚本声明的 `qualitys` 填充（见 §8.3），此时音质判定才真正生效。

### 5.3 音质选择与降级

```ts
// src/core/music/utils.ts
const TRY_QUALITYS_LIST = ['flac24bit', 'flac', '320k'] as const
getPlayQuality(highQuality, musicInfo)  // 高音质 → 依 qualityList 与 meta._qualitys 降级
```

播放 URL 获取时（`core/music/online.ts`）以 `player.playQuality` 为期望音质调用 `getPlayQuality`，优先尝试 `flac24bit → flac → 320k`，最终兜底 `128k`。

## 6. MusicInfo 判别联合类型

`src/types/music.d.ts`（对照 design-doc 4.1）：

| 类型 | 判别 `source` | `meta` 特有字段 | 说明 |
|------|---------------|-----------------|------|
| `MusicInfoLocal` | `'local'` | `filePath`、`ext` | 本地文件，`songId` 为文件路径 |
| `MusicInfo_online_common` | `'kw' \| 'wy'` | `qualitys[]`、`_qualitys`、`albumId?` | 通用在线源 |
| `MusicInfo_kg` | `'kg'` | 继承 common + `hash` | kg 以 hash 作为音质/歌曲标识 |
| `MusicInfo_tx` | `'tx'` | 继承 common + `strMediaMid`、`id?`、`albumMid?` | tx 播放地址依赖 strMediaMid |
| `MusicInfo_mg` | `'mg'` | 继承 common + `copyrightId`、`lrcUrl?`、`mrcUrl?`、`trcUrl?` | mg 歌词支持 mrc/trc 扩展（`mg/utils/mrc.js`） |

公共字段（`MusicInfoBase`）：`id`（源内唯一）、`name`、`singer`、`source`、`interval`（格式化时长 `03:55`）、`meta.songId`、`meta.albumName`、`meta.picUrl?`、`meta.toggleMusicInfo?`。

- `meta._qualitys`：`Partial<Record<Quality, { size, hash? }>>`，音质可用性快速索引。
- `meta.toggleMusicInfo`：**预留的"切换源后歌曲信息"字段**——`core/player/player.ts` 在取 URL 时若存在则优先用其换取播放地址；当前移动端代码库内**无写入点**（桌面版由搜索结果切源写入），仅 `screens/Home/Views/Mylist/MusicList/listAction.ts` 的 `handleToggleSource` 做了列表内替换逻辑，属于待核对兼容点（见 §11 疑点）。
- 工具转换：`utils/index.ts` 的 `toOldMusicInfo` / `toNewMusicInfo` 在 SDK 调用边界做新旧结构转换（SDK 内部使用 `songmid` 等旧字段）。

## 7. apiSource 切换机制

### 7.1 设置键与全局状态

- 设置键：`common.apiSource`（`src/types/app_setting.d.ts`），默认 `''`（`defaultSetting.ts`）。
- 全局状态（`global.lx`，`src/types/app.d.ts`）：`qualityList`、`apis`、`apiInitPromise: [Promise<boolean>, boolean, (success) => void]`。
- 相关事件：`state_event.apiSourceUpdated(apiId)`（`src/event/stateEvent.ts`）。

### 7.2 apis() 前缀判定

```js
// src/utils/musicSdk/api-source.js
const apis = source => {
  if (/^user_api/.test(settingState.setting['common.apiSource'])) return global.lx.apis[source]
  const api = getAPI(source)          // apiList 为空 → 恒 undefined
  if (api) return api
  throw new Error('Api is not found')
}
```

内置源路径下 `apiList` 全被注释（`temp_api_*` / `test_api_*` / `direct_api_*`），`getAPI` 恒返回 `undefined` 并抛错——因此**当前内置源的 `getMusicUrl` 实际全部不可用**，这是 design-doc §8 风险 6 的运行时后果：内置源搜索/列表可用，但播放地址获取依赖 user_api 或未来重新启用 api 表。

### 7.3 setApiSource 流程

`src/core/apiSource.ts`：

```ts
setApiSource(apiId: string)
```

```
用户选择音源 apiId
        │
        ▼
┌─ 是否已有初始化在进行？──────────────────────────┐
│  global.lx.apiInitPromise[1] 为真              │
│  → 用新 Promise 替换 [0]，并注册回调 [2]         │
└──────────────────┬─────────────────────────────┘
                   ▼
       ┌───────────────────────────┐
       │ /^user_api/.test(apiId)?  │
       └──────┬────────────┬───────┘
              │ 是          │ 否（内置源）
              ▼             ▼
     setUserApi(apiId)   global.lx.qualityList =
        .catch(↓)        musicSdk.supportQuality[apiId] ?? {}
        失败回退:        destroyUserApi()
        apiSourceInfo 中  apiInitPromise[2](true)
        第一个未禁用项:
        api.id != 当前 →
        setApiSource(api.id)
              │
              └──────────┬──────────┐
                         ▼          ▼
          若 apiId != 当前 setting：
          updateSetting({ 'common.apiSource': apiId })
          requestAnimationFrame(() =>
            global.state_event.apiSourceUpdated(apiId))
```

要点：

- **失败回退**：`setUserApi` 抛错时（脚本不存在/加载失败），`apiInitPromise[2](false)` 通知等待方，并尝试回退到 `api-source-info.ts` 中第一个 `disabled === false` 的源（当前数组为空 → 直接 return，无回退对象）。
- **apiInitPromise 语义**：`[0]` 是当前初始化结果的 Promise（`core/music/utils.ts` 多处 `await global.lx.apiInitPromise[0]` 等待源就绪）；`[1]` 标记是否有初始化进行中；`[2]` 是完成回调（注入 resolve）。
- **内置源分支**：立即销毁自定义源环境（`destroyUserApi()` → 原生 `UserApiModule.destroy()`），并置空/设置 qualityList。

## 8. 自定义源（user_api）架构

### 8.1 总体结构

```
┌──────────────── JS 层（React Native） ────────────────┐
│ core/userApi.ts            脚本管理（导入/删除/加载）   │
│ core/init/userApi/index.ts 请求桥 + apis 挂载          │
│ core/init/userApi/request.js  fetchData（AbortController）
│ utils/nativeModules/userApi.ts  UserApiModule 封装     │
└───────────────┬───────────────────────────────────────┘
                │ RN Bridge（loadScript / sendAction / api-action 事件）
┌───────────────▼───────────────────────────────────────┐
│ 原生层（android/.../userApi/）                         │
│ UserApiModule / JavaScriptThread / QuickJS / JsHandler │
│ UtilsEvent + assets/script/user-api-preload.js        │
└───────────────────────────────────────────────────────┘
```

脚本在**独立的 `JavaScriptThread` + QuickJS 虚拟机**（`com.whl.quickjs.android`）中运行，与主 JS 线程隔离；`user-api-preload.js` 负责搭建脚本环境（`globalThis.lx`）并做**沙箱加固**（禁 `eval`、禁动态 `Function`、冻结全局）。

### 8.2 脚本加载流程

```
core/init/index.ts（启动管道 initUserApi）
  └─ core/init/userApi/index.ts default(setting)
       ├─ onScriptAction(...) 注册事件处理（init/response/request/...）
       └─ setUserApiList(await getUserApiList())   // 读取已导入脚本元数据

用户选择 user_api 源 → core/apiSource.ts setApiSource('user_api_xxx')
  └─ core/userApi.ts setUserApi(apiId)
       ├─ global.lx.qualityList = {}
       ├─ setUserApiStatus(false, 'initing')
       ├─ state.list 查找 target（store/userApi）
       ├─ getUserApiScript(target.id)          // 读取脚本源码
       └─ loadScript({ ...target, script })    // nativeModules/userApi.ts
            └─ UserApiModule.loadScript({id, name, description, version, author, homepage, script})
                 └─ JavaScriptThread: QuickJS.create() → evaluate(preload) → lx_setup(key, ...)
                    → evaluate(脚本源码) → 脚本内 lx.send('inited', { sources })
                    → preload 校验并 nativeCall('init', {...}) → JsHandler → 'api-action' 事件 → JS 层
```

### 8.3 脚本契约（globalThis.lx）

脚本运行环境由 preload 提供，`lx` 对象被冻结。核心 API：

| API | 签名 | 说明 |
|-----|------|------|
| `lx.send` | `(eventName, data) => Promise` | `'inited'`：声明 `{ sources: { kw: { type:'music', actions:[...], qualitys:[...] } } }`；`'updateAlert'`：更新提示 |
| `lx.on` | `(eventName, handler) => Promise` | `'request'`：注册请求处理，`handler({source, action, info})` 须返回 Promise |
| `lx.request` | `(url, options, callback)` | 网络请求；`options: { method, timeout(≤60s), headers, body, form, formData, binary }`；`callback(err, resp, rawBody)`；返回取消函数 |
| `lx.utils.crypto` | `aesEncrypt / rsaEncrypt / randomBytes / md5` | 加解密工具（原生实现） |
| `lx.utils.buffer` | `from(input, encoding) / bufToString(buf, format)` | Buffer 工具 |
| `lx.currentScriptInfo` | 脚本元数据 | `{ name, description, version, author, homepage, rawScript }` |
| `lx.version` / `lx.env` | `'2.0.0'` / `'mobile'` | 环境标识 |

**`inited` 声明校验**：preload 内置白名单——`kw/kg/tx/wy/mg` 音质限 `['128k','320k','flac','flac24bit']`、action 限 `['musicUrl']`；`xm` 限 `['musicUrl']`；`local` 支持 `['musicUrl','lyric','pic']`。脚本声明超出白名单的部分会被过滤。

**`request` 事件返回值校验**（preload `handleRequest`）：

| action | 校验 | 成功响应 data |
|--------|------|---------------|
| `musicUrl` | 字符串、`/^https?:/`、≤2048 | `{ type, url }` |
| `lyric` | `{ lyric: string(≤51200), tlyric/rlyric(≤5120), lxlyric(≤8192) }` | `LyricInfo` |
| `pic` | 字符串、`/^https?:/`、≤2048 | 图片 URL 字符串 |

### 8.4 双向请求桥（核心时序）

```
 JS 核心层                    原生 QuickJS 沙箱                脚本
───────                       ─────────────────              ──────
sendUserApiRequest(            sendAction('request', JSON) ──► jsCall('request')
  requestKey, data) ──────────────────────────────────────► handleRequest(data)
  （Promise + 20s 超时）                                          │
     ▲                                                           │ lx.on('request') handler
     │                                                           │ 需要发网络请求时
     │                     ◄────────── nativeCall('request', {requestKey,url,options})
     │                     │                                      lx.request(url, opts, cb)
     │  onScriptAction('request')                                  ▲
     │  → sendScriptRequest → request.js fetchData                │
     │  → sendAction('response') ─────────────────────────────────┘ handleNativeResponse
     │                     │
     │  handleUserApiResponse ──► resolve/reject ◄──── nativeCall('response',
     │   （userApiRequestMap 查找）                                 {requestKey,status,result})
     ▼
  apis[source].getMusicUrl(...) 的 promise
```

- JS 侧每次调用生成 `requestKey = 'request__' + random`，存入 `userApiRequestMap`，20s 超时（`BackgroundTimer.setTimeout`），`apiSourceUpdated` 时批量 reject（防切源后旧请求悬挂）。
- 脚本侧 `lx.request` 产生的 HTTP 请求**回到 JS 层**执行（`request.js` 的 `fetchData`：默认 13s 超时、`AbortController`、`binary` 选项返回 Buffer、响应体自动 JSON.parse），再由 `sendAction('response')` 送回沙箱。
- 请求取消：脚本侧 `cancelRequest` 事件 → JS 层 `scriptRequestMap` 中 `abort()`。

### 8.5 apis 挂载（JS 层消费侧）

`core/init/userApi/index.ts` 收到 `init` 事件（status 成功且 `info.id == 当前 apiSource`）后，遍历 `info.sources`（仅 `type == 'music'`）：

```
global.lx.qualityList = qualitys      // 脚本声明音质
global.lx.apis = apis                 // { source: { getMusicUrl, getLyric?, getPic? } }
global.state_event.apiSourceUpdated(setting['common.apiSource'])
```

`apis[source].getMusicUrl(songInfo, type)` 返回 `{ canceleFn, promise }`——promise 内部走 `sendUserApiRequest` 桥接并映射为 `{ type, url }`。此后 `core/music/utils.ts` 的 `getOnlineOtherSourceMusicUrl` 等（内置源路径）通过 `musicSdk[source].getMusicUrl(...)` 调用，而内置源的 `getMusicUrl` 又委托 `apis(source)` → 命中 `global.lx.apis`。**因此 user_api 实际是唯一可用的 URL/歌词/图片来源**（见 §7.2 结论）。

### 8.6 状态与日志

- `store/userApi`：`status`（`initing` / 完成 / 失败）、`list`（已导入脚本）、`allowShowUpdateAlert`。
- 初始化失败：`tipDialog` 弹出 `user_api__init_failed_alert` + 错误信息（`init/userApi/index.ts` `handleStateChange`）。
- 更新提醒：脚本 `updateAlert` → JS 弹确认框（有 `updateUrl` 则 `openUrl`）→ 用户跳转更新。

## 9. 调试建议

1. **打开用户源日志**：设置 → 其他 → 日志 → 「用户源日志」（`global.lx.isEnableUserApiLog`，`screens/Home/Views/Setting/settings/Other/Log.tsx`）。开启后 `core/userApi.ts` 的 `log.info/warn/error`（即脚本 `console` 输出，经 `'log'` action 回流）会写入业务日志。
2. **请求桥观察点**：`core/init/userApi/request.js` 的 `fetchData` 内的 `console.log('---start---', url)` 与 `init/userApi/index.ts` 各分支日志；原生侧 `QuickJS.java` / `JavaScriptThread.java` 有 `Log.d("UserApi ...")`，可用 `adb logcat -s UserApi UserApi\\[thread\\] UserApi\\[script call\\]` 过滤。
3. **常见失败原因**：
   - `Api is not found`：内置源路径（`common.apiSource` 非 `user_api` 前缀）调用 `getMusicUrl` 必然抛此错——当前版本请使用 user_api 源。
   - `request timeout`：桥接 Promise 20s 超时（脚本 handler 未及时返回）。
   - `Request event is not defined`：脚本未注册 `lx.on('request')`。
   - `The event is not supported`：脚本调用非法事件/多次 `inited`/重复 `updateAlert`。
   - `'failed'`：preload 返回值校验不过（URL 非 http(s)、歌词结构非法、长度超限）。
4. **音质不生效**：检查脚本 `inited` 声明的 `qualitys` 是否包含目标音质，以及 `global.lx.qualityList` 是否被正确填充。

## 10. 新增内置源步骤

1. 新建 `src/utils/musicSdk/<id>/` 目录，实现：`musicSearch`、`songList`、`leaderboard`、`hotSearch`（可选 `tipSearch`/`comment`）、`getMusicUrl(songInfo, type)`（返回 `{ promise, canceleFn }`）、`getLyric`、`getPic`、`getMusicDetailPageUrl`。可参考 `kw/` 的实现范式（`httpFetch` + `apis` 委托）。
2. 在 `src/utils/musicSdk/index.js`：`import <id> from './<id>'`；加入 `sources.sources` 数组（界面可选列表）与导出对象。
3. 如需参与"切换源"候选：更新 `src/types/common.d.ts` 的 `OnlineSource` 联合类型；在 `api-source-info.ts` 补充 `{ id, name, disabled, supportQualitys }`（填充后 `supportQuality`、`getPlayQuality`、`assertApiSupport` 才对该源生效）。
4. 若平台需要登录态/签名 token：实现 `init()`（`index.js` 的 `init()` 会自动调用）。
5. 验证：搜索、歌单、排行榜、播放 URL、歌词、封面全链路冒烟；注意 `searchMusic` 的 `excludeSource` 目前硬编码排除 `xm`。

## 11. 需人工核对的疑点

- `api-source-info.ts` 为空数组 + `apiList` 全注释 → 内置源 `getMusicUrl` 全部抛 `Api is not found`，播放地址仅靠 user_api；若属预期（design-doc §8 风险 6），建议明确后续是否重新启用 api 表或填充 supportQualitys。
- `meta.toggleMusicInfo` 字段**移动端无写入点（已核对源码）**：全仓仅 `core/player/player.ts:63/102-105` 读取它用于向"另一音源"换取播放地址，无任何代码写入该字段。`musicSdk/xm.js` 之外，移动端的"切换源"交互实际走 `screens/Home/Views/Mylist/MusicList/listAction.ts` 的 `handleToggleSource`（传入候选 `toggleMusicInfo` → 作为**新列表条目** `addListMusics` 后播放，而非回写 `musicInfo.meta.toggleMusicInfo`）。结论：该字段是桌面版遗留的"同曲多源候选"数据——移动端不生产它，但 `player.ts` 在读取到（如桌面同步而来）时会照常优先用它取地址。
- `xm.js` 为 stub 且不在 `sources.sources`，但 `index.js` 仍导出它（design-doc §8 风险 5）：可考虑直接删除以减少困惑。
- user_api 的 `supportActions` 白名单中 `kw/kg/tx/wy/mg` 仅允许 `musicUrl`（`local` 才允许 `lyric/pic`）——脚本声明 `lyric`/`pic` 会被过滤，这是有意的能力裁剪还是待扩展项，需确认。
