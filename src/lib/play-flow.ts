import { AppleTVConnection, getKeyboardFocusState, setText } from "@bharper/atv-js";
import { withConnection } from "./connection";
import { launchApp } from "./companion-extras";
import { resolveAppName } from "./deep-links";
import { pickOffer, searchTitle } from "./justwatch";

/**
 * The "play <title> [on <app>]" flow, shared by the AI tool and the Ask command.
 *
 * Strategy, in order of reliability:
 * 1. JustWatch-resolved deep link (real per-provider URL, no guessed IDs) —
 *    works for Apple TV+, Disney+, Max, and most others.
 * 2. Netflix (whose tvOS deep links broke in Sept 2025) and unresolvable
 *    titles fall back to tvOS universal Search: launch the system Search app,
 *    wait for the on-screen keyboard (a real Companion text-input session —
 *    verifiable!), and type the title. Selecting a result deep-links natively.
 * 3. Bare app launch as the last resort.
 */

const TV_SEARCH_BUNDLE = "com.apple.TVSearch";

/** Providers whose web URLs don't deep-link on tvOS — route via universal search. */
const BROKEN_DEEP_LINK_PROVIDERS = new Set(["netflix", "netflixbasicwithads"]);

const PROVIDER_BUNDLES: Record<string, string> = {
  netflix: "com.netflix.Netflix",
  netflixbasicwithads: "com.netflix.Netflix",
  disneyplus: "com.disney.disneyplus",
  max: "com.wbd.stream",
  hbomax: "com.wbd.stream",
  appletvplus: "com.apple.TVWatchList",
  itunes: "com.apple.TVWatchList",
  hulu: "com.hulu.plus",
  amazonprimevideo: "com.amazon.aiv.AIVApp",
  amazonprime: "com.amazon.aiv.AIVApp",
  youtube: "com.google.ios.youtube",
};

/** Per-app URL fixups for tvOS routing quirks. */
function adaptUrlForTvos(url: string, technicalName: string): string {
  if (technicalName === "youtube") {
    // The scheme form routes reliably on tvOS; plain https is flaky.
    const id = url.match(/[?&]v=([\w-]+)/)?.[1];
    if (id) return `youtube://www.youtube.com/watch?v=${id}`;
  }
  if (technicalName === "appletvplus" || technicalName === "itunes") {
    return url.includes("?") ? `${url}&action=play` : `${url}?action=play`;
  }
  return url;
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Launch tvOS universal Search, wait for its keyboard to focus (detected via
 * the Companion text-input session), and type the title. Returns true once the
 * text was verifiably delivered to the on-screen search field.
 */
async function typeIntoUniversalSearch(conn: AppleTVConnection, title: string): Promise<boolean> {
  await launchApp(conn, TV_SEARCH_BUNDLE);
  for (let attempt = 0; attempt < 16; attempt++) {
    await delay(500);
    try {
      if (await getKeyboardFocusState(conn)) {
        await setText(conn, title);
        return true;
      }
    } catch {
      // keyboard session not up yet — keep waiting
    }
  }
  return false;
}

export interface PlayResult {
  ok: boolean;
  message: string;
}

export async function playContent(title: string, appHint?: string): Promise<PlayResult> {
  // 1. Deterministic resolution (cached, keyless).
  let resolvedTitle: Awaited<ReturnType<typeof searchTitle>> = null;
  try {
    resolvedTitle = await searchTitle(title);
  } catch {
    // offline or API hiccup — fall through to search/app-launch paths
  }

  const offer = resolvedTitle ? pickOffer(resolvedTitle, appHint) : null;
  const displayTitle = resolvedTitle?.title ?? title;

  // 2. Direct deep link when the provider supports it on tvOS.
  if (offer && !BROKEN_DEEP_LINK_PROVIDERS.has(offer.provider.technicalName)) {
    const url = adaptUrlForTvos(offer.url, offer.provider.technicalName);
    await withConnection((conn) => launchApp(conn, url));
    return { ok: true, message: `Opening ${displayTitle} in ${offer.provider.clearName}` };
  }

  // 3. Universal Search flow (Netflix & friends, or unresolved titles).
  const typed = await withConnection((conn) => typeIntoUniversalSearch(conn, displayTitle));
  if (typed) {
    const where = offer ? ` — it's on ${offer.provider.clearName}` : "";
    return {
      ok: true,
      message: `Typed “${displayTitle}” into Apple TV Search${where}. Pick the result on screen.`,
    };
  }

  // 4. Last resort: open the most plausible app.
  const bundleFromOffer = offer ? PROVIDER_BUNDLES[offer.provider.technicalName] : undefined;
  const fromHint = appHint ? resolveAppName(appHint) : null;
  const bundleId = bundleFromOffer ?? fromHint?.bundleId;
  if (bundleId) {
    await withConnection((conn) => launchApp(conn, bundleId));
    const appName = offer?.provider.clearName ?? fromHint?.name ?? "the app";
    return { ok: true, message: `Opened ${appName} — search for “${displayTitle}” there.` };
  }

  return {
    ok: false,
    message: `Couldn't find “${title}” or a matching app. Try “play ${title} on Netflix”.`,
  };
}
