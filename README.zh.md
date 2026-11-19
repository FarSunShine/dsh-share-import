# dsh-share-link-import

把一条公开的 DeepSeek 对话分享链接导入 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH），变成一个真实、可续聊的会话。

粘贴 `https://chat.deepseek.com/share/<id>`，选好工作区，点导入。历史会出现在侧栏里，提问、思考、联网搜索来源、回答都在，可以像普通会话一样继续。

## 为什么不用 ZIP

DSH 内置的实验性「DeepSeek 会话导入」只认 `deepseek_data-*.zip` 导出包。这个插件读官网公开的只读分享接口 `https://chat.deepseek.com/api/v0/share/content?share_id=…`，不需要登录、不需要 token、也不需要先导出。

## 安装

发布到 npm 之后：

```bash
dsh plugin --profile desktop add dsh-share-link-import
```

从本地目录安装（该命令会把参数转给 profile 目录里的 pnpm）：

```bash
dsh plugin --profile desktop add /path/to/dsh-share-link-import
```

在应用里：**插件** → **添加插件**，选择目录或 npm 包名。

## 使用

1. 点侧栏「新建会话」右侧的 ⤓ 按钮。
2. 粘贴分享链接（也可以只填 id）。
3. 选择目标工作区并确认。

## 配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `maxSearchResults` | `8` | 每条搜索记录保留的结果数 |
| `snippetChars` | `120` | 每条结果保留的摘要字符数 |
| `maxTitleBytes` | `80` | 导入标题的 UTF-8 字节上限 |
| `timeoutMs` | `60000` | 分享接口超时 |

## 限制

- 只支持公开且未过期的分享。
- 导入的是静态历史：不生成内容，也不留下未结束的轮次。
- 搜索结果会裁剪，避免上百轮的会话撑爆上下文。
- 同一时间只允许一个导入，并发会返回 `busy`。
- 只支持 `chat.deepseek.com`。

## 相关项目

[Sillykjs/dsh-share-import](https://github.com/Sillykjs/dsh-share-import) 已经做过同一件事，而且有些地方更完整：它还支持**豆包**的分享链接、会拦截同一条分享的重复导入、导入前有预览步骤。这个包是一份独立的、范围更窄的实现：只支持 DeepSeek，发在 npm 上免构建安装，入口是侧栏按钮而不是导航面板，并会裁剪搜索结果以免超长会话撑爆上下文。想要更全的功能，用那个。

## 许可证

MIT。导入的对话内容属于原作者，请只导入你有权使用的内容。
