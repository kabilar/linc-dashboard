import os
import re
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

# Modality of each file, from the BIDS suffix in its name (e.g. sub-X_..._SPIM.ome.zarr),
# matched case-insensitively anywhere in the file name, in this order
modalities = {'oct': 'PS-OCT',
              'df': 'Dark-field microscopy',
              'xpct': 'HiP-CT',
              'dwi': 'Diffusion MRI',
              'spim': 'Light-sheet microscopy',
              'photo': 'Blockface photo'}

# Archives to index, keyed by the prefix of their dataset identifiers
# (e.g. LINC:000003, DANDI:001412). `token_env` names the environment variable
# that holds the API key for each archive.
ARCHIVES = {
    'LINC': {
        'api_url': 'https://api.lincbrain.org/api',
        'token_env': 'LINC_API_KEY',
        'token_required': True,
        # All datasets except '000048' (OpenBNB) and '000004' (Mouse LSM).
        # Exclude 000053 temporarily due to large number of assets.
        'exclude': ['000048', '000004', '000053'],
    },
    'DANDI': {
        'api_url': 'https://api.dandiarchive.org/api',
        'token_env': 'DANDI_API_KEY',
        'token_required': False,
        # LINC-related datasets on dandiarchive.org.  Datasets that cannot be
        # accessed (e.g. embargoed without an API key) are skipped.
        'include': ['001278', '001372', '001411', '001412', '001769', '002048'],
    },
}

VERSION = 'draft'

ASSETS_CSV = './static/lincbrain_assets.csv'

OME_ZARR = 'OME-Zarr'
# Concurrent requests when reading OME-Zarr metadata
ZARR_WORKERS = 16

# Dataset-level BIDS files that do not belong to a subject
DATASET_LEVEL_FILES = {'dataset_description.json', 'participants.tsv', 'participants.json',
                       'samples.tsv', 'samples.json', 'readme', 'readme.md', 'readme.txt',
                       'changes', '.bidsignore'}


class ArchiveClient:
    """Minimal client for the DANDI REST API, which lincbrain.org also implements."""

    def __init__(self, api_url, token=None):
        self.api_url = api_url
        self.session = requests.Session()
        retries = Retry(total=5, backoff_factor=2, status_forcelist=[429, 500, 502, 503, 504])
        self.session.mount('https://', HTTPAdapter(max_retries=retries, pool_maxsize=ZARR_WORKERS))
        if token:
            self.session.headers['Authorization'] = f'token {token}'

    def check_token(self, token_env):
        # An invalid key makes every request fail with 401, which would
        # otherwise look like datasets that cannot be accessed.
        response = self.session.get(f'{self.api_url}/auth/token/', timeout=120)
        if response.status_code in (401, 403):
            raise RuntimeError(f'{token_env} is not a valid API key for {self.api_url}')
        response.raise_for_status()

    def get(self, path, params=None):
        response = self.session.get(f'{self.api_url}{path}', params=params, timeout=120)
        response.raise_for_status()
        return response.json()

    def paginate(self, path, params=None):
        url = f'{self.api_url}{path}'
        params = {'page_size': 1000, **(params or {})}
        while url:
            response = self.session.get(url, params=params, timeout=120)
            response.raise_for_status()
            page = response.json()
            yield from page['results']
            # The `next` URL already includes the query parameters
            url, params = page['next'], None


