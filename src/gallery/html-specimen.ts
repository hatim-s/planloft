// An authored HTML page. It owns its layout, structure and script and reads the theme
// tokens straight from `--planloft-*`; one block opts into `.planloft-prose` for
// Markdown-like typography. The gallery shows it in every theme to prove that a theme
// restyles an authored page without touching its structure. Demonstration only.
export const HTML_SPECIMEN_TITLE = "Reading-room survey, March";

export const HTML_SPECIMEN_BODY = String.raw`<style>
  body {
    margin: 0;
    background: var(--planloft-paper);
    color: var(--planloft-ink);
    font: var(--planloft-font-size) / var(--planloft-line-height) var(--planloft-font-body);
  }
  .survey { max-width: 64rem; margin: 0 auto; padding: 5rem clamp(1.25rem, 5vw, 3rem) 6rem; }
  .survey-head { display: grid; gap: 0.75rem; padding-bottom: 2rem; border-bottom: 2px solid var(--planloft-ink); }
  .survey-head h1 {
    margin: 0;
    font: var(--planloft-heading-weight) var(--planloft-h1-size) / var(--planloft-heading-line-height) var(--planloft-font-heading);
    letter-spacing: var(--planloft-heading-tracking);
    max-width: 22ch;
  }
  .survey-head p { margin: 0; max-width: 56ch; color: var(--planloft-muted); }
  .survey-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr)); gap: 1.25rem; margin: 2.5rem 0; }
  .figure { padding: 1.1rem 1.25rem 1.25rem; background: var(--planloft-surface); border-radius: 8px; }
  .figure b { display: block; font: var(--planloft-heading-weight) 2.4em / 1 var(--planloft-font-heading); letter-spacing: var(--planloft-heading-tracking); }
  .figure span { color: var(--planloft-muted); font-size: 0.9em; }
  .figure i { display: block; height: 6px; margin-top: 0.9rem; border-radius: 3px; background: linear-gradient(90deg, var(--planloft-chart-1) var(--share), var(--planloft-rule) var(--share)); }
  .columns { display: grid; grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); gap: 3rem; }
  .quote-list { margin: 0; padding: 0; list-style: none; display: grid; gap: 1rem; }
  .quote-list li { padding: 1rem 1.1rem; border-left: 4px solid var(--planloft-accent); background: var(--planloft-surface); }
  .quote-list cite { display: block; margin-top: 0.4rem; color: var(--planloft-muted); font-style: normal; font-size: 0.88em; }
  .toggle {
    font: 600 0.92em var(--planloft-font-body);
    padding: 0.45em 1em;
    border: 0;
    border-radius: 999px;
    background: var(--planloft-accent);
    color: var(--planloft-accent-contrast);
    cursor: pointer;
  }
  .toggle:focus-visible { outline: 2px solid var(--planloft-accent); outline-offset: 3px; }
  .hidden { display: none; }
  .raw { margin-top: 2rem; padding: 1rem 1.2rem; background: var(--planloft-code-paper); color: var(--planloft-code-ink); font: var(--planloft-code-size) / 1.6 var(--planloft-font-mono); border-radius: 6px; overflow-x: auto; }
  @media (max-width: 48rem) { .columns { grid-template-columns: minmax(0, 1fr); } }
</style>
<div class="survey">
  <header class="survey-head">
    <h1>What 312 readers told us about finding things</h1>
    <p>A fortnight of paper slips at the reading-room desk, typed up and sorted. The page is hand-built HTML; the theme supplies colour and type and nothing else.</p>
  </header>

  <div class="survey-grid" role="list">
    <div class="figure" role="listitem" style="--share: 61%"><b>61%</b><span>searched more than one catalogue for the last item they asked for</span><i></i></div>
    <div class="figure" role="listitem" style="--share: 23%"><b>23%</b><span>were given a shelf mark that turned out to be wrong</span><i></i></div>
    <div class="figure" role="listitem" style="--share: 88%"><b>88%</b><span>would rather keep the current loan rules than get a new feature</span><i></i></div>
  </div>

  <div class="columns">
    <section class="planloft-prose">
      <h2>What readers said</h2>
      <p>This column opts into the shared prose styles with one class, so a block of ordinary Markdown-style content sits beside the authored layout and still matches the theme.</p>
      <p>The free-text answers were short. Most people wrote one line. The three themes below cover nine answers in ten; the rest were about the coffee machine.</p>
      <ol>
        <li><strong>One place to look.</strong> Readers do not know there are three catalogues and do not want to.</li>
        <li><strong>Trust the shelf mark.</strong> A wrong mark costs a walk to the stacks and back. Two wrong marks and the reader asks staff instead of searching.</li>
        <li><strong>Leave loans alone.</strong> Nobody asked for a change to the loan rules. Several asked us not to make one.</li>
      </ol>
      <p>The search box on the public site was mentioned by <a href="#method">41 readers</a>, always in the same terms: it works until you need an older item, then it goes quiet.</p>
      <h3 id="method">Method</h3>
      <p>Slips were offered to every reader at the desk between 9 and 5 for ten working days. We counted <code>312</code> returned slips against <code>1,104</code> desk visits, so about <code>28%</code> took part.</p>
    </section>
    <aside>
      <ul class="quote-list">
        <li>"I asked for the 1952 pamphlet and got three different shelf numbers from three different screens."<cite>Reader, Tuesday morning</cite></li>
        <li>"Please do not change how I renew. It works."<cite>Reader, Friday</cite></li>
        <li>"The website search is fine for anything printed after I was born."<cite>Reader, Thursday</cite></li>
      </ul>
      <p style="margin-top: 1.5rem"><button class="toggle" type="button" data-toggle="raw">Show the raw counts</button></p>
    </aside>
  </div>

  <pre class="raw hidden" id="raw">searched_multiple   190 / 312   0.609
wrong_shelf_mark     72 / 312   0.231
keep_loan_rules     275 / 312   0.881
mentioned_site      41 / 312   0.131</pre>
</div>
<script>
  document.querySelector("[data-toggle]").addEventListener("click", (event) => {
    const target = document.getElementById(event.currentTarget.dataset.toggle);
    const shown = target.classList.toggle("hidden") === false;
    event.currentTarget.textContent = shown ? "Hide the raw counts" : "Show the raw counts";
  });
</script>`;

/** The complete authored document, the way an agent would hand it to \`planloft render\`. */
export const HTML_SPECIMEN_DOCUMENT = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${HTML_SPECIMEN_TITLE}</title>
</head>
<body>
${HTML_SPECIMEN_BODY}
</body>
</html>
`;
