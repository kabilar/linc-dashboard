import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import Link from "@docusaurus/Link";
import { useHistory, useLocation } from "@docusaurus/router";
import DataTable from "./DataTable";
import LoadingState from "./LoadingState";
import {
  useCsv,
  toNumber,
  formatBytes,
  formatNumber,
  compareLabels,
  ARCHIVES,
  datasetId,
  datasetSortKey,
  datasetUrl,
  assetFolderUrl,
} from "./data";
import styles from "./Files.module.css";

const ASSETS_CSV = "lincbrain_assets.csv";
const NONE = "(none)";

const ARCHIVE_ORDER = Object.keys(ARCHIVES);

// Dropdown filters, in display order. `key` is the field of each file,
// `param` the URL query parameter, `format` the option text, and `compare`
// the option order.
const FILTERS = [
  {
    key: "Archive",
    label: "Archive",
    param: "archive",
    format: (archive) => ARCHIVES[archive]?.host ?? archive,
    compare: (a, b) => ARCHIVE_ORDER.indexOf(a) - ARCHIVE_ORDER.indexOf(b),
  },
  {
    key: "DatasetId",
    label: "Dataset",
    param: "dataset",
    compare: (a, b) => compareLabels(datasetSortKey(splitId(a)), datasetSortKey(splitId(b))),
    // Only list the datasets of the selected archive.
    visible: (option, filters) => !filters.Archive || splitId(option).Archive === filters.Archive,
  },
  { key: "Subject", param: "subject" },
  { key: "Modality", param: "modality" },
  { key: "Extension", param: "extension" },
];
const SEARCH_PARAM = "q";
// Delay before mirroring the filters in the URL, so that typing in the search
// box does not create a new history entry or analytics page view per keystroke.
const URL_SYNC_DELAY_MS = 500;

// "DANDI:001412" -> { Archive: "DANDI", Dataset: "001412" }
function splitId(id) {
  const [Archive, Dataset] = id.split(":");
  return { Archive, Dataset };
}

const COLUMNS = [
  {
    key: "DatasetId",
    label: "Dataset",
    className: styles.nowrap,
    sortValue: datasetSortKey,
    render: (row) => <Link to={datasetUrl(row)}>{row.DatasetId}</Link>,
  },
  { key: "Subject", label: "Subject" },
  { key: "Modality", label: "Modality" },
  {
    key: "Path",
    label: "Path",
    className: styles.path,
    render: (row) => (
      <Link to={assetFolderUrl(row)} title={`Open the folder on ${ARCHIVES[row.Archive]?.host ?? "its archive"}`}>
        {row.Path}
      </Link>
    ),
  },
  { key: "Extension", label: "Extension" },
  {
    key: "size",
    label: "Size",
    align: "right",
    render: (row) => formatBytes(row.size),
  },
];

function readUrl(search) {
  const params = new URLSearchParams(search);
  return {
    filters: Object.fromEntries(FILTERS.map(({ key, param }) => [key, params.get(param) ?? ""])),
    query: params.get(SEARCH_PARAM) ?? "",
  };
}

function writeUrl(filters, query) {
  const params = new URLSearchParams();
  for (const { key, param } of FILTERS) {
    if (filters[key]) params.set(param, filters[key]);
  }
  if (query.trim()) params.set(SEARCH_PARAM, query.trim());
  const search = params.toString();
  return search ? `?${search}` : "";
}

