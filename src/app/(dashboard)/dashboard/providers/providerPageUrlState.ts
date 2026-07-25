import type { ProviderCardHandle } from "./components/ProviderCard";

/**
 * Called before navigating to a provider detail page. Persists the provider
 * id in history.state so the list page can scroll to it on back-navigation.
 */
export function recordProviderNavigation(id: string) {
  window.history.replaceState({ providerId: id }, "");
}

/**
 * Syncs the provider search filter to the URL search params without
 * triggering a Next.js navigation. Preserves the search filter across
 * browser back/forward navigation.
 */
export function syncSearchToUrl(searchQuery: string) {
  const url = new URL(window.location.href);
  if (searchQuery) {
    url.searchParams.set("search", searchQuery);
  } else {
    url.searchParams.delete("search");
  }
  window.history.replaceState(window.history.state, "", url.toString());
}

/**
 * Ref callback for ProviderCard. When the rendered card's provider id
 * matches the highlighted id, scrolls it into view and triggers the
 * highlight animation. Always clears the highlighted id afterward so
 * subsequent re-renders don't re-scroll.
 */
export function resolveHighlightedCard(
  handle: ProviderCardHandle | null,
  highlightedProviderId: string | null,
  onAfterHighlight: () => void
) {
  if (handle?.getProviderId() === highlightedProviderId) {
    handle.scrollIntoView({ behavior: "auto", block: "center" });
    handle.highlight();
  }
  onAfterHighlight();
}
