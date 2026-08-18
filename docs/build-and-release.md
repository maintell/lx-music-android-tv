# 构建与发布（Build & Release）

> 读者可从中获得什么：理解版本号（`version` / `versionCode`）的来源与联动关系；掌握本地打包 release APK（含 ABI 拆分与签名）的完整流程；弄清 master 分支自动发布（打 tag + GitHub Release）、beta 分支打包、PR 构建检查三条 CI 流水线；了解发布版本信息接口的触发方式与 `publish/` 目录的职责。
>
> 前置阅读：[docs/getting-started.md](./getting-started.md)、[docs/design-doc.md](./design-doc.md)。

---

## 1. 版本号与版本码

版本信息**唯一来源**是根目录 `package.json`，Android 构建时由 `android/app/build.gradle` 用 `JsonSlurper` 直接读取，不存在第二处手写版本号：

| 字段 | 当前值 | 读取位置 | 用途 |
|------|--------|----------|------|
| `version` | `1.8.4` | `package.json` → `verName` | 语义化版本号，显示为 App 版本、Release tag 名称 |
| `versionCode` | `76` | `package.json` → `verCode` | Android 版本码（int），用于系统判断升级 |
| `name` | `lx-music-mobile` | `package.json` → `applicationName` | 参与 APK 文件名 |

版本升级时**两个字段一起改**。官方维护流程使用 `npm run publish <新版本号>` 脚本：它读取 `publish/changeLog.md` 作为新版本日志，自动完成「版本号写入 package.json + `versionCode` 自增 1 + 更新 `publish/version.json` + 在 `CHANGELOG.md` 顶部插入新章节」四件事（见 `publish/utils/updateChangeLog.js`）。

## 2. 构建产物与 ABI 拆分

`android/app/build.gradle` 中 `enableSeparateBuildPerCPUArchitecture = true`，release 构建会按 ABI 拆分为 4 个 APK 外加 1 个通用包（`universalApk true`）：

| 产物 | 文件名 | versionCode 计算 |
|------|--------|------------------|
| arm64-v8a | `lx-music-mobile-v<version>-arm64-v8a.apk` | `versionCode * 1000 + 3` |
| armeabi-v7a | `lx-music-mobile-v<version>-armeabi-v7a.apk` | `versionCode * 1000 + 1` |
| x86_64 | `lx-music-mobile-v<version>-x86_64.apk` | `versionCode * 1000 + 4` |
| x86 | `lx-music-mobile-v<version>-x86.apk` | `versionCode * 1000 + 2` |
| universal | `lx-music-mobile-v<version>-universal.apk` | 使用原始 `versionCode` |

- ABI 白名单来自 `gradle.properties` 的 `reactNativeArchitectures=armeabi-v7a,arm64-v8a,x86,x86_64`，命令行可用 `-PreactNativeArchitectures=x86_64` 覆盖。
- 应用基础信息：`applicationId = cn.toside.music.mobile`，`minSdk 21 / targetSdk 29 / compileSdk 36`，Hermes 开启（`hermesEnabled=true`），新架构关闭（`newArchEnabled=false`）。
- release 构建开启 Proguard 混淆（`enableProguardInReleaseBuilds = true`）。

## 3. 本地打包流程（Windows）

```powershell
npm run pack:android
```

等价于 `cd android && gradlew.bat assembleRelease`。产物输出到：

```
android/app/build/outputs/apk/release/
├── lx-music-mobile-v1.8.4-arm64-v8a.apk
├── lx-music-mobile-v1.8.4-armeabi-v7a.apk
├── lx-music-mobile-v1.8.4-x86_64.apk
├── lx-music-mobile-v1.8.4-x86.apk
└── lx-music-mobile-v1.8.4-universal.apk
```

调试包：`npm run pack:android:debug`（`./gradlew assembleDebug`）。清理产物：`npm run clear`。

### 3.1 签名配置

`android/app/build.gradle` 的 `signingConfigs.release` 按**优先级**读取两处：

| 优先级 | 来源 | 配置方式 |
|--------|------|----------|
| 1（优先） | gradle 属性 | 命令行传参：`-PMYAPP_UPLOAD_STORE_FILE=... -PMYAPP_UPLOAD_STORE_PASSWORD=... -PMYAPP_UPLOAD_KEY_ALIAS=... -PMYAPP_UPLOAD_KEY_PASSWORD=...`（CI 即此方式） |
| 2（兜底） | `android/keystore.properties` | 文件内容：`storeFile` / `storePassword` / `keyAlias` / `keyPassword` |

