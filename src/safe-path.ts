/**
 * 文件名与落盘路径安全（PRD §5.4）。
 *
 * 威胁模型：文件名有两个来源 —— 上游 `Content-Disposition` 与用户入参 —— **两者都不可信**。
 * 一个能被诱导往任意路径写文件的 MCP server 等于把宿主机交出去了。
 *
 * 三道防线：
 *   1. sanitizeFilename —— 剥离路径分隔符 / `..` / 控制字符 / Windows 保留字符与设备名
 *   2. resolveWithinDir —— path.resolve 后前缀比对，确认最终路径仍在下载目录内
 *   3. uniquePath      —— 同名不覆盖，自动加 ` (2)` 后缀
 */

import { existsSync } from 'node:fs';
import path from 'node:path';

/** Windows 保留设备名：无扩展名与带扩展名都不可用（`CON` 与 `CON.txt` 同样被拒）。 */
const WINDOWS_RESERVED = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  ...Array.from({ length: 9 }, (_, i) => `com${String(i + 1)}`),
  ...Array.from({ length: 9 }, (_, i) => `lpt${String(i + 1)}`),
]);

/** Windows 非法字符 + 控制字符。`/` 与 `\` 由 basename 提取兜底，这里一并清掉。 */
// eslint-disable-next-line no-control-regex -- 控制字符正是要过滤的目标
const ILLEGAL_CHARS = /[<>:"|?*\\/\u0000-\u001f]/g;

const MAX_BASENAME_LENGTH = 120;
const FALLBACK_NAME = 'download';

/**
 * 把任意字符串安全化成一个纯文件名（无目录成分）。
 * 永不抛：无论输入多恶意，都产出一个可用的名字，最坏情况是 `download`。
 */
export function sanitizeFilename(raw: string): string {
  // 先按两种分隔符切，取最后一段 —— `../../evil` 与 `C:\Windows\x` 都在这一步塌成 basename。
  const lastSegment = raw.split(/[\\/]/).pop() ?? '';

  let name = lastSegment.replace(ILLEGAL_CHARS, '_').trim();
  // Windows 会静默剥掉结尾的点和空格，导致「校验过的名字」与「实际落盘的名字」不一致。
  name = name.replace(/[. ]+$/, '');
  // `.` / `..` 清理后为空，落到兜底名。
  if (name === '' || /^\.+$/.test(name)) return FALLBACK_NAME;

  const extension = path.extname(name);
  const stem = extension === '' ? name : name.slice(0, -extension.length);

  if (WINDOWS_RESERVED.has(stem.toLowerCase())) {
    return `${stem}_${extension}`;
  }

  if (name.length > MAX_BASENAME_LENGTH) {
    const room = Math.max(1, MAX_BASENAME_LENGTH - extension.length);
    return `${stem.slice(0, room)}${extension}`;
  }
  return name;
}

/**
 * 把 filename 解析到 dir 内，并确认结果确实**在** dir 里。
 * 这是 sanitizeFilename 之外的独立第二道防线（符号链接、大小写、盘符差异都可能绕过第一道）。
 * 越界返回 undefined，由调用方拒绝。
 */
export function resolveWithinDir(dir: string, filename: string): string | undefined {
  const root = path.resolve(dir);
  const target = path.resolve(root, filename);

  // 用 path.relative 而非字符串前缀比对：后者会把 `/data-evil` 误判为在 `/data` 内。
  const relative = path.relative(root, target);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) return undefined;
  return target;
}

/** 同名不覆盖：`book.epub` → `book (2).epub` → `book (3).epub`。 */
export function uniquePath(target: string, exists: (p: string) => boolean = existsSync): string {
  if (!exists(target)) return target;

  const dir = path.dirname(target);
  const extension = path.extname(target);
  const stem = path.basename(target, extension);

  for (let n = 2; n < 1000; n += 1) {
    const candidate = path.join(dir, `${stem} (${String(n)})${extension}`);
    if (!exists(candidate)) return candidate;
  }
  throw new Error(`too many files named like "${path.basename(target)}" already exist in ${dir}`);
}

/** 从 Content-Disposition 抠文件名，支持 RFC 5987 的 `filename*=UTF-8''…`。 */
export function filenameFromContentDisposition(header: string | null): string | undefined {
  if (header === null) return undefined;

  const extended = /filename\*\s*=\s*[^']*''([^;]+)/i.exec(header);
  if (extended?.[1] !== undefined) {
    try {
      return decodeURIComponent(extended[1].trim());
    } catch {
      // 编码坏了就退回普通 filename=
    }
  }

  const plain = /filename\s*=\s*"([^"]+)"|filename\s*=\s*([^;]+)/i.exec(header);
  const value = plain?.[1] ?? plain?.[2];
  return value === undefined ? undefined : value.trim();
}
