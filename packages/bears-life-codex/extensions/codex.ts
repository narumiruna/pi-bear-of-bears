import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { PublicCodex } from "./client.js";

export default function (pi: ExtensionAPI) {
  const codex = new PublicCodex();
  pi.registerTool({
    name: "bears_life_codex",
    label: "萬熊之熊公開裝備圖鑑",
    description:
      "唯讀抓取公開 BOSS 裝備與合成配方 JSON；recipes=true 查材料、精魄與金幣，否則查 BOSS、裝備屬性、掉落率、技能與被動；支援 query 和 offset 分頁。無須 Telegram 登入、不購買或製作。來源可能過期，不代表角色持有或 BOSS 存活。",
    parameters: Type.Object(
      {
        recipes: Type.Optional(Type.Boolean()),
        query: Type.Optional(Type.String({ maxLength: 200 })),
        offset: Type.Optional(Type.Integer({ minimum: 0 })),
      },
      { additionalProperties: false },
    ),
    async execute(_id, params, signal) {
      const result = await codex.lookup(params, signal);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
        details: result,
      };
    },
  });
}
