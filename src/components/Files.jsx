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
  BIDS_DESCRIPTION,
  BIDS_STATUSES,
} from "./data";
import styles from "./Files.module.css";

const ASSETS_CSV = "lincbrain_assets.csv";
const NONE = "(none)";
const INVALID_BIDS = "Invalid";

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
  // e.g. "Needs renaming: add the _SPIM suffix"
  { key: "Note", param: "note" },
  {
    key: "BIDS",
    param: "bids",
    compare: (a, b) => BIDS_STATUSES.indexOf(a) - BIDS_STATUSES.indexOf(b),
  },
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
      <>
        <Link to={assetFolderUrl(row)} title={`Open the folder on ${ARCHIVES[row.Archive]?.host ?? "its archive"}`}>
          {row.Path}
        </Link>
        {row.Note !== NONE && <span className={styles.note}>{row.Note}</span>}
      </>
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
  {
    key: "BIDS",
    label: "BIDS",
    description: BIDS_DESCRIPTION,
    className: styles.bids,
    render: (row) =>
      row.BIDS === "Invalid" ? (
        <>
          <span className={styles.invalid}>Invalid</span>
          {row["BIDS issue"] && <span className={styles.bidsIssue}>{row["BIDS issue"]}</span>}
        </>
      ) : row.BIDS === "Valid" ? (
        "Valid"
      ) : (
        <span className={styles.muted}>{row.BIDS === NONE ? "—" : row.BIDS}</span>
      ),
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

  // Options for each dropdown, with the size of the data for each value.
  const options = useMemo(() => {
    const result = {};
    for (const { key, compare = compareLabels } of FILTERS) {
      const sizes = new Map();
      for (const file of files) sizes.set(file[key], (sizes.get(file[key]) ?? 0) + file.size);
      result[key] = [...sizes].sort(([a], [b]) => compare(a, b));
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
                options={options[key].map(([option, size]) => ({
                  value: option,
                  label: format(option),
                  detail: formatBytes(size),
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
                {value && !known && <option value={value}>{format(value)} (0 B)</option>}
                {choices.map(([option, size]) => (
                  <option key={option} value={option}>
                    {format(option)} ({formatBytes(size)})
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

      <FileNotes files={filteredFiles} filters={deferredFilters} onShow={changeFilter} />

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

// Files that need attention among those shown: not valid BIDS, or with a note
// such as "Needs renaming: add the _SPIM suffix". Each line can filter to them.
function FileNotes({ files, filters, onShow }) {
  const { invalidBids, notes } = useMemo(() => {
    let invalid = 0;
    const counts = new Map();
    for (const file of files) {
      if (file.BIDS === INVALID_BIDS) invalid += 1;
      if (file.Note !== NONE) counts.set(file.Note, (counts.get(file.Note) ?? 0) + 1);
    }
    return { invalidBids: invalid, notes: [...counts].sort(([a], [b]) => compareLabels(a, b)) };
  }, [files]);

  // Leave out the lines whose filter is already applied
  const lines = [
    ...(invalidBids > 0 && filters.BIDS !== INVALID_BIDS
      ? [{ key: "BIDS", value: INVALID_BIDS, count: invalidBids, text: "Not valid BIDS" }]
      : []),
    ...notes.filter(([note]) => filters.Note !== note).map(([note, count]) => ({ key: "Note", value: note, count, text: note })),
  ];
  if (lines.length === 0) return null;
  return (
    <div className={styles.notes} role="note">
      {lines.map(({ key, value, count, text }) => (
        <p key={`${key}:${value}`}>
          <strong>
            {formatNumber(count)} {count === 1 ? "file" : "files"}
          </strong>{" "}
          · {text}.{" "}
          <button type="button" className={styles.noteAction} onClick={() => onShow(key, value)}>
            Show {count === 1 ? "it" : "them"}
          </button>
        </p>
      ))}
    </div>
  );
}

export default function Files() {
  const assets = useCsv(ASSETS_CSV);
  return <LoadingState {...assets}>{(rows) => <FilesTable rows={rows} csvUrl={assets.url} />}</LoadingState>;
}
