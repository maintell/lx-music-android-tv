# 开发者常见问题（FAQ - 面向开发者）

> 本页收集**代码级**的常见疑问与踩坑记录，面向贡献者/二次开发者。终端用户使用类问题请见官方文档 <https://lyswhut.github.io/lx-music-doc/mobile/faq>。标注 ⚠️ 的项目为源码中尚未定论的疑点，参与开发时请留意。

## 架构与状态管理

**Q1：README 说技术栈是 Redux，但代码里看不到 redux？**
README 已过时。项目实际使用自研轻量状态管理：`store/<域>/{state,action,hook}.ts` 三件套 + 全局事件总线（`global.state_event` 等）。见 `docs/modules/state-management.md` 与 design-doc ADR-2/3。`src/store/index.ts` 仅剩空壳 `useGetter`（Redux 迁移残留），`src/store/Provider/Provider.tsx` 为注释掉的旧 Redux Provider，勿使用。

**Q2：为什么有 `state_event`、`app_event`、`list_event`、`dislike_event` 四个事件总线？**
按语义分层：`state_event` 通知领域状态变更（UI 订阅响应式更新）、`app_event` 承载应用/播放器行为事件、`list_event` 承载列表动作、`dislike_event` 承载不喜欢列表变更。四个总线统一基于 `src/event/Event.ts`，子类提供类型化触发方法。见 `docs/architecture.md` §4。

**Q3：新增一个领域状态（比如新的设置页数据）要走什么流程？**
参照现有领域（如 `src/store/list/`）：
1. `store/<域>/state.ts`：定义 `InitState` 并导出单例；
2. `store/<域>/action.ts`：提供修改函数，修改后通过对应事件总线广播；
3. `store/<域>/hook.ts`：React hooks 订阅事件、映射响应式值；
4. 如事件名需要新的触发语义，在 `src/event/*Event.ts` 对应总线子类中新增类型化方法。
详细步骤见 `docs/modules/state-management.md`。

**Q4：事件名在触发侧不受编译期约束？**
⚠️ 是。`StateEvent`/`AppEvent` 子类的方法名即事件名，`emit` 侧传字符串不受类型约束；类型化 `on/off` 只约束订阅侧。新增事件时请严格按方法名约定命名，避免拼写漂移。另外 `appEvent.ts` 的 `mylistToggled` 内部 emit 的是 `'listToggled'`（与 `state_event.mylistToggled` 不一致），全库未见监听方，疑似历史遗留。

## 播放

**Q5：点击歌曲后一直拿不到播放地址（"Api is not found"）？**
⚠️ 当前版本内置源（kw/kg/tx/wy/mg）的 `getMusicUrl` 走 `musicSdk/<源> → apis('<源>')`，而 `musicSdk/api-source.js` 的 `apiList` 已被整体注释、`api-source-info.ts` 的 `supportQualitys` 数组为空 —— 即内置源无法直接获取播放 URL，播放地址依赖 **user_api 自定义源**。若遇到此问题：在设置中导入可用的自定义源并切换。修复内置源路径属于已知风险（design-doc §8 第 6 条）。

**Q6：轨道 id 格式 `xxx__//yyy__//url` 是干什么的？**
`plugins/player/playList.ts` 的 `buildTracks` 用 `__//` 分隔拼接 `音乐id__//随机数__//实际url`，使每首歌曲在 TrackPlayer 队列中有唯一 id；每首歌会构建**双轨道**（真实 URL + 占位静音 `defaultUrl`）。`getCurrentTrackId` 解析时用 `lastIndexOf('__//')` 分割。改动该格式需同步 `plugins/player/utils.ts` 与 `core/player` 的解析逻辑。

**Q7：播放进度显示异常（进度条比例不对）？**
⚠️ `store/player/action.ts` 的 `setProgress` 中比例计算为 `nowPlayTime / currentTime`，分母疑应为总时长 `maxPlayTime`。改动请先确认真实行为再修。

**Q8：下载列表里的歌曲怎么播放的？**
⚠️ `getList` 对下载列表返回 `[]`，`playListById` 无法直接以下载列表起播；`core/music/download.ts` 的本地文件播放路径被注释，下载歌曲实际仍走在线 URL 播放。

**Q9：`plugins/player/service.ts` 里大片注释代码是什么？**
历史遗留的旧重试/切歌逻辑。当前重试与切歌决策已上移到 `core/player/player.ts`（`delayRetry`、`playNext` 等），改动时**不要依赖或恢复注释代码**，先确认 `core/player` 已承担对应行为。

## 音乐源与自定义源

**Q10：怎么加一个新的内置音乐源？**
1. 在 `src/utils/musicSdk/<源id>/` 建目录，按现有源（如 `kw/`）实现能力接口（musicSearch、songList、leaderboard、lyric、pic 等）；
2. 在 `src/utils/musicSdk/index.js` 导入并加入 `sources.sources` 列表与导出；
3. 若需要音质声明，同步 `api-source-info.ts`。
详细步骤见 `docs/modules/music-sources.md` §10。

