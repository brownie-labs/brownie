# Recorded from the repo root: pnpm build && node scripts/demo/setup.mjs && vhs scripts/demo/demo.tape
# The fake `claude` in this directory plays scripted sessions — no real API calls.

Output assets/demo.gif

Set Shell bash
Set FontSize 15
Set Width 1200
Set Height 720
Set Padding 12
Set TypingSpeed 70ms

Hide
Type `REPO="$PWD"; export PATH="$REPO/scripts/demo:$PATH"; brownie() { HOME="$REPO/scripts/demo" node "$REPO/dist/index.js"; }; node scripts/demo/setup.mjs; cd scripts/demo/acme-shop; clear`
Enter
Sleep 1s
Show

Type "brownie"
Sleep 500ms
Enter
Sleep 3s

Type "/start"
Sleep 1s
Enter

Sleep 7s
Sleep 12s
Sleep 14s
