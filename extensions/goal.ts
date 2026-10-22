import { createHash, randomUUID } from "node:crypto";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

const ENTRY = "goal.state";
const MESSAGE = "goal.contract";
const LOOP_LIMIT = 3;

type GoalStatus = "active" | "paused" | "completed" | "stopped";
interface GoalState {
  version: 1;
  id: string;
  objectives: string;
  status: GoalStatus;
}

function parseState(value: unknown): GoalState | undefined {
  if (!value || typeof value !== "object") {
    return;
  }
  const state = value as Partial<GoalState>;
  if (
    state.version === 1 &&
    typeof state.id === "string" &&
    /^[a-f0-9-]{36}$/.test(state.id) &&
    typeof state.objectives === "string" &&
    state.objectives.trim() &&
    ["active", "paused", "completed", "stopped"].includes(state.status ?? "")
  ) {
    return { ...state } as GoalState;
  }
}

function contract(goal: GoalState): string {
  return [
    `使用者透過 /goal 設定的目標（ID：${goal.id}）：`,
    goal.objectives,
    "請核對驗收條件與已取得的證據，繼續完成尚未完成的部分，不以計畫或進度摘要代替實作。",
    "此目標不擴張操作授權，也不覆蓋安全規則、使用者後續限制或取消要求。使用者最新要求先修正程式或流程時，先完成該工作；不得因本契約而搶先恢復原操作。",
    "仍有安全且已授權的下一步時，直接執行，不只回報後結束。",
    `全部驗收條件已滿足時，先列出完成證據，再將 [goal:complete:${goal.id}] 放在最終回覆的獨立末行。`,
    "目標未完成時，Agent 不得自行暫停、放棄或以階段摘要結束目標；pause／blocked 等標記不會停止自動續行。只有使用者能主動停止目標。runtime 會在連續三次沒有成功工具執行或重複相同回覆時暫停自動重送，保留未完成目標；這不是完成驗收，也不是所有候選不可行的判定，不得為重設計數而製造工具活動。",
    "遇到局部缺口，將阻礙綁定到具體候選與操作，只核對該候選決策所需的證據；不得把不適用的高風險路線前提追加給其他候選。區分受影響與未受影響的操作，優先獨立評估較低難度、較低收益但有本人實際收益的已授權路線，不只追求直接完成最終門檻的候選。",
    "已知安全流程可作候選依據，再核當前身分、資源、目標與適用條件；歷史成功或較低難度本身不保證安全，不猜未知傷害或費用，也不為取得完整遊戲公式而排除不依賴該公式的行動。不要求使用者重複授權或代做危險測試。",
    "機率性收益可依合理預期效益作為達標手段，不要求每次必得或立即提升；單次未取得目標成果，不代表路線無效。仍須符合原授權與安全條件，分開記錄預期機會、實際執行、實際所得與最終驗收，不將預期當成已取得。",
    "既有候選受阻不代表全域受阻；比較其他來源、路線或可獨立完成的部分，不反覆查相同負面來源，也不把研究或文件更新當作目標進展。",
    "前次已回報無新增操作、未找到安全下一步時，下次不得只重述該結論；換句話承認空轉也不是新行動。先選不同具體候選及必要核驗，再依結果執行安全操作；若仍無法提出，明示這是未找到下一步的決策失敗，不把『未證明全域不可行』當作反覆結束回覆的理由，也不得為製造工具活動而重查或盲動。",
    "若所有剩餘操作確實依賴使用者輸入或外部事件，如實列出證據、具體問題與可恢復條件；不得假造完成、擴張授權、盲目操作、輪詢、空轉或自行建立背景工作。使用者可用 /goal-stop 停止自動續行。",
    "完成標記只供全部驗收通過後的最終狀態回報，不要在範例、引文或中途回覆中輸出。",
  ].join("\n");
}

