# 主题系统（Theme）

> 读者获益：本文档讲清楚「一个主题从定义到上屏」的完整链路——内置主题如何声明、`build:theme` 生成什么、运行时如何由主色推导整套色板、切主题/跟随系统亮暗如何触发 UI 刷新，以及新增一个主题需要改哪几个文件。读完你可以独立新增主题、排查「切主题不生效」「暗色背景不隐藏」「动态背景不随封面变化」等问题。

## 设计依据

本文档对应 [design-doc.md](../design-doc.md) 的以下内容：

- **5.5 主题（core/theme + src/theme）**：`src/theme/themes/` 是主题定义与生成脚本（`createThemes.js`，npm script `build:theme`）；`src/theme/` 的 `Colors.js`、`Typography.js`、`index.js` 提供应用层样式入口；`core/theme.ts` 负责主题切换（亮/暗/自动跟随系统）、动态背景、字体阴影设置。
- **6.4 路径别名与构建**：主题生成命令 `npm run build:theme`（`node src/theme/themes/createThemes.js`）。
- **7 扩展点设计**：新增主题 = 在 `src/theme/themes/` 添加主题定义 + 重新运行 `build:theme`。

> 说明：本文档与系统架构图（`../architecture.md`）中的分层保持一致——主题属于「业务核心层 core/theme + store/theme」与「插件适配层 src/theme」的协作模块。

## 1. 主题系统架构

```
主题定义（createThemes.js 的 defaultThemes，仅 3 个输入色）
   │  npm run build:theme（node src/theme/themes/createThemes.js）
   ▼
生成产物（themes.ts：每个主题的完整 themeColors 色板 + extInfo）
   │  运行时读取（themes/index.ts：getTheme / buildActiveThemeColors）
   ▼
store/theme/state.ts（ActiveTheme 当前生效主题）
   │  core/theme.ts（setTheme / applyTheme / setShouldUseDarkColors）
   ▼
state_event.themeUpdated 广播
   │  ThemeProvider.tsx 订阅 → ThemeContext 更新
   ▼
UI 消费（useTheme() hook → 组件取颜色/背景图）
```

三个阶段的职责边界：

| 阶段 | 位置 | 职责 |
|------|------|------|
| 定义 | `src/theme/themes/createThemes.js` | 内置主题清单（仅声明主色 primary、字体色 font、isDark、extInfo 扩展信息） |
| 生成 | `npm run build:theme` | 由主色推导整套色板，输出 `themes.ts` |
| 运行时 | `src/theme/themes/index.ts` + `store/theme` + `core/theme.ts` | 选择主题、合成 ActiveTheme、广播并应用到 UI |

## 2. 主题定义文件结构

### 2.1 内置主题清单（`createThemes.js` 的 `defaultThemes`）

| id | 名称 | isDark | bg-image | 主色 primary |
|----|------|--------|----------|--------------|
| `green` | 绿意盎然 | false | - | rgb(77, 175, 124) |
| `blue` | 蓝田生玉 | false | - | rgb(52, 152, 219) |
| `blue_plus` | 蛋雅深蓝 | false | - | rgb(77, 131, 175) |
| `orange` | 橙黄橘绿 | false | - | rgb(245, 171, 53) |
| `brown` | 泥牛入海 | false | - | rgba(188, 128, 68, 1) |
| `red` | 热情似火 | false | - | rgb(214, 69, 65) |
| `pink` | 粉装玉琢 | false | - | rgb(241, 130, 141) |
| `purple` | 重斤球紫 | false | - | rgb(155, 89, 182) |
| `grey` | 灰常美丽 | false | - | rgb(108, 122, 137) |
| `ming` | 青出于黑 | false | - | rgb(51, 110, 123) |
| `blue2` | 清热板蓝 | false | - | rgb(79, 98, 208) |
| `black` | 黑灯瞎火 | true | landingMoon.png | rgb(190, 190, 190) |
| `mid_autumn` | 月里嫦娥 | false | jqbg.jpg | rgb(74, 55, 82) |
| `naruto` | 木叶之村 | false | myzcbg.jpg | rgb(87, 144, 167) |
| `china_ink` | 近墨者黑 | false | china_ink.jpg | rgba(47, 47, 47, 1) |
| `happy_new_year` | 新年快乐 | false | xnkl.png | rgb(192, 57, 43) |

