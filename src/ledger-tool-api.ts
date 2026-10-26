import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { withLedgerCall } from "./ledger-channel.js";

/** 直接工具與 Codemode nested tools 都在實際 execute 範圍保留呼叫身分。 */
export function ledgerToolAPI(pi: ExtensionAPI): ExtensionAPI {
  const register: ExtensionAPI["registerTool"] = (tool) => {
    pi.registerTool({
      ...tool,
      exposure: "codemode",
      parameters: tool.parameters,
      execute: (id, params, signal, onUpdate, context) =>
        withLedgerCall(
          {
            toolCallId: id,
            toolName: tool.name,
            sessionId: context?.sessionManager?.getSessionId?.(),
          },
          () => tool.execute(id, params, signal, onUpdate, context),
        ),
    });
  };
  return new Proxy(pi, {
    get: (target, key, receiver) =>
      key === "registerTool" ? register : Reflect.get(target, key, receiver),
  });
}
