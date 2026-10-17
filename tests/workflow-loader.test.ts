import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  discoverAndLoadExtensions,
  type ExtensionToolContext,
} from "@earendil-works/pi-coding-agent";
import { expect, test, vi } from "vitest";

function deferred() {
  let release: () => void = () => {};
  const promise = new Promise<void>((r) => {
    release = r;
  });
  return { promise, release };
}

test("實際 pi loader 載入兩個 extension 仍共享流程排他；不建立 Telegram transport", async () => {
  const directory = await mkdtemp(
    join(tmpdir(), "bears-workflow-lock-loader-"),
  );
  const path = JSON.stringify(resolve("src/game-operation.ts"));
  const idlePath = JSON.stringify(resolve("src/auto-idle-state.ts"));
  const hold = join(directory, "hold.ts"),
    check = join(directory, "check.ts");
  try {
    await writeFile(
      hold,
      `import { withGameOperation } from ${path};
import { beginAutoIdle } from ${idlePath};
export default function(pi) { pi.registerTool({ name: "test_hold", label: "hold", description: "test", exposure: "codemode", parameters: { type: "object", properties: {} }, execute: (_id, _params, _signal, _update, ctx) => withGameOperation(async () => { const end = beginAutoIdle(); try { await ctx.executeTool("hold", {}); return { content: [], details: {} }; } finally { end(); } }) }); }`,
    );
    await writeFile(
      check,
      `import { assertGameOperationAvailable } from ${path};
import { suppressAutoIdleWatch } from ${idlePath};
export default function(pi) {
pi.registerTool({ name: "test_check", label: "check", description: "test", exposure: "codemode", parameters: { type: "object", properties: {} }, execute: async () => { assertGameOperationAvailable(); return { content: [], details: {} }; } });
pi.registerTool({ name: "test_watch", label: "watch", description: "test", exposure: "codemode", parameters: { type: "object", properties: {} }, execute: async () => ({ content: [], details: { suppressed: suppressAutoIdleWatch() } }) }); }`,
    );
    const loaded = await discoverAndLoadExtensions(
      [hold, check],
      directory,
      directory,
    );
    expect(loaded.errors).toEqual([]);
    const one = loaded.extensions[0].tools.get("test_hold")?.definition;
    const two = loaded.extensions[1].tools.get("test_check")?.definition;
    const watch = loaded.extensions[1].tools.get("test_watch")?.definition;
    if (!one || !two || !watch) {
      throw new Error("缺少測試工具");
    }
    const gate = deferred(),
      started = deferred();
    const context = {
      executeTool: vi.fn(() => {
        started.release();
        return gate.promise;
      }),
    } as unknown as ExtensionToolContext;
    const active = one.execute("hold", {}, undefined, undefined, context);
    try {
      await started.promise;
      await expect(
        watch.execute("watch", {}, undefined, undefined, context),
      ).resolves.toMatchObject({ details: { suppressed: true } });
      await expect(
        two.execute("check", {}, undefined, undefined, context),
      ).rejects.toThrow("already running");
    } finally {
      gate.release();
      await active;
    }
    await expect(
      two.execute("check", {}, undefined, undefined, context),
    ).resolves.toMatchObject({ details: {} });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