内置背景图资源在 `src/theme/themes/images/`（china_ink.jpg、jqbg.jpg、landingMoon2.png、myzcbg.jpg、xnkl.png），运行时经 `themes/index.ts` 的 `BG_IMAGES` 映射为 `ImageSourcePropType`。

每个主题定义的结构（`LX.Theme`，见 `src/types/theme.d.ts`）：

```ts
{
  id: string        // 唯一标识
  name: string      // 显示名（中文）
  isDark: boolean   // 是否暗色主题
  isCustom: boolean // 是否为用户自定义主题（内置为 false）
  config: {
    themeColors: ThemeColors   // 由生成脚本产出的完整色板
    extInfo: {                 // 扩展信息
      'c-app-background': string   // 应用背景（可用 var() 引用色板）
      'c-main-background': string  // 主内容背景
      'bg-image': string           // 背景图（内置主题为 images/ 文件名）
      'bg-image-position': string  // 'center'
      'bg-image-size': string      // 'cover'
      'c-badge-primary' | 'c-badge-secondary' | 'c-badge-tertiary': string  // 徽章颜色
    }
  }
}
```

### 2.2 新年主题特例

`src/config/defaultSetting.ts` 底部：每年 1-2 月（`new Date().getMonth() < 2`）默认 `theme.id` 被改为 `happy_new_year`，并连带调整桌面歌词播放色（`desktopLyric.style.lyricPlayedColor`）。这是构建期按日期决定的默认值，不影响用户手动选择。

### 2.3 显示名来自 i18n（新增主题易忽略）

设置页主题列表（`settings/Theme/Theme.tsx`）对**内置主题**取显示名用的是 `t('theme_' + id)`（如 `theme_green`），而不是 `createThemes.js` 里 `name` 字段——`name` 字段只存在于生成产物与 ActiveTheme 元数据中。

| 主题 id | zh-cn | zh-tw | en-us |
|---------|-------|-------|-------|
| `theme_green` | 绿意盎然 | 綠意盎然 | Green |
| `theme_black` | 黑灯瞎火 | 黑燈瞎火 | Black |
| `theme_happy_new_year` | 新年快乐 | 新年快樂 | New Year |
| `theme_naruto` | 木叶之村 | 木葉之村 | Naruto |

因此**新增内置主题时，除了加主题定义，还必须给三个语言包补 `theme_<id>` 文案**，否则设置页显示 key 原文（详情见 [i18n.md](./i18n.md) §8 使用规范）。用户自定义主题则直接用其自身的 `name` 字段。

## 3. createThemes.js 生成机制

- 命令：`npm run build:theme` → `node src/theme/themes/createThemes.js`。
- 输入：`defaultThemes`（上表，仅 3 个输入色：primary、font、isDark + extInfo）。
- 处理：对每个主题调用 `createThemeColors(primary, font, isDark)`（`themes/utils.js`），生成完整的 `themeColors` 色板；`primary`/`font` 被移除出 extInfo。
- 输出：覆盖写入 `src/theme/themes/themes.ts`，文件头注释 `//! 此文件由 createThemes.js 生成` 并 `/* eslint-disable */`，内容为 `export default [...] as const`（当前约 4000 行）。
- **约束**：修改 `createThemes.js` 后必须重跑 `build:theme`，否则 `themes.ts` 与定义不同步（文件头注释即提醒）。

## 4. 动态配色（colorUtils.js / utils.js）

### 4.1 色彩函数（`themes/colorUtils.js`，参考 pSBC 微型实现）

