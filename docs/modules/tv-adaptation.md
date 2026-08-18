# TV 适配设计文档（Android TV / 遥控器控制）

> 本文档是 [design-doc.md](../design-doc.md) 的**扩展附录**，针对「手机版适配 Android TV + 遥控器（D-pad / 媒体键）控制」提出架构方案与分阶段实施计划。若与 design-doc 冲突，以 design-doc 为准。
>
> - 文档版本：0.1（草案）
> - 适用范围：`lx-music-mobile` 源码（v1.8.4，versionCode 76）+ `android/` 原生壳
> - 目标读者：贡献者 / 维护者（需同时懂 React Native 与原生 Android TV）
> - 关联文档：[architecture.md](../architecture.md)、[modules/player.md](./player.md)、[modules/navigation.md](./navigation.md)

## 0. 结论摘要

**可以做到，但分两层，难度完全不同：**

1. **媒体键播控（播放/暂停/上一首/下一首/音量）** —— 几乎免费。`react-native-track-player`（lyswhut fork）已构建 Android `MediaSession`，遥控器媒体键由系统路由到媒体会话，**很可能开箱即用**，仅需 Manifest 声明 + 实测验证 + 一层「媒体键 → `core/player` 动作」的薄转发（含后台/锁屏）。
2. **方向键 / 确认键导航（D-pad：上下左右/OK/返回/菜单）** —— 真正的工作量。当前 UI 全部是触屏手势范式（`TouchableOpacity` 点击、`PagerView` 滑动、`FlatList` 滚动、长按/`Menu` 弹层），**没有焦点链**。需逐屏加焦点、把滑动/长按改成方向键，并处理 RNN 跨栈焦点。

现状核实：全仓 `grep` 未发现任何 `TV` / `DPad` / `Leanback` / `focusable` / `useTVEventHandler` 代码；唯一的 `remote`、`KEYCODE` 命中都是数据同步的 `isRemote` 与桌面歌词提示，与遥控器无关。即**当前零 TV 适配**。

## 0.1 实施进度（已实现 / 规划）

| 阶段 | 状态 | 已落地改动 |
|------|------|-----------|
| 阶段 1 ｜ MVP 媒体键播控 | **已实现（待 TV 真机验证）** | `android/app/src/main/AndroidManifest.xml`（LEANBACK_LAUNCHER + touchscreen not-required + banner）、`android/.../MainActivity.java`（`dispatchKeyEvent` 媒体键转发，仅 TV 生效）、`android/app/src/main/res/drawable/banner.xml`、`src/tv/remoteKey.ts`（媒体键→`core/player` 动作映射）、`src/core/init/index.ts`（挂载监听） |
| 阶段 2 ｜ 完整 D-pad 导航 | **已实现（待 TV 真机验证）** | `src/tv/Focusable.tsx`（焦点容器 + MENU 键→onMenu）、`src/tv/PagerTV.tsx`（方向键翻页）、`Button.tsx`（TV 焦点边框）；全屏 `TouchableOpacity`/导航 `PagerView` 已替换为 Focusable/PagerTV（约 85 处 Focusable、16 处 PagerTV），长按菜单改 MENU 键唤起；进度条方向键 seek；PlayerBar 控制键可聚焦 |
| 阶段 3 ｜ TV 体验打磨 | 可选（未做） | 10 英尺布局/主题、Leanback 主浏览页、Banner 美术替换 |

> 阶段 1 的媒体键转发在「TrackPlayer MediaSession 未接管」时作为兜底生效；若 MediaSession 已接管，系统优先投递，转发路径不会触发（见 §6 风险 1，需 TV 真机实测确认）。

## 1. 需求与约束

