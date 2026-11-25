import { useDeferredValue, useMemo } from "react";
import Link from "@docusaurus/Link";
import DataTable, { ExpandableList } from "./DataTable";
import ModalityHeatmap from "./ModalityHeatmap";
import LoadingState from "./LoadingState";
import MultiSelect from "./MultiSelect";
import Segmented from "./Segmented";
import ActivityChart from "./ActivityChart";
import SubjectTimeline from "./SubjectTimeline";
import SectionHeading, { useScrollToHash } from "./SectionHeading";
import useUrlFilters, { emptyFilters, hasFilters } from "./useUrlFilters";
import { MODALITIES, UNKNOWN_MODALITY, compareModalities, modalityColor } from "./modalities";
import { monthRange } from "./charts";
import {
  useCsv,
  splitList,
  toNumber,
  formatBytes,
  formatDecimal,
  formatNumber,
  ARCHIVES,
  datasetId,
  datasetSortKey,
  datasetUrl,
  UPLOAD_RANGE_DESCRIPTION,
} from "./data";

const INVALID_BIDS = "Invalid";
import styles from "./Summary.module.css";
import filterStyles from "./Filters.module.css";
import chartStyles from "./Charts.module.css";

// Filters and their URL query parameters
const FILTERS = {
  Modality: { param: "modality", multi: true },
  Archive: { param: "archive" },
  Dates: { param: "dates" }, // "" (produced) or "uploaded"
  From: { param: "from" }, // "YYYY-MM"
  To: { param: "to" }, // "YYYY-MM"
};

// Values of the Subject column that are not subjects
const NOT_SUBJECTS = new Set(["n/a", "Unknown"]);

const sizeColumn = {
  key: "Size (GB)",
  label: "Size (GB)",
  align: "right",
  sortValue: (row) => toNumber(row["Size (GB)"]),
  render: (row) => formatDecimal(toNumber(row["Size (GB)"])),
};

const listColumn = (key) => ({
  key,
  label: key,
  render: (row) => <ExpandableList items={splitList(row[key])} />,
});

const DATASET_COLUMNS = [
  {
    key: "Dataset",
    label: "Dataset",
    className: styles.nowrap,
    sortValue: datasetSortKey,
    render: (row) => <Link to={datasetUrl(row)}>{datasetId(row)}</Link>,
  },
  {
    key: "Name",
    label: "Name",
    className: styles.name,
    stackHeading: true,
    render: (row) => row.Name || <span className={styles.muted}>—</span>,
  },
  listColumn("Modality"),
  sizeColumn,
  listColumn("Subject"),
  listColumn("Extension"),
  {
    key: "Last uploaded",
    label: "Uploaded",
    description: UPLOAD_RANGE_DESCRIPTION,
    className: styles.nowrap,
    render: (row) => {
      const first = row["First uploaded"];
      const last = row["Last uploaded"];
      if (!last) return <span className={styles.muted}>—</span>;
      return first && first !== last ? (
        <>
          {first} –<br />
          {last}
        </>
      ) : (
        last
      );
    },
  },
  {
    key: "Invalid BIDS",
    label: "Invalid BIDS",
    description: "The number of the dataset's files whose paths do not follow the BIDS specification.",
    align: "right",
    render: (row) =>
      row["Invalid BIDS"] > 0 ? (
        <Link to={`/files?${new URLSearchParams({ dataset: datasetId(row), bids: INVALID_BIDS })}`}>
          {formatNumber(row["Invalid BIDS"])}
        </Link>
      ) : (
        "0"
      ),
  },
];

const MODALITY_COLUMNS = [
  { key: "Modality", label: "Modality", sortValue: (row) => MODALITIES.findIndex((m) => m.name === row.Modality) },
  sizeColumn,
  listColumn("Subject"),
  listColumn("Extension"),
];

function prepareFiles(rows) {
  return rows.map((row) => {
    const id = datasetId(row);
    return {
      Archive: id.split(":")[0],
      Dataset: row.Dataset,
      DatasetId: id,
      Subject: row.Subject || "Unknown",
      Modality: row.Modality || UNKNOWN_MODALITY,
      Extension: row.Extension || "",
      size: toNumber(row["Size (bytes)"]),
      Produced: row.Produced || "",
      Uploaded: row.Uploaded || "",
      Note: row.Note || "",
      BIDS: row.BIDS || "",
    };
  });
}

