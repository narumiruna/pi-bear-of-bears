import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  armReload,
  claimReload,
  type ReloadContinuation,
  type ReloadHandoff,
  reloadBranchMatches,
  reloadGoal,
} from "../src/runtime-reload-handoff.js";

export default function (pi: ExtensionAPI) {
  let pending = false;
  let cancelled = false;
  let generation = 0;

  pi.on("input", (event) => {
    if (event.source !== "extension") {
      cancelled = true;
      generation++;
    }
  });
  pi.on("agent_settled", (event) => {
    if (event.aborted) {
      cancelled = true;
    }
  });
  pi.on("session_tree", () => {
    cancelled = true;
    generation++;
  });
  pi.on("session_shutdown", (event) => {
    generation++;
    if (event.reason !== "reload") {
      cancelled = true;
    }
  });
  pi.on("session_start", (event, ctx) => {
    if (event.reason !== "reload") {
      return;
    }
    const ticket = claimReload(ctx);
    if (!ticket) {
      return;
    }
    const currentGeneration = generation;
    // session_start在ctx.reload()完成前發生；不能await ticket，否則互相等待。
    void ticket.result
      .then((success) => {
        if (
          !success ||
          cancelled ||
          generation !== currentGeneration ||
          !ctx.isIdle() ||
          !reloadBranchMatches(ticket, ctx)
        ) {
          return;
        }
        if (ticket.goalId) {
          const request: ReloadContinuation = {
            goalId: ticket.goalId,
            context: ctx,
            resumed: false,
          };
          pi.events.emit("runtime:reload-continue", request);
          if (!request.resumed) {
            return;
          }
        } else {
          const goal = reloadGoal(ctx);
          if (
            goal?.id !== ticket.passiveGoal?.id ||
            goal?.status !== ticket.passiveGoal?.status
          ) {
            return;
          }
        }
        // 只使用reload後新runtime的API；不派送slash command或重送舊工具。
        pi.sendUserMessage(
          "continue\n[reload-runtime 自動續行] 重新載入已完成。請依最新使用者要求及限制續行；先重驗身分、狀態與操作資格，不沿用reload前的暫時效果，不重送結果不明的操作。未經本次交接恢復的 paused／stopped／completed Goal 保持原狀，不得藉此恢復舊目標。",
          { deliverAs: "followUp" },
        );
      })
      .catch((error: unknown) => {
        // 派送結果不明時不重試，亦不讓背景Promise產生未處理拒絕。
        if (generation !== currentGeneration) {
          return;
        }
        try {
          pi.events.emit("runtime:reload-continue-failed", {
            context: ctx,
            goalId: ticket.goalId,
          });
          if (ctx.hasUI) {
            ctx.ui.notify(`Reload後續行失敗：${String(error)}`, "error");
          }
        } catch {
          // 新runtime若也已失效，不使用舊API重試或覆蓋取消狀態。
        }
      });
  });

  pi.registerCommand("reload-runtime", {
    description:
      "目前 Agent 工作正常結束後，重新載入 extensions、skills、prompts、themes 與 context files；保留對話，不重啟 Pi process。",
    handler: async (_args, ctx) => {
      if (pending) {
        return;
      }
      pending = true;
      cancelled = false;
      const sessionId = ctx.sessionManager.getSessionId();
      const originalGoal = reloadGoal(ctx);
      let ticket: ReloadHandoff | undefined;
      try {
        pi.events.emit("runtime:reload-pending", true);
        // 不用abort假裝正常結束；保留工具結果及正常收尾，再於idle更換runtime。
        await ctx.waitForIdle();
        if (ctx.sessionManager.getSessionId() !== sessionId) {
          throw new Error("Reload已取消：目前session已切換。");
        }
        const currentGoal = reloadGoal(ctx);
        const goalUnchanged =
          originalGoal?.id === currentGoal?.id &&
          (originalGoal?.status === "active"
            ? currentGoal?.status === "paused" ||
              currentGoal?.status === "active"
            : originalGoal?.status === currentGoal?.status);
        if (!cancelled && goalUnchanged) {
          ticket = armReload(
            ctx,
            originalGoal?.status === "active" ? originalGoal.id : undefined,
          );
        }
        await ctx.reload();
        // 舊runtime已失效；此處只完成plain ticket，不使用舊pi/context。
        ticket?.finish(!cancelled);
      } catch (error) {
        ticket?.finish(false);
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
      "重新載入 Pi 的 extensions、skills、prompts、themes 與 context files，保留目前對話，不重啟 Pi process。先保存必要的續行資訊；目前工作正常收尾後才 reload，等待中不執行新工具；成功 reload 後由新 runtime 自動送出一次 continue，續行仍須重新核驗狀態與授權。取消、切換 session／分支、等待期間 Goal 被停止或 reload 失敗時不自動續行。只可單獨呼叫；在 codemode script 中呼叫後立即 return，並結束目前工作。回傳只表示已要求 reload，不代表重新載入已完成；實際結果以 Pi 的 reload 回覆為準。",
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
