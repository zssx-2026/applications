# EasyPackageManager 编译教程

---

## 一、环境要求

| 项 | 最低 | 推荐 |
|----|------|------|
| Node.js | v16 | v18 / v20 / v22 / v24 |
| npm | v7 | v9+ |
| 操作系统 | Windows 10 / macOS 11 / Ubuntu 20.04 | 最新 |

检查：

```cmd
node -v
npm -v
```

---

## 二、Windows 上的证书配置

如果你在 Windows 上遇到：

```
unable to verify the first certificate; if the root CA is installed locally, try running Node.js with --use-system-ca
```

执行：

```cmd
setx NODE_OPTIONS "--use-system-ca"
```

然后**关闭 CMD，重新打开**，验证：

```cmd
echo %NODE_OPTIONS%
:: 输出: --use-system-ca
```

macOS / Linux 一般不需要这步。

---

## 三、编译方式

### 方式 1：npm link（开发 / 日常使用）

#### 步骤

```cmd
cd /d D:\丁陈子豪\EasyPackageManager
npm link
```

#### 验证

```cmd
epm help
```

应看到完整的命令列表。

#### 如果报 EPERM

用**管理员身份**重新打开 CMD，再次执行 `npm link`。

#### 如果 `epm` 找不到命令

查看全局 bin 目录：

```cmd
npm config get prefix
```

假设输出 `C:\Users\你的用户名\AppData\Roaming\npm`，把这个路径加入 PATH：

1. `Win + R` → `sysdm.cpl`
2. 高级 → 环境变量
3. 用户变量 → Path → 编辑 → 新建 → 粘贴路径
4. 确定 → **重新开 CMD**

macOS / Linux 一般 `npm link` 后直接可用；如果不行：

```bash
export PATH="$HOME/.npm-global/bin:$PATH"
```

#### 取消链接

```cmd
npm unlink -g easy-package-manager
```

---

### 方式 2：npm pack（分发包）

生成 `.tgz` 文件，可分发给别人安装。

```cmd
cd /d D:\丁陈子豪\EasyPackageManager
npm pack
```

生成：`easy-package-manager-1.0.0.tgz`

别人安装：

```cmd
npm install -g easy-package-manager-1.0.0.tgz
```

---

### 方式 3：pkg（生成独立可执行文件）

> ⚠️ `pkg` 目前最高支持 Node 18，**不支持 Node 20+**。  
> 如果你用 Node 24（当前你的环境），请改用**方式 5（Node SEA）**。

如果你有 Node 18：

```cmd
npm install --save-dev pkg
npx pkg . --targets node18-win-x64 --output dist\epm.exe
```

其他平台：

```cmd
npx pkg . --targets node18-linux-x64 --output dist\epm
npx pkg . --targets node18-macos-x64 --output dist\epm-macos
```

产物在 `dist/` 里，直接双击或命令行运行，**不需要用户安装 Node.js**。

---

### 方式 4：esbuild（打成单 JS 文件）

生成一个 bundle JS，分发给有 Node 的人。

```cmd
npm install --save-dev esbuild
npx esbuild bin\epm.js --bundle --platform=node --target=node16 --outfile=dist\epm.bundle.js --minify
```

运行：

```cmd
node dist\epm.bundle.js help
```

> 注意：bundle 后 `settings.json` / `url.json` / `lang/` 需要和 bundle 放在一起。

---

### 方式 5：Node SEA（Node 20+ 内置，推荐给 Node 24）

**你现在是 Node v24.19.0，用这个方式生成 `.exe`。**

#### 步骤 1：安装 postject

```cmd
cd /d D:\丁陈子豪\EasyPackageManager
npm install --save-dev postject
```

#### 步骤 2：创建 sea-config.json

在项目根目录新建 `sea-config.json`：

```json
{
  "main": "bin/epm.js",
  "output": "dist/epm.blob",
  "disableExperimentalSEAWarning": true,
  "useSnapshot": false,
  "useCodeCache": false
}
```

#### 步骤 3：生成 blob

```cmd
mkdir dist
node --experimental-sea-config sea-config.json
```

生成 `dist/epm.blob`。

#### 步骤 4：复制 node.exe 作为宿主

```cmd
where node
:: 假设输出 C:\Program Files\nodejs\node.exe
copy "C:\Program Files\nodejs\node.exe" dist\epm.exe
```

#### 步骤 5：注入 blob

```cmd
npx postject dist\epm.exe NODE_SEA_BLOB dist\epm.blob ^
    --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
```

> Windows CMD 换行用 `^`；PowerShell 用反引号 `` ` ``；Bash 用 `\`。

#### 步骤 6：测试

```cmd
dist\epm.exe help
```

#### 重要：SEA 的路径问题

SEA 打包后 `__dirname` 指向虚拟文件系统，**不能写入**。运行时需要的 `settings.json`、`url.json`、`pak.json`、`registry.json`、`lang/` 要放在 exe 同目录，或修改 `src/utils.js` 把可写数据挪到用户目录：

```js
const os = require('os');
const path = require('path');

const IS_SEA = process.execPath.toLowerCase().endsWith('.exe') ||
               (!process.argv[0].endsWith('node') && !process.argv[0].endsWith('node.exe'));

const ROOT = IS_SEA
  ? path.join(os.homedir(), '.easy-package-manager')
  : path.resolve(__dirname, '..');
```

如果不想改代码，就在 `dist/` 里同时放上：

```
dist/
├── epm.exe
├── settings.json
├── url.json
├── pak.json
└── lang/
    ├── cn.lang
    └── en.lang
```

---

## 四、运行测试

无论哪种方式编译，先跑一遍基本测试：

```cmd
epm help
epm lang list
epm set list
epm get
epm list
epm pak list
```

交互模式：

```cmd
epm run
epm> { lang list; set list; pak list }
epm> exit
```

---

## 五、常用命令速查

```cmd
:: 拉取 GitHub 所有 release 及文件
epm get

:: 查看可用包
epm list
epm search <keyword>

:: 安装（自动选当前平台）
epm install <name>
epm install <name>@<file>

:: 从本地安装
epm install -p D:\some\dir

:: 下载不安装
epm download <name>
epm download <name> -n output.zip

:: 本地包管理
epm pak add mytool https://example.com/tool.exe
epm pak list
epm pak del mytool

:: 注册磁盘上的包
epm redadd tool D:\Tools\tool
epm redel tool

:: 语言
epm lang list
epm lang set cn
epm lang get

:: 缓存
epm temp clear

:: 设置
epm set installdir D:\EPM\apps
epm set list

:: 退出
epm exit
```

---

## 六、卸载

**删除全局链接：**

```cmd
npm unlink -g easy-package-manager
```

**删除安装的包：**

```cmd
epm list install
epm uninstall <name>
```

**删除用户数据目录：**

```cmd
rmdir /s /q "%USERPROFILE%\.easy-package-manager"
```

**删除项目本身：**

直接删掉 `EasyPackageManager/` 文件夹即可。