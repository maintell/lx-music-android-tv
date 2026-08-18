# 代码规范（Code Style）

> 读者可从中获得什么：看懂 `.eslintrc.cjs` 的规则体系（standard 风格 + TypeScript 覆盖，哪些严格哪些被放宽）；掌握项目 TypeScript 约定（`LX.*` 全局命名空间、`declare global`、类型优先）；明确命名、路径别名、事件总线、存储 key 前缀、注释风格等约定，让 PR 顺利通过 lint 与评审。
>
> 前置阅读：[docs/design-doc.md](./design-doc.md)（状态管理 / 事件总线 / 存储机制）、[docs/contributing.md](./contributing.md)。

---

## 1. 工具链

| 工具 | 配置文件 | 用途 |
|------|----------|------|
| ESLint | `.eslintrc.cjs` | 静态检查；`npm run lint` / `npm run lint:fix` 执行 |
| TypeScript | `tsconfig.json` | 类型检查；继承 `@react-native/typescript-config` 基础配置 |
| Babel | `babel.config.js` | 转译 + `@/` 别名解析（与 tsconfig `paths` 同步） |

校验命令：

```powershell
npm run lint        # 全量检查
npm run lint:fix    # 自动修复
```

CI（`build-test.yml`）会在 PR 时强制执行 `npm run lint`，未通过无法合并。

## 2. ESLint 配置解析

`extends` 链：`standard` → `plugin:react/recommended` → `plugin:react-hooks/recommended` → `plugin:react/jsx-runtime`；JS/JSX 用 `@babel/eslint-parser` 解析；TS/TSX 走 `standard-with-typescript`（`parserOptions.project` 指向 `./tsconfig.json`）。

### 2.1 全局覆盖规则（baseRule，JS 与 TS 共用）

| 规则 | 配置 | 说明 |
|------|------|------|
| `space-before-function-paren` | `error, never` | 函数名后不留空格：`async() => {}` 而非 `async () => {}` |
| `no-var` | `error` | 禁用 `var` |
| `require-atomic-updates` | `error, allowProperties` | 防止异步更新丢失 |
| `comma-dangle` | `always-multiline` | 多行结尾必须加逗号 |
| `no-multiple-empty-lines` | warn，最多 2 空行 | — |
| `no-new` / `camelcase` / `no-return-assign` / `eqeqeq` / `no-fallthrough` / `prefer-const` / `no-labels` / `multiline-ternary` / `react/display-name` / `react/prop-types` | 全部关闭 | 放宽项 |

### 2.2 TS 关键覆盖规则（仅 `*.ts` / `*.tsx`）

| 规则 | 配置 | 影响 |
|------|------|------|
| `@typescript-eslint/strict-boolean-expressions` | `off` | 允许 `if (ids.length)`、`!!state.x` 等宽松布尔判断 |
| `@typescript-eslint/naming-convention` | `off` | 不强制命名风格（命名约定见 §4） |
| `@typescript-eslint/explicit-function-return-type` | `off` | 不强制显式返回类型（推断即可） |
| `@typescript-eslint/no-non-null-assertion` | `off` | 允许 `!` 非空断言 |
| `@typescript-eslint/no-misused-promises` | `error` + `checksVoidReturn.arguments/attributes: false` | Promise 误用仍报错，但放行 void 位置的实参/属性场景（如 `then(() => checkUpdate())`） |
| `@typescript-eslint/restrict-template-expressions` | warn + `allowBoolean` | 模板字符串中仅允许 boolean 额外插入 |
| `@typescript-eslint/return-await` / `comma-dangle` / `no-dynamic-delete` / `ban-ts-comment` / `ban-types` | 关闭 | 放宽项 |

`ignorePatterns`：`node_modules`、`*.min.js`、`test.js`、`*Test.ts`。

## 3. TypeScript 规范

### 3.1 全局类型命名空间 `LX.*`

- 全局类型统一放在 `src/types/` 的 `.d.ts` 中，以 `declare namespace LX` 组织，按领域分文件：`music.d.ts`（MusicInfo、Quality）、`list.d.ts`（List）、`player.d.ts`（Player）、`sync.d.ts`、`theme.d.ts`、`download_list.d.ts`、`user_api.d.ts`、`common.d.ts` 等。
- 业务代码引用全局类型直接写 `LX.Music.MusicInfo`、`LX.List.UserListInfo`，无需 import。

### 3.2 `declare global` 声明运行时全局对象

`src/types/app.d.ts` 通过 `declare global` 声明挂载在 `global` 上的运行时对象与事件总线，例如：

| 全局对象 | 类型 | 说明 |
|----------|------|------|
| `global.lx` | `LX.GlobalData`（本文件 `interface GlobalData`） | 跨模块运行时状态（`fontSize`、`playerStatus`、`qualityList`、`apis`、`homePagerIdle` 等） |
| `global.state_event` | `StateEventTypes` | 状态变更总线 |
| `global.app_event` | `AppEventTypes` | 应用/播放器行为总线 |
| `global.list_event` / `global.dislike_event` | `ListEventTypes` / `DislikeEventTypes` | 列表类事件总线 |
| `global.i18n` | `I18n` | 国际化运行时 |
| `global.Buffer` | `typeof Buffer` | Node Buffer polyfill（`shim.js`） |

> 新增全局对象时同步改这里；`global.lx` 的初始化在 `src/config/globalData.ts`。

### 3.3 类型优先

