import { AI, environment } from "@raycast/api";
import { withConnection } from "../lib/connection";
import { launchApp } from "../lib/companion-extras";
import { resolveAppName } from "../lib/deep-links";

type Input = {
  /** Title of the show or movie, e.g. "Rick and Morty" */
  title: string;
  /** Streaming app to use if the user named one, e.g. "Netflix" */
  app?: string;
};

const buildPrompt = (title: string, app?: string): string => `You map a show or movie title to a tvOS deep link.
Title: ${title}
${app ? `Preferred streaming service: ${app}` : "No service was specified by the user; pick the best one."}

Respond with ONLY minified JSON, no prose and no code fences, in exactly this shape:
{"app": string, "url": string|null}

Rules:
- "url" must be a working tvOS deep link for this exact title, or null when you are not confident.
- Netflix deep links look like https://www.netflix.com/title/<numericId>
- Apple TV deep links look like https://tv.apple.com/show/<id>?action=play
- If unsure of the real id, set "url" to null. Never invent ids.
- "app" is your best streaming-service guess for this title${app ? ` (prefer "${app}")` : ""}.`;

function parseAiResponse(raw: string): { app?: string; url?: string | null } | null {
  try {
    const cleaned = raw
      .trim()
      .replace(/^```(?:json)?/i, "")
      .replace(/```$/, "")
      .trim();
    const parsed = JSON.parse(cleaned) as { app?: string; url?: string | null };
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Open a specific show or movie on the Apple TV. Resolves the title to a streaming
 * deep link when possible (Netflix, Apple TV+), otherwise opens the streaming app
 * so the user can search there. Use this whenever the user names a show or movie.
 */
export default async function (input: Input): Promise<string> {
  const requested = input.app ? resolveAppName(input.app) : null;

  let suggestedAppName: string | undefined;
  let deepLink: string | null = null;

  if (environment.canAccess(AI)) {
    try {
      const answer = await AI.ask(buildPrompt(input.title, input.app), { creativity: "none" });
      const parsed = parseAiResponse(answer);
      if (parsed) {
        suggestedAppName = parsed.app;
        deepLink = parsed.url ?? null;
      }
    } catch {
      // Fall through to the bundle-launch fallback below.
    }
  }

  try {
    if (deepLink) {
      await withConnection((conn) => launchApp(conn, deepLink as string));
      return `Opened ${input.title} (deep link) — if the app doesn't support deep links it will just open.`;
    }

    const target = requested ?? (suggestedAppName ? resolveAppName(suggestedAppName) : null);
    if (!target) {
      return `I couldn't tell which app to use for "${input.title}". Tell me the streaming service, e.g. "play ${input.title} on Netflix".`;
    }

    await withConnection((conn) => launchApp(conn, target.bundleId));
    return `Opened ${target.name} — search for ‘${input.title}’ there.`;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}
