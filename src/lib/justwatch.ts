import { LocalStorage, getPreferenceValues } from "@raycast/api";

/**
 * Deterministic title → streaming deep-link resolution via JustWatch's GraphQL
 * API (the same backend justwatch.com uses — keyless, non-commercial use).
 * This replaces LLM-guessed title IDs with real per-provider URLs.
 * Results are cached for 24h to keep API usage polite.
 */

const GRAPHQL_URL = "https://apis.justwatch.com/graphql";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const SEARCH_QUERY = `query GetSearchTitles($searchTitlesFilter: TitleFilter!, $country: Country!, $language: Language!, $first: Int!, $filter: OfferFilter!) {
  popularTitles(country: $country, filter: $searchTitlesFilter, first: $first, sortBy: POPULAR, sortRandomSeed: 0) {
    edges {
      node {
        objectType
        content(country: $country, language: $language) {
          title
          originalReleaseYear
        }
        ... on MovieOrShowOrSeason {
          offers(country: $country, platform: WEB, filter: $filter) {
            monetizationType
            standardWebURL
            package {
              technicalName
              shortName
              clearName
            }
          }
        }
      }
    }
  }
}`;

export interface StreamingOffer {
  url: string;
  monetizationType: string;
  provider: { technicalName: string; shortName: string; clearName: string };
}

export interface ResolvedTitle {
  title: string;
  year: number | null;
  type: string;
  offers: StreamingOffer[];
}

function country(): string {
  const prefs = getPreferenceValues<{ country?: string }>();
  const c = (prefs.country ?? "US").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(c) ? c : "US";
}

export async function searchTitle(query: string): Promise<ResolvedTitle | null> {
  const cacheKey = `atv:jw:${country()}:${query.toLowerCase()}`;
  const cached = await LocalStorage.getItem<string>(cacheKey);
  if (cached) {
    const { value, at } = JSON.parse(cached) as { value: ResolvedTitle | null; at: number };
    if (Date.now() - at < CACHE_TTL_MS) return value;
  }

  const response = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      operationName: "GetSearchTitles",
      variables: {
        first: 3,
        searchTitlesFilter: { searchQuery: query },
        country: country(),
        language: "en",
        filter: { bestOnly: true },
      },
      query: SEARCH_QUERY,
    }),
  });
  if (!response.ok) throw new Error(`JustWatch lookup failed (HTTP ${response.status})`);

  const json = (await response.json()) as {
    data?: {
      popularTitles?: {
        edges?: {
          node: {
            objectType: string;
            content?: { title?: string; originalReleaseYear?: number };
            offers?: {
              monetizationType?: string;
              standardWebURL?: string;
              package?: { technicalName?: string; shortName?: string; clearName?: string };
            }[];
          };
        }[];
      };
    };
  };

  const node = json.data?.popularTitles?.edges?.[0]?.node;
  const value: ResolvedTitle | null = node
    ? {
        title: node.content?.title ?? query,
        year: node.content?.originalReleaseYear ?? null,
        type: node.objectType,
        offers: (node.offers ?? [])
          .filter((o) => o.standardWebURL && o.package?.technicalName)
          .map((o) => ({
            url: o.standardWebURL as string,
            monetizationType: o.monetizationType ?? "UNKNOWN",
            provider: {
              technicalName: o.package?.technicalName ?? "",
              shortName: o.package?.shortName ?? "",
              clearName: o.package?.clearName ?? "",
            },
          })),
      }
    : null;

  await LocalStorage.setItem(cacheKey, JSON.stringify({ value, at: Date.now() }));
  return value;
}

/**
 * Pick the best offer: an explicit provider request wins, then subscription
 * (FLATRATE) offers, then anything else.
 */
export function pickOffer(resolved: ResolvedTitle, providerHint?: string): StreamingOffer | null {
  if (resolved.offers.length === 0) return null;

  if (providerHint) {
    const hint = providerHint.trim().toLowerCase();
    const match = resolved.offers.find(
      (o) =>
        o.provider.technicalName.includes(hint.replace(/[^a-z0-9]/g, "")) ||
        o.provider.clearName.toLowerCase().includes(hint) ||
        hint.includes(o.provider.clearName.toLowerCase()),
    );
    if (match) return match;
  }

  return resolved.offers.find((o) => o.monetizationType === "FLATRATE") ?? resolved.offers[0];
}
