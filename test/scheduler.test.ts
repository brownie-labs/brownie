import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionResult } from "../src/types.js";
import { buildConfig } from "./helpers.js";

const mocks = vi.hoisted(() => ({
  runSession: vi.fn(),
}));

vi.mock("../src/runner.js", () => ({ runSession: mocks.runSession }));
vi.mock("../src/logger.js", async () =>
  (await import("./helpers.js")).loggerModuleMock(),
);

const { runScheduler } = await import("../src/scheduler.js");
const { logger } = await import("../src/logger.js");

const INTERVAL = 300_000;

function ok(): SessionResult {
  return { ok: true, durationMs: 0 };
}

describe("runScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("uruchamia kolejną sesję po upływie interwału", async () => {
    mocks.runSession.mockResolvedValue(ok());
    const controller = new AbortController();
    const config = buildConfig({ intervalMs: INTERVAL });

    const promise = runScheduler(config, controller.signal);

    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.runSession).toHaveBeenCalledTimes(1);
    expect(logger.success).toHaveBeenCalledWith(
      expect.stringContaining("Koniec sesji #1"),
    );

    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(mocks.runSession).toHaveBeenCalledTimes(2);

    controller.abort();
    await vi.advanceTimersByTimeAsync(INTERVAL);
    await promise;
  });

  it("abort podczas snu kończy pętlę bez kolejnej sesji", async () => {
    mocks.runSession.mockResolvedValue(ok());
    const controller = new AbortController();
    const config = buildConfig({ intervalMs: INTERVAL });

    const promise = runScheduler(config, controller.signal);
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.runSession).toHaveBeenCalledTimes(1);

    controller.abort();
    await vi.advanceTimersByTimeAsync(INTERVAL * 2);
    await promise;

    expect(mocks.runSession).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("Scheduler zatrzymany"),
    );
  });

  it("abort w trakcie sesji przerywa i nie loguje sukcesu", async () => {
    const controller = new AbortController();
    mocks.runSession.mockImplementation(() => {
      controller.abort();
      return Promise.resolve(ok());
    });
    const config = buildConfig({ intervalMs: INTERVAL });

    const promise = runScheduler(config, controller.signal);
    await vi.advanceTimersByTimeAsync(1);
    await promise;

    expect(mocks.runSession).toHaveBeenCalledTimes(1);
    expect(logger.success).not.toHaveBeenCalledWith(
      expect.stringContaining("Koniec sesji"),
    );
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("przerwana"));
  });

  it("wyjątek z sesji jest łapany, pętla trwa dalej", async () => {
    mocks.runSession.mockRejectedValueOnce(new Error("crash")).mockResolvedValue(ok());
    const controller = new AbortController();
    const config = buildConfig({ intervalMs: INTERVAL });

    const promise = runScheduler(config, controller.signal);
    await vi.advanceTimersByTimeAsync(1);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("wyjątek"),
      expect.anything(),
    );

    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(mocks.runSession).toHaveBeenCalledTimes(2);

    controller.abort();
    await vi.advanceTimersByTimeAsync(INTERVAL);
    await promise;
  });

  it("nieudana sesja jest logowana jako błąd, pętla trwa dalej", async () => {
    mocks.runSession
      .mockResolvedValueOnce({
        ok: false,
        durationMs: 100,
        error: "Przekroczono limit czasu sesji",
      } satisfies SessionResult)
      .mockResolvedValue(ok());
    const controller = new AbortController();
    const config = buildConfig({ intervalMs: INTERVAL });

    const promise = runScheduler(config, controller.signal);
    await vi.advanceTimersByTimeAsync(1);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("niepowodzenie"));
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("Przekroczono limit czasu sesji"),
    );

    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(mocks.runSession).toHaveBeenCalledTimes(2);

    controller.abort();
    await vi.advanceTimersByTimeAsync(INTERVAL);
    await promise;
  });

  it("przy przekroczonym interwale kolejna sesja startuje natychmiast", async () => {
    mocks.runSession.mockImplementation(
      () =>
        new Promise<SessionResult>((res) => setTimeout(() => res(ok()), INTERVAL + 1000)),
    );
    const controller = new AbortController();
    const config = buildConfig({ intervalMs: INTERVAL });

    const promise = runScheduler(config, controller.signal);

    await vi.advanceTimersByTimeAsync(INTERVAL + 1000);
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("natychmiast"));
    expect(mocks.runSession).toHaveBeenCalledTimes(2);

    controller.abort();
    await vi.advanceTimersByTimeAsync(INTERVAL + 1000);
    await promise;
  });
});
