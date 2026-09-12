<a id="top"></a>

# EasyPackageManager (epm)

[English](#english) | [中文](#chinese)

---

## 目录 / Table of Contents

- [中文](#chinese)
  - [快速开始](#cn-quick-start)
  - [命令列表](#cn-commands)
  - [交互式 CLI](#cn-cli)
  - [设置项](#cn-settings)
  - [包来源](#cn-sources)
  - [文件类型处理](#cn-file-types)
  - [语言包](#cn-lang)
  - [环境变量](#cn-env)
  - [编译](#cn-build)
  - [目录结构](#cn-structure)
  - [常见问题](#cn-faq)
  - [卸载](#cn-uninstall)
  - [许可证](#cn-license)
- [English](#english)
  - [Quick Start](#en-quick-start)
  - [Commands](#en-commands)
  - [Interactive CLI](#en-cli)
  - [Settings](#en-settings)
  - [Package Sources](#en-sources)
  - [File Type Handling](#en-file-types)
  - [Language Packs](#en-lang)
  - [Environment Variables](#en-env)
  - [Building](#en-build)
  - [Directory Structure](#en-structure)
  - [Troubleshooting](#en-faq)
  - [Uninstall](#en-uninstall)
  - [License](#en-license)

---

<a id="chinese"></a>

# 中文

[返回顶部](#top) | [English](#english)

跨平台软件包管理器。从 GitHub Releases 拉取软件包，自动匹配当前平台，下载、运行安装程序或解压绿色软件。

支持 Windows / macOS / Linux，编译为独立 exe 后无需 Node.js 环境即可运行。

<a id="cn-quick-start"></a>

## 快速开始

[返回顶部](#top)

```
epm get                     从 GitHub 拉取可用包列表
epm list                    列出所有可用包及其文件
epm install <name>          安装包（自动匹配当前平台）
epm help                    显示帮助
```

直接双击 `epm.exe` 会进入交互式 CLI：

```
epm> get
epm> list
epm> install FreeArc_Setup.exe
epm> exit
```

<a id="cn-commands"></a>

## 命令列表

[返回顶部](#top)

### 包管理

```
epm list                             列出可用的包（含文件）
epm list install                     列出已安装的包
epm search <keyword>                 按关键字搜索 release 或文件名
epm get                              从 GitHub 拉取最新可用包列表
epm update                           重新拉取 url.json
```

### 安装

```
epm install <name>                   安装包（自动选当前平台的文件）
    <name>@file                      指定 release 中的某个文件
    -f <file>                        同上
    -p <path>                        从本地安装
    -q                               静默安装
    -k                               保留安装包
    --no-run                         只下载不运行
    -d <dir>                         下载到指定目录
epm add <name> <url>                 从任意 URL 添加包
```

### 下载

```
epm download <name>[@file]           只下载不安装
    -n <filename>                    自定义文件名
```

### 卸载与注册

```
epm uninstall <name>                 卸载包
epm redadd <name> <path>             从磁盘注册包
epm redel <name>                     取消注册（保留磁盘内容）
```

### 本地包

```
epm pak list                         列出本地包
epm pak add <name> <url>             添加本地包（先校验名称）
    --force                          覆盖同名包
epm pak del <name>                   删除本地包
```

### 语言

```
epm lang                             查看当前语言
epm lang list                        列出已安装的语言
epm lang get                         从 GitHub 下载语言文件
epm lang set <name>                  切换语言（cn / en / ...）
```

### 设置

```
epm set <name> [value]               查看或修改设置
epm set list                         列出所有设置
```

### 其他

```
epm run                              启动交互式 CLI
epm cli                              同 run
epm clear                            清屏
epm exit                             终止所有 EPM 进程并退出
epm help                             显示此帮助
```

<a id="cn-cli"></a>

## 交互式 CLI

[返回顶部](#top)

进入方式：

```
epm run
epm cli
```

或双击 `epm.exe`。

在 CLI 内可直接输入命令（省略 `epm` 前缀）：

```
epm> help
epm> get
epm> list
epm> install FreeArc_Setup.exe
epm> exit
```

### 多行命令

用 `{ }` 包裹，分号分隔：

```
epm> { list; install foo; list install }
```

<a id="cn-settings"></a>

## 设置项

[返回顶部](#top)

```
epm set list                         列出所有设置
epm set <name>                       查看单项
epm set <name> <value>               修改
```

| 设置 | 默认 | 说明 |
|------|------|------|
| `tempdir` | `./.download_temp` | 下载缓存目录 |
| `installdir` | Windows: `%LOCALAPPDATA%\EasyPackageManager`<br>macOS: `~/Library/Application Support/EasyPackageManager`<br>Linux: `~/.local/share/EasyPackageManager` | 安装目录 |
| `registryfile` | `./registry.json` | 已安装包清单 |
| `lang` | 空（跟随系统） | 界面语言 |
| `network.retries` | 4 | 网络重试次数 |
| `network.retryDelayMs` | 800 | 重试基础延迟（毫秒） |
| `network.timeoutMs` | 30000 | 请求超时（毫秒） |
| `github.token` | 空 | GitHub API token |
| `github.apiBase` | `https://api.github.com` | GitHub API 地址 |

示例：

```
epm set installdir D:\EPM\apps
epm set lang cn
epm set network.retries 6
epm set github.token ghp_xxxxxxxxxxxx
```

<a id="cn-sources"></a>

## 包来源

[返回顶部](#top)

`epm get` 从 `url.json` 配置的 GitHub 仓库拉取所有 release 及其中所有文件。

拉取到的每个 release 视为一个"包"，release 内的每个资产（asset）为一个可安装文件。

安装时：

- 如果 release 里有多个文件，`epm install <release>` 会按当前平台自动挑一个
- 可以用 `epm install <release>@<文件名>` 精确指定

<a id="cn-file-types"></a>

## 文件类型处理

[返回顶部](#top)

安装时按文件后缀智能处理：

| 类型 | 行为 |
|------|------|
| `.exe` | 下载后运行（Windows） |
| `.msi` | 调用 `msiexec /i` 安装 |
| `.dmg` / `.pkg` | `open` 打开（macOS） |
| `.deb` / `.rpm` | `xdg-open` 或包管理器安装（Linux） |
| `.AppImage` | `chmod +x` 后运行 |
| `.sh` / `.run` | bash 执行 |
| `.zip` / `.tar.gz` / `.tgz` | 解压到安装目录 |
| 其他 | 直接复制到安装目录 |

安装程序运行完后会询问是否保留安装包（默认不保留）。用 `-k` 保留，用 `--no-run` 只下载。

<a id="cn-lang"></a>

## 语言包

[返回顶部](#top)

语言文件位于 `./lang/*.lang`，格式：

```
name="cn"
displayName="简体中文"

unknownCommand="未知或不可用的命令"
inputEpmHelp="，输入epm help查看帮助"
...
```

`epm lang get` 会从 GitHub 上所有 tag 或 name 含 `epm lang` 的 release 中拉取 `.lang` 文件到 `./lang/`。

新增语言只需往 `./lang/` 放一个 `xx.lang` 文件，无需改代码。

<a id="cn-env"></a>

## 环境变量

[返回顶部](#top)

| 变量 | 说明 |
|------|------|
| `GITHUB_TOKEN` | GitHub API token（提升限额到 5000/小时） |
| `GH_TOKEN` | 同上 |
| `EPM_GITHUB_TOKEN` | 同上 |
| `NO_COLOR` | 设为任意值关闭彩色输出 |
| `NODE_OPTIONS=--use-system-ca` | Windows 上解决证书验证失败 |

<a id="cn-build"></a>

## 编译

[返回顶部](#top)

### 方式 1：npm link（开发用）

```
cd EasyPackageManager
npm link
epm help
```

### 方式 2：Node SEA（生成独立 exe，Node 20+）

```
cd EasyPackageManager
npx esbuild bin/epm.js --bundle --platform=node --target=node18 --outfile=dist/bundle.js
node --experimental-sea-config sea-config.json
copy /Y "C:\Program Files\nodejs\node.exe" dist\epm.exe
npx postject dist\epm.exe NODE_SEA_BLOB dist\epm.blob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
```

编译后把 `dist/` 打包分发：

```
dist/
├── epm.exe
├── settings.json
├── url.json
├── pak.json
├── update.js
└── lang/
    ├── cn.lang
    └── en.lang
```

对方解压双击 `epm.exe` 即可用，无需安装 Node.js。

<a id="cn-structure"></a>

## 目录结构

[返回顶部](#top)

```
EasyPackageManager/
├── bin/
│   └── epm.js                  CLI 入口
├── lang/
│   ├── cn.lang                 中文
│   └── en.lang                 英文
├── src/
│   ├── cli.js                  命令分发
│   ├── shell.js                交互式 CLI
│   ├── config.js               配置读写
│   ├── platform.js             平台检测与匹配
│   ├── net.js                  网络（重试、重定向、流式下载）
│   ├── update-lib.js           GitHub release 拉取
│   ├── sources.js              包列表（releases + pak）
│   ├── installer.js            安装
│   ├── downloader.js           下载
│   ├── extractor.js            tar.gz / zip 解压
│   ├── runner.js               安装程序运行
│   ├── registry.js             已安装清单
│   ├── pak.js                  本地包管理
│   ├── langfetch.js            语言包下载
│   ├── github.js               GitHub API
│   ├── i18n.js                 国际化
│   ├── process.js              进程管理
│   └── utils.js                工具
├── settings.json               配置
├── url.json                    release 缓存
├── pak.json                    本地包清单
├── update.js                   更新入口
├── sea-config.json             SEA 打包配置
├── rebuild.bat                 Windows 一键重编译
├── package.json
└── README.md
```

<a id="cn-faq"></a>

## 常见问题

[返回顶部](#top)

**Q：`unable to verify the first certificate`**

```
setx NODE_OPTIONS "--use-system-ca"
```

重开 CMD 后生效。

**Q：`GitHub API rate limited`**

未登录状态限 60 次/小时。设置 token：

```
set GITHUB_TOKEN=ghp_xxxxxxxxxxxx
epm get
```

Token 在 https://github.com/settings/tokens 生成，勾选 `public_repo`。

**Q：下载文件是 0 字节**

`src/net.js` 已处理 302 重定向并流式下载。如果仍出现，删除 `dist/.download_temp/` 下的残留文件，重跑 `epm get`。

**Q：`spawn EFTYPE` 或 `拒绝访问`**

Windows 的 Mark of the Web 拦截。`src/runner.js` 会自动删除 `Zone.Identifier`。如果手动运行的 exe 被拦，右键 → 属性 → 勾"解除锁定"。

**Q：`EPERM: operation not permitted, mkdir 'C:\Program Files\...'`**

默认安装目录需要管理员权限。改成用户目录：

```
epm set installdir D:\EPM\apps
```

**Q：`epm` 找不到命令**

npm 全局 bin 不在 PATH。查看：

```
npm config get prefix
```

把输出路径加入系统 PATH，重开 CMD。

**Q：编译时 `文件被占用`**

先关闭所有 `epm.exe`：

```
taskkill /F /IM epm.exe
```

<a id="cn-uninstall"></a>

## 卸载

[返回顶部](#top)

删除注册表项：

```
epm list install
epm uninstall <name>
```

删除本地包：

```
epm pak list
epm pak del <name>
```

清空缓存：

```
epm temp clear
```

删除用户数据：

```cmd
:: Windows
rmdir /s /q "%LOCALAPPDATA%\EasyPackageManager"

:: macOS
rm -rf ~/Library/Application\ Support/EasyPackageManager

:: Linux
rm -rf ~/.local/share/EasyPackageManager
```

<a id="cn-license"></a>

## 许可证

[返回顶部](#top)

MIT

---

<a id="english"></a>

# English

[Back to top](#top) | [中文](#chinese)

A cross-platform package manager. Fetches packages from GitHub Releases, matches the current platform automatically, downloads, runs installers or extracts portable archives.

Supports Windows / macOS / Linux. When compiled to a standalone executable, no Node.js runtime is required.

<a id="en-quick-start"></a>

## Quick Start

[Back to top](#top)

```
epm get                     Fetch available packages from GitHub
epm list                    List all packages and their files
epm install <name>          Install (auto-match current platform)
epm help                    Show help
```

Double-click `epm.exe` to enter the interactive CLI:

```
epm> get
epm> list
epm> install FreeArc_Setup.exe
epm> exit
```

<a id="en-commands"></a>

## Commands

[Back to top](#top)

### Package Management

```
epm list                             List available packages (with files)
epm list install                     List installed packages
epm search <keyword>                 Search releases or filenames
epm get                              Fetch latest package list from GitHub
epm update                           Re-fetch url.json
```

### Install

```
epm install <name>                   Install (auto-pick current platform file)
    <name>@file                      Specify a file inside a release
    -f <file>                        Same as above
    -p <path>                        Install from local path
    -q                               Silent install
    -k                               Keep installer file
    --no-run                         Download only, do not run
    -d <dir>                         Download to specific directory
epm add <name> <url>                 Add a package from any URL
```

### Download

```
epm download <name>[@file]           Download only, do not install
    -n <filename>                    Custom filename
```

### Uninstall & Register

```
epm uninstall <name>                 Uninstall a package
epm redadd <name> <path>             Register a package from disk
epm redel <name>                     Unregister (keep files on disk)
```

### Local Packages

```
epm pak list                         List local packages
epm pak add <name> <url>             Add a local package (validates name)
    --force                          Overwrite same-name package
epm pak del <name>                   Delete a local package
```

### Language

```
epm lang                             Show current language
epm lang list                        List installed languages
epm lang get                         Download language files from GitHub
epm lang set <name>                  Switch language (cn / en / ...)
```

### Settings

```
epm set <name> [value]               View or modify a setting
epm set list                         List all settings
```

### Miscellaneous

```
epm run                              Start interactive CLI
epm cli                              Same as run
epm clear                            Clear screen
epm exit                             Terminate all EPM processes and exit
epm help                             Show this help
```

<a id="en-cli"></a>

## Interactive CLI

[Back to top](#top)

Enter via:

```
epm run
epm cli
```

Or double-click `epm.exe`.

Inside the CLI, commands can be typed without the `epm` prefix:

```
epm> help
epm> get
epm> list
epm> install FreeArc_Setup.exe
epm> exit
```

### Multi-line Commands

Wrap with `{ }`, separate with semicolons:

```
epm> { list; install foo; list install }
```

<a id="en-settings"></a>

## Settings

[Back to top](#top)

```
epm set list                         List all settings
epm set <name>                       View a setting
epm set <name> <value>               Modify a setting
```

| Setting | Default | Description |
|---------|---------|-------------|
| `tempdir` | `./.download_temp` | Download cache directory |
| `installdir` | Windows: `%LOCALAPPDATA%\EasyPackageManager`<br>macOS: `~/Library/Application Support/EasyPackageManager`<br>Linux: `~/.local/share/EasyPackageManager` | Install directory |
| `registryfile` | `./registry.json` | Installed package registry |
| `lang` | empty (follow system) | UI language |
| `network.retries` | 4 | Network retry count |
| `network.retryDelayMs` | 800 | Retry base delay (ms) |
| `network.timeoutMs` | 30000 | Request timeout (ms) |
| `github.token` | empty | GitHub API token |
| `github.apiBase` | `https://api.github.com` | GitHub API base URL |

Examples:

```
epm set installdir D:\EPM\apps
epm set lang en
epm set network.retries 6
epm set github.token ghp_xxxxxxxxxxxx
```

<a id="en-sources"></a>

## Package Sources

[Back to top](#top)

`epm get` fetches every release (and every asset inside) from the GitHub repository configured in `url.json`.

Each release is treated as a "package", each asset as an installable file.

When installing:

- If a release has multiple files, `epm install <release>` auto-picks one for the current platform
- Use `epm install <release>@<filename>` to specify exactly

<a id="en-file-types"></a>

## File Type Handling

[Back to top](#top)

Files are handled by extension:

| Type | Behavior |
|------|----------|
| `.exe` | Run after download (Windows) |
| `.msi` | `msiexec /i` (Windows) |
| `.dmg` / `.pkg` | `open` (macOS) |
| `.deb` / `.rpm` | `xdg-open` or package manager (Linux) |
| `.AppImage` | `chmod +x` then run |
| `.sh` / `.run` | Execute via bash |
| `.zip` / `.tar.gz` / `.tgz` | Extract to install directory |
| Other | Copy directly to install directory |

After running an installer, it asks whether to keep the installer file (default: no). Use `-k` to keep, `--no-run` to only download.

<a id="en-lang"></a>

## Language Packs

[Back to top](#top)

Language files live in `./lang/*.lang`, format:

```
name="en"
displayName="English"

unknownCommand="Unknown or unavailable command"
inputEpmHelp=", run epm help to see available commands"
...
```

`epm lang get` downloads `.lang` files from any GitHub release whose tag or name contains `epm lang`, into `./lang/`.

Adding a new language is just dropping a `xx.lang` file into `./lang/` — no code change needed.

<a id="en-env"></a>

## Environment Variables

[Back to top](#top)

| Variable | Description |
|----------|-------------|
| `GITHUB_TOKEN` | GitHub API token (raises limit to 5000/hour) |
| `GH_TOKEN` | Same |
| `EPM_GITHUB_TOKEN` | Same |
| `NO_COLOR` | Set to any value to disable colored output |
| `NODE_OPTIONS=--use-system-ca` | Fix certificate verification on Windows |

<a id="en-build"></a>

## Building

[Back to top](#top)

### Option 1: npm link (development)

```
cd EasyPackageManager
npm link
epm help
```

### Option 2: Node SEA (standalone exe, Node 20+)

```
cd EasyPackageManager
npx esbuild bin/epm.js --bundle --platform=node --target=node18 --outfile=dist/bundle.js
node --experimental-sea-config sea-config.json
copy /Y "C:\Program Files\nodejs\node.exe" dist\epm.exe
npx postject dist\epm.exe NODE_SEA_BLOB dist\epm.blob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
```

Distribute the `dist/` folder:

```
dist/
├── epm.exe
├── settings.json
├── url.json
├── pak.json
├── update.js
└── lang/
    ├── cn.lang
    └── en.lang
```

The recipient just extracts and double-clicks `epm.exe` — no Node.js required.

<a id="en-structure"></a>

## Directory Structure

[Back to top](#top)

```
EasyPackageManager/
├── bin/
│   └── epm.js                 CLI entry point
├── lang/
│   ├── cn.lang                Chinese
│   └── en.lang                English
├── src/
│   ├── cli.js                 Command dispatcher
│   ├── shell.js               Interactive CLI
│   ├── config.js              Config read/write
│   ├── platform.js            Platform detection & matching
│   ├── net.js                 Network (retry, redirect, streaming)
│   ├── update-lib.js          GitHub release fetching
│   ├── sources.js             Package list (releases + pak)
│   ├── installer.js           Installation
│   ├── downloader.js          Download
│   ├── extractor.js           tar.gz / zip extraction
│   ├── runner.js              Installer execution
│   ├── registry.js            Installed registry
│   ├── pak.js                 Local package manager
│   ├── langfetch.js           Language pack download
│   ├── github.js              GitHub API
│   ├── i18n.js                Internationalization
│   ├── process.js             Process management
│   └── utils.js               Utilities
├── settings.json              Config
├── url.json                   Release cache
├── pak.json                   Local package list
├── update.js                  Update entry point
├── sea-config.json            SEA packaging config
├── rebuild.bat                Windows one-click rebuild
├── package.json
└── README.md
```

<a id="en-faq"></a>

## Troubleshooting

[Back to top](#top)

**Q: `unable to verify the first certificate`**

```
setx NODE_OPTIONS "--use-system-ca"
```

Reopen the terminal.

**Q: `GitHub API rate limited`**

Unauthenticated requests are limited to 60/hour. Set a token:

```
set GITHUB_TOKEN=ghp_xxxxxxxxxxxx
epm get
```

Generate a token at https://github.com/settings/tokens with `public_repo` scope.

**Q: Downloaded file is 0 bytes**

`src/net.js` handles 302 redirects and streams the download. If it still happens, delete leftover files in `dist/.download_temp/` and retry `epm get`.

**Q: `spawn EFTYPE` or `access denied`**

Windows Mark of the Web blocking. `src/runner.js` automatically removes `Zone.Identifier`. If manually running an exe fails, right-click → Properties → check "Unblock".

**Q: `EPERM: operation not permitted, mkdir 'C:\Program Files\...'`**

Default install dir needs admin. Change to a user dir:

```
epm set installdir D:\EPM\apps
```

**Q: `epm` not found**

npm global bin not in PATH. Check:

```
npm config get prefix
```

Add the output path to system PATH, reopen terminal.

**Q: `file in use` during build**

Close all `epm.exe` first:

```
taskkill /F /IM epm.exe
```

<a id="en-uninstall"></a>

## Uninstall

[Back to top](#top)

Remove registry entries:

```
epm list install
epm uninstall <name>
```

Remove local packages:

```
epm pak list
epm pak del <name>
```

Clear cache:

```
epm temp clear
```

Remove user data:

```cmd
:: Windows
rmdir /s /q "%LOCALAPPDATA%\EasyPackageManager"

:: macOS
rm -rf ~/Library/Application\ Support/EasyPackageManager

:: Linux
rm -rf ~/.local/share/EasyPackageManager
```

<a id="en-license"></a>

## License

[Back to top](#top)

MIT