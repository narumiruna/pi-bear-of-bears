import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { compactBearsOutput } from "../src/compact-context.js";

const tools = new Set([
  "bears_history",
  "bears_send",
  "bears_click",
  "bears_world",
]);

export default function (pi: ExtensionAPI) {
  pi.on("context", (event) => ({
    messages: event.messages.map((message) => {
      if (
        !(
          (message.role === "toolResult" &&
            !message.isError &&
            tools.has(message.toolName)) ||
          (message.role === "custom" && message.customType === "bears-watch")
        )
      )
        return message;
      if (message.role === "custom" && typeof message.content === "string")
        return { ...message, content: compactBearsOutput(message.content) };
      if (typeof message.content === "string") return message;
      return {
        ...message,
        content: message.content.map((block) =>
          block.type === "text"
            ? { ...block, text: compactBearsOutput(block.text) }
            : block,
        ),
      };
    }),
  }));
}