class ZarrReader:
    """Reads small JSON files of Zarr archives from an archive's storage."""

    def __init__(self, client):
        self.client = client
        # A separate session, so that the API key is never sent to the storage
        self.storage = requests.Session()
        retries = Retry(total=5, backoff_factor=1, status_forcelist=[429, 500, 502, 503, 504])
        self.storage.mount('https://', HTTPAdapter(max_retries=retries, pool_maxsize=ZARR_WORKERS))

    def read_json(self, zarr_id, storage_url, name):
        """Return the JSON file `name` of a Zarr archive, or None if it does not exist."""
        if storage_url:
            response = self.storage.get(storage_url + name, timeout=60)
            if response.status_code == 200:
                return response.json()
            if response.status_code == 404:
                return None
            if response.status_code != 403:
                response.raise_for_status()
        # Private storage: the API redirects to a signed URL (requests drops the
        # API key when following a redirect to another host).
        response = self.client.session.get(f'{self.client.api_url}/zarr/{zarr_id}/files/',
                                           params={'prefix': name, 'download': 'true'}, timeout=60)
        if response.status_code in (403, 404):
            return None
        response.raise_for_status()
        return response.json()


def ngff_version(attributes):
    """The OME-NGFF version declared in a Zarr group's attributes."""
    ome = attributes.get('ome')
    if isinstance(ome, dict) and ome.get('version'):
        return str(ome['version'])  # OME-Zarr 0.5 and later
    # OME-Zarr 0.4 and earlier (also found in Zarr v3 groups)
    for group in (attributes, ome if isinstance(ome, dict) else {}):
        multiscales = group.get('multiscales')
        if isinstance(multiscales, list) and multiscales and isinstance(multiscales[0], dict):
            if multiscales[0].get('version'):
                return str(multiscales[0]['version'])
        for key in ('plate', 'well'):
            if isinstance(group.get(key), dict) and group[key].get('version'):
                return str(group[key]['version'])
    return None


def ome_zarr_version(reader, zarr_id, storage_url):
    """The OME-NGFF version of an OME-Zarr archive, or None if it cannot be read."""
    # zarr.json for Zarr v3 (OME-Zarr 0.5 and later), .zattrs for Zarr v2
    for name in ('zarr.json', '.zattrs'):
        document = reader.read_json(zarr_id, storage_url, name)
        if document is None:
            continue
        attributes = document.get('attributes', {}) if name == 'zarr.json' else document
        version = ngff_version(attributes)
        if version is None and 'bioformats2raw.layout' in {**attributes, **(attributes.get('ome') or {})}:
            # The image is in the first series
            series = reader.read_json(zarr_id, storage_url, f'0/{name}')
            if series is not None:
                version = ngff_version(series.get('attributes', {}) if name == 'zarr.json' else series)
        return version
    return None


def storage_url(metadata):
    """The asset's storage URL (e.g. on S3), rather than its API download URL."""
    return next((url for url in metadata.get('contentUrl') or [] if '/api/' not in url), None)


def add_ome_zarr_versions(archive, client, rows, cache):
    """Replace "OME-Zarr" extensions with e.g. "OME-Zarr v0.5"."""
    zarrs = [row for row in rows if row['Extension'] == OME_ZARR and row['_zarr']]
    pending = []
    for row in zarrs:
        cached = cache.get((row['Archive'], row['Dataset'], row['Path'], row['Uploaded']))
        if cached:
            row['Extension'] = cached
        else:
            pending.append(row)

    reader = ZarrReader(client)

    def read(row):
        try:
            return ome_zarr_version(reader, row['_zarr'], row['_storage'])
        except (requests.RequestException, ValueError):
            return None

    with ThreadPoolExecutor(max_workers=ZARR_WORKERS) as executor:
        versions = list(executor.map(read, pending))

    for row, version in zip(pending, versions):
        if version:
            row['Extension'] = f'{OME_ZARR} v{version}'

    unknown = sum(version is None for version in versions)
    print(f'{archive}: {len(zarrs)} OME-Zarr archives; read the version of {len(pending)} '
          f'(the others are unchanged since the previous run); {unknown} without a version', flush=True)
    if unknown:
        warn(f'{archive}: {unknown} OME-Zarr archives have no readable OME-NGFF version')


