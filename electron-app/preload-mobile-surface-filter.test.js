const test = require('node:test');
const assert = require('node:assert/strict');
const {
  hiddenMobileAppAttribute,
  normalizeText,
  removeMobileAppSurfaces,
} = require('./preload-mobile-surface-filter');

function createStyle() {
  const entries = [];

  return {
    entries,
    setProperty(name, value, priority) {
      entries.push([name, value, priority]);
    },
  };
}

function createElement({
  text = '',
  childrenLength = 0,
  offsetHeight = 40,
  closeButton = null,
} = {}) {
  const attrs = new Map();

  return {
    nodeType: 1,
    textContent: text,
    children: Array.from({ length: childrenLength }, () => ({})),
    offsetHeight,
    style: createStyle(),
    setAttribute(name, value) {
      attrs.set(name, String(value));
    },
    hasAttribute(name) {
      return attrs.has(name);
    },
    getAttribute(name) {
      return attrs.get(name);
    },
    closest() {
      return null;
    },
    querySelector(selector) {
      if (selector === 'button[aria-label="Close"], button[aria-label="关闭"]') {
        return closeButton;
      }
      return null;
    },
  };
}

function createRoot(primaryElements = [], cardElements = []) {
  return {
    querySelectorAll(selector) {
      if (selector === 'div, section, a') return cardElements;
      return primaryElements;
    },
  };
}

test('normalizeText 压缩空白并去除首尾空白', () => {
  assert.equal(normalizeText('  获取\n Typeless\t移动应用  '), '获取 Typeless 移动应用');
});

test('removeMobileAppSurfaces 隐藏移动应用入口按钮', () => {
  const button = createElement({
    text: 'Get mobile app',
    childrenLength: 1,
    offsetHeight: 32,
  });

  removeMobileAppSurfaces(createRoot([button]));

  assert.equal(button.getAttribute(hiddenMobileAppAttribute), 'true');
  assert.deepEqual(button.style.entries, [
    ['display', 'none', 'important'],
    ['pointer-events', 'none', 'important'],
  ]);
});

test('removeMobileAppSurfaces 关闭并隐藏移动应用弹窗', () => {
  const closeButton = {
    clicked: false,
    click() {
      this.clicked = true;
    },
  };
  const dialog = createElement({
    text: 'Get Typeless mobile app App Store Google Play',
    childrenLength: 8,
    offsetHeight: 220,
    closeButton,
  });

  removeMobileAppSurfaces(createRoot([dialog]));

  assert.equal(closeButton.clicked, true);
  assert.equal(dialog.getAttribute(hiddenMobileAppAttribute), 'true');
});

test('removeMobileAppSurfaces 隐藏推荐和联盟卡片', () => {
  const card = createElement({
    text: 'Refer a friend and join Affiliate rewards',
    childrenLength: 4,
    offsetHeight: 120,
  });

  removeMobileAppSurfaces(createRoot([], [card]));

  assert.equal(card.getAttribute(hiddenMobileAppAttribute), 'true');
});
