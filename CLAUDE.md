# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Czym jest ten projekt

`claude-worker` — długo działający proces CLI z dwoma współpracującymi agentami Claude Code
(`claude -p`):

- **Monitor** (tani model, domyślnie `haiku`) — działa cyklicznie w stałym rytmie; jedyna
  akcja to wykrycie pracy do zrobienia i zgłoszenie jej jako zadań (raport JSON na końcu
  sesji). Niczego nie wykonuje.
- **Egzekutor** (mocny model, domyślnie `opus`) — budzony, gdy monitor doda nowe zadania;
  drenuje kolejkę sekwencyjnie, **jedno zadanie = jedna czysta sesja**.

Obie pętle działają równolegle w jednym procesie (maks. jedna sesja każdego typu naraz);
wspólny `AbortSignal` zamyka obie. Rytm monitora liczony jest od startu cyklu, bez nakładania
(przekroczony interwał → kolejny cykl natychmiast). Egzekutor nie ma interwału — jest zdarzeniowy.

## Komendy

```bash
pnpm install
pnpm configure                    # interaktywnie tworzy .env oraz prompts/*.prompt.md (oba agenty)
pnpm start                        # uruchamia workera (używa ./.env)
pnpm start --env-file ./inny.env  # inny plik konfiguracji
pnpm dev                          # tsx watch (auto-restart przy zmianach)
pnpm build                        # tsup → dist/ (ESM), binarka claude-worker
pnpm typecheck                    # tsc --noEmit
pnpm lint                         # eslint . (typescript-eslint, reguły type-aware)
pnpm lint:fix                     # eslint . --fix
pnpm format                       # prettier --write .
pnpm format:check                 # prettier --check .
pnpm test                         # vitest run (testy jednostkowe + integracyjne)
pnpm test:watch                   # vitest w trybie watch
pnpm test:coverage                # vitest run --coverage (raport v8, egzekwowane progi)
pnpm check                        # wszystko naraz: typecheck + lint + format:check + test
```

Weryfikacja poprawności = `pnpm check`.
Linter: ESLint (flat config `eslint.config.js`) + typescript-eslint w trybie
type-aware; formatter: Prettier (`eslint-config-prettier` wyłącza reguły stylistyczne
kolidujące z Prettierem).
Testy: Vitest, katalog `test/` (lustrzany do `src/`), atrapa binarki `claude`
w `test/fixtures/claude` emitująca stream-json — sterowana env `FAKE_CLAUDE_MODE`,
`FAKE_CLAUDE_RESULT_TEXT`, `FAKE_CLAUDE_PROMPT_OUT`, także w wariantach per model
(sufiks `_<MODEL>` np. `FAKE_CLAUDE_RESULT_TEXT_HAIKU` — atrapa czyta `--model` z argv),
dzięki czemu jedna binarka rozróżnia sesje monitora i egzekutora w E2E.
Manager pakietów to **pnpm** (jest `pnpm-lock.yaml`).

## Architektura

Wejście `src/index.ts` (citty) → dwie subkomendy: `start` i `configure`.

Przepływ `start` (`src/start.ts`):

1. `preflight.ts` (`ensureReady`) — ładuje `.env` (`process.loadEnvFile`), waliduje env
   (`parseEnv` + `envSchema`), sprawdza obecność `claude` w PATH, pliku `.env` oraz
   **czterech** plików promptów (para monitor + para egzekutor); przy braku rzuca błąd
   z podpowiedzią `pnpm configure`. Zwraca zweryfikowane `WorkerPromptPaths`.
2. `config.ts` (`loadWorkerConfig`) — waliduje zmienne schematem zod (`parseEnv`),
   rozwiązuje ścieżki, buduje `childEnv`. Zwraca zagnieżdżony `WorkerConfig
{ monitor: MonitorConfig, executor: AgentConfig, streamPartial, cwd, tasksFilePath, childEnv }`.
   Przyjmuje opcjonalnie `WorkerPromptPaths` z preflightu — wtedy pomija ponowne ładowanie
   `.env` i walidację czytelności plików promptów. Katalog `cwd` tworzy `start.ts`.
