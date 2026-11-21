# Built-in Planloft themes

The original six themes are `minimal`, `detailed`, `editorial`, `decision`, `research`, and
`briefing`. Each supplies colors and typography for light and dark modes. Select a
theme with `--theme <name>`, document metadata, a project override, or the global
configuration. User themes shadow built-ins with the same name.

## Three-color palettes

| Theme | Base colors | Accent | Reference |
| --- | --- | --- | --- |
| `wine-kelly` | Blush and deep wine | Kelly green | [Charles Liu][charles] |
| `navy-amber` | Cream and navy | Amber | [Charles Liu][charles] |
| `pistachio-raspberry` | Pistachio and ink | Raspberry | [Charles Liu][charles] |
| `cream-burnt-orange` | Cream and soft black | Burnt orange | [Diego Aranda][diego] |
| `navy-hot-pink` | White and navy | Hot pink | [Diego Aranda][diego] |
| `sand-electric-blue` | Sand and charcoal | Electric blue | [Diego Aranda][diego] |
| `blush-chartreuse` | Blush and burgundy | Chartreuse | [Ryan Naghib][ryan] |
| `ice-fire-orange` | Ice blue and steel gray | Fire orange | [Ryan Naghib][ryan] |
| `pistachio-cherry` | Warm sand and pistachio | Cherry red | [Ryan Naghib][ryan] |

These themes adapt the source color names for documents. Light and dark modes
use different shades for readable text, links, and status labels.

Planloft embeds Latin variable fonts from Fontsource in rendered documents.
Inter, Raleway, Geist, and Geist Mono are available offline. System fallbacks
cover other scripts. The [font licenses](./_fonts/) ship with Planloft.

[charles]: https://ttanon.com/@charles.unemployed/video/7708437849615453446
[diego]: https://www.instagram.com/reel/Dfc-Q-0yy0W/
[ryan]: https://ttanon.com/@ryannaghib/video/7709063072215764237

Themes do not supply templates or layouts. Authors choose the structure of Markdown,
MDX, or HTML to suit the document. Markdown and MDX use the shared prose shell. HTML
keeps its own structure, styles, and scripts and may opt into shared prose styling with
`.planloft-prose`. Every document gets reading/full-width controls. HTML uses its body as the width
container unless it supplies `.planloft-plan > article`.

Run `planloft gallery --out <dir>` to inspect themes and static components locally.
See the [theme contract](../skills/planloft-customise/references/themes.md) for custom
themes and public variables, and the [migration guide](../docs/installation-migration.md#legacy-theme-migration)
for legacy theme assets.
