// 固定合成 workload；不連線、不讀憑證、不呼叫模型。先 npm run build。
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encode } from "gpt-tokenizer";
import { projectLedger } from "../dist/src/ledger-projection.js";
import { ledgerStatus } from "../dist/src/ledger-query.js";
import { ledgerReport } from "../dist/src/ledger-report.js";
import { LedgerRuntime } from "../dist/src/ledger-runtime.js";
import { LedgerStore } from "../dist/src/ledger-store.js";

const directory = mkdtempSync(
  join(realpathSync(tmpdir()), "bears-ledger-benchmark-"),
);
const store = new LedgerStore(
    join(directory, "synthetic-benchmark.sqlite"),
    "synthetic-benchmark",
  ),
  refs = [];
const runtime = new LedgerRuntime(store, {
  session: () => "benchmark",
  references: () => refs,
  publish: (ref) => refs.push(ref),
});
const messages = [],
  samples = [],
  date = Math.floor(Date.now() / 1000);
const add = (text, outgoing = false) => {
  const id = messages.length + 1;
  const message = {
    id,
    date,
    text,
    outgoing,
    revision: createHash("sha256").update(`${id}:${text}`).digest("hex"),
    hasMedia: false,
    buttons: [],
  };
  messages.push(message);
  return message;
};
const skill =
  "✨ 使用技能：合成技能（MP -32）\n造成 100 點傷害！🐻 HP：900/1000\n💚 恢復 500 HP！HP：1000/1000\n🐻 反擊！你受到 100 傷害。HP：900/1000";
function command(text, reply) {
  const start = performance.now(),
    ticket = runtime.begin("command", text);
  ticket.observe(messages.slice(-10), "before");
  ticket.dispatch();
  add(text, true);
  add(reply);
  ticket.observe(messages.slice(-10), "after");
  const accounting = ticket.finish(true);
  samples.push(performance.now() - start);
  return accounting;
}
try {
  runtime.watch(
    [
      add(
        "✨ 合成熊　法熊 Lv10\nHP：1000/1000　MP：100/100\nATK：20 (20+0)　DEF：10 (10+0)\nINT：30 (30+0)　AGI：5 (5+0)\n金幣：1000\nEXP：0/100\n位置：星塔前庭",
      ),
    ],
    0,
  );
  const start = performance.now();
  for (let cycle = 0; cycle < 100; cycle++) {
    for (let hand = 0; hand < 2; hand++) {
      const accounting = command("/skill 合成技能", skill);
      assert.equal(accounting.confirmedMpCost, 32);
      runtime.watch(messages.slice(-3), 0);
      const history = runtime.begin("history", null);
      history.observe(messages.slice(-10), "history");
      history.finish(false);
    }
    command("/rest", "免費休息，HP／MP 已恢復。");
  }
  const ingestMs = performance.now() - start,
    data = runtime.read();
  const queryStart = performance.now(),
    projection = projectLedger(data),
    status = ledgerStatus(runtime);
  const queryMs = performance.now() - queryStart;
  assert.equal(projection.account.mpSpent, 6400);
  assert.equal(projection.account.mpRecovered, 6400);
  assert.equal(projection.account.mp.value, 100);
  const rebuild = performance.now();
  store.reparse();
  assert.deepEqual(projectLedger(runtime.read()), projection);
  const rebuildMs = performance.now() - rebuild;
  const report = ledgerReport(data, {
    afterObservationId: data.observations.at(-1).id,
  });
  const sorted = samples.toSorted((a, b) => a - b);
  process.stdout.write(
    `${JSON.stringify(
      {
        runtime: process.version,
        workload: {
          skillReceipts: 200,
          rests: 100,
          historyRereads: 200,
          watchDuplicates: 200,
          rawMessages: messages.length,
        },
        account: {
          expectedMp: 6400,
          ledgerMp: projection.account.mpSpent,
          recoveredMp: projection.account.mpRecovered,
          duplicateDebits: projection.account.mpSpent / 32 - 200,
          independentCombatFacts: data.observations.filter(
            (o) => o.message.text === skill,
          ).length,
        },
        observations: data.observations.length,
        events: data.events.length,
        timingMs: {
          ingest: ingestMs,
          commandP50: sorted[Math.floor(sorted.length * 0.5)],
          commandP95: sorted[Math.floor(sorted.length * 0.95)],
          readAndProjection: queryMs,
          rebuild: rebuildMs,
        },
        bytes: {
          database: statSync(store.path).size,
          wal: statSync(`${store.path}-wal`).size,
        },
        queryTokensO200k: {
          fullRawHistory: encode(JSON.stringify({ messages })).length,
          status: encode(JSON.stringify(status)).length,
          reportWithoutOldEvidence: encode(JSON.stringify(report)).length,
        },
        coverage: {
          knownCosts: report.coverage.knownCosts,
          totalSkillReceipts: 200,
          knownDamageEvents: report.coverage.knownDamageEvents,
          damageEvents: report.coverage.damageEvents,
        },
        limitations: [
          "SQLite 與投影的本機合成量測，不含 Telegram／模型／TUI。",
          "原文稽核、status、changed-since report 的資訊量不同，token 差不是等價壓縮率。",
          "未量測導入前的真實 Agent 工作階段，不宣稱實機端到端提升。",
        ],
      },
      null,
      2,
    )}\n`,
  );
} finally {
  runtime.close();
  rmSync(directory, { recursive: true, force: true });
}