| 项目 | 内容 |
|------|------|
| 原因约束 | 项目面向手机设计（`design-doc.md` §1），当前无 TV/Leanback 意图；目标为复用同一代码库产出可在 Android TV（含机顶盒）安装运行的版本 |
| 功能约束 | 遥控器须能：播放控制（媒体键）；浏览搜索/歌单/播放详情/设置；添加歌曲；触发菜单类操作 |
| 非功能约束 | 10 英尺（客厅远距离）可读性；可选 Banner；保持现有手机版行为不变（同一份源码，按设备能力分支） |
| 技术约束 | 沿用 RN 0.73 / RNN 7.39.2 / TrackPlayer fork；不引入会破坏手机版的依赖；TV 逻辑应以「能力检测 + 条件渲染」隔离，避免污染触屏路径 |

## 2. 设计原则（ADR 复用）

- **ADR-2（自研 store + 事件总线）**：所有 UI 交互（触摸或遥控）最终都调用 `core/` 暴露的函数或 emit `*_event`。新增遥控入口**复用既有动作函数**，不另写播放/列表逻辑。✅ 印证：`core/player/player.ts` 已暴露 `togglePlay / pause / stop / playNext / playPrev / playList / playListById / setMusicUrl / collectMusic / uncollectMusic / dislikeMusic`，遥控与触摸共用同一入口。
- **ADR-3（UI ↔ core 单向依赖）**：遥控器适配层属于「UI/平台适配」侧，只能调用 `core` 与 emit 事件，不得反向依赖。
- **最小侵入**：原生壳与 UI 改动以新增/分支为主，保持手机版路径不变。

## 3. 遥控器按键分类与本方案映射

Android TV 遥控器按键在系统层分两类，本方案据此分层处理：

### 3.1 媒体键（MediaSession，系统级路由）—— 低成本层

| 遥控键 | 系统事件 | 本项目落点 |
|--------|----------|------------|
| 播放/暂停 | `KEYCODE_MEDIA_PLAY_PAUSE` | `core/player/player.ts` → `togglePlay()` |
| 上一首 | `KEYCODE_MEDIA_PREVIOUS` | `playPrev()` |
| 下一首 | `KEYCODE_MEDIA_NEXT` | `playNext()` |
| 停止 | `KEYCODE_MEDIA_STOP` | `stop()` |
| 音量± | `KEYCODE_VOLUME_UP/DOWN` | 系统处理（不拦截） |

- TrackPlayer fork 的 `plugins/player/service.ts` 注册了 `PlaybackState` 监听；媒体会话的命令通道由 TrackPlayer 掌握。**第一阶段必须实测**：在无 UI 焦点、App 退到后台时，媒体键是否仍能驱动播放（lock-screen / Bluetooth 耳机线控本就依赖此通道，理论上可用，但 fork 版本须验证）。
- 若 TrackPlayer 默认未接管全部媒体键，则在原生侧 `MainActivity.dispatchKeyEvent` 补一层转发（见 §5.1），把 `KEYCODE_MEDIA_*` 映射到 `core/player` 动作（需经 RN 桥或全局事件）。

### 3.2 方向键 D-pad（focus navigation，应用级）—— 高成本层

| 遥控键 | 含义 | 本项目落点（UI 改造） |
|--------|------|----------------------|
| 方向键 | 焦点移动 | 给可交互元素加 `focusable` + 可见焦点框；编排 `nextFocus*` |
| OK / 确认 | 触发 `onPress` | `TouchableOpacity`/`Button` 在获得焦点时按 OK 即触发（RN 默认支持 focusable 的 press） |
| 返回 | `KEYCODE_BACK` | RNN 默认 pop；需保证每屏有合理返回路径 |
| 菜单 / 长按等价 | 唤起弹出菜单 | 现有 `Menu`/`Modal`（如 `OpenList`、`ListMenu`）需改为「获得焦点 + OK/菜单键」唤起，而非仅 `onLongPress` |

**D-pad 完整性缺口（已核对源码）：**
- `src/screens/` 大量使用 `TouchableOpacity`（`onPress`）——需包裹为可聚焦组件并加焦点框。
- `react-native-pager-view`（`Home/Views`、`PlayDetail/Vertical`、`Comment` 的 tab）——滑动切页需改为方向键切页（拦截左右键 + `setPage`）。
- `FlatList`（`Comment/components/List`、`PlayDetail/Vertical/Lyric`）——滚动需在获得焦点时由上下键驱动；歌词 `Lyric.tsx` 的 `onScrollBeginDrag/onScrollEndDrag` 手动拖动进度须改为上下键 seek。
- 长按菜单（`onLongPress` 弹 `Menu`）——TV 无长按，须映射菜单键 / OK 二次确认。