def load_cache(path=ASSETS_CSV):
    """OME-Zarr extensions from the previous run, keyed by asset and upload date."""
    if not os.path.exists(path):
        return {}
    previous = pd.read_csv(path, dtype=str, keep_default_na=False)
    if 'Archive' not in previous or 'Uploaded' not in previous:
        return {}
    previous = previous[previous['Extension'].str.startswith(f'{OME_ZARR} v')]
    return {(row.Archive, row.Dataset, row.Path, row.Uploaded): row.Extension
            for row in previous.itertuples() if row.Uploaded}


def warn(message):
    # Shown as an annotation on the GitHub Actions run
    print(f'::warning::{message}')


def is_access_error(error):
    return error.response is not None and error.response.status_code in (401, 403, 404)


def parse_subject(path):
    parts = path.split('/')

    # A subject directory, e.g. rawdata/sub-MR256/...
    for part in parts[:-1]:
        if part.startswith('sub-') and '_' not in part and len(part) > len('sub-'):
            return part[len('sub-'):]

    # Otherwise the BIDS `sub-<label>` entity of a file or directory name.
    # BIDS labels are alphanumeric, so e.g. `sub-MF284-sample-slice036_...`
    # gives MF284.
    for part in parts:
        match = re.search(r'(?:^|_)sub-([A-Za-z0-9]+)', part)
        if match:
            return match.group(1)

    if parts[-1].lower() in DATASET_LEVEL_FILES:
        return 'n/a'

    return 'Unknown'


def parse_modality(path):
    filename = path.split('/')[-1].lower()
    return next((value for key, value in modalities.items() if key in filename), 'Unknown')


def parse_extension(path):
    if path.lower().endswith('.ome.zarr'):
        return OME_ZARR  # the version is added by add_ome_zarr_versions
    suffixes = Path(path).suffixes
    return suffixes[0][1:] if suffixes else ''


def to_utc_date(value):
    """ISO 8601 timestamp -> UTC date, e.g. 2026-05-29T16:51:24-04:00 -> 2026-05-29."""
    if not value:
        return ''
    try:
        timestamp = datetime.fromisoformat(value.replace('Z', '+00:00'))
    except ValueError:
        return ''
    if timestamp.tzinfo is None:
        timestamp = timestamp.replace(tzinfo=timezone.utc)
    return timestamp.astimezone(timezone.utc).strftime('%Y-%m-%d')


def asset_metadata(client, identifier, asset):
    # The listing includes each asset's metadata when requested with
    # metadata=true; otherwise fetch it separately.
    if 'metadata' in asset:
        return asset['metadata']
    return client.get(f'/dandisets/{identifier}/versions/{VERSION}/assets/{asset["asset_id"]}/')


def dataset_name(dandiset):
    return (dandiset.get('draft_version') or {}).get('name', '')


def list_datasets(archive, client, config):
    """Return {dataset identifier: name} for the datasets to index."""
    if 'include' in config:
        datasets = {}
        for identifier in config['include']:
            try:
                dandiset = client.get(f'/dandisets/{identifier}/')
            except requests.HTTPError as error:
                if not is_access_error(error):
                    raise
                warn(f'Skipping {archive}:{identifier}: {error}')
                continue
            datasets[identifier] = dataset_name(dandiset)
        return datasets

    return {dandiset['identifier']: dataset_name(dandiset)
            for dandiset in client.paginate('/dandisets/')
            if dandiset['identifier'] not in config['exclude']}


