import {
  linkSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { afterEach, expect, test, vi } from "vitest";
import { prepareRetention } from "../src/ledger-retention.js";
import {
  type RetentionModelCall,
  type RetentionUsage,
  retentionModelCall,
} from "../src/ledger-retention-agent.js";
import {
  compactLedger,
  validatePublicRetention,
} from "../src/ledger-retention-run.js";
import { publishRetentionWiki } from "../src/ledger-retention-wiki.js";
import { LedgerStore } from "../src/ledger-store.js";
import { RecordsStore } from "../src/records-store.js";
import { ledgerHarness } from "./fixtures/ledger.js";

const open: ReturnType<typeof ledgerHarness>[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const h of open.splice(0)) {
    h.close();
  }
});
const usage: RetentionUsage = {
  input: 10,
  output: 10,
  totalTokens: 20,
  cacheRead: 0,
  cacheWrite: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};
const summary = {
  title: "歷史條件觀察",
  journal: "角色實測與未知機制分開記錄，沒有新操作。",
  uncertainties: ["未知承傷上界"],
  wiki: [],
};
const model: RetentionModelCall = async () => {
  await Promise.resolve();
  return { text: JSON.stringify(summary), usage, stopReason: "stop" };
};
async function setup() {
  const h = ledgerHarness();
  open.push(h);
  h.install();
  h.seed();
  for (let n = 0; n < 10; n++) {
    await h.act("/skill 血怒亂斬");
  }
  return h;
}
test("成功摘要落入紀錄庫後才刪事件；沒有額外遊戲操作；備份成功清理", async () => {
  const h = await setup(),
    records = new RecordsStore(join(h.directory, "records.sqlite")),
    calls = vi.mocked(h.bot.send).mock.calls.length;
  try {
    const result = await compactLedger(h.runtime, records, model, {
      minimumEvents: 1,
    });
    expect(result.state).toBe("confirmed");
    expect(records.status().records).toBe(1);
    expect(records.search({ query: "未知承傷" }).items).toHaveLength(1);
    expect(h.bot.send).toHaveBeenCalledTimes(calls);
    expect(readdirSync(join(h.directory, "backups"))).toEqual([]);
    expect(
      h.store.db.prepare("SELECT COUNT(*) n FROM ledger_maintenance").get()?.n,
    ).toBe(0);
  } finally {
    records.close();
  }
});
test("壓縮期間收到未記帳watch會留下gap，不延續舊餘額", async () => {
  const h = await setup(),
    records = new RecordsStore(join(h.directory, "records.sqlite"));
  try {
    const call: RetentionModelCall = (request) => {
      h.runtime.watch([h.add("維護期間的未知更新")], 0);
      return model(request);
    };
    expect(
      (await compactLedger(h.runtime, records, call, { minimumEvents: 1 }))
        .state,
    ).toBe("confirmed");
    expect(h.projection().activeCharacter).toBeNull();
    expect(h.projection().gaps.some((g) => g.reason.includes("缺口"))).toBe(
      true,
    );
  } finally {
    records.close();
  }
});

