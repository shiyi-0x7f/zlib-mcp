/** 上游 z-library API 的响应形状（只声明我们实际读取的字段）。 */

export interface RawBook {
  readonly [key: string]: unknown;
}

export interface RawSearchResponse {
  readonly success?: unknown;
  readonly books?: unknown;
  readonly pagination?: { readonly total_items?: unknown; readonly total_pages?: unknown } | undefined;
  readonly total?: unknown;
}

export interface LoginCredentials {
  readonly remixId: string;
  readonly remixKey: string;
  readonly email: string | undefined;
  readonly name: string | undefined;
}

export interface UserLimits {
  readonly downloadsToday: number;
  readonly downloadsLimit: number;
  readonly downloadsRemaining: number;
  readonly isPremium: boolean | undefined;
}
