import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  CHARACTER_MESSAGES_EVENT,
  CharacterStatusState,
} from "../src/character-status.js";
import {
  renderCharacterWidget,
  type WidgetMode,
} from "../src/character-widget.js";
import { Game } from "../src/game.js";
import { createTransport } from "../src/telegram.js";
import {
  WATCH_STATUS_EVENT,
  WATCH_STATUS_REQUEST_EVENT,
  type WatchStatus,
} from "../src/watch.js";

const WIDGET_ID = "bears-character-status";

export default function (pi: ExtensionAPI) {
  const state = new CharacterStatusState();
  const history = new Game(createTransport);
  let context: ExtensionContext | undefined;
  let unsubscribe: (() => void) | undefined;
  let unsubscribeStatus: (() => void) | undefined;
  let mode: WidgetMode = "compact";
  let stopped = false;
  let refreshing = false;
  let notice: string | undefined;

  function display() {
    const ctx = context;
    if (!ctx?.hasUI || stopped) return;
    if (ctx.mode === "tui") {
      ctx.ui.setWidget(
        WIDGET_ID,
        (_tui, theme) => ({
          render: (width) =>
            renderCharacterWidget(state, width, theme, notice, mode),
          invalidate() {},
        }),
        { placement: "aboveEditor" },
      );
    } else {
      // RPC supports string widgets, not terminal component factories.
      ctx.ui.setWidget(
        WIDGET_ID,
        renderCharacterWidget(
          state,
          72,
          {
            fg: (_color, text) => text,
            bold: (text) => text,
          },
          notice,
          mode,
        ),
        { placement: "aboveEditor" },
      );
    }
  }

  async function refresh() {
    if (stopped || refreshing) return;
    refreshing = true;
    notice = "正在讀取最近的遊戲訊息…";
    display();
    try {
      const messages = await history.history(30);
      if (stopped) return;
      state.observe(messages);
      notice = undefined;
    } catch {
      if (stopped) return;
      notice = "無法讀取狀態；請確認登入與連線，再執行 /bears-status。";
    } finally {
      refreshing = false;
      display();
    }
  }

  pi.on("session_start", (_event, ctx) => {
    context = ctx;
    if (!ctx.hasUI) return;
    unsubscribe = pi.events.on(CHARACTER_MESSAGES_EVENT, (messages) => {
      if (!stopped && state.observe(messages)) {
        notice = undefined;
        display();
      }
    });
    unsubscribeStatus = pi.events.on(WATCH_STATUS_EVENT, (status) => {
      if (
        !stopped &&
        typeof status === "string" &&
        ["off", "connecting", "listening", "disconnected", "error"].includes(
          status,
        )
      ) {
        state.monitoring = status as WatchStatus;
        display();
      }
    });
    pi.events.emit(WATCH_STATUS_REQUEST_EVENT, undefined);
    display();
    void refresh();
  });

  pi.registerCommand("bears-status", {
    description:
      "Character/adventure widget: refresh (default), compact, or full. Read-only; never sends game commands.",
    handler: async (args, ctx) => {
      context = ctx;
      const action = args.trim() || "refresh";
      if (action === "compact" || action === "full") {
        mode = action;
        display();
      } else if (action === "refresh") await refresh();
      else if (ctx.hasUI)
        ctx.ui.notify("Usage: /bears-status [refresh|compact|full]", "warning");
    },
  });

  pi.on("session_shutdown", () => {
    stopped = true;
    unsubscribe?.();
    unsubscribe = undefined;
    unsubscribeStatus?.();
    unsubscribeStatus = undefined;
    history.stop();
    if (context?.hasUI) context.ui.setWidget(WIDGET_ID, undefined);
    context = undefined;
  });
}
