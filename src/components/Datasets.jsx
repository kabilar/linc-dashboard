import { useMemo } from "react";
import Link from "@docusaurus/Link";
import DataTable, { ExpandableList } from "./DataTable";
import LoadingState from "./LoadingState";
import OverviewFilters from "./OverviewFilters";
import SectionHeading, { useScrollToHash } from "./SectionHeading";
import { MODALITIES, compareModalities } from "./modalities";
import {
  useCsv,
  splitList,
  toNumber,
  formatDecimal,
  formatNumber,
  datasetId,
  datasetSortKey,
  datasetUrl,
  UPLOAD_RANGE_DESCRIPTION,
} from "./data";
import { INVALID_BIDS, summarizeModalities, useOverview } from "./overview";
import styles from "./Datasets.module.css";
import filterStyles from "./Filters.module.css";

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

function DatasetTables({ rows, names }) {
  const overview = useOverview(rows);
  const { isStale, filtered, scope } = overview;
  useScrollToHash();

  const datasetRows = useMemo(() => summarizeDatasets(filtered, names), [filtered, names]);
  const modalityRows = useMemo(() => summarizeModalities(filtered, scope), [filtered, scope]);

  return (
    <>
      <OverviewFilters {...overview} />
      <div className={isStale ? filterStyles.stale : undefined}>
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

export default function Datasets() {
  const assets = useCsv("lincbrain_assets.csv");
  const datasets = useCsv("lincbrain_datasets.csv");
  // Dataset names are optional: the tables work without them.
  const names = useMemo(
    () => new Map((datasets.rows ?? []).map((row) => [datasetId(row), row.Name ?? ""])),
    [datasets.rows],
  );
  return <LoadingState {...assets}>{(rows) => <DatasetTables rows={rows} names={names} />}</LoadingState>;
}
