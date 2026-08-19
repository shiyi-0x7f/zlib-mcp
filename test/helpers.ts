/** 测试用的 fetch 桩：不打真实上游（PRD §10）。 */

export interface StubCall {
  readonly url: string;
  readonly init: RequestInit | undefined;
}

export interface StubResponse {
  readonly status?: number;
  readonly body?: string;
  readonly headers?: Record<string, string>;
}

export interface FetchStub {
  readonly fetch: typeof fetch;
  readonly calls: StubCall[];
}

/** 按调用顺序依次返回给定响应；用完后重复最后一个。 */
export function stubFetch(...responses: StubResponse[]): FetchStub {
  const calls: StubCall[] = [];
  let index = 0;

  const impl: typeof fetch = (input, init) => {
    calls.push({ url: input instanceof Request ? input.url : String(input), init });
    const spec = responses[Math.min(index, responses.length - 1)] ?? {};
    index += 1;
    return Promise.resolve(
      new Response(spec.body ?? '{}', {
        status: spec.status ?? 200,
        headers: spec.headers ?? { 'content-type': 'application/json' },
      }),
    );
  };

  return { fetch: impl, calls };
}

/** 模拟 fetch 抛错（超时 / 网络中断）。 */
export function throwingFetch(error: Error): typeof fetch {
  return () => Promise.reject(error);
}

/** Response 构造函数会自动跟随不了 3xx，这里手工造一个带 Location 的重定向响应。 */
export function redirectResponse(status: number, location: string): StubResponse {
  return { status, body: '', headers: { location } };
}
