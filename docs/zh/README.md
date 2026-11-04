# folio

一款桌面应用，用于阅读、编辑和打印带有实时图表、API 参考和编辑器的 Markdown——
支持 macOS、Windows 和 Linux，无需安装。

> 状态：**1.4** —— 从[最新版本](https://github.com/dskripchenko/folio/releases/latest)下载适合你系统的压缩包。

- [工作原理](design.md) —— 窗口、文档能做什么、数据存放在哪里
- [开发](development.md) —— 构建、运行和测试

## 与系统并存

- 无需安装程序，也无需管理员权限：Windows 和 macOS 上是 zip，Linux 上是 AppImage。
- 设置、缓存和窗口状态都位于程序旁边的 `folio-data/` 中；删除该文件夹即可完全移除 folio。
- 文档不受信任：它只能看到自己所在的文件夹，只有经你同意才能访问网络。
