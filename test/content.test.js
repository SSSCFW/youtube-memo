const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

class FakeClock {
  constructor() {
    this.now = 0;
    this.nextId = 1;
    this.timers = new Map();
  }

  setTimeout(callback, delay = 0) {
    return this.#add(callback, delay, 0);
  }

  setInterval(callback, delay = 0) {
    return this.#add(callback, delay, delay || 1);
  }

  clearTimer(id) {
    this.timers.delete(id);
  }

  #add(callback, delay, interval) {
    const id = this.nextId++;
    this.timers.set(id, {
      id,
      callback,
      time: this.now + Number(delay || 0),
      interval,
    });
    return id;
  }

  advance(ms) {
    const end = this.now + ms;
    let safety = 0;

    while (true) {
      if (++safety > 10000) {
        throw new Error('timer loop did not settle');
      }

      const due = [...this.timers.values()]
        .filter((timer) => timer.time <= end)
        .sort((a, b) => a.time - b.time || a.id - b.id)[0];

      if (!due) break;

      this.now = due.time;
      if (due.interval) {
        due.time += due.interval;
      } else {
        this.timers.delete(due.id);
      }
      due.callback();
    }

    this.now = end;
  }
}

class FakeElement {
  constructor(tagName, document) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = document;
    this.id = '';
    this.className = '';
    this.children = [];
    this.parentNode = null;
    this.dataset = {};
    this.style = {};
    this.textContent = '';
    this.placeholder = '';
    this.value = '';
    this.listeners = new Map();
  }

  get firstChild() {
    return this.children[0] || null;
  }

  get classList() {
    const element = this;
    return {
      contains(name) {
        return element.className.split(/\s+/).filter(Boolean).includes(name);
      },
      add(name) {
        const classes = new Set(element.className.split(/\s+/).filter(Boolean));
        classes.add(name);
        element.className = [...classes].join(' ');
      },
      remove(name) {
        element.className = element.className
          .split(/\s+/)
          .filter(Boolean)
          .filter((value) => value !== name)
          .join(' ');
      },
    };
  }

  appendChild(child) {
    if (child.parentNode) child.remove();
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  insertBefore(child, reference) {
    if (child.parentNode) child.remove();
    child.parentNode = this;
    if (!reference) {
      this.children.push(child);
      return child;
    }
    const index = this.children.indexOf(reference);
    if (index === -1) throw new Error('reference child not found');
    this.children.splice(index, 0, child);
    return child;
  }

  replaceChild(nextChild, oldChild) {
    const index = this.children.indexOf(oldChild);
    if (index === -1) throw new Error('old child not found');
    nextChild.parentNode = this;
    oldChild.parentNode = null;
    this.children[index] = nextChild;
    return oldChild;
  }

  remove() {
    if (!this.parentNode) return;
    const index = this.parentNode.children.indexOf(this);
    if (index !== -1) this.parentNode.children.splice(index, 1);
    this.parentNode = null;
  }

  addEventListener(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(callback);
  }

  querySelector(selector) {
    if (!selector.startsWith('#')) return null;
    return findById(this, selector.slice(1));
  }
}

function findById(root, id) {
  if (root.id === id) return root;
  for (const child of root.children) {
    const found = findById(child, id);
    if (found) return found;
  }
  return null;
}

function createHarness({ withSecondary = false } = {}) {
  const clock = new FakeClock();
  const mutationObservers = [];
  const windowListeners = new Map();

  const document = {
    readyState: 'complete',
    body: null,
    createElement(tagName) {
      return new FakeElement(tagName, document);
    },
    getElementById(id) {
      return findById(document.body, id);
    },
    querySelector(selector) {
      if (!selector.startsWith('#')) return null;
      return findById(document.body, selector.slice(1));
    },
    addEventListener() {},
  };

  document.body = document.createElement('body');

  function addSecondary() {
    let secondary = document.getElementById('secondary');
    if (secondary) return secondary;
    secondary = document.createElement('div');
    secondary.id = 'secondary';
    document.body.appendChild(secondary);
    return secondary;
  }

  if (withSecondary) addSecondary();

  const location = {
    href: 'https://www.youtube.com/watch?v=video-a',
    search: '?v=video-a',
  };

  const window = {
    location,
    addEventListener(type, callback) {
      if (!windowListeners.has(type)) windowListeners.set(type, []);
      windowListeners.get(type).push(callback);
    },
    getComputedStyle() {
      return { height: '200px' };
    },
  };

  class MutationObserver {
    constructor(callback) {
      this.callback = callback;
      mutationObservers.push(this);
    }
    observe() {}
  }

  class ResizeObserver {
    constructor(callback) {
      this.callback = callback;
    }
    observe() {}
  }

  const context = {
    URLSearchParams,
    window,
    document,
    location,
    MutationObserver,
    ResizeObserver,
    chrome: {
      storage: {
        local: {
          get(_keys, callback) {
            callback({});
          },
          set() {},
        },
      },
    },
    setTimeout: clock.setTimeout.bind(clock),
    clearTimeout: clock.clearTimer.bind(clock),
    setInterval: clock.setInterval.bind(clock),
    clearInterval: clock.clearTimer.bind(clock),
    console,
  };

  const source = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');
  vm.runInNewContext(source, context, { filename: 'content.js' });

  return {
    clock,
    document,
    addSecondary,
    fireMutation() {
      for (const observer of mutationObservers) observer.callback([], observer);
    },
    fireWindowEvent(type) {
      for (const callback of windowListeners.get(type) || []) callback();
    },
  };
}

test('keeps retrying until the YouTube secondary column appears, even after 10 seconds', () => {
  const harness = createHarness();

  harness.clock.advance(11000);
  assert.equal(harness.document.getElementById('youtube-memo-container'), null);

  harness.addSecondary();
  harness.clock.advance(1000);

  assert.ok(
    harness.document.getElementById('youtube-memo-container'),
    'memo container should be inserted after a late secondary column appears'
  );
});

test('recreates the memo when YouTube removes it without changing the URL', () => {
  const harness = createHarness({ withSecondary: true });
  harness.clock.advance(600);

  const container = harness.document.getElementById('youtube-memo-container');
  assert.ok(container, 'precondition: memo should initially exist');
  container.remove();
  assert.equal(harness.document.getElementById('youtube-memo-container'), null);

  harness.fireMutation();
  harness.clock.advance(1000);

  assert.ok(
    harness.document.getElementById('youtube-memo-container'),
    'memo container should be restored after same-URL DOM rerender'
  );
});
