import type {
  ExtensionAPI,
  ExtensionContext,
  Theme,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { type Static, Type } from "typebox";

const WIDGET_ID = "llm-status";
const DEFAULT_TITLE = "遊戲狀態";
const MAX_TITLE_LENGTH = 60;
const MAX_ITEMS = 8;
const MAX_ITEM_LENGTH = 160;
const MAX_RENDER_LINES = 18;

const UpdateStatusParams = Type.Object({
  title: Type.Optional(
    Type.String({
      description:
        "面板標題；可依當下遊玩情境自由命名，省略時使用「遊戲狀態」。",
      maxLength: MAX_TITLE_LENGTH,
    }),
  ),
  items: Type.Array(
    Type.String({
      description: "一項從遊玩過程挑選、對後續遊玩有用的資訊；內容與格式不限。",
      minLength: 1,
      maxLength: MAX_ITEM_LENGTH,
    }),
    {
      description:
        "完整取代面板的遊戲資訊；只留下最新且有用的項目，依重要性排序。",
      minItems: 1,
      maxItems: MAX_ITEMS,
    },
  ),
});

export type UpdateStatusInput = Static<typeof UpdateStatusParams>;

interface StatusDetails {
  version: 1;
  title: string;
  items: string[];
}

function normalizeText(value: string, maxLength: number): string {
  const printable = Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint < 32 || (codePoint >= 127 && codePoint <= 159)
      ? " "
      : character;
  }).join("");
  return Array.from(printable.replace(/\s+/g, " ").trim())
    .slice(0, maxLength)
    .join("");
}

function parseStatusDetails(value: unknown): StatusDetails | undefined {
  if (!value || typeof value !== "object") return undefined;
  const details = value as Partial<StatusDetails>;
  if (
    details.version !== 1 ||
    typeof details.title !== "string" ||
    !Array.isArray(details.items) ||
    !details.items.every((item) => typeof item === "string")
  )
    return undefined;
  const items = details.items
    .slice(0, MAX_ITEMS)
    .map((item) => normalizeText(item, MAX_ITEM_LENGTH))
    .filter((item) => item.length > 0);
  if (items.length === 0) return undefined;
  return {
    version: 1,
    title: normalizeText(details.title, MAX_TITLE_LENGTH) || DEFAULT_TITLE,
    items,
  };
}

function renderStatusWidget(
  status: StatusDetails,
  width: number,
  theme: Pick<Theme, "fg" | "bold">,
): string[] {
  if (width < 1) return [];
  const border = theme.fg("borderMuted", "─".repeat(width));
  const content: string[] = [];
  const add = (text: string) => {
    for (const line of wrapTextWithAnsi(text, width))
      content.push(truncateToWidth(line, width));
  };

  add(theme.fg("accent", theme.bold(`◆ ${status.title}`)));
  for (const item of status.items) add(`${theme.fg("muted", "•")} ${item}`);

  if (content.length > MAX_RENDER_LINES - 2) {
    content.splice(MAX_RENDER_LINES - 3);
    content.push(truncateToWidth(theme.fg("dim", "…其餘資訊已截短"), width));
  }
  return [border, ...content, border];
}

export default function (pi: ExtensionAPI) {
  let context: ExtensionContext | undefined;
  let status: StatusDetails | undefined;

  function display() {
    const ctx = context;
    if (!ctx?.hasUI) return;
    if (!status || status.items.length === 0) {
      ctx.ui.setWidget(WIDGET_ID, undefined);
      return;
    }
    const current = status;
    if (ctx.mode === "tui") {
      ctx.ui.setWidget(
        WIDGET_ID,
        (_tui, theme) => ({
          render: (width) => renderStatusWidget(current, width, theme),
          invalidate() {},
        }),
        { placement: "aboveEditor" },
      );
      return;
    }
    ctx.ui.setWidget(
      WIDGET_ID,
      renderStatusWidget(current, 72, {
        fg: (_color, text) => text,
        bold: (text) => text,
      }),
      { placement: "aboveEditor" },
    );
  }

  function reconstruct(ctx: ExtensionContext) {
    context = ctx;
    status = undefined;
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type !== "message") continue;
      const message = entry.message;
      if (message.role !== "toolResult" || message.toolName !== "update_status")
        continue;
      const restored = parseStatusDetails(message.details);
      if (restored) status = restored;
    }
    display();
  }

  pi.registerTool({
    name: "update_status",
    label: "Update Game Status",
    description:
      "完整更新編輯器上方的遊戲狀態面板。從遊玩過程陸續收到的資訊中，自由挑選對後續遊玩有用的內容；不要求固定欄位，也不必收錄所有資訊。只保留最新狀態，最多 8 項，不清除面板。",
    promptSnippet: "從遊玩過程中彈性挑選有用資訊，維護精簡的遊戲狀態面板",
    promptGuidelines: [
      "遊玩過程中透過 bears tools 陸續取得新資訊時，挑選對後續遊玩有用的內容並主動呼叫 update_status；保留 title 與 items 的彈性，不限制固定欄位，也不必收錄所有資訊。",
      "每次呼叫 update_status 都要提供完整替代內容，只留下最新且仍有用的項目，最多 8 項；無法確認仍有效的資訊須標示為最後觀測或可能過期，不得表述成已確認的即時狀態。",
      "update_status 只整理遊戲資訊，不記錄 coding 工作進度；不要清除面板，單次工作結束後仍保留最後的遊戲狀態。",
    ],
    parameters: UpdateStatusParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      context = ctx;
      const items = params.items
        .map((item) => normalizeText(item, MAX_ITEM_LENGTH))
        .filter((item) => item.length > 0);
      if (items.length === 0)
        throw new Error("遊戲狀態至少要保留一項最新且有用的資訊。");
      status = {
        version: 1,
        title:
          normalizeText(params.title ?? "", MAX_TITLE_LENGTH) || DEFAULT_TITLE,
        items,
      };
      display();
      return {
        content: [
          {
            type: "text",
            text: `遊戲狀態面板已更新（${items.length} 項）。`,
          },
        ],
        details: status,
      };
    },
  });

  pi.on("session_start", (_event, ctx) => reconstruct(ctx));
  pi.on("session_tree", (_event, ctx) => reconstruct(ctx));

  pi.on("session_shutdown", () => {
    if (context?.hasUI) context.ui.setWidget(WIDGET_ID, undefined);
    context = undefined;
    status = undefined;
  });
}
