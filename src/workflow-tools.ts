import type {
  ExtensionAPI,
  ExtensionToolContext,
} from "@earendil-works/pi-coding-agent";
import { type Static, type TSchema, Type } from "typebox";
import { Check } from "typebox/value";
import { assertAutoIdleNotRunning } from "./auto-idle-state.js";
import type { Codex } from "./codex.js";
import { validateWeights } from "./equipment-optimizer.js";
import type { EquipmentSnapshot } from "./equipment-snapshot.js";
import { withGameOperation } from "./game-operation.js";
import { toolResult } from "./output.js";
import {
  equipUpgrade,
  moveTo,
  towerEntryCheck,
  towerRecover,
} from "./workflow-actions.js";
import { combatSnapshot } from "./workflow-combat.js";
import type { WorkflowObservations } from "./workflow-observations.js";
import {
  SCOPE_SCHEMA,
  safeInteger,
  snapshotId,
  WORKFLOW_RESULT_SCHEMA,
  type WorkflowScope,
  workflowName,
  workflowResult,
} from "./workflow-result.js";
import { reconcileRewards } from "./workflow-rewards.js";
import { WorkflowRunner } from "./workflow-runner.js";
import { planUpgrade } from "./workflow-upgrades.js";
import { balanceWallet } from "./workflow-wallet.js";
import type { WorldMap } from "./world.js";

export const WORKFLOW_TOOL_NAMES = [
  "bears_combat_snapshot",
  "bears_reconcile_rewards",
  "bears_tower_recover",
  "bears_move_to",
  "bears_equip_upgrade",
  "bears_tower_entry_check",
  "bears_plan_upgrade",
  "bears_balance_wallet",
] as const;
const weightsSchema = Type.Object(
  {
    attack: Type.Number(),
    defense: Type.Number(),
    intelligence: Type.Number(),
    agility: Type.Number(),
  },
  { additionalProperties: false },
);
const strict = <T extends Record<string, TSchema>>(properties: T) =>
  Type.Object(properties, { additionalProperties: false });
const scopes = { scope: SCOPE_SCHEMA };