**Q11：自定义源（user_api）脚本里能调用哪些能力？**
脚本沙箱提供 `lx` 系列 API（`musicUrl`、`lyric`、`pic` 等），由 `core/init/userApi/` 加载、`utils/nativeModules/userApi.ts` 提供原生桥接。⚠️ 注意沙箱 `supportActions` 白名单：内置源仅允许 `musicUrl`（local 源才允许 lyric/pic），脚本声明其他 action 会被过滤。

**Q12：`xm` 源为什么选不了？**
`musicSdk/index.js` 导出了 `xm` 但不在 `sources.sources` 可选列表，且 `xm.js` 为全 reject 的 stub；`bd` 源已被注释停用。属历史残留，勿投入开发。

## 列表与存储

**Q13：`store/list/state.ts` 的 `allMusicList` 能用吗？**
⚠️ 不能。该字段是遗留字段，运行时从未被写入；实际歌曲缓存是 `utils/listManage.ts` 的模块级 `allMusicList` Map（两者不是同一引用）。一律通过 `core/list.ts` 与 `listManage.ts` 的 API 操作列表。

**Q14：存储里的 key 前缀在哪里定义？**
`src/config/constant.ts` 的 `storageDataPrefix`：`@setting_v1`（设置）、`@user_list`（列表元数据）、`@list__<id>`（列表歌曲）、`@lyric__`、`@music_url__` 等。大值自动分片（>500KB，`@___PART_A___` 前缀），见 `docs/design-doc.md` §6.1。

**Q15：备份/恢复文件是什么格式？**
`types/list.d.ts` 的 `ListSaveType/ListSaveInfo`：`myList`（列表整体）/ `downloadList`（下载列表），各 type 由 `screens/.../Backup/actions.ts` 分发处理（playList_v2 等）。恢复为**整体覆盖语义**。

**Q16：临时列表（temp）会同步到远端吗？**
不会。同步侧（`plugins/sync/`）会过滤 TEMP 列表，`sync.enable` 只同步我的列表（default/love/userList）与不喜欢列表。

## 主题与国际化

**Q17：`theme.lightId` / `theme.darkId` 设置了没效果？**
⚠️ `defaultSetting.ts` 有声明，但 `core/theme.ts` 的 `getTheme()` 目前只用 `common.isAutoTheme` + 硬编码暗色主题（旧逻辑被注释）。如需支持「亮/暗主题独立记忆」，需要补实现。

**Q18：新增主题后设置页不显示主题名？**
内置主题的显示名走 i18n（`Theme.tsx` 用 `t('theme_' + id)`），`createThemes.js` 里的 `name` 字段在设置页不生效。新增主题需同时在三语言包（zh-cn/zh-tw/en-us）补 `theme_<id>` 的 key。

**Q19：新增语言要注意什么？**
语言包命名必须与 `src/lang/Readme.md` 的 locale 列表一致（如 `zh_hk`），文件放 `src/lang/`，并在 `src/lang/index.ts` 注册（langList + messages）。zh-cn 为 fallback，缺失 key 会自动回退 zh-cn。见 `docs/modules/i18n.md` §5。

## 构建与发布

**Q20：本地怎么打 release APK？**
`npm run pack:android`（内部 `cd android && gradlew.bat assembleRelease`）。签名参数通过 gradle properties（`MYAPP_UPLOAD_*`）传入；⚠️ 注意 `android/app/build.gradle` 的 release buildType 同时存在 `signingConfig debug` 与 `signingConfig release` 两行（后者生效），属可疑写法，维护者应确认是否有意为之。详见 `docs/build-and-release.md`。

**Q21：版本号怎么改？**
不要手改！`package.json` 的 `version` + `versionCode` 由发布脚本（`publish/`）联动维护（发布时 `versionCode` 自增并重写 package.json），`version` 需按版本策略手动提升。CI 会在 master 推送时按 `package.json version` 自动打 `v<version>` tag 并发 GitHub Release。

**Q22：`npm run clear:full` 会删什么？**
`git clean -fdx`（清所有未跟踪文件与构建产物），保留 `android/keystore.properties` 与 `android/app/*.keystore`。执行前请确认无未提交改动与需要的本地文件。

## 调试

**Q23：想看同步/自定义源日志？**
`global.lx.isEnableSyncLog`（同步日志）与 `global.lx.isEnableUserApiLog`（用户源日志），⚠️ 均为运行时开关，不持久化、重启重置。同步日志实现见 `plugins/sync/log.ts`。

**Q24：启动失败弹窗里的 Boot Log 是什么？**
`utils/bootLog.ts` 采集的启动日志（初始化管道逐步写入）。`src/app.ts` 在初始化任一步失败时弹出带完整 bootLog 的对话框。修改初始化流程（`src/core/init/`）后务必回归验证失败路径。

**Q25：初始化失败兜底依赖的 `tipDialog` 在哪里？**
`src/utils/tools.ts`（`tipDialog` / `confirmDialog`），是启动失败与部分业务弹窗的公共实现，改动需回归。
