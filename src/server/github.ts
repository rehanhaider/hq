import { z } from "zod";
import type { Repository } from "../lib/model";

const userSchema = z.object({ login: z.string(), id: z.number() });
const repoSchema = z.object({
  id: z.number(),
  full_name: z.string(),
  private: z.boolean(),
  language: z.string().nullable(),
  default_branch: z.string(),
  pushed_at: z.string().nullable(),
});
export const commitListSchema = z.array(z.object({ sha: z.string() }));
export const commitSchema = z.object({
  sha: z.string(),
  html_url: z.string().url(),
  commit: z.object({
    message: z.string(),
    committer: z.object({ date: z.string().datetime({ offset: true }) }),
  }),
  parents: z.array(z.object({ sha: z.string() })),
  stats: z.object({
    additions: z.number().nonnegative(),
    deletions: z.number().nonnegative(),
  }),
  files: z.array(
    z.object({
      filename: z.string(),
      additions: z.number().nonnegative(),
      deletions: z.number().nonnegative(),
    }),
  ),
});
export const prSchema = z.object({
  number: z.number(),
  title: z.string(),
  url: z.string().url(),
  author: z.object({ login: z.string() }).nullable(),
  mergedBy: z.object({ login: z.string() }).nullable(),
  mergedAt: z.string().datetime({ offset: true }).nullable(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
  additions: z.number(),
  deletions: z.number(),
});
const pullsSchema = z.object({
  data: z.object({
    repository: z
      .object({
        pullRequests: z.object({
          nodes: z.array(prSchema),
          pageInfo: z.object({
            hasNextPage: z.boolean(),
            endCursor: z.string().nullable(),
          }),
        }),
      })
      .nullable(),
  }),
});

export class GithubClient {
  constructor(private token: string) {
    if (!token)
      throw new Error(
        "Set GITHUB_TOKEN on the server, then restart the app to connect your account.",
      );
  }
  async request(path: string, init?: RequestInit) {
    let response: Response;
    try {
      response = await fetch(`https://api.github.com${path}`, {
        ...init,
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${this.token}`,
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(60000),
        redirect: "error",
      });
    } catch {
      throw new Error(
        "Could not reach GitHub. Check the server connection and run the import again.",
      );
    }
    if (!response.ok) {
      if (
        response.status === 409 &&
        /^\/repos\/[^/]+\/[^/]+\/commits\?/.test(path)
      ) {
        const error = (await response.json()) as { message?: string };
        if (error.message === "Git Repository is empty.")
          return { body: [], next: false };
      }
      if (response.status === 401)
        throw new Error(
          "GitHub rejected the token. Update GITHUB_TOKEN and restart the app.",
        );
      if (response.status === 403 || response.status === 429) {
        const reset = response.headers.get("x-ratelimit-reset");
        const remaining = response.headers.get("x-ratelimit-remaining");
        if (
          remaining === "0" ||
          response.status === 429 ||
          response.headers.has("retry-after")
        )
          throw new Error(
            `GitHub request limit reached.${reset ? ` Limit resets at ${new Date(Number(reset) * 1000).toISOString()}.` : ""} Completed repositories are saved. Run the import again after the limit resets.`,
          );
        throw new Error(
          "GitHub denied access. Check token permissions and organization authorization.",
        );
      }
      if (response.status === 404)
        throw new Error(
          "A repository is unavailable to this token. Check repository access.",
        );
      throw new Error(
        `GitHub returned HTTP ${response.status}. Completed repositories are saved.`,
      );
    }
    return {
      body: (await response.json()) as unknown,
      next: response.headers.get("link")?.includes('rel="next"') ?? false,
    };
  }
  async user() {
    return userSchema.parse((await this.request("/user")).body);
  }
  async repositories(): Promise<Repository[]> {
    const result: Repository[] = [];
    for (let page = 1; ; page++) {
      const response = await this.request(
        `/user/repos?per_page=100&sort=pushed&direction=desc&page=${page}`,
      );
      result.push(...z.array(repoSchema).parse(response.body).map(mapRepo));
      if (!response.next) return result;
    }
  }
  async repository(name: string) {
    return mapRepo(
      repoSchema.parse((await this.request(`/repos/${name}`)).body),
    );
  }
  async pulls(name: string, cursor: string | null) {
    const [owner, repo] = name.split("/");
    const response = await this.request("/graphql", {
      method: "POST",
      body: JSON.stringify({
        query: `query($owner:String!,$repo:String!,$cursor:String){repository(owner:$owner,name:$repo){pullRequests(first:100,after:$cursor,states:MERGED,orderBy:{field:UPDATED_AT,direction:DESC}){nodes{number title url author{login} mergedBy{login} mergedAt createdAt updatedAt additions deletions}pageInfo{hasNextPage endCursor}}}}`,
        variables: { owner, repo, cursor },
      }),
    });
    const errors = z
      .object({ errors: z.array(z.object({ message: z.string() })).optional() })
      .parse(response.body).errors;
    if (errors?.length)
      throw new Error(
        "GitHub could not return pull requests. Check token permissions and API limits. Completed repositories are saved.",
      );
    const repository = pullsSchema.parse(response.body).data.repository;
    if (!repository) throw new Error(`GitHub could not read ${name}.`);
    return repository.pullRequests;
  }
}
function mapRepo(repo: z.infer<typeof repoSchema>): Repository {
  return {
    id: repo.id,
    fullName: repo.full_name,
    private: repo.private,
    language: repo.language,
    defaultBranch: repo.default_branch,
    pushedAt: repo.pushed_at,
  };
}
export function github() {
  return new GithubClient(process.env.GITHUB_TOKEN ?? "");
}
