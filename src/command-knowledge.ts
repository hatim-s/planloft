export const COMMAND_CATEGORIES = [
  "Write and transform sources",
  "Work with stored documents",
  "Agent integration",
  "Configuration",
] as const;

export type CommandCategory = (typeof COMMAND_CATEGORIES)[number];
export type CommandInput = "source" | "stored document" | "none";
export type WriteEffect = "never" | "optional" | "always";

export interface CommandExample {
  /** Arguments passed to the planloft executable, excluding the executable itself. */
  argv: readonly string[];
  /** Environment assignments required by the example before launching planloft. */
  environment?: Readonly<Record<string, string>>;
  /** Human-readable setup that cannot be represented as argv or environment. */
  preconditions?: readonly string[];
}

export interface CommandKnowledge {
  name: string;
  signature: string;
  category: CommandCategory;
  purpose: string;
  input: CommandInput;
  transition: string;
  localWrite: WriteEffect;
  externalWrite: WriteEffect;
  destructive: boolean;
  defaults: string[];
  examples: readonly CommandExample[];
  trustAndPrivacy: string[];
}

export const PUBLICATION_PRIVACY_DISCLOSURE =
  "Public deployment: the URL path is hard to guess and marked noindex, but the backing " +
  "GitHub repository is public. Repository visitors can enumerate document folders and " +
  "manifest metadata. Keep sensitive plans local.";
export const GITHUB_AUTH_DISCLOSURE =
  "GitHub auth precedence is authenticated gh, PLANLOFT_GITHUB_TOKEN, github.token, then " +
  "a hidden TTY prompt; noninteractive runs never prompt.";
export const GISCUS_REQUIREMENTS =
  "--comments requires GitHub Discussions plus giscus.repo, giscus.repoId, " +
  "giscus.category, and giscus.categoryId.";
export const TTL_REQUIREMENTS =
  "--ttl and config.defaultTtlDays must be finite positive integers; the configured default " +
  "is used only when --ttl is omitted.";

