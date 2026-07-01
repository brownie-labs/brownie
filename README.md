# claude-worker

Długo działający proces konsolowy (worker), który w stałym rytmie uruchamia
jednorazowe sesje Claude Code (`claude -p`). Prompt i system prompt pochodzą z plików
`.md`. Live logi renderowane są przez [consola](https://github.com/unjs/consola).

W danym momencie działa maksymalnie **jedna sesja**. Jeśli sesja przekroczy interwał,
kolejna startuje natychmiast po jej zakończeniu (rytm liczony od startu sesji, bez nakładania).

## Wymagania

- Node.js 20.6+ (wbudowana obsługa `.env`)
- Zainstalowane i zalogowane Claude Code

## Instalacja i konfiguracja

```bash
pnpm install
pnpm configure     # interaktywnie: pyta o model, interwał i prompt; tworzy .env oraz prompts/prompt.md
```

`pnpm configure` pyta o model, interwał (w minutach) oraz zadanie workera, a opcjonalnie
o osobny katalog konfiguracji Claude Code, i zapisuje `.env` oraz `prompts/prompt.md`.
Alternatywnie możesz utworzyć `.env` ręcznie na bazie `.env.example`.

Konfiguracja jest środowiskowa i trzymana w `.env` (plik jest w `.gitignore`, nic nie jest
zahardkodowane w repo):

| Zmienna | Opis | Domyślnie |
|---------|------|-----------|
| `CLAUDE_WORKER_MODEL` | Model sesji | `haiku` |
| `CLAUDE_WORKER_INTERVAL_MS` | Interwał między startami sesji (ms) | `300000` (5 min) |
| `CLAUDE_WORKER_PERMISSION_MODE` | `default` / `acceptEdits` / `bypassPermissions` / `plan` | brak |
| `CLAUDE_WORKER_SESSION_TIMEOUT_MS` | Twardy limit sesji (kill po przekroczeniu) | brak |
| `CLAUDE_WORKER_STREAM_PARTIAL` | Streaming tekstu token-po-tokenie (`true`/`false`) | `false` |
| `CLAUDE_WORKER_CWD` | Katalog roboczy sesji (izolacja od kodu agenta) | `./workspace` |
| `CLAUDE_CONFIG_DIR` | Osobny katalog konfiguracji Claude Code (inny profil) | brak |

## Uruchomienie

```bash
pnpm start                       # używa ./.env
pnpm start --env-file ./inny.env
```

Zatrzymanie: `Ctrl+C` (SIGINT) — worker kończy pętlę i ubija ewentualną trwającą sesję.

## Wybór konfiguracji Claude Code

Worker uruchamia komendę `claude`. Aby użyć innego profilu Claude Code (osobne MCP,
subskrypcja), ustaw `CLAUDE_CONFIG_DIR` na wybrany katalog konfiguracji — jest on
przekazywany wprost do procesu Claude (obsługiwane jest `~`). Bez tej zmiennej używana
jest domyślna konfiguracja Claude Code.

## Izolacja sesji

Każda sesja działa w dedykowanym katalogu roboczym (`./workspace`, tworzonym
automatycznie). Katalog jest podrzędny wobec kodu agenta, a Claude Code ogranicza
operacje na plikach do swojego katalogu roboczego i podkatalogów — dzięki temu sesja
nie sięga do źródeł workera ani nie może modyfikować samej siebie. `workspace/` jest
w `.gitignore`. Zmień lokalizację przez `CLAUDE_WORKER_CWD`.

## Prompt i system prompt

- `prompts/system.md` — system prompt, wspólny dla wszystkich, wersjonowany w repo.
- `prompts/prompt.md` — zadanie workera, specyficzne dla środowiska (poza repo,
  w `.gitignore`). Tworzone przez `pnpm configure` lub ręcznie.

Oba pliki są wczytywane przy każdym starcie sesji.
