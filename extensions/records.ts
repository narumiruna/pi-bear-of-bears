import { lstatSync, readdirSync, type Stats } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { RecordsStore } from "../src/records-store.js";
import { registerRecordsTools } from "../src/records-tools.js";

/** 不在factory開庫，不接遊戲、Goal或背景工作；正式切換另行放行。 */
export default function recordsExtension(pi: ExtensionAPI) {
  let cwd: string | undefined, store: RecordsStore | undefined;
  const close = () => {
    store?.close();
    store = undefined;
  };
  const databasePath = () => {
    if (!cwd) {
      throw new Error("紀錄庫尚未取得session工作目錄。");
    }
    return {
      cwd,
      path:
        process.env.BEARS_RECORDS_PATH ??
        resolve(cwd, ".pi/records/records.sqlite"),
    };
  };
  const get = () => {
    const { path } = databasePath();
    if (store && store.path !== path) {
      throw new Error(
        "紀錄庫路徑設定已變更；請先重新載入，不重用另一個庫的連線。",
      );
    }
    store ??= new RecordsStore(path, { create: false });
    return store;
  };
  const initialize = () => {
    const { path, cwd: root } = databasePath();
    if (store) {
      throw new Error("已有紀錄庫連線；不重新初始化。");
    }
    const legacy = [
      "docs/NOTES.md",
      "docs/LOG.md",
      "docs/notes",
      "docs/logs",
    ].some((source) => {
      const path = resolve(root, source);
      let stat: Stats;
      try {
        stat = lstatSync(path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return false;
        }
        throw error;
      }
      return (
        source.endsWith(".md") ||
        !stat.isDirectory() ||
        readdirSync(path).some((name) => name.endsWith(".md"))
      );
    });
    if (legacy) {
      throw new Error(
        "專案已有 Markdown 紀錄；請依計畫離線遷移，不另建空庫分流。",
      );
    }
    store = RecordsStore.initialize(path);
    return store;
  };
  registerRecordsTools(pi, get);
  pi.on("session_start", (_event, ctx) => {
    close();
    cwd = ctx.cwd;
  });
  pi.on("session_shutdown", () => {
    close();
    cwd = undefined;
  });
  pi.registerCommand("records", {
    description:
      "本機歷史紀錄：status、search 文字、show ID [revision]、backup；init 明確新建空庫，不匯入歷史、不執行遊戲。",
    handler: async (args, ctx) => {
      await Promise.resolve();
      const [command, ...rest] = args.trim().split(/\s+/u);
      if (!["status", "search", "show", "backup", "init"].includes(command)) {
        ctx.ui.notify(
          "/records status | search 文字 | show ID [revision] | backup | init",
          "info",
        );
        return;
      }
      if (command === "init" && rest.length > 0) {
        throw new Error(
          "初始化不接受路徑參數；請使用既有的 BEARS_RECORDS_PATH 設定。",
        );
      }
      const s = command === "init" ? initialize() : get();
      const result =
        command === "init"
          ? {
              ...s.status(),
              note: "已明確新建空庫；未匯入歷史，也不代表正式切換。",
            }
          : command === "status"
            ? s.status()
            : command === "search"
              ? s.search({ query: rest.join(" ") })
              : command === "show"
                ? s.get(rest[0], rest[1] ? Number(rest[1]) : undefined)
                : { backup: s.backup(join(dirname(s.path), "backups")) };
      pi.sendMessage(
        {
          customType: "records",
          content: JSON.stringify(result),
          display: true,
        },
        { triggerTurn: false },
      );
    },
  });
}
