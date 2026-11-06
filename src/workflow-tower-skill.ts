import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Check } from "typebox/value";
import { BEARS_RESULT_SCHEMA, gameFailureResult } from "./bears-result.js";
import { currentDispatchCheck, withDispatchCheck } from "./game-operation.js";
import type { toolResult } from "./output.js";
import { BLOOD_SKILL, EARTH_SKILL } from "./tower-shield-budget.js";
import type { WorkflowObservations } from "./workflow-observations.js";
import { snapshotId } from "./workflow-result.js";
import { planTowerStep } from "./workflow-tower-step.js";

const parameters = Type.Object(
  {
    snapshotId: snapshotId(),
    policy: Type.Literal("blood-earth-32-60"),
    name: Type.Union([Type.Literal(BLOOD_SKILL), Type.Literal(EARTH_SKILL)]),
  },
  { additionalProperties: false },
);

/** 單筆技能入口；只在既有 Game dispatch hook 重驗，不增加查詢或批准生存。 */
export function registerTowerSkillTool(
  pi: ExtensionAPI,
  store: WorkflowObservations,
  send: (text: string, signal?: AbortSignal) => ReturnType<typeof toolResult>,
) {
  pi.registerTool({
    name: "bears_tower_skill",
    exposure: "codemode",
    label: "星塔單筆策略技能",
    description:
      "依 blood-earth-32-60 策略核對 snapshotId 及明確技能名稱，只送一筆 /skill。連線及既有 before_history 完成後、實際送出前重算策略並核對所有相依來源的 message ID／revision，包含 outgoing。非 ready、改選或缺證時不送出，不自動換招、恢復、補查或重試。回傳原生單筆 receipt，不是生存或操作授權；輸出上限 45 KB/1800 行，可用 originalSourceId 查原文。",
    parameters,
    outputSchema: BEARS_RESULT_SCHEMA,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    promptGuidelines: [
      "bears_tower_skill 只重驗已選策略，不證明安全或授權；呼叫前先核對 bears_history、本人資源、費用、副作用及當手風險。",
      "bears_tower_skill 結果不明時不重試；取得新觀測後另選下一步，不預排連打。",
    ],
    execute(_id, params, signal) {
      let initial: ReturnType<typeof planTowerStep>;
      const generation = store.generation;
      const branchSignal = store.signal;
      const checkPlan = () => {
        const expectedDecision =
          params.name === BLOOD_SKILL ? "blood" : "spring";
        const plan = planTowerStep(store, params.snapshotId);
        if (plan.state !== "ready" || plan.data.decision !== expectedDecision) {
          throw new Error(
            `星塔策略不再符合指定技能；${plan.blockers.join("；") || plan.data.decision || plan.state}`,
          );
        }
        return plan;
      };
      try {
        if (!Check(parameters, params)) {
          throw new Error("星塔技能參數不符合 schema。");
        }
        signal?.throwIfAborted();
        branchSignal.throwIfAborted();
        initial = checkPlan();
      } catch (error) {
        // 此區間尚未呼叫 send；不能將送出後的未明錯誤分類成未送出。
        return gameFailureResult(
          new Error(
            `Action was not dispatched to the bot. ${error instanceof Error ? error.message : String(error)}`,
            { cause: error },
          ),
        );
      }
      const outerCheck = currentDispatchCheck();
      const text = `/skill ${params.name}`;
      return withDispatchCheck(
        (window, action) => {
          outerCheck?.(window, action);
          if (!("text" in action) || action.text !== text) {
            throw new Error("實際動作不是指定的單筆文字技能。");
          }
          signal?.throwIfAborted();
          branchSignal.throwIfAborted();
          if (store.generation !== generation) {
            throw new Error("角色或分支已改變。");
          }
          store.observe(window);
          const fresh = checkPlan();
          if (fresh.actor !== initial.actor) {
            throw new Error("目前角色與入口規劃不同。");
          }
          for (const source of [...initial.sources, ...fresh.sources]) {
            if (
              !window.some(
                (message) =>
                  message.id === source.messageId &&
                  message.revision === source.revision,
              )
            ) {
              throw new Error("最新 before_history 缺少相依來源或來源已修訂。");
            }
          }
        },
        () => send(text, signal),
      );
    },
  });
}
