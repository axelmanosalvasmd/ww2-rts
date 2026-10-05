#!/usr/bin/env python3
"""Verify retained archive bytes. This does not run or grade the game."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import tarfile


def digest(stream):
    h = hashlib.sha256()
    size = 0
    for chunk in iter(lambda: stream.read(1024 * 1024), b''):
        size += len(chunk)
        h.update(chunk)
    return size, h.hexdigest()


def file_digest(path):
    with path.open('rb') as stream:
        return digest(stream)


def checksum_map(data):
    result = {}
    for line in data.decode().splitlines():
        value, name = line.split('  ', 1)
        assert name not in result and len(value) == 64, name
        result[name] = value
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive-only', action='store_true',
                        help='Verify durable bytes without requiring temporary originals.')
    args = parser.parse_args()
    directory = Path(__file__).resolve().parent
    for name, value in checksum_map((directory / 'SHA256SUMS').read_bytes()).items():
        assert PurePosixPath(name).name == name, name
        assert file_digest(directory / name)[1] == value, name
    proof = json.loads((directory / 'verification.json').read_text())
    manifest_bytes = (directory / 'manifest.json').read_bytes()
    manifest = json.loads(manifest_bytes)
    assert proof['status'] == 'PASS'
    assert hashlib.sha256(manifest_bytes).hexdigest() == proof['manifestSHA256']
    assert file_digest(directory / proof['archive']) == (
        proof['archiveBytes'], proof['archiveSHA256'])
    observed = {}
    metadata = {}
    with tarfile.open(directory / proof['archive'], 'r:gz') as archive:
        for member in archive:
            path = PurePosixPath(member.name)
            assert member.isfile() and not path.is_absolute() and '..' not in path.parts
            assert member.name not in observed, member.name
            with archive.extractfile(member) as stream:
                if member.name in {'manifest.json', 'SHA256SUMS', 'README.md'}:
                    data = stream.read()
                    metadata[member.name] = data
                    observed[member.name] = (len(data), hashlib.sha256(data).hexdigest())
                else:
                    observed[member.name] = digest(stream)
            assert observed[member.name][0] == member.size, member.name
    assert metadata['manifest.json'] == manifest_bytes
    assert metadata['README.md'] == (directory / 'README.md').read_bytes()
    checksums = checksum_map(metadata['SHA256SUMS'])
    assert set(checksums) == set(observed) - {'SHA256SUMS'}
    for name, value in checksums.items():
        assert observed[name][1] == value, name
    mapped = set()
    for row in manifest['originals']:
        name = row['member']
        assert name not in mapped and observed[name] == (row['bytes'], row['sha256']), name
        mapped.add(name)
        if not args.archive_only:
            assert file_digest(Path(row['originalPath'])) == (row['bytes'], row['sha256']), row['originalPath']
    assert set(observed) == mapped | {'manifest.json', 'README.md', 'SHA256SUMS'}
    assert len(observed) == proof['members'] and len(mapped) == proof['originals']
    assert sum(row['bytes'] for row in manifest['originals']) == proof['originalCopiedBytes']
    print(json.dumps({'status': 'PASS', 'scope': 'Copy integrity only',
                      'archive': proof['archive'], 'sha256': proof['archiveSHA256'],
                      'members': len(observed), 'originals': len(mapped),
                      'originalPhysicalBytesChecked': not args.archive_only}))


if __name__ == '__main__':
    main()
