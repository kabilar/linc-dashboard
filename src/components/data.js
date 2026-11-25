import { useEffect, useState } from "react";
import Papa from "papaparse";
import useBaseUrl from "@docusaurus/useBaseUrl";

// Archives indexed by extract_metadata.py, keyed by the `Archive` column.
export const ARCHIVES = {
  LINC: { host: "lincbrain.org", url: "https://lincbrain.org" },
  DANDI: { host: "dandiarchive.org", url: "https://dandiarchive.org" },
};
const ARCHIVE_ORDER = Object.keys(ARCHIVES);
const DEFAULT_ARCHIVE = "LINC";

function archiveOf(row) {
  return ARCHIVES[row.Archive] ? row.Archive : DEFAULT_ARCHIVE;
}

// Dataset identifier including its archive, e.g. "LINC:000003" or "DANDI:001412".
export function datasetId(row) {
  return `${archiveOf(row)}:${row.Dataset}`;
}

// Sort key that lists datasets by archive (in ARCHIVES order), then by ID.
export function datasetSortKey(row) {
  return `${ARCHIVE_ORDER.indexOf(archiveOf(row))}:${row.Dataset}`;
}

// Fetch and parse a CSV file from the `static/` directory.
// Every value is kept as a string (e.g. dataset IDs such as "000003" must keep
// their leading zeros); numeric columns are converted by the caller.
export function useCsv(fileName) {
  const url = useBaseUrl(`/${fileName}`);
  const [state, setState] = useState({ rows: null, error: null });

  useEffect(() => {
    const controller = new AbortController();
    setState({ rows: null, error: null });

    fetch(url, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`${response.status} ${response.statusText}`);
        }
        return response.text();
      })
      .then((text) => {
        const { data } = Papa.parse(text, {
          header: true,
          skipEmptyLines: true,
          dynamicTyping: false,
        });
        setState({ rows: data, error: null });
      })
      .catch((error) => {
        if (error.name !== "AbortError") {
          setState({ rows: null, error });
        }
      });

    return () => controller.abort();
  }, [url]);

  return { ...state, url };
}

// "a, b,c" -> ["a", "b", "c"]
export function splitList(value) {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

const numberFormat = new Intl.NumberFormat("en-US");
const decimalFormat = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatNumber(value) {
  return numberFormat.format(value);
}

export function formatDecimal(value) {
  return decimalFormat.format(value);
}

export const PRODUCED_DESCRIPTION = "Last-modified date of the file when it was uploaded (UTC)";
export const UPLOADED_DESCRIPTION = "Date the file was uploaded to the archive (UTC)";

// Decimal (SI) units, consistent with `Size (GB)` in extract_metadata.py.
const BYTE_UNITS = ["B", "kB", "MB", "GB", "TB", "PB"];

export function formatBytes(bytes) {
  if (!bytes) return "0 B";
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < BYTE_UNITS.length - 1) {
    value /= 1000;
    unit += 1;
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1;
  return `${value.toFixed(digits)} ${BYTE_UNITS[unit]}`;
}

// Sort labels naturally ("I35" < "I58" < "MF162"), keeping catch-all values
// such as "Unknown" at the end.
const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
const TRAILING_VALUES = ["Unknown", "n/a"];

export function compareLabels(a, b) {
  // indexOf is -1 for regular values, so they sort before the trailing ones.
  const rankA = TRAILING_VALUES.indexOf(a);
  const rankB = TRAILING_VALUES.indexOf(b);
  if (rankA !== rankB) return rankA - rankB;
  return collator.compare(a, b);
}

// Link to a dataset on its archive (lincbrain.org or dandiarchive.org).
export function datasetUrl(row) {
  return `${ARCHIVES[archiveOf(row)].url}/dandiset/${row.Dataset}/${row.Version || "draft"}`;
}

// Link to the folder that contains an asset in its archive's file browser.
export function assetFolderUrl(row) {
  const folder = row.Path.includes("/") ? row.Path.slice(0, row.Path.lastIndexOf("/")) : "";
  const base = `${datasetUrl(row)}/files`;
  return folder ? `${base}?location=${encodeURIComponent(folder)}` : base;
}
