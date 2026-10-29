import type { HostAdapter } from "./adapter.js";
import { ensurePages, publishRepository } from "./repository.js";
export { authenticatedGit, configureCleanRemote, cleanUrl, hasGh } from "./repository.js";

export const githubPages: HostAdapter = {
  name: "github-pages",
  basePath(id, cfg) {
    return `/${cfg.github?.repo ?? "planloft-plans"}/${id}/`;
  },
  async deploy(input) {
    const { repo, user, expiresAt } = await publishRepository(input);
    const warning = await ensurePages(input.authentication.token, user, repo);
    return {
      url: `https://${user}.github.io/${repo}/${input.doc.slug}/`,
      expiresAt,
      ...(warning ? { warnings: [warning] } : {}),
    };
  },
};