export const COMMAND_KNOWLEDGE: readonly CommandKnowledge[] = [
  {
    name: "render",
    signature: "render <input>",
    category: "Write and transform sources",
    purpose: "Render Markdown, JSON, or trusted HTML to a self-contained HTML artifact.",
    input: "source",
    transition: "source -> artifact",
    localWrite: "optional",
    externalWrite: "never",
    destructive: false,
    defaults: ["Writes HTML to stdout unless --out is provided."],
    examples: [
      { argv: ["render", "proposal.md", "--theme", "editorial", "--out", "./proposal-site"] },
    ],
    trustAndPrivacy: [
      "HTML input and embedded Markdown HTML require the explicit --trusted-html trust decision.",
    ],
  },
  {
    name: "hoist",
    signature: "hoist <input>",
    category: "Write and transform sources",
    purpose: "Normalize Markdown, JSON, or trusted HTML into the current project's store.",
    input: "source",
    transition: "source -> canonical document -> store",
    localWrite: "always",
    externalWrite: "never",
    destructive: false,
    defaults: ["Uses document metadata and the current project identity to choose the store entry."],
    examples: [{ argv: ["hoist", "proposal.json"] }],
    trustAndPrivacy: [
      "HTML input and embedded Markdown HTML require the explicit --trusted-html trust decision.",
    ],
  },
  {
    name: "publish",
    signature: "publish <input>",
    category: "Write and transform sources",
    purpose: "Hoist, render, and publish a source to GitHub Pages.",
    input: "source",
    transition: "source -> store -> artifact -> GitHub Pages",
    localWrite: "always",
    externalWrite: "always",
    destructive: false,
    defaults: ["Uses the configured default TTL when --ttl is omitted.", "Comments are off."],
    examples: [{ argv: ["publish", "proposal.md", "--ttl", "30"] }],
    trustAndPrivacy: [
      "Publishes to GitHub only when invoked explicitly.",
      PUBLICATION_PRIVACY_DISCLOSURE,
      GITHUB_AUTH_DISCLOSURE,
      GISCUS_REQUIREMENTS,
      TTL_REQUIREMENTS,
      "HTML input and embedded Markdown HTML require the explicit --trusted-html trust decision.",
    ],
  },
  {
    name: "list",
    signature: "list",
    category: "Work with stored documents",
    purpose: "List stored documents grouped by project.",
    input: "stored document",
    transition: "store -> terminal listing",
    localWrite: "never",
    externalWrite: "never",
    destructive: false,
    defaults: ["Lists every kind unless --kind is provided."],
    examples: [{ argv: ["list", "--kind", "plan"] }],
    trustAndPrivacy: [],
  },
  {
    name: "preview",
    signature: "preview [slug]",
    category: "Work with stored documents",
    purpose: "Build and open a local themed preview of a stored document.",
    input: "stored document",
    transition: "stored document -> temporary local artifact",
    localWrite: "always",
    externalWrite: "never",
    destructive: false,
    defaults: ["Uses the latest document for the current project when slug is omitted."],
    examples: [{ argv: ["preview", "architecture-roadmap"] }],
    trustAndPrivacy: ["Opens a local file and does not publish it."],
  },
  {
    name: "copy",
    signature: "copy [slug]",
    category: "Work with stored documents",
    purpose: "Copy a stored document's raw source into the current repository.",
    input: "stored document",
    transition: "stored document -> repository source",
    localWrite: "always",
    externalWrite: "never",
    destructive: false,
    defaults: [
      "Uses the latest document when slug is omitted.",
      "Writes to <git-root>/.planloft/plans/; outside Git, uses the current directory and prints a notice.",
      "Refuses to replace an existing copy unless --force is provided.",
    ],
    examples: [{ argv: ["copy", "architecture-roadmap"] }],
    trustAndPrivacy: [],
  },
  {
    name: "deploy",
    signature: "deploy [slug]",
    category: "Work with stored documents",
    purpose: "Build and publish a stored document to GitHub Pages.",
    input: "stored document",
    transition: "stored document -> public GitHub Pages artifact",
    localWrite: "always",
    externalWrite: "always",
    destructive: false,
    defaults: [
      "Uses the latest document when slug is omitted.",
      "Uses the configured default TTL when --ttl is omitted.",
      "Comments are off.",
    ],
    examples: [{ argv: ["deploy", "architecture-roadmap", "--ttl", "30"] }],
    trustAndPrivacy: [
      "Publishes to GitHub only when invoked explicitly.",
      PUBLICATION_PRIVACY_DISCLOSURE,
      GITHUB_AUTH_DISCLOSURE,
      GISCUS_REQUIREMENTS,
      TTL_REQUIREMENTS,
    ],
  },
  {
    name: "rm",
    signature: "rm <slug>",
    category: "Work with stored documents",
    purpose: "Delete a stored document's source and index entry.",
    input: "stored document",
    transition: "stored document -> deleted",
    localWrite: "always",
    externalWrite: "never",
    destructive: true,
    defaults: [],
    examples: [{ argv: ["rm", "obsolete-roadmap"] }],
    trustAndPrivacy: ["Deletes stored source; this operation is destructive."],
  },
  {
    name: "resolve",
    signature: "resolve",
    category: "Agent integration",
    purpose: "Resolve the exact plan path, kind, theme, and authoring template.",
    input: "none",
    transition: "project + plan metadata -> exact store target and authoring guidance",
    localWrite: "always",
    externalWrite: "never",
    destructive: false,
    defaults: ["Kind defaults to plan; title and slug are derived when omitted."],
    examples: [
      {
        argv: [
          "resolve",
          "--kind",
          "plan",
          "--slug",
          "auth-refactor",
          "--title",
          "Authentication Refactor",
        ],
      },
    ],
    trustAndPrivacy: ["Used by write-plan; never guess a store path instead."],
  },
  {
    name: "config",
    signature: "config",
    category: "Configuration",
    purpose: "Open the versioned global configuration in $EDITOR, validate it, or print it.",
    input: "none",
    transition: "configuration -> editor or terminal",
    localWrite: "optional",
    externalWrite: "never",
    destructive: false,
    defaults: ["Creates defaults only when config.json does not exist; other failures are explicit."],
    examples: [{ argv: ["config"], environment: { EDITOR: "nano" } }],
    trustAndPrivacy: ["The printed configuration can contain local publishing settings."],
  },
  {
    name: "init",
    signature: "init",
    category: "Configuration",
    purpose: "Create default configuration and report GitHub readiness.",
    input: "none",
    transition: "local environment -> configuration + readiness report",
    localWrite: "optional",
    externalWrite: "never",
    destructive: false,
    defaults: ["Keeps an existing config unchanged."],
    examples: [{ argv: ["init"] }],
    trustAndPrivacy: ["Does not publish a document."],
  },
];