相关参数说明：

| 参数 | 含义 |
|------|------|
| `MYAPP_UPLOAD_STORE_FILE` | keystore 文件路径（`file()` 相对 `android/` 解析） |
| `MYAPP_UPLOAD_STORE_PASSWORD` | keystore 密码 |
| `MYAPP_UPLOAD_KEY_ALIAS` | 密钥别名 |
| `MYAPP_UPLOAD_KEY_PASSWORD` | 密钥密码 |

> **注意**：`buildTypes.release` 中同时存在 `signingConfig signingConfigs.debug` 与 `signingConfig signingConfigs.release` 两行，后者生效。若既未传 `MYAPP_UPLOAD_*` 又不存在 `keystore.properties`，加载 properties 会抛异常导致构建失败——本地打包请务必先配好签名。`clear:full`（`git clean -fdx -e android/keystore.properties -e android/app/*.keystore`）会保留签名文件。

### 3.2 本地打包常见问题

| 现象 | 原因与处理 |
|------|------------|
| 构建报 `Could not read key ... from store` | 签名参数与 keystore 不匹配，核对 `keystore.properties` 四要素 |
| 构建报 `keystore.properties` 找不到 / 读取异常 | 未配置签名；创建 `android/keystore.properties` 或改用 `-PMYAPP_UPLOAD_*` 传参 |
| 报 NDK / SDK 组件缺失 | 按 [getting-started.md](./getting-started.md) §1.1 安装对应版本组件 |
| Windows 下 `storeFile` 路径含反斜杠 | `keystore.properties` 中使用正斜杠或转义，如 `storeFile=C:/keystore/lx.keystore` |
| 只想构建单一架构加快速度 | `cd android; .\gradlew.bat assembleRelease -PreactNativeArchitectures=arm64-v8a` |

## 4. CI 发布流程（master 分支自动发布）

`.github/workflows/release.yml`（workflow 名 **Build**），**推送 master 分支即触发**：

| 阶段 | 动作 |
|------|------|
| 1. 检出 | `actions/checkout@v4` |
| 2. 环境 | `.github/actions/setup`（composite）：按 `.nvmrc` 装 Node（v18）→ 装 JDK 17（Microsoft）→ 缓存 npm → `npm ci` |
| 3. 构建 | `cd android && ./gradlew assembleRelease`，keystore 由 `KEYSTORE_STORE_FILE_BASE64` secret base64 解码写入临时文件，签名参数以 `-PMYAPP_UPLOAD_*` 传入，构建后删除临时 keystore |
| 4. 打 tag | 读取 `package.json` 的 `version`，用 `pkgdeps/git-tag-action@v3` 打 `v<version>` tag（已存在则跳过） |
| 5. MD5 | 对 `android/app/build/outputs/apk/release/*.apk` 执行 `md5sum` |
| 6. 上传产物 | `.github/actions/upload-artifact` 上传 5 个 APK 到 Actions artifacts |
| 7. 发布（Release job，`needs: [Android]`） | 下载 artifacts → 把 MD5 列表追加到 `publish/changeLog.md`（含「软件安装包说明」链接）→ `softprops/action-gh-release@v2` 创建正式 Release（非 prerelease/draft），tag 为 `v<version>`，正文为 `publish/changeLog.md`，附件为 5 个 APK |

所用 GitHub Secrets：

| Secret | 用途 |
|--------|------|
| `KEYSTORE_STORE_FILE_BASE64` | keystore 文件内容的 base64 |
| `KEYSTORE_STORE_FILE` | keystore 文件名（写入 `android/app/` 下） |
| `KEYSTORE_KEY_ALIAS` / `KEYSTORE_PASSWORD` / `KEYSTORE_KEY_PASSWORD` | 签名参数 |

配置位置：仓库 Settings → Secrets and variables → Actions。`publish-version-info.yml` 另需 `PAT` secret（访问 `lx-music-mobile-version-info` 仓库的 Personal Access Token）。

