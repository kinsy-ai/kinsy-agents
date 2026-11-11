// @vitest-environment jsdom
// The sidebar page itself, run in a DOM with a fake google.script.run.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ROOT } from "./harness.mjs";

const html = readFileSync(join(ROOT, "Sidebar.html"), "utf8");
const BODY = html.slice(html.indexOf("<body>") + 6, html.indexOf("<script>"));
const SCRIPT = html.slice(html.indexOf("<script>") + 8, html.lastIndexOf("</script>"));
const AUTH_URL = "https://kinsy.ai/oauth/authorize?client_id=x&state=s";
const SLIDES_URL = "https://docs.google.com/presentation/d/1AbCdEfGhIjKlMnOp/edit";

const $ = (id) => document.getElementById(id);
const visible = () => [...document.querySelectorAll("section")].filter((s) => !s.hidden).map((s) => s.id.slice(2));
const tick = (ms = 0) => vi.advanceTimersByTimeAsync(ms);
const running = { ok: true, status: "running", progress: 0.4, slidesRendered: 4, slidesTotal: 10, title: "", error: "" };
const done = { ok: true, status: "done", progress: 1, slidesRendered: 10, slidesTotal: 10, title: "Q3 board update", error: "" };

// api: {name: (...args) => value | Promise<value>}; a thrown error reaches the failure handler.
async function mount(over = {}) {
  const calls = [];
  const api = {
    getState: () => ({ ok: true, signedIn: true, host: "slides", documentName: "", pricingUrl: "https://kinsy.ai/pricing?src=gws-addon" }),
    checkSignIn: () => ({ ok: true, signedIn: false }),
    signOut: () => ({ ok: true }),
    startBuild: () => ({ ok: true, deckId: "deck-1" }),
    pollDeck: () => done,
    saveDeck: () => ({ ok: true, url: SLIDES_URL, title: "Q3 board update" }),
    ...over,
  };
  window.google = {
    script: {
      get run() {
        let ok = () => {}, bad = () => {};
        const r = {
          withSuccessHandler(f) { ok = f; return r; },
          withFailureHandler(f) { bad = f; return r; },
        };
        for (const name of Object.keys(api)) {
          r[name] = (...args) => {
            calls.push([name, ...args]);
            Promise.resolve().then(() => api[name](...args)).then(ok, bad);
          };
        }
        return r;
      },
    },
  };
  document.body.innerHTML = BODY;
  $("signin").addEventListener("click", (e) => e.preventDefault());   // jsdom cannot open tabs
  new Function(SCRIPT)();
  await tick();
  return { calls, named: (n) => calls.filter((c) => c[0] === n) };
}

function type(text) {
  $("brief").value = text;
  $("brief").dispatchEvent(new Event("input"));
}
function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ""; });

describe("form", () => {
  it("needs a brief before Build is enabled in Slides", async () => {
    await mount();
    expect(visible()).toEqual(["form"]);
    expect($("doc-row").hidden).toBe(true);
    expect($("build").disabled).toBe(true);
    type("   ");
    expect($("build").disabled).toBe(true);
    type("Board update");
    expect($("build").disabled).toBe(false);
  });

  it("can build from the document alone in Docs", async () => {
    await mount({ getState: () => ({ ok: true, signedIn: true, host: "docs", documentName: "Q3 <b>notes</b>" }) });
    expect($("doc-row").hidden).toBe(false);
    expect($("doc-name").innerHTML).toBe("Q3 &lt;b&gt;notes&lt;/b&gt;");     // shown as text
    expect($("build").disabled).toBe(false);
    $("use-doc").checked = false;
    $("use-doc").dispatchEvent(new Event("change"));
    expect($("build").disabled).toBe(true);
  });
});

