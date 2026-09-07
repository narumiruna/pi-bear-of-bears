export async function fetchPublicJson(
  url: string,
  fetcher: typeof fetch,
  signal?: AbortSignal,
): Promise<unknown> {
  signal?.throwIfAborted();
  const deadline = AbortSignal.timeout(15000);
  const response = await fetcher(url, {
    signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
    redirect: "error",
    credentials: "omit",
  });
  if (!response.ok) throw new Error(`公開資料 HTTP ${response.status}。`);
  if (!response.body) throw new Error("公開資料回覆為空。 ");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2 * 1024 * 1024) throw new Error("公開資料超過 2 MiB。 ");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  signal?.throwIfAborted();
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("公開資料物件格式錯誤。 ");
  return value as Record<string, unknown>;
}

export function fields<S extends string, N extends string>(
  value: unknown,
  strings: readonly S[],
  numbers: readonly N[],
): Record<S, string> & Record<N, number> {
  const input = record(value);
  const output: Record<string, string | number> = {};
  for (const key of strings) {
    if (typeof input[key] !== "string")
      throw new Error(`公開資料欄位錯誤：${key}`);
    output[key] = input[key];
  }
  for (const key of numbers) {
    const number = input[key];
    if (typeof number !== "number" || !Number.isFinite(number) || number < 0)
      throw new Error(`公開資料欄位錯誤：${key}`);
    output[key] = number;
  }
  return output as Record<S, string> & Record<N, number>;
}

export function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("公開資料陣列格式錯誤。 ");
  return value;
}
