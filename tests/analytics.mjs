// Run: node tests/analytics.mjs
// Runs the app with a small document stub and controlled timers. Sends no network requests.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const source = html.match(/<script id="game-script">([\s\S]*?)<\/script>/)[1];
for (const script of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) new vm.Script(script[1]);

function boot({ mobile = true, returning = true, posthog = 'working' } = {}) {
  let now = 1000000;
  let nextTimer = 0;
  const timers = new Map();
  const elements = new Map();
  const events = [];
  const opened = [];
  const doc = { activeElement: null };
  class Element {
    constructor() {
      this.value = '';
      this.disabled = false;
      this.style = {};
      this.dataset = {};
      this.children = [];
      this.listeners = new Map();
      this.classes = new Set();
      this.classList = {
        add: (...names) => names.forEach(name => this.classes.add(name)),
        remove: (...names) => names.forEach(name => this.classes.delete(name)),
        contains: name => this.classes.has(name),
        toggle: (name, force = !this.classes.has(name)) => {
          if (force) this.classes.add(name); else this.classes.delete(name);
          return force;
        }
      };
    }
    set textContent(text) { this.children = []; this.text = String(text); }
    get textContent() { return (this.text || '') + this.children.map(child => child.textContent).join(''); }
    set innerHTML(text) { this.textContent = text; }
    get innerHTML() { return this.textContent; }
    set className(names) { this.classes = new Set(names.split(/\s+/)); }
    get className() { return [...this.classes].join(' '); }
    setAttribute() {}
    appendChild(child) { this.children.push(child); return child; }
    insertBefore(child, referenceNode) {
      const idx = this.children.indexOf(referenceNode);
      if (idx === -1) {
        this.children.push(child);
      } else {
        this.children.splice(idx, 0, child);
      }
      return child;
    }
    querySelectorAll(selector) {
      return this.children.flatMap(child => [
        ...(child.classes?.has(selector.slice(1)) ? [child] : []),
        ...(child.querySelectorAll?.(selector) || [])
      ]);
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    addEventListener(name, fn) {
      if (!this.listeners.has(name)) this.listeners.set(name, []);
      this.listeners.get(name).push(fn);
    }
    dispatchEvent(event) { return Promise.all((this.listeners.get(event.type) || []).map(fn => fn(event))); }
    click() { return this.dispatchEvent({ type: 'click', preventDefault() {}, stopPropagation() {} }); }
    focus() { if (!this.disabled) doc.activeElement = this; }
    blur() { if (doc.activeElement === this) doc.activeElement = null; }
    getBoundingClientRect() { return { top: 0 }; }
    remove() {}
  }
  Object.assign(doc, {
    body: new Element(),
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, new Element());
      return elements.get(id);
    },
    createElement: () => new Element(),
    createTextNode: text => ({ textContent: String(text) }),
    querySelectorAll: () => [],
    addEventListener() {}
  });
  const window = {
    innerWidth: mobile ? 390 : 1200, innerHeight: 844, scrollY: 0,
    addEventListener() {}, scrollTo() {}, open: (...args) => opened.push(args)
  };
  if (posthog !== 'missing') {
    window.posthog = { capture(event, properties) {
      if (posthog === 'throwing') throw new Error('Blocked');
      events.push({ event, properties: JSON.parse(JSON.stringify(properties)) });
    } };
  }
  const context = vm.createContext({
    document: doc, window,
    localStorage: { getItem: () => returning ? '1' : null, setItem() {} },
    navigator: {}, File,
    Date: class extends Date { static now() { return now; } },
    Event: class { constructor(type) { this.type = type; } },
    fetch: async () => { throw new Error('Unexpected network request'); },
    setTimeout(fn, delay) { const id = ++nextTimer; timers.set(id, { fn, at: now + delay }); return id; },
    clearTimeout: id => timers.delete(id),
    setInterval: () => ++nextTimer, clearInterval() {},
    requestAnimationFrame: fn => fn()
  });
  vm.runInContext(source, context);
  const run = code => vm.runInContext(code, context);
  const advance = ms => {
    const until = now + ms;
    for (;;) {
      const next = [...timers].filter(([, timer]) => timer.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      const [id, timer] = next;
      timers.delete(id);
      now = timer.at;
      timer.fn();
    }
    now = until;
  };
  return {
    run, advance, context, events, opened, doc,
    named: name => events.filter(event => event.event === name),
    async click(id) { await doc.getElementById(id).click(); },
    start(level = 'easy') { run(`initGame('dog', '${level}')`); advance(1500); },
    answer() { run('handleGuess(currentGroup[0].name)'); advance(1500); }
  };
}

