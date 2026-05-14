# VSCode-WeRead：微信读书笔记同步与 Markdown 导出

<p align="center">
  <img src="images/icon.png" alt="VSCode-WeRead 插件图标，适用于微信读书笔记同步、WeRead 笔记搜索与 Markdown 导出" width="128" height="128">
</p>

<p align="center">
  VS Code 微信读书插件，支持微信读书笔记同步、WeRead 笔记搜索、Markdown 导出、阅读洞察与笔记漫游
</p>

`VSCode-WeRead` 是一款面向 VS Code 的微信读书插件，专注于微信读书笔记同步、WeRead 笔记搜索、Markdown 导出、阅读洞察和本地知识管理。无论你想把微信读书划线同步到本地，还是想在 VS Code 中搜索读书笔记、导出 Markdown、整理阅读资料，都可以直接使用这款扩展。

如果你正在搜索 `微信读书笔记同步`、`微信读书笔记导出`、`WeRead`、`WeRead Notes`、`微信读书 Markdown 导出`、`vscode weread` 或 `wechat read notes`，`VSCode-WeRead` 提供从登录、同步、搜索、漫游到导出的完整工作流，适合开发者、研究者、写作者和重度阅读用户。

> 当前版本：`0.1.1`

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=weread.weread-vscode">
    <img src="https://img.shields.io/visual-studio-marketplace/v/weread.weread-vscode" alt="VS Code Marketplace 中 VSCode-WeRead 的版本徽章">
  </a>
  <a href="https://marketplace.visualstudio.com/items?itemName=weread.weread-vscode">
    <img src="https://img.shields.io/visual-studio-marketplace/d/weread.weread-vscode" alt="VS Code Marketplace 中 VSCode-WeRead 的下载量徽章">
  </a>
  <a href="https://github.com/wangjianghu/VSCode-WeRead/blob/main/LICENSE">
    <img src="https://img.shields.io/github/license/wangjianghu/VSCode-WeRead" alt="VSCode-WeRead 仓库的 GitHub 许可证徽章">
  </a>
</p>

## 功能特性

- 微信读书登录：支持网页登录协议扫码登录，也支持粘贴 Cookie 登录，方便快速接入微信读书账号。
- 微信读书笔记同步：支持全量同步与增量同步，可将微信读书划线、想法、书评同步到本地工作区。
- WeRead 笔记搜索：支持在书架与笔记内容中快速搜索，便于在 VS Code 中查找读书笔记和阅读资料。
- Markdown 导出：支持将微信读书笔记导出为 Markdown 文件，适合 Obsidian、知识库、博客草稿和归档。
- 笔记漫游与导图：支持笔记漫游、导出图片、主题背景、时间样式和即时预览，方便分享读书笔记卡片。
- 阅读洞察：支持阅读统计、趋势查看和月报导出，帮助持续回顾微信读书阅读数据。
- 多账号管理：支持多账号隔离、账号切换、账号新增与账号清理，适合多身份阅读场景。
- 本地优先：数据默认保存在本地目录，登录信息使用 VS Code SecretStorage 存储，尽量减少额外风险。

## 安装

### 从 VS Code Marketplace 安装

1. 打开 VS Code。
2. 进入扩展视图，快捷键为 `Ctrl+Shift+X` 或 `Cmd+Shift+X`。
3. 搜索 `VSCode-WeRead`、`微信读书`、`WeRead` 或 `微信读书笔记同步`。
4. 点击安装并启用扩展。

### 从 VSIX 安装

1. 下载对应版本的 `.vsix` 文件。
2. 打开命令面板，快捷键为 `Ctrl+Shift+P` 或 `Cmd+Shift+P`。
3. 执行 `Extensions: Install from VSIX...`。
4. 选择本地 `.vsix` 文件完成安装。

## 快速开始

### 1. 登录微信读书

- 推荐使用“网页登录协议扫码登录”。
- 如需兜底方案，可使用“粘贴 Cookie 登录”。

如需获取 Cookie，可在系统浏览器登录微信读书后打开开发者工具，在 `Application` 或“应用”面板中找到 `https://weread.qq.com` 的 Cookie，并复制 `wr_vid`、`wr_skey` 等相关字段。

```text
浏览器开发者工具
└─ Application / 应用
   └─ Storage / 存储
      └─ Cookies
         └─ https://weread.qq.com
            ├─ wr_vid=xxxx
            └─ wr_skey=xxxx
```

### 2. 同步微信读书笔记

- 点击书架顶部同步按钮即可执行微信读书笔记同步。
- 开启自动同步后，可按设定间隔定期同步微信读书数据。

### 3. 搜索与浏览笔记

- 在书架中打开任意书籍查看划线、想法与书评。
- 使用笔记搜索快速查找关键词、作者、书名与章节信息。
- 使用笔记漫游回顾未复习内容并导出图片卡片。