export const PLUGIN_DEFAULT_PROMPTS = [
  "Save this substantial implementation plan with planloft.",
  "Use customize-planloft to explain the document pipeline or build a custom theme.",
  "Run planloft help and show me the right operation for this document.",
];

export function commandKnowledge(name: string): CommandKnowledge {
  const entry = COMMAND_KNOWLEDGE.find((command) => command.name === name);
  if (!entry) throw new Error(`Missing command knowledge for ${name}.`);
  return entry;
}

export function formatRootWorkflowHelp(): string {
  const sections = COMMAND_CATEGORIES.map((category) => {
    const commands = COMMAND_KNOWLEDGE.filter((command) => command.category === category)
      .map((command) => `  ${command.signature.padEnd(21)} ${command.purpose}`)
      .join("\n");
    return `${category}\n${commands}`;
  }).join("\n\n");

  return [
    "Workflows:",
    sections,
    "State transitions:",
    "  render:  source -> artifact",
    "  hoist:   source -> canonical document -> store",
    "  publish: source -> store -> artifact -> GitHub Pages",
    "  preview: stored document -> temporary local artifact",
    "  copy:    stored document -> repository source",
    "  deploy:  stored document -> public GitHub Pages artifact",
    "",
    "Safety:",
    "  --trusted-html accepts only content you trust.",
    `  ${PUBLICATION_PRIVACY_DISCLOSURE}`,
    `  ${GITHUB_AUTH_DISCLOSURE}`,
    `  ${GISCUS_REQUIREMENTS}`,
    `  ${TTL_REQUIREMENTS}`,
    "  rm deletes stored source.",
    "",
    "Run `planloft help <command>` for defaults, examples, and command-specific safety notes.",
  ].join("\n");
}

export function formatCommandHelp(name: string): string {
  const command = commandKnowledge(name);
  const lines = [
    "Workflow:",
    `  Input: ${command.input}`,
    `  Transition: ${command.transition}`,
    `  Local write: ${command.localWrite}`,
    `  External write: ${command.externalWrite}`,
    `  Destructive: ${command.destructive ? "yes" : "no"}`,
  ];

  if (command.defaults.length) {
    lines.push("", "Defaults:", ...command.defaults.map((item) => `  - ${item}`));
  }
  lines.push(
    "",
    "Examples:",
    ...command.examples.map((example) => `  $ ${renderCommandExample(example)}`),
  );
  const preconditions = command.examples.flatMap((example) => example.preconditions ?? []);
  if (preconditions.length) {
    lines.push("", "Example preconditions:", ...preconditions.map((item) => `  - ${item}`));
  }
  if (command.trustAndPrivacy.length) {
    lines.push(
      "",
      "Safety and privacy:",
      ...command.trustAndPrivacy.map((item) => `  - ${item}`),
    );
  }
  return lines.join("\n");
}

export function renderReadmeCliReference(): string {
  return COMMAND_KNOWLEDGE.map(
    (command) => `- \`planloft ${command.signature}\` — ${command.purpose}`,
  ).join("\n");
}

export function renderReadmeCliExamples(): string {
  return ["render", "hoist", "publish"]
    .flatMap((name) => commandKnowledge(name).examples)
    .map((example) => renderCommandExample(example))
    .join("\n");
}

export function renderCommandExample(
  example: CommandExample,
  executable = "planloft",
): string {
  const environment = Object.entries(example.environment ?? {}).map(
    ([name, value]) => `${name}=${shellToken(value)}`,
  );
  return [
    ...environment,
    shellToken(executable),
    ...example.argv.map((argument) => shellToken(argument)),
  ].join(" ");
}

function shellToken(value: string): string {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) return value;
  return `"${value.replace(/[\\"$`]/g, "\\$&")}"`;
}

export function renderSkillDiscoveryReference(command = "planloft"): string {
  return [
    `Run \`${command} help\` to discover all operations.`,
    "",
    "Common next actions:",
    `- \`${command} render <input>\` produces HTML without storing or publishing.`,
    `- \`${command} preview [slug]\` opens a stored plan locally.`,
    `- \`${command} copy [slug]\` copies raw source into the repository.`,
    `- \`${command} deploy [slug]\` explicitly publishes a stored plan.`,
    `- \`${command} hoist <input>\` stores another Markdown, JSON, or trusted HTML document.`,
  ].join("\n");
}