function applyFilters(files, filters, basis) {
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

// Months from the first to the last date of the files (or the selected range)
function monthsOf(files, basis, from, to) {
  let first = from;
  let last = to;
  if (!first || !last) {
    for (const file of files) {
      const month = file[basis].slice(0, 7);
      if (!month) continue;
      if (!from && (!first || month < first)) first = month;
      if (!to && (!last || month > last)) last = month;
    }
  }
  return first && last && first <= last ? monthRange(first, last) : [];
}

function countBy(files, key) {
  const counts = new Map();
  for (const file of files) counts.set(file[key], (counts.get(file[key]) ?? 0) + 1);
  return counts;
}

function summarize(files, basis) {
  let bytes = 0;
  let latest = null;
  const subjects = new Set();
  const datasets = new Set();
  for (const file of files) {
    bytes += file.size;
    if (!NOT_SUBJECTS.has(file.Subject)) subjects.add(file.Subject);
    datasets.add(file.DatasetId);
    if (file[basis] && (!latest || file[basis] > latest[basis])) latest = file;
  }
  return { files: files.length, bytes, subjects: subjects.size, datasets: datasets.size, latest };
}

function summarizeDatasets(files, names) {
  const groups = new Map();
  for (const file of files) {
    let group = groups.get(file.DatasetId);
    if (!group) {
      group = {
        Archive: file.Archive,
        Dataset: file.Dataset,
        bytes: 0,
        invalidBids: 0,
        modalities: new Set(),
        subjects: new Set(),
        extensions: new Set(),
        first: "",
        last: "",
      };
      groups.set(file.DatasetId, group);
    }
    group.bytes += file.size;
    if (file.BIDS === INVALID_BIDS) group.invalidBids += 1;
    group.modalities.add(file.Modality);
    group.subjects.add(file.Subject);
    if (file.Extension) group.extensions.add(file.Extension);
    if (file.Uploaded) {
      if (!group.first || file.Uploaded < group.first) group.first = file.Uploaded;
      if (file.Uploaded > group.last) group.last = file.Uploaded;
    }
  }
  return [...groups].map(([id, group]) => ({
    Archive: group.Archive,
    Dataset: group.Dataset,
    Name: names.get(id) ?? "",
    Modality: [...group.modalities].sort(compareModalities).join(","),
    "Size (GB)": group.bytes / 1000 ** 3,
    Subject: [...group.subjects].join(","),
    Extension: [...group.extensions].join(","),
    "First uploaded": group.first,
    "Last uploaded": group.last,
    "Invalid BIDS": group.invalidBids,
  }));
}

function summarizeModalities(files, modalities) {
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

// Notes about files that need attention, e.g. "Needs renaming: add the _SPIM suffix",
// and the number of files that are not valid BIDS
function FileNotes({ files }) {
  const counts = useMemo(() => countBy(files.filter((file) => file.Note), "Note"), [files]);
  const invalidBids = useMemo(() => files.filter((file) => file.BIDS === INVALID_BIDS).length, [files]);
  if (counts.size === 0 && invalidBids === 0) return null;
  return (
    <div className={styles.notes} role="note">
      {invalidBids > 0 && (
        <p>
          <strong>
            {formatNumber(invalidBids)} {invalidBids === 1 ? "file" : "files"}
          </strong>{" "}
          · Not valid BIDS. <Link to={`/files?${new URLSearchParams({ bids: INVALID_BIDS })}`}>View files</Link>
        </p>
      )}
      {[...counts].map(([note, count]) => (
        <p key={note}>
          <strong>
            {formatNumber(count)} {count === 1 ? "file" : "files"}
          </strong>{" "}
          · {note}. <Link to={`/files?${new URLSearchParams({ note })}`}>View files</Link>
        </p>
      ))}
    </div>
  );
}

function StatTiles({ stats, total, basis }) {
  const tiles = [
    ["Files", formatNumber(stats.files), stats.files !== total ? `of ${formatNumber(total)}` : ""],
    ["Size", formatBytes(stats.bytes), ""],
    ["Subjects", formatNumber(stats.subjects), ""],
    ["Datasets", formatNumber(stats.datasets), ""],
    [
      `Last ${basis.toLowerCase()}`,
      stats.latest ? stats.latest[basis] : "—",
      stats.latest ? `${stats.latest.Subject} · ${stats.latest.Modality}` : "",
    ],
  ];
  return (
    <div className={styles.tiles}>
      {tiles.map(([label, value, note]) => (
        <div key={label} className={styles.tile}>
          <div className={styles.tileLabel}>{label}</div>
          <div className={styles.tileValue}>{value}</div>
          <div className={styles.tileNote}>{note || " "}</div>
        </div>
      ))}
    </div>
  );
}

function Dashboard({ rows, names }) {
  const [filters, setFilters] = useUrlFilters(FILTERS);
  const deferred = useDeferredValue(filters);
  useScrollToHash();
  const update = (changes) => setFilters({ ...filters, ...changes });

  const files = useMemo(() => prepareFiles(rows), [rows]);
  const basis = deferred.Dates === "uploaded" ? "Uploaded" : "Produced";
  const selectedBasis = filters.Dates === "uploaded" ? "Uploaded" : "Produced";

  // Options for the filters, with the number of files for each value
  const modalityCounts = useMemo(() => countBy(files, "Modality"), [files]);
  const archiveCounts = useMemo(() => countBy(files, "Archive"), [files]);
  const allModalities = useMemo(
    () => [...new Set([...MODALITIES.map((m) => m.name), ...modalityCounts.keys()])].sort(compareModalities),
    [modalityCounts],
  );
  const monthOptions = useMemo(
    () => [...new Set(files.map((file) => file[selectedBasis].slice(0, 7)).filter(Boolean))].sort(),
    [files, selectedBasis],
  );

  const filtered = useMemo(() => applyFilters(files, deferred, basis), [files, deferred, basis]);
  const months = useMemo(() => monthsOf(filtered, basis, deferred.From, deferred.To), [filtered, basis, deferred.From, deferred.To]);
  const stats = useMemo(() => summarize(filtered, basis), [filtered, basis]);
  const scope = useMemo(
    () => (deferred.Modality.length ? [...deferred.Modality].sort(compareModalities) : allModalities),
    [deferred.Modality, allModalities],
  );
  const datasetRows = useMemo(() => summarizeDatasets(filtered, names), [filtered, names]);
  const modalityRows = useMemo(() => summarizeModalities(filtered, scope), [filtered, scope]);
  const heatmapRows = useMemo(
    () => modalityRows.map((row) => ({ Modality: row.Modality, Subject: row.Subject })),
    [modalityRows],
  );

  const isFiltered = hasFilters(FILTERS, filters);
  const isStale = deferred !== filters;
  const linkParams = deferred.Archive ? { archive: deferred.Archive } : {};

  return (
    <>
      <div className={filterStyles.toolbar}>
        <MultiSelect
          label="Modality"
          allLabel="All modalities"
          selected={filters.Modality}
          onChange={(Modality) => update({ Modality })}
          options={allModalities.map((name) => ({
            value: name,
            color: modalityColor(name),
            count: modalityCounts.get(name) ?? 0,
          }))}
        />
        <label className={filterStyles.filter}>
          <span>Archive</span>
          <select value={filters.Archive} onChange={(event) => update({ Archive: event.target.value })}>
            <option value="">All archives</option>
            {Object.entries(ARCHIVES).map(([archive, { host }]) => (
              <option key={archive} value={archive}>
                {host} ({formatNumber(archiveCounts.get(archive) ?? 0)})
              </option>
            ))}
          </select>
        </label>
        <div className={filterStyles.filter}>
          <span>Dates</span>
          <Segmented
            label="Dates"
            value={filters.Dates === "uploaded" ? "uploaded" : ""}
            onChange={(Dates) => update({ Dates })}
            options={[
              { value: "", label: "Produced" },
              { value: "uploaded", label: "Uploaded" },
            ]}
          />
        </div>
        <label className={`${filterStyles.filter} ${filterStyles.month}`}>
          <span>From</span>
          <select value={filters.From} onChange={(event) => update({ From: event.target.value })}>
            <option value="">Earliest</option>
            {monthOptions.map((month) => (
              <option key={month} value={month}>
                {month}
              </option>
            ))}
          </select>
        </label>
        <label className={`${filterStyles.filter} ${filterStyles.month}`}>
          <span>To</span>
          <select value={filters.To} onChange={(event) => update({ To: event.target.value })}>
            <option value="">Latest</option>
            {monthOptions.map((month) => (
              <option key={month} value={month}>
                {month}
              </option>
            ))}
          </select>
        </label>
        {isFiltered && (
          <button type="button" className={filterStyles.clear} onClick={() => setFilters(emptyFilters(FILTERS))}>
            Clear filters
          </button>
        )}
      </div>

      <div className={isStale ? styles.stale : undefined}>
        <StatTiles stats={stats} total={files.length} basis={basis} />
        <FileNotes files={filtered} />

        <section className={chartStyles.card}>
          <div className={chartStyles.header}>
            <SectionHeading as="h3" id="subjects-by-modality" className={chartStyles.title}>
              Subjects by modality
            </SectionHeading>
            <span className={chartStyles.description}>
              Subjects with data for each modality. Select a cell to browse its files.
            </span>
          </div>
          <ModalityHeatmap rows={heatmapRows} />
        </section>

        <ActivityChart files={filtered} basis={basis} months={months} modalities={scope} />
        <SubjectTimeline
          files={filtered}
          basis={basis}
          months={months}
          includeUnknown={deferred.Modality.includes(UNKNOWN_MODALITY)}
          linkParams={linkParams}
        />

        <section>
          <SectionHeading id="datasets">Datasets</SectionHeading>
          <DataTable
            columns={DATASET_COLUMNS}
            rows={datasetRows}
            rowKey={datasetId}
            initialSort={{ key: "Dataset", direction: "asc" }}
            emptyMessage="No datasets match these filters."
            // The site's mobile layout; the table needs about 1,300px
            stackUpTo={996}
          />
        </section>

        <section>
          <SectionHeading id="modalities">Modalities</SectionHeading>
          <DataTable
            columns={MODALITY_COLUMNS}
            rows={modalityRows}
            rowKey={(row) => row.Modality}
            initialSort={{ key: "Modality", direction: "asc" }}
            stackUpTo={640}
          />
        </section>
      </div>
    </>
  );
}

export default function Summary() {
  const assets = useCsv("lincbrain_assets.csv");
  const datasets = useCsv("lincbrain_datasets.csv");
  // Dataset names are optional: the dashboard works without them.
  const names = useMemo(
    () => new Map((datasets.rows ?? []).map((row) => [datasetId(row), row.Name ?? ""])),
    [datasets.rows],
  );

  return <LoadingState {...assets}>{(rows) => <Dashboard rows={rows} names={names} />}</LoadingState>;
}
