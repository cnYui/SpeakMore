const hiddenMobileAppAttribute = 'data-typeless-local-hidden-mobile-app';

function getDefaultDocument() {
  return typeof document === 'undefined' ? null : document;
}

function getDefaultMutationObserver() {
  return typeof MutationObserver === 'undefined' ? null : MutationObserver;
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function hideElement(element) {
  if (!element || element.nodeType !== 1) return;

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

function removeMobileAppSurfaces(root = getDefaultDocument()) {
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

function installMobileAppSurfaceRemoval({
  documentObject = getDefaultDocument(),
  MutationObserverClass = getDefaultMutationObserver(),
} = {}) {
  if (!documentObject) return;

  const run = () => removeMobileAppSurfaces(documentObject);

  const injectCSS = () => {
    const style = documentObject.createElement('style');
    style.textContent = `[${hiddenMobileAppAttribute}] { display: none !important; }`;
    (documentObject.head || documentObject.documentElement).appendChild(style);
  };

  if (documentObject.readyState === 'loading') {
    documentObject.addEventListener('DOMContentLoaded', () => { injectCSS(); run(); }, { once: true });
  } else {
    injectCSS();
    run();
  }

  const startObserver = () => {
    const target = documentObject.documentElement || documentObject.body;
    if (!target || !MutationObserverClass) return;
    const observer = new MutationObserverClass(() => run());
    observer.observe(target, { childList: true, subtree: true });
  };

  if (documentObject.documentElement) {
    startObserver();
  } else {
    documentObject.addEventListener('DOMContentLoaded', startObserver, { once: true });
  }
}

module.exports = {
  hiddenMobileAppAttribute,
  installMobileAppSurfaceRemoval,
  normalizeText,
  removeMobileAppSurfaces,
};
