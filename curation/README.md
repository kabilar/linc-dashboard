# Curation

`extract_metadata.py` works out each file's modality, subject and tissue
sample from its name (BIDS entities and suffixes). When a name does not give
the modality or subject, they are "Unknown". These files map such files to
curated values, and merge samples whose label is spelled several ways.

## `mappings.csv` (edited by hand)

One row per folder:

| Column | Meaning |
| --- | --- |
| `Archive` | `LINC` (lincbrain.org) or `DANDI` (dandiarchive.org) |
| `Dataset` | Dataset identifier, e.g. `001412` |
| `Folder` | Folder within the dataset; the mapping applies to every file under it. Empty for the whole dataset. |
| `Modality` | Modality for the folder's files of unknown modality, e.g. `Light-sheet microscopy` (see `modalities` in `extract_metadata.py`). Optional. |
| `Subject` | Subject for the folder's files of unknown subject. Optional. |
| `Note` | Shown on the dashboard for the files the mapping changes, e.g. `Needs renaming: add the _SPIM suffix`. Optional. A mapping with a note but no modality or subject adds the note to all of the folder's files. |

Mappings only replace "Unknown": a file whose name gives its modality or
subject keeps it. When several mappings match a file, the most specific folder
wins.

## `samples.csv` (edited by hand)

A file's sample is the BIDS `sample-<label>` entity of its name (or else of the
nearest folder name), e.g. `slice079` for `sub-MF284_sample-slice079_...`.
Labels are only unique within a subject. One row per label to rename:

| Column | Meaning |
| --- | --- |
| `Archive` | `LINC` (lincbrain.org) or `DANDI` (dandiarchive.org) |
| `Dataset` | Dataset identifier, e.g. `001278` |
| `Subject` | Subject of the sample. Empty for any subject of the dataset. |
| `Sample` | The label as it appears in file names, e.g. `lefthemi` |
| `Same as` | The label to show instead, e.g. `LeftHemi` |

For example, `sub-Hb1_sample-lefthemi_...` and `sub-Hb1_sample-LeftHemi_...`
are the same sample, so `lefthemi` is listed with `Same as` `LeftHemi`, and the
dashboard counts and filters them as one.

## `unmapped.csv` (generated)

Written by each run of `extract_metadata.py`: the folders (up to three levels
deep) that still have files of unknown modality or subject, with the number of
such files, their size and an example. Use it to find folders to add to
`mappings.csv`.
