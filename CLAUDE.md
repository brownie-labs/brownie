# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Projekt

`brownie` — CLI (Node >= 22, pnpm, ESM, TypeScript) uruchamiający cyklicznie sesje Claude Code w układzie dwuagentowym: **monitor** zgłasza zadania, **egzekutor** je wykonuje, a **podsumowujący** zapisuje wnioski do pamięci długoterminowej. Kod, komunikaty i commity są po polsku.

## Komendy

```bash
pnpm dev                  # start z watch (tsx)
pnpm start                # start bez watch
pnpm configure            # interaktywne generowanie .env i promptów
pnpm check                # typecheck + lint + format:check + test (uruchamiaj przed commitem)
pnpm typecheck
pnpm lint / pnpm lint:fix
pnpm format / pnpm format:check
pnpm test                 # vitest run
pnpm test test/executor.test.ts        # pojedynczy plik testów
pnpm vitest run -t "nazwa testu"       # pojedynczy test po nazwie
pnpm test:coverage        # progi pokrycia wymuszane w vitest.config.ts
pnpm build                # tsup -> dist/
```

## Architektura

Punkt wejścia `src/index.ts` (citty) ma trzy subkomendy: `start`, `configure`, `mcp`.

`src/start.ts` spina całość: po preflight (`preflight.ts`) i wczytaniu konfiguracji uruchamia **równolegle dwie pętle** (`Promise.all`), które komunikują się wyłącznie przez współdzielone obiekty:

- **`runMonitorLoop` (`monitor.ts`)** — co `intervalMs` (i tylko w oknie z `active-hours.ts`) odpala sesję Claude z wymuszonym JSON-schema raportu zadań (`report.ts`), dodaje zadania do `TaskStore` (deduplikacja po `id`) i budzi egzekutora przez `Waker`.
- **`runExecutorLoop` (`executor.ts`)** — pobiera zadania `pending` z `TaskStore`, dokleja opis zadania do promptu, uruchamia sesję z dostępem do pamięci (MCP). Błędy przejściowe (`isTransientFailure`: timeout albo wzorzec w tekście wyniku) ponawia do `maxTaskAttempts` z opóźnieniem; pozostałe oznacza jako `failed`. Po każdej sesji (sukces lub porażka) odpala `SessionSummarizer`.

Pozostałe elementy:

- **`runner.ts`** — jedyne miejsce spawnowania procesu `claude` (`-p --model --effort --system-prompt --output-format stream-json --permission-mode bypassPermissions`, prompt przez stdin). Obsługuje timeout/abort (SIGTERM, po 5 s SIGKILL). `stream.ts` parsuje stream-json na `SessionEvent`y i buduje `SessionSummary`.
- **`tasks.ts` (`TaskStore`)** — magazyn zadań w JSON (`data/tasks.json`), zapis atomowy (tmp + rename), operacje serializowane łańcuchem promisów; przy starcie resetuje zawieszone `in_progress` na `pending`.
- **`src/memory/`** — pamięć długoterminowa: `store.ts` (SQLite przez `node:sqlite` + FTS5), `summarizer.ts` (sesja haiku czytająca log sesji egzekutora, wynik do bazy), `mcp.ts` (serwer MCP stdio z narzędziami `memory_search`/`memory_get`; egzekutor dostaje go przez `--mcp-config` wskazujący z powrotem na ten sam binarny plik: `brownie mcp --db ...`).
- **`status.ts` + `src/ui/`** — `WorkerStatusStore` zbiera zdarzenia z obu pętli i zasila dashboard TUI (Ink/React). Zdarzenia sesji są jednocześnie tee-owane (`teeSession`) do trwałych logów `SessionLog` (`logs/<agent>/<dzień>/<godzina>_<sessionId>.log`).
- **`config.ts`** — cała konfiguracja przez zmienne `CLAUDE_WORKER_*` walidowane zodem (`envSchema`), `.env` ładowany przez `process.loadEnvFile`. Nowa opcja konfiguracyjna = wpis w `envSchema` + mapowanie w `loadWorkerConfig` + zwykle pytanie w `configure.ts`.

## Prompty

Wszystkie prompty agentów żyją w `prompts/*.md` (ścieżki konfigurowalne przez env). **Nigdy nie umieszczaj treści promptów jako stałych w kodzie** — zawsze w plikach markdown.

## Testy

- Vitest, testy w `test/` odzwierciedlają strukturę `src/`. Progi pokrycia (statements 92 %, lines 94 %…) wymuszane w `vitest.config.ts` — nowy kod musi być otestowany.
- Sesje Claude testuje się bez prawdziwego CLI: `test/fixtures/claude` to fałszywy binarny skrypt sterowany zmiennymi `FAKE_CLAUDE_*` (tryb, tekst wyniku, zrzut argumentów), z wariantami per model przez sufiks `_<MODEL>`. Pomocnicze fabryki configów i reporterów są w `test/helpers.ts`.

## Konwencje

- ESLint: `strictTypeChecked` + `stylisticTypeChecked`; `tsconfig` z `exactOptionalPropertyTypes` (stąd jawne `| undefined` w interfejsach).
- Komunikaty użytkownika, opisy CLI, błędy i commity po polsku; bez komentarzy w kodzie.
- Katalog `workspace/` to cwd sesji agentów (ignorowany przez lint), `data/` to stan runtime — nie są częścią kodu źródłowego.
