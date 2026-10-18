import type {
  ExtensionAPI,
  ExtensionContext,
  Theme,
} from "@earendil-works/pi-coding-agent";
import { Key, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { type Static, Type } from "typebox";

const WIDGET_ID = "llm-status";
const STATUS_ENTRY = "bears.status";
const DEFAULT_TITLE = "遊戲狀態";
const MAX_TITLE_LENGTH = 60;
const MAX_ITEMS = 8;
const MAX_ITEM_LENGTH = 160;
const MAX_RENDER_LINES = 10;

const UpdateStatusParams = Type.Object({
  title: Type.Optional(
    Type.String({
      description:
        "簡短面板標題；已確認目前操作角色時，明示角色名稱，可附職業或主要目標。角色不明時不得猜測；省略時使用「遊戲狀態」。",
      maxLength: MAX_TITLE_LENGTH,
    }),
  ),
  items: Type.Array(
    Type.String({
      description:
        "一項會影響後續遊玩的資訊，只說一個主題，建議使用「自由標籤：內容」。已在標題確認目前角色時，本角項目不重複角色名稱；跨角色或全體資訊另標歸屬。使用完整物品名稱、必要單位與時效說明，不壓縮成難懂縮寫；標籤與內容不限定分類。",
      minLength: 1,
      maxLength: MAX_ITEM_LENGTH,
    }),
    {
      description:
        "完整取代面板的遊戲資訊；以目前角色為主，保留必要的跨角色摘要，依對下一步的影響排序。通常 4 至 6 項即可，最多 8 項；不填滿欄位，不混合目前狀態、歷史支出與下一步，也不列出與目前決策無關的屬性。",
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
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const details = value as Partial<StatusDetails>;
  if (
    details.version !== 1 ||
    typeof details.title !== "string" ||
    !Array.isArray(details.items) ||
    !details.items.every((item) => typeof item === "string")
  ) {
    return undefined;
  }
  const items = details.items
    .slice(0, MAX_ITEMS)
    .map((item) => normalizeText(item, MAX_ITEM_LENGTH))
    .filter((item) => item.length > 0);
  if (items.length === 0) {
    return undefined;
  }
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
  if (width < 1) {
    return [];
  }
  const border = theme.fg("borderMuted", "─".repeat(width));
  const content = [
    truncateToWidth(theme.fg("accent", theme.bold(`◆ ${status.title}`)), width),
  ];
  const itemLines = status.items.map((item) => {
    // 標籤可自由命名；未使用標籤的舊內容維持原樣。
    const label = item.match(/^[^：:]{1,32}[：:]/u)?.[0];
    const text = label
      ? theme.fg("muted", label) + item.slice(label.length)
      : item;
    if (width <= 2) {
      return wrapTextWithAnsi(`${theme.fg("muted", "•")} ${text}`, width).map(
        (line) => truncateToWidth(line, width),
      );
    }
    return wrapTextWithAnsi(text, width - 2).map((line, index) =>
      truncateToWidth(
        `${index === 0 ? `${theme.fg("muted", "•")} ` : "  "}${line}`,
        width,
      ),
    );
  });
  const availableLines = MAX_RENDER_LINES - 3;
  const totalItemLines = itemLines.reduce(
    (sum, lines) => sum + lines.length,
    0,
  );
  const itemBudget =
    totalItemLines > availableLines ? availableLines - 1 : availableLines;
  let usedLines = 0;
  let shownItems = 0;
  for (const lines of itemLines) {
    if (usedLines + lines.length > itemBudget) {
      break;
    }
    content.push(...lines);
    usedLines += lines.length;
    shownItems++;
  }
  if (shownItems < status.items.length) {
    content.push(
      truncateToWidth(
        theme.fg("dim", `…另有 ${status.items.length - shownItems} 項未顯示`),
        width,
      ),
    );
  }
  return [border, ...content, border];
}

export default function (pi: ExtensionAPI) {
  let context: ExtensionContext | undefined;
  let status: StatusDetails | undefined;
  let visible = true;

  function display() {
    const ctx = context;
    if (!ctx?.hasUI) {
      return;
    }
    if (!visible || !status || status.items.length === 0) {
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
      const details =
        entry.type === "custom" && entry.customType === STATUS_ENTRY
          ? entry.data
          : entry.type === "message" &&
              entry.message.role === "toolResult" &&
              entry.message.toolName === "update_status"
            ? entry.message.details
            : undefined;
      const restored = parseStatusDetails(details);
      if (restored) {
        status = restored;
      }
    }
    display();
  }

  pi.registerTool({
    name: "update_status",
    exposure: "codemode",
    label: "Update Game Status",
    description:
      "完整更新編輯器上方的遊戲狀態面板。標題明示目前操作角色，本角項目不重複角色名稱，跨角色資訊另標歸屬。不要求固定欄位或分類，可記錄臨時限制、發現與待驗證事項。每項只說一個主題，分清目前狀態與歷史紀錄，使用完整名稱與清楚的時效說明。通常 4 至 6 項，最多 8 項，不清除面板。",
    promptSnippet:
      "維護易讀的遊戲狀態面板：標題指定目前角色，本角項目不重複姓名，只留影響下一步的資訊，分類保持彈性",
    promptGuidelines: [
      "遊玩過程中透過 bears tools 陸續取得新資訊時，主動呼叫 update_status；保留 title 與 items 的彈性，不限制固定欄位或分類，也不必收錄所有資訊。",
      "title 簡短明示已確認的目前操作角色，可附職業或主要目標；角色不明時標示待確認，不猜測角色、職業或資源歸屬。",
      "每項只說一個主題，建議使用「自由標籤：內容」。已在標題確認目前角色時，本角項目不重複角色名稱，例如「進度：最高 65 層，尚未挑戰 66 層」。只有跨角色或全體資訊另標歸屬，例如「全體進度：最後觀測 9 名角色均未達 70 層」或「待確認｜角色 B：最後觀測缺少入場材料」；標題未確認角色時，不得省略角色歸屬或推定為本角。",
      "標籤依當下資訊自由命名，不要求固定分類或填滿欄位；歸屬不明時標示待確認，未確認共用的資源不得列為帳號資源。",
      "使用完整物品名稱、必要單位與比較基準；進度分子與分母須說明計算對象。下一步寫明動作、完整物品名稱與必要數量，不寫「只分解一根」「保留一根」等對象不明的指示。不要使用自創縮寫、無說明的數字或把多件事塞進同一項；不為縮短行數而省略必要文字或安全條件。",
      "以目前角色及會影響下一步的目標、限制、缺口與動態資訊為主，依重要性排序；其他角色只留必要摘要，不列出所有角色的完整資料。通常 4 至 6 項即可，最多 8 項；不加入無關的操作流水帳、驗收編號或重複確認。屬性只在影響目前配裝或戰鬥決策時顯示，不固定列出全部屬性。",
      "目前狀態、歷史支出與下一步分項表達，不放在同一項。歷史支出只在影響剩餘預算或後續決策時保留，不混入目前餘額；例如寫「資金：80,446,791 G」，不附加「本次已實扣含稅」等操作紀錄。避免「最後完整庫精魄」等壓縮語句，改寫為「材料：最後觀測精魄 15,806 個」。HP 與 MP 都已確認全滿且不需精確值時，可寫「HP／MP 全滿」；數值未知或不滿時不得這樣概括。",
      "切換角色並確認成功後，以新角色更新標題與內容排序，不把前角的裝備、資源或生命值套用到新角色；保留仍有用的跨角色目標與其他角色最後觀測，不因切角全部清空。",
      "每次呼叫 update_status 都要提供完整替代內容；移除被新觀測取代、已解除的臨時限制與不再影響後續操作的紀錄。無法確認仍有效的資訊標示「最後觀測」或「可能過期」，推論或未知機制標示「待驗證」，不得當成已確認的即時狀態。",
      "update_status 只整理遊戲資訊，不記錄 coding 工作進度；不要清除面板，單次工作結束後仍保留最後的遊戲狀態。",
    ],
    parameters: UpdateStatusParams,
    execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      return Promise.resolve().then(() => {
        context = ctx;
        const items = params.items
          .map((item) => normalizeText(item, MAX_ITEM_LENGTH))
          .filter((item) => item.length > 0);
        if (items.length === 0) {
          throw new Error("遊戲狀態至少要保留一項最新且有用的資訊。");
        }
        status = {
          version: 1,
          title:
            normalizeText(params.title ?? "", MAX_TITLE_LENGTH) ||
            DEFAULT_TITLE,
          items,
        };
        pi.appendEntry(STATUS_ENTRY, status);
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
      });
    },
  });

  pi.registerShortcut(Key.ctrlAlt("b"), {
    description: "顯示／隱藏遊戲狀態面板，保留最新內容",
    handler: (ctx) => {
      if (!ctx.hasUI) {
        return;
      }
      context = ctx;
      visible = !visible;
      display();
    },
  });

  pi.on("session_start", (_event, ctx) => {
    visible = true;
    reconstruct(ctx);
  });
  pi.on("session_tree", (_event, ctx) => reconstruct(ctx));

  pi.on("session_shutdown", () => {
    if (context?.hasUI) {
      context.ui.setWidget(WIDGET_ID, undefined);
    }
    context = undefined;
    status = undefined;
  });
}