- 先用类型描述数据契约，再写实现；领域状态必有 `InitState` 类型（`store/<域>/state.ts` 导出）。
- 业务代码避免 `any`（`@typescript-eslint/no-unsafe-*` 仍生效）；历史 JS 文件（`.js`）不强制类型化。
- 判别联合（discriminated union）用于区分各音乐源：`MusicInfo` 按 `source` 判别，`meta` 字段因源而异（见 design-doc §4.1）。

## 4. 命名约定

| 对象 | 约定 | 示例 |
|------|------|------|
| 文件/目录（非组件） | camelCase | `src/store/list/action.ts`、`src/core/init/index.ts` |
| 组件文件 | PascalCase | `VersionModal.tsx`、`MusicAddModal/` |
| 类 / 类型 | PascalCase | `StateEvent`、`InitState`、`LX.Music.MusicInfo` |
| 常量（含枚举值） | SCREAMING_SNAKE_CASE | `HEADER_HEIGHT`、`LIST_IDS.DEFAULT`、`storageDataPrefix.setting`、`COMPONENT_IDS.home` |
| 函数 / 变量 | camelCase | `setApiSource`、`isFirstPush` |
| 事件名（emit 字符串） | camelCase | `'mylistUpdated'`、`'playStateChanged'` |
| 存储 key | `@` 前缀小写（见 §6） | `'@setting_v1'`、`'@list__<listId>'` |

> `@typescript-eslint/naming-convention` 虽关闭，但项目实际代码遵循上表，评审按此执行。

## 5. 路径别名 `@/`

- 一律用 `@/` 引用 `src/` 内文件：`import { initTheme } from '@/core/init/theme'`。
- 别名在 `babel.config.js`（module-resolver）与 `tsconfig.json`（paths）两处配置，二者必须同步。
- 旧式细分别名（`@config`、`@store` 等）已注释停用，不要新增使用。

## 6. 事件总线使用规范

总线基类 `src/event/Event.ts` 提供 `on / off / emit / offAll`；4 个类型化子类位于 `src/event/`（`stateEvent.ts` / `appEvent.ts` / `listEvent.ts` / `dislikeEvent.ts`），语义与挂载点见 design-doc §3.4.3。

- **on/off 成对**：组件内在 `useEffect` 中注册并在 cleanup 中注销，防止泄漏（见 `src/store/list/hook.ts`）：
  ```ts
  useEffect(() => {
    global.state_event.on('mylistUpdated', setList)
    return () => {
      global.state_event.off('mylistUpdated', setList)
    }
  }, [])
  ```
- **emit 类型化**：不要直接 `emit('xxx')` 散字符串；在总线子类中定义带参数类型的方法（如 `mylistUpdated(lists: Array<LX.List.MyListInfo>)`），并通过 `on<K>` 泛型在 `app.d.ts` 暴露类型化 `on/off`，保证编译期契约。
- **跨模块通信走总线**：core 修改状态后通过 `global.state_event` 广播；UI 只订阅不直接改 `state.ts`（`action.ts` 才改）。
- 事件名冲突检查：`state_event` 与 `app_event` 都有 `mylistUpdated`（语义不同：状态变更 vs 行为事件），新增事件先确认目标总线。

## 7. 存储 key 前缀约定

所有 AsyncStorage key 统一定义在 `src/config/constant.ts` 的 `storageDataPrefix`（`as const` 对象），以 `@` 开头，禁止在业务代码中散落字符串 key。常用 key：

| key | 用途 |
|-----|------|
| `@setting_v1` | 应用设置 |
| `@list__<listId>` | 列表内歌曲（`list` 为带双下划线的可变前缀） |
| `@play_info` | 播放恢复信息 |
| `@user_api__` | 自定义音源脚本 |
| `@dislike_list` / `@sync_auth_key` / `@theme` / `@font_size` 等 | 对应领域 |

旧版 key 在 `storageDataPrefixOld` 中登记（迁移用）。大值存储走 `src/plugins/storage.ts` 的分片封装（>500000 字符拆片，design-doc §6.1）。

## 8. 代码注释风格

- **注释使用中文**（源码惯例），函数用途、参数说明用 JSDoc：
  ```ts
  /**
   * 我的列表更新
   */
  mylistUpdated(lists: ...) { ... }
  ```
- 常量声明处可附行尾注释说明语义：`listLoop: 'listLoop', // 列表循环`。
- 保留的历史说明性注释（如 `constant.ts` 中「v0.x.x 版本的 data keys」）用于标注兼容性，不要随意删除。

## 9. 自研 store 三层模式

每个领域目录 `store/<域>/` 固定三个文件（design-doc §3.4.2），新增领域照此结构：

| 文件 | 职责 | 规范 |
|------|------|------|
| `state.ts` | 唯一数据源单例 + `InitState` 类型 | 组件不直接改它 |
| `action.ts` | 修改 state 的纯操作函数，改后广播事件 | 默认导出对象，方法名 `setXxx` / `addXxx` |
| `hook.ts` | `useXxx` hooks，订阅事件映射响应式值 | 必须 on/off 成对 |

示例：`src/store/list/state.ts` / `action.ts` / `hook.ts`；已废弃的 Redux 代码（`src/store/Provider/Provider.tsx`）不要参考或恢复。

## 10. 相关文档

- 贡献指南：[./contributing.md](./contributing.md)
- 工程结构：[./project-structure.md](./project-structure.md)
- 状态管理与事件总线：[design-doc.md §3.4](./design-doc.md)
- 持久化机制：[design-doc.md §6.1](./design-doc.md)
