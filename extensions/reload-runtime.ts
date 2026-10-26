import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function (pi: ExtensionAPI) {
  let pending = false;

  pi.registerCommand("reload-runtime", {
    description:
      "目前 Agent 工作正常結束後，重新載入 extensions、skills、prompts、themes 與 context files；保留對話，不重啟 Pi process。",
    handler: async (_args, ctx) => {
      if (pending) {
        return;
      }
      pending = true;
      try {
        pi.events.emit("runtime:reload-pending", true);
        // 不用abort假裝正常結束；保留工具結果及正常收尾，再於idle更換runtime。
        await ctx.waitForIdle();
        await ctx.reload();
        // Reload 後舊 runtime 已失效，不再使用原本的 pi 或 ctx。
      } catch (error) {
        pending = false;
        try {
          pi.events.emit("runtime:reload-pending", false);
        } catch {
          // Reload可能已失效舊runtime；清理失敗不得覆蓋真正的reload錯誤。
        }
        throw error;
      }
    },
  });

  pi.on("tool_call", () => {
    if (pending) {
      // Codemode目前不轉送nested terminate；若模型不以文字收尾，阻擋新工具並正常結束批次。
      return {
        block: true,
        terminate: true,
        reason: "已要求reload，等待目前工作正常結束；不執行新工具。",
      };
    }
  });
  pi.on("agent_before_settle", () => {
    if (pending) {
      return { continue: false };
    }
  });

  pi.registerTool({
    name: "reload_runtime",
    exposure: "codemode",
    label: "Reload Pi Runtime",
    description:
      "重新載入 Pi 的 extensions、skills、prompts、themes 與 context files，保留目前對話，不重啟 Pi process。先保存必要的續行資訊；目前工作正常收尾後才 reload，等待中不執行新工具，且不自動續行。只可單獨呼叫；在 codemode script 中呼叫後立即 return，並結束目前工作。回傳只表示已要求 reload，不代表重新載入已完成；實際結果以 Pi 的 reload 回覆為準。",
    parameters: Type.Object({}, { additionalProperties: false }),
    execute(_toolCallId, _params, signal) {
      return Promise.resolve().then(() => {
        signal?.throwIfAborted();
        if (!pending) {
          // 必須明確啟用 command dispatch，否則只會把 slash command 送給模型。
          pi.sendUserMessage("/reload-runtime", {
            deliverAs: "followUp",
            expandPromptTemplates: true,
          });
        }
        return {
          content: [
            {
              type: "text" as const,
              text: "已要求重新載入 Pi runtime；請直接結束本回合，不再呼叫工具。工作正常結束後才執行reload，不取消目前操作。此回覆不是完成證明。",
            },
          ],
          details: { status: "queued" },
          terminate: true,
        };
      });
    },
  });
}