### 4. 导出 Markdown 与图片

- 在书籍视图中导出 Markdown 文件。
- 在笔记漫游中导出图片卡片。
- 所有导出内容都可进入你的本地知识管理工作流。

## 配置说明

在 VS Code 设置中搜索 `weread` 可查看扩展配置：

| 配置项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `weread.outputPath` | string | `""` | 微信读书笔记导出根目录。 |
| `weread.fileNameTemplate` | string | `{{title}}` | Markdown 导出文件名模板。 |
| `weread.noteTemplate` | string | `""` | 微信读书笔记 Markdown 模板，留空则使用默认模板。 |
| `weread.autoSync` | boolean | `true` | 是否启用自动同步。 |
| `weread.syncInterval` | string | `24h` | 自动同步间隔。 |
| `weread.categoryMode` | string | `level1` | 书架分类层级模式。 |
| `weread.showCover` | boolean | `true` | 是否显示书籍封面。 |
| `weread.multiAccountEnabled` | boolean | `true` | 是否启用多账号模式。 |
| `weread.exportThemes` | array | 内置 8 组 | 笔记漫游导出图片主题配置。 |

## 导出模板

`VSCode-WeRead` 使用 [Nunjucks](https://mozilla.github.io/nunjucks/) 模板引擎生成 Markdown 导出内容，适合自定义微信读书笔记模板。

常用变量示例：

| 变量名 | 说明 |
| --- | --- |
| `{{title}}` | 书籍标题 |
| `{{author}}` | 作者 |
| `{{publisher}}` | 出版社 |
| `{{isbn}}` | ISBN |
| `{{category}}` | 分类 |
| `{{progress}}` | 阅读进度 |
| `{{lastReadTime}}` | 最近阅读时间 |

模板片段示例：

```markdown
{% for chapter in chapters %}
### {{chapter.title}}

{% for note in chapter.notes %}
> {{note.highlightText}}

{% if note.thoughtText %}
💭 {{note.thoughtText}}
{% endif %}
{% endfor %}
{% endfor %}
```

## 命令入口

你可以在命令面板中搜索 `WeRead` 或 `微信读书` 来执行常用命令。

- 登录微信读书
- 同步笔记
- 打开书架
- 搜索笔记
- 打开阅读洞察
- 打开笔记漫游
- 切换账号
- 管理账号
- 配置笔记存储路径

## 隐私与安全

- 本地存储：微信读书笔记、索引和导出文件默认保存在本地目录。
- 凭据保护：登录信息使用 VS Code SecretStorage 保存。
- 官方通信：网络请求仅面向微信读书相关接口。
- 可控导出：Markdown 导出和图片导出均由用户主动触发。

## 常见问题

### 登录成功后无法同步怎么办？

- 确认当前微信读书账号中存在书籍或笔记。
- 检查网络连接、代理设置和 Cookie 是否已过期。
- 尝试重新登录后再执行微信读书笔记同步。
- 打开输出面板查看同步日志与错误信息。

### Markdown 导出保存在哪里？

- 默认会保存到配置的 `weread.outputPath` 目录。
- 若启用多账号模式，会按账号目录隔离保存。

### 如何自定义微信读书笔记模板？

- 在设置中搜索 `weread.noteTemplate`。
- 将自定义 Nunjucks 模板粘贴到配置项中即可。

### 笔记漫游与导图适合什么场景？

- 适合做每日复盘、读书摘录分享、读书卡片整理和社交媒体发布。
- 你可以在预览中切换时间类型和背景主题后再导出图片。

### 多账号切换后为什么看不到另一个账号的数据？

- 多账号模式默认按账号隔离书架、笔记、导出与索引数据。
- 切换账号后仅展示当前活跃账号的数据，这是预期行为。

## 开发

### 环境要求

- Node.js 16+
- VS Code 1.70.0+
- npm

### 本地开发

```bash
git clone https://github.com/wangjianghu/VSCode-WeRead.git
cd VSCode-WeRead
npm install
npm run compile
```

完成编译后，可在 VS Code 中按 `F5` 启动 Extension Development Host。

### 构建与发布

```bash
npm run package
npm run publish
```

## 反馈与支持

- 项目仓库：[wangjianghu/VSCode-WeRead](https://github.com/wangjianghu/VSCode-WeRead)
- 问题反馈：[GitHub Issues](https://github.com/wangjianghu/VSCode-WeRead/issues)
- 开源协议：[MIT License](./LICENSE)

<!--
相关搜索词：
VSCode-WeRead
微信读书插件
微信读书笔记同步
微信读书笔记导出
微信读书 Markdown 导出
微信读书笔记搜索
WeRead
WeRead Notes
weread markdown export
vscode weread
wechat read notes
reading notes sync
-->