export function registerWorkflowTools(
  pi: ExtensionAPI,
  dependencies: {
    store: WorkflowObservations;
    equipment: EquipmentSnapshot;
    world: Pick<WorldMap, "allRooms">;
    codex: Pick<Codex, "lookup">;
  },
) {
  const { store, equipment, world, codex } = dependencies;
  function register<T extends TSchema>(
    name: string,
    description: string,
    parameters: T,
    readOnly: boolean,
    execute: (
      params: Static<T>,
      run: WorkflowRunner,
    ) => unknown | Promise<unknown>,
  ) {
    pi.registerTool({
      name,
      exposure: "codemode",
      label: name,
      description,
      parameters,
      outputSchema: WORKFLOW_RESULT_SCHEMA,
      annotations: {
        readOnlyHint: readOnly,
        destructiveHint: !readOnly,
        idempotentHint: readOnly,
        openWorldHint:
          name !== "bears_combat_snapshot" &&
          name !== "bears_reconcile_rewards",
      },
      promptGuidelines: [
        "先讀 bears_history 並核對目前角色及授權。準備 snapshotId 先用 bears_combat_snapshot；缺項時依 blockers 補查，不要求使用者提供 JSON。",
        "scope 是呼叫者聲明的本次上限，不是授權證明。只在使用者既有授權涵蓋角色、流程、費用與副作用時呼叫執行型 tool；未授權操作不因 tool 可用而允許。",
        "固定流程內由程式逐步核對原文與來源；外層 LLM 不預排其他 Telegram 操作。結果不明、取消、限流、費用或身分不符即停止，不重送或自動回滾。",
      ],
      async execute(_id, params, signal, _onUpdate, ctx: ExtensionToolContext) {
        if (!Check(parameters, params)) {
          throw new Error("流程參數不符合 schema。");
        }
        const checkStrings = (value: unknown): void => {
          if (typeof value === "string" && value !== value.trim()) {
            throw new Error("不接受頭尾空白。");
          }
          if (value && typeof value === "object") {
            Object.values(value).forEach(checkStrings);
          }
        };
        checkStrings(params);
        signal?.throwIfAborted();
        const scope = (params as { scope?: WorkflowScope }).scope;
        const result = workflowResult();
        if (scope) {
          result.data.requestedCharacter = scope.character;
        }
        const operationSignal = AbortSignal.any([
          store.signal,
          ...(signal ? [signal] : []),
          ...(scope ? [AbortSignal.timeout(scope.maxMilliseconds)] : []),
        ]);
        try {
          await withGameOperation(async () => {
            assertAutoIdleNotRunning();
            operationSignal.throwIfAborted();
            const current = store.status();
            if (current) {
              result.actor = current.value.name;
              result.data.lastStatus = current.value;
              result.sources.push(structuredClone(current.source));
            }
            const run = new WorkflowRunner(
              store,
              ctx,
              result,
              scope,
              operationSignal,
            );
            if (scope) {
              const point = store.assertCurrent(
                scope.snapshotId,
                scope.character,
                name === "bears_equip_upgrade" ? 300_000 : 60_000,
              );
              result.sources.push(...point.sources);
              await run.guard(point.sources);
            }
            const value = await execute(params, run);
            if (value) {
              Object.assign(result, value);
            }
          });
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          const unknown =
            result.steps.some((step) => step.state === "outcome_unknown") ||
            /結果不明|outcome is unknown/u.test(detail);
          result.state = unknown ? "outcome_unknown" : "stopped";
          result.blockers.push(detail);
          result.next.push(
            "只在取得新觀測並重新核對授權後另選下一步；不重送不明操作或整批重跑。",
          );
        }
        if (!Check(WORKFLOW_RESULT_SCHEMA, result)) {
          throw new Error("流程輸出不符合 schema。");
        }
        const output = await toolResult(result);
        result.originalSourceId = output.details.bearsOriginal.sourceId;
        return {
          ...output,
          details: { ...output.details, workflow: result },
          structuredContent: JSON.parse(JSON.stringify(result)),
        };
      },
    });
  }
  register(
    "bears_combat_snapshot",
    "本機唯讀整理原始戰鬥觀測與快照識別，不送指令。先取得本人 /status、/look 或 /tower、/skills。未知機制與 runtime 效果保留未知，不由 ATK 或 consider 推上界。快照也供導航、換裝及存款綁定角色與來源。",
    strict({
      mode: Type.Union([Type.Literal("boss"), Type.Literal("tower")]),
      target: Type.Optional(workflowName()),
      snapshotId: Type.Optional(snapshotId()),
    }),
    true,
    (params) =>
      combatSnapshot(store, params.mode, params.target, params.snapshotId),
  );
  register(
    "bears_reconcile_rewards",
    "本機唯讀核對兩份同角色 snapshotId 間已保存的金幣、材料、物品與回執；不結算掛機、不連線。報價／預估不算收入，存款內部轉存不算支出，差額不閉合就回報缺漏。",
    strict({ before: snapshotId(), after: snapshotId() }),
    true,
    (params) => reconcileRewards(store, params.before, params.after),
  );
  register(
    "bears_tower_recover",
    "有限星塔恢復流程：確認挑戰，必要時收刀，確認前庭免費才休息，再查角色、怪血與實際費用。scope 必須涵蓋本次流程。不退出、不重入、不用藥、不開戰。",
    strict(scopes),
    false,
    (_params, run) => towerRecover(run),
  );
  register(
    "bears_move_to",
    "沿公開非 BOSS 路線逐房步行，實際出口與目的地每步核對。scope.maxChanges 限制步數。不停止掛機、不戰鬥、不用傳送券、不付費護送；出口或費用不明就停止。",
    strict({
      ...scopes,
      destination: Type.Union([safeInteger(1), workflowName()]),
    }),
    false,
    (params, run) => moveTo(run, world, params.destination),
  );
  register(
    "bears_equip_upgrade",
    "重用 optimizer 與原始完整背包，每次最多換一件嚴格提升裝備，刷新後重算並核對穿戴。weights 必須完整、固定且有限。未知效果、編號改變、完整費用不明或仍掛機時停止，不自動結算／重啟掛機。",
    strict({ ...scopes, weights: weightsSchema }),
    false,
    (params, run) =>
      equipUpgrade(run, equipment, validateWeights(params.weights)),
  );
  register(
    "bears_tower_entry_check",
    "依序查詢目前角色與當次星塔資格、費用及可選樓層，回傳快照。不切角、不入塔、不退出，不假設每日重置或自動扣款優先序；掛機中不送可能中斷的查詢。",
    strict({
      character: workflowName(),
      floor: Type.Optional(safeInteger(1)),
      freeOnly: Type.Boolean(),
    }),
    true,
    (params, run) =>
      towerEntryCheck(run, params.character, params.floor, params.freeOnly),
  );
  register(
    "bears_plan_upgrade",
    "唯讀比較本人原文選單與公開配方。先取得 /status、/inventory all、/forge、/refine、/craft；計算材料缺口、報價及未知稅費，區分基值／精煉有效值。公開材料來源只是研究，不取得材料、不付款或銷毀物品。",
    strict({
      target: workflowName(),
      metric: Type.Union([
        Type.Literal("attributes"),
        Type.Literal("equipped_power"),
        Type.Literal("combat"),
      ]),
      weights: weightsSchema,
    }),
    true,
    (params, run) =>
      planUpgrade(store, codex, {
        target: params.target,
        metric: params.metric,
        weights: validateWeights(params.weights),
        signal: run.signal,
      }),
  );
  register(
    "bears_balance_wallet",
    "依明確 policy 檢查同角色身上／金庫餘額，最多存款一次再對帳。thresholdPercent 為觸發門檻、targetPercent 為存後本金目標占比，沒有帳號專屬預設。policy.maxDeposit 限制本金、scope.maxGold 限制手續費；費用或入口不明即停止。不提款、不移動、不跨角轉移。",
    strict({
      ...scopes,
      policy: strict({
        thresholdPercent: Type.Integer({ minimum: 1, maximum: 100 }),
        targetPercent: Type.Integer({ minimum: 0, maximum: 99 }),
        maxDeposit: safeInteger(),
      }),
    }),
    false,
    (params, run) => balanceWallet(run, params.policy),
  );
}