describe("build", () => {
  it("builds, saves and links to the Slides file", async () => {
    const polls = [running, done];
    const t = await mount({ pollDeck: () => polls.shift() });
    type("Board update");
    $("build").click();
    await tick();
    expect(visible()).toEqual(["building"]);
    expect($("progress").textContent).toBe("4 of 10 slides ready");
    await tick(3000);
    expect(visible()).toEqual(["done"]);
    expect(t.named("startBuild")[0][1]).toMatchObject({ brief: "Board update", slides: 10, useDocument: false });
    expect(t.named("saveDeck")).toEqual([["saveDeck", "deck-1"]]);
    expect($("open-slides").hidden).toBe(false);
    expect($("open-slides").getAttribute("href")).toBe(SLIDES_URL);
    expect($("done-kinsy").getAttribute("href")).toBe("https://kinsy.ai/deck/deck-1");
    expect($("done-title").textContent).toBe("Q3 board update");
  });

  it("cannot be submitted twice while the first submission is in flight", async () => {
    const d = deferred();
    const t = await mount({ startBuild: () => d.promise });
    type("Board update");
    $("build").click();
    await tick();
    type("Board update, edited");            // typing must not re-enable the button
    expect($("build").disabled).toBe(true);
    $("build").click();
    $("build").dispatchEvent(new Event("click"));   // even a click that ignores the disabled state
    await tick();
    expect(t.named("startBuild")).toHaveLength(1);
    d.resolve({ ok: true, deckId: "deck-1" });
    await tick();
    expect(visible()).toEqual(["done"]);
  });

  it("repeats a failed submission under the same key, and a changed one under a new key", async () => {
    const answers = [{ ok: false, kind: "server", message: "Kinsy could not be reached." }, { ok: true, deckId: "deck-1" }, { ok: true, deckId: "deck-2" }];
    const t = await mount({ startBuild: () => answers.shift() });
    type("Board update");
    $("build").click();
    await tick();
    expect(visible()).toEqual(["error"]);
    $("retry").click();
    $("build").click();
    await tick();
    const [first, second] = t.named("startBuild").map((c) => c[1].key);
    expect(first).toMatch(/^[0-9a-f]{32}$/);
    expect(second).toBe(first);
    $("another").click();
    $("build").click();
    await tick();
    expect(t.named("startBuild")[2][1].key).not.toBe(first);     // a new deck after a success

    type("Something else");
    const k = t.named("startBuild").length;
    $("build").click();
    await tick();
    expect(t.named("startBuild")[k][1].key).not.toBe(t.named("startBuild")[k - 1][1].key);
  });

  it("shows the credits view with the purchase link", async () => {
    await mount({ startBuild: () => ({ ok: false, kind: "credits", message: "needs 40" }) });
    type("Board update");
    $("build").click();
    await tick();
    expect(visible()).toEqual(["error"]);
    expect($("error-title").textContent).toBe("You're out of credits");
    expect($("error-message").textContent).toContain("Nothing was charged");
    expect($("buy").hidden).toBe(false);
    expect($("buy").getAttribute("href")).toBe("https://kinsy.ai/pricing?src=gws-addon");
    expect($("retry").className).not.toContain("action");       // one primary action
  });

  it("links to the deck in Kinsy when a build stops", async () => {
    await mount({ pollDeck: () => ({ ...running, status: "stalled", error: "" }) });
    type("Board update");
    $("build").click();
    await tick();
    expect(visible()).toEqual(["error"]);
    expect($("error-message").textContent).toBe("The build stopped before it finished.");
    expect($("error-kinsy").hidden).toBe(false);
    expect($("error-kinsy").getAttribute("href")).toBe("https://kinsy.ai/deck/deck-1");
  });

  it("rides out a blip while polling, but not five in a row", async () => {
    const blip = { ok: false, kind: "server", message: "Kinsy could not be reached." };
    const polls = [blip, blip, running, done];
    await mount({ pollDeck: () => polls.shift() });
    type("Board update");
    $("build").click();
    await tick(3000 * 4);
    expect(visible()).toEqual(["done"]);

    document.body.innerHTML = "";
    await mount({ pollDeck: () => blip });
    type("Board update");
    $("build").click();
    await tick(3000 * 6);
    expect(visible()).toEqual(["error"]);
    expect($("error-kinsy").hidden).toBe(false);
  });

  it("gives up after fifteen minutes and points at Kinsy", async () => {
    const t = await mount({ pollDeck: () => running });
    type("Board update");
    $("build").click();
    await tick(15 * 60 * 1000 + 6000);
    expect(visible()).toEqual(["error"]);
    expect($("error-message").textContent).toContain("taking longer than expected");
    const n = t.named("pollDeck").length;
    await tick(60000);
    expect(t.named("pollDeck")).toHaveLength(n);                 // polling has stopped
  });

  it("offers to save again when Drive refuses, without rebuilding", async () => {
    const saves = [{ ok: false, kind: "drive_full", message: "Your Google Drive is full. Free some space, then save again." }, { ok: true, url: SLIDES_URL, title: "Q3 board update" }];
    const t = await mount({ saveDeck: () => saves.shift() });
    type("Board update");
    $("build").click();
    await tick();
    expect(visible()).toEqual(["done"]);
    expect($("open-slides").hidden).toBe(true);
    expect($("save-again").hidden).toBe(false);
    expect($("done-note").textContent).toBe("Your Google Drive is full. Free some space, then save again. The deck is safe in Kinsy.");
    $("save-again").click();
    await tick();
    expect($("open-slides").hidden).toBe(false);
    expect($("save-again").hidden).toBe(true);
    expect(t.named("startBuild")).toHaveLength(1);
    expect(t.named("saveDeck")).toHaveLength(2);
  });

  it("will not link anywhere but Google Slides", async () => {
    await mount({ saveDeck: () => ({ ok: true, url: "javascript:alert(1)", title: "x" }) });
    type("Board update");
    $("build").click();
    await tick();
    expect($("open-slides").getAttribute("href")).toBe("#");
  });

  it("survives Google failing to run the script", async () => {
    await mount({ startBuild: () => { throw new Error("ScriptError"); } });
    type("Board update");
    $("build").click();
    await tick();
    expect(visible()).toEqual(["error"]);
    expect($("error-message").textContent).toBe("Google could not run the add-on. Try again.");
  });
});

