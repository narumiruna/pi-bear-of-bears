import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import {
  installLedger,
  ledgerOriginal,
  withLedgerCall,
} from "../src/ledger-channel.js";
import { LedgerIdentity } from "../src/ledger-identity.js";
import { LedgerStore } from "../src/ledger-store.js";
import type { LedgerReference } from "../src/ledger-types.js";
import {
  telegramLedgerAccount,
  telegramUserId,
} from "../src/telegram-user-id.js";
import { ledgerHarness } from "./fixtures/ledger.js";
import { message, statusText } from "./fixtures/workflow.js";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    cleanup();
  }
});
function setup(
  directory?: (root: string) => string,
  legacyLabel = "legacy-label",
) {
  const h = ledgerHarness(legacyLabel);
  cleanups.push(() => h.close());
  const references = new Map<string, LedgerReference[]>();
  const make = () =>
    new LedgerIdentity(directory?.(h.directory) ?? h.directory, (account) => ({
      session: () => "test-session",
      references: () => references.get(account) ?? [],
      publish: (ref) =>
        references.set(account, [...(references.get(account) ?? []), ref]),
    }));
  let identity = make(),
    uninstall = installLedger(identity);
  cleanups.push(() => {
    uninstall();
    identity.close();
  });
  return {
    h,
    references,
    current: () => identity,
    restart: () => {
      uninstall();
      identity.close();
      identity = make();
      uninstall = installLedger(identity);
    },
  };
}

