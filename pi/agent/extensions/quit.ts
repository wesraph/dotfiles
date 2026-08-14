import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "quit",
    label: "Quit pi",
    description:
      "Gracefully quit this pi session. Use when the user asks to quit, exit, or close pi " +
      "(especially when not running inside tmux and keyboard shortcuts are unavailable). " +
      "Shutdown is deferred until the current turn finishes, so pending work is not lost.",
    parameters: Type.Object({
      reason: Type.Optional(
        Type.String({ description: "Short reason shown to the user on exit" })
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const reason = params.reason ? `: ${params.reason}` : "";
      ctx.ui.notify(`Quitting pi${reason}`, "info");
      ctx.shutdown();
      return {
        content: [{ type: "text", text: `Quitting pi${reason}.` }],
        details: {},
      };
    },
  });
}
