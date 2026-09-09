import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  AutoIdle,
  type AutoIdleResult,
  formatAutoIdleResult,
} from "../src/auto-idle.js";
import { beginAutoIdle } from "../src/auto-idle-state.js";
import { CHARACTER_MESSAGES_EVENT } from "../src/character-status.js";
import { Game } from "../src/game.js";
import { createTransport } from "../src/telegram.js";
import { WorldMap } from "../src/world.js";

const STATUS_ID = "auto-idle";

export default function (pi: ExtensionAPI) {
  const world = new WorldMap();
  let active: AutoIdle | undefined;
  let context: ExtensionContext | undefined;

  async function run(
    action: "start" | "stop",
    signal?: AbortSignal,
    progress: (message: string) => void = () => {},
  ): Promise<AutoIdleResult> {
    const release = beginAutoIdle();
    const game = new Game(createTransport);
    const auto = new AutoIdle(
      game,
      world,
      (messages) => pi.events.emit(CHARACTER_MESSAGES_EVENT, messages),
      progress,
    );
    active = auto;
    try {
      return action === "start"
        ? await auto.start(signal)
        : await auto.stopAll(signal);
    } finally {
      auto.stop();
      if (active === auto) active = undefined;
      release();
    }
  }

  async function runCommand(
    action: "start" | "stop",
    args: string,
    ctx: ExtensionContext,
  ) {
    context = ctx;
    if (args.trim()) {
      if (ctx.hasUI)
        ctx.ui.notify(
          action === "start" ? "用法：/idle" : "用法：/stopidle",
          "warning",
        );
      return;
    }
    if (!ctx.hasUI)
      throw new Error("/idle 與 /stopidle 需要 TUI 或 RPC UI 才能顯示結果。");
    try {
      ctx.ui.setStatus(
        STATUS_ID,
        action === "start" ? "🐾 正在設定所有角色…" : "⏹ 正在停止所有角色…",
      );
      const result = await run(action, undefined, (message) =>
        ctx.ui.setStatus(STATUS_ID, `🐾 ${message}`),
      );
      ctx.ui.notify(formatAutoIdleResult(result), "info");
    } catch (error) {
      ctx.ui.notify(
        `Auto Idle 已停止：${error instanceof Error ? error.message : String(error)}`,
        "error",
      );
    } finally {
      ctx.ui.setStatus(STATUS_ID, undefined);
    }
  }

  pi.registerCommand("idle", {
    description: "不使用 LLM，依角色等級自動移動所有角色並啟動遊戲內掛機。",
    handler: (args, ctx) => runCommand("start", args, ctx),
  });

  pi.registerCommand("stopidle", {
    description: "不使用 LLM，切換並停止所有角色的遊戲內掛機。",
    handler: (args, ctx) => runCommand("stop", args, ctx),
  });

  pi.registerTool({
    name: "start_idle",
    label: "自動設定所有角色掛機",
    description:
      "以固定規則切換最多 9 個角色、結算既有掛機、避開 BOSS 房移動並重新掛機。只在使用者明確要求所有角色自動掛機時單獨呼叫；不使用其他 tools 並行。直接輸入 /idle 可完全不呼叫 LLM。",
    parameters: Type.Object({}, { additionalProperties: false }),
    async execute(_id, _params, signal, onUpdate) {
      const result = await run("start", signal, (message) =>
        onUpdate?.({
          content: [{ type: "text", text: message }],
          details: { progress: message },
        }),
      );
      return {
        content: [{ type: "text", text: formatAutoIdleResult(result) }],
        details: result,
        terminate: true,
      };
    },
  });

  pi.registerTool({
    name: "stop_idle",
    label: "停止所有角色掛機",
    description:
      "切換最多 9 個角色並結算所有進行中的遊戲內掛機。只在使用者明確要求停止所有角色掛機時單獨呼叫；不使用其他 tools 並行。直接輸入 /stopidle 可完全不呼叫 LLM。",
    parameters: Type.Object({}, { additionalProperties: false }),
    async execute(_id, _params, signal, onUpdate) {
      const result = await run("stop", signal, (message) =>
        onUpdate?.({
          content: [{ type: "text", text: message }],
          details: { progress: message },
        }),
      );
      return {
        content: [{ type: "text", text: formatAutoIdleResult(result) }],
        details: result,
        terminate: true,
      };
    },
  });

  pi.on("session_start", (_event, ctx) => {
    context = ctx;
  });

  pi.on("session_shutdown", () => {
    active?.stop();
    active = undefined;
    if (context?.hasUI) context.ui.setStatus(STATUS_ID, undefined);
    context = undefined;
  });
}