let checks = 0;
async function check(name, run) { await run(); checks++; console.log(`PASS: ${name}`); }

await check('the real PostHog snippet queues manual events before the library loads', () => {
  const scripts = [];
  const context = vm.createContext({
    document: {
      createElement: () => ({}),
      getElementsByTagName: () => [{ parentNode: { insertBefore: script => scripts.push(script) } }]
    }
  });
  context.window = context;
  vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], context);
  assert.equal(scripts.length, 1);
  assert.equal(scripts[0].async, true);
  assert.equal(context.posthog._i[0][1].autocapture, false);
  assert.equal(context.posthog._i[0][1].person_profiles, 'identified_only');
  vm.runInContext('posthog.capture("game_started", { level: "easy" })', context);
  assert.equal(context.posthog[0][0], 'capture');
  assert.equal(context.posthog[0][1], 'game_started');
  assert.equal(context.posthog[0][2].level, 'easy');
});

for (const mobile of [true, false]) {
  const layout = mobile ? 'mobile' : 'desktop';
  await check(`${layout}: tutorial completes once and stays separate from the game`, () => {
    const app = boot({ mobile, returning: false });
    app.advance(1500);
    assert.equal(app.named('tutorial_started').length, 1);
    while (app.run('remaining.length')) app.answer();
    const completed = app.named('tutorial_completed');
    assert.equal(completed.length, 1);
    assert.equal(completed[0].properties.correct_languages, 3);
    assert.equal(completed[0].properties.level, null);
    app.start();
    assert.equal(app.named('tutorial_abandoned').length, 0);
    assert.equal(app.named('game_started')[0].properties.layout, layout);
    assert.notEqual(completed[0].properties.run_id, app.named('game_started')[0].properties.run_id);
  });

  await check(`${layout}: returning visitors skip the tutorial`, () => {
    const app = boot({ mobile });
    assert.equal(app.named('tutorial_skipped')[0].properties.reason, 'returning_visitor');
    assert.equal(app.named('tutorial_started').length, 0);
  });

  await check(`${layout}: only accepted submissions emit answer events`, () => {
    const app = boot({ mobile });
    app.start();
    app.run('handleGuess("   "); handleGuess("private@example.com"); handleGuess(currentGroup[0].name)');
    // Duplicate input during the mobile feedback delay is rejected.
    if (mobile) app.run('handleGuess(currentGroup[0].name)');
    const answers = app.named('answer_submitted');
    assert.equal(answers.length, 2);
    assert.equal(answers[0].properties.is_correct, false);
    assert.equal(answers[1].properties.is_correct, true);
    assert.equal(answers[1].properties.attempt_number, 2);
    assert.ok(!JSON.stringify(app.events).includes('private@example.com'));
  });

  await check(`${layout}: typed skips do not count as answer attempts`, () => {
    const app = boot({ mobile });
    app.start();
    app.run('handleGuess("next")');
    assert.equal(app.named('challenge_skipped').length, 1);
    assert.equal(app.named('challenge_skipped')[0].properties.input_source, 'keyboard');
    assert.equal(app.named('answer_submitted').length, 0);
    assert.equal(app.run('attemptsCount'), 0);
  });

  await check(`${layout}: completed games emit one result with the displayed score`, () => {
    const app = boot({ mobile });
    app.start();
    while (app.run('remaining.length')) app.answer();
    app.run('showResultsBlock("completed")');
    const ended = app.named('game_ended');
    assert.equal(ended.length, 1);
    assert.equal(ended[0].properties.reason, 'completed');
    assert.equal(ended[0].properties.correct_languages, app.run('correctCount'));
    assert.equal(ended[0].properties.remaining_languages, 0);
    assert.equal(ended[0].properties.run_id, app.named('game_started')[0].properties.run_id);
  });

  await check(`${layout}: timeout and Insane mistakes have distinct end reasons`, () => {
    const timeout = boot({ mobile });
    timeout.start();
    timeout.run('startTime = Date.now() - TIME_LIMIT_SEC * 1000; updateProgress()');
    timeout.advance(3000);
    assert.equal(timeout.named('game_ended').length, 1);
    assert.equal(timeout.named('game_ended')[0].properties.reason, 'timeUp');

    const insane = boot({ mobile });
    insane.start('insane');
    insane.run('handleGuess("zzzzzz"); handleGuess("zzzzzz"); handleGuess("zzzzzz")');
    insane.advance(3000);
    assert.equal(insane.named('game_ended').length, 1);
    assert.equal(insane.named('game_ended')[0].properties.reason, 'mistake');
    assert.equal(insane.named('game_started')[0].properties.time_limit_seconds, null);
  });

  await check(`${layout}: replacing a game records abandonment before the new start`, () => {
    const app = boot({ mobile });
    app.start();
    app.run('initGame("cat", "hard", true, "level_change")');
    const abandoned = app.named('game_abandoned')[0].properties;
    const started = app.named('game_started')[1].properties;
    assert.equal(abandoned.word, 'dog');
    assert.equal(abandoned.level, 'easy');
    assert.equal(abandoned.reason, 'level_change');
    assert.equal(started.word, 'cat');
    assert.equal(started.level, 'hard');
    assert.notEqual(started.run_id, abandoned.run_id);
  });

  await check(`${layout}: replay and new-word controls record their source`, async () => {
    const app = boot({ mobile });
    app.start();
    while (app.run('remaining.length')) app.answer();
    await app.click(mobile ? 'mobilePlayAgainBtn' : 'playAgainBtn');
    assert.equal(app.named('game_started').at(-1).properties.start_source, 'play_again');
    assert.equal(app.named('game_abandoned').length, 0);
    app.advance(1500);
    await app.click(mobile ? 'mobileMenuNewWord' : 'newWordLink');
    assert.equal(app.named('game_started').at(-1).properties.start_source, 'new_word');
  });

  await check(`${layout}: social controls record intent without claiming a completed post`, async () => {
    const app = boot({ mobile });
    app.start();
    app.run('showResultsBlock("completed")');
    const prefix = mobile ? 'mobileShare' : 'share';
    for (const channel of ['Whatsapp', 'X', 'Bluesky']) await app.click(prefix + channel);
    assert.deepEqual(app.named('result_share_requested').map(event => event.properties.channel), ['whatsapp', 'x', 'bluesky']);
    assert.equal(app.named('result_share_completed').length, 0);
    assert.equal(app.opened.length, 3);
  });
}

