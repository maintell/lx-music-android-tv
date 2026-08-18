# 开发环境搭建与快速开始（Getting Started）

> 读者可从中获得什么：按本文档从零搭好 Windows + Android 开发环境；学会安装依赖、启动 Metro 与在设备上运行调试版 App；掌握项目常用 npm 脚本与 `@/` 路径别名；遇到启动类问题（Metro 缓存、设备连接、SDK 缺失）时知道如何排查。
>
> 前置阅读：[docs/design-doc.md](./design-doc.md)（项目设计与约束的顶层依据）。

---

## 1. 环境要求

项目是 React Native 0.73.11 + React 18.2.0 应用，仅支持 Android 5（API 21）及以上，**官方不支持 iOS / HarmonyOS NEXT**（`ios/` 目录为历史遗留）。

| 组件 | 要求 | 说明 / 依据 |
|------|------|-------------|
| Node.js | `>= 18`（`.nvmrc` 为 `v18`） | `package.json` 的 `engines`；CI 按 `.nvmrc` 安装 Node |
| npm | `>= 8.5.2` | `package.json` 的 `engines` |
| JDK | 17 | CI 使用 Microsoft 发行版 JDK 17（`.github/actions/setup/action.yml`）；AGP 8.6.1 要求 JDK 17+ |
| Android SDK | 见下表 | `android/build.gradle` 定义版本 |
| 设备 | Android 5+ 真机或模拟器 | 通过 adb 连接，用于 `npm run dev` 运行调试包 |
| Ruby / CocoaPods | 不需要 | `Gemfile` 仅服务于 iOS 遗留目录，Android 开发可忽略 |

### 1.1 Android SDK 组件版本

以下版本定义在 `android/build.gradle` 与 `android/app/build.gradle`，本地需确保 SDK 已安装对应组件：

| 项目 | 版本 | 说明 |
|------|------|------|
| compileSdkVersion | 36 | 编译目标 SDK |
| targetSdkVersion | 29 | 应用目标 SDK（运行行为按 Android 10 处理） |
| minSdkVersion | 21 | 最低支持 Android 5.0 |
| buildToolsVersion | 35.0.0 | Android Build Tools |
| ndkVersion | 26.1.10909125 | NDK 版本（含 x86/x86_64 模拟器支持需安装） |
| Kotlin | 1.9.24 | RNN 等依赖使用 |
| AGP | 8.6.1 | Android Gradle Plugin（`classpath` 中指定） |

### 1.2 环境变量与本地配置

- 安装 Android SDK 后配置环境变量 `ANDROID_HOME`（指向 SDK 目录，如 `C:\Android\Sdk`），并把 `%ANDROID_HOME%\platform-tools` 加入 `PATH`（提供 `adb`）。
- 也可以不设环境变量，直接在 `android/local.properties` 中写入：

  ```properties
  sdk.dir=C\:\\Android\\Sdk
  ```

- 首次构建 gradle 会自动下载依赖，国内网络环境下若下载慢，可配置镜像仓库，但**项目源码未内置镜像配置**，属本地环境操作。

---

## 2. 获取代码与安装依赖

```powershell
git clone https://github.com/lyswhut/lx-music-mobile.git
cd lx-music-mobile
npm install
```

### 2.1 依赖中的 GitHub 源

`package.json` 中 4 个依赖直接以 `github:lyswhut/<repo>#<commit>` 形式引用 fork 仓库固定提交，`npm install` 时会从 GitHub 拉取。若拉取失败（网络原因），请配置 npm 代理或镜像后重试：

| 依赖 | 来源 |
|------|------|
| `react-native-background-timer` | `github:lyswhut/react-native-background-timer#55ecaa8…` |
| `react-native-file-system` | `github:lyswhut/react-native-file-system#fcb0e6f…` |
| `react-native-local-media-metadata` | `github:lyswhut/react-native-local-media-metadata#1b5be31…` |
| `react-native-track-player` | `github:lyswhut/react-native-track-player#bfe3393…` |

> 根目录的 `dependencies-patch.js` 用于安装后修补依赖源码（patch 列表当前为空数组），无需手动执行。

---

## 3. 运行

推荐使用两个终端：一个跑 Metro（JS 打包服务），一个执行构建安装命令。

### 3.1 启动 Metro

```powershell
npm run start
```

等价于 `react-native start`。Metro 会监听 8081 端口并实时打包 JS bundle。

### 3.2 构建并安装到设备

```powershell
npm run dev
```

等价于 `react-native run-android --active-arch-only`。`--active-arch-only` 表示只构建当前设备（或模拟器）对应的 ABI，显著加快首次构建。请先连接设备/启动模拟器再执行。

