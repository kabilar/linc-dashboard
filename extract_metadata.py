import os
import re
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

modalities = {'oct': 'PS-OCT',
              'df': 'Dark field microscopy',
              'xpct': 'HiP-CT',
              'dwi': 'Diffusion MRI',
              'fluo': 'Light sheet microscopy',
              'spim': 'Light sheet microscopy',
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
        self.session.mount('https://', HTTPAdapter(max_retries=retries))
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
def extract_assets(archive, client, config):
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
            })

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
    assets, names = [], []
    for archive, config in ARCHIVES.items():
        token = os.environ.get(config['token_env'])
        if config['token_required'] and not token:
            raise RuntimeError(f"{config['token_env']} environment variable not set")

        client = ArchiveClient(config['api_url'], token)
        if token:
            client.check_token(config['token_env'])
        df_archive, df_archive_names = extract_assets(archive, client, config)
        assets.append(df_archive)
        names.append(df_archive_names)

    write_csvs(pd.concat(assets, ignore_index=True), pd.concat(names, ignore_index=True))
