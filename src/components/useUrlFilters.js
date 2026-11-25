import { useEffect, useRef, useState } from "react";
import { useHistory, useLocation } from "@docusaurus/router";

// Delay before mirroring the filters in the URL, so that typing in a search
// box does not create a new history entry or analytics page view per keystroke.
const URL_SYNC_DELAY_MS = 500;

// `schema` maps each filter to its URL query parameter:
//   { Modality: { param: "modality", multi: true }, Archive: { param: "archive" } }
// Multi-valued filters are arrays (repeated parameters), others strings.
export function readFilters(schema, search) {
  const params = new URLSearchParams(search);
  return Object.fromEntries(
    Object.entries(schema).map(([key, { param, multi }]) => [
      key,
      multi ? params.getAll(param) : params.get(param) ?? "",
    ]),
  );
}

export function emptyFilters(schema) {
  return Object.fromEntries(Object.entries(schema).map(([key, { multi }]) => [key, multi ? [] : ""]));
}

export function filtersToSearch(schema, filters) {
  const params = new URLSearchParams();
  for (const [key, { param, multi }] of Object.entries(schema)) {
    const value = filters[key];
    if (multi) {
      for (const item of value) params.append(param, item);
    } else if (value && value.trim()) {
      params.set(param, value.trim());
    }
  }
  const search = params.toString();
  return search ? `?${search}` : "";
}

export function hasFilters(schema, filters) {
  return Object.entries(schema).some(([key, { multi }]) => (multi ? filters[key].length > 0 : filters[key].trim() !== ""));
}

// Filter state kept in sync with the URL, so that filtered views can be shared
// and bookmarked. `schema` must be a constant.
export default function useUrlFilters(schema) {
  const location = useLocation();
  const history = useHistory();
  const [filters, setFilters] = useState(() => readFilters(schema, location.search));
  const lastSearch = useRef(location.search);

  useEffect(() => {
    const timeout = setTimeout(() => {
      const search = filtersToSearch(schema, filters);
      if (search !== lastSearch.current) {
        lastSearch.current = search;
        history.replace({ search });
      }
    }, URL_SYNC_DELAY_MS);
    return () => clearTimeout(timeout);
  }, [schema, filters, history]);

  // Follow URL changes made elsewhere (e.g. a navbar link to the same page).
  useEffect(() => {
    if (location.search !== lastSearch.current) {
      lastSearch.current = location.search;
      setFilters(readFilters(schema, location.search));
    }
  }, [schema, location.search]);

  return [filters, setFilters];
}