test("模型、schema、Wiki或摘要寫入失敗與取消皆不刪事件", async () => {
  const h = await setup(),
    records = new RecordsStore(join(h.directory, "records.sqlite"));
  const count = () =>
    h.store.db.prepare("SELECT COUNT(*) n FROM events").get()?.n;
  const before = count();
  try {
    for (const text of [
      "not json",
      JSON.stringify({
        ...summary,
        wiki: [{ sourceId: "private", quote: "角色私訊" }],
      }),
      JSON.stringify({ ...summary, unexpected: "指令" }),
    ]) {
      await expect(
        compactLedger(
          h.runtime,
          records,
          () => Promise.resolve({ text, usage, stopReason: "stop" }),
          { minimumEvents: 1 },
        ),
      ).rejects.toThrow();
      expect(count()).toBe(before);
    }
    await expect(
      compactLedger(h.runtime, records, model, {
        minimumEvents: 1,
        signal: AbortSignal.abort(),
      }),
    ).rejects.toThrow();
    const spy = vi.spyOn(records, "append").mockImplementationOnce(() => {
      throw new Error("磁碟不可寫");
    });
    await expect(
      compactLedger(h.runtime, records, model, { minimumEvents: 1 }),
    ).rejects.toThrow(/不可寫/u);
    spy.mockRestore();
    expect(count()).toBe(before);
  } finally {
    records.close();
  }
});
test("隔離subagent只收到分塊歷史JSON，沒有檔案、DB、Telegram或遞迴工具", async () => {
  const streamSimple = vi.fn((..._args: unknown[]) => ({
    result: () =>
      Promise.resolve({
        content: [{ type: "text", text: JSON.stringify(summary) }],
        usage,
        stopReason: "stop",
      }),
  }));
  const ctx = {
    model: { id: "synthetic" },
    modelRegistry: { streamSimple },
  } as unknown as ExtensionContext;
  const call = retentionModelCall(ctx);
  await call({
    system: "固定指令",
    input: "歷史資料",
    maxTokens: 100,
    signal: new AbortController().signal,
  });
  expect(streamSimple.mock.calls[0][1]).toEqual({
    systemPrompt: "固定指令",
    messages: [
      { role: "user", content: "歷史資料", timestamp: expect.any(Number) },
    ],
    tools: [],
  });
});
test("維護lease阻擋本程序及另一連線派送，重試重用已落盤摘要而不重複模型", async () => {
  const h = await setup(),
    records = new RecordsStore(join(h.directory, "records.sqlite"));
  const other = new LedgerStore(h.store.path, "test");
  try {
    await h.runtime.withMaintenance(async () => {
      await Promise.resolve();
      expect(() => h.runtime.begin("command", "/attack 測試")).toThrow(
        /未派送/u,
      );
      expect(() =>
        other.context({
          id: "other",
          session: "other",
          runtime: "other",
          toolCallId: null,
          toolName: null,
          at: Date.now(),
        }),
      ).toThrow(/壓縮中/u);
    });
    const plan = prepareRetention(h.store, 1);
    if (!plan) {
      throw new Error("missing");
    }
    records.append(`ledger-compaction:${plan.id}`, {
      kind: "note",
      title: "已保存摘要",
      body: `${plan.digest}\n${plan.sourceHash}`,
      sources: [`ledger-compaction:${plan.id}`],
    });
    const noCall = vi.fn(model);
    expect(
      (await compactLedger(h.runtime, records, noCall, { minimumEvents: 1 }))
        .state,
    ).toBe("confirmed");
    expect(noCall).not.toHaveBeenCalled();
  } finally {
    other.close();
    records.close();
  }
});
test("只有公開圖鑑逐字摘錄可進Wiki，個人資料不寫；人工變更不覆寫", async () => {
  const h = await setup();
  const sources = [
    {
      id: "codex",
      url: "https://bearofbears.net/bears-life-codex/",
      text: "公開裝備屬性與技能。",
      observedDate: "2026-10-27",
    },
  ];
  const candidates = validatePublicRetention(
    [
      {
        ...summary,
        wiki: [{ sourceId: "codex", quote: "公開裝備屬性與技能。" }],
      },
    ],
    sources,
  );
  mkdirSync(join(h.directory, "wiki"));
  const other = join(h.directory, "unrelated.txt");
  writeFileSync(other, "不得修改");
  linkSync(other, join(h.directory, "wiki/INDEX.md"));
  await expect(publishRetentionWiki(candidates, h.directory)).rejects.toThrow(
    /連結/u,
  );
  expect(readFileSync(other, "utf8")).toBe("不得修改");
  unlinkSync(join(h.directory, "wiki/INDEX.md"));
  writeFileSync(join(h.directory, "wiki/INDEX.md"), "# 知識索引\n");
  const primary = join(h.directory, "wiki/existing.md");
  writeFileSync(primary, "# 既有主題\n\n公開裝備屬性與技能。\n");
  await publishRetentionWiki(candidates, h.directory);
  expect(readdirSync(join(h.directory, "wiki"))).not.toContain(
    "ledger-knowledge",
  );
  unlinkSync(primary);
  await publishRetentionWiki(candidates, h.directory);
  await publishRetentionWiki(candidates, h.directory);
  const path = join(h.directory, "wiki/ledger-knowledge"),
    files = readdirSync(path).filter((p) => p !== "INDEX.md");
  expect(files).toHaveLength(1);
  await publishRetentionWiki(
    candidates.map((c) => ({
      ...c,
      source: { ...c.source, observedDate: "2026-10-28" },
    })),
    h.directory,
  );
  expect(readdirSync(path).filter((p) => p !== "INDEX.md")).toHaveLength(1);
  expect(readFileSync(join(path, files[0]), "utf8")).not.toContain("測試熊");
  writeFileSync(join(path, files[0]), "人工內容");
  await expect(publishRetentionWiki(candidates, h.directory)).rejects.toThrow(
    /人工/u,
  );
  expect(() =>
    validatePublicRetention(
      [{ ...summary, wiki: [{ sourceId: "codex", quote: "測試熊的私訊" }] }],
      sources,
    ),
  ).toThrow();
  expect(() =>
    validatePublicRetention(
      [{ ...summary, wiki: [{ sourceId: "codex", quote: sources[0].text }] }],
      [
        {
          ...sources[0],
          url: "https://bearofbears.net/bears-life-detail/?u=private",
        },
      ],
    ),
  ).toThrow();
});