describe("sign-in", () => {
  const signedOut = () => ({ ok: true, signedIn: false, host: "slides", documentName: "", signInUrl: AUTH_URL });

  it("shows the sign-in link and nothing else", async () => {
    await mount({ getState: signedOut });
    expect(visible()).toEqual(["signed-out"]);
    expect($("signin").getAttribute("href")).toBe(AUTH_URL);
    expect($("signout").hidden).toBe(true);
  });

  it("refuses a sign-in link that is not Kinsy's", async () => {
    await mount({ getState: () => ({ ...signedOut(), signInUrl: "https://kinsy.ai.evil.example/oauth/authorize?x" }) });
    expect($("signin").getAttribute("href")).toBe("#");
  });

  it("moves to the form once sign-in finishes in the other tab", async () => {
    let signedIn = false;
    const t = await mount({
      getState: () => (signedIn ? { ok: true, signedIn: true, host: "slides", documentName: "" } : signedOut()),
      checkSignIn: () => ({ ok: true, signedIn }),
    });
    $("signin").click();
    $("signin").click();                                   // a second click does not double the polling
    expect($("signin-wait").hidden).toBe(false);
    await tick(2500);
    expect(t.named("checkSignIn")).toHaveLength(1);
    signedIn = true;
    await tick(2500);
    expect(visible()).toEqual(["form"]);
    const n = t.named("checkSignIn").length;
    await tick(30000);
    expect(t.named("checkSignIn")).toHaveLength(n);        // and the polling stops
  });

  it("stops waiting after ten minutes and says the sign-in didn't finish", async () => {
    const t = await mount({ getState: signedOut });
    $("signin").click();
    await tick(10 * 60 * 1000 + 5000);
    expect(visible()).toEqual(["signed-out"]);
    expect($("signin-note").textContent).toBe("Sign-in didn't finish. Select Sign in to try again.");
    expect($("signin-wait").hidden).toBe(true);
    expect(t.named("getState").length).toBeGreaterThan(1);  // a fresh link was fetched
    const n = t.named("checkSignIn").length;
    await tick(60000);
    expect(t.named("checkSignIn")).toHaveLength(n);
  });

  it("returns to sign-in with a note when the session ends mid-build", async () => {
    let signedIn = true;
    await mount({
      getState: () => (signedIn ? { ok: true, signedIn: true, host: "slides", documentName: "" } : signedOut()),
      pollDeck: () => { signedIn = false; return { ok: false, kind: "auth", message: "Your sign-in has expired. Sign in again." }; },
    });
    type("Board update");
    $("build").click();
    await tick();
    expect(visible()).toEqual(["signed-out"]);
    expect($("signin-note").textContent).toBe("Your sign-in has expired. Sign in again.");
  });

  it("signs out", async () => {
    let signedIn = true;
    const t = await mount({
      getState: () => (signedIn ? { ok: true, signedIn: true, host: "slides", documentName: "" } : signedOut()),
      signOut: () => { signedIn = false; return { ok: true }; },
    });
    $("signout").click();
    await tick();
    expect(t.named("signOut")).toHaveLength(1);
    expect(visible()).toEqual(["signed-out"]);
  });
});
