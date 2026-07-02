<p align="center">
  <h1 align="center">🧹 Brownie</h1>
</p>

<p align="center">
  <strong>Twój domowy skrzat do zaległej roboty. Pracuje, kiedy nie patrzysz.</strong><br>
  <em>Nie ciastko. Duszek. 🍫➡️🧹</em>
</p>

<p align="center">
  <img alt="Node" src="https://img.shields.io/badge/node-%E2%89%A522-339933?logo=node.js&logoColor=white">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white">
  <img alt="pnpm" src="https://img.shields.io/badge/pnpm-10-F69220?logo=pnpm&logoColor=white">
  <img alt="Vitest" src="https://img.shields.io/badge/tests-vitest-6E9F18?logo=vitest&logoColor=white">
</p>

---

Brownie to CLI, które cyklicznie uruchamia sesje [Claude Code](https://claude.com/claude-code) w układzie dwuagentowym: **monitor** wypatruje zadań, **egzekutor** je wykonuje, a **podsumowujący** zapisuje wnioski do pamięci długoterminowej. Ty śpisz — skrzat sprząta.

> Jeśli chcesz mieć agenta, który sam znajduje sobie robotę, sam ją odwala i jeszcze pamięta, czego się nauczył — to jest to.

## Jak to działa

```
        co N minut (tylko w godzinach pracy)
                          │
                          ▼
                  ┌───────────────┐   raport JSON   ┌───────────────┐
                  │    MONITOR    │ ───────────────▶│   TaskStore   │
                  │   (sonnet)    │    (zadania)    │  tasks.json   │
                  └───────────────┘                 └───────┬───────┘
                                                            │ budzi (Waker)
                                                            │
┌───────────────┐   log sesji   ┌───────────────┐  pending  │
│  SUMMARIZER   │ ◀──────────── │   EGZEKUTOR   │ ◀─────────┘
│   (sonnet)    │               │    (opus)     │
└───────┬───────┘               └───────┬───────┘
        │ wnioski                       │ memory_search / memory_get
        ▼                               ▼
┌───────────────────────────────────────────────┐
│            Pamięć (SQLite + FTS5)             │
│              serwer MCP (stdio)               │
└───────────────────────────────────────────────┘
```

Dwie pętle działają równolegle i komunikują się wyłącznie przez współdzielony magazyn zadań:

1. **Monitor** — co ustalony interwał (i tylko w skonfigurowanym oknie godzin/dni) odpala sesję Claude z wymuszonym schematem JSON. Wynik to lista zadań, deduplikowana po `id` i zapisywana do `TaskStore`.
2. **Egzekutor** — budzony natychmiast po nowych zadaniach, wykonuje je jedno po drugim w sesjach z pełnym dostępem do narzędzi oraz pamięci długoterminowej przez MCP. Błędy przejściowe (timeout, znane wzorce) ponawia z opóźnieniem, resztę oznacza jako `failed`.
3. **Podsumowujący** — po każdej sesji egzekutora (sukces czy porażka) czyta jej log i zapisuje wnioski do SQLite. Następne sesje mogą je wyszukiwać pełnotekstowo (FTS5) narzędziami `memory_search` / `memory_get`.

## Highlights

- 🔁 **Autonomiczna pętla** — monitor sam zgłasza zadania, egzekutor sam je wykonuje; zero ręcznego kolejkowania.
- 🧠 **Pamięć długoterminowa** — SQLite + FTS5 wystawione egzekutorowi jako serwer MCP; skrzat uczy się na własnych sesjach.
- ⏰ **Godziny pracy** — okno czasowe i dni tygodnia (`08:00-18:00`, `mon-fri`); poza nimi monitor odpoczywa.
- 🔂 **Ponawianie z głową** — rozróżnia błędy przejściowe od trwałych, konfigurowalna liczba prób i opóźnienie.
- 📺 **Dashboard TUI** — podgląd obu pętli na żywo (Ink/React): statusy sesji, zadania, zdarzenia.
- 🗂️ **Trwałe logi sesji** — każda sesja ląduje w `logs/<agent>/<dzień>/<godzina>_<sessionId>.log`.
- 🎛️ **Modele i effort per agent** — sonnet do patrolu, opus do roboty; wszystko konfigurowalne.
- 🧾 **Zadania w JSON** — `data/tasks.json` z zapisem atomowym; zawieszone `in_progress` wracają do `pending` po restarcie.
- 📝 **Prompty w plikach** — cała osobowość agentów w `prompts/*.md`, żadnych promptów zaszytych w kodzie.

## Wymagania

- Node.js ≥ 22 i pnpm
- Zainstalowane i zalogowane [Claude Code CLI](https://claude.com/claude-code) (`claude`)

## Quick start (TL;DR)

```bash
pnpm install

# interaktywnie wygeneruj .env i prompty
pnpm configure

# wypuść skrzata
pnpm start        # albo: pnpm dev (watch)
```

Podkomendy binarki:

```bash
claude-worker start        # uruchom obie pętle + dashboard
claude-worker configure    # interaktywna konfiguracja (.env, prompty)
claude-worker mcp --db …   # serwer MCP pamięci (używany wewnętrznie przez egzekutora)
```

## Konfiguracja

Wszystko przez zmienne `CLAUDE_WORKER_*` w `.env` (walidowane zodem — literówka nie przejdzie). `pnpm configure` przeprowadzi Cię przez całość, ale możesz też ręcznie:

| Zmienna                                       | Domyślnie                        | Opis                                                 |
| --------------------------------------------- | -------------------------------- | ---------------------------------------------------- |
| `CLAUDE_WORKER_MONITOR_MODEL`                 | `sonnet`                         | model monitora                                       |
| `CLAUDE_WORKER_MONITOR_EFFORT`                | `medium`                         | effort monitora                                      |
| `CLAUDE_WORKER_MONITOR_INTERVAL_MS`           | `900000` (15 min)                | interwał patrolu                                     |
| `CLAUDE_WORKER_MONITOR_ACTIVE_HOURS`          | _(całą dobę)_                    | okno pracy, np. `08:00-18:00`                        |
| `CLAUDE_WORKER_MONITOR_ACTIVE_DAYS`           | _(codziennie)_                   | dni pracy, np. `mon-fri` albo `mon,wed,sat-sun`      |
| `CLAUDE_WORKER_MONITOR_PROMPT_FILE`           | `./prompts/monitor.prompt.md`    | prompt monitora                                      |
| `CLAUDE_WORKER_MONITOR_SYSTEM_PROMPT_FILE`    | `./prompts/monitor.system.md`    | system prompt monitora                               |
| `CLAUDE_WORKER_MONITOR_SESSION_TIMEOUT_MS`    | _(brak)_                         | timeout sesji monitora                               |
| `CLAUDE_WORKER_EXECUTOR_MODEL`                | `opus`                           | model egzekutora                                     |
| `CLAUDE_WORKER_EXECUTOR_EFFORT`               | `high`                           | effort egzekutora                                    |
| `CLAUDE_WORKER_EXECUTOR_PROMPT_FILE`          | `./prompts/executor.prompt.md`   | prompt egzekutora                                    |
| `CLAUDE_WORKER_EXECUTOR_SYSTEM_PROMPT_FILE`   | `./prompts/executor.system.md`   | system prompt egzekutora                             |
| `CLAUDE_WORKER_EXECUTOR_SESSION_TIMEOUT_MS`   | _(brak)_                         | timeout sesji egzekutora                             |
| `CLAUDE_WORKER_EXECUTOR_TASK_ATTEMPTS`        | `3`                              | maks. liczba prób zadania                            |
| `CLAUDE_WORKER_EXECUTOR_RETRY_DELAY_MS`       | `30000`                          | opóźnienie między próbami                            |
| `CLAUDE_WORKER_SUMMARIZER_MODEL`              | `sonnet`                         | model podsumowującego                                |
| `CLAUDE_WORKER_SUMMARIZER_EFFORT`             | `medium`                         | effort podsumowującego                               |
| `CLAUDE_WORKER_SUMMARIZER_SYSTEM_PROMPT_FILE` | `./prompts/summarizer.system.md` | system prompt podsumowującego                        |
| `CLAUDE_WORKER_SUMMARIZER_SESSION_TIMEOUT_MS` | `300000` (5 min)                 | timeout sesji podsumowującego                        |
| `CLAUDE_WORKER_MEMORY_DB`                     | `./data/memory.db`               | baza pamięci długoterminowej                         |
| `CLAUDE_WORKER_TASKS_FILE`                    | `./data/tasks.json`              | magazyn zadań                                        |
| `CLAUDE_WORKER_LOGS_DIR`                      | `./logs`                         | katalog logów sesji                                  |
| `CLAUDE_WORKER_STREAM_PARTIAL`                | `true`                           | strumieniowanie częściowych odpowiedzi do dashboardu |
| `CLAUDE_WORKER_CWD`                           | `./workspace`                    | katalog roboczy sesji agentów                        |

## Prompty

Cała osobowość skrzata mieszka w `prompts/*.md`:

| Plik                   | Rola                                                  |
| ---------------------- | ----------------------------------------------------- |
| `monitor.system.md`    | kim jest monitor i jak ocenia, co jest zadaniem       |
| `monitor.prompt.md`    | co monitor ma sprawdzać w każdym patrolu              |
| `executor.system.md`   | zasady pracy egzekutora                               |
| `executor.prompt.md`   | szablon zlecenia (opis zadania doklejany na końcu)    |
| `summarizer.system.md` | jak destylować sesję do wniosków wartych zapamiętania |

To tutaj decydujesz, czym skrzat się zajmuje: przeglądaniem PR-ów, pilnowaniem CI, porządkami w backlogu — co tylko opiszesz.

## Bezpieczeństwo

Sesje agentów działają z `--permission-mode bypassPermissions` i pełnym dostępem do narzędzi — skrzat ma wolną rękę w obrębie `CLAUDE_WORKER_CWD` (domyślnie `./workspace`). Wypuszczaj go więc na przemyślanym terenie: dedykowany katalog roboczy, przemyślane prompty, żadnych sekretów w zasięgu. Zadania zgłaszane przez monitor traktuj jak każde wejście do autonomicznego agenta — to prompty definiują granice.

## Development

```bash
pnpm dev              # start z watch (tsx)
pnpm check            # typecheck + lint + format:check + test — przed każdym commitem
pnpm test             # vitest run
pnpm test:coverage    # progi pokrycia wymuszane w vitest.config.ts
pnpm build            # tsup -> dist/
```

Sesje Claude testuje się bez prawdziwego CLI — `test/fixtures/claude` to fałszywa binarka sterowana zmiennymi `FAKE_CLAUDE_*`. Progi pokrycia (statements 92%, lines 94%) są wymuszane, więc nowy kod musi być otestowany.

## Dlaczego „Brownie”?

W folklorze Wysp Brytyjskich **brownie** to domowy duszek, który nocą — kiedy domownicy śpią — po cichu kończy za nich robotę. Ma dwie żelazne zasady: pracuje nieproszony i znika, gdy się go podgląda. Nasz brownie jest odrobinę nowocześniejszy: zamiast miski mleka bierze tokeny, a zamiast zamiatać izbę — domyka Twoje zadania. Podglądać wolno (od tego jest dashboard). 🧹
