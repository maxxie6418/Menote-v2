#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

root=/opt/menote-local
release="$root/autodeploy"
repo="$release/source.git"
origin=https://github.com/maxxie6418/Menote-v2.git
baseline=8bcfa7994cc6b225a2c371adee6e33d56d9ee6ff
container=menote-local-menote-1
ready=http://127.0.0.1:3081/api/health/ready

mkdir -p "$release"
exec 9>"$release/deploy.lock"
flock 9

# The first production image was built from dev before main contained 0.4.0.
# Require a descendant of that release and of the last successful deployment.
if [[ ! -d "$repo" ]]; then
  git clone --bare "$origin" "$repo"
fi

prepare=false
if [[ "${1:-}" == "--prepare" && "$#" == 2 && "$2" =~ ^[0-9a-f]{40}$ ]]; then
  prepare=true
  git -C "$repo" fetch --no-tags "$origin" refs/heads/dev
  git -C "$repo" merge-base --is-ancestor "$2" FETCH_HEAD
  revision="$2"
elif [[ "$#" == 0 ]]; then
  rm -f /var/lib/menote-github-hook/pending
  git -C "$repo" fetch --no-tags "$origin" refs/heads/main
  revision=$(git -C "$repo" rev-parse FETCH_HEAD)
else
  exit 2
fi

previous_revision="$baseline"
if [[ -s "$release/deployed" ]]; then
  previous_revision=$(cat "$release/deployed")
fi
git -C "$repo" merge-base --is-ancestor "$previous_revision" "$revision"
image="menote:git-$revision"
previous_image=$(docker inspect --format '{{.Config.Image}}' "$container")
if [[ "$prepare" == false && "$previous_image" == "$image" ]] && curl -fsS --max-time 4 "$ready" >/dev/null; then
  printf '%s\n' "$revision" >"$release/deployed.tmp"
  mv "$release/deployed.tmp" "$release/deployed"
  exit 0
fi

scratch=$(mktemp -d "$release/run.XXXXXXXX")
probe="menote-release-probe-${revision:0:12}"
cleanup() {
  docker rm -f "$probe" >/dev/null 2>&1 || true
  rm -rf -- "$scratch"
}
trap cleanup EXIT
if ! docker image inspect "$image" >/dev/null 2>&1; then
  mkdir "$scratch/source"
  git -C "$repo" archive "$revision" | tar -x -C "$scratch/source"
  docker build --build-arg "MENOTE_BUILD_COMMIT=${revision:0:12}" \
    --label "org.opencontainers.image.revision=$revision" \
    -f "$scratch/source/src/worker/docker/Dockerfile" -t "$image" "$scratch/source"
fi
[[ $(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$image") == "$revision" ]]

state=$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/app/state"}}{{.Source}}{{end}}{{end}}' "$container")
[[ -n "$state" && -f "$state/menote.sqlite" ]]
# Probe the new image against a consistent copy of the live database. Keep the
# production volume attached only to the live container.
mkdir "$scratch/state"
snapshot() {
  python3 - "$state/menote.sqlite" "$1" <<'PY'
import sqlite3
import sys
from pathlib import Path
source = sqlite3.connect(Path(sys.argv[1]).as_uri() + "?mode=ro", uri=True, timeout=10)
with source, sqlite3.connect(sys.argv[2]) as target:
    source.backup(target)
PY
}
snapshot "$scratch/state/menote.sqlite"
chown -R 1000:1000 "$scratch/state"
docker run -d --rm --name "$probe" --network none \
  --env AUTH_PEPPER=local-release-probe-only --env MENOTE_PUBLIC_ORIGIN=http://127.0.0.1:8787 \
  --mount "type=bind,src=$scratch/state,dst=/app/state" "$image" >/dev/null
probe_ready() {
  docker exec "$probe" node -e 'fetch("http://127.0.0.1:8787/api/health/ready").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))' >/dev/null 2>&1
}
wait_ready() {
  for ((attempt=0; attempt<25; attempt++)); do
    if "$@"; then return 0; fi
    sleep 2
  done
  return 1
}
wait_ready probe_ready
docker rm -f "$probe" >/dev/null
if [[ "$prepare" == true ]]; then
  printf 'Prepared %s\n' "$revision"
  exit 0
fi

# Preserve the original Compose project, secret file, proxy and persistent volume.
compose_with() {
  local tag=$1
  shift
  MENOTE_IMAGE="$tag" docker compose --project-directory "$root" --project-name menote-local -f "$root/compose.yaml" "$@"
}
live_ready() {
  [[ $(docker inspect --format '{{.Config.Image}}' "$container") == "$image" ]] &&
    curl -fsS --max-time 4 "$ready" >/dev/null
}
schema() {
  python3 - "$1" <<'PY'
import json
import sqlite3
import sys
from pathlib import Path
with sqlite3.connect(Path(sys.argv[1]).as_uri() + "?mode=ro", uri=True, timeout=5) as db:
    print(json.dumps(db.execute("SELECT version, name FROM schema_migrations ORDER BY version").fetchall()))
PY
}

# Recheck main before cutover so a slower build cannot supersede a newer push.
remote_head=$(git ls-remote "$origin" refs/heads/main | cut -f1)
[[ "$remote_head" == "$revision" ]] || { printf 'Main moved. The new push will queue publication.\n'; exit 0; }
snapshot "$scratch/pre-release.sqlite"
before=$(schema "$scratch/pre-release.sqlite")
mv "$scratch/pre-release.sqlite" "$release/pre-release.sqlite"
if ! compose_with "$image" up -d --no-build --no-deps menote || ! wait_ready live_ready; then
  if [[ "$(schema "$state/menote.sqlite")" == "$before" ]]; then
    compose_with "$previous_image" up -d --no-build --no-deps menote
    echo 'Release failed. Restored the previous image.'
  else
    echo 'Release failed after the schema changed. The pre-release SQLite snapshot is retained.'
  fi
  exit 1
fi

# Persist the image for manual Compose operations without touching any other keys.
python3 - "$root/.env" "$image" <<'PY'
import os
import re
import sys
import tempfile
from pathlib import Path
path, image = Path(sys.argv[1]), sys.argv[2]
contents = path.read_bytes()
entry = ("MENOTE_IMAGE=" + image).encode()
contents, count = re.subn(rb"^MENOTE_IMAGE=[^\r\n]*", entry, contents, count=1, flags=re.M)
if not count:
    contents = contents.rstrip(b"\r\n") + b"\n" + entry + b"\n"
with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as updated:
    updated.write(contents)
    updated.flush()
    os.fsync(updated.fileno())
os.replace(updated.name, path)
PY
printf '%s\n' "$revision" >"$release/deployed.tmp"
mv "$release/deployed.tmp" "$release/deployed"
printf 'Published %s\n' "$revision"
