const EDGE_EVER_FEED_URL = "https://github.com/tianma-if/edgeever/commits.atom";

export interface EdgeEverRevision {
  repository: "tianma-if/edgeever";
  branch: string;
  commit: string;
}

export async function readEdgeEverRevision(): Promise<EdgeEverRevision | null> {
  const response = await fetch(EDGE_EVER_FEED_URL, {
    headers: { Accept: "application/atom+xml", "User-Agent": "Menote EdgeEver importer" },
  });
  if (!response.ok) return null;
  const feed = await response.text();
  const branch = /<id>tag:github\.com,2008:\/tianma-if\/edgeever\/commits\/([^<]+)<\/id>/.exec(feed)?.[1];
  const commit = /<id>tag:github\.com,2008:Grit::Commit\/([a-f0-9]{40})<\/id>/.exec(feed)?.[1];
  if (!branch || !commit) return null;
  return { repository: "tianma-if/edgeever", branch, commit };
}
