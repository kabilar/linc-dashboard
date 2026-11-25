# Curation

`extract_metadata.py` works out each file's modality and subject from its name
(BIDS entities and suffixes). When a name does not give them, they are
"Unknown". These files map such files to curated values.

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

## `unmapped.csv` (generated)

Written by each run of `extract_metadata.py`: the folders (up to three levels
deep) that still have files of unknown modality or subject, with the number of
such files, their size and an example. Use it to find folders to add to
`mappings.csv`.