| 函数 | 行为 |
|------|------|
| `RGB_Linear_Shade(p, c0)` | 线性明暗：`p` 为 -1.0~1.0，负向黑、正向白 |
| `RGB_Log_Shade(p, c0)` | 对数明暗（非线性，观感更均匀） |
| `RGB_Alpha_Shade(p, color)` | 修改透明度：`p` 为 -1.0~1.0，已有 alpha 时按比例叠加 |
| `RGB_Linear_Blend(p, c0, c1)` | 两个颜色线性混合 |
| `RGB_Log_Blend(p, c0, c1)` | 两个颜色对数混合 |

### 4.2 色板生成规则（`themes/utils.js` 的 `createThemeColors`）

由主色 `rgbaColor` 与 `isDark` 生成命名色板：

- **暗色方向**（`c-primary-dark-100` ~ `c-primary-dark-1000`）：循环 10 次，每次 `RGB_Linear_Shade(isDark ? 0.2 : -0.1, prev)` 递进变暗；每档再生成 9 个透明度变体 `-alpha-100` ~ `-alpha-900`。
- **亮色方向**（`c-primary-light-100` ~ `c-primary-light-900`）：`RGB_Linear_Shade(isDark ? -0.1 : 0.2, prev)` 递进变亮，同样每档带 alpha 变体；`c-primary-light-1000` 为 `RGB_Linear_Shade(isDark ? -0.35 : 1, prev)` 的极值（亮色主题为纯白）。
- **主色 alpha 变体**：`c-primary-alpha-100` ~ `c-primary-alpha-900`（对主色本身做透明度）。
- **`c-theme`**：暗色主题取 `c-primary-light-900`，亮色主题取主色。
- **字体色阶**（`createFontColors`）：从 `c-1000`（font 色）起步，按 50 步长递减生成 `c-950` ~ `c-000`；暗色主题走 `createFontDarkColors`（固定步长 -0.05 递进）。

### 4.3 具体推导示例（green 主题）

以 `green`（primary=rgb(77,175,124)、isDark=false）为例：

| 色板键 | 推导 | 结果 |
|--------|------|------|
| `c-primary` | 输入主色 | rgb(77, 175, 124) |
| `c-primary-dark-100` | Shade(-0.1) | rgb(69,158,112) |
| `c-primary-dark-200` | 在上一步基础上再 Shade(-0.1) | rgb(62,142,101) |
| `c-primary-light-100` | Shade(+0.2) | rgb(113,191,150) |
| `c-primary-light-1000` | Shade(+1) 极值 | rgb(255,255,255) |
| `c-primary-alpha-100` | Alpha(0.9) | rgba(77, 175, 124, 0.90) |
| `c-theme` | 亮色主题取主色 | rgb(77, 175, 124) |
| `c-1000` / `c-850` | 字体色阶（font=rgb(33,33,33)） | rgb(33,33,33) / rgb(66,66,66) |

可见「暗色主题的暗方向步进更大（0.2）、亮方向更小（0.1）」，使暗色主题的深色梯度更丰富。

### 4.4 var() 引用

`extInfo` 中的颜色值支持 `var(<色板键>)` 写法（如 `'c-app-background': 'var(c-primary-light-600-alpha-700)'`），在 `buildActiveThemeColors`（`themes/index.ts`）中运行时替换为实际色值——这使主题定义可以「以主色为锚点」而非写死颜色。`black` 主题的徽章色即使用 `var(c-primary-dark-200)` 等引用。

## 5. ThemeProvider 与 ThemeContext

