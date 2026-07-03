import { render } from "ink";
import { App, type AppProps } from "./app.js";

export interface DashboardHandle {
  unmount: () => void;
  waitUntilExit: () => Promise<void>;
}

export function mountDashboard(props: AppProps): DashboardHandle {
  const app = render(<App {...props} />, {
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