test.each(["1", "9007199254740993", "9223372036854775807"])(
  "本人 ID %s 保留完整十進位精度",
  (id) => {
    expect(telegramUserId(id)).toBe(id);
    expect(telegramLedgerAccount(id)).toBe(`telegram-${id}`);
  },
);
test.each([
  undefined,
  null,
  42,
  42n,
  "",
  "0",
  "01",
  "-1",
  "../42",
  "1e3",
  "main",
  "9223372036854775808",
])("不接受未驗證、非字串或非法 ID %s", (id) => {
  expect(() => telegramLedgerAccount(id)).toThrow(/本人 ID/u);
});
test("沒有身分時不開庫、不猜預設帳號；未知身分 command 不派送，history 仍可讀", async () => {
  const app = setup(),
    h = app.h;
  h.add(statusText());
  expect(readdirSync(h.directory)).toEqual(["legacy-label"]);
  expect(app.current().runtime).toBeUndefined();
  expect(app.current().requiresIdentity).toBe(true);
  Object.defineProperty(h.bot, "telegramUserId", {
    value: undefined,
    configurable: true,
  });
  expect(await h.game.history()).toHaveLength(1);
  await expect(h.act("/skill 血怒亂斬")).rejects.toThrow(/not dispatched/u);
  expect(h.bot.send).not.toHaveBeenCalled();
  expect(readdirSync(h.directory)).toEqual(["legacy-label"]);
});
test("正常 mock 連線才以本人 ID 自動開庫；九角／角色切換不改 Telegram 命名空間", async () => {
  const app = setup(),
    h = app.h;
  h.seed();
  await h.game.history();
  const runtime = app.current().runtime;
  if (!runtime) {
    throw new Error("缺 runtime");
  }
  expect(runtime.store.account).toBe("telegram-100000001");
  expect(runtime.store.path).toBe(
    join(h.directory, "by-telegram-id", "telegram-100000001", "ledger.sqlite"),
  );
  const result = await h.act("/skill 血怒亂斬");
  expect(result.accounting).toMatchObject({ confirmedMpCost: 32, mpAfter: 68 });
  h.messages.push(message(100, statusText("另一角色", 1000, 90)));
  await h.game.history();
  expect(app.current().runtime).toBe(runtime);
  expect(h.store.read(h.references()).observations).toHaveLength(1);
});
test("reload 後另一 Telegram ID 分到另一庫，不接管或合併舊標籤與舊帳號", async () => {
  const app = setup(),
    h = app.h;
  h.seed();
  await h.game.history();
  app.restart();
  Object.defineProperty(h.bot, "telegramUserId", {
    value: "200000002",
    configurable: true,
  });
  h.messages.splice(
    0,
    h.messages.length,
    message(1, statusText("第二帳號", 1000, 77)),
  );
  await h.game.history();
  expect(app.current().runtime?.store.account).toBe("telegram-200000002");
  const prior = new LedgerStore(
    join(h.directory, "by-telegram-id"),
    "telegram-100000001",
  );
  try {
    expect(
      prior.read(app.references.get("telegram-100000001") ?? []).observations[0]
        .message.text,
    ).not.toContain("第二帳號");
  } finally {
    prior.close();
  }
  expect(existsSync(join(h.directory, "legacy-label", "ledger.sqlite"))).toBe(
    true,
  );
});
test("同一 Pi session 登入者變更拒絕派送並失效舊視圖；history 不混入舊庫", async () => {
  const app = setup(),
    h = app.h;
  h.seed();
  await h.game.history();
  const before = app.current().runtime?.read().observations.length;
  Object.defineProperty(h.bot, "telegramUserId", {
    value: "200000002",
    configurable: true,
  });
  await expect(h.act("/skill 血怒亂斬")).rejects.toThrow(/不同 Telegram/u);
  expect(app.current().runtime).toBeUndefined();
  expect(app.current().diagnostics().join()).toContain("重新載入");
  await h.game.history();
  expect(h.bot.send).not.toHaveBeenCalled();
  expect(
    existsSync(join(h.directory, "by-telegram-id", "telegram-200000002")),
  ).toBe(false);
  const old = new LedgerStore(
    join(h.directory, "by-telegram-id"),
    "telegram-100000001",
  );
  try {
    expect(
      old.read(app.references.get("telegram-100000001") ?? []).observations,
    ).toHaveLength(before ?? 0);
  } finally {
    old.close();
  }
});
test("watch 僅用連線的本人 ID，不能拿角色或 bot 訊息推定；異帳號不寫舊庫", () => {
  const app = setup(),
    h = app.h;
  const status = h.add(statusText());
  app.current().watch([status], 0);
  expect(app.current().runtime).toBeUndefined();
  app.current().watch([status], 0, "9007199254740993");
  expect(app.current().runtime?.store.account).toBe(
    "telegram-9007199254740993",
  );
  app.current().watch([h.add("另一個來源")], 0, "100000001");
  expect(app.current().runtime).toBeUndefined();
  expect(
    existsSync(join(h.directory, "by-telegram-id", "telegram-100000001")),
  ).toBe(false);
});
test("確認 ID 後 DB 寫入失敗不送 command；history 仍可讀，舊庫不刪除", async () => {
  const app = setup((root) => {
    const path = join(root, "not-a-directory");
    writeFileSync(path, "保留", { mode: 0o600 });
    return path;
  });
  app.h.seed();
  expect(await app.h.game.history()).toHaveLength(1);
  expect(app.current().diagnostics().join()).toContain("初始化失敗");
  await expect(app.h.act("/skill 血怒亂斬")).rejects.toThrow(/not dispatched/u);
  expect(app.h.bot.send).not.toHaveBeenCalled();
  expect(existsSync(app.h.store.path)).toBe(true);
});
test("身分取得前切樹或 shutdown 的遲到 ticket 不綁入新控制情境", () => {
  const app = setup();
  const ticket = app.current().begin("command", "/skill 血怒亂斬");
  app.current().reset();
  expect(() => ticket.identify?.("100000001")).toThrow(/控制情境/u);
  expect(() => ticket.dispatch()).toThrow(/未派送/u);
  expect(app.current().runtime).toBeUndefined();
  const shutdown = app.current().begin("command", "/skill 血怒亂斬");
  app.current().close();
  expect(() => shutdown.identify?.("100000001")).toThrow();
  expect(
    existsSync(join(app.h.directory, "by-telegram-id", "telegram-100000001")),
  ).toBe(false);
});
test("原文來源需本次已驗證呼叫或 watch 身分；不將未綁定結果寫進舊庫", async () => {
  const app = setup(),
    h = app.h;
  h.seed();
  const call = { toolCallId: "verified", toolName: "bears_history" };
  await withLedgerCall(call, () => h.game.history());
  const runtime = app.current().runtime;
  if (!runtime) {
    throw new Error("缺 runtime");
  }
  const source = "abcddcba-0000-4000-8000-000000000001";
  ledgerOriginal(h.messages, source);
  expect(runtime.store.trace(1)?.originalSourceId).toBeNull();
  withLedgerCall(call, () => ledgerOriginal(h.messages, source));
  expect(runtime.store.trace(1)?.originalSourceId).toBe(source);
});

test("即使舊手動標籤與衍生名稱相同，也不接管或合併舊資料庫", async () => {
  const app = setup(undefined, "telegram-100000001"),
    h = app.h;
  h.seed("舊庫角色");
  h.messages.splice(
    0,
    h.messages.length,
    message(1, statusText("新連線角色", 1000, 81)),
  );
  await h.game.history();
  expect(app.current().runtime?.store.path).not.toBe(h.store.path);
  expect(h.store.read(h.references()).observations[0].message.text).toContain(
    "舊庫角色",
  );
  expect(app.current().runtime?.read().observations[0].message.text).toContain(
    "新連線角色",
  );
});