- `store/theme/state.ts`：定义 `InitState { shouldUseDarkColors, theme: LX.ActiveTheme }`，导出单例 `state` 与 `ThemeContext = createContext(state.theme)`。state 中的初始 theme 是绿色主题的完整色板快照（含语义色），保证首次渲染有值。
- `store/Provider/ThemeProvider.tsx`：订阅 `state_event.themeUpdated`，收到新主题后在 `requestAnimationFrame` 中 `setTheme`，并通过 `ThemeContext.Provider` 下发给整棵组件树。
- `store/theme/action.ts`：
  - `setTheme(theme)`：`buildActiveThemeColors(theme)` 合成 `LX.ActiveTheme` 后写入 state，并广播 `global.state_event.themeUpdated(theme)`。
  - `setShouldUseDarkColors(flag)`：记录系统亮暗偏好（不广播，仅在值变化时更新）。

### 5.1 buildActiveThemeColors 合成逻辑

输入原始 `LX.Theme`，输出扁平化的 `LX.ActiveTheme`（`types/theme.d.ts`）：

1. 解析背景图：内置主题查 `BG_IMAGES`；自定义主题（`isCustom`）按 `isUrl` 决定是网络图还是本地私有目录 `theme_images/` 文件。**暗色主题 + `theme.hideBgDark=true` 时隐藏背景图**。
2. 替换 `var()` 引用。
3. 摊平色板，并追加一组**语义色别名**（UI 实际消费的键）：

| 别名 | 来源 |
|------|------|
| `c-font` / `c-font-label` | `c-850` / `c-450` |
| `c-primary-font` / `-hover` / `-active` | `c-primary` / `c-primary-alpha-300` / `c-primary-dark-100-alpha-200` |
| `c-primary-background` / `-hover` / `-active` / `-input` | `c-primary-light-400-alpha-700` 等 |
| `c-button-font` / `-selected` | `c-primary-alpha-100` / `c-primary-dark-100-alpha-100` |
| `c-button-background` / `-selected` / `-hover` / `-active` | `c-primary-light-400-alpha-700` 等 |
| `c-list-header-border-bottom` | `c-primary-alpha-900` |
| `c-content-background` | `c-primary-light-1000` |
| `c-border-background` | `c-primary-light-100-alpha-700` |

## 6. 运行时加载与切换

### 6.0 用户自定义主题（isCustom）

- 存储：`@theme`（`storageDataPrefix.theme`），读写接口 `getUserTheme` / `saveUserTheme`（`src/utils/data.ts`）。
- 管理：`themes/index.ts` 的 `getAllThemes()`（内置 + 用户合并，`dataPath` 指向私有目录 `theme_images/`）、`saveTheme(theme)`（按 id 覆盖或追加）、`removeTheme(id)`。
- 加载：`getTheme()` 在内置主题中找不到 id 时回落查找用户主题；`buildActiveThemeColors` 对 `isCustom` 主题走本地/网络背景图解析分支（§5.1 第 1 步）。
- 设置页：用户主题卡片用主题自身的 `name` 字段显示（与内置主题走 `theme_<id>` i18n 不同，见 §2.3）。
- 背景图目录：`theme_images/` 位于应用私有存储目录（`privateStorageDirectoryPath`），用户导入的背景图文件按文件名引用；网络 URL 背景直接存 URL。

### 6.1 初始化（`core/init/theme.ts`）

- 若系统支持自动亮暗（`getIsSupportedAutoTheme()`）：`setShouldUseDarkColors(getAppearance() == 'dark')`，并注册 `onAppearanceChange`——系统亮暗变化时更新标记，若 `common.isAutoTheme` 开启则重新 `getTheme().then(applyTheme)`。
- 首次 `applyTheme(await getTheme())`。
- 订阅 `themeUpdated` 同步 `StatusBar` 样式（暗色主题 → light-content）。

### 6.2 getTheme 选择逻辑（`themes/index.ts`）

```
themeId = (common.isAutoTheme && shouldUseDarkColors) ? 'black' : setting['theme.id']
  → 在内置 themes 中查找；找不到查用户自定义主题（@theme 存储）
  → 都没有 → 回退 'green'（暗色自动场景回退 'black'）
```

