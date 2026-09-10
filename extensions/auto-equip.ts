import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  AutoEquip,
  type AutoEquipResult,
  formatAutoEquipResult,
} from "../src/auto-equip.js";
import { beginAutoEquip } from "../src/auto-idle-state.js";
import { CHARACTER_MESSAGES_EVENT } from "../src/character-status.js";
import { Game } from "../src/game.js";
import { createTransport } from "../src/telegram.js";

const STATUS_ID = "auto-equip";

export default function (pi: ExtensionAPI) {
  let active: AutoEquip | undefined;
  let context: ExtensionContext | undefined;

  async function run(
    signal?: AbortSignal,
    progress: (message: string) => void = () => {},
  ): Promise<AutoEquipResult> {
    const release = beginAutoEquip();
    const auto = new AutoEquip(
      new Game(createTransport),
      (messages) => pi.events.emit(CHARACTER_MESSAGES_EVENT, messages),
      progress,
    );
    active = auto;
    try {
      return await auto.run(signal);
    } finally {
      auto.stop();
      if (active === auto) active = undefined;
      release();
    }
  }

  async function runCommand(args: string, ctx: ExtensionContext) {
    context = ctx;
    if (args.trim()) {
      if (ctx.hasUI) ctx.ui.notify("用法：/autoequip", "warning");
      return;
    }
    if (!ctx.hasUI)
      throw new Error("/autoequip 需要 TUI 或 RPC UI 才能顯示結果。");
    try {
      ctx.ui.setStatus(STATUS_ID, "⚡ 正在為所有角色一鍵裝備…");
      const result = await run(undefined, (message) =>
        ctx.ui.setStatus(STATUS_ID, `⚡ ${message}`),
      );
      ctx.ui.notify(formatAutoEquipResult(result), "info");
    } catch (error) {
      ctx.ui.notify(
        `Auto Equip 已停止：${error instanceof Error ? error.message : String(error)}`,
        "error",
      );
    } finally {
      ctx.ui.setStatus(STATUS_ID, undefined);
    }
  }

  pi.registerCommand("autoequip", {
    description: "不使用 LLM，切換所有角色並依序執行遊戲內 /autoequip。",
    handler: runCommand,
  });

  pi.registerTool({
    name: "auto_equip_all",
    label: "所有角色一鍵裝備",
    description:
      "切換最多 9 個角色並對每個角色執行遊戲內 /autoequip，最後回到原角色。這會變更裝備，且可能結算掛機。只在使用者明確要求所有角色一鍵裝備時單獨呼叫；不使用其他 tools 並行。直接輸入 /autoequip 可完全不呼叫 LLM。",
    parameters: Type.Object({}, { additionalProperties: false }),
    async execute(_id, _params, signal, onUpdate) {
      const result = await run(signal, (message) =>
        onUpdate?.({
          content: [{ type: "text", text: message }],
          details: { progress: message },
        }),
      );
      return {
        content: [{ type: "text", text: formatAutoEquipResult(result) }],
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
