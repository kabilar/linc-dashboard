// Data and filters shared by the home page and the Datasets page, which show
// the same files from different angles.
import { useDeferredValue, useMemo } from "react";
import useUrlFilters, { filtersToSearch } from "./useUrlFilters";
import { MODALITIES, UNKNOWN_MODALITY, compareModalities } from "./modalities";
import { datasetId, toNumber } from "./data";

// Filters and their URL query parameters
export const OVERVIEW_FILTERS = {
  Modality: { param: "modality", multi: true },
  Archive: { param: "archive" },
  Dates: { param: "dates" }, // "" (produced) or "uploaded"
  From: { param: "from" }, // "YYYY-MM"
  To: { param: "to" }, // "YYYY-MM"
};

export const INVALID_BIDS = "Invalid";

// Values of the Subject column that are not subjects
export const NOT_SUBJECTS = new Set(["n/a", "Unknown"]);

// A file's sample as subject/label, or "" if it has none
export function sampleKey(file) {
  return file.Sample ? `${file.Subject}/${file.Sample}` : "";
}

// The query string of a link to the Files page that keeps these filters, e.g.
// for the files behind a number or a chart mark: `changes` replace some of
// them, and `extra` adds filters of the Files page, e.g. { subject: "MF284" }.
export function filesQuery(filters, changes = {}, extra = {}) {
  const params = new URLSearchParams(filtersToSearch(OVERVIEW_FILTERS, { ...filters, ...changes }));
  for (const [param, value] of Object.entries(extra)) params.set(param, value);
  return params.toString();
}

// The date the Dates filter goes by
export function basisOf(filters) {
  return filters.Dates === "uploaded" ? "Uploaded" : "Produced";
}

export function prepareFiles(rows) {
  return rows.map((row) => {
    const id = datasetId(row);
    return {
      Archive: id.split(":")[0],
      Dataset: row.Dataset,
      DatasetId: id,
      Subject: row.Subject || "Unknown",
      // The tissue sample, e.g. slice079; labels are only unique within a subject
      Sample: row.Sample || "",
      Modality: row.Modality || UNKNOWN_MODALITY,
      Extension: row.Extension || "",
      size: toNumber(row["Size (bytes)"]),
      Produced: row.Produced || "",
      Uploaded: row.Uploaded || "",
      BIDS: row.BIDS || "",
    };
  });
}

export function applyFilters(files, filters, basis) {
  const modalities = new Set(filters.Modality);
  const { Archive: archive, From: from, To: to } = filters;
  return files.filter((file) => {
    if (modalities.size && !modalities.has(file.Modality)) return false;
    if (archive && file.Archive !== archive) return false;
    if (from || to) {
      const month = file[basis].slice(0, 7);
      if (!month || (from && month < from) || (to && month > to)) return false;
    }
    return true;
  });
}

// Total size in bytes of the files with each value of `key`
export function sizeBy(files, key) {
  const sizes = new Map();
  for (const file of files) sizes.set(file[key], (sizes.get(file[key]) ?? 0) + file.size);
  return sizes;
}

export function summarizeModalities(files, modalities) {
  return modalities.map((modality) => {
    const matching = files.filter((file) => file.Modality === modality);
    return {
      Modality: modality,
      "Size (GB)": matching.reduce((sum, file) => sum + file.size, 0) / 1000 ** 3,
      Subject: [...new Set(matching.map((file) => file.Subject))].join(","),
      Extension: [...new Set(matching.map((file) => file.Extension).filter(Boolean))].join(","),
    };
  });
}

/**
 * The files of the assets CSV, the filters (kept in the URL, and carried
 * between the home page and the Datasets page) and the files they select.
 *
 * Returns { filters, setFilters, deferred, isStale, files, filtered, basis,
 * modalities, scope }: `deferred` lags behind `filters` while the page catches
 * up, `modalities` lists every modality and `scope` the selected ones (or all).
 */
export function useOverview(rows) {
  const [filters, setFilters] = useUrlFilters(OVERVIEW_FILTERS, { carry: "overview" });
  const deferred = useDeferredValue(filters);
  const files = useMemo(() => prepareFiles(rows), [rows]);
  const basis = basisOf(deferred);
  const filtered = useMemo(() => applyFilters(files, deferred, basis), [files, deferred, basis]);
  const modalities = useMemo(
    () => [...new Set([...MODALITIES.map((m) => m.name), ...files.map((file) => file.Modality)])].sort(compareModalities),
    [files],
  );
  const scope = useMemo(
    () => (deferred.Modality.length ? [...deferred.Modality].sort(compareModalities) : modalities),
    [deferred.Modality, modalities],
  );
  return { filters, setFilters, deferred, isStale: deferred !== filters, files, filtered, basis, modalities, scope };
}