## 4. 架构影响与改动点

```
Android TV 设备
   │ 媒体键 → 系统 → MediaSession → TrackPlayer（已路由，验证即可）
   │ D-pad  → 原生 dispatchKeyEvent / RN 焦点链 → UI 适配层
   ▼
[原生壳层新增]
  MainActivity：TV 适配（LEANBACK_LAUNCHER、touchscreen not-required、媒体键转发兜底）
  AndroidManifest：LEANBACK_LAUNCHER + banner + 硬件特性声明
[UI/平台适配层（新增，按设备能力分支）]
  src/tv/：焦点包装组件（Focusable）、D-pad 导航 Hook、PagerView/FlatList 方向键适配
[业务核心层（复用，不改动）]
  core/player/* 动作函数、core/list/*、core/music/*
[状态/事件层（复用，不改动）]
  store/* 、 global.*_event
```

### 4.1 复用而非新增的核心入口（务必复用）
`core/player/player.ts`：`togglePlay / pause / stop / playNext / playPrev / playList / playListById / setMusicUrl`。
`core/list/*`：`addMusic`、`removeMusic` 等列表操作（加歌/移除）。
这些函数同时服务于触摸与遥控，**禁止在适配层重写播放/列表逻辑**。

### 4.2 需要新增/改造的层
| 层 | 改动 | 风险 |
|----|------|------|
| 原生壳 | `MainActivity.dispatchKeyEvent` 媒体键兜底转发；Manifest TV 化 | 低（仅 TV 设备生效，手机路径不变） |
| UI 适配 | `src/tv/` 焦点组件 + 各 screen 加焦点 + PagerView/FlatList 方向键适配 | 高（逐屏、逐组件，回归面大） |
| 导航 | RNN 跨栈焦点编排（无内置 TV 焦点引导） | 中 |
| 体验（可选） | 10 英尺布局/主题、`LEANBACK` 主浏览页 | 中（可选，按需） |

## 5. 分阶段实施计划

### 阶段 1 ｜ MVP：媒体键播控（高性价比，约数天）
**目标**：装上 Android TV 即能用遥控器控制播放。
1. `AndroidManifest.xml`：`MainActivity` 增加 `LEANBACK_LAUNCHER` intent-filter；声明 `<uses-feature android:name="android.hardware.touchscreen" android:required="false"/>`；加 `android:banner`（`res/drawable/banner.png`）。
2. 实测 TrackPlayer MediaSession 是否已响应媒体键（含后台/锁屏）。
3. 若未完全接管，在 `MainActivity` 覆写 `dispatchKeyEvent`，将 `KEYCODE_MEDIA_*` 转发到 RN 侧全局事件 → `core/player` 对应动作（参考 `src/event/appEvent.ts` 的动作语义）。
4. **验证**：TV 上安装 → 遥控器播放/暂停/上下首可用；后台仍可用。
**产出**：遥控播控最小可用版。

### 阶段 2 ｜ 完整 D-pad 导航（主要工作量，数周）
**目标**：遥控器逛遍搜索/列表/播放详情/设置/加歌。
1. 新增 `src/tv/Focusable.tsx`：包裹 `TouchableOpacity`/`Button`，加 `focusable`、可见焦点框（基于主题色 `c-primary`）。
2. 逐屏改造 `src/screens/*`：所有 `TouchableOpacity`/`Button` 替换为 `Focusable`；编排 `nextFocusUp/Down/Left/Right` 与每屏 `defaultFocus`。
3. `src/tv/PagerAdapter.tsx`：拦截左右键 `setPage` 替代滑动（`react-native-pager-view` ref）。
4. `FlatList` 方向键滚动（获得焦点时上下键滚动 / 歌词上下键 seek）。
5. 长按菜单改为「菜单键 / OK 二次确认」唤起现有 `Menu`/`Modal`。
6. RNN 跨 stack 焦点处理（`navigation.ts` 的 `setRoot/push` 后恢复焦点）。
**产出**：遥控器完整交互。