function FilesTable({ rows, csvUrl }) {
  const location = useLocation();
  const history = useHistory();
  const [filters, setFilters] = useState(() => readUrl(location.search).filters);
  const [query, setQuery] = useState(() => readUrl(location.search).query);
  const deferredFilters = useDeferredValue(filters);
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());

  // Keep the URL in sync so that filtered views can be shared and bookmarked.
  const lastSearch = useRef(location.search);
  useEffect(() => {
    const timeout = setTimeout(() => {
      const search = writeUrl(filters, query);
      if (search !== lastSearch.current) {
        lastSearch.current = search;
        history.replace({ search });
      }
    }, URL_SYNC_DELAY_MS);
    return () => clearTimeout(timeout);
  }, [filters, query, history]);

  // Follow URL changes made elsewhere (e.g. the "All Files" navbar link).
  useEffect(() => {
    if (location.search !== lastSearch.current) {
      lastSearch.current = location.search;
      const state = readUrl(location.search);
      setFilters(state.filters);
      setQuery(state.query);
    }
  }, [location.search]);

  const files = useMemo(
    () =>
      rows.map((row, index) => {
        const file = { ...row, id: index, size: toNumber(row["Size (bytes)"]) };
        file.DatasetId = datasetId(row);
        file.Archive = splitId(file.DatasetId).Archive;
        for (const { key } of FILTERS) {
          if (!file[key]) file[key] = NONE;
        }
        file.searchText = [file.DatasetId, file.Subject, file.Modality, file.Path, file.Extension]
          .join(" ")
          .toLowerCase();
        return file;
      }),
    [rows],
  );

  // Options for each dropdown, with the number of files for each value.
  const options = useMemo(() => {
    const result = {};
    for (const { key, compare = compareLabels } of FILTERS) {
      const counts = new Map();
      for (const file of files) counts.set(file[key], (counts.get(file[key]) ?? 0) + 1);
      result[key] = [...counts].sort(([a], [b]) => compare(a, b));
    }
    return result;
  }, [files]);

  const filteredFiles = useMemo(
    () =>
      files.filter(
        (file) =>
          FILTERS.every(({ key }) => !deferredFilters[key] || file[key] === deferredFilters[key]) &&
          (!deferredQuery || file.searchText.includes(deferredQuery)),
      ),
    [files, deferredFilters, deferredQuery],
  );

  const totalSize = useMemo(() => filteredFiles.reduce((sum, file) => sum + file.size, 0), [filteredFiles]);
  const isFiltered = query.trim() !== "" || FILTERS.some(({ key }) => filters[key]);
  const isStale = deferredFilters !== filters || deferredQuery !== query.trim().toLowerCase();

  function changeFilter(key, value) {
    const next = { ...filters, [key]: value };
    // A dataset from another archive would match nothing.
    if (key === "Archive" && value && next.DatasetId && splitId(next.DatasetId).Archive !== value) {
      next.DatasetId = "";
    }
    setFilters(next);
  }

  function clearFilters() {
    setFilters(Object.fromEntries(FILTERS.map(({ key }) => [key, ""])));
    setQuery("");
  }

  return (
    <>
      <div className={styles.toolbar}>
        <label className={styles.search}>
          <span>Search</span>
          <input
            type="search"
            value={query}
            placeholder="Path, dataset, subject, modality…"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        {FILTERS.map(({ key, label = key, format = (option) => option, visible = () => true }) => {
          const value = filters[key];
          const choices = options[key].filter(([option]) => option === value || visible(option, filters));
          const known = choices.some(([option]) => option === value);
          return (
            <label key={key} className={styles.filter}>
              <span>{label}</span>
              <select value={value} onChange={(event) => changeFilter(key, event.target.value)}>
                <option value="">All</option>
                {value && !known && <option value={value}>{format(value)} (0)</option>}
                {choices.map(([option, count]) => (
                  <option key={option} value={option}>
                    {format(option)} ({formatNumber(count)})
                  </option>
                ))}
              </select>
            </label>
          );
        })}
        {isFiltered && (
          <button type="button" className={styles.clear} onClick={clearFilters}>
            Clear filters
          </button>
        )}
      </div>

      <div className={styles.status}>
        <span role="status">
          {isFiltered
            ? `${formatNumber(filteredFiles.length)} of ${formatNumber(files.length)} files`
            : `${formatNumber(files.length)} files`}{" "}
          · {formatBytes(totalSize)}
        </span>
        <a href={csvUrl} download>
          Download all as CSV
        </a>
      </div>

      <div className={isStale ? styles.stale : undefined}>
        <DataTable columns={COLUMNS} rows={filteredFiles} paginate defaultPageSize={50} emptyMessage="No files match these filters." />
      </div>
    </>
  );
}

export default function Files() {
  const assets = useCsv(ASSETS_CSV);
  return <LoadingState {...assets}>{(rows) => <FilesTable rows={rows} csvUrl={assets.url} />}</LoadingState>;
}
