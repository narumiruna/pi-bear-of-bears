import type {
  ExtensionAPI,
  ExtensionContext,
  Theme,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { type Static, Type } from "typebox";

const WIDGET_ID = "llm-status";
const DEFAULT_TITLE = "目前狀態";
const MAX_TITLE_LENGTH = 60;
const MAX_ITEMS = 8;
const MAX_ITEM_LENGTH = 160;
const MAX_RENDER_LINES = 18;

const UpdateStatusParams = Type.Object({
  title: Type.Optional(
    Type.String({
      description: "面板標題；省略時使用「目前狀態」。",
      maxLength: MAX_TITLE_LENGTH,
    }),
  ),
  items: Type.Array(
    Type.String({
      description: "一項精簡、仍有效且對目前工作有幫助的資訊。",
      minLength: 1,
      maxLength: MAX_ITEM_LENGTH,
    }),
    {
      description: "完整取代面板的項目；依重要性排序。傳空陣列會清除面板。",
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
  return {
    version: 1,
    title: normalizeText(details.title, MAX_TITLE_LENGTH) || DEFAULT_TITLE,
    items: details.items
      .slice(0, MAX_ITEMS)
      .map((item) => normalizeText(item, MAX_ITEM_LENGTH))
      .filter((item) => item.length > 0),
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
    label: "Update Status",
    description:
      "完整更新編輯器上方的工作狀態面板。只保留目前仍有效的目標、重要進度、關鍵事實、阻塞與下一步；items 為空時清除面板。",
    promptSnippet: "主動維護精簡、實用且不含過時資訊的工作狀態面板",
    promptGuidelines: [
      "在多步驟工作開始，以及重要進度、關鍵事實、阻塞或下一步改變時，主動呼叫 update_status；每次提供完整替代內容並移除過時項目。",
      "update_status 只保留對目前工作實用的精簡資訊；工作完成或不再需要面板時，以空 items 清除，不要用它取代一般進度回報。",
    ],
    parameters: UpdateStatusParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      context = ctx;
      const items = params.items
        .map((item) => normalizeText(item, MAX_ITEM_LENGTH))
        .filter((item) => item.length > 0);
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
            text:
              items.length > 0
                ? `狀態面板已更新（${items.length} 項）。`
                : "狀態面板已清除。",
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