# Create dataframes of all assets across all datasets, and of the datasets' names
def extract_assets(archive, client, config, cache=None):
    datasets = list_datasets(archive, client, config)

    latest_assets = []
    for identifier in sorted(datasets):
        try:
            assets = list(client.paginate(f'/dandisets/{identifier}/versions/{VERSION}/assets/',
                                          {'order': 'path', 'metadata': 'true'}))
        except requests.HTTPError as error:
            if not is_access_error(error):
                raise
            warn(f'Skipping {archive}:{identifier}: {error}')
            del datasets[identifier]
            continue

        print(f'{archive}:{identifier}: {len(assets)} assets', flush=True)
        if assets and 'metadata' not in assets[0]:
            print(f'{archive}:{identifier}: fetching metadata for each asset', flush=True)

        for asset in assets:
            metadata = asset_metadata(client, identifier, asset)
            latest_assets.append({
                "Archive": archive,
                "Dataset": identifier,
                "Version": VERSION,
                "Subject": parse_subject(asset['path']),
                "Modality": parse_modality(asset['path']),
                "Size (bytes)": asset['size'],
                "Path": asset['path'],
                "Extension": parse_extension(asset['path']),
                # Last modification time of the file when it was uploaded
                "Produced": to_utc_date(metadata.get('blobDateModified')),
                # Upload time (set by dandi-cli); `created` changes when an asset is moved
                "Uploaded": to_utc_date(metadata.get('dateModified') or asset.get('created')),
                "_zarr": asset.get('zarr'),
                "_storage": storage_url(metadata),
            })

    add_ome_zarr_versions(archive, client, latest_assets, cache or {})
    for row in latest_assets:
        del row['_zarr'], row['_storage']

    names = pd.DataFrame([{"Archive": archive, "Dataset": identifier, "Name": name}
                          for identifier, name in datasets.items()])
    return pd.DataFrame(latest_assets), names


def join_unique(values):
    return ','.join(values.unique())


def earliest(values):
    values = values[values != '']
    return values.min() if len(values) else ''


def latest(values):
    values = values[values != '']
    return values.max() if len(values) else ''


# Summarize data across datasets
def summarize_datasets(df, df_names):
    df_datasets = (df.groupby(['Archive', 'Dataset'], sort=False)
                     .agg(**{"Modality": ("Modality", join_unique),
                             "Size (GB)": ("Size (bytes)", lambda sizes: round(sizes.sum()/(1000**3), 2)),
                             "Subject": ("Subject", join_unique),
                             "Extension": ("Extension", join_unique),
                             "First uploaded": ("Uploaded", earliest),
                             "Last uploaded": ("Uploaded", latest)})
                     .reset_index())
    df_datasets = df_datasets.merge(df_names, on=['Archive', 'Dataset'], how='left')
    return df_datasets[["Archive", "Dataset", "Name", "Modality", "Size (GB)", "Subject", "Extension",
                        "First uploaded", "Last uploaded"]]


# Summarize data across modalities
def summarize_modalities(df):
    local_modalities = list(dict.fromkeys(modalities.values())) + ['Unknown']

    df_modalities = pd.DataFrame(columns=["Modality",
                                          "Size (GB)",
                                          "Subject",
                                          "Extension"])
    for value in local_modalities:
        df_modalities.loc[len(df_modalities)] = [value,
                    round(sum(df[(df['Modality'] == value)]['Size (bytes)'])/(1000**3),2),
                    ','.join(df[(df['Modality'] == value)]['Subject'].unique()),
                    ','.join(df[(df['Modality'] == value)]['Extension'].unique())]

    return df_modalities


def write_csvs(df, df_names, directory='./static'):
    df.to_csv(f'{directory}/lincbrain_assets.csv', index=False)
    summarize_datasets(df, df_names).to_csv(f'{directory}/lincbrain_datasets.csv', index=False)
    summarize_modalities(df).to_csv(f'{directory}/lincbrain_modalities.csv', index=False)


if __name__ == "__main__":
    cache = load_cache()
    assets, names = [], []
    for archive, config in ARCHIVES.items():
        token = os.environ.get(config['token_env'])
        if config['token_required'] and not token:
            raise RuntimeError(f"{config['token_env']} environment variable not set")

        client = ArchiveClient(config['api_url'], token)
        if token:
            client.check_token(config['token_env'])
        df_archive, df_archive_names = extract_assets(archive, client, config, cache)
        assets.append(df_archive)
        names.append(df_archive_names)

    write_csvs(pd.concat(assets, ignore_index=True), pd.concat(names, ignore_index=True))