3. `tasks.ts` (`TaskStore.open`) — trwały magazyn zadań (`data/tasks.json`, zapis atomowy
   tmp+rename, mutacje serializowane wewnętrznym łańcuchem promise'ów). Dedup po `id`
   względem całej historii (pending/in_progress/done/failed). Przy otwarciu resetuje
   osierocone `in_progress` → `pending`; uszkodzony plik = czytelny błąd i exitCode 1.
4. `shutdown.ts` (`abortOnSignals`) — wspólny `AbortSignal` (SIGINT/SIGTERM) dla obu pętli;
   `waker.ts` (`Waker`) — zdarzeniowe budzenie egzekutora (`notify`/`wait`, abort-aware);
   `timing.ts` — `sleep` (abort-aware) i `formatDuration`.
5. `monitor.ts` (`runMonitorLoop`) — pętla cykliczna: czyta prompty monitora, dokleja
   `TASK_REPORT_CONTRACT` (z `report.ts`) do system promptu, uruchamia sesję, parsuje
   `resultText` przez `parseTaskReport` (`null` = zepsuty raport → log błędu, cykl pominięty),
   dodaje zadania do `TaskStore` i przy nowych woła `waker.notify()`.
6. `executor.ts` (`runExecutorLoop`) — pętla zdarzeniowa: `takeNext()` → komponuje prompt
   (`composeTaskPrompt`: prompt egzekutora + blok „Zadanie do wykonania”) i system prompt
   (+ `TASK_EXECUTION_CONTRACT`), uruchamia sesję, `complete`/`fail`; pusta kolejka →
   `waker.wait(signal)`. Abort w trakcie sesji zostawia zadanie `in_progress`
   (reset przy kolejnym starcie).
7. `runner.ts` (`runSession(spec: SessionSpec, signal)`) — `spawn` procesu `claude`
   (`-p --model --system-prompt --output-format stream-json --verbose` + opcjonalnie
   `--permission-mode`, `--include-partial-messages`). Przyjmuje **treści** promptów
   (nie ścieżki — pliki czytają pętle przy każdej sesji) i per-agentowy logger. Prompt idzie
   przez stdin. Obsługuje timeout sesji (SIGTERM → po `KILL_GRACE_MS` SIGKILL) i abort.
8. `stream.ts` (`StreamRenderer`) — parsuje linie stream-json (system/assistant/user/
   stream_event/result), renderuje przez consola, agreguje podsumowanie (koszt, tury,
   sessionId, isError, `resultText` — konwersja z wire-formatu `is_error` na granicy).

`report.ts` — kontrakt raportu zadań (`TASK_REPORT_CONTRACT`, `taskReportSchema`,
`parseTaskReport`: ostatni blok ` ```json ` albo surowy JSON → walidacja zod →
dedup w partii; `null` przy błędzie, odróżnialne od pustej listy).

`configure.ts` — interaktywny kreator (consola prompt) prowadzący przez oba agenty
(model monitora, interwał, prompt monitora, model egzekutora, prompt egzekutora,
opcjonalny `CLAUDE_CONFIG_DIR`); anulowanie (Ctrl+C) rzuca `ConsolaPromptCancelledError`,
wykrywany przez `isCancellation` i traktowany jako czyste przerwanie bez zmian.
Zapisuje `.env`, `prompts/monitor.prompt.md` i `prompts/executor.prompt.md`.

`types.ts` — `WorkerConfig`, `AgentConfig`, `MonitorConfig`, `SessionResult`, `Task`,
`NewTask`, `TaskStatus` (współdzielone kontrakty). `logger.ts` — `monitorLogger`
i `executorLogger` (tagi `[monitor]`/`[executor]`).

## Kluczowe zasady i pułapki

- **Model danych konfiguracji jest środowiskowy** — jedynym źródłem prawdy jest `.env`
  (walidowany zod w `config.ts`), zmienne w przestrzeniach `CLAUDE_WORKER_MONITOR_*`
  i `CLAUDE_WORKER_EXECUTOR_*` + wspólne (`TASKS_FILE`, `STREAM_PARTIAL`, `CWD`).
  `.env` i `prompts/*.prompt.md` są w `.gitignore`; `prompts/*.system.md` (definicje ról)
  są wersjonowane.
- **Kontrakty techniczne wstrzykuje kod** — `TASK_REPORT_CONTRACT` (monitor)
  i `TASK_EXECUTION_CONTRACT` (egzekutor) doklejane do system promptów w pętlach;
  użytkownik nie może ich zepsuć edycją plików promptów.
- **Deduplikacja zadań w kodzie, nie w modelu** — `TaskStore.addTasks` odrzuca `id`
  obecne w magazynie (cała historia). Stabilność `id` zapewnia kontrakt raportu;
  sporadyczne odstępstwa modelu są nieszkodliwe.
- **Komenda jest stała** — `COMMAND = "claude"` w `config.ts` (nie jest konfigurowalna przez env).
- **Izolacja sesji** — każda sesja działa w `CLAUDE_WORKER_CWD` (domyślnie `./workspace`,
  tworzony automatycznie, w `.gitignore`). Magazyn zadań (`data/`) leży **poza** `workspace/`,
  żeby sesje nie mogły go modyfikować.
- **`CLAUDE_CONFIG_DIR`** — przekazywany do procesu potomnego przez `childEnv`; obsługuje `~`
  (rozwijane przez `expandHome`). Pozwala użyć innego profilu Claude Code (osobne MCP/subskrypcja).
- **Ścieżki** — względne rozwiązywane od `process.cwd()` przez `resolveFromCwd`
  (z rozwinięciem `~`). Ścieżki promptów w jednym miejscu: `resolvePromptPaths` w
  `config.ts` przyjmuje **sparsowane** env (wynik `parseEnv`) i zwraca `WorkerPromptPaths`;
  w przepływie `start` liczy je raz `ensureReady` i przekazuje do `loadWorkerConfig`.
  Etykiety plików promptów w `PROMPT_FILE_LABELS` (współdzielone preflight/config).
- **Dostęp do plików** — wspólne helpery w `src/fs.ts` (`canAccess`, `assertReadable`);
  nie duplikuj wzorca `fs.access(...) + try/catch`.
- **`signal.aborted` w pętlach** — TS zawęża po warunku `while`; używaj wzorca
  `const aborted = (): boolean => signal.aborted` (inaczej `no-unnecessary-condition`).
- **ESM + verbatimModuleSyntax** — importy muszą mieć rozszerzenie `.js` (mimo plików `.ts`),
  a importy typów muszą używać `import type`.

## Konwencje projektu (z globalnego CLAUDE.md użytkownika)

- Odpowiadaj i pisz komunikaty/komentarze po polsku.
- Nie dodawaj komentarzy w kodzie — kod ma być samotłumaczący.
- Stawiaj na jakość, nie szybkość; szukaj najlepszych rozwiązań (top-tier kod).
- W commitach nie umieszczaj wzmianek o Claude Code / "Generated with" / "Co-Authored-By".
