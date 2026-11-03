// Voir MVP tests: load the real index.html in jsdom and play it through the DOM.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM, VirtualConsole } = require("jsdom");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const ENDINGS = ["goal", "time", "mate", "stuck"];

function fakeAudioContext() {
  const param = () => ({ value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {}, linearRampToValueAtTime() {} });
  const node = () => ({ connect() {}, disconnect() {}, gain: param(), frequency: param(), detune: param(), delayTime: param(), type: "", start() {}, stop() {} });
  return class {
    constructor() { this.state = "running"; this.currentTime = 0; this.destination = node(); }
    resume() { return Promise.resolve(); }
    createGain() { return node(); }
    createOscillator() { return node(); }
    createBiquadFilter() { return node(); }
    createDelay() { return node(); }
    createDynamicsCompressor() { return node(); }
  };
}

function load({ audio = false, random } = {}) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => errors.push(e));
  vc.on("error", (e) => errors.push(e));
  const dom = new JSDOM(`<!doctype html><html><head></head><body>${html}</body></html>`, {
    url: "https://voir.test/",
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(w) {
      w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
      w.HTMLElement.prototype.scrollIntoView = function () {};
      w.scrollTo = () => {};
      if (audio) w.AudioContext = fakeAudioContext();
      if (random) w.Math.random = random;
    }
  });
  const w = dom.window, d = w.document;
  return { w, d, $: (id) => d.getElementById(id), errors, V: w.Voir, close: () => w.close() };
}

