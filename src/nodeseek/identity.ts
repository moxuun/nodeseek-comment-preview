import { getSsrState } from './ssr-state.js';
import type { SsrState } from './ssr-state.js';

// 当前用户身份读取服务。
// 只读取页面已经提供的 SSR 状态或用户菜单，不读取 Cookie、Storage 或浏览器会话。
interface IdentityDeps {
  documentObj: Document;
  getSsrState: (doc: Document) => SsrState | null;
}

function createIdentityService({ documentObj, getSsrState }: IdentityDeps) {
  let resolved = false;
  let uid: string | null = null;

  function uidFromHref(href: unknown): string | null {
    const match = String(href || '').match(/\/space\/(\d+)/);
    return match ? String(match[1]) : null;
  }

  function fromPageState(): string | null {
    // 首次调用通常早于官方 hydration，这一读会顺便把实时状态缓存下来。
    const user = getSsrState(documentObj)?.user;
    const value = user && (user.id ?? user.uid ?? user.userId ?? user.memberId ?? user.member_id);
    return value === undefined || value === null ? null : String(value);
  }

  function fromUserMenu(): string | null {
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

  function currentUserUid(): string | null {
    if (resolved) return uid;
    resolved = true;
    uid = fromPageState() || fromUserMenu();
    return uid;
  }

  return Object.freeze({ currentUserUid });
}

const xnsIdentityService = createIdentityService({
  documentObj: document,
  getSsrState,
});
const { currentUserUid } = xnsIdentityService;

function getCurrentUserUid(): string | null {
  return currentUserUid();
}

export { getCurrentUserUid };
