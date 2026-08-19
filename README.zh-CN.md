# zlib-mcp

[![npm](https://img.shields.io/npm/v/zlib-mcp?color=cb3837&logo=npm)](https://www.npmjs.com/package/zlib-mcp)
[![license](https://img.shields.io/npm/l/zlib-mcp?color=blue)](https://github.com/shiyi-0x7f/zlib-mcp/blob/main/LICENSE)
[![node](https://img.shields.io/node/v/zlib-mcp)](https://nodejs.org)
[![Bilibili](https://img.shields.io/badge/Bilibili-%E5%85%B3%E6%B3%A8-00A1D6?logo=bilibili&logoColor=white)](https://space.bilibili.com/19276680)
![微信公众号](https://img.shields.io/badge/%E5%BE%AE%E4%BF%A1%E5%85%AC%E4%BC%97%E5%8F%B7-%E6%8B%BE%E5%A3%B90x7f-07C160?logo=wechat&logoColor=white)
[![English](https://img.shields.io/badge/docs-English-informational)](https://github.com/shiyi-0x7f/zlib-mcp/blob/main/README.md)

一个 stdio [MCP](https://modelcontextprotocol.io) server，让任意 AI Agent 工具——Claude Code、Codex CLI、Cursor、Claude Desktop——具备**搜索 z-library 并下载书籍**的能力。

**用你自己的账号。** 没有共享后端、没有 API key、不经任何代理：server 跑在你自己机器上，直连 z-library，用你的凭证、花你的配额。

## 工具

| 工具                    | 用途                                                | 需要凭证 |
| ----------------------- | --------------------------------------------------- | -------- |
| `zlib_search`           | 按书名 / 作者 / ISBN 搜索，可按格式、语言、年份过滤 | 是       |
| `zlib_get_download_url` | 取某本书的直链（不落盘）                            | 是       |
| `zlib_download`         | 下载到你指定的目录                                  | 是       |
| `zlib_limits`           | 查询今日剩余下载额度                                | 是       |
| `zlib_login`            | 一次性辅助：邮箱密码换 remix 凭证                   | 否       |

`zlib_download` **只有在你设了 `ZLIB_DOWNLOAD_DIR` 之后才会出现**——一个 MCP server 默认就能往任意路径写文件是不可接受的，所以下载目录必须由你亲自指定。

## 环境要求

- Node.js ≥ 20
- 一个 z-library 账号

## 五分钟接入

### 1. 准备凭证

**最简单的方式：直接填邮箱和密码**，首次调用工具时会自动换取 remix 凭证，之后缓存复用，不用你手动登录。

如果你已经知道自己的 `remix_userid` / `remix_userkey`，填那两个更快（免去一次登录往返）。不知道也没关系，让 Agent 调一次 `zlib_login`，它会把凭证打印出来。

### 2. 加进你的客户端

四个客户端要的东西是一样的：命令 `npx`、参数 `zlib-mcp`、一个 `env` 段。

<details open>
<summary><b>Claude Code</b></summary>

```bash
claude mcp add zlib \
  --env ZLIB_EMAIL=你的邮箱 \
  --env ZLIB_PASSWORD=你的密码 \
  --env ZLIB_DOWNLOAD_DIR="$HOME/Downloads/books" \
  -- npx -y zlib-mcp
```

Windows PowerShell 把续行符 `\` 换成反引号 `` ` ``。也可以直接编辑 `~/.claude.json` 或项目里的 `.mcp.json`，用下面的 JSON。

</details>

<details>
<summary><b>Claude Desktop</b> —— <code>claude_desktop_config.json</code></summary>

macOS：`~/Library/Application Support/Claude/claude_desktop_config.json`
Windows：`%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "zlib": {
      "command": "npx",
      "args": ["-y", "zlib-mcp"],
      "env": {
        "ZLIB_EMAIL": "你的邮箱",
        "ZLIB_PASSWORD": "你的密码",
        "ZLIB_DOWNLOAD_DIR": "D:\\Downloads\\books"
      }
    }
  }
}
```

</details>

<details>
<summary><b>Cursor</b> —— <code>.cursor/mcp.json</code> 或 <code>~/.cursor/mcp.json</code></summary>

```json
{
  "mcpServers": {
    "zlib": {
      "command": "npx",
      "args": ["-y", "zlib-mcp"],
      "env": {
        "ZLIB_EMAIL": "你的邮箱",
        "ZLIB_PASSWORD": "你的密码",
        "ZLIB_DOWNLOAD_DIR": "D:\\Downloads\\books"
      }
    }
  }
}
```

</details>

<details>
<summary><b>Codex CLI</b> —— <code>~/.codex/config.toml</code></summary>

```toml
[mcp_servers.zlib]
command = "npx"
args = ["-y", "zlib-mcp"]

[mcp_servers.zlib.env]
ZLIB_EMAIL = "你的邮箱"
ZLIB_PASSWORD = "你的密码"
ZLIB_DOWNLOAD_DIR = 'D:\Downloads\books'
```

两个 TOML 的坑：Windows 路径用**单引号**字面量字符串，双引号里的 `\` 会被当转义符；`[mcp_servers.zlib.env]` 必须写在整段最后，子表一开始，后面的裸键值对就都归它了。

</details>

### 3. 试一下

> 帮我找 Kleppmann 的《Designing Data-Intensive Applications》，要 epub，然后下载第一个

中文书名直接说就行，不用翻译成英文：

> 搜一下《数据密集型应用系统设计》

## 配置

| 变量                      | 必填   | 默认                                | 说明                                                          |
| ------------------------- | ------ | ----------------------------------- | ------------------------------------------------------------- |
| `ZLIB_REMIX_ID`           | 二选一 | —                                   | 你的 `remix_userid`                                           |
| `ZLIB_REMIX_KEY`          | 二选一 | —                                   | 你的 `remix_userkey`                                          |
| `ZLIB_EMAIL`              | 二选一 | —                                   | 回退方案：首次调用时换取 remix 凭证                           |
| `ZLIB_PASSWORD`           | 二选一 | —                                   | 回退方案，与 `ZLIB_EMAIL` 配套                                |
| `ZLIB_HOST`               | 否     | `pkuedu.xyz`                        | 上游镜像域名，被拦截时换一个                                  |
| `ZLIB_DOWNLOAD_DIR`       | 否     | _（不设则 `zlib_download` 不注册）_ | 下载落盘目录                                                  |
| `ZLIB_MAX_DOWNLOAD_BYTES` | 否     | `524288000`（500 MB）               | 超过此大小需显式 `allow_large: true`                          |
| `ZLIB_TIMEOUT_MS`         | 否     | `20000`                             | 单次请求的建连超时（不是整个下载的超时）                      |
| `ZLIB_CREDENTIAL_CACHE`   | 否     | `1`                                 | 设 `0` 则不写 `~/.zlib-mcp/credentials.json`                  |
| `ZLIB_LOG_LEVEL`          | 否     | `info`                              | `debug` / `info` / `warn` / `error` / `silent`，全部走 stderr |

### 凭证优先级

1. `ZLIB_REMIX_ID` + `ZLIB_REMIX_KEY`
2. 上次用邮箱登录后的缓存（`~/.zlib-mcp/credentials.json`，权限 600）
3. `ZLIB_EMAIL` + `ZLIB_PASSWORD` → 在**首次调用工具时**登录，而非启动时

之所以缓存，是为了让客户端重启不触发重新登录——频繁登录正是 z-library 风控最敏感的行为。缓存里只有 remix id 和 key，**密码永远不写盘、不进日志、不出现在任何工具的返回值里**。Windows 上 `600` 权限是空操作（系统不认 POSIX 权限），介意的话设 `ZLIB_CREDENTIAL_CACHE=0`。

什么都没配时 server 照常启动并列出工具，调用时返回一条告诉你该配什么的错误。它不会崩——崩掉在多数客户端里只显示「server 不可用」，你无从排查。

## 排错

**「Upstream host … appears to be blocking this request」**——镜像被反爬拦了。换一个 `ZLIB_HOST` 再重启客户端。可用域名变动频繁，`1lib.sk` 目前被拦，`pkuedu.xyz` 目前可用。任何提供同样 `/eapi/*` 端点的镜像都行。

**「z-library rejected the current credentials」**——remix key 过期了。重新跑 `zlib_login` 拿新的。用邮箱密码方案的话，删掉 `~/.zlib-mcp/credentials.json` 强制重新登录。

**「download quota reached」**——免费账号每天下载次数有限。`zlib_limits` 能看计数，z-library 那边每天 UTC 零点重置。

**客户端里什么都没出现**——看客户端的 MCP 日志，本 server 所有诊断信息都走 stderr。`ZLIB_LOG_LEVEL=debug` 会更啰嗦。

**`zlib_download` 不见了**——你没设 `ZLIB_DOWNLOAD_DIR`，这是刻意的。

## 开发

```bash
pnpm install
pnpm check      # 格式检查 → lint → 类型检查 → 测试
pnpm build
```

测试全程不打真实上游，`fetch` 都是桩。

想跑未发布的版本，把客户端的 `args` 指向 `["-y", "github:shiyi-0x7f/zlib-mcp"]`，`prepare` 脚本会在安装时构建。

## 合规声明

本工具只提供对**你自己**的 z-library 账号的 API 访问。它不托管、不分发任何版权内容。使用是否合法由你自行确保。你的账号、你的配额、你的风险——账号因滥用被封是你自己的损失。

## License

MIT
