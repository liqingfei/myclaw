import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { buildQoderCliBackend } from "./cli-backend.js";

export default definePluginEntry({
  id: "qodercli",
  name: "Qoder CLI",
  description: "Qoder CLI backend support",
  register(api) {
    api.registerCliBackend(buildQoderCliBackend(api.pluginConfig));
  },
});
