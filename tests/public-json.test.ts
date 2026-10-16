import { afterEach, expect, test, vi } from "vitest";
import { fetchPublicJson } from "../src/public-json.js";

const URL = "https://example.com/public.json";
const MAX_BYTES = 2 * 1024 * 1024;

afterEach(() => vi.restoreAllMocks());

function responseFromChunks(chunks: Uint8Array[]) {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(chunk);
        }
        controller.close();
      },
    }),
  );
}

test("分段回覆恰好 2 MiB 可解析，完成後仍取消 reader", async () => {
  const value = "x".repeat(MAX_BYTES - Buffer.byteLength('{"value":""}'));
  const cancel = vi.spyOn(ReadableStreamDefaultReader.prototype, "cancel");
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      responseFromChunks([
        Buffer.from('{"value":"'),
        Buffer.from(value.slice(0, 1024)),
        Buffer.from(value.slice(1024)),
        Buffer.from('"}'),
      ]),
    );
  expect(await fetchPublicJson(URL, fetcher)).toEqual({ value });
  expect(cancel).toHaveBeenCalledOnce();
  expect(fetcher).toHaveBeenCalledOnce();
  expect(fetcher.mock.calls[0]).toEqual([
    URL,
    {
      signal: expect.any(AbortSignal),
      redirect: "error",
      credentials: "omit",
    },
  ]);
});

test("UTF-8 字元跨 chunk 時不分別解碼", async () => {
  const bytes = Buffer.from('{"value":"熊🐻"}');
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      responseFromChunks([
        bytes.subarray(0, 11),
        bytes.subarray(11, 14),
        bytes.subarray(14),
      ]),
    );
  expect(await fetchPublicJson(URL, fetcher)).toEqual({ value: "熊🐻" });
});

test("逐段累計 bytes，超過 2 MiB 時保留原錯誤且取消 reader、不重試", async () => {
  const cancel = vi.spyOn(ReadableStreamDefaultReader.prototype, "cancel");
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      responseFromChunks([Buffer.alloc(MAX_BYTES), Buffer.from("熊")]),
    );
  await expect(fetchPublicJson(URL, fetcher)).rejects.toEqual(
    new Error("公開資料超過 2 MiB。 "),
  );
  expect(cancel).toHaveBeenCalledOnce();
  expect(fetcher).toHaveBeenCalledOnce();
});

test("讀取失敗仍取消 reader，保留失敗結果且不重試", async () => {
  const failure = new Error("讀取失敗");
  const cancel = vi.spyOn(ReadableStreamDefaultReader.prototype, "cancel");
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
    new Response(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.error(failure);
        },
      }),
    ),
  );
  await expect(fetchPublicJson(URL, fetcher)).rejects.toBe(failure);
  expect(cancel).toHaveBeenCalledOnce();
  expect(fetcher).toHaveBeenCalledOnce();
});

test("reader 清理失敗仍向外傳遞，不繼續解析", async () => {
  const failure = new Error("清理失敗");
  vi.spyOn(ReadableStreamDefaultReader.prototype, "cancel").mockRejectedValue(
    failure,
  );
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(responseFromChunks([Buffer.from("invalid JSON")]));
  await expect(fetchPublicJson(URL, fetcher)).rejects.toBe(failure);
});

test.each([
  [new Response(null, { status: 503 }), "公開資料 HTTP 503。"],
  [new Response(null), "公開資料回覆為空。 "],
] as const)(
  "HTTP 與空 body 保留原錯誤和檢查順序：%s",
  async (response, message) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response);
    await expect(fetchPublicJson(URL, fetcher)).rejects.toEqual(
      new Error(message),
    );
    expect(fetcher).toHaveBeenCalledOnce();
  },
);

test("回覆後取消時拒絕解析，即使 body 不是合法 JSON", async () => {
  const controller = new AbortController();
  const reason = new Error("已取消");
  const fetcher = vi.fn<typeof fetch>().mockImplementation(() => {
    controller.abort(reason);
    return Promise.resolve(new Response("invalid JSON"));
  });
  await expect(fetchPublicJson(URL, fetcher, controller.signal)).rejects.toBe(
    reason,
  );
  expect(fetcher).toHaveBeenCalledOnce();
});
