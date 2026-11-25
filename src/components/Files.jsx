import { useDeferredValue, useMemo } from "react";
import Link from "@docusaurus/Link";
import DataTable from "./DataTable";
import LoadingState from "./LoadingState";
import MultiSelect from "./MultiSelect";
import useUrlFilters, { emptyFilters, hasFilters } from "./useUrlFilters";
import { compareModalities, modalityColor } from "./modalities";
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
  PRODUCED_DESCRIPTION,
  UPLOADED_DESCRIPTION,
} from "./data";
import styles from "./Files.module.css";

const ASSETS_CSV = "lincbrain_assets.csv";
const NONE = "(none)";

const ARCHIVE_ORDER = Object.keys(ARCHIVES);

// Dropdown filters, in display order. `key` is the field of each file,
// `param` the URL query parameter, `multi` whether several values can be
// chosen, `format` the option text, and `compare` the option order.
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
  { key: "Modality", param: "modality", multi: true, compare: compareModalities, color: modalityColor },
  { key: "Extension", param: "extension" },
];

// All filters, including the search box, with their URL query parameters
const FILTER_SCHEMA = {
  ...Object.fromEntries(FILTERS.map(({ key, param, multi }) => [key, { param, multi }])),
  Query: { param: "q" },
};

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
  {
    key: "Produced",
    label: "Produced",
    description: PRODUCED_DESCRIPTION,
    className: styles.nowrap,
    render: (row) => row.Produced || "—",
  },
  {
    key: "Uploaded",
    label: "Uploaded",
    description: UPLOADED_DESCRIPTION,
    className: styles.nowrap,
    render: (row) => row.Uploaded || "—",
  },
];

function FilesTable({ rows, csvUrl }) {
  const [filters, setFilters] = useUrlFilters(FILTER_SCHEMA);
  const deferredFilters = useDeferredValue(filters);
  const deferredQuery = deferredFilters.Query.trim().toLowerCase();

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
          FILTERS.every(({ key, multi }) => {
            const value = deferredFilters[key];
            return multi ? !value.length || value.includes(file[key]) : !value || file[key] === value;
          }) &&
          (!deferredQuery || file.searchText.includes(deferredQuery)),
      ),
    [files, deferredFilters, deferredQuery],
  );

  const totalSize = useMemo(() => filteredFiles.reduce((sum, file) => sum + file.size, 0), [filteredFiles]);
  const isFiltered = hasFilters(FILTER_SCHEMA, filters);
  const isStale = deferredFilters !== filters;

  function changeFilter(key, value) {
    const next = { ...filters, [key]: value };
    // A dataset from another archive would match nothing.
    if (key === "Archive" && value && next.DatasetId && splitId(next.DatasetId).Archive !== value) {
      next.DatasetId = "";
    }
    setFilters(next);
  }

  function clearFilters() {
    setFilters(emptyFilters(FILTER_SCHEMA));
  }

  return (
    <>
      <div className={styles.toolbar}>
        <label className={styles.search}>
          <span>Search</span>
          <input
            type="search"
            value={filters.Query}
            placeholder="Path, dataset, subject, modality…"
            onChange={(event) => setFilters({ ...filters, Query: event.target.value })}
          />
        </label>
        {FILTERS.map(({ key, label = key, multi, color, format = (option) => option, visible = () => true }) => {
          const value = filters[key];
          if (multi) {
            return (
              <MultiSelect
                key={key}
                label={label}
                selected={value}
                onChange={(selected) => changeFilter(key, selected)}
                options={options[key].map(([option, count]) => ({
                  value: option,
                  label: format(option),
                  count,
                  color: color?.(option),
                }))}
              />
            );
          }
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
