import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function (pi: ExtensionAPI) {
  let pending = false;

  pi.registerCommand("reload-runtime", {
    description:
      "停止目前 Agent 工作後，重新載入 extensions、skills、prompts、themes 與 context files；保留對話，不重啟 Pi process。",
    handler: async (_args, ctx) => {
      if (pending) {
        return;
      }
      pending = true;
      try {
        // Command 與 tool 分開執行，避免等待自己的工具批次而 deadlock。
        await ctx.waitForIdle();
        await ctx.reload();
        // Reload 後舊 runtime 已失效，不再使用原本的 pi 或 ctx。
      } catch (error) {
        pending = false;
        throw error;
      }
    },
  });

  pi.on("turn_end", (_event, ctx) => {
    if (pending) {
      // 先讓整批工具回傳並保存結果，再停止模型與 Goal 的自動續行。
      ctx.abort();
    }
  });

  pi.registerTool({
    name: "reload_runtime",
    exposure: "codemode",
    label: "Reload Pi Runtime",
    description:
      "重新載入 Pi 的 extensions、skills、prompts、themes 與 context files，保留目前對話，不重啟 Pi process。先保存必要的續行資訊；目前工具批次結束後會停止 Agent，且不自動續行。只可單獨呼叫；在 codemode script 中呼叫後立即 return，並結束目前工作。回傳只表示已要求 reload，不代表重新載入已完成；實際結果以 Pi 的 reload 回覆為準。",
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
              text: "已要求重新載入 Pi runtime；目前工具批次結束後會停止 Agent，再執行 reload。此回覆不是完成證明。",
            },
          ],
          details: { status: "queued" },
        };
      });
    },
  });
}
