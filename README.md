# Apple TV Remote for Raycast

Control your Apple TV from Raycast — no Python, no helper apps, no external installs. Pure TypeScript over Apple's Companion protocol.

## Features

- **Apple TV Remote** — full remote in a Raycast view: d-pad, select, back, home, playback, volume, and typing into TV search fields. Holds a live connection, so keypresses are instant.
- **Launch Apple TV App** — grid of every app installed on your Apple TV; open any of them.
- **Play/Pause** & **Go to Home Screen** — `no-view` commands you can bind to global hotkeys.
- **Menu bar** — quick playback/navigation/power controls from the macOS menu bar.
- **AI commands** — talk to your TV from Raycast AI chat: `@apple-tv-remote pause`, `@apple-tv-remote open Netflix`, `@apple-tv-remote play Rick and Morty on Netflix` (deep-links straight into supported apps).

## Setup

1. Run **Set up Apple TV**.
2. Pick your Apple TV from the list (or add it by IP if discovery is blocked on your network).
3. Type the 4-digit PIN that appears on your TV. Done.

> Pairing is interactive by design — the Apple TV generates a PIN on screen — which is why setup is a command rather than extension preferences.

### Remote shortcuts

| Control | Shortcut |
|---|---|
| D-pad | `⌘↑` `⌘↓` `⌘←` `⌘→` |
| Select / Back | `⌘↩` / `⌘⌫` |
| Home / App Switcher | `⌘H` / `⌘⇧H` |
| Play/Pause | `↩` |
| Next / Previous | `⌘]` / `⌘[` |
| Volume | `⌘=` / `⌘-` |
| Type text on TV | `⌘T` |

## How it works

The extension speaks Apple's **Companion protocol** (the same one the iOS Remote app and Shortcuts use) directly from Raycast's Node runtime, via [`@bharper/atv-js`](https://github.com/bsharper/atvjs) — a pure-TypeScript port of [pyatv](https://pyatv.dev). Discovery is Bonjour (`_companion-link._tcp`), pairing is HAP SRP with the on-screen PIN, and the session is chacha20-poly1305 encrypted. App launching, app listing, and sleep/wake are implemented in this extension on top of the library, ported from pyatv's reference implementation.

### Credential storage

Pairing produces machine-generated key material (not a user-entered secret), so it is kept in Raycast's encrypted [LocalStorage](https://developers.raycast.com/api-reference/storage) database, scoped to this extension. The extension never touches the macOS Keychain and sends nothing off your local network.

### AI features

Natural-language commands use Raycast AI (Pro). Without Pro, everything else works — and "play X on Netflix" style requests gracefully degrade to opening the app.

## Credits

- [pyatv](https://pyatv.dev) by Pierre Ståhl (MIT) — the reference implementation and protocol documentation that makes all of this possible.
- [`@bharper/atv-js`](https://github.com/bsharper/atvjs) by Brian Harper (ISC/MIT) — the TypeScript Companion-protocol port.

## License

MIT
