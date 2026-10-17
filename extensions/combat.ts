import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  COMBAT_OBSERVATION_SCHEMA,
  COMBAT_PLAN_SCHEMA,
  planCombat,
} from "../src/combat-planner.js";
import { snapshotId, workflowName } from "../src/workflow-result.js";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "bears_plan_combat",
    exposure: "codemode",
    label: "打王／推塔單步決策",
    description:
      "唯讀計算打王或目前星塔樓層的下一步，不連線、不送指令、不消耗資源。優先以 bears_combat_snapshot 的 snapshotId 綁定原始觀測，風險假設仍由呼叫者提供且未經原文證明；舊版完整觀測輸入僅作條件計算。四組 evidence 需提供最近 60 秒內的訊息 ID、revision 與 Unix 秒時間。risk 的兩個上界必須涵蓋先機及最壞後續傷害，包含命中後觸發狂暴、未命中反擊與完整特殊機制，不能由 ATK 或單次實傷猜測。actions 僅列已確認的傷害招式，明列可用性、完整 MP／HP 成本與傷害預估。回傳建議 tool、預算及停止原因；不驗證來源原文或授權，ready 不是安全保證。",
    parameters: Type.Union([
      COMBAT_OBSERVATION_SCHEMA,
      Type.Object(
        {
          snapshotId: snapshotId(),
          mode: COMBAT_OBSERVATION_SCHEMA.properties.mode,
          target: Type.Optional(workflowName()),
          risk: COMBAT_OBSERVATION_SCHEMA.properties.risk,
          riskEvidence:
            COMBAT_OBSERVATION_SCHEMA.properties.evidence.properties.risk,
        },
        { additionalProperties: false },
      ),
    ]),
    outputSchema: COMBAT_PLAN_SCHEMA,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    promptGuidelines: [
      "先讀 bears_history，再依當前角色、目標、技能及完整機制建立觀測；缺少上界時保留未知，不補零，也不為填參數而試打。",
      "本 tool 是無狀態的單步決策器，不授權或執行操作。只有 ready 才有攻擊候選；執行前仍核對授權及最新訊息 ID／revision，每筆操作後重新觀測。",
      "恢復、逃跑、退出星塔、付費入場及掛機結算另行核對，不將 recover 當作可直接執行的指令。不得以本 tool 建立背景刷王迴圈。",
    ],
    execute(_id, params, signal, _onUpdate, ctx) {
      return Promise.resolve().then(async () => {
        signal?.throwIfAborted();
        let observation: unknown = params;
        if ("snapshotId" in params) {
          const response = await ctx.executeTool(
            "bears_combat_snapshot",
            {
              snapshotId: params.snapshotId,
              mode: params.mode,
              ...(params.target ? { target: params.target } : {}),
            },
            { signal },
          );
          if (response.isError) {
            throw new Error("無法讀取戰鬥快照。");
          }
          const snapshot = response.result.structuredContent as
            | { state?: string; data?: { plannerObservation?: unknown } }
            | undefined;
          if (
            snapshot?.state !== "ready" ||
            !snapshot.data?.plannerObservation
          ) {
            throw new Error("快照缺漏、失效或無法綁定目標；不產生攻擊建議。");
          }
          const bound = snapshot.data.plannerObservation as {
            evidence: Record<string, unknown>;
          };
          observation = {
            ...bound,
            ...(params.risk ? { risk: params.risk } : {}),
            evidence: {
              ...bound.evidence,
              ...(params.riskEvidence ? { risk: params.riskEvidence } : {}),
            },
          };
        }
        signal?.throwIfAborted();
        const result = planCombat(observation);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
          details: result,
          structuredContent: result,
        };
      });
    },
  });
}