function seeded(seed) {
  let a = seed;
  return () => { let t = (a = (a + 0x6d2b79f5) | 0); t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const shown = (g, el) => g.w.getComputedStyle(el).display !== "none";
const lit = (g) => [...g.d.querySelectorAll(".sq.target")];
const ids = (els) => els.map((el) => el.id.replace("sq-", "")).sort();
const setValue = (g, id, v) => { const el = g.$(id); el.value = String(v); el.dispatchEvent(new g.w.Event("input", { bubbles: true })); el.dispatchEvent(new g.w.Event("change", { bubbles: true })); };

// Goes through the 3-step setup like a player.
function setup(g, { career = "doctor", age = 26, stage = 0, dir = 2, goal = 5, deadline = 45, answers = [0, 0, 0, 0, 0] } = {}) {
  g.$("dream-" + career).click();
  g.$("toStep2").click();
  setValue(g, "ageIn", age);
  setValue(g, "stageIn", stage);
  setValue(g, "dirIn", dir);
  setValue(g, "goalIn", goal);
  setValue(g, "deadlineIn", deadline);
  g.$("toStep3").click();
  answers.forEach((a, i) => g.$(`q${i}a${a}`).click());
  g.$("beginBtn").click();
}

// Plays a whole game by clicking: random enabled way, random lit square, then "Play this move".
function playGame(g, rnd, max = 200) {
  let moves = 0;
  while (g.$("resultPanel").hidden) {
    const ways = [...g.d.querySelectorAll(".way")].filter((b) => !b.disabled);
    assert.ok(ways.length > 0, "an unfinished game always offers a way to move");
    ways[Math.floor(rnd() * ways.length)].click();
    const sq = lit(g);
    assert.ok(sq.length > 0, "an enabled way always lights a square");
    const ageBefore = g.V.state.age;
    sq[Math.floor(rnd() * sq.length)].click();
    assert.equal(g.$("preview").hidden, false, "picking a square shows the odds first");
    g.$("commitBtn").click();
    assert.ok(g.V.state.age >= ageBefore + 1, "every move costs at least one year");
    moves++;
    assert.ok(moves <= max, "game ends");
  }
  return moves;
}

test("page loads cleanly with the setup screen and a full board", () => {
  const g = load();
  assert.deepEqual(g.errors, []);
  assert.equal(g.d.querySelector("title").textContent, "Voir");
  assert.equal(shown(g, g.$("setup")), true);
  assert.equal(g.d.querySelectorAll(".sq").length, 64);
  assert.equal(g.d.querySelectorAll(".dream").length, 6);
  assert.equal(g.d.querySelectorAll(".rk").length, 8);
  assert.equal(g.d.querySelectorAll(".fl").length, 8);
  g.close();
});

test("setup: Begin stays locked until all 5 personality questions are answered", () => {
  const g = load();
  g.$("toStep2").click();
  g.$("toStep3").click();
  assert.equal(g.$("beginBtn").disabled, true);
  for (let i = 0; i < 4; i++) g.$(`q${i}a0`).click();
  assert.equal(g.$("beginBtn").disabled, true);
  g.$("q4a1").click();
  assert.equal(g.$("beginBtn").disabled, false);
  assert.match(g.$("sigLine").textContent, /signature piece/);
  g.close();
});

test("setup builds the board from your dream, age, stage and goal", () => {
  const g = load({ audio: true });
  setup(g, { career: "doctor", age: 26, stage: 2, dir: 2, goal: 6, deadline: 45 });
  const S = g.V.state;
  assert.equal(shown(g, g.$("setup")), false, "setup disappears after Begin");
  assert.equal(S.cfg.career, "doctor");
  assert.equal(S.age, 26);
  assert.equal(S.cfg.deadline, 45);
  assert.equal(S.pos.r, 5, "Resident is rank 3");
  assert.equal(S.pos.c, 2, "Cardiology is file c");
  assert.equal(g.$("nowTitle").textContent, "Resident · Cardiology");
  assert.match(g.d.querySelector(".rk.goal").textContent, /Head of dept/);
  assert.equal(g.$("yearsLeft").textContent, "19");
  assert.equal(g.d.querySelectorAll("#prios li").length, 3);
  assert.ok(g.V.audio.timer, "music starts on Begin");
  assert.deepEqual(g.errors, []);
  g.close();
});

test("an inventor gets inventor levels, directions and great minds", () => {
  const g = load();
  setup(g, { career: "inventor", age: 15, stage: 0, dir: 0, goal: 4, deadline: 30 });
  assert.equal(g.$("nowTitle").textContent, "Curious tinkerer · Energy");
  const minds = Object.values(g.V.state.tiles).filter((t) => t.t === "mind");
  assert.equal(minds.length, 2);
  assert.match(g.$("legend").textContent, /Failed prototype/);
  g.close();
});

test("personality answers set traits and the signature piece", () => {
  const g = load();
  setup(g, { answers: [0, 0, 1, 1, 0] }); // discipline-heavy
  const T = g.V.state.traits;
  assert.equal(T.discipline, 2 + 2 + 1 + 2);
  assert.ok(g.d.querySelector("#way-rook .sig"), "Focus (rook) is the signature piece");
  g.close();
});

test("no going back: you can never move to a lower rank or a lived square", () => {
  const g = load();
  setup(g, { stage: 1, dir: 4 });
  const V = g.V;
  for (const w of ["king", "rook", "bishop", "knight", "queen", "pawn"]) {
    for (const t of V.moveInfo(w).legal) assert.ok(t.r <= V.state.pos.r, `${w} never moves backwards`);
  }
  let side = null, start = null;
  for (let seed = 1; seed < 200 && !side; seed++) {
    V.start({ start: 1, file: 4 }, seed);
    g.$("way-king").click();
    start = { ...V.state.pos };
    side = lit(g).find((el) => el.id.endsWith(String(8 - start.r)));
  }
  assert.ok(side, "a sideways move exists");
  side.click(); g.$("commitBtn").click();
  if (!V.state.check) {
    const back = V.moveInfo("king").legal.find((t) => t.r === start.r && t.c === start.c);
    assert.equal(back, undefined, "the square you left is lived and closed");
  }
  g.close();
});

test("you can never move into a square an obstacle attacks", () => {
  const g = load();
  for (let seed = 1; seed < 40; seed++) {
    g.V.start({}, seed);
    for (const w of ["king", "rook", "bishop", "knight", "queen"]) {
      for (const t of g.V.moveInfo(w).legal) {
        const b = g.V.state.blacks.find((x) => x.alive && x.r === t.r && x.c === t.c) || null;
        assert.equal(g.V.attackers(t.r, t.c, { exclude: b, player: t }).length, 0);
      }
    }
  }
  g.close();
});

test("clicking an unsafe square explains why and does not move", () => {
  const g = load();
  for (let seed = 1; seed < 200; seed++) {
    g.V.start({}, seed);
    const w = ["rook", "queen", "bishop", "king", "knight"].find((x) => g.V.moveInfo(x).danger.length);
    if (!w) continue;
    g.$("way-" + w).click();
    const d = g.V.moveInfo(w).danger[0];
    g.$("sq-" + "abcdefgh"[d.c] + (8 - d.r)).click();
    assert.equal(g.$("voiceTitle").textContent, "You cannot move there");
    assert.equal(g.V.state.turn, 0);
    g.close();
    return;
  }
  assert.fail("no board with an unsafe square found");
});

test("a move needs two steps: preview with odds, then Play this move", () => {
  const g = load();
  setup(g);
  [...g.d.querySelectorAll(".way")].find((b) => !b.disabled).click();
  const [sq] = lit(g);
  sq.click();
  assert.equal(g.$("preview").hidden, false);
  assert.match(g.$("pvPct").textContent, /^\d+%$/);
  assert.ok(g.d.querySelectorAll("#pvFactors li").length >= 1);
  assert.equal(g.V.state.turn, 0, "nothing happens until you commit");
  g.$("commitBtn").click();
  assert.equal(g.V.state.turn, 1);
  assert.equal(g.V.state.sheet.length, 1, "the move is on the scoresheet");
  assert.equal(g.$("age" + "Now").textContent, String(g.V.state.age));
  g.close();
});

test("odds stay between 5% and 97% unless the move is certain, and personality matters", () => {
  const g = load();
  const V = g.V;
  for (let seed = 1; seed < 60; seed++) {
    V.start({}, seed);
    for (const w of ["pawn", "king", "rook", "bishop", "knight", "queen"]) for (const t of V.moveInfo(w).legal) {
      const p = V.odds(w, t).p;
      assert.ok(p === 1 || (p >= 0.05 && p <= 0.97), `p=${p}`);
    }
  }
  // Same board, same move: a bolder player has better odds on a risky square.
  let compared = false;
  for (let seed = 1; seed < 300 && !compared; seed++) {
    V.start({ traits: { discipline: 3, curiosity: 3, resilience: 3, empathy: 3, boldness: 2 } }, seed);
    const pairs = [];
    for (const w of ["king", "rook", "bishop", "knight"]) for (const t of V.moveInfo(w).legal) { const tile = V.state.tiles[t.r * 8 + t.c]; if (tile && tile.t === "risk") pairs.push([w, t]); }
    if (!pairs.length) continue;
    const [w, t] = pairs[0];
    const shy = V.odds(w, t).p;
    V.start({ traits: { discipline: 3, curiosity: 3, resilience: 3, empathy: 3, boldness: 6 } }, seed);
    const bold = V.odds(w, t).p;
    assert.ok(bold > shy, `bold ${bold} > shy ${shy}`);
    compared = true;
  }
  assert.ok(compared, "found a risky square to compare");
  g.close();
});

test("climbing several levels at once is harder than climbing one", () => {
  const g = load();
  const V = g.V;
  for (let seed = 1; seed < 300; seed++) {
    V.start({}, seed);
    const rook = V.moveInfo("rook").legal.filter((t) => t.c === V.state.pos.c && !V.state.tiles[t.r * 8 + t.c] && !V.state.blacks.some((b) => b.alive && b.r === t.r && b.c === t.c));
    const one = rook.find((t) => t.r === V.state.pos.r - 1), three = rook.find((t) => t.r === V.state.pos.r - 3);
    if (!one || !three) continue;
    assert.ok(V.odds("rook", three).p < V.odds("rook", one).p);
    g.close();
    return;
  }
  assert.fail("no suitable board found");
});

test("check: every legal move escapes, escaping always works, and the banner shows", () => {
  const g = load();
  const V = g.V;
  let sawCheck = false;
  for (let seed = 1; seed < 400 && !sawCheck; seed++) {
    V.start({}, seed);
    const rnd = seeded(seed);
    while (!V.state.over) {
      if (V.state.check) {
        sawCheck = true;
        for (const w of ["pawn", "king", "rook", "bishop", "knight", "queen"]) for (const t of V.moveInfo(w).legal) {
          const b = V.state.blacks.find((x) => x.alive && x.r === t.r && x.c === t.c) || null;
          assert.equal(V.attackers(t.r, t.c, { exclude: b, player: t }).length, 0, "every legal move escapes check");
          assert.equal(V.odds(w, t).p, 1, "escaping check always works");
        }
        assert.equal(shown(g, g.$("checkBar")), true, "the CHECK banner shows");
      }
      const ways = [...g.d.querySelectorAll(".way")].filter((b) => !b.disabled);
      ways[Math.floor(rnd() * ways.length)].click();
      const sq = lit(g); sq[Math.floor(rnd() * sq.length)].click(); g.$("commitBtn").click();
    }
  }
  assert.ok(sawCheck, "check happens in real games");
  g.close();
});

test("checkmate: Life traps you with no safe move and the game ends", () => {
  const g = load();
  const V = g.V;
  const endings = new Set();
  for (let rs = 1; rs < 400 && !endings.has("mate"); rs++) {
    // You on h1 with every other square already lived except h2. Burnout (a rook) waits on a5.
    V.start({ goal: 7, start: 0, file: 7, traits: { discipline: 7, curiosity: 3, resilience: 3, empathy: 3, boldness: 3 } }, 1);
    const S = V.state;
    S.blacks.forEach((b) => { b.alive = false; });
    S.blacks.push({ id: "r9", type: "rook", r: 3, c: 0, alive: true, name: "Burnout" });
    S.tiles = {};
    S.visited = [...Array(64).keys()].filter((i) => i !== 6 * 8 + 7);
    S.turn = 6; S.energy = 10; S.rs = rs;
    V.render();
    g.$("way-king").click();
    g.$("sq-h2").click();
    g.$("commitBtn").click();
    if (S.pos.r !== 6) continue; // the move itself failed this time
    assert.ok(["mate", "stuck"].includes(S.ending), S.ending);
    endings.add(S.ending);
    if (S.ending === "mate") {
      assert.ok(S.check && !V.anyLegal(), "mate means in check with no legal move");
      assert.equal(S.checkers[0].name, "Burnout");
      assert.equal(g.$("endEyebrow").textContent, "Checkmate");
      assert.match(S.sheet[S.sheet.length - 1].black, /#$/, "scoresheet marks mate with #");
      assert.equal(shown(g, g.$("resultPanel")), true);
    }
  }
  assert.ok(endings.has("mate"), "Life can checkmate you");
  g.close();
});

test("possibilities: paths, reachable squares and fastest route are shown", () => {
  const g = load();
  setup(g, { age: 26, stage: 0, goal: 3, deadline: 40 });
  const p = g.V.possibilities();
  assert.ok(p.paths > 1000);
  assert.ok(p.goalSquares.length > 0);
  assert.ok(p.fastest >= 1, "reaching the goal takes at least one year");
  assert.match(g.$("fastest").textContent, /Fastest safe route: \d+ years?/);
  assert.ok(g.d.querySelectorAll("#canBecome li").length > 0);
  g.close();
});

test("the deadline can't be shorter than the number of levels to climb", () => {
  const g = load();
  setup(g, { age: 20, stage: 0, goal: 7, deadline: 22 });
  assert.equal(g.V.state.cfg.deadline, 27);
  g.close();
});

test("120 random full games across all six dreams end properly with no errors", () => {
  const rnd = seeded(2026);
  const g = load({ audio: true, random: seeded(99) });
  setup(g, { career: "doctor", age: 26, stage: 1, goal: 6, deadline: 46 });
  const endings = {};
  const careers = ["doctor", "inventor", "engineer", "entrepreneur", "creative", "changemaker"];
  for (let i = 0; i < 120; i++) {
    const career = careers[i % careers.length];
    const goal = 3 + (i % 5);
    g.V.start({ career, age: 18 + (i % 15), start: i % 3, file: i % 8, goal, deadline: 18 + (i % 15) + 8 + (i % 20), traits: { discipline: 2 + (i % 5), curiosity: 2 + ((i + 1) % 5), resilience: 2 + ((i + 2) % 5), empathy: 2 + ((i + 3) % 5), boldness: 2 + ((i + 4) % 5) } }, 1000 + i);
    playGame(g, rnd);
    const S = g.V.state;
    assert.ok(ENDINGS.includes(S.ending), S.ending);
    endings[S.ending] = (endings[S.ending] || 0) + 1;
    if (S.ending === "goal") assert.ok(7 - S.pos.r >= S.cfg.goal);
    if (S.ending === "time") assert.ok(S.age >= S.cfg.deadline);
    assert.ok(S.energy >= 0 && S.energy <= 10);
    for (const v of Object.values(S.stats)) assert.ok(v >= 0);
    assert.ok(S.uses.queen <= 1, "Freedom used at most once");
    assert.equal(new Set(S.visited).size, S.visited.length, "no square lived twice");
    assert.equal(S.sheet.length, S.attempts);
    assert.ok(g.d.querySelectorAll("#insights li").length >= 3);
    assert.equal(g.d.querySelectorAll("#questions li").length, 3);
    assert.ok(g.$("realMove").textContent.length > 3);
    assert.ok(!/undefined|NaN/.test(g.$("resultPanel").textContent), "no undefined or NaN in the result");
    assert.equal(shown(g, g.$("resultPanel")), true);
    assert.equal(shown(g, g.$("playPanel")), false);
  }
  assert.ok(endings.goal > 0, `some players reach their goal (${JSON.stringify(endings)})`);
  assert.ok(endings.time > 0, `some players run out of time (${JSON.stringify(endings)})`);
  assert.deepEqual(g.errors, []);
  g.close();
});

test("same life and same choices give the same outcome", () => {
  const run = () => {
    const g = load({ random: seeded(7) });
    setup(g);
    g.V.start({ career: "engineer", age: 20, goal: 5, deadline: 40 }, 43210);
    playGame(g, seeded(1));
    const out = JSON.stringify({ age: g.V.state.age, stats: g.V.state.stats, trail: g.V.state.trail, ending: g.V.state.ending });
    g.close();
    return out;
  };
  assert.equal(run(), run());
});

test("Replay keeps the board; New board deals another; Change dream reopens setup", () => {
  const g = load({ random: seeded(5) });
  setup(g);
  const snap = () => JSON.stringify({ seed: g.V.state.seed, tiles: g.V.state.tiles, blacks: g.V.state.blacks.map((b) => [b.r, b.c]) });
  const before = snap();
  playGame(g, seeded(6));
  g.$("replayBtn").click();
  assert.equal(snap(), before);
  assert.equal(g.V.state.turn, 0);
  g.$("newBtn").click();
  assert.notEqual(g.V.state.seed, JSON.parse(before).seed);
  g.$("dreamBtn").click();
  assert.equal(shown(g, g.$("setup")), true);
  g.close();
});

test("music and sound toggles switch independently", () => {
  const g = load({ audio: true });
  setup(g);
  g.$("musicBtn").click();
  assert.equal(g.$("musicBtn").getAttribute("aria-pressed"), "false");
  assert.equal(g.$("soundBtn").getAttribute("aria-pressed"), "true");
  g.$("soundBtn").click();
  assert.equal(g.$("soundBtn").getAttribute("aria-pressed"), "false");
  g.$("musicBtn").click();
  assert.ok(g.V.audio.timer);
  assert.deepEqual(g.errors, []);
  g.close();
});

test("Copy my result works with and without clipboard access; last result is remembered", async () => {
  const g = load({ random: seeded(3) });
  setup(g);
  playGame(g, seeded(4));
  let copied = "";
  Object.defineProperty(g.w.navigator, "clipboard", { value: { writeText: (t) => { copied = t; return Promise.resolve(); } }, configurable: true });
  g.$("copyBtn").click();
  await new Promise((r) => setTimeout(r, 0));
  assert.match(copied, /^Voir · Doctor · Life #\d+/);
  assert.match(copied, /Scoresheet:/);
  Object.defineProperty(g.w.navigator, "clipboard", { value: undefined, configurable: true });
  g.$("copyBtn").click();
  assert.match(g.$("copyNote").textContent, /^Voir · /);
  const stored = JSON.parse(g.w.localStorage.getItem("voir.last"));
  assert.ok(stored.title && stored.ending);
  assert.deepEqual(g.errors, []);
  g.close();
});