> **注意（疑点）**：`theme.lightId` / `theme.darkId` 设置项在 `defaultSetting.ts` 中存在，但当前 `getTheme` 实现并未使用它们——自动模式暗色时硬编码为 `black`（源码中有被注释掉的旧逻辑使用 lightId/darkId）。如需「自动模式下暗色用指定主题」的能力，需要补回该逻辑。详见 §10。

### 6.3 切换流程（`core/theme.ts`）

```
setTheme(id)                     // 设置页点击主题卡片
  ├─ updateSetting({ 'theme.id': id })   // 持久化 + state_event.configUpdated
  ├─ getTheme() 异步解析主题
  │    └─ theme.id == 当前生效主题 → 跳过
  └─ applyTheme(theme)
       └─ themeActions.setTheme(theme) → buildActiveThemeColors → themeUpdated
```

其它入口：`setShouldUseDarkColors`（系统亮暗变化）；用户自定义主题的新增/删除走 `themes/index.ts` 的 `saveTheme` / `removeTheme`（读写 `@theme` 存储）。

### 6.4 设置页开关行为（`settings/Theme/`）

| 组件 | 设置键 | 开关行为 |
|------|--------|----------|
| `Theme.tsx` | `theme.id` | 主题卡片列表（`getAllThemes()` 内置 + 用户主题），点击 `setTheme(id)`；「显示更多」展开全部 |
| `IsAutoTheme.tsx` | `common.isAutoTheme` | 仅系统支持自动亮暗时显示；开启后立即 `getTheme().then(applyTheme)`（按当前系统亮暗重选主题） |
| `IsHideBgDark.tsx` | `theme.hideBgDark` | 切换后仅当「当前主题是暗色 或 开启自动主题」时重新 applyTheme（亮色主题下背景不受此开关影响） |
| `IsDynamicBg.tsx` | `theme.dynamicBg` | 切换仅写设置；运行时由 `core/init/common.ts` 消费（见 §8） |
| `IsFontShadow.tsx` | `theme.fontShadow` | 切换仅写设置；`useTextShadow` 消费 |

### 6.5 导航层的主题应用

RNN（react-native-navigation）的屏幕 options 在 `src/navigation/navigation.ts` 与 `navigation/utils.ts` 中构建时直接读取 `themeState.theme`：用 `isDark` 决定 `getStatusBarStyle()`（暗色 → light-content）、用 `c-content-background` 作为屏幕背景色。这些 options 在主题变化后随各屏幕重建/刷新时更新，无需额外订阅。

## 7. UI 消费方式

### 7.1 hooks（`store/theme/hook.ts`）

| hook | 行为 |
|------|------|
| `useTheme()` | `useContext(ThemeContext)`，返回当前 `LX.ActiveTheme`（扁平色键 + 语义色别名 + bg-image），组件内直接 `theme['c-primary-font']` 取色 |
| `useTextShadow()` | 订阅 `configUpdated` 监听 `theme.fontShadow` 设置，返回是否启用字体阴影 |

> 代码中**不存在** `useThemeColors` hook——取色统一走 `useTheme()` 返回的 ActiveTheme 对象（扁平字符串键，如 `theme['c-button-background']`）。注意与 `src/theme/Colors.js` 的静态常量区分。

### 7.2 组件消费示例

```tsx
// src/components/TimeoutExitEditModal.tsx 的典型用法
const theme = useTheme()
<Text color={theme['c-font-label']} size={13}>{t('timeout_exit_btn_wait_tip')}</Text>
<Input style={{ backgroundColor: theme['c-primary-input-background'] }} />

// src/navigation/components/SyncModeModal.tsx
<Button style={{ backgroundColor: theme['c-button-background'] }} onPress={...}>
  <Text color={theme['c-button-font']}>{t('sync__mode_merge_btn_local_remote')}</Text>
</Button>
```

### 7.3 导航与状态栏

