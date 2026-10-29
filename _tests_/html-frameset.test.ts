import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createPlanloftApplication } from "../src/application.js";

test("frameset HTML fails before writes while script and comment lookalikes render", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "planloft-frameset-"));
  const home = path.join(root, "home");
  const source = path.join(root, "frameset.html");
  const content = '<html><head></head><frameset><frame src="x"></frameset></html>';
  fs.writeFileSync(source, content);
  let deployed = false;
  const app = createPlanloftApplication({ cwd: root, planloftHome: home, id: () => "test", publicationAdapter: {
    basePath: () => "/test/",
    deploy: async () => { deployed = true; return { url: "https://example.test", expiresAt: "2031-01-01T00:00:00Z" }; },
  } });
  try {
    for (const operation of ["render", "hoist", "publish"] as const) {
      await assert.rejects(app[operation](source, { trustedHtml: true }), /PLANLOFT_HTML_FRAMESET_UNSUPPORTED.*ordinary body.*original externally/);
    }
    assert.equal(deployed, false);
    assert.equal(fs.existsSync(home), false);
    assert.equal(fs.readFileSync(source, "utf8"), content);
    const lookalike = path.join(root, "ordinary.html");
    fs.writeFileSync(lookalike, '<html><head><script>const text = "<frameset>";</script></head><body><!-- <frameset> --><p>Normal</p></body></html>');
    const rendered = await app.render(lookalike, { trustedHtml: true });
    assert.equal(rendered.output, "stdout");
    if (rendered.output === "stdout") assert.match(rendered.html, /const text = "<frameset>"/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
