import Link from "@docusaurus/Link";
import DataTable, { ExpandableList } from "./DataTable";
import ModalityHeatmap from "./ModalityHeatmap";
import LoadingState from "./LoadingState";
import {
  useCsv,
  splitList,
  toNumber,
  formatDecimal,
  datasetId,
  datasetSortKey,
  datasetUrl,
  UPLOADED_DESCRIPTION,
} from "./data";
import styles from "./Summary.module.css";

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
    render: (row) => row.Name || <span className={styles.muted}>—</span>,
  },
  listColumn("Modality"),
  sizeColumn,
  listColumn("Subject"),
  listColumn("Extension"),
  {
    key: "Last uploaded",
    label: "Uploaded",
    description: `First and last ${UPLOADED_DESCRIPTION.charAt(0).toLowerCase()}${UPLOADED_DESCRIPTION.slice(1)}`,
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
];

const MODALITY_COLUMNS = [
  { key: "Modality", label: "Modality" },
  sizeColumn,
  listColumn("Subject"),
  listColumn("Extension"),
];

export default function Summary() {
  const datasets = useCsv("lincbrain_datasets.csv");
  const modalities = useCsv("lincbrain_modalities.csv");

  return (
    <>
      <section>
        <h2>Datasets</h2>
        <LoadingState {...datasets}>
          {(rows) => (
            <DataTable
              columns={DATASET_COLUMNS}
              rows={rows}
              rowKey={datasetId}
              initialSort={{ key: "Dataset", direction: "asc" }}
            />
          )}
        </LoadingState>
      </section>

      <section>
        <h2>Modalities</h2>
        <LoadingState {...modalities}>
          {(rows) => (
            <>
              <p>
                Subjects with data for each modality. Select a cell to browse its{" "}
                <Link to="/files">files</Link>.
              </p>
              <ModalityHeatmap rows={rows} />
              <DataTable
                columns={MODALITY_COLUMNS}
                rows={rows}
                rowKey={(row) => row.Modality}
                initialSort={{ key: "Modality", direction: "asc" }}
              />
            </>
          )}
        </LoadingState>
      </section>
    </>
  );
}
