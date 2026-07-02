# claude-worker

Długo działający proces konsolowy (worker), który uruchamia dwa współpracujące agenty
Claude Code (`claude -p`):

- **Monitor** — tani model (domyślnie `haiku`), działa cyklicznie w stałym rytmie.
  Jego jedyna rola to wykryć pracę do zrobienia (np. zadania w Redmine, nieodebrane
  maile — cokolwiek opisuje jego prompt) i zgłosić ją jako zadania na trwałą listę.
  Niczego nie wykonuje.
- **Egzekutor** — mocny model (domyślnie `opus`), budzony gdy na liście pojawią się
  nowe zadania. Wykonuje zadania z listy sekwencyjnie — **jedno zadanie = jedna czysta
  sesja** — aż opróżni kolejkę, potem czeka na kolejne.

Obie pętle działają równolegle w jednym procesie: monitor tyka nawet wtedy, gdy
egzekutor pracuje. W danym momencie działa maksymalnie jedna sesja każdego typu.

## Dashboard

`pnpm start` renderuje pełnoekranowy dashboard TUI ([Ink](https://github.com/vadimdemedes/ink)),
odświeżany na żywo:

- **nagłówek** — parametry obu agentów (modele, interwał, okno godzin pracy, timeouty)
  oraz wspólne ustawienia (katalog roboczy, plik magazynu zadań, streaming),
- **panel monitora** — bieżąca faza (cykl w toku / sen z odliczaniem do kolejnego cyklu /
  poza godzinami pracy), podgląd na żywo wyjścia sesji oraz wynik ostatniego cyklu
  (czas, koszt, nowe zadania),
- **panel egzekutora** — bieżące zadanie albo oczekiwanie, podgląd wyjścia sesji
  i wynik ostatniego zadania (czas, koszt, tury),
- **tabela zadań** — liczniki i lista zadań ze statusami
  (`oczekuje` / `w toku` / `wykonane` / `nieudane`, wraz z błędem).

Dashboard zastępuje logi całkowicie; konsola służy wyłącznie do błędów startu
(preflight, konfiguracja, uszkodzony magazyn) oraz kreatorowi `pnpm configure`.

## Lista zadań i deduplikacja

Monitor kończy każdą sesję raportem JSON (kontrakt formatu dokleja do system promptu
sam worker — nie da się go zepsuć edycją własnych promptów). Każde zadanie ma stabilne,
źródłowe `id` (np. `redmine-123`, `email-<message-id>`). Worker parsuje raport
i dopisuje zadania do trwałego magazynu `data/tasks.json` (zapis atomowy), deduplikując
po `id` względem **całej historii** — zadań oczekujących, wykonanych i nieudanych.
Raz widziane zadanie nie wróci na listę, dopóki ręcznie nie usuniesz go z magazynu
(usunięcie wpisu lub całego pliku to zarazem mechanizm ponowienia).

Cykl życia zadania: `pending → in_progress → done | failed`. Po restarcie workera
osierocone `in_progress` wracają do `pending` (zadanie wykona się ponownie — stąd
zalecenie idempotencji w system promptcie egzekutora). Magazyn nie ma locka
międzyprocesowego — na jednym magazynie powinien działać jeden worker.

## Ponawianie błędów przejściowych

Gdy sesja egzekutora padnie z przyczyny przejściowej — timeout sesji albo błąd
API/sieci (np. `API Error: Connection closed mid-response`, `ECONNRESET`,
`overloaded`, rate limit) — zadanie wraca do kolejki i jest ponawiane po krótkiej
przerwie (panel egzekutora pokazuje odliczanie `↻ ponowienie …`). Limit prób obejmuje
wszystkie wykonania zadania (`CLAUDE_WORKER_EXECUTOR_TASK_ATTEMPTS`, domyślnie 3);
po jego wyczerpaniu — oraz przy błędach trwałych (np. model sam zgłosił porażkę,
niezerowy kod wyjścia) — zadanie ląduje w `failed` z opisem błędu. Liczba prób jest
trwała (pole `attempts` w magazynie), więc restart workera nie zeruje licznika.

## Wymagania

- Node.js 22+
- Zainstalowane i zalogowane Claude Code

## Instalacja i konfiguracja

```bash
pnpm install
pnpm configure     # interaktywnie: modele obu agentów, interwał monitora, prompty; tworzy .env i prompts/*.prompt.md
```

Kreator prowadzi przez konfigurację obu agentów: model i interwał monitora, co monitor
ma obserwować, model egzekutora oraz kim jest i jak ma wykonywać zadania; opcjonalnie
osobny katalog konfiguracji Claude Code. Alternatywnie możesz utworzyć `.env` ręcznie
na bazie `.env.example`.

Konfiguracja jest środowiskowa i trzymana w `.env` (plik jest w `.gitignore`, nic nie jest
zahardkodowane w repo):

| Zmienna                                     | Opis                                                  | Domyślnie                      |
| ------------------------------------------- | ----------------------------------------------------- | ------------------------------ |
| `CLAUDE_WORKER_MONITOR_MODEL`               | Model monitora (z założenia tani)                     | `haiku`                        |
| `CLAUDE_WORKER_MONITOR_INTERVAL_MS`         | Interwał między cyklami monitora (ms)                 | `900000` (15 min)              |
| `CLAUDE_WORKER_MONITOR_PROMPT_FILE`         | Prompt monitora (co obserwować)                       | `./prompts/monitor.prompt.md`  |
| `CLAUDE_WORKER_MONITOR_SYSTEM_PROMPT_FILE`  | System prompt monitora (definicja roli)               | `./prompts/monitor.system.md`  |
| `CLAUDE_WORKER_MONITOR_SESSION_TIMEOUT_MS`  | Twardy limit sesji monitora                           | brak                           |
| `CLAUDE_WORKER_EXECUTOR_MODEL`              | Model egzekutora (z założenia mocny)                  | `opus`                         |
| `CLAUDE_WORKER_EXECUTOR_PROMPT_FILE`        | Prompt egzekutora (tożsamość, zasady pracy)           | `./prompts/executor.prompt.md` |
| `CLAUDE_WORKER_EXECUTOR_SYSTEM_PROMPT_FILE` | System prompt egzekutora (definicja roli)             | `./prompts/executor.system.md` |
| `CLAUDE_WORKER_EXECUTOR_SESSION_TIMEOUT_MS` | Twardy limit sesji egzekutora                         | brak                           |
| `CLAUDE_WORKER_EXECUTOR_TASK_ATTEMPTS`      | Maks. liczba prób zadania (błędy przejściowe)         | `3`                            |
| `CLAUDE_WORKER_EXECUTOR_RETRY_DELAY_MS`     | Przerwa przed ponowieniem po błędzie przejściowym     | `30000` (30 s)                 |
| `CLAUDE_WORKER_TASKS_FILE`                  | Trwały magazyn zadań (dedup + historia)               | `./data/tasks.json`            |
| `CLAUDE_WORKER_STREAM_PARTIAL`              | Streaming tekstu token-po-tokenie (`true`/`false`)    | `true`                         |
| `CLAUDE_WORKER_CWD`                         | Katalog roboczy sesji (izolacja od kodu agenta)       | `./workspace`                  |
| `CLAUDE_CONFIG_DIR`                         | Osobny katalog konfiguracji Claude Code (inny profil) | brak                           |

Sesje obu agentów działają zawsze w trybie `bypassPermissions` (na stałe w kodzie) —
worker jest w pełni autonomiczny i żadne narzędzie nie czeka na zatwierdzenie. Kontrola
nad tym, co agenci robią, leży w promptach i izolacji katalogu roboczego
(`CLAUDE_WORKER_CWD`).

## Uruchomienie

```bash
pnpm start                       # używa ./.env
pnpm start --env-file ./inny.env
```

Zatrzymanie: `Ctrl+C` (SIGINT) — dashboard pokazuje komunikat zamykania, obie pętle
kończą się, a ewentualne trwające sesje są ubijane. Zadanie przerwane w trakcie
wykonywania wróci do `pending` przy kolejnym starcie.

Przy `CLAUDE_WORKER_STREAM_PARTIAL=true` tekst sesji spływa do paneli na żywo
(token po tokenie); każdy agent ma własny panel, więc strumienie się nie przeplatają.

## Jakość kodu

```bash
pnpm check        # wszystko naraz: typecheck + lint + format:check + test
pnpm typecheck    # tsc --noEmit
pnpm lint         # ESLint (typescript-eslint, type-aware)
pnpm lint:fix     # ESLint z auto-poprawkami
pnpm format       # Prettier --write
pnpm format:check # Prettier --check
pnpm test         # Vitest
```

## Wybór konfiguracji Claude Code

Worker uruchamia komendę `claude`. Aby użyć innego profilu Claude Code (osobne MCP,
subskrypcja), ustaw `CLAUDE_CONFIG_DIR` na wybrany katalog konfiguracji — jest on
przekazywany wprost do procesu Claude (obsługiwane jest `~`). Bez tej zmiennej używana
jest domyślna konfiguracja Claude Code.

## Izolacja sesji

Każda sesja (monitora i egzekutora) działa w dedykowanym katalogu roboczym
(`./workspace`, tworzonym automatycznie). Katalog jest podrzędny wobec kodu agenta,
a Claude Code ogranicza operacje na plikach do swojego katalogu roboczego
i podkatalogów — dzięki temu sesja nie sięga do źródeł workera ani nie może modyfikować
samej siebie. Magazyn zadań (`data/`) leży poza `workspace/`, więc sesje nie mają do
niego dostępu. `workspace/` i `data/` są w `.gitignore`. Zmień lokalizacje przez
`CLAUDE_WORKER_CWD` i `CLAUDE_WORKER_TASKS_FILE`.

## Prompty agentów

Każdy agent ma własną parę plików:

- `prompts/monitor.system.md`, `prompts/executor.system.md` — **definicje ról**
  (czym agent jest, co mu wolno), wspólne dla wszystkich środowisk, wersjonowane w repo.
- `prompts/monitor.prompt.md`, `prompts/executor.prompt.md` — **tożsamość agenta**
  (co konkretnie monitorować / kim jest egzekutor i jak pracuje), specyficzne dla
  środowiska (poza repo, w `.gitignore`). Tworzone przez `pnpm configure` lub ręcznie.

Wszystkie pliki są wczytywane przy każdym starcie sesji — edycja nie wymaga restartu
workera. Do system promptu monitora worker dokleja techniczny kontrakt raportu JSON,
a do system promptu egzekutora kontrakt „jedno zadanie na sesję”.