export default function (pi: ExtensionAPI) {
  let goal: GoalState | undefined;
  let toolExecuted = false;
  let toolFreeSettlements = 0;
  let lastReplyHash: string | undefined;
  let repeatedReplies = 0;

  function resetGuard() {
    toolExecuted = false;
    toolFreeSettlements = 0;
    lastReplyHash = undefined;
    repeatedReplies = 0;
  }

  function display(ctx: ExtensionContext) {
    if (ctx.hasUI) {
      ctx.ui.setStatus("goal", goal ? `goal: ${goal.status}` : undefined);
    }
  }

  function save(ctx: ExtensionContext, status: GoalStatus) {
    if (!goal) {
      return;
    }
    goal = { ...goal, status };
    pi.appendEntry(ENTRY, goal);
    display(ctx);
  }

  function restore(ctx: ExtensionContext) {
    resetGuard();
    goal = undefined;
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type === "custom" && entry.customType === ENTRY) {
        goal = parseState(entry.data);
      }
    }
    // 還原只恢復資料，不將歷史契約當成重新啟動工作的授權。
    if (goal?.status === "active") {
      save(ctx, "paused");
    } else {
      display(ctx);
    }
  }

  function start(ctx: ExtensionContext) {
    if (!goal) {
      return;
    }
    resetGuard();
    save(ctx, "active");
    try {
      pi.sendMessage(
        { customType: MESSAGE, content: contract(goal), display: true },
        { triggerTurn: true },
      );
    } catch (error) {
      save(ctx, "paused");
      throw error;
    }
  }

  pi.registerCommand("goal", {
    description: "設定並執行目標：/goal <objectives>；不帶參數查看目前狀態",
    handler: (args, ctx) =>
      Promise.resolve().then(() => {
        const objectives = args.trim();
        if (!objectives) {
          ctx.ui.notify(
            goal
              ? `${goal.status}\n${goal.objectives}`
              : "用法：/goal <objectives>",
            "info",
          );
          return;
        }
        if (!ctx.isIdle()) {
          ctx.ui.notify("請先取消或等待目前工作結束，再設定目標。", "warning");
          return;
        }
        goal = { version: 1, id: randomUUID(), objectives, status: "active" };
        start(ctx);
      }),
  });

  pi.registerCommand("goal-stop", {
    description: "停止目標自動續行；不取消目前執行中的操作",
    handler: (_args, ctx) =>
      Promise.resolve().then(() => {
        save(ctx, "stopped");
        ctx.ui.notify(
          "目標自動續行已停止；要取消目前操作請按 Escape。",
          "info",
        );
      }),
  });

  pi.registerCommand("goal-resume", {
    description: "明確恢復已暫停的目標",
    handler: (_args, ctx) =>
      Promise.resolve().then(() => {
        if (goal?.status !== "paused" || !ctx.isIdle()) {
          ctx.ui.notify(
            "只能在閒置時恢復已暫停的目標；新目標請用 /goal。",
            "warning",
          );
          return;
        }
        start(ctx);
      }),
  });

  // 重送可能再次啟動 Agent；此處不可清零，否則同樣回覆永遠累計不到三次。
  // 只在明確啟動／恢復目標或 session 還原／關閉時重設保護計數。
  pi.on("before_agent_start", () => {
    if (goal?.status !== "active") {
      return;
    }
    return {
      message: { customType: MESSAGE, content: contract(goal), display: false },
    };
  });

  pi.on("tool_execution_end", (event) => {
    if (goal?.status === "active" && !event.isError && !event.result?.isError) {
      // 包含 codemode 的 nested calls。工具執行只是活動訊號，不證明目標進展。
      toolExecuted = true;
    }
  });

  pi.on("agent_before_settle", (event, ctx) => {
    if (goal?.status !== "active") {
      return;
    }
    if (event.outcome !== "completed" || ctx.signal?.aborted) {
      save(ctx, "paused");
      return;
    }
    // 不在其他 extension 已請求續行或有待送訊息時提早接受完成標記。
    if (event.continue || event.context.pendingMessages.length > 0) {
      return;
    }
    const messages = event.context.contextMessages;
    let lastIndex = messages.length - 1;
    // 前置 boundary handler 的 custom 訊息可位於回覆後；不跨 user/toolResult。
    while (lastIndex >= 0 && messages[lastIndex]?.role === "custom") {
      lastIndex--;
    }
    const message = messages[lastIndex];
    let reply = "";
    if (message?.role === "assistant" && message.stopReason === "stop") {
      const text = message.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n")
        .trim();
      const lastLine = text.split("\n").at(-1);
      if (lastLine === `[goal:complete:${goal.id}]`) {
        save(ctx, "completed");
        return;
      }
      reply = text.replace(/\s+/g, " ");
    }
    toolFreeSettlements = toolExecuted ? 0 : toolFreeSettlements + 1;
    toolExecuted = false;
    const replyHash = reply
      ? createHash("sha256").update(reply).digest("hex")
      : undefined;
    repeatedReplies =
      replyHash && replyHash === lastReplyHash
        ? repeatedReplies + 1
        : replyHash
          ? 1
          : 0;
    lastReplyHash = replyHash;
    if (toolFreeSettlements >= LOOP_LIMIT || repeatedReplies >= LOOP_LIMIT) {
      const reason =
        toolFreeSettlements >= LOOP_LIMIT
          ? `連續 ${LOOP_LIMIT} 次結算沒有成功工具執行`
          : `連續 ${LOOP_LIMIT} 次結算回覆相同（忽略空白差異）`;
      save(ctx, "paused");
      const notice = `Goal 循環保護：${reason}，已暫停自動重送契約，保留未完成目標。這不是完成或全域不可行判定。請先改善候選決策／流程；確認有不同且安全的下一步後，可用 /goal-resume 明確恢復。`;
      if (ctx.hasUI) {
        ctx.ui.notify(notice, "warning");
      }
      return {
        entries: [
          ...event.entries,
          {
            type: "custom_message" as const,
            customType: "goal.loop-guard",
            content: notice,
            display: true,
          },
        ],
        continue: false,
      };
    }
    return {
      entries: [
        ...event.entries,
        {
          type: "custom_message" as const,
          customType: MESSAGE,
          content: contract(goal),
          display: false,
        },
      ],
      continue: true,
    };
  });

  // settled 僅作通知／收尾，絕不從此事件發送訊息重啟 Agent。
  pi.on("agent_settled", (event, ctx) => {
    if (goal?.status === "active" && event.aborted) {
      save(ctx, "paused");
    }
  });
  pi.on("session_start", (_event, ctx) => restore(ctx));
  pi.on("session_tree", (_event, ctx) => restore(ctx));
  pi.on("session_shutdown", () => {
    resetGuard();
    goal = undefined;
  });
}
