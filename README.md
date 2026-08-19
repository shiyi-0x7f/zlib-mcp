# zlib-mcp

A stdio [MCP](https://modelcontextprotocol.io) server that gives any AI agent tool — Claude Code, Codex CLI, Cursor, Claude Desktop — the ability to **search z-library and download books**.

**Bring your own account.** There is no shared backend, no API key, no proxy: the server runs on your machine, talks straight to z-library, and uses your credentials and your quota.

## Tools

| Tool                    | What it does                                                            | Needs credentials |
| ----------------------- | ----------------------------------------------------------------------- | ----------------- |
| `zlib_search`           | Search by title / author / ISBN, with format, language and year filters | yes               |
| `zlib_get_download_url` | Get a direct download link for one book (no file written)               | yes               |
| `zlib_download`         | Download a book into a directory you configured                         | yes               |
| `zlib_limits`           | Check today's remaining download allowance                              | yes               |
| `zlib_login`            | One-time helper: exchange email + password for remix credentials        | no                |

`zlib_download` **only appears once you set `ZLIB_DOWNLOAD_DIR`** — an MCP server that can write files anywhere by default is not an acceptable default, so you have to name the directory yourself.

## Requirements

- Node.js ≥ 20
- A z-library account

## Setup in 5 minutes

### 1. Get your credentials

If you already know your `remix_userid` / `remix_userkey`, skip ahead. Otherwise add the server with just your email and password (see the config snippets below), then ask your agent to run `zlib_login` once and put the returned `remix_id` / `remix_key` into the config permanently.

You can also run it straight from a terminal:

```bash
ZLIB_EMAIL=you@example.com ZLIB_PASSWORD='…' npx zlib-mcp
```

### 2. Add the server to your client

Every client takes the same three things: the command `npx`, the argument `zlib-mcp`, and an `env` block.

<details open>
<summary><b>Claude Code</b></summary>

```bash
claude mcp add zlib \
  --env ZLIB_REMIX_ID=123456 \
  --env ZLIB_REMIX_KEY=your_remix_userkey \
  --env ZLIB_DOWNLOAD_DIR="$HOME/Downloads/books" \
  -- npx -y zlib-mcp
```

Or edit `~/.claude.json` / `.mcp.json` directly using the JSON below.

</details>

<details>
<summary><b>Claude Desktop</b> — <code>claude_desktop_config.json</code></summary>

macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
Windows: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "zlib": {
      "command": "npx",
      "args": ["-y", "zlib-mcp"],
      "env": {
        "ZLIB_REMIX_ID": "123456",
        "ZLIB_REMIX_KEY": "your_remix_userkey",
        "ZLIB_DOWNLOAD_DIR": "/Users/you/Downloads/books"
      }
    }
  }
}
```

</details>

<details>
<summary><b>Cursor</b> — <code>.cursor/mcp.json</code> or <code>~/.cursor/mcp.json</code></summary>

```json
{
  "mcpServers": {
    "zlib": {
      "command": "npx",
      "args": ["-y", "zlib-mcp"],
      "env": {
        "ZLIB_REMIX_ID": "123456",
        "ZLIB_REMIX_KEY": "your_remix_userkey",
        "ZLIB_DOWNLOAD_DIR": "/Users/you/Downloads/books"
      }
    }
  }
}
```

</details>

<details>
<summary><b>Codex CLI</b> — <code>~/.codex/config.toml</code></summary>

```toml
[mcp_servers.zlib]
command = "npx"
args = ["-y", "zlib-mcp"]

