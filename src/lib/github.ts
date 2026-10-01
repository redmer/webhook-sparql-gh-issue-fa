import { Octokit } from "@octokit/rest";

function getOctokit(): Octokit {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error("GITHUB_TOKEN is not set");
  }
  return new Octokit({ auth: token });
}

export function splitRepo(repo: string): { owner: string; repo: string } {
  const [owner, name] = repo.split("/");
  if (!owner || !name) {
    throw new Error(`githubRepo must be "owner/name", got "${repo}"`);
  }
  return { owner, repo: name };
}

/**
 * Check whether an open issue already exists for this content hash.
 * The hash is embedded in the issue body as an HTML comment:
 *   <!-- triply-webhook-hash: <hash> -->
 */
export async function findExistingIssue(
  repoFullName: string,
  hash: string,
): Promise<number | undefined> {
  const { owner, repo } = splitRepo(repoFullName);
  const octokit = getOctokit();
  const marker = `triply-webhook-hash: ${hash}`;

  const results = await octokit.rest.search.issuesAndPullRequests({
    q: `repo:${owner}/${repo} is:issue is:open "${marker}"`,
    per_page: 5,
  });

  for (const item of results.data.items) {
    if (item.body?.includes(marker)) {
      return item.number;
    }
  }
  return undefined;
}

export async function createIssue(options: {
  repoFullName: string;
  title: string;
  body: string;
  labels?: string[];
  hash: string;
}): Promise<number> {
  const { owner, repo } = splitRepo(options.repoFullName);
  const octokit = getOctokit();

  const bodyWithHash = `${options.body}\n\n<!-- triply-webhook-hash: ${options.hash} -->`;

  const issue = await octokit.rest.issues.create({
    owner,
    repo,
    title: options.title,
    body: bodyWithHash,
    labels: options.labels,
  });
  return issue.data.number;
}