> CI 构建环境相关约定：`actions/setup` 按 `.nvmrc`（v18）安装 Node、装 JDK 17（Microsoft 发行版）并缓存 npm 依赖后执行 `npm ci`；构建时设置 `DISABLE_SVG: 1` 环境变量（跳过 SVG 资源处理）。

## 5. 其他 CI 流水线

| workflow | 触发条件 | 动作 |
|----------|----------|------|
| `beta-pack.yml`（Build Beta） | 推送 `beta` 分支 | 与 release 相同的构建（同 secrets 签名），上传 5 个 APK 产物，**不**打 tag 不发布 Release |
| `build-test.yml`（Run build test） | 向 `dev` 分支提 PR | Node 20 + `npm ci` + `npm run lint` + `npm run build-test`（仅验证 JS bundle 可打包） |

`build-test.yml` 与 `npm run build-test` 的关系：`build-test` 脚本等价于 `react-native bundle --platform android --dev true --entry-file index.js --bundle-output index.android.bundle --assets-dest res`，只验证 JS 侧能否成功打包，**不**经过 gradle 原生编译；PR 无法通过它发现原生层问题。

## 6. 发布版本信息接口

`.github/workflows/publish-version-info.yml` 负责通知「版本信息仓库」更新：

| 触发方式 | 说明 |
|----------|------|
| `release: published` | 每次 GitHub Release 发布后自动触发 |
| `workflow_dispatch` | 支持手动触发 |

动作：用 `peter-evans/repository-dispatch@v2` 向 `lyswhut/lx-music-mobile-version-info` 仓库发送 `npm-release` 事件（使用 `PAT` secret），由该仓库的工作流生成/更新 App 内版本检查接口数据。App 侧版本检查实现在 `src/core/version.ts`，接口地址与数据格式以该仓库与代码为准（本项目仓库内无此接口实现）。

## 7. publish/ 目录职责

| 文件/目录 | 职责 |
|-----------|------|
| `publish/changeLog.md` | 当前版本发布说明（Release 正文来源；CI 会追加 MD5 与下载说明） |
| `publish/version.json` | 版本信息：`{ version, desc, history[] }`，history 为历史版本归档 |
| `publish/index.js` | `npm run publish` 入口：执行 `updateChangeLog` 后打印「日志更新完成」（其余发布步骤已被注释停用） |
| `publish/utils/updateChangeLog.js` | 核心脚本：新版本号 + 日志写入 package.json / version.json / CHANGELOG.md，`versionCode` 自增 |
| `publish/utils/parseChangelog.js` | 解析 `CHANGELOG.md` 取最新版本号，用于生成 compare 链接 |

**官方发布节奏**（仅维护者）：

1. 在 `publish/changeLog.md` 撰写新版本日志；
2. 执行 `npm run publish <新版本号>` 生成新版本信息与 `CHANGELOG.md` 章节；
3. 提交并推送 **master**；
4. `release.yml` 自动构建、打 `v<version>` tag、发布 GitHub Release；
5. Release 发布后 `publish-version-info.yml` 自动通知版本信息仓库，App 内即可检测到更新。

## 8. 验证与安装产物

Release 附件与本地构建产物均为同一构建流程产物，验证方式：

```powershell
# 校验 MD5（与 GitHub Release 正文中的 MD5 列表比对）
Get-FileHash .\lx-music-mobile-v1.8.4-arm64-v8a.apk -Algorithm MD5

# 安装到已连接设备
adb install .\lx-music-mobile-v1.8.4-arm64-v8a.apk
```

安装与升级要点：

- 按设备架构选择对应 APK：现代手机用 `arm64-v8a`，老机型用 `armeabi-v7a`，模拟器用 `x86_64`/`x86`，不确定时用 `universal`；
- 由于拆分 APK 的 `versionCode` 各不相同（`versionCode * 1000 + N`），同一版本内互相覆盖安装不受影响；跨版本升级请以「目标版本 ≥ 当前版本」为准；
- 签名校验：`apksigner verify --print-certs <apk>`（SDK build-tools 自带），确认证书与官方发布一致，避免安装被篡改包。

## 9. 相关文档

- 开发环境：[./getting-started.md](./getting-started.md)
- 贡献指南：[./contributing.md](./contributing.md)
- 版本与更新模块：[design-doc.md §5.7](./design-doc.md)
