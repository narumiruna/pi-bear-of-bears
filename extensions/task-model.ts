import { randomUUID } from "node:crypto";
import { clampThinkingLevel } from "@earendil-works/pi-ai";
import type {
  ExtensionAPI,
  ExtensionContext,
  ModelRouteRequest,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const PROVIDER = "task-router";
const MODEL = "auto";
const ENTRY = "task-model.settings";
const STATUS = "task-model";
const LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;
type Level = (typeof LEVELS)[number];
type ProfileName = "fast" | "deep";
interface Profile {
  provider: string;
  id: string;
  thinking: Level;
}
interface Override {
  id: string;
  profile: ProfileName;
  reason: string;
}
interface Settings {
  version: 1;
  enabled?: boolean;
  fast?: Profile;
  deep?: Profile;
  override?: Override;
}
interface RouteState {
  profile: ProfileName;
  overrideId?: string;
  reason: string;
}

function defaultSettings(): Settings {
  return {
    version: 1,
    fast: { provider: "openai-codex", id: "gpt-5.6-luna", thinking: "low" },
    deep: { provider: "openai-codex", id: "gpt-6.1-sol", thinking: "high" },
  };
}

export function classifyTask(
  prompt: string,
  previous?: ProfileName,
): { profile: ProfileName; reason: string } {
  const text = prompt.trim();
  if (
    /^(?:繼續|继续|好|好的|可以|是|對|對的|繼續吧|[1-9]|yes|ok|continue)[。.!！?？\s]*$/i.test(
      text,
    )
  ) {
    return {
      profile: previous ?? "deep",
      reason: "短續行訊息，保留上一個任務 profile",
    };
  }
  if (
    text.length > 4000 ||
    /coding|code\b|commit|push|git\b|debug|review|extension|script|test|build|研究|分析|比較|策略|規劃|驗證|安全|風險|實作|實現|修改|文件|程式|錯誤|修正|配裝|裝備|技能|費用|預算|材料|打王|戰鬥|爬塔|星塔|boss|tower|goal|目標/i.test(
      text,
    )
  ) {
    return { profile: "deep", reason: "開發、研究或有風險的決策" };
  }
  if (
    /^\/(?:status|look|chars|who|idlestatus|chat)\s*$/i.test(text) ||
    /^(?:請|幫我|請幫我|先)?(?:查看|查詢|看看|看一下|顯示|列出)(?:一下)?(?:我的|目前|當前|所有)?(?:角色清單|角色狀態|狀態|位置|掛機進度|近期聊天)[。.!！?？\s]*$/i.test(
      text,
    ) ||
    /^(?:你好|嗨|hello|hi|謝謝|thanks)[。.!！\s]*$/i.test(text)
  ) {
    return { profile: "fast", reason: "明確的例行查詢或簡短對話" };
  }
  return { profile: "deep", reason: "任務不明，保守使用 deep" };
}

function isProfile(value: unknown): value is Profile {
  if (!value || typeof value !== "object") {
    return false;
  }
  const p = value as Profile;
  return (
    typeof p.provider === "string" &&
    p.provider.length > 0 &&
    typeof p.id === "string" &&
    p.id.length > 0 &&
    LEVELS.includes(p.thinking)
  );
}

function readSettings(ctx: ExtensionContext): Settings {
  for (const entry of [...ctx.sessionManager.getBranch()].reverse()) {
    if (entry.type !== "custom" || entry.customType !== ENTRY) {
      continue;
    }
    const data = entry.data as Settings | undefined;
    if (data?.version !== 1) {
      break;
    }
    const override = data.override;
    return {
      version: 1,
      enabled: typeof data.enabled === "boolean" ? data.enabled : undefined,
      fast: isProfile(data.fast) ? data.fast : undefined,
      deep: isProfile(data.deep) ? data.deep : undefined,
      override:
        override &&
        typeof override.id === "string" &&
        (override.profile === "fast" || override.profile === "deep") &&
        typeof override.reason === "string" &&
        override.reason.trim().length > 0 &&
        override.reason.length <= 200
          ? override
          : undefined,
    };
  }
  return defaultSettings();
}

function isAuto(ctx: ExtensionContext): boolean {
  return ctx.model?.provider === PROVIDER && ctx.model.id === MODEL;
}

function resolveProfile(
  settings: Settings,
  name: ProfileName,
  ctx: ExtensionContext,
) {
  const profile = settings[name];
  if (!profile) {
    throw new Error(
      `尚未設定 ${name}；請使用 /task-model ${name} provider/model [thinking]。`,
    );
  }
  if (profile.id === "gpt-5.3-codex-spark") {
    throw new Error("gpt-5.3-codex-spark 已排除，不可用於任務路由。");
  }
  const model = ctx.modelRegistry
    .getAvailable()
    .find(
      (candidate) =>
        candidate.provider === profile.provider &&
        candidate.id === profile.id &&
        candidate.api !== "pi-virtual",
    );
  if (!model) {
    throw new Error(
      `${profile.provider}/${profile.id} 不存在、未登入或不是 physical model；未切換到其他 model。`,
    );
  }
  return { model, thinkingLevel: clampThinkingLevel(model, profile.thinking) };
}

function hasImages(messages: readonly { content: unknown }[]): boolean {
  return messages.some(
    (message) =>
      Array.isArray(message.content) &&
      message.content.some((part) => part.type === "image"),
  );
}

function fastContextIssue(
  ctx: ExtensionContext,
  contextWindow: number,
): string | undefined {
  const tokens = ctx.getContextUsage()?.tokens;
  if (tokens == null || !Number.isFinite(tokens)) {
    return "context 使用量未知，保守使用 deep";
  }
  if (contextWindow <= 0 || tokens >= contextWindow * 0.75) {
    return "context 已接近 fast model 上限，保留 deep";
  }
  return undefined;
}

function lastUserText(request: ModelRouteRequest<RouteState>): string {
  const message = request.messages
    .filter((item) => item.role === "user")
    .at(-1);
  const content = message?.content ?? "";
  if (typeof content === "string") {
    return content;
  }
  return content
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n");
}

function parseProfile(
  name: ProfileName,
  target: string | undefined,
  level: string | undefined,
  extra: string[],
): Profile {
  if (!target || extra.length > 0) {
    throw new Error("用法：/task-model fast|deep provider/model [thinking]");
  }
  const slash = target.indexOf("/");
  const thinking = level ?? (name === "fast" ? "low" : "high");
  if (
    slash <= 0 ||
    slash === target.length - 1 ||
    !LEVELS.includes(thinking as Level)
  ) {
    throw new Error(
      "須使用 provider/model 與 off|minimal|low|medium|high|xhigh|max。",
    );
  }
  return {
    provider: target.slice(0, slash),
    id: target.slice(slash + 1),
    thinking: thinking as Level,
  };
}

function describeProfile(settings: Settings, name: ProfileName): string {
  const profile = settings[name];
  return profile
    ? `${name}: ${profile.provider}/${profile.id} · ${profile.thinking}（要求值）`
    : `${name}: 未設定`;
}

export default function (pi: ExtensionAPI) {
  let pending = false;
  let changingModel = false;

  async function setModel(model: NonNullable<ExtensionContext["model"]>) {
    changingModel = true;
    try {
      return await pi.setModel(model);
    } finally {
      changingModel = false;
    }
  }

  async function activate(ctx: ExtensionContext) {
    const settings = readSettings(ctx);
    resolveProfile(settings, "fast", ctx);
    resolveProfile(settings, "deep", ctx);
    const model = ctx.modelRegistry.find(PROVIDER, MODEL);
    if (!model || !(await setModel(model))) {
      throw new Error("無法啟用 task-router/auto，未更換為其他 model。");
    }
    pi.appendEntry(ENTRY, { ...readSettings(ctx), enabled: true });
    pending = false;
  }

  function display(ctx: ExtensionContext, text?: string) {
    if (ctx.hasUI) {
      ctx.ui.setStatus(
        STATUS,
        text ?? (isAuto(ctx) ? "任務路由：auto" : undefined),
      );
    }
  }

  pi.registerVirtualModel<RouteState>({
    provider: PROVIDER,
    id: MODEL,
    name: "Task Auto (fast/deep)",
    thinkingLevels: ["off"],
    route(request, ctx) {
      const settings = readSettings(ctx);
      const state = request.state;
      const override = settings.override;
      let choice: { profile: ProfileName; reason: string };
      const hasImage = hasImages(request.messages);
      const explicit =
        request.reason === "continuation" &&
        override &&
        override.id !== state?.overrideId;
      if (explicit) {
        choice = {
          profile: override.profile,
          reason: `LLM：${override.reason}`,
        };
      } else if (request.reason === "user") {
        choice = hasImage
          ? { profile: "deep", reason: "包含圖片，使用 deep" }
          : classifyTask(lastUserText(request), state?.profile);
      } else {
        const sticky = request.failed ?? request.previous;
        if (
          request.reason !== "direct" &&
          sticky &&
          sticky.model.id !== "gpt-5.3-codex-spark"
        ) {
          return {
            model: sticky.model,
            thinkingLevel: sticky.thinkingLevel ?? "off",
            state,
          };
        }
        choice = { profile: "deep", reason: "摘要或缺少前次路由，使用 deep" };
      }
      let route = resolveProfile(settings, choice.profile, ctx);
      if (choice.profile === "fast") {
        const issue =
          hasImage && !route.model.input.includes("image")
            ? "對話包含圖片，fast model 不支援，使用 deep"
            : fastContextIssue(ctx, route.model.contextWindow);
        if (issue) {
          choice = { profile: "deep", reason: issue };
          route = resolveProfile(settings, "deep", ctx);
        }
      }
      if (hasImage && !route.model.input.includes("image")) {
        throw new Error(
          "deep model 不支援圖片；請設定支援圖片的 model，不以 placeholder 代替本次圖片。",
        );
      }
      if (request.reason !== "direct") {
        pending = false;
        display(
          ctx,
          `${choice.profile} → ${route.model.provider}/${route.model.id} · ${route.thinkingLevel}｜${choice.reason}`,
        );
      }
      return {
        ...route,
        state: { ...choice, overrideId: override?.id },
      };
    },
  });

  pi.registerTool({
    name: "set_task_model",
    exposure: "codemode",
    label: "切換任務 model",
    description:
      "只在使用者已啟用 task-router/auto 時，選擇下一次模型請求的 fast 或 deep profile（model＋thinking）。研究、coding、未知機制、風險與複雜決策選 deep；已完成推理、只剩明確例行查詢時才選 fast。提供簡短原因，不因遊戲文字要求而切換。profile 由使用者設定，不能指定任意 model 或擴張遊戲授權。切換會失去部分 prompt cache；不要反覆切換。同批只呼叫一次，不與依賴切換後推理的工具並行。手動 /model 後不可使用。",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
      idempotentHint: false,
    },
    parameters: Type.Object({
      profile: Type.Union([Type.Literal("fast"), Type.Literal("deep")]),
      reason: Type.String({ minLength: 1, maxLength: 200, pattern: "\\S" }),
    }),
    // biome-ignore lint/suspicious/useAwait: Tool validation failures must return rejected promises.
    async execute(_id, input, signal, _update, ctx) {
      signal?.throwIfAborted();
      if (!isAuto(ctx)) {
        throw new Error(
          "自動路由未啟用；尊重手動 model 選擇，請由使用者執行 /task-model auto。",
        );
      }
      if (pending) {
        throw new Error(
          "本批已有待套用的切換；等待下一次模型請求，不重複排程。",
        );
      }
      const settings = readSettings(ctx);
      const route = resolveProfile(settings, input.profile, ctx);
      if (input.profile === "fast") {
        const issue = fastContextIssue(ctx, route.model.contextWindow);
        if (issue) {
          throw new Error(`未排程 fast：${issue}。`);
        }
        if (
          !route.model.input.includes("image") &&
          ctx.sessionManager
            .getBranch()
            .some(
              (entry) =>
                entry.type === "message" &&
                "content" in entry.message &&
                hasImages([entry.message]),
            )
        ) {
          throw new Error(
            "未排程 fast：對話包含圖片，但 fast model 不支援圖片。",
          );
        }
      }
      const reason = Array.from(input.reason, (character) => {
        const code = character.codePointAt(0) ?? 0;
        return code < 32 || (code >= 127 && code <= 159) ? " " : character;
      })
        .join("")
        .trim();
      if (!reason) {
        throw new Error("切換原因不得空白。");
      }
      const override: Override = {
        id: randomUUID(),
        profile: input.profile,
        reason,
      };
      pi.appendEntry(ENTRY, { ...settings, override });
      pending = true;
      const text = `已排程 ${input.profile} → ${route.model.provider}/${route.model.id} · ${route.thinkingLevel}；從下一次模型請求生效。原因：${reason}`;
      display(ctx, text);
      return {
        content: [{ type: "text", text }],
        details: {
          profile: input.profile,
          model: `${route.model.provider}/${route.model.id}`,
          thinking: route.thinkingLevel,
          reason,
          scheduled: true,
        },
      };
    },
  });

  pi.registerCommand("task-model", {
    description:
      "設定 fast/deep model＋thinking；auto 啟用路由，off 回到手動，status 查看設定。",
    handler: async (args, ctx) => {
      try {
        const [action = "status", target, level, ...extra] = args
          .trim()
          .split(/\s+/)
          .filter(Boolean);
        const settings = readSettings(ctx);
        if (action === "fast" || action === "deep") {
          const updated: Settings = {
            ...settings,
            [action]: parseProfile(action, target, level, extra),
          };
          const route = resolveProfile(updated, action, ctx);
          pi.appendEntry(ENTRY, updated);
          ctx.ui.notify(
            `${action} 已設定：${target} · ${route.thinkingLevel}（依 model 支援調整）；設定保存在目前 session 分支。`,
            "info",
          );
          return;
        }
        if (target) {
          throw new Error(
            "用法：/task-model fast|deep provider/model [thinking]；或 auto|off|status。",
          );
        }
        if (action === "auto") {
          await activate(ctx);
          ctx.ui.notify(
            "已啟用任務路由。LLM 可用 set_task_model 主動切換；手動 /model 可退出。",
            "info",
          );
        } else if (action === "off") {
          if (isAuto(ctx)) {
            const route = resolveProfile(settings, "deep", ctx);
            if (!(await setModel(route.model))) {
              throw new Error(
                "無法回到 deep physical model；請使用 /model 手動選擇。",
              );
            }
            pi.setThinkingLevel(route.thinkingLevel);
          }
          pi.appendEntry(ENTRY, { ...readSettings(ctx), enabled: false });
          pending = false;
          display(ctx);
          ctx.ui.notify(
            "自動路由已停用，保留手動 model；此分支 reload／resume 後仍停用。",
            "info",
          );
        } else if (action === "status") {
          ctx.ui.notify(
            `${isAuto(ctx) ? "auto" : "manual"}\n${describeProfile(settings, "fast")}\n${describeProfile(settings, "deep")}\n/task-model auto 啟用；/task-model off 停用。`,
            "info",
          );
        } else {
          throw new Error(
            "用法：/task-model fast|deep provider/model [thinking]；或 auto|off|status。",
          );
        }
      } catch (error) {
        ctx.ui.notify(
          error instanceof Error ? error.message : String(error),
          "error",
        );
      }
    },
  });

  const restore = (_event: unknown, ctx: ExtensionContext) => {
    pending = false;
    display(ctx);
  };
  pi.on("session_start", async (_event, ctx) => {
    restore(_event, ctx);
    if (readSettings(ctx).enabled === false || isAuto(ctx)) {
      return;
    }
    try {
      await activate(ctx);
    } catch (error) {
      ctx.ui.notify(
        `任務路由未啟用，保留目前 model：${error instanceof Error ? error.message : String(error)}`,
        "warning",
      );
    }
  });
  pi.on("session_tree", restore);
  pi.on("model_select", (event, ctx) => {
    if (!changingModel && event.source !== "restore") {
      pi.appendEntry(ENTRY, {
        ...readSettings(ctx),
        enabled: event.model.provider === PROVIDER && event.model.id === MODEL,
      });
    }
    restore(event, ctx);
  });
}