- `src/navigation/utils.ts` / `navigation.ts`：从 `themeState.theme` 读取 `isDark` 与 `c-content-background`，设置 `getStatusBarStyle(theme.isDark)`（暗色 → light-content）与屏幕背景色。
- `core/init/theme.ts` 另注册 `themeUpdated` 监听同步 StatusBar。

### 7.4 静态样式常量（`src/theme/`）

| 文件 | 导出 | 用途 |
|------|------|------|
| `Colors.js` | `AppColors`（primary/normal 系列/secondary 系列/borderColor 系列）、`MaterialColors`（red/purple/blue/green/yellow/orange/brown/grey 各 100-900） | 通用静态色（旧式引用，新组件以 ActiveTheme 为主） |
| `Typography.js` | `FontWeights`（Bold/Regular/Light）、`FontSizes`（Heading/SubHeading/Label/Body/Caption）、`BorderWidths`、`BorderRadius` | 字体、边框规范 |
| `index.js` | 汇总导出 `Themes`、`AppColors`、`MaterialColors`、字体/边框常量 | 应用层样式入口 |

> 提示：项目内还有历史遗留的 `useGetter('common', 'theme')` 用法（如 `navigation/components/Toast.js`），是旧 store 模式残留，新代码请统一使用 `useTheme()`。

> 另外注意 `Typography.js` 的 `FontWeights` 引用的是 `SFProDisplay-*` 字体族（iOS 风格命名），Android 上由字体 fallback 机制兜底；它不是主题色体系的一部分，新代码按 `FontSizes` / `BorderWidths` 使用即可。

### 7.5 常见消费对照表

| UI 元素 | 推荐的 theme key | 示例出处 |
|---------|------------------|----------|
| 按钮背景 / 输入框背景 | `c-button-background` / `c-primary-input-background` | `SyncModeModal.tsx`、`TimeoutExitEditModal.tsx` |
| 按钮文字 | `c-button-font` | `SyncModeModal.tsx` |
| 正文文字 / 次级文字 | `c-font` / `c-font-label` | `TimeoutExitEditModal.tsx` |
| 主色强调文字（链接、激活项） | `c-primary-font`（hover/active 变体） | `CommentText.tsx`、`VersionModal.tsx` |
| 列表分隔线 | `c-border-background` | `Sync/History.tsx` |
| 屏幕背景 | `c-content-background` | `navigation.ts`、`navigation/utils.ts` |
| 全局背景图 | `bg-image` | `ImageBackground` 组件 |
| 徽章颜色（badge） | `c-badge-primary` / `-secondary` / `-tertiary` | extInfo 直接定义或 `var()` 引用 |

## 8. 动态背景（theme.dynamicBg）

`core/init/common.ts` 实现「播放封面即背景」：

- 初始化时读取 `theme.dynamicBg`，订阅 `playerMusicInfoChanged`——歌曲信息变化时若封面存在且 `isDynamicBg` 开启，先 `prefetch` 封面，成功后 `setBgPic(封面)`。
- 订阅 `configUpdated`：`theme.dynamicBg` 关闭时 `setBgPic(null)` 还原；开启时立即用当前歌曲封面刷新。
- 注意：动态背景与主题背景图（`bg-image`）互斥由 `setBgPic` 的调用方保证，动态背景开启时覆盖主题背景图。
- 与 `theme.hideBgDark` 的配合：`hideBgDark` 影响的是**主题自带背景图**（`buildActiveThemeColors` 阶段），动态背景（封面图）不受 `hideBgDark` 限制；暗色主题下两者同时开启时，封面背景仍会显示。

## 9. 新增主题的步骤

