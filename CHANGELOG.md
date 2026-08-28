# Apple TV Remote Changelog

## [App list on tvOS 26, honest failures, pairing help] - {PR_MERGE_DATE}

- The installed-app list works again on tvOS 26. The extension now opens a TV Remote Client session on connect, which tvOS requires before it will answer the app-list query. Launch Apple TV App shows everything installed, and "open <app>" resolves against it
- A refused launch is now reported as a failure instead of "Launched". tvOS answers a rejected request with an error frame that previously read as success. Deep links that the TV refuses fall back to universal search
- Pairing help on the setup screen: what to do when no PIN appears (restart the Apple TV; a tvOS 26 bug can finish the handshake without drawing it) and why repeated failed attempts should wait for a restart
- Inline validation on the pairing and manual-IP forms
- Menu bar buttons report a failure instead of doing nothing when the Ask Apple TV command is unavailable. Ask Apple TV failures show as toasts
- Fix: a very short app name could launch an unrelated app whose name contained it

## [Menu bar icon] - {PR_MERGE_DATE}

- New menu bar icon: an Apple TV remote that adapts to light and dark

## [Update store icon] - 2026-07-03

- New extension icon featuring the Apple TV Siri Remote

## [Apple TV Remote] - 2026-07-01

- Visual Apple TV remote with a persistent connection, clickable button grid plus a no-modifier keyboard layer (WASD/HJKL, F select, Space play/pause) and ⌥-shortcuts
- Bonjour discovery + on-screen PIN pairing, with manual IP/port fallback
- Full Siri Remote function set ported from pyatv: context menu (hold-select), app switcher, Control Center, ±10s skip, sleep/wake, screensaver
- App launcher grid backed by the device's live app list, with hotkey-able Quicklinks per app
- Ask Apple TV: one-shot natural-language commands (pause, open an app, type text, play a show)
- Title playback via real JustWatch-resolved deep links where tvOS supports them, with an Apple TV universal-search typing flow for Netflix and unresolved titles
- Menu bar quick controls and per-key commands (disabled by default) for global hotkeys
- AI tools: press remote keys, launch apps, play content, sleep/wake, usable from Raycast AI chat and Quick AI
