import { expect, test, vi } from "vitest";
import {
  getPublicCharacter,
  parsePublicCharacter,
} from "../src/public-character.js";

const html = `<h1>🔮 なるみ</h1>
<div class="box"><h3>🐻 角色狀態</h3><div class="kv"><div class="k">🕐 最後活動</div><div class="v">2026-09-24 10:26</div></div></div>
<div class="box"><h3>🛡 身上裝備（1 件）</h3><div class="eq"><div class="it"><div class="slot">武器</div><span class="sc">1,040 分</span><div class="nm">🟠🪄不朽永恆法杖</div><div class="st">INT+246　<span>Lv89</span></div></div></div></div>
<div class="box"><h3>🏆 裝備評分　<span>全服第 32 名</span></h3><div class="grid"><div class="kv"><div class="k">總評分</div><div class="v">22,084</div></div><div class="kv"><div class="k">裝備力（身上）</div><div class="v">5,873</div></div><div class="kv"><div class="k">終身稀有積分 ×0.4</div><div class="v">40,528</div></div></div></div>`;

test("公開頁解析網站評分與身上裝備，拒絕姓名不符及缺項", () => {
  expect(parsePublicCharacter(html, "なるみ")).toMatchObject({
    score: 22084,
    equippedPower: 5873,
    lifetimeRarePoints: 40528,
    rank: 32,
    lastActivity: "2026-09-24 10:26",
    equipment: [{ slot: "武器", name: "🟠🪄不朽永恆法杖", score: 1040 }],
  });
  expect(() => parsePublicCharacter(html, "其他人")).toThrow();
  expect(() =>
    parsePublicCharacter(html.replace("22,084", ""), "なるみ"),
  ).toThrow();
});

test("固定來源編碼角色名、唯讀且不重試，拒絕錯誤與超大頁面", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(async () => new Response(html));
  const result = await getPublicCharacter("なるみ_狂戰熊", fetcher).catch(
    () => null,
  );
  expect(result).toBeNull(); // 回覆頁姓名不符
  expect(fetcher.mock.calls[0][0]).toBe(
    "https://lab4.kvzhuang.net/gen-art/bears-life-detail/?u=%E3%81%AA%E3%82%8B%E3%81%BF_%E7%8B%82%E6%88%B0%E7%86%8A",
  );
  expect(fetcher.mock.calls[0][1]).toMatchObject({
    credentials: "omit",
    redirect: "error",
  });
  expect((await getPublicCharacter("なるみ", fetcher)).score).toBe(22084);
  await expect(
    getPublicCharacter("なるみ", fetcher, AbortSignal.abort()),
  ).rejects.toThrow();
  for (const response of [
    new Response("no", { status: 404 }),
    new Response("x".repeat(2 * 1024 * 1024 + 1)),
  ]) {
    const failed = vi.fn<typeof fetch>().mockResolvedValue(response);
    await expect(getPublicCharacter("なるみ", failed)).rejects.toThrow();
    expect(failed).toHaveBeenCalledOnce();
  }
});
