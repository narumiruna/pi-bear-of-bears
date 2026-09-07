import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  CHARACTER_MESSAGES_EVENT,
  CharacterStatusState,
} from "../src/character-status.js";
import { renderCharacterWidget } from "../src/character-widget.js";
import { Game } from "../src/game.js";
import { createTransport } from "../src/telegram.js";

const WIDGET_ID = "bears-character-status";

export default function (pi: ExtensionAPI) {
  const state = new CharacterStatusState();
  const history = new Game(createTransport);
  let context: ExtensionContext | undefined;
  let unsubscribe: (() => void) | undefined;
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
          render: (width) => renderCharacterWidget(state, width, theme, notice),
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
    display();
    void refresh();
  });

  pi.registerCommand("bears-status", {
    description:
      "Refresh the character widget from recent chat history (read-only; does not send /status).",
    handler: async (_args, ctx) => {
      context = ctx;
      await refresh();
    },
  });

  pi.on("session_shutdown", () => {
    stopped = true;
    unsubscribe?.();
    unsubscribe = undefined;
    history.stop();
    if (context?.hasUI) context.ui.setWidget(WIDGET_ID, undefined);
    context = undefined;
  });
}