1. **加主题定义**：在 `src/theme/themes/createThemes.js` 的 `defaultThemes` 数组追加一项——`id`（英文小写下划线）、`name`（中文显示名）、`isDark`、`primary`（主色）、`font`（字体色）、extInfo（背景、徽章色，可用 `var()` 引用）。若需要内置背景图，把图片放入 `src/theme/themes/images/` 并确保文件名与 `bg-image` 一致。
2. **补 i18n 显示名**：在 `zh-cn.json` / `zh-tw.json` / `en-us.json` 各加 `theme_<id>` key（见 §2.3），否则设置页显示 key 原文。
3. **重新生成**：执行 `npm run build:theme`，确认 `src/theme/themes/themes.ts` 已包含新主题（产物按 JSON 序列化，无需手工编辑）。
4. **设置内可选**：设置页主题列表（`settings/Theme/Theme.tsx`）通过 `getAllThemes()` 动态读取内置 + 用户主题，无需额外注册；点击卡片即 `setTheme(id)`。
5. **验收**：亮/暗两套主题各自核对语义色（按钮、输入框、列表头、内容背景）与背景图表现；对照 design-doc §7 扩展点「新主题」入口。

## 10. 待人工核对的疑点

1. **`theme.lightId` / `theme.darkId` 未生效**：`defaultSetting.ts` 声明了这两个键，`migrateSetting.ts` 也做了迁移，但 `getTheme()` 当前只用 `common.isAutoTheme` + 硬编码 `'black'`。要么补实现、要么在文档/设置中去掉，避免误导。
2. **`theme.dynamicBg` 无独立 UI 联动**：开关只影响 `core/init/common.ts` 的封面背景逻辑，与主题色板无关；接入 `setBgPic` 后背景是封面图而非主题背景图。
3. **`Colors.js` 静态色与新色板双轨并存**：旧组件可能仍引用 `AppColors.secondary*` 等静态色，切主题时不会变化，属历史债务（design-doc §8 同源问题）。
4. **新年主题是构建期日期判断**：跨年后需重新构建 APK 才会应用新的默认主题。
5. **`blue_plus` 徽章色为 rgba 浮点值**：`rgba(66.6, 150.7, 171, 1)` 这类带小数的颜色值是否能被原生解析，需真机验证。

## 11. 常见问题排查

| 症状 | 排查方向 |
|------|----------|
| 切主题不生效 | `setTheme` 是否触发 `themeUpdated`（`ThemeProvider` 订阅）；`getTheme` 是否命中目标 id；`theme.id` 是否已持久化 |
| 暗色主题下背景图不显示 | `theme.hideBgDark=true` 时 `buildActiveThemeColors` 主动隐藏背景图（`themes/index.ts` 第 60 行） |
| 自动模式切了主题但暗色不跟随 | `common.isAutoTheme` 未开启；或系统不支持自动亮暗（`getIsSupportedAutoTheme()` 为 false，设置页不显示开关） |
| 自定义主题背景图不显示 | `isCustom` 主题的背景图是 `theme_images/` 目录下的文件名或网络 URL（`isUrl` 判断）；本地文件路径前缀需为私有目录 `dataPath` |
| 动态背景不随封面变化 | `theme.dynamicBg` 未开启；封面 `prefetch` 失败不会设置背景 |
| 设置页主题名显示为 `theme_xxx` | 三语言包缺 `theme_<id>` key（见 §2.3） |
| 首次启动闪默认绿色 | `state.theme` 初始值就是 green 色板快照；`initTheme` 完成前 UI 已用初始值渲染 |
| 深色系统下启动却是亮色 | `common.isAutoTheme` 默认 false，`getTheme` 只在开启自动模式时用系统亮暗选择 `black`；否则用 `theme.id`（默认 green） |
| 状态栏颜色与主题不匹配 | `core/init/theme.ts` 通过 `themeUpdated` 同步 `StatusBar.setBarStyle`；若修改了 `navigation.ts` 的屏幕 options 需回归验证 |
| 自定义主题删除后仍显示 | `removeTheme(id)` 只删 `@theme` 存储中的用户主题；若 id 与内置主题撞名，删除后回落为内置主题 |
| 背景图拉伸变形 | 各主题 `bg-image-size: 'cover'`、`bg-image-position: 'center'` 由 extInfo 控制，自定义主题需自行设置 |
