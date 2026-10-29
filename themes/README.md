# Built-in Planloft themes

Planloft ships `minimal`, `detailed`, `editorial`, `decision`, `research`, and
`briefing`. Each supplies colors and typography for light and dark modes. Select a
theme with `--theme <name>`, document metadata, a project override, or the global
configuration. User themes shadow built-ins with the same name.

Themes do not supply templates or layouts. Authors choose the structure of Markdown,
MDX, or HTML to suit the document. Markdown and MDX use the shared prose shell. HTML
keeps its own structure, styles, and scripts and may opt into shared prose styling with
`.planloft-prose`. Use `.planloft-plan > article` for reading/full-width support.

Run `planloft gallery --out <dir>` to inspect themes and static components locally.
See the [theme contract](../skills/planloft-customise/references/themes.md) for custom
themes and public variables, and the [migration guide](../docs/installation-migration.md#legacy-theme-migration)
for legacy theme assets.
