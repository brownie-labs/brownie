import { render } from "ink";
import type { WorkerStatusStore } from "../status.js";
import type { WorkerConfig } from "../types.js";
import { Dashboard } from "./dashboard.js";

export interface DashboardHandle {
  unmount: () => void;
  waitUntilExit: () => Promise<void>;
}

export function mountDashboard(
  store: WorkerStatusStore,
  config: WorkerConfig,
): DashboardHandle {
  const app = render(<Dashboard store={store} config={config} />, {
    exitOnCtrlC: false,
    patchConsole: true,
  });
  return {
    unmount: () => {
      app.unmount();
    },
    waitUntilExit: async () => {
      await app.waitUntilExit();
    },
  };
}