### 阶段 3 ｜ TV 体验打磨（可选）
1. 10 英尺专属布局/字号（复用 `core/theme` 动态主题，新增 TV 主题）。
2. `LEANBACK` 主浏览页（若需完全贴合 TV 规范，接近重写首页，按需取舍）。
3. Banner 美术、TV 专有关卡文案。

## 6. 风险与已知问题（⚠️ 待实测/决策）

1. **媒体键后台可用性**：TrackPlayer fork 是否让媒体键在无 UI 焦点/后台生效未实测，阶段 1 必须验证；若否，需 `dispatchKeyEvent` 兜底（§5.1.3）。
2. **声明 `touchscreen not-required` 后**：所有硬依赖长按/滑动的交互（如 `onLongPress` 菜单、`PagerView` 滑动、`Lyric` 拖动）必须有 D-pad 等价路径，否则 TV 上功能缺失。
3. **RNN 无 TV 焦点引导**：跨 stack 焦点需手动编排，回归成本高。
4. **第三方视图焦点**：`react-native-pager-view`、`@react-native-community/slider` 的 TV 方向键支持需逐一验证/包装。
5. **焦点框可见性**：需基于现有主题色系（`theme['c-primary']` 等，`docs/modules/theme.md`）设计，避免引入新硬编码颜色。
6. **代码分支策略（已调整）**：本项目是 **Android TV 专属分支**，不再做「手机版零回归」的运行时 `Platform.isTV` 分支；TV 行为（焦点框、方向键、媒体键转发）默认常开。统一以 `src/tv/constants.ts` 的 `IS_TV` 常量为唯一开关，便于整体切换。原生侧 `MainActivity.isTv()` 检测也已移除，媒体键转发常开。
7. **与现有架构一致性**：遥控入口必须复用 `core/` 动作与 `*_event`，见 ADR-2/3，避免遥控与触摸出现行为分叉（如 §4.1 列出的动作函数）。

## 7. 验收标准（建议）

- 阶段 1：TV 安装后，遥控器播放/暂停/上下首可用（前台+后台）。
- 阶段 2：遥控器可完成「搜索→打开歌单→播放→加收藏→切设置→返回」主路径，无触摸依赖。
- 阶段 3（可选）：客厅 3 米距离可读；通过 Leanback 主屏进入。

## 8. 关联改动文件速查

| 文件 | 阶段 | 改动 |
|------|------|------|
| `android/app/src/main/AndroidManifest.xml` | 1 | LEANBACK_LAUNCHER、touchscreen not-required、banner |
| `android/app/src/main/java/.../MainActivity.java` | 1 | `dispatchKeyEvent` 媒体键转发（TV 分支常开，移除 `isTv()` 检测） |
| `res/drawable/banner.xml`（新增） | 1 | TV banner（占位） |
| `src/tv/constants.ts`（新增） | 1/2 | `IS_TV = true` 唯一开关 |
| `src/tv/remoteKey.ts`（新增） | 1 | 媒体键 → `core/player` 动作映射（普通函数，非 Hook） |
| `src/core/init/index.ts` | 1 | 初始化后挂载 `remoteKey` 监听 |
| `src/tv/Focusable.tsx`（新增） | 2 | 焦点包装组件（MENU 键 → onMenu、焦点边框） |
| `src/tv/PagerTV.tsx`（新增） | 2 | PagerView 方向键适配 |
| `src/components/common/Button.tsx` | 2 | 焦点感知边框（全量按钮自动覆盖） |
| `src/components/player/Progress.tsx`、`ProgressBar.tsx` | 2 | 方向键 seek |
| `src/screens/*` | 2 | 替换 `TouchableOpacity` 为 `Focusable`、编排焦点（约 60 文件） |
| `src/core/player/player.ts` | 1/2 | **复用** `togglePlay/playNext/playPrev` 等，不改逻辑 |
