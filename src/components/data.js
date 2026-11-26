import { useEffect, useState } from "react";
import Papa from "papaparse";
import useBaseUrl from "@docusaurus/useBaseUrl";

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

export function datasetSortKey(row) {
  return `${ARCHIVE_ORDER.indexOf(archiveOf(row))}:${row.Dataset}`;
}

// Values stay strings, e.g. "000003" keeps its zeros
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

export const PRODUCED_DESCRIPTION = "The file's last-modified date when it was uploaded, in UTC.";
export const UPLOADED_DESCRIPTION = "The date the file was uploaded to the archive, in UTC.";
export const UPLOAD_RANGE_DESCRIPTION = "The first and last dates files were uploaded to the archive, in UTC.";
export const BIDS_DESCRIPTION =
  "Whether the file's path follows the BIDS specification: its folders, entities, suffix and extension, " +
  "checked against the BIDS schema. Files in derivatives/, sourcedata/ and code/, dot files and files " +
  "listed in .bidsignore are not validated.";
export const BIDS_STATUSES = ["Valid", "Invalid", "Not validated"];

// SI units, as in extract_metadata.py
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

// Natural order ("I35" < "I58"), with catch-alls such as "Unknown" last
const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
const TRAILING_VALUES = ["Unknown", "n/a"];

export function compareLabels(a, b) {
  const rankA = TRAILING_VALUES.indexOf(a);
  const rankB = TRAILING_VALUES.indexOf(b);
  if (rankA !== rankB) return rankA - rankB;
  return collator.compare(a, b);
}

export function datasetUrl(row) {
  return `${ARCHIVES[archiveOf(row)].url}/dandiset/${row.Dataset}/${row.Version || "draft"}`;
}

export function assetFolderUrl(row) {
  const folder = row.Path.includes("/") ? row.Path.slice(0, row.Path.lastIndexOf("/")) : "";
  const base = `${datasetUrl(row)}/files`;
  return folder ? `${base}?location=${encodeURIComponent(folder)}` : base;
}
