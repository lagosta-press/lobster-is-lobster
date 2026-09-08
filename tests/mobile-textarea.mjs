// Run with: node tests/mobile-textarea.mjs
// Checks the real mobile event handlers. Native keyboard behavior needs a device test.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
new vm.Script(script);
assert.match(html, /<textarea\s+id="mobileCardInput"[\s\S]*?><\/textarea>/);
const handlers = script.slice(script.indexOf('  let mobileInputWired'), script.indexOf('  function mobileShowChallenge'));

function setup() {
  const input = new EventTarget();
  Object.assign(input, {
    value: '', selectionStart: 0, selectionEnd: 0,
    setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
  });
  const guesses = [];
  let displayed = '';
  const context = vm.createContext({
    document: { getElementById: () => input },
    isResolving: false,
    mobileRenderBlank: value => { displayed = value; },
    handleGuess: value => guesses.push(value)
  });
  vm.runInContext(handlers + '\nmobileEnsureInput(); mobileEnsureInput();', context);
  return {
    input, guesses, context,
    get displayed() { return displayed; },
    emit(type, fields = {}) {
      const event = Object.assign(new Event(type, { cancelable: true }), fields);
      input.dispatchEvent(event);
      return event;
    }
  };
}

let checks = 0;
function check(name, run) { run(); checks++; console.log(`PASS: ${name}`); }

check('typing renders and Enter submits once without a newline', () => {
  const app = setup();
  app.input.value = 'French';
  app.emit('input', { inputType: 'insertText' });
  assert.equal(app.displayed, 'French');
  assert.equal(app.emit('keydown', { key: 'Enter' }).defaultPrevented, true);
  assert.deepEqual(app.guesses, ['French']);
});

check('multiline paste stays single-line and preserves the selection', () => {
  const app = setup();
  app.input.value = 'fr\nench';
  app.input.setSelectionRange(3, 5);
  app.emit('input', { inputType: 'insertFromPaste' });
  assert.equal(app.input.value, 'french');
  assert.equal(app.displayed, 'french');
  assert.equal(app.input.selectionStart, 2);
  assert.equal(app.input.selectionEnd, 4);
  assert.deepEqual(app.guesses, []);
});

check('composition can finish without grading or changing the active value', () => {
  const app = setup();
  app.emit('compositionstart');
  app.input.value = 'fr\nench';
  app.emit('input', { inputType: 'insertCompositionText', isComposing: true });
  assert.equal(app.input.value, 'fr\nench');
  assert.equal(app.displayed, 'french');
  assert.equal(app.emit('keydown', { key: 'Enter' }).defaultPrevented, false);
  app.emit('compositionend');
  assert.equal(app.input.value, 'french');
  assert.deepEqual(app.guesses, []);
  app.emit('keydown', { key: 'Enter' });
  assert.deepEqual(app.guesses, ['french']);
});

check('event composition flags and code 229 do not submit an answer', () => {
  const app = setup();
  app.input.value = 'french';
  app.emit('keydown', { key: 'Enter', isComposing: true });
  app.emit('keydown', { key: 'Enter', keyCode: 229 });
  app.emit('keydown', { key: 'Unidentified', keyCode: 229 });
  app.emit('input', { inputType: 'insertLineBreak', isComposing: true });
  assert.deepEqual(app.guesses, []);
});

for (const inputType of ['insertLineBreak', 'insertParagraph']) {
  check(`${inputType} submits without a key event`, () => {
    const app = setup();
    app.input.value = 'french\n';
    app.emit('input', { inputType });
    assert.equal(app.input.value, 'french');
    assert.equal(app.displayed, 'french');
    assert.deepEqual(app.guesses, ['french']);
  });
}

check('late input leaves round feedback unchanged', () => {
  const app = setup();
  app.input.value = 'french';
  app.emit('input');
  app.context.isResolving = true;
  app.input.value = 'late edit';
  app.emit('input');
  assert.equal(app.displayed, 'french');
});

console.log(`${checks} checks passed.`);