> 模拟器（AVD）：在 Android Studio 中创建 x86_64 镜像的 AVD 即可；真机需开启「开发者选项 → USB 调试」，可用 `adb devices` 确认连接。真机与电脑需同一局域网（或使用 `adb reverse tcp:8081 tcp:8081` 转发 Metro 端口）。

首次构建会执行 gradle 编译原生代码，耗时较长属正常。构建成功后 App 自动安装并启动，界面显示 bootLog 初始化流程后进入首页。

---

## 4. 常用脚本速查

| 命令 | 作用 | 等价命令 |
|------|------|----------|
| `npm run start` | 启动 Metro 打包服务 | `react-native start` |
| `npm run dev` | 构建调试包并安装到当前设备 | `react-native run-android --active-arch-only` |
| `npm run sc` | 重置缓存启动 Metro（启动异常时首选） | `react-native start --reset-cache` |
| `npm run lint` | ESLint 全量检查 | `eslint . --ext .js,.jsx,.ts,.tsx` |
| `npm run lint:fix` | ESLint 检查并自动修复 | 同上加 `--fix` |
| `npm run pack:android` | 构建 release APK（本地打包，见构建文档） | `cd android && gradlew.bat assembleRelease` |
| `npm run pack:android:debug` | 构建 debug APK | `./gradlew assembleDebug` |
| `npm run pack` | 同 `pack:android` | — |
| `npm run clear` | 清理 gradle 构建产物 | `cd android && gradlew.bat clean` |
| `npm run clear:full` | 清理全部产物与未跟踪文件（保留签名文件） | `git clean -fdx -e android/keystore.properties -e android/app/*.keystore` |
| `npm run build:theme` | 重新生成主题文件 | `node src/theme/themes/createThemes.js` |
| `npm run build-test` | 仅验证 JS bundle 能否打出（CI 用） | `react-native bundle --dev true …` |
| `npm run bundle-android` | 输出 release bundle 到 `android/app/src/main/assets/` | `react-native bundle --platform android --dev true …` |
| `npm run menu` | 向设备发送菜单键（打开 RN 开发者菜单） | `adb shell input keyevent 82` |
| `npm run rd` | 启动 React DevTools | `react-devtools` |
| `npm run publish` | 发布流程的日志更新脚本（见构建文档） | `node publish` |

---

## 5. 路径别名 `@/`

项目统一使用 `@/` 指向 `src/` 目录，**同时**在 Babel 与 TypeScript 中配置，两端必须保持一致：

| 文件 | 配置 |
|------|------|
| `babel.config.js` | `babel-plugin-module-resolver` 插件，`alias: { '@': './src' }`，并按 `.android.ts → .js → .json` 顺序解析扩展名 |
| `tsconfig.json` | `paths: { '@/*': ['./src/*'] }`，继承 `@react-native/typescript-config` 基础配置 |

示例（来自 `src/core/init/index.ts`）：

```ts
import { initSetting } from '@/core/common'
import registerPlaybackService from '@/plugins/player/service'
```

> 旧项目曾使用 `@config` / `@store` 等细分别名，现已在两处配置中注释停用，新代码一律使用 `@/`。

---

## 6. 常见启动问题

| 现象 | 处理 |
|------|------|
| Metro 报错 / 依赖变更后行为异常 | 执行 `npm run sc` 重置 Metro 缓存后重启 |
| `npm run dev` 找不到设备 | `adb devices` 确认设备在线；真机走 USB 调试或 `adb reverse tcp:8081 tcp:8081`；模拟器确认已启动 |
| 构建报 `NDK not configured` / SDK 版本缺失 | 用 SDK Manager 安装 `compileSdk 36`、Build Tools 35.0.0、NDK 26.1.10909125 |
| 报 Java 版本错误 | 确认 `java -version` 为 17（AGP 8.6.1 要求 JDK 17+） |
| `npm install` 卡在 GitHub 源 | 配置 npm 代理 / 镜像后重试（见 2.1） |
| 红屏 `Unable to load script` | Metro 未启动或端口占用；重启 `npm run start`，并确认设备可访问 8081 端口 |
| 首次 gradle 构建极慢 | 属正常（需下载 gradle 与依赖）；后续构建走缓存会快很多 |
| 初始化失败弹「Init Failed」对话框 | 对话框内附完整 bootLog，按日志定位具体步骤（详见 design-doc §3.4.1 启动流程） |

---

## 7. 相关文档

- 构建与发布：[./build-and-release.md](./build-and-release.md)
- 贡献指南：[./contributing.md](./contributing.md)
- 代码规范：[./code-style.md](./code-style.md)
- 工程结构：[./project-structure.md](./project-structure.md)
- 设计文档：[./design-doc.md](./design-doc.md)
