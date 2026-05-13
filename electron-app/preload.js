const { contextBridge, ipcRenderer } = require('electron');

const keyListeners = {};
const hiddenMobileAppAttribute = 'data-typeless-local-hidden-mobile-app';

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function hideElement(element) {
  if (!element || element.nodeType !== Node.ELEMENT_NODE) return;

  element.setAttribute(hiddenMobileAppAttribute, 'true');
  element.style.setProperty('display', 'none', 'important');
  element.style.setProperty('pointer-events', 'none', 'important');
}

function closestSurface(element) {
  return element.closest('[role="dialog"], .MuiDialog-root, .MuiModal-root, [aria-modal="true"]')
    || element.closest('button, [role="button"], a')
    || element;
}

function containsAnyText(text, candidates) {
  return candidates.some((candidate) => text.includes(candidate));
}

function isMobileAppButton(element, text) {
  return containsAnyText(text, [
    '获取移动应用',
    '获取 Typeless 移动应用',
    'Get mobile app',
    'Get Typeless mobile app',
  ]);
}

function isMobileAppDialog(text) {
  return containsAnyText(text, [
    '获取Typeless移动应用',
    '获取 Typeless 移动应用',
    'Get Typeless mobile app',
  ]) || (text.includes('App Store') && text.includes('Google Play'));
}

function isReferralOrAffiliateCard(text) {
  return containsAnyText(text, [
    '推荐朋友',
    '联盟计划',
    '邀请朋友',
    'Refer a friend',
    'Affiliate',
    'Invite friends',
  ]);
}

function closeThenHideDialog(element) {
  const surface = closestSurface(element);
  const closeButton = surface.querySelector('button[aria-label="Close"], button[aria-label="关闭"]');
  if (closeButton) closeButton.click();
  hideElement(surface);
}

function removeMobileAppSurfaces(root = document) {
  if (!root || !root.querySelectorAll) return;

  const elements = root.querySelectorAll('button, [role="button"], a, div, [role="dialog"], .MuiDialog-root, .MuiModal-root, [aria-modal="true"]');
  elements.forEach((element) => {
    if (element.hasAttribute(hiddenMobileAppAttribute)) return;

    const text = normalizeText(element.textContent);
    if (!text) return;

    if (isMobileAppButton(element, text) && element.children.length <= 5 && element.offsetHeight < 60) {
      hideElement(element);
      return;
    }

    if (isMobileAppDialog(text)) {
      closeThenHideDialog(element);
    }
  });

  // 隐藏推荐朋友/联盟计划卡片
  root.querySelectorAll('div, section, a').forEach((el) => {
    if (el.hasAttribute(hiddenMobileAppAttribute)) return;
    if (el.children.length < 1 || el.children.length > 20) return;
    if (el.offsetHeight < 50 || el.offsetHeight > 300) return;
    const text = normalizeText(el.textContent);
    if (isReferralOrAffiliateCard(text)) {
      hideElement(el);
    }
  });
}

function installMobileAppSurfaceRemoval() {
  const run = () => removeMobileAppSurfaces(document);

  // 注入 CSS 隐藏移动应用下载提示条
  const injectCSS = () => {
    const style = document.createElement('style');
    style.textContent = `[${hiddenMobileAppAttribute}] { display: none !important; }`;
    (document.head || document.documentElement).appendChild(style);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { injectCSS(); run(); }, { once: true });
  } else {
    injectCSS();
    run();
  }

  const startObserver = () => {
    const target = document.documentElement || document.body;
    if (!target) return;
    const observer = new MutationObserver(() => run());
    observer.observe(target, { childList: true, subtree: true });
  };

  if (document.documentElement) {
    startObserver();
  } else {
    document.addEventListener('DOMContentLoaded', startObserver, { once: true });
  }
}

installMobileAppSurfaceRemoval();

contextBridge.exposeInMainWorld('ipcRenderer', {
  on(channel, listener) {
    return ipcRenderer.on(channel, listener);
  },
  off(channel, listener) {
    return ipcRenderer.off(channel, listener);
  },
  addKeyListener(channel, key, listener) {
    keyListeners[key] = listener;
    return ipcRenderer.addListener(channel, listener);
  },
  removeKeyListener(channel, key, listener) {
    const savedListener = keyListeners[key];
    return ipcRenderer.removeListener(channel, savedListener || listener);
  },
  send(channel, ...args) {
    return ipcRenderer.send(channel, ...args);
  },
  invoke(channel, ...args) {
    return ipcRenderer.invoke(channel, ...args);
  },
  platform: process.env.__TYPELESS_CLIENT__RUNTIME_PLATFORM__ || process.platform,
});

contextBridge.exposeInMainWorld('electronAPI', {
  onToggleRecording: (cb) => ipcRenderer.on('toggle-recording', cb),
  clipboardWrite: (text) => ipcRenderer.invoke('clipboard-write', text),
});
