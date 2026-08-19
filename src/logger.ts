/**
 * 极简 stderr logger。
 *
 * 为什么不用 pino/winston：本包通过 `npx` 分发并作为 stdio MCP server 被客户端拉起，
 * 唯一的日志需求是往 stderr 打几行诊断信息。引入日志框架只增加冷启动开销与依赖面。
 * 全局约定「禁 console.log 散落」的实质要求 —— 输出集中在一处、可统一控制 —— 由本模块满足，
 * 并由 eslint 的 `no-console`（仅本文件豁免）强制。
 *
 * 铁律：stdio 传输下 stdout 属于 MCP 协议通道，任何写入都会破坏帧。只许写 stderr。
 */

const LEVELS = ['debug', 'info', 'warn', 'error', 'silent'] as const;
export type LogLevel = (typeof LEVELS)[number];

const isLogLevel = (value: string): value is LogLevel => (LEVELS as readonly string[]).includes(value);

const configuredLevel = ((): LogLevel => {
  const raw = process.env['ZLIB_LOG_LEVEL']?.toLowerCase() ?? 'info';
  return isLogLevel(raw) ? raw : 'info';
})();

const threshold = LEVELS.indexOf(configuredLevel);

function emit(level: Exclude<LogLevel, 'silent'>, message: string): void {
  if (LEVELS.indexOf(level) < threshold) return;
  console.error(`[zlib-mcp] ${level.toUpperCase()} ${message}`);
}

export const logger = {
  debug: (message: string): void => {
    emit('debug', message);
  },
  info: (message: string): void => {
    emit('info', message);
  },
  warn: (message: string): void => {
    emit('warn', message);
  },
  error: (message: string): void => {
    emit('error', message);
  },
};
