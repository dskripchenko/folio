# 开发

## 所需环境

- Node.js 22 和 pnpm 10。
- 无需其他：Electron 会在首次启动时下载自己的二进制文件。

## 命令

```sh
pnpm install
pnpm start          # 构建，然后从源码运行
pnpm build          # 构建到 dist/
pnpm lint
pnpm typecheck
pnpm test           # 单元测试（vitest）
pnpm test:e2e       # 启动构建好的应用并进行检查（Playwright）
```

从源码运行时，folio 把数据保存在工作目录的 `.folio-data/` 中；
`FOLIO_DATA=/some/dir pnpm start` 可将其放到别处。 `FOLIO_COMMIT_PAUSE`（毫秒）可缩短保存后提交前的等待时间，用于测试；`FOLIO_GIT=builtin` 表示不使用系统 git 进行同步（`FOLIO_GIT=/path/to/git` 指定某个 git）。同步测试会让内置传输对接 `git http-backend`，因此需要安装 git。PDF 测试在安装了 poppler（`pdftotext`、`pdfinfo`）时用它读取导出的文件——CI 在 Linux 和 macOS 上安装并要求它（`FOLIO_REQUIRE_POPPLER=1`）。

在没有显示器的 Linux 上，请在虚拟显示器下运行端到端测试：
`xvfb-run --auto-servernum pnpm test:e2e`。

## 便携构建

```sh
pnpm dist           # 构建，然后把本系统的压缩包放进 release/
node scripts/checksums.mjs release
FOLIO_APP=… FOLIO_ARCHIVE=… pnpm exec playwright test -c playwright.package.config.ts --workers=1
```

`electron-builder.yml` 在 macOS（Apple Silicon 与 Intel，ad hoc 签名）和 Windows 上生成 zip，在 Linux 上生成 AppImage。`tests/package/` 运行解压后的程序：所有组件、控制台、PDF、旁边的数据，以及替换到原位的更新（`FOLIO_UPDATE_URL` 让更新指向本地服务器）。release 工作流在三个系统上完成这些；版本与 `package.json` 一致的 `v*` 标签会发布压缩包及其校验和与来源证明。

## 目录结构

| 路径 | 内容 |
|---|---|
| `src/main/` | 主进程：窗口、磁盘、网络规则 |
| `src/preload/` | 窗口可以调用的桥 |
| `src/renderer/` | 窗口页面 |
| `scripts/build.mjs` | esbuild：把 main、preload 和页面构建到 `dist/` |
| `tests/unit/` | 单元测试 |
| `tests/e2e/` | 构建好的应用，启动并驱动 |
| `docs/internal/` | 决策与计划（俄文） |

## CI

`.github/workflows/tests.yml` 在每次变更时于 Linux、macOS 和 Windows 上运行 lint、
类型检查、单元测试、构建和端到端检查。Actions 按提交固定。
