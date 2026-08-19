# CLAUDE.md — zlib-mcp

> 全局约定见 `D:\ClaudeData\.claude\CLAUDE.md`，本文件只写本项目特有的硬约束。

## 项目性质

分发给他人使用的 **stdio MCP server**，npm 包名 `zlib-mcp`，通过 `npx zlib-mcp` 运行。零服务端、零鉴权，每个使用者用自己的 z-library 账号。

需求 / 架构 / 上游契约来源等内部文档在本机 `dev_docs/`（**不入库**，见 `.gitignore`）。

## 铁律

1. **stdout 是 MCP 协议通道**。任何 `console.log` / `process.stdout.write` 都会破坏帧。日志一律走 `src/logger.ts`（stderr），由 eslint 的 `no-console` 强制（仅 `src/logger.ts` 豁免）。
2. **password 与完整 remix_key 不进返回值、日志、错误消息**。`remix_key` 必须出现时用 `maskKey()` 脱敏。password 也永不落盘。
3. **搜索结果必须过 `src/shaping.ts` 的白名单裁剪**，不透传上游原始 JSON。上游多返回的字段一律丢弃 —— 宁可少字段，不可灌爆上下文。
4. **文件名与落盘路径必须过 `src/safe-path.ts` 的三道防线**。上游 `Content-Disposition`、用户入参、URL 末段都不可信。
5. **不在启动时登录**。凭证懒解析，失败表现为可操作的工具错误，不是进程崩溃。
6. **不注册未授权的能力**。`zlib_download` 只在配了 `ZLIB_DOWNLOAD_DIR` 时才注册。
7. **测试不打真实上游**。`ZlibraryClient` 与 `streamToDisk` 都接受 `fetchImpl` 注入。

## 命令

```bash
pnpm check     # 门禁：format:check → lint → typecheck → test（CI 跑同一条）
pnpm build     # tsc -p tsconfig.build.json → dist/
pnpm test      # vitest run
```

## 发布

`v*` tag 触发 `.github/workflows/release.yml`。tag 必须与 `package.json` 的 version 一致，否则 workflow 直接失败。上游域名默认值变更算 patch，工具入参不兼容变更算 major。

## 边界

本项目**零服务端依赖**：不 import 任何自有项目、不调任何自有服务、不碰任何共享账号池。上游只有 z-library 本身。