[mcp_servers.zlib.env]
ZLIB_REMIX_ID = "123456"
ZLIB_REMIX_KEY = "your_remix_userkey"
ZLIB_DOWNLOAD_DIR = "/Users/you/Downloads/books"
```

</details>

### 3. Try it

> Find me Kleppmann's _Designing Data-Intensive Applications_ in epub, then download the first result.

## Configuration

| Variable                  | Required   | Default                              | Notes                                                                 |
| ------------------------- | ---------- | ------------------------------------ | --------------------------------------------------------------------- |
| `ZLIB_REMIX_ID`           | one of two | —                                    | Your `remix_userid`                                                   |
| `ZLIB_REMIX_KEY`          | one of two | —                                    | Your `remix_userkey`                                                  |
| `ZLIB_EMAIL`              | one of two | —                                    | Fallback: exchanged for remix credentials on first use                |
| `ZLIB_PASSWORD`           | one of two | —                                    | Fallback, used with `ZLIB_EMAIL`                                      |
| `ZLIB_HOST`               | no         | `pkuedu.xyz`                         | Upstream mirror; change it if you get blocked                         |
| `ZLIB_DOWNLOAD_DIR`       | no         | _(unset → `zlib_download` disabled)_ | Where downloads are written                                           |
| `ZLIB_MAX_DOWNLOAD_BYTES` | no         | `524288000` (500 MB)                 | Files above this need `allow_large: true`                             |
| `ZLIB_TIMEOUT_MS`         | no         | `20000`                              | Per-request connect timeout                                           |
| `ZLIB_CREDENTIAL_CACHE`   | no         | `1`                                  | Set `0` to never write `~/.zlib-mcp/credentials.json`                 |
| `ZLIB_LOG_LEVEL`          | no         | `info`                               | `debug` / `info` / `warn` / `error` / `silent`; all logs go to stderr |

### Credential precedence

1. `ZLIB_REMIX_ID` + `ZLIB_REMIX_KEY`
2. Cached credentials from a previous `ZLIB_EMAIL` login (`~/.zlib-mcp/credentials.json`, mode `600`)
3. `ZLIB_EMAIL` + `ZLIB_PASSWORD` → logged in on **first tool call**, not at startup

The cache exists so a client restart does not trigger a fresh login every time — repeated logins are what makes z-library's anti-abuse system notice you. It stores only the remix id and key; **your password is never written to disk, logged, or returned by any tool**. On Windows the `600` mode is a no-op (the OS ignores POSIX permissions) — set `ZLIB_CREDENTIAL_CACHE=0` if that matters to you.

If nothing is configured the server still starts and lists its tools; calling one returns instructions on what to set. It does not crash — a crashed MCP server just shows up as "unavailable" in most clients, with nothing to debug.

## Troubleshooting

**"Upstream host … appears to be blocking this request"** — the mirror is behind an anti-bot wall. Set `ZLIB_HOST` to another one and restart the client. Known mirrors change often; `1lib.sk` is currently blocked, `pkuedu.xyz` currently works. Anything that serves the same `/eapi/*` endpoints will do.

**"z-library rejected the current credentials"** — your remix key expired. Run `zlib_login` again and update the config. If you use the email/password fallback, delete `~/.zlib-mcp/credentials.json` to force a fresh login.

**"download quota reached"** — free accounts get a small number of downloads per day. `zlib_limits` shows the counter; it resets on z-library's side at midnight UTC.

**Nothing appears in the client** — check the client's MCP log; this server writes all diagnostics to stderr. `ZLIB_LOG_LEVEL=debug` makes it chattier.

**`zlib_download` is missing** — you did not set `ZLIB_DOWNLOAD_DIR`. That is by design.

## Development

```bash
pnpm install
pnpm check      # format check → lint → typecheck → tests
pnpm build
```

To try an unreleased version straight from git, point your client's `command`/`args` at
`npx` / `["-y", "github:shiyi-0x7f/zlib-mcp"]` — the `prepare` script builds it on install.

Tests never hit the real upstream — `fetch` is stubbed everywhere.

## Legal

This tool only provides API access to **your own** z-library account. It hosts nothing, distributes nothing, and ships no copyrighted content. Making sure your use of it is lawful where you are is on you. Your account, your quota, your risk — an account banned for abuse is yours to lose.

## License

MIT
