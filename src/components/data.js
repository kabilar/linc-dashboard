import { useEffect, useState } from "react";
import Papa from "papaparse";
import useBaseUrl from "@docusaurus/useBaseUrl";

export const LINCBRAIN_URL = "https://lincbrain.org";

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

export function datasetUrl(dataset, version = "draft") {
  return `${LINCBRAIN_URL}/dandiset/${dataset}/${version || "draft"}`;
}

// Link to the folder that contains an asset in the lincbrain.org file browser.
export function assetFolderUrl(dataset, version, path) {
  const folder = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  const base = `${datasetUrl(dataset, version)}/files`;
  return folder ? `${base}?location=${encodeURIComponent(folder)}` : base;
}
