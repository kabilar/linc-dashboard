import { useDeferredValue, useMemo } from "react";
import Link from "@docusaurus/Link";
import DataTable from "./DataTable";
import LoadingState from "./LoadingState";
import MultiSelect from "./MultiSelect";
import Segmented from "./Segmented";
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
import { OVERVIEW_FILTERS, basisOf } from "./overview";
import styles from "./Files.module.css";
import filterStyles from "./Filters.module.css";

const ASSETS_CSV = "lincbrain_assets.csv";
const NONE = "(none)";
const INVALID_BIDS = "Invalid";

const ARCHIVE_ORDER = Object.keys(ARCHIVES);

// Dropdowns; Modality and Archive are also on the Overview and Datasets pages
const FILTERS = [
  {
    key: "Archive",
    label: "Archive",
    param: "archive",
    allLabel: "All archives",
    format: (archive) => ARCHIVES[archive]?.host ?? archive,
    compare: (a, b) => ARCHIVE_ORDER.indexOf(a) - ARCHIVE_ORDER.indexOf(b),
    // Choosing another archive clears the dataset
    optionsIgnore: ["DatasetId"],
  },
  {
    key: "DatasetId",
    label: "Dataset",
    param: "dataset",
    allLabel: "All datasets",
    compare: (a, b) => compareLabels(datasetSortKey(splitId(a)), datasetSortKey(splitId(b))),
  },
  { key: "Subject", param: "subject", allLabel: "All subjects" },
  { key: "Sample", param: "sample", allLabel: "All samples" },
  {
    key: "Modality",
    param: "modality",
    multi: true,
    allLabel: "All modalities",
    compare: compareModalities,
    color: modalityColor,
  },
  { key: "Extension", param: "extension", allLabel: "All extensions" },
  { key: "Stain", param: "stain", allLabel: "All stains" },
  { key: "Note", param: "note", allLabel: "All files" },
  {
    key: "BIDS",
    param: "bids",
    allLabel: "All files",
    compare: (a, b) => BIDS_STATUSES.indexOf(a) - BIDS_STATUSES.indexOf(b),
  },
];

const FILTER_BY_KEY = Object.fromEntries(FILTERS.map((filter) => [filter.key, filter]));
const SHARED_DROPDOWNS = ["Modality", "Archive"];
const FILE_DROPDOWNS = ["DatasetId", "Subject", "Sample", "Extension", "Stain", "Note", "BIDS"];

const FILTER_SCHEMA = {
  ...Object.fromEntries(FILTERS.map(({ key, param, multi }) => [key, { param, multi }])),
  Dates: OVERVIEW_FILTERS.Dates,
  From: OVERVIEW_FILTERS.From,
  To: OVERVIEW_FILTERS.To,
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
  {
    key: "Sample",
    label: "Sample",
    render: (row) => (row.Sample === NONE ? <span className={styles.muted}>—</span> : row.Sample),
  },
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

function inDates(file, filters) {
  const { From: from, To: to } = filters;
  if (!from && !to) return true;
  const month = file[basisOf(filters)].slice(0, 7);
  return Boolean(month) && (!from || month >= from) && (!to || month <= to);
}

function FilesTable({ rows, csvUrl }) {
  // Shared with the Overview and Datasets pages
  const [filters, setFilters] = useUrlFilters(FILTER_SCHEMA, { carry: "overview" });
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

  // Each dropdown's options within the other filters, with their sizes
  const options = useMemo(() => {
    const sizes = Object.fromEntries(FILTERS.map(({ key }) => [key, new Map()]));
    for (const file of files) {
      if (deferredQuery && !file.searchText.includes(deferredQuery)) continue;
      if (!inDates(file, deferredFilters)) continue;
      const failed = FILTERS.filter(({ key, multi }) => {
        const value = deferredFilters[key];
        return multi ? value.length && !value.includes(file[key]) : value && file[key] !== value;
      }).map(({ key }) => key);
      // Counts for a filter if it fails no other (or only an ignored) filter
      for (const { key, optionsIgnore = [] } of FILTERS) {
        if (failed.every((other) => other === key || optionsIgnore.includes(other))) {
          sizes[key].set(file[key], (sizes[key].get(file[key]) ?? 0) + file.size);
        }
      }
    }
    return Object.fromEntries(
      FILTERS.map(({ key, compare = compareLabels }) => [key, [...sizes[key]].sort(([a], [b]) => compare(a, b))]),
    );
  }, [files, deferredFilters, deferredQuery]);

  const filteredFiles = useMemo(
    () =>
      files.filter(
        (file) =>
          FILTERS.every(({ key, multi }) => {
            const value = deferredFilters[key];
            return multi ? !value.length || value.includes(file[key]) : !value || file[key] === value;
          }) &&
          inDates(file, deferredFilters) &&
          (!deferredQuery || file.searchText.includes(deferredQuery)),
      ),
    [files, deferredFilters, deferredQuery],
  );

  const selectedBasis = basisOf(filters);
  const monthOptions = useMemo(
    () => [...new Set(files.map((file) => file[selectedBasis].slice(0, 7)).filter(Boolean))].sort(),
    [files, selectedBasis],
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

  function renderDropdown(key) {
    const { label = key, multi, allLabel, color, format = (option) => option } = FILTER_BY_KEY[key];
    const value = filters[key];
    if (multi) {
      return (
        <MultiSelect
          key={key}
          label={label}
          allLabel={allLabel}
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
    const choices = options[key];
    const known = choices.some(([option]) => option === value);
    return (
      <label key={key} className={filterStyles.filter}>
        <span>{label}</span>
        <select value={value} onChange={(event) => changeFilter(key, event.target.value)}>
          <option value="">{allLabel}</option>
          {value && !known && <option value={value}>{format(value)} (0 B)</option>}
          {choices.map(([option, size]) => (
            <option key={option} value={option}>
              {format(option)} ({formatBytes(size)})
            </option>
          ))}
        </select>
      </label>
    );
  }

  return (
    <>
      <div className={`${filterStyles.toolbar} ${filterStyles.rows}`}>
        <div className={filterStyles.row}>
          {SHARED_DROPDOWNS.map(renderDropdown)}
          <div className={filterStyles.filter}>
            <span>Dates</span>
            <Segmented
              label="Dates"
              value={filters.Dates === "uploaded" ? "uploaded" : ""}
              onChange={(Dates) => setFilters({ ...filters, Dates })}
              options={[
                { value: "", label: "Produced" },
                { value: "uploaded", label: "Uploaded" },
              ]}
            />
          </div>
          {[
            ["From", "Earliest"],
            ["To", "Latest"],
          ].map(([key, allLabel]) => (
            <label key={key} className={`${filterStyles.filter} ${filterStyles.month}`}>
              <span>{key}</span>
              <select value={filters[key]} onChange={(event) => setFilters({ ...filters, [key]: event.target.value })}>
                <option value="">{allLabel}</option>
                {monthOptions.map((month) => (
                  <option key={month} value={month}>
                    {month}
                  </option>
                ))}
              </select>
            </label>
          ))}
          {isFiltered && (
            <button type="button" className={filterStyles.clear} onClick={clearFilters}>
              Clear filters
            </button>
          )}
        </div>
        <div className={filterStyles.row}>
          <label className={filterStyles.search}>
            <span>Search</span>
            <input
              type="search"
              value={filters.Query}
              placeholder="Path, dataset, subject, modality…"
              onChange={(event) => setFilters({ ...filters, Query: event.target.value })}
            />
          </label>
          {FILE_DROPDOWNS.map(renderDropdown)}
        </div>
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

// Files that need attention: invalid BIDS, or with a note
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