await check('the skip button records its source', async () => {
  const app = boot();
  app.start();
  await app.click('mobileSkipBtn');
  assert.equal(app.named('challenge_skipped')[0].properties.input_source, 'skip_button');
});

await check('leaving an unfinished tutorial records abandonment', () => {
  const app = boot({ returning: false });
  app.start();
  assert.equal(app.named('tutorial_abandoned')[0].properties.reason, 'level_selection');
  assert.equal(app.named('tutorial_completed').length, 0);
});

await check('menu, About, and visible hints emit events', async () => {
  const app = boot();
  app.start();
  // dicas de conteúdo (geo/cultural) não são mais automáticas por
  // inatividade — só aparecem depois de uma resposta errada
  app.run('handleGuess("__not_a_real_answer__")');
  assert.ok(['geography', 'cultural'].includes(app.named('hint_shown')[0].properties.hint_type));
  await app.click('mobileMenuBtn');
  await app.click('mobileMenuAbout');
  assert.equal(app.named('menu_opened').length, 1);
  assert.equal(app.named('about_viewed').length, 1);
});

for (const posthog of ['missing', 'throwing']) {
  await check(`game actions still work when PostHog is ${posthog}`, () => {
    const app = boot({ posthog });
    app.start();
    app.answer();
    assert.equal(app.run('attemptsCount'), 1);
    assert.ok(app.run('correctCount') > 1);
    assert.equal(app.events.length, 0);
  });
}

