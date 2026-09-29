import {
	isToolCallEventType,
	type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";

const DEFAULT_BASH_TIMEOUT_SECONDS: number = 60;

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", (event) => {
		if (
			isToolCallEventType("bash", event) &&
			event.input.timeout === undefined
		) {
			event.input.timeout = DEFAULT_BASH_TIMEOUT_SECONDS;
		}
	});
}
