# folio

一款桌面应用，用于阅读、编辑和打印带有实时图表、API 参考和编辑器的 Markdown——
支持 macOS、Windows 和 Linux，无需安装。同时也是一个轻量 IDE，适合与终端中的 AI 智能体配合使用：像审阅拉取请求一样审阅它的更改、查看自上次查看以来的变化、管理它的 worktree、把评论直接发送到它的控制台。

> 状态：**1.18** —— 从[最新版本](https://github.com/dskripchenko/folio/releases/latest)下载适合你系统的压缩包。

- [工作原理](design.md) —— 窗口、文档能做什么、数据存放在哪里
- [开发](development.md) —— 构建、运行和测试

## 与系统并存

- 无需安装程序，也无需管理员权限：Windows 和 macOS 上是 zip，Linux 上是 AppImage。
- 设置、缓存和窗口状态都位于程序旁边的 `folio-data/` 中；删除该文件夹即可完全移除 folio。
- 文档不受信任：它只能看到自己所在的文件夹，只有经你同意才能访问网络。

## 与 shell 终端配合

当电脑上也有 [shell](https://github.com/dskripchenko/shell) 终端时，两者会自动找到对方：shell
在 folio 中打开文件、项目和审阅；folio 在 shell 中打开标签、把审阅意见发到那里智能体所在的
窗格，并让控制台使用 shell 的颜色；两者共用一份“哪个智能体改了什么”的日志。详见
[工作原理](design.md) 中的 *与 shell 终端配合*。