await check('newsletter validation and service results exclude the email address', async () => {
  const app = boot();
  const input = app.doc.getElementById('newsletterEmail');
  await app.click('newsletterSubmit');
  input.value = 'invalid';
  await app.click('newsletterSubmit');
  assert.deepEqual(app.named('newsletter_validation_failed').map(event => event.properties.reason), ['empty_email', 'invalid_email']);
  assert.equal(app.named('newsletter_subscription_submitted').length, 0);
  for (const outcome of ['success', 'http', 'network']) {
    input.value = 'private@example.com';
    app.context.fetch = async () => {
      if (outcome === 'network') throw new Error('private@example.com');
      return { ok: outcome === 'success', status: outcome === 'success' ? 200 : 429 };
    };
    await app.click('newsletterSubmit');
    assert.equal(input.disabled, false);
  }
  assert.equal(app.named('newsletter_subscription_submitted').length, 3);
  assert.equal(app.named('newsletter_subscription_succeeded').length, 1);
  assert.deepEqual(app.named('newsletter_subscription_failed').map(event => event.properties.reason), ['http_error', 'network_error']);
  assert.equal(app.named('newsletter_subscription_failed')[0].properties.status_code, 429);
  assert.ok(!JSON.stringify(app.events).includes('private@example.com'));
});

for (const outcome of ['native', 'download', 'cancelled', 'failed', 'image_error']) {
  await check(`image sharing records ${outcome} and keeps the original result data`, async () => {
    const app = boot();
    app.start();
    app.run('showResultsBlock("timeUp")');
    const ended = app.named('game_ended')[0].properties;
    app.advance(10000);
    app.run(`drawShareCard = canvas => { canvas.toDataURL = () => 'data:image/png;base64,'; }`);
    if (outcome === 'image_error') app.run('drawShareCard = () => { throw new Error("Canvas failed"); }');
    app.context.fetch = async () => ({ blob: async () => new Blob() });
    app.context.navigator.canShare = () => outcome !== 'download';
    app.context.navigator.share = async () => {
      if (outcome === 'cancelled') throw Object.assign(new Error('Cancelled'), { name: 'AbortError' });
      if (outcome === 'failed') throw new Error('Share failed');
      // A pending share must keep its context if another game starts.
      app.run('initGame("cat", "hard")');
    };
    await app.run('shareResultCard("instagram")');
    const requested = app.named('result_share_requested')[0].properties;
    assert.equal(requested.channel, 'instagram');
    assert.equal(requested.elapsed_ms, ended.elapsed_ms);
    const completed = app.named('result_share_completed');
    assert.equal(completed.length, outcome === 'native' ? 1 : 0);
    if (completed.length) {
      assert.equal(completed[0].properties.run_id, ended.run_id);
      assert.equal(completed[0].properties.word, 'dog');
    }
    assert.equal(app.named('result_share_cancelled').length, outcome === 'cancelled' ? 1 : 0);
    assert.equal(app.named('result_share_failed').length, ['failed', 'image_error'].includes(outcome) ? 1 : 0);
    assert.equal(app.named('result_card_download_started').length, ['download', 'cancelled', 'failed'].includes(outcome) ? 1 : 0);
  });
}

await check('a pending newsletter request keeps its original game context', async () => {
  const app = boot();
  app.start();
  app.doc.getElementById('newsletterEmail').value = 'private@example.com';
  app.context.fetch = async () => {
    app.run('initGame("cat", "hard")');
    return { ok: true, status: 200 };
  };
  await app.click('newsletterSubmit');
  const submitted = app.named('newsletter_subscription_submitted')[0].properties;
  const succeeded = app.named('newsletter_subscription_succeeded')[0].properties;
  assert.equal(submitted.run_id, succeeded.run_id);
  assert.equal(succeeded.word, 'dog');
});

console.log(`${checks} analytics checks passed.`);
