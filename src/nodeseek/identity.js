// 当前用户身份读取服务。
// 只读取页面已经提供的 SSR 状态或用户菜单，不读取 Cookie、Storage 或浏览器会话。
function createIdentityService({ documentObj, extractSsrState }) {
  let resolved = false;
  let uid = null;

  function uidFromHref(href) {
    const match = String(href || '').match(/\/space\/(\d+)/);
    return match ? String(match[1]) : null;
  }

  function fromPageState() {
    const user = extractSsrState(documentObj)?.user;
    const value = user && (user.id ?? user.uid ?? user.userId ?? user.memberId ?? user.member_id);
    return value === undefined || value === null ? null : String(value);
  }

  function fromUserMenu() {
    const selectors = [
      '[data-user-id]',
      '.user-menu a[href^="/space/"]',
      '.user-profile a[href^="/space/"]',
      '.member-profile a[href^="/space/"]',
      'header a[href^="/space/"][title]',
      'aside a[href^="/space/"][title]',
    ];
    for (const selector of selectors) {
      const nodes = documentObj.querySelectorAll(selector);
      for (const node of nodes) {
        const value = node.getAttribute('data-user-id') || node.getAttribute('href');
        const result = uidFromHref(value) || (/^\d+$/.test(value || '') ? String(value) : null);
        if (result) return result;
      }
    }
    return null;
  }

  function currentUserUid() {
    if (resolved) return uid;
    resolved = true;
    uid = fromPageState() || fromUserMenu();
    return uid;
  }

  return Object.freeze({ currentUserUid });
}

const xnsIdentityService = createIdentityService({
  documentObj: document,
  extractSsrState,
});
const getCurrentUserUid = () => xnsIdentityService.currentUserUid();
