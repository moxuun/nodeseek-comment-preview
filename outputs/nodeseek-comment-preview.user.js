// ==UserScript==
// @name         nodeseek楼中楼预览
// @namespace    https://www.nodeseek.com/
// @version      0.5.63
// @author       moxuun
// @description  楼中楼、虚拟楼层流、原版评论布局、ANSI 代码块和标签页渲染、代码块复制、更窄灰色边缘、帖子回复、分页并发加载、图片灯箱和 V2Next 式预览刷新/滚动控制。
// @license      MIT
// @homepageURL  https://github.com/moxuun/nodeseek-comment-preview
// @supportURL   https://github.com/moxuun/nodeseek-comment-preview/issues
// @match        https://www.nodeseek.com/*
// @grant        GM_registerMenuCommand
// @run-at       document-start
// @noframes
// ==/UserScript==

(function() {
	"use strict";
	var __commonJSMin = (cb, mod) => () => (mod || (cb((mod = { exports: {} }).exports, mod), cb = null), mod.exports);
	var PREFIX = "xns";
	var REQUEST_TIMEOUT = 8e3;
	var MAX_RESPONSE_BYTES = 2e6;
	var HTML_CACHE_TTL = 3e4;
	var HTML_CACHE_MAX_BYTES = 4e6;
	var HTML_CACHE_ITEM_MAX_BYTES = 512e3;
	var STYLE_ID = `${PREFIX}-style`;
	var DEFAULT_MODE = "thread";
	var SELECTORS = Object.freeze({
		commentContainer: ".comment-container",
		commentList: ".comment-container > ul.comments, .comment-container ul.comments",
		commentItem: ".content-item[id], li[id].content-item",
		postContent: "article.post-content, .post-content",
		postTitle: "h1.post-title, .post-title, h1"
	});
	var ANSI_FG_HEX = [
		"#111827",
		"#dc2626",
		"#16a34a",
		"#ca8a04",
		"#2563eb",
		"#c026d3",
		"#0891b2",
		"#f8fafc"
	];
	var ANSI_BG_HEX = [
		"#111827",
		"#ef4444",
		"#22c55e",
		"#facc15",
		"#3b82f6",
		"#d946ef",
		"#06b6d4",
		"#f8fafc"
	];
	var ANSI_BRIGHT_HEX = [
		"#6b7280",
		"#f87171",
		"#4ade80",
		"#fde047",
		"#60a5fa",
		"#f0abfc",
		"#67e8f9",
		"#fff"
	];
	var ANSI_COLORS = [
		"black",
		"red",
		"green",
		"yellow",
		"blue",
		"magenta",
		"cyan",
		"white"
	];
	var state = {
		post: null,
		modal: null,
		settingsPanel: null,
		lightbox: null,
		mode: DEFAULT_MODE
	};
	function createDomTools({ documentObj, windowObj, selectors, URLCtor }) {
		function safePositiveInt(value) {
			if (typeof value !== "string" && typeof value !== "number") return null;
			const text = String(value);
			if (!/^\d{1,15}$/.test(text)) return null;
			const number = Number(text);
			return Number.isSafeInteger(number) && number > 0 ? number : null;
		}
		function safeCount(value) {
			const number = Number(value);
			return Number.isSafeInteger(number) && number >= 0 ? number : null;
		}
		function qs(root, selector) {
			return root?.querySelector(selector) || null;
		}
		function qsa(root, selector) {
			return root ? Array.from(root.querySelectorAll(selector)) : [];
		}
		function createElement(tagName, className, text) {
			const element = documentObj.createElement(tagName);
			if (className) element.className = className;
			if (typeof text === "string") element.textContent = text;
			return element;
		}
		function clearElement(element) {
			while (element.firstChild) element.removeChild(element.firstChild);
		}
		function findCommentList(root = documentObj) {
			return qs(root, selectors.commentList);
		}
		function getCommentItems(root = documentObj) {
			const list = findCommentList(root);
			if (!list) return [];
			return Array.from(list.children).filter((item) => item.matches?.(selectors.commentItem));
		}
		function getFloor(item) {
			return safePositiveInt(item?.getAttribute("id") || "");
		}
		function getCommentId(item) {
			return safePositiveInt(item?.getAttribute("data-comment-id") || "");
		}
		function getAuthorName(item) {
			const profileName = qs(item, ":scope > .nsk-content-meta-info a.author-name, :scope > .nsk-content-meta-info a[href^=\"/space/\"], :scope > .nsk-content-meta-info a[href*=\"/space/\"]")?.textContent?.trim();
			if (profileName) return profileName.slice(0, 80);
			const avatarAlt = qs(item, ":scope > .nsk-content-meta-info img[alt]")?.getAttribute("alt")?.trim();
			return avatarAlt ? avatarAlt.slice(0, 80) : "该用户";
		}
		function getPostContent(item) {
			return qs(item, ":scope > article.post-content, :scope > .post-content") || qs(item, selectors.postContent);
		}
		function getSafeUrlAttribute(name, rawValue) {
			if (typeof rawValue !== "string" || rawValue.length > 4096) return null;
			if (name === "src" && rawValue.startsWith("data:image/")) return rawValue.length <= 262144 ? rawValue : null;
			try {
				const url = new URLCtor(rawValue, windowObj.location.href);
				if (name === "href") return [
					"http:",
					"https:",
					"mailto:"
				].includes(url.protocol) ? url.href : null;
				return ["http:", "https:"].includes(url.protocol) ? url.href : null;
			} catch {
				return null;
			}
		}
		return Object.freeze({
			safePositiveInt,
			safeCount,
			qs,
			qsa,
			createElement,
			clearElement,
			findCommentList,
			getCommentItems,
			getFloor,
			getCommentId,
			getAuthorName,
			getPostContent,
			getSafeUrlAttribute
		});
	}
	var xnsDomTools = createDomTools({
		documentObj: document,
		windowObj: window,
		selectors: SELECTORS,
		URLCtor: URL
	});
	function safePositiveInt(...args) {
		return xnsDomTools.safePositiveInt(...args);
	}
	function safeCount(...args) {
		return xnsDomTools.safeCount(...args);
	}
	function qs(...args) {
		return xnsDomTools.qs(...args);
	}
	function qsa(...args) {
		return xnsDomTools.qsa(...args);
	}
	function createElement(...args) {
		return xnsDomTools.createElement(...args);
	}
	function clearElement(...args) {
		return xnsDomTools.clearElement(...args);
	}
	function findCommentList(...args) {
		return xnsDomTools.findCommentList(...args);
	}
	function getCommentItems(...args) {
		return xnsDomTools.getCommentItems(...args);
	}
	function getFloor(...args) {
		return xnsDomTools.getFloor(...args);
	}
	function getCommentId(...args) {
		return xnsDomTools.getCommentId(...args);
	}
	function getAuthorName(...args) {
		return xnsDomTools.getAuthorName(...args);
	}
	function getPostContent(...args) {
		return xnsDomTools.getPostContent(...args);
	}
	function getSafeUrlAttribute(...args) {
		return xnsDomTools.getSafeUrlAttribute(...args);
	}
	function createNodeSeekUrlService({ windowObj, URLCtor, safePositiveInt }) {
		function getPostInfo(rawUrl) {
			try {
				const url = new URLCtor(rawUrl, windowObj.location.href);
				if (url.origin !== windowObj.location.origin) return null;
				const match = /^\/post-(\d+)-(\d+)\/?$/.exec(url.pathname);
				if (!match) return null;
				const postId = safePositiveInt(match[1]);
				const page = safePositiveInt(match[2]);
				if (postId === null || page === null) return null;
				return {
					postId: String(postId),
					page
				};
			} catch {
				return null;
			}
		}
		function buildPostUrl(postId, page = 1, floor = null) {
			const normalizedPostId = safePositiveInt(postId);
			const normalizedPage = safePositiveInt(page);
			if (normalizedPostId === null || normalizedPage === null) return null;
			const url = new URLCtor(`/post-${normalizedPostId}-${normalizedPage}`, windowObj.location.origin);
			if (floor !== null && floor !== void 0 && /^\d{1,15}$/.test(String(floor))) {
				const normalizedFloor = Number(floor);
				if (Number.isSafeInteger(normalizedFloor)) url.hash = String(normalizedFloor);
			}
			return url;
		}
		function parseSameOriginUrl(rawUrl, base = windowObj.location.href) {
			if (typeof rawUrl !== "string" || rawUrl.length > 2048) return null;
			try {
				const url = new URLCtor(rawUrl, base);
				if (!["http:", "https:"].includes(url.protocol)) return null;
				if (url.origin !== windowObj.location.origin || url.username || url.password) return null;
				return url;
			} catch {
				return null;
			}
		}
		function isAllowedPostRequest(url) {
			const info = url instanceof URLCtor ? getPostInfo(url.href) : null;
			return Boolean(info && !url.search && !url.username && !url.password);
		}
		return Object.freeze({
			buildPostUrl,
			getPostInfo,
			parseSameOriginUrl,
			isAllowedPostRequest
		});
	}
	var xnsNodeSeekUrlService = createNodeSeekUrlService({
		windowObj: window,
		URLCtor: URL,
		safePositiveInt
	});
	function buildPostUrl(...args) {
		return xnsNodeSeekUrlService.buildPostUrl(...args);
	}
	function getPostInfo(...args) {
		return xnsNodeSeekUrlService.getPostInfo(...args);
	}
	function parseSameOriginUrl(...args) {
		return xnsNodeSeekUrlService.parseSameOriginUrl(...args);
	}
	function isAllowedPostRequest(...args) {
		return xnsNodeSeekUrlService.isAllowedPostRequest(...args);
	}
	var pageInfo = getPostInfo(window.location.href);
	function createNodeSeekActionApi({ windowObj, navigatorObj, state, requestTimeout, parseSameOriginUrl, fetchFn, AbortControllerCtor }) {
		const allowedPaths = new Set([
			"/api/statistics/upvote",
			"/api/statistics/like",
			"/api/statistics/dislike",
			"/api/statistics/collection",
			"/api/content/new-comment",
			"/api/vote/voteforitem"
		]);
		async function dynamicSign(method, url, body) {
			const input = `${method}\n\n${url}\n\n${navigatorObj.userAgent || ""}\n\n${body || ""}`;
			try {
				const digest = await windowObj.crypto.subtle.digest("SHA-1", new TextEncoder().encode(input));
				return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
			} catch {
				return "a".repeat(40);
			}
		}
		function randomCsrfToken() {
			const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
			const bytes = new Uint8Array(16);
			if (windowObj.crypto?.getRandomValues) windowObj.crypto.getRandomValues(bytes);
			else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
			let token = "";
			bytes.forEach((byte) => {
				token += alphabet[byte % 62];
			});
			return token;
		}
		async function postAction(apiPath, payload, options = {}) {
			const contextUrl = options.context?.url?.href || state.modal?.url?.href || windowObj.location.href;
			const endpoint = parseSameOriginUrl(apiPath, contextUrl);
			if (!endpoint || !allowedPaths.has(endpoint.pathname)) throw new Error("操作地址不是 NodeSeek 同源接口");
			const controller = new AbortControllerCtor();
			const timer = windowObj.setTimeout(() => controller.abort(), requestTimeout);
			const bodyText = JSON.stringify(payload);
			const requestHeaders = {
				Accept: "application/json, text/plain, */*",
				"Content-Type": "application/json",
				"X-Requested-With": "XMLHttpRequest",
				"csrf-token": randomCsrfToken(),
				...options.headers || {}
			};
			if (windowObj.crypto?.subtle) requestHeaders["x-dynamic-sign"] = await dynamicSign("POST", endpoint.href, bodyText);
			try {
				const response = await fetchFn(endpoint.href, {
					method: "POST",
					credentials: "same-origin",
					cache: "no-store",
					redirect: "error",
					referrer: contextUrl,
					referrerPolicy: "same-origin",
					headers: requestHeaders,
					body: bodyText,
					signal: controller.signal
				});
				const text = await response.text();
				let data = null;
				try {
					data = text ? JSON.parse(text) : null;
				} catch {}
				const contentType = (response.headers.get("content-type") || "").toLowerCase();
				const explicitFailure = data && typeof data === "object" && (data.success === false || data.ok === false || data.error === true || typeof data.status === "string" && /fail|error|unauthor|denied/i.test(data.status) || typeof data.code === "string" && /fail|error|unauthor|denied/i.test(data.code));
				if (!response.ok || explicitFailure || !data && /text\/html|<html[\s>]|登录|禁止访问/i.test(`${contentType} ${text.slice(0, 500)}`)) {
					const message = data?.message || data?.msg || text.replace(/<[^>]+>/g, " ").trim().slice(0, 120);
					throw new Error(message || `HTTP ${response.status}`);
				}
				return data;
			} finally {
				windowObj.clearTimeout(timer);
			}
		}
		return Object.freeze({
			dynamicSign,
			randomCsrfToken,
			postAction
		});
	}
	var xnsNodeSeekActionApi = createNodeSeekActionApi({
		windowObj: window,
		navigatorObj: navigator,
		state,
		requestTimeout: REQUEST_TIMEOUT,
		parseSameOriginUrl,
		fetchFn: window.fetch.bind(window),
		AbortControllerCtor: window.AbortController
	});
	function dynamicSign(...args) {
		return xnsNodeSeekActionApi.dynamicSign(...args);
	}
	function postAction(...args) {
		return xnsNodeSeekActionApi.postAction(...args);
	}
	function buildReplyTree(records) {
		const byFloor = new Map(records.map((record) => [record.floor, record]));
		records.forEach((record) => {
			record.parent = null;
			record.children = [];
		});
		records.forEach((record) => {
			const target = record.reply?.targetFloor ? byFloor.get(record.reply.targetFloor) : null;
			if (target && target !== record && !record.pinned) {
				record.parent = target;
				target.children.push(record);
			}
		});
		const order = (record) => record.page * 1e5 + record.index;
		records.forEach((record) => record.children.sort((a, b) => order(a) - order(b)));
		return records.filter((record) => !record.parent).sort((a, b) => {
			if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
			return order(a) - order(b);
		});
	}
	function flattenReplyTree(records) {
		const flat = [];
		const stack = buildReplyTree(records).slice().reverse().map((record) => ({
			record,
			depth: 0
		}));
		while (stack.length) {
			const entry = stack.pop();
			flat.push(entry);
			entry.record.children.slice().reverse().forEach((child) => stack.push({
				record: child,
				depth: entry.depth + 1
			}));
		}
		return flat;
	}
	function mergeCommentRecords(...groups) {
		const merged = new Map();
		groups.forEach((records) => {
			if (!Array.isArray(records)) return;
			records.forEach((record) => {
				if (!record) return;
				const key = String(record.floor);
				if (!merged.get(key) || record.current) merged.set(key, record);
			});
		});
		return Array.from(merged.values());
	}
	function createPreferences({ windowObj, documentObj, state, storageKey, defaultMode, maxPage }) {
		const defaults = Object.freeze({
			mode: defaultMode,
			maxPages: maxPage,
			density: "comfortable",
			theme: "auto"
		});
		let values = { ...defaults };
		let ownsDarkClass = false;
		function normalize(raw = {}) {
			const mode = raw.mode === "original" ? "original" : defaultMode;
			const requestedPages = Number(raw.maxPages);
			return {
				mode,
				maxPages: [
					10,
					20,
					30,
					maxPage
				].includes(requestedPages) ? requestedPages : maxPage,
				density: raw.density === "compact" ? "compact" : "comfortable",
				theme: raw.theme === "dark" ? "dark" : "auto"
			};
		}
		function read() {
			try {
				return normalize(JSON.parse(windowObj.localStorage?.getItem(storageKey) || "{}"));
			} catch {
				return { ...defaults };
			}
		}
		function apply() {
			const root = documentObj.documentElement;
			if (!root) return;
			root.classList.toggle("xns-density-compact", values.density === "compact");
			if (values.theme === "dark") {
				if (!root.classList.contains("dark-layout")) {
					root.classList.add("dark-layout");
					ownsDarkClass = true;
				}
			} else if (ownsDarkClass) {
				root.classList.remove("dark-layout");
				ownsDarkClass = false;
			}
		}
		function save() {
			try {
				windowObj.localStorage?.setItem(storageKey, JSON.stringify(values));
			} catch {}
		}
		function update(patch = {}) {
			values = normalize({
				...values,
				...patch
			});
			state.mode = values.mode;
			save();
			apply();
			return { ...values };
		}
		function reset() {
			return update(defaults);
		}
		values = read();
		state.mode = values.mode;
		apply();
		return Object.freeze({
			get: () => ({ ...values }),
			update,
			reset,
			getMaxPage: () => values.maxPages,
			apply
		});
	}
	var xnsPreferences = createPreferences({
		windowObj: window,
		documentObj: document,
		state,
		storageKey: "xns-comment-preview-settings",
		defaultMode: DEFAULT_MODE,
		maxPage: 50
	});
	function getSettings(...args) {
		return xnsPreferences.get(...args);
	}
	function updateSettings(...args) {
		return xnsPreferences.update(...args);
	}
	function resetSettings(...args) {
		return xnsPreferences.reset(...args);
	}
	function getMaxPage(...args) {
		return xnsPreferences.getMaxPage(...args);
	}
	function createSsrStateService({ documentObj, qs }) {
		function extractSsrState(doc) {
			try {
				const encoded = qs(doc, "#temp-script[type=\"application/json\"]")?.textContent?.trim();
				if (!encoded) return null;
				const json = decodeURIComponent(escape(atob(encoded)));
				const data = JSON.parse(json);
				return data && typeof data === "object" && (data.user !== void 0 || data.postData && Array.isArray(data.postData.comments)) ? data : null;
			} catch {
				return null;
			}
		}
		function getDocState(root) {
			return root && root !== documentObj ? root.__xnsState || null : null;
		}
		return Object.freeze({
			extractSsrState,
			getDocState
		});
	}
	var xnsSsrStateService = createSsrStateService({
		documentObj: document,
		qs
	});
	function extractSsrState(...args) {
		return xnsSsrStateService.extractSsrState(...args);
	}
	function getDocState(...args) {
		return xnsSsrStateService.getDocState(...args);
	}
	function createIdentityService({ documentObj, extractSsrState }) {
		let resolved = false;
		let uid = null;
		function uidFromHref(href) {
			const match = String(href || "").match(/\/space\/(\d+)/);
			return match ? String(match[1]) : null;
		}
		function fromPageState() {
			const user = extractSsrState(documentObj)?.user;
			const value = user && (user.id ?? user.uid ?? user.userId ?? user.memberId ?? user.member_id);
			return value === void 0 || value === null ? null : String(value);
		}
		function fromUserMenu() {
			for (const selector of [
				"[data-user-id]",
				".user-menu a[href^=\"/space/\"]",
				".user-profile a[href^=\"/space/\"]",
				".member-profile a[href^=\"/space/\"]",
				"header a[href^=\"/space/\"][title]",
				"aside a[href^=\"/space/\"][title]"
			]) {
				const nodes = documentObj.querySelectorAll(selector);
				for (const node of nodes) {
					const value = node.getAttribute("data-user-id") || node.getAttribute("href");
					const result = uidFromHref(value) || (/^\d+$/.test(value || "") ? String(value) : null);
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
	var xnsIdentityService = createIdentityService({
		documentObj: document,
		extractSsrState
	});
	function getCurrentUserUid() {
		return xnsIdentityService.currentUserUid();
	}
	function _OverloadYield(e, d) {
		this.v = e, this.k = d;
	}
	function _arrayLikeToArray(r, a) {
		(null == a || a > r.length) && (a = r.length);
		for (var e = 0, n = Array(a); e < a; e++) n[e] = r[e];
		return n;
	}
	function _arrayWithHoles(r) {
		if (Array.isArray(r)) return r;
	}
	function _iterableToArrayLimit(r, l) {
		var t = null == r ? null : "undefined" != typeof Symbol && r[Symbol.iterator] || r["@@iterator"];
		if (null != t) {
			var e, n, i, u, a = [], f = !0, o = !1;
			try {
				if (i = (t = t.call(r)).next, 0 === l) {
					if (Object(t) !== t) return;
					f = !1;
				} else for (; !(f = (e = i.call(t)).done) && (a.push(e.value), a.length !== l); f = !0);
			} catch (r) {
				o = !0, n = r;
			} finally {
				try {
					if (!f && null != t.return && (u = t.return(), Object(u) !== u)) return;
				} finally {
					if (o) throw n;
				}
			}
			return a;
		}
	}
	function _nonIterableRest() {
		throw new TypeError("Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
	}
	function _slicedToArray(r, e) {
		return _arrayWithHoles(r) || _iterableToArrayLimit(r, e) || _unsupportedIterableToArray(r, e) || _nonIterableRest();
	}
	function _unsupportedIterableToArray(r, a) {
		if (r) {
			if ("string" == typeof r) return _arrayLikeToArray(r, a);
			var t = {}.toString.call(r).slice(8, -1);
			return "Object" === t && r.constructor && (t = r.constructor.name), "Map" === t || "Set" === t ? Array.from(r) : "Arguments" === t || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t) ? _arrayLikeToArray(r, a) : void 0;
		}
	}
	function AsyncGenerator(e) {
		var t, n;
		function resume(t, n) {
			try {
				var r = e[t](n), o = r.value, u = o instanceof _OverloadYield;
				Promise.resolve(u ? o.v : o).then(function(n) {
					if (u) {
						var i = "return" === t && o.k ? t : "next";
						if (!o.k || n.done) return resume(i, n);
						n = e[i](n).value;
					}
					settle(!!r.done, n);
				}, function(e) {
					resume("throw", e);
				});
			} catch (e) {
				settle(2, e);
			}
		}
		function settle(e, r) {
			2 === e ? t.reject(r) : t.resolve({
				value: r,
				done: e
			}), (t = t.next) ? resume(t.key, t.arg) : n = null;
		}
		this._invoke = function(e, r) {
			return new Promise(function(o, u) {
				var i = {
					key: e,
					arg: r,
					resolve: o,
					reject: u,
					next: null
				};
				n ? n = n.next = i : (t = n = i, resume(e, r));
			});
		}, "function" != typeof e.return && (this.return = void 0);
	}
	AsyncGenerator.prototype["function" == typeof Symbol && Symbol.asyncIterator || "@@asyncIterator"] = function() {
		return this;
	}, AsyncGenerator.prototype.next = function(e) {
		return this._invoke("next", e);
	}, AsyncGenerator.prototype.throw = function(e) {
		return this._invoke("throw", e);
	}, AsyncGenerator.prototype.return = function(e) {
		return this._invoke("return", e);
	};
	var entries = Object.entries;
	var setPrototypeOf = Object.setPrototypeOf;
	var isFrozen = Object.isFrozen;
	var getPrototypeOf = Object.getPrototypeOf;
	var getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
	var freeze = Object.freeze;
	var seal = Object.seal;
	var create = Object.create;
	var _ref = typeof Reflect !== "undefined" && Reflect;
	var apply = _ref.apply;
	var construct = _ref.construct;
	if (!freeze) freeze = function freeze(x) {
		return x;
	};
	if (!seal) seal = function seal(x) {
		return x;
	};
	if (!apply) apply = function apply(func, thisArg) {
		for (var _len = arguments.length, args = new Array(_len > 2 ? _len - 2 : 0), _key = 2; _key < _len; _key++) args[_key - 2] = arguments[_key];
		return func.apply(thisArg, args);
	};
	if (!construct) construct = function construct(Func) {
		for (var _len2 = arguments.length, args = new Array(_len2 > 1 ? _len2 - 1 : 0), _key2 = 1; _key2 < _len2; _key2++) args[_key2 - 1] = arguments[_key2];
		return new Func(...args);
	};
	var arrayForEach = unapply(Array.prototype.forEach);
	Array.prototype.indexOf;
	var arrayLastIndexOf = unapply(Array.prototype.lastIndexOf);
	var arrayPop = unapply(Array.prototype.pop);
	var arrayPush = unapply(Array.prototype.push);
	Array.prototype.slice;
	var arraySplice = unapply(Array.prototype.splice);
	var arrayIsArray = Array.isArray;
	var stringToLowerCase = unapply(String.prototype.toLowerCase);
	var stringToString = unapply(String.prototype.toString);
	var stringMatch = unapply(String.prototype.match);
	var stringReplace = unapply(String.prototype.replace);
	var stringIndexOf = unapply(String.prototype.indexOf);
	var stringTrim = unapply(String.prototype.trim);
	var numberToString = unapply(Number.prototype.toString);
	var booleanToString = unapply(Boolean.prototype.toString);
	var bigintToString = typeof BigInt === "undefined" ? null : unapply(BigInt.prototype.toString);
	var symbolToString = typeof Symbol === "undefined" ? null : unapply(Symbol.prototype.toString);
	var objectHasOwnProperty = unapply(Object.prototype.hasOwnProperty);
	var objectToString = unapply(Object.prototype.toString);
	var regExpTest = unapply(RegExp.prototype.test);
	var typeErrorCreate = unconstruct(TypeError);
	function unapply(func) {
		return function(thisArg) {
			if (thisArg instanceof RegExp) thisArg.lastIndex = 0;
			for (var _len3 = arguments.length, args = new Array(_len3 > 1 ? _len3 - 1 : 0), _key3 = 1; _key3 < _len3; _key3++) args[_key3 - 1] = arguments[_key3];
			return apply(func, thisArg, args);
		};
	}
	function unconstruct(Func) {
		return function() {
			for (var _len4 = arguments.length, args = new Array(_len4), _key4 = 0; _key4 < _len4; _key4++) args[_key4] = arguments[_key4];
			return construct(Func, args);
		};
	}
	function addToSet(set, array) {
		let transformCaseFunc = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : stringToLowerCase;
		if (setPrototypeOf) setPrototypeOf(set, null);
		if (!arrayIsArray(array)) return set;
		let l = array.length;
		while (l--) {
			let element = array[l];
			if (typeof element === "string") {
				const lcElement = transformCaseFunc(element);
				if (lcElement !== element) {
					if (!isFrozen(array)) array[l] = lcElement;
					element = lcElement;
				}
			}
			set[element] = true;
		}
		return set;
	}
	function cleanArray(array) {
		for (let index = 0; index < array.length; index++) if (!objectHasOwnProperty(array, index)) array[index] = null;
		return array;
	}
	function clone(object) {
		const newObject = create(null);
		for (const _ref2 of entries(object)) {
			var _ref3 = _slicedToArray(_ref2, 2);
			const property = _ref3[0];
			const value = _ref3[1];
			if (objectHasOwnProperty(object, property)) {
				if (arrayIsArray(value)) newObject[property] = cleanArray(value);
				else if (value && typeof value === "object" && value.constructor === Object) newObject[property] = clone(value);
				else newObject[property] = value;
			}
		}
		return newObject;
	}
	function stringifyValue(value) {
		switch (typeof value) {
			case "string": return value;
			case "number": return numberToString(value);
			case "boolean": return booleanToString(value);
			case "bigint": return bigintToString ? bigintToString(value) : "0";
			case "symbol": return symbolToString ? symbolToString(value) : "Symbol()";
			case "undefined": return objectToString(value);
			case "function":
			case "object": {
				if (value === null) return objectToString(value);
				const valueAsRecord = value;
				const valueToString = lookupGetter(valueAsRecord, "toString");
				if (typeof valueToString === "function") {
					const stringified = valueToString(valueAsRecord);
					return typeof stringified === "string" ? stringified : objectToString(stringified);
				}
				return objectToString(value);
			}
			default: return objectToString(value);
		}
	}
	function lookupGetter(object, prop) {
		while (object !== null) {
			const desc = getOwnPropertyDescriptor(object, prop);
			if (desc) {
				if (desc.get) return unapply(desc.get);
				if (typeof desc.value === "function") return unapply(desc.value);
			}
			object = getPrototypeOf(object);
		}
		function fallbackValue() {
			return null;
		}
		return fallbackValue;
	}
	function isRegex(value) {
		try {
			regExpTest(value, "");
			return true;
		} catch (_unused) {
			return false;
		}
	}
	var html$1 = freeze([
		"a",
		"abbr",
		"acronym",
		"address",
		"area",
		"article",
		"aside",
		"audio",
		"b",
		"bdi",
		"bdo",
		"big",
		"blink",
		"blockquote",
		"body",
		"br",
		"button",
		"canvas",
		"caption",
		"center",
		"cite",
		"code",
		"col",
		"colgroup",
		"content",
		"data",
		"datalist",
		"dd",
		"decorator",
		"del",
		"details",
		"dfn",
		"dialog",
		"dir",
		"div",
		"dl",
		"dt",
		"element",
		"em",
		"fieldset",
		"figcaption",
		"figure",
		"font",
		"footer",
		"form",
		"h1",
		"h2",
		"h3",
		"h4",
		"h5",
		"h6",
		"head",
		"header",
		"hgroup",
		"hr",
		"html",
		"i",
		"img",
		"input",
		"ins",
		"kbd",
		"label",
		"legend",
		"li",
		"main",
		"map",
		"mark",
		"marquee",
		"menu",
		"menuitem",
		"meter",
		"nav",
		"nobr",
		"ol",
		"optgroup",
		"option",
		"output",
		"p",
		"picture",
		"pre",
		"progress",
		"q",
		"rp",
		"rt",
		"ruby",
		"s",
		"samp",
		"search",
		"section",
		"select",
		"shadow",
		"slot",
		"small",
		"source",
		"spacer",
		"span",
		"strike",
		"strong",
		"style",
		"sub",
		"summary",
		"sup",
		"table",
		"tbody",
		"td",
		"template",
		"textarea",
		"tfoot",
		"th",
		"thead",
		"time",
		"tr",
		"track",
		"tt",
		"u",
		"ul",
		"var",
		"video",
		"wbr"
	]);
	var svg$1 = freeze([
		"svg",
		"a",
		"altglyph",
		"altglyphdef",
		"altglyphitem",
		"animatecolor",
		"animatemotion",
		"animatetransform",
		"circle",
		"clippath",
		"defs",
		"desc",
		"ellipse",
		"enterkeyhint",
		"exportparts",
		"filter",
		"font",
		"g",
		"glyph",
		"glyphref",
		"hkern",
		"image",
		"inputmode",
		"line",
		"lineargradient",
		"marker",
		"mask",
		"metadata",
		"mpath",
		"part",
		"path",
		"pattern",
		"polygon",
		"polyline",
		"radialgradient",
		"rect",
		"stop",
		"style",
		"switch",
		"symbol",
		"text",
		"textpath",
		"title",
		"tref",
		"tspan",
		"view",
		"vkern"
	]);
	var svgFilters = freeze([
		"feBlend",
		"feColorMatrix",
		"feComponentTransfer",
		"feComposite",
		"feConvolveMatrix",
		"feDiffuseLighting",
		"feDisplacementMap",
		"feDistantLight",
		"feDropShadow",
		"feFlood",
		"feFuncA",
		"feFuncB",
		"feFuncG",
		"feFuncR",
		"feGaussianBlur",
		"feImage",
		"feMerge",
		"feMergeNode",
		"feMorphology",
		"feOffset",
		"fePointLight",
		"feSpecularLighting",
		"feSpotLight",
		"feTile",
		"feTurbulence"
	]);
	var svgDisallowed = freeze([
		"animate",
		"color-profile",
		"cursor",
		"discard",
		"font-face",
		"font-face-format",
		"font-face-name",
		"font-face-src",
		"font-face-uri",
		"foreignobject",
		"hatch",
		"hatchpath",
		"mesh",
		"meshgradient",
		"meshpatch",
		"meshrow",
		"missing-glyph",
		"script",
		"set",
		"solidcolor",
		"unknown",
		"use"
	]);
	var mathMl$1 = freeze([
		"math",
		"menclose",
		"merror",
		"mfenced",
		"mfrac",
		"mglyph",
		"mi",
		"mlabeledtr",
		"mmultiscripts",
		"mn",
		"mo",
		"mover",
		"mpadded",
		"mphantom",
		"mroot",
		"mrow",
		"ms",
		"mspace",
		"msqrt",
		"mstyle",
		"msub",
		"msup",
		"msubsup",
		"mtable",
		"mtd",
		"mtext",
		"mtr",
		"munder",
		"munderover",
		"mprescripts"
	]);
	var mathMlDisallowed = freeze([
		"maction",
		"maligngroup",
		"malignmark",
		"mlongdiv",
		"mscarries",
		"mscarry",
		"msgroup",
		"mstack",
		"msline",
		"msrow",
		"semantics",
		"annotation",
		"annotation-xml",
		"mprescripts",
		"none"
	]);
	var text = freeze(["#text"]);
	var html = freeze([
		"accept",
		"action",
		"align",
		"alt",
		"autocapitalize",
		"autocomplete",
		"autopictureinpicture",
		"autoplay",
		"background",
		"bgcolor",
		"border",
		"capture",
		"cellpadding",
		"cellspacing",
		"checked",
		"cite",
		"class",
		"clear",
		"color",
		"cols",
		"colspan",
		"command",
		"commandfor",
		"controls",
		"controlslist",
		"coords",
		"crossorigin",
		"datetime",
		"decoding",
		"default",
		"dir",
		"disabled",
		"disablepictureinpicture",
		"disableremoteplayback",
		"download",
		"draggable",
		"enctype",
		"enterkeyhint",
		"exportparts",
		"face",
		"for",
		"headers",
		"height",
		"hidden",
		"high",
		"href",
		"hreflang",
		"id",
		"inert",
		"inputmode",
		"integrity",
		"ismap",
		"kind",
		"label",
		"lang",
		"list",
		"loading",
		"loop",
		"low",
		"max",
		"maxlength",
		"media",
		"method",
		"min",
		"minlength",
		"multiple",
		"muted",
		"name",
		"nonce",
		"noshade",
		"novalidate",
		"nowrap",
		"open",
		"optimum",
		"part",
		"pattern",
		"placeholder",
		"playsinline",
		"popover",
		"popovertarget",
		"popovertargetaction",
		"poster",
		"preload",
		"pubdate",
		"radiogroup",
		"readonly",
		"rel",
		"required",
		"rev",
		"reversed",
		"role",
		"rows",
		"rowspan",
		"spellcheck",
		"scope",
		"selected",
		"shape",
		"size",
		"sizes",
		"slot",
		"span",
		"srclang",
		"start",
		"src",
		"srcset",
		"step",
		"style",
		"summary",
		"tabindex",
		"title",
		"translate",
		"type",
		"usemap",
		"valign",
		"value",
		"width",
		"wrap",
		"xmlns"
	]);
	var svg = freeze([
		"accent-height",
		"accumulate",
		"additive",
		"alignment-baseline",
		"amplitude",
		"ascent",
		"attributename",
		"attributetype",
		"azimuth",
		"basefrequency",
		"baseline-shift",
		"begin",
		"bias",
		"by",
		"class",
		"clip",
		"clippathunits",
		"clip-path",
		"clip-rule",
		"color",
		"color-interpolation",
		"color-interpolation-filters",
		"color-profile",
		"color-rendering",
		"cx",
		"cy",
		"d",
		"dx",
		"dy",
		"diffuseconstant",
		"direction",
		"display",
		"divisor",
		"dominant-baseline",
		"dur",
		"edgemode",
		"elevation",
		"end",
		"exponent",
		"fill",
		"fill-opacity",
		"fill-rule",
		"filter",
		"filterunits",
		"flood-color",
		"flood-opacity",
		"font-family",
		"font-size",
		"font-size-adjust",
		"font-stretch",
		"font-style",
		"font-variant",
		"font-weight",
		"fx",
		"fy",
		"g1",
		"g2",
		"glyph-name",
		"glyphref",
		"gradientunits",
		"gradienttransform",
		"height",
		"href",
		"id",
		"image-rendering",
		"in",
		"in2",
		"intercept",
		"k",
		"k1",
		"k2",
		"k3",
		"k4",
		"kerning",
		"keypoints",
		"keysplines",
		"keytimes",
		"lang",
		"lengthadjust",
		"letter-spacing",
		"kernelmatrix",
		"kernelunitlength",
		"lighting-color",
		"local",
		"marker-end",
		"marker-mid",
		"marker-start",
		"markerheight",
		"markerunits",
		"markerwidth",
		"maskcontentunits",
		"maskunits",
		"max",
		"mask",
		"mask-type",
		"media",
		"method",
		"mode",
		"min",
		"name",
		"numoctaves",
		"offset",
		"operator",
		"opacity",
		"order",
		"orient",
		"orientation",
		"origin",
		"overflow",
		"paint-order",
		"path",
		"pathlength",
		"patterncontentunits",
		"patterntransform",
		"patternunits",
		"pointer-events",
		"points",
		"preservealpha",
		"preserveaspectratio",
		"primitiveunits",
		"r",
		"rx",
		"ry",
		"radius",
		"refx",
		"refy",
		"repeatcount",
		"repeatdur",
		"restart",
		"result",
		"rotate",
		"scale",
		"seed",
		"shape-rendering",
		"slope",
		"specularconstant",
		"specularexponent",
		"spreadmethod",
		"startoffset",
		"stddeviation",
		"stitchtiles",
		"stop-color",
		"stop-opacity",
		"stroke-dasharray",
		"stroke-dashoffset",
		"stroke-linecap",
		"stroke-linejoin",
		"stroke-miterlimit",
		"stroke-opacity",
		"stroke",
		"stroke-width",
		"style",
		"surfacescale",
		"systemlanguage",
		"tabindex",
		"tablevalues",
		"targetx",
		"targety",
		"transform",
		"transform-origin",
		"text-anchor",
		"text-decoration",
		"text-orientation",
		"text-rendering",
		"textlength",
		"type",
		"u1",
		"u2",
		"unicode",
		"values",
		"vector-effect",
		"viewbox",
		"visibility",
		"version",
		"vert-adv-y",
		"vert-origin-x",
		"vert-origin-y",
		"width",
		"word-spacing",
		"wrap",
		"writing-mode",
		"xchannelselector",
		"ychannelselector",
		"x",
		"x1",
		"x2",
		"xmlns",
		"y",
		"y1",
		"y2",
		"z",
		"zoomandpan"
	]);
	var mathMl = freeze([
		"accent",
		"accentunder",
		"align",
		"bevelled",
		"close",
		"columnalign",
		"columnlines",
		"columnspacing",
		"columnspan",
		"denomalign",
		"depth",
		"dir",
		"display",
		"displaystyle",
		"encoding",
		"fence",
		"frame",
		"height",
		"href",
		"id",
		"largeop",
		"length",
		"linethickness",
		"lquote",
		"lspace",
		"mathbackground",
		"mathcolor",
		"mathsize",
		"mathvariant",
		"maxsize",
		"minsize",
		"movablelimits",
		"notation",
		"numalign",
		"open",
		"rowalign",
		"rowlines",
		"rowspacing",
		"rowspan",
		"rspace",
		"rquote",
		"scriptlevel",
		"scriptminsize",
		"scriptsizemultiplier",
		"selection",
		"separator",
		"separators",
		"stretchy",
		"subscriptshift",
		"supscriptshift",
		"symmetric",
		"voffset",
		"width",
		"xmlns"
	]);
	var xml = freeze([
		"xlink:href",
		"xml:id",
		"xlink:title",
		"xml:space",
		"xmlns:xlink"
	]);
	var MUSTACHE_EXPR = seal(/{{[\w\W]*|^[\w\W]*}}/g);
	var ERB_EXPR = seal(/<%[\w\W]*|^[\w\W]*%>/g);
	var TMPLIT_EXPR = seal(/\${[\w\W]*/g);
	var DATA_ATTR = seal(/^data-[\-\w.\u00B7-\uFFFF]+$/);
	var ARIA_ATTR = seal(/^aria-[\-\w]+$/);
	var IS_ALLOWED_URI = seal(/^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|matrix):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i);
	var IS_SCRIPT_OR_DATA = seal(/^(?:\w+script|data):/i);
	var ATTR_WHITESPACE = seal(/[\u0000-\u0020\u00A0\u1680\u180E\u2000-\u2029\u205F\u3000]/g);
	var DOCTYPE_NAME = seal(/^html$/i);
	var CUSTOM_ELEMENT = seal(/^[a-z][.\w]*(-[.\w]+)+$/i);
	var ELEMENT_MARKUP_PROBE = seal(/<[/\w!]/g);
	var COMMENT_MARKUP_PROBE = seal(/<[/\w]/g);
	var FALLBACK_TAG_CLOSE = seal(/<\/no(script|embed|frames)/i);
	var SELF_CLOSING_TAG = seal(/\/>/i);
	var NODE_TYPE = {
		element: 1,
		attribute: 2,
		text: 3,
		cdataSection: 4,
		entityReference: 5,
		entityNode: 6,
		processingInstruction: 7,
		comment: 8,
		document: 9,
		documentType: 10,
		documentFragment: 11,
		notation: 12
	};
	var LITERAL_TEXT_ELEMENT_NAMES = [
		"style",
		"script",
		"xmp",
		"iframe",
		"noembed",
		"noframes",
		"plaintext",
		"noscript"
	];
	var LITERAL_TEXT_ELEMENTS = freeze(addToSet({}, LITERAL_TEXT_ELEMENT_NAMES));
	var LITERAL_TEXT_CLOSE = function() {
		const map = {};
		arrayForEach(LITERAL_TEXT_ELEMENT_NAMES, (name) => {
			map[name] = seal(new RegExp("</" + name + "(?=[\\t\\n\\f\\r />])", "i"));
		});
		return freeze(map);
	}();
	var getGlobal = function getGlobal() {
		return typeof window === "undefined" ? null : window;
	};
	var _createTrustedTypesPolicy = function _createTrustedTypesPolicy(trustedTypes, purifyHostElement) {
		if (typeof trustedTypes !== "object" || typeof trustedTypes.createPolicy !== "function") return null;
		let suffix = null;
		const ATTR_NAME = "data-tt-policy-suffix";
		if (purifyHostElement && purifyHostElement.hasAttribute(ATTR_NAME)) suffix = purifyHostElement.getAttribute(ATTR_NAME);
		const policyName = "dompurify" + (suffix ? "#" + suffix : "");
		try {
			return trustedTypes.createPolicy(policyName, {
				createHTML(html) {
					return html;
				},
				createScriptURL(scriptUrl) {
					return scriptUrl;
				}
			});
		} catch (_) {
			console.warn("TrustedTypes policy " + policyName + " could not be created.");
			return null;
		}
	};
	var _createHooksMap = function _createHooksMap() {
		return {
			afterSanitizeAttributes: [],
			afterSanitizeElements: [],
			afterSanitizeShadowDOM: [],
			beforeSanitizeAttributes: [],
			beforeSanitizeElements: [],
			beforeSanitizeShadowDOM: [],
			uponSanitizeAttribute: [],
			uponSanitizeElement: [],
			uponSanitizeShadowNode: []
		};
	};
	var _resolveSetOption = function _resolveSetOption(cfg, key, fallback, options) {
		return objectHasOwnProperty(cfg, key) && arrayIsArray(cfg[key]) ? addToSet(options.base ? clone(options.base) : {}, cfg[key], options.transform) : fallback;
	};
	var _resolveObjectOption = function _resolveObjectOption(cfg, key, makeFallback) {
		const value = objectHasOwnProperty(cfg, key) ? cfg[key] : void 0;
		return value && typeof value === "object" ? clone(value) : makeFallback();
	};
	function createDOMPurify() {
		let window = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : getGlobal();
		const DOMPurify = (root) => createDOMPurify(root);
		DOMPurify.version = "3.4.16";
		DOMPurify.removed = [];
		if (!window || !window.document || window.document.nodeType !== NODE_TYPE.document || !window.Element) {
			DOMPurify.isSupported = false;
			return DOMPurify;
		}
		let document = window.document;
		const originalDocument = document;
		const currentScript = originalDocument.currentScript;
		window.DocumentFragment;
		const HTMLTemplateElement = window.HTMLTemplateElement, Node = window.Node, Element = window.Element, NodeFilter = window.NodeFilter;
		window.NamedNodeMap === void 0 && (window.NamedNodeMap || window.MozNamedAttrMap);
		window.HTMLFormElement;
		const DOMParser = window.DOMParser, trustedTypes = window.trustedTypes;
		const ElementPrototype = Element.prototype;
		const cloneNode = lookupGetter(ElementPrototype, "cloneNode");
		const remove = lookupGetter(ElementPrototype, "remove");
		const removeAttributeNode = lookupGetter(ElementPrototype, "removeAttributeNode");
		const getNextSibling = lookupGetter(ElementPrototype, "nextSibling");
		const getChildNodes = lookupGetter(ElementPrototype, "childNodes");
		const getParentNode = lookupGetter(ElementPrototype, "parentNode");
		const getShadowRoot = lookupGetter(ElementPrototype, "shadowRoot");
		const getAttributes = lookupGetter(ElementPrototype, "attributes");
		const getNodeType = Node && Node.prototype ? lookupGetter(Node.prototype, "nodeType") : null;
		const getNodeName = Node && Node.prototype ? lookupGetter(Node.prototype, "nodeName") : null;
		const getOwnerDocument = Node && Node.prototype ? lookupGetter(Node.prototype, "ownerDocument") : null;
		const _readNodeType = function _readNodeType(node) {
			return getNodeType ? getNodeType(node) : node.nodeType;
		};
		const _readNodeName = function _readNodeName(node) {
			return getNodeName ? getNodeName(node) : node.nodeName;
		};
		if (typeof HTMLTemplateElement === "function") {
			const template = document.createElement("template");
			if (template.content && template.content.ownerDocument) document = template.content.ownerDocument;
		}
		let trustedTypesPolicy;
		let emptyHTML = "";
		let defaultTrustedTypesPolicy;
		let defaultTrustedTypesPolicyResolved = false;
		let IN_TRUSTED_TYPES_POLICY = 0;
		const _assertNotInTrustedTypesPolicy = function _assertNotInTrustedTypesPolicy() {
			if (IN_TRUSTED_TYPES_POLICY > 0) throw typeErrorCreate("A configured TRUSTED_TYPES_POLICY callback (createHTML or createScriptURL) must not call DOMPurify.sanitize, as that causes infinite recursion. Do not pass a policy whose callbacks wrap DOMPurify as TRUSTED_TYPES_POLICY; see the \"DOMPurify and Trusted Types\" section of the README.");
		};
		const _createTrustedHTML = function _createTrustedHTML(html) {
			_assertNotInTrustedTypesPolicy();
			IN_TRUSTED_TYPES_POLICY++;
			try {
				return trustedTypesPolicy.createHTML(html);
			} finally {
				IN_TRUSTED_TYPES_POLICY--;
			}
		};
		const _createTrustedScriptURL = function _createTrustedScriptURL(scriptUrl) {
			_assertNotInTrustedTypesPolicy();
			IN_TRUSTED_TYPES_POLICY++;
			try {
				return trustedTypesPolicy.createScriptURL(scriptUrl);
			} finally {
				IN_TRUSTED_TYPES_POLICY--;
			}
		};
		const _getDefaultTrustedTypesPolicy = function _getDefaultTrustedTypesPolicy() {
			if (!defaultTrustedTypesPolicyResolved) {
				defaultTrustedTypesPolicy = _createTrustedTypesPolicy(trustedTypes, currentScript);
				defaultTrustedTypesPolicyResolved = true;
			}
			return defaultTrustedTypesPolicy;
		};
		const _document = document, implementation = _document.implementation, createNodeIterator = _document.createNodeIterator, createDocumentFragment = _document.createDocumentFragment, getElementsByTagName = _document.getElementsByTagName;
		const importNode = originalDocument.importNode;
		let hooks = _createHooksMap();
		DOMPurify.isSupported = typeof entries === "function" && typeof getParentNode === "function" && implementation && implementation.createHTMLDocument !== void 0;
		const MUSTACHE_EXPR$1 = MUSTACHE_EXPR, ERB_EXPR$1 = ERB_EXPR, TMPLIT_EXPR$1 = TMPLIT_EXPR, DATA_ATTR$1 = DATA_ATTR, ARIA_ATTR$1 = ARIA_ATTR, IS_SCRIPT_OR_DATA$1 = IS_SCRIPT_OR_DATA, ATTR_WHITESPACE$1 = ATTR_WHITESPACE, CUSTOM_ELEMENT$1 = CUSTOM_ELEMENT;
		let IS_ALLOWED_URI$1 = IS_ALLOWED_URI;
		let ALLOWED_TAGS = null;
		const DEFAULT_ALLOWED_TAGS = addToSet({}, [
			...html$1,
			...svg$1,
			...svgFilters,
			...mathMl$1,
			...text
		]);
		let ALLOWED_ATTR = null;
		const DEFAULT_ALLOWED_ATTR = addToSet({}, [
			...html,
			...svg,
			...mathMl,
			...xml
		]);
		let CUSTOM_ELEMENT_HANDLING = Object.seal(create(null, {
			tagNameCheck: {
				writable: true,
				configurable: false,
				enumerable: true,
				value: null
			},
			attributeNameCheck: {
				writable: true,
				configurable: false,
				enumerable: true,
				value: null
			},
			allowCustomizedBuiltInElements: {
				writable: true,
				configurable: false,
				enumerable: true,
				value: false
			}
		}));
		let FORBID_TAGS = null;
		let FORBID_ATTR = null;
		const EXTRA_ELEMENT_HANDLING = Object.seal(create(null, {
			tagCheck: {
				writable: true,
				configurable: false,
				enumerable: true,
				value: null
			},
			attributeCheck: {
				writable: true,
				configurable: false,
				enumerable: true,
				value: null
			}
		}));
		let ALLOW_ARIA_ATTR = true;
		let ALLOW_DATA_ATTR = true;
		let ALLOW_UNKNOWN_PROTOCOLS = false;
		let ALLOW_SELF_CLOSE_IN_ATTR = true;
		let SAFE_FOR_TEMPLATES = false;
		let SAFE_FOR_XML = true;
		let WHOLE_DOCUMENT = false;
		let SET_CONFIG = false;
		let SET_CONFIG_ALLOWED_TAGS = null;
		let SET_CONFIG_ALLOWED_ATTR = null;
		let FORCE_BODY = false;
		let RETURN_DOM = false;
		let RETURN_DOM_FRAGMENT = false;
		let RETURN_TRUSTED_TYPE = false;
		let SANITIZE_DOM = true;
		let SANITIZE_NAMED_PROPS = false;
		const SANITIZE_NAMED_PROPS_PREFIX = "user-content-";
		let KEEP_CONTENT = true;
		let IN_PLACE = false;
		let USE_PROFILES = {};
		let FORBID_CONTENTS = null;
		const DEFAULT_FORBID_CONTENTS = addToSet({}, [
			"annotation-xml",
			"audio",
			"colgroup",
			"desc",
			"foreignobject",
			"head",
			"iframe",
			"math",
			"mi",
			"mn",
			"mo",
			"ms",
			"mtext",
			"noembed",
			"noframes",
			"noscript",
			"plaintext",
			"script",
			"selectedcontent",
			"style",
			"svg",
			"template",
			"thead",
			"title",
			"video",
			"xmp"
		]);
		let DATA_URI_TAGS = null;
		const DEFAULT_DATA_URI_TAGS = addToSet({}, [
			"audio",
			"video",
			"img",
			"source",
			"image",
			"track"
		]);
		let URI_SAFE_ATTRIBUTES = null;
		const DEFAULT_URI_SAFE_ATTRIBUTES = addToSet({}, [
			"alt",
			"class",
			"for",
			"id",
			"label",
			"name",
			"pattern",
			"placeholder",
			"role",
			"summary",
			"title",
			"value",
			"style",
			"xmlns"
		]);
		const MATHML_NAMESPACE = "http://www.w3.org/1998/Math/MathML";
		const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
		const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";
		let NAMESPACE = HTML_NAMESPACE;
		let IS_EMPTY_INPUT = false;
		let ALLOWED_NAMESPACES = null;
		const DEFAULT_ALLOWED_NAMESPACES = addToSet({}, [
			MATHML_NAMESPACE,
			SVG_NAMESPACE,
			HTML_NAMESPACE
		], stringToString);
		const DEFAULT_MATHML_TEXT_INTEGRATION_POINTS = freeze([
			"mi",
			"mo",
			"mn",
			"ms",
			"mtext"
		]);
		let MATHML_TEXT_INTEGRATION_POINTS = addToSet({}, DEFAULT_MATHML_TEXT_INTEGRATION_POINTS);
		const DEFAULT_HTML_INTEGRATION_POINTS = freeze(["annotation-xml"]);
		let HTML_INTEGRATION_POINTS = addToSet({}, DEFAULT_HTML_INTEGRATION_POINTS);
		const COMMON_SVG_AND_HTML_ELEMENTS = addToSet({}, [
			"title",
			"style",
			"font",
			"a",
			"script"
		]);
		let PARSER_MEDIA_TYPE = null;
		const SUPPORTED_PARSER_MEDIA_TYPES = ["application/xhtml+xml", "text/html"];
		const DEFAULT_PARSER_MEDIA_TYPE = "text/html";
		let transformCaseFunc = null;
		let CONFIG = null;
		const formElement = document.createElement("form");
		const isRegexOrFunction = function isRegexOrFunction(testValue) {
			return testValue instanceof RegExp || testValue instanceof Function;
		};
		const _parseConfig = function _parseConfig() {
			let cfg = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : {};
			if (CONFIG && CONFIG === cfg) return;
			if (!cfg || typeof cfg !== "object") cfg = {};
			cfg = clone(cfg);
			PARSER_MEDIA_TYPE = SUPPORTED_PARSER_MEDIA_TYPES.indexOf(cfg.PARSER_MEDIA_TYPE) === -1 ? DEFAULT_PARSER_MEDIA_TYPE : cfg.PARSER_MEDIA_TYPE;
			transformCaseFunc = PARSER_MEDIA_TYPE === "application/xhtml+xml" ? stringToString : stringToLowerCase;
			ALLOWED_TAGS = _resolveSetOption(cfg, "ALLOWED_TAGS", DEFAULT_ALLOWED_TAGS, { transform: transformCaseFunc });
			ALLOWED_ATTR = _resolveSetOption(cfg, "ALLOWED_ATTR", DEFAULT_ALLOWED_ATTR, { transform: transformCaseFunc });
			ALLOWED_NAMESPACES = _resolveSetOption(cfg, "ALLOWED_NAMESPACES", DEFAULT_ALLOWED_NAMESPACES, { transform: stringToString });
			URI_SAFE_ATTRIBUTES = _resolveSetOption(cfg, "ADD_URI_SAFE_ATTR", DEFAULT_URI_SAFE_ATTRIBUTES, {
				transform: transformCaseFunc,
				base: DEFAULT_URI_SAFE_ATTRIBUTES
			});
			DATA_URI_TAGS = _resolveSetOption(cfg, "ADD_DATA_URI_TAGS", DEFAULT_DATA_URI_TAGS, {
				transform: transformCaseFunc,
				base: DEFAULT_DATA_URI_TAGS
			});
			FORBID_CONTENTS = _resolveSetOption(cfg, "FORBID_CONTENTS", DEFAULT_FORBID_CONTENTS, { transform: transformCaseFunc });
			FORBID_TAGS = _resolveSetOption(cfg, "FORBID_TAGS", clone({}), { transform: transformCaseFunc });
			FORBID_ATTR = _resolveSetOption(cfg, "FORBID_ATTR", clone({}), { transform: transformCaseFunc });
			USE_PROFILES = objectHasOwnProperty(cfg, "USE_PROFILES") ? cfg.USE_PROFILES && typeof cfg.USE_PROFILES === "object" ? clone(cfg.USE_PROFILES) : cfg.USE_PROFILES : false;
			ALLOW_ARIA_ATTR = cfg.ALLOW_ARIA_ATTR !== false;
			ALLOW_DATA_ATTR = cfg.ALLOW_DATA_ATTR !== false;
			ALLOW_UNKNOWN_PROTOCOLS = cfg.ALLOW_UNKNOWN_PROTOCOLS || false;
			ALLOW_SELF_CLOSE_IN_ATTR = cfg.ALLOW_SELF_CLOSE_IN_ATTR !== false;
			SAFE_FOR_TEMPLATES = cfg.SAFE_FOR_TEMPLATES || false;
			SAFE_FOR_XML = cfg.SAFE_FOR_XML !== false;
			WHOLE_DOCUMENT = cfg.WHOLE_DOCUMENT || false;
			RETURN_DOM = cfg.RETURN_DOM || false;
			RETURN_DOM_FRAGMENT = cfg.RETURN_DOM_FRAGMENT || false;
			RETURN_TRUSTED_TYPE = cfg.RETURN_TRUSTED_TYPE || false;
			FORCE_BODY = cfg.FORCE_BODY || false;
			SANITIZE_DOM = cfg.SANITIZE_DOM !== false;
			SANITIZE_NAMED_PROPS = cfg.SANITIZE_NAMED_PROPS || false;
			KEEP_CONTENT = cfg.KEEP_CONTENT !== false;
			IN_PLACE = cfg.IN_PLACE || false;
			IS_ALLOWED_URI$1 = isRegex(cfg.ALLOWED_URI_REGEXP) ? cfg.ALLOWED_URI_REGEXP : IS_ALLOWED_URI;
			NAMESPACE = typeof cfg.NAMESPACE === "string" ? cfg.NAMESPACE : HTML_NAMESPACE;
			MATHML_TEXT_INTEGRATION_POINTS = _resolveObjectOption(cfg, "MATHML_TEXT_INTEGRATION_POINTS", () => addToSet({}, DEFAULT_MATHML_TEXT_INTEGRATION_POINTS));
			HTML_INTEGRATION_POINTS = _resolveObjectOption(cfg, "HTML_INTEGRATION_POINTS", () => addToSet({}, DEFAULT_HTML_INTEGRATION_POINTS));
			const customElementHandling = _resolveObjectOption(cfg, "CUSTOM_ELEMENT_HANDLING", () => create(null));
			CUSTOM_ELEMENT_HANDLING = create(null);
			if (objectHasOwnProperty(customElementHandling, "tagNameCheck") && isRegexOrFunction(customElementHandling.tagNameCheck)) CUSTOM_ELEMENT_HANDLING.tagNameCheck = customElementHandling.tagNameCheck;
			if (objectHasOwnProperty(customElementHandling, "attributeNameCheck") && isRegexOrFunction(customElementHandling.attributeNameCheck)) CUSTOM_ELEMENT_HANDLING.attributeNameCheck = customElementHandling.attributeNameCheck;
			if (objectHasOwnProperty(customElementHandling, "allowCustomizedBuiltInElements") && typeof customElementHandling.allowCustomizedBuiltInElements === "boolean") CUSTOM_ELEMENT_HANDLING.allowCustomizedBuiltInElements = customElementHandling.allowCustomizedBuiltInElements;
			seal(CUSTOM_ELEMENT_HANDLING);
			if (SAFE_FOR_TEMPLATES) ALLOW_DATA_ATTR = false;
			if (RETURN_DOM_FRAGMENT) RETURN_DOM = true;
			if (USE_PROFILES) {
				ALLOWED_TAGS = addToSet({}, text);
				ALLOWED_ATTR = create(null);
				if (USE_PROFILES.html === true) {
					addToSet(ALLOWED_TAGS, html$1);
					addToSet(ALLOWED_ATTR, html);
				}
				if (USE_PROFILES.svg === true) {
					addToSet(ALLOWED_TAGS, svg$1);
					addToSet(ALLOWED_ATTR, svg);
					addToSet(ALLOWED_ATTR, xml);
				}
				if (USE_PROFILES.svgFilters === true) {
					addToSet(ALLOWED_TAGS, svgFilters);
					addToSet(ALLOWED_ATTR, svg);
					addToSet(ALLOWED_ATTR, xml);
				}
				if (USE_PROFILES.mathMl === true) {
					addToSet(ALLOWED_TAGS, mathMl$1);
					addToSet(ALLOWED_ATTR, mathMl);
					addToSet(ALLOWED_ATTR, xml);
				}
			}
			EXTRA_ELEMENT_HANDLING.tagCheck = null;
			EXTRA_ELEMENT_HANDLING.attributeCheck = null;
			if (objectHasOwnProperty(cfg, "ADD_TAGS")) {
				if (typeof cfg.ADD_TAGS === "function") EXTRA_ELEMENT_HANDLING.tagCheck = cfg.ADD_TAGS;
				else if (arrayIsArray(cfg.ADD_TAGS)) {
					if (ALLOWED_TAGS === DEFAULT_ALLOWED_TAGS) ALLOWED_TAGS = clone(ALLOWED_TAGS);
					addToSet(ALLOWED_TAGS, cfg.ADD_TAGS, transformCaseFunc);
				}
			}
			if (objectHasOwnProperty(cfg, "ADD_ATTR")) {
				if (typeof cfg.ADD_ATTR === "function") EXTRA_ELEMENT_HANDLING.attributeCheck = cfg.ADD_ATTR;
				else if (arrayIsArray(cfg.ADD_ATTR)) {
					if (ALLOWED_ATTR === DEFAULT_ALLOWED_ATTR) ALLOWED_ATTR = clone(ALLOWED_ATTR);
					addToSet(ALLOWED_ATTR, cfg.ADD_ATTR, transformCaseFunc);
				}
			}
			if (objectHasOwnProperty(cfg, "ADD_FORBID_CONTENTS") && arrayIsArray(cfg.ADD_FORBID_CONTENTS)) {
				if (FORBID_CONTENTS === DEFAULT_FORBID_CONTENTS) FORBID_CONTENTS = clone(FORBID_CONTENTS);
				addToSet(FORBID_CONTENTS, cfg.ADD_FORBID_CONTENTS, transformCaseFunc);
			}
			if (KEEP_CONTENT) ALLOWED_TAGS["#text"] = true;
			if (WHOLE_DOCUMENT) addToSet(ALLOWED_TAGS, [
				"html",
				"head",
				"body"
			]);
			if (ALLOWED_TAGS.table) {
				addToSet(ALLOWED_TAGS, ["tbody"]);
				delete FORBID_TAGS.tbody;
			}
			if (cfg.TRUSTED_TYPES_POLICY) {
				if (typeof cfg.TRUSTED_TYPES_POLICY.createHTML !== "function") throw typeErrorCreate("TRUSTED_TYPES_POLICY configuration option must provide a \"createHTML\" hook.");
				if (typeof cfg.TRUSTED_TYPES_POLICY.createScriptURL !== "function") throw typeErrorCreate("TRUSTED_TYPES_POLICY configuration option must provide a \"createScriptURL\" hook.");
				const previousTrustedTypesPolicy = trustedTypesPolicy;
				trustedTypesPolicy = cfg.TRUSTED_TYPES_POLICY;
				try {
					emptyHTML = _createTrustedHTML("");
				} catch (error) {
					trustedTypesPolicy = previousTrustedTypesPolicy;
					throw error;
				}
			} else if (cfg.TRUSTED_TYPES_POLICY === null) {
				trustedTypesPolicy = void 0;
				emptyHTML = "";
			} else {
				if (trustedTypesPolicy === void 0) trustedTypesPolicy = _getDefaultTrustedTypesPolicy();
				if (trustedTypesPolicy && typeof emptyHTML === "string") emptyHTML = _createTrustedHTML("");
			}
			if (freeze) freeze(cfg);
			CONFIG = cfg;
		};
		const ALL_SVG_TAGS = addToSet({}, [
			...svg$1,
			...svgFilters,
			...svgDisallowed
		]);
		const ALL_MATHML_TAGS = addToSet({}, [...mathMl$1, ...mathMlDisallowed]);
		const _checkSvgNamespace = function _checkSvgNamespace(tagName, parent, parentTagName) {
			if (parent.namespaceURI === HTML_NAMESPACE) return tagName === "svg";
			if (parent.namespaceURI === MATHML_NAMESPACE) return tagName === "svg" && (parentTagName === "annotation-xml" || MATHML_TEXT_INTEGRATION_POINTS[parentTagName]);
			return Boolean(ALL_SVG_TAGS[tagName]);
		};
		const _checkMathMlNamespace = function _checkMathMlNamespace(tagName, parent, parentTagName) {
			if (parent.namespaceURI === HTML_NAMESPACE) return tagName === "math";
			if (parent.namespaceURI === SVG_NAMESPACE) return tagName === "math" && HTML_INTEGRATION_POINTS[parentTagName];
			return Boolean(ALL_MATHML_TAGS[tagName]);
		};
		const _checkHtmlNamespace = function _checkHtmlNamespace(tagName, parent, parentTagName) {
			if (parent.namespaceURI === SVG_NAMESPACE && !HTML_INTEGRATION_POINTS[parentTagName]) return false;
			if (parent.namespaceURI === MATHML_NAMESPACE && !MATHML_TEXT_INTEGRATION_POINTS[parentTagName]) return false;
			return !ALL_MATHML_TAGS[tagName] && (COMMON_SVG_AND_HTML_ELEMENTS[tagName] || !ALL_SVG_TAGS[tagName]);
		};
		const _checkValidNamespace = function _checkValidNamespace(element) {
			let parent = getParentNode(element);
			if (!parent || !parent.tagName) parent = {
				namespaceURI: NAMESPACE,
				tagName: "template"
			};
			const tagName = stringToLowerCase(element.tagName);
			const parentTagName = stringToLowerCase(parent.tagName);
			if (!ALLOWED_NAMESPACES[element.namespaceURI]) return false;
			if (element.namespaceURI === SVG_NAMESPACE) return _checkSvgNamespace(tagName, parent, parentTagName);
			if (element.namespaceURI === MATHML_NAMESPACE) return _checkMathMlNamespace(tagName, parent, parentTagName);
			if (element.namespaceURI === HTML_NAMESPACE) return _checkHtmlNamespace(tagName, parent, parentTagName);
			if (PARSER_MEDIA_TYPE === "application/xhtml+xml" && ALLOWED_NAMESPACES[element.namespaceURI]) return true;
			return false;
		};
		const _forceRemove = function _forceRemove(node) {
			arrayPush(DOMPurify.removed, { element: node });
			try {
				getParentNode(node).removeChild(node);
			} catch (_) {
				remove(node);
				if (!getParentNode(node)) throw typeErrorCreate("a node selected for removal could not be detached from its tree and cannot be safely returned; refusing to sanitize in place");
			}
		};
		const _stripAttributeNode = function _stripAttributeNode(element, attribute, name) {
			try {
				removeAttributeNode(element, attribute);
			} catch (_) {
				try {
					element.removeAttribute(name);
				} catch (_) {}
			}
		};
		const _neutralizeRoot = function _neutralizeRoot(root) {
			_neutralizeSubtree(root);
			const childNodes = getChildNodes(root);
			if (childNodes) {
				const snapshot = [];
				arrayForEach(childNodes, (child) => {
					arrayPush(snapshot, child);
				});
				arrayForEach(snapshot, (child) => {
					try {
						remove(child);
					} catch (_) {}
				});
			}
			const attributes = getAttributes(root);
			if (attributes) for (let i = attributes.length - 1; i >= 0; --i) {
				const attribute = attributes[i];
				const name = attribute && attribute.name;
				if (typeof name === "string") _stripAttributeNode(root, attribute, name);
			}
		};
		const _removeAttribute = function _removeAttribute(name, element, attr) {
			if (!attr) try {
				attr = element.getAttributeNode(name);
			} catch (_) {
				attr = null;
			}
			arrayPush(DOMPurify.removed, {
				attribute: attr || null,
				from: element
			});
			try {
				if (attr) removeAttributeNode(element, attr);
				else element.removeAttribute(name);
			} catch (_) {
				try {
					element.removeAttribute(name);
				} catch (_) {}
			}
			if (name === "is") {
				if (RETURN_DOM || RETURN_DOM_FRAGMENT) try {
					_forceRemove(element);
				} catch (_) {}
				else try {
					element.setAttribute(name, "");
				} catch (_) {}
			}
		};
		const _stripDisallowedAttributes = function _stripDisallowedAttributes(element) {
			const attributes = getAttributes(element);
			if (!attributes) return;
			for (let i = attributes.length - 1; i >= 0; --i) {
				const attribute = attributes[i];
				const name = attribute && attribute.name;
				if (typeof name !== "string" || ALLOWED_ATTR[transformCaseFunc(name)]) continue;
				_stripAttributeNode(element, attribute, name);
			}
		};
		const _neutralizeSubtree = function _neutralizeSubtree(root) {
			const stack = [root];
			while (stack.length > 0) {
				const node = stack.pop();
				if (_readNodeType(node) === NODE_TYPE.element) _stripDisallowedAttributes(node);
				const childNodes = getChildNodes(node);
				if (childNodes) for (let i = childNodes.length - 1; i >= 0; --i) stack.push(childNodes[i]);
			}
		};
		const _isPatchLinkageAttribute = function _isPatchLinkageAttribute(lcName, lcTag) {
			if (!SAFE_FOR_XML) return false;
			if (lcName === "patchsrc") return true;
			return lcName === "for" && lcTag !== "label" && lcTag !== "output";
		};
		const _neutralizePatchLinkage = function _neutralizePatchLinkage(root) {
			if (!SAFE_FOR_XML) return;
			const stack = [root];
			while (stack.length > 0) {
				const node = stack.pop();
				const nodeType = _readNodeType(node);
				if (nodeType === NODE_TYPE.processingInstruction || nodeType === NODE_TYPE.comment && regExpTest(COMMENT_MARKUP_PROBE, node.data)) {
					try {
						remove(node);
					} catch (_) {}
					continue;
				}
				if (nodeType === NODE_TYPE.element) {
					const element = node;
					const lcTag = transformCaseFunc(_readNodeName(node));
					try {
						if (element.hasAttribute && element.hasAttribute("patchsrc")) element.removeAttribute("patchsrc");
						if (element.hasAttribute && element.hasAttribute("for") && _isPatchLinkageAttribute("for", lcTag)) element.removeAttribute("for");
					} catch (_) {}
				}
				const childNodes = getChildNodes(node);
				if (childNodes) for (let i = childNodes.length - 1; i >= 0; --i) stack.push(childNodes[i]);
			}
		};
		const _initDocument = function _initDocument(dirty) {
			let doc = null;
			let leadingWhitespace = null;
			if (FORCE_BODY) dirty = "<remove></remove>" + dirty;
			else {
				const matches = stringMatch(dirty, /^[\r\n\t ]+/);
				leadingWhitespace = matches && matches[0];
			}
			if (PARSER_MEDIA_TYPE === "application/xhtml+xml" && NAMESPACE === HTML_NAMESPACE) dirty = "<html xmlns=\"http://www.w3.org/1999/xhtml\"><head></head><body>" + dirty + "</body></html>";
			const dirtyPayload = trustedTypesPolicy ? _createTrustedHTML(dirty) : dirty;
			if (NAMESPACE === HTML_NAMESPACE) try {
				doc = new DOMParser().parseFromString(dirtyPayload, PARSER_MEDIA_TYPE);
			} catch (_) {}
			if (!doc || !doc.documentElement) {
				doc = implementation.createDocument(NAMESPACE, "template", null);
				try {
					doc.documentElement.innerHTML = IS_EMPTY_INPUT ? emptyHTML : dirtyPayload;
				} catch (_) {}
			}
			const body = doc.body || doc.documentElement;
			if (dirty && leadingWhitespace) body.insertBefore(document.createTextNode(leadingWhitespace), body.childNodes[0] || null);
			if (NAMESPACE === HTML_NAMESPACE) return getElementsByTagName.call(doc, WHOLE_DOCUMENT ? "html" : "body")[0];
			return WHOLE_DOCUMENT ? doc.documentElement : body;
		};
		const _createNodeIterator = function _createNodeIterator(root) {
			const doc = getOwnerDocument ? getOwnerDocument(root) : root.ownerDocument;
			return createNodeIterator.call(doc || root, root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_COMMENT | NodeFilter.SHOW_TEXT | NodeFilter.SHOW_PROCESSING_INSTRUCTION | NodeFilter.SHOW_CDATA_SECTION, null);
		};
		const _stripTemplateExpressions = function _stripTemplateExpressions(value) {
			value = stringReplace(value, MUSTACHE_EXPR$1, " ");
			value = stringReplace(value, ERB_EXPR$1, " ");
			value = stringReplace(value, TMPLIT_EXPR$1, " ");
			return value;
		};
		const _scrubTemplateExpressions2 = function _scrubTemplateExpressions(node) {
			var _node$querySelectorAl;
			node.normalize();
			const doc = getOwnerDocument ? getOwnerDocument(node) : node.ownerDocument;
			const walker = createNodeIterator.call(doc || node, node, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_COMMENT | NodeFilter.SHOW_CDATA_SECTION | NodeFilter.SHOW_PROCESSING_INSTRUCTION, null);
			let currentNode = walker.nextNode();
			while (currentNode) {
				currentNode.data = _stripTemplateExpressions(currentNode.data);
				currentNode = walker.nextNode();
			}
			const templates = (_node$querySelectorAl = node.querySelectorAll) === null || _node$querySelectorAl === void 0 ? void 0 : _node$querySelectorAl.call(node, "template");
			if (templates) arrayForEach(templates, (tmpl) => {
				if (_isDocumentFragment(tmpl.content)) _scrubTemplateExpressions2(tmpl.content);
			});
		};
		const _isClobbered = function _isClobbered(element) {
			const realTagName = getNodeName ? getNodeName(element) : null;
			if (typeof realTagName !== "string") return false;
			if (transformCaseFunc(realTagName) !== "form") return false;
			return typeof element.nodeName !== "string" || typeof element.textContent !== "string" || typeof element.removeChild !== "function" || element.attributes !== getAttributes(element) || typeof element.removeAttribute !== "function" || typeof element.removeAttributeNode !== "function" || typeof element.getAttributeNode !== "function" || typeof element.setAttribute !== "function" || typeof element.namespaceURI !== "string" || typeof element.insertBefore !== "function" || typeof element.hasChildNodes !== "function" || element.nodeType !== getNodeType(element) || element.childNodes !== getChildNodes(element);
		};
		const _isDocumentFragment = function _isDocumentFragment(value) {
			if (!getNodeType || typeof value !== "object" || value === null) return false;
			try {
				return getNodeType(value) === NODE_TYPE.documentFragment;
			} catch (_) {
				return false;
			}
		};
		const _isNode = function _isNode(value) {
			if (!getNodeType || typeof value !== "object" || value === null) return false;
			try {
				return typeof getNodeType(value) === "number";
			} catch (_) {
				return false;
			}
		};
		function _executeHooks(hooks, currentNode, data) {
			if (hooks.length === 0) return;
			arrayForEach(hooks, (hook) => {
				hook.call(DOMPurify, currentNode, data, CONFIG);
			});
		}
		const _isUnsafeNode = function _isUnsafeNode(currentNode, tagName) {
			if (SAFE_FOR_XML && currentNode.hasChildNodes() && !_isNode(currentNode.firstElementChild) && regExpTest(ELEMENT_MARKUP_PROBE, currentNode.textContent) && regExpTest(ELEMENT_MARKUP_PROBE, currentNode.innerHTML)) return true;
			if (SAFE_FOR_XML && currentNode.namespaceURI === HTML_NAMESPACE && LITERAL_TEXT_ELEMENTS[tagName] && (_isNode(currentNode.firstElementChild) || typeof currentNode.textContent === "string" && regExpTest(LITERAL_TEXT_CLOSE[tagName], currentNode.textContent))) return true;
			if (currentNode.nodeType === NODE_TYPE.processingInstruction) return true;
			if (SAFE_FOR_XML && currentNode.nodeType === NODE_TYPE.comment && regExpTest(COMMENT_MARKUP_PROBE, currentNode.data)) return true;
			return false;
		};
		const _matchesNameCheck = function _matchesNameCheck(check, name) {
			if (check instanceof RegExp) return regExpTest(check, name);
			if (check instanceof Function) {
				for (var _len = arguments.length, args = new Array(_len > 2 ? _len - 2 : 0), _key = 2; _key < _len; _key++) args[_key - 2] = arguments[_key];
				return Boolean(check(name, ...args));
			}
			return false;
		};
		const _sanitizeDisallowedNode = function _sanitizeDisallowedNode(currentNode, tagName, root) {
			if (!FORBID_TAGS[tagName] && _isBasicCustomElement(tagName) && _matchesNameCheck(CUSTOM_ELEMENT_HANDLING.tagNameCheck, tagName)) return false;
			if (KEEP_CONTENT && !FORBID_CONTENTS[tagName]) {
				const parentNode = getParentNode(currentNode);
				const childNodes = getChildNodes(currentNode);
				if (childNodes && parentNode) {
					const childCount = childNodes.length;
					for (let i = childCount - 1; i >= 0; --i) {
						const hoisted = currentNode === root ? cloneNode(childNodes[i], true) : childNodes[i];
						parentNode.insertBefore(hoisted, getNextSibling(currentNode));
					}
				}
			}
			_forceRemove(currentNode);
			return true;
		};
		const _forkSharedAllowlist = function _forkSharedAllowlist(hookList, set, defaultSet, setConfigSet) {
			if (hookList.length === 0) return set;
			return set === defaultSet || set === setConfigSet ? clone(set) : set;
		};
		const _handleHookDetachedNode = function _handleHookDetachedNode(currentNode, root) {
			if (currentNode === root || getParentNode(currentNode) !== null) return false;
			if (IN_PLACE) _neutralizeSubtree(currentNode);
			return true;
		};
		const _sanitizeElements = function _sanitizeElements(currentNode, root) {
			_executeHooks(hooks.beforeSanitizeElements, currentNode, null);
			if (_handleHookDetachedNode(currentNode, root)) return true;
			if (_isClobbered(currentNode)) {
				_forceRemove(currentNode);
				return true;
			}
			const tagName = transformCaseFunc(_readNodeName(currentNode));
			ALLOWED_TAGS = _forkSharedAllowlist(hooks.uponSanitizeElement, ALLOWED_TAGS, DEFAULT_ALLOWED_TAGS, SET_CONFIG_ALLOWED_TAGS);
			_executeHooks(hooks.uponSanitizeElement, currentNode, {
				tagName,
				allowedTags: ALLOWED_TAGS
			});
			if (_handleHookDetachedNode(currentNode, root)) return true;
			if (_isUnsafeNode(currentNode, tagName)) {
				_forceRemove(currentNode);
				return true;
			}
			if (FORBID_TAGS[tagName] || !(EXTRA_ELEMENT_HANDLING.tagCheck instanceof Function && EXTRA_ELEMENT_HANDLING.tagCheck(tagName)) && !ALLOWED_TAGS[tagName]) {
				const removed = _sanitizeDisallowedNode(currentNode, tagName, root);
				if (removed === false) {
					_executeHooks(hooks.afterSanitizeElements, currentNode, null);
					if (_handleHookDetachedNode(currentNode, root)) return true;
				}
				return removed;
			}
			if (_readNodeType(currentNode) === NODE_TYPE.element && !_checkValidNamespace(currentNode)) {
				_forceRemove(currentNode);
				return true;
			}
			if ((tagName === "noscript" || tagName === "noembed" || tagName === "noframes") && regExpTest(FALLBACK_TAG_CLOSE, currentNode.innerHTML)) {
				_forceRemove(currentNode);
				return true;
			}
			if (SAFE_FOR_TEMPLATES && currentNode.nodeType === NODE_TYPE.text) {
				const content = _stripTemplateExpressions(currentNode.textContent);
				if (currentNode.textContent !== content) {
					arrayPush(DOMPurify.removed, { element: currentNode.cloneNode() });
					currentNode.textContent = content;
				}
			}
			_executeHooks(hooks.afterSanitizeElements, currentNode, null);
			return _handleHookDetachedNode(currentNode, root);
		};
		const _isValidAttribute = function _isValidAttribute(lcTag, lcName, value) {
			if (FORBID_ATTR[lcName]) return false;
			if (_isPatchLinkageAttribute(lcName, lcTag)) return false;
			if (SANITIZE_DOM && (lcName === "id" || lcName === "name") && (value in document || value in formElement)) return false;
			const nameIsPermitted = ALLOWED_ATTR[lcName] || EXTRA_ELEMENT_HANDLING.attributeCheck instanceof Function && EXTRA_ELEMENT_HANDLING.attributeCheck(lcName, lcTag);
			if (ALLOW_DATA_ATTR && regExpTest(DATA_ATTR$1, lcName)) return true;
			if (ALLOW_ARIA_ATTR && regExpTest(ARIA_ATTR$1, lcName)) return true;
			if (!nameIsPermitted) return _isBasicCustomElement(lcTag) && _matchesNameCheck(CUSTOM_ELEMENT_HANDLING.tagNameCheck, lcTag) && _matchesNameCheck(CUSTOM_ELEMENT_HANDLING.attributeNameCheck, lcName, lcTag) || lcName === "is" && CUSTOM_ELEMENT_HANDLING.allowCustomizedBuiltInElements && _matchesNameCheck(CUSTOM_ELEMENT_HANDLING.tagNameCheck, value);
			if (URI_SAFE_ATTRIBUTES[lcName]) return true;
			if (regExpTest(IS_ALLOWED_URI$1, stringReplace(value, ATTR_WHITESPACE$1, ""))) return true;
			if ((lcName === "src" || lcName === "xlink:href" || lcName === "href") && lcTag !== "script" && stringIndexOf(value, "data:") === 0 && DATA_URI_TAGS[lcTag]) return true;
			if (ALLOW_UNKNOWN_PROTOCOLS && !regExpTest(IS_SCRIPT_OR_DATA$1, stringReplace(value, ATTR_WHITESPACE$1, ""))) return true;
			return !value;
		};
		const RESERVED_CUSTOM_ELEMENT_NAMES = addToSet({}, [
			"annotation-xml",
			"color-profile",
			"font-face",
			"font-face-format",
			"font-face-name",
			"font-face-src",
			"font-face-uri",
			"missing-glyph"
		]);
		const _isBasicCustomElement = function _isBasicCustomElement(tagName) {
			return !RESERVED_CUSTOM_ELEMENT_NAMES[stringToLowerCase(tagName)] && regExpTest(CUSTOM_ELEMENT$1, tagName);
		};
		const _applyTrustedTypesToAttribute = function _applyTrustedTypesToAttribute(lcTag, lcName, namespaceURI, value) {
			if (trustedTypesPolicy && typeof trustedTypes === "object" && typeof trustedTypes.getAttributeType === "function" && !namespaceURI) switch (trustedTypes.getAttributeType(lcTag, lcName)) {
				case "TrustedHTML": return _createTrustedHTML(value);
				case "TrustedScriptURL": return _createTrustedScriptURL(value);
			}
			return value;
		};
		const _setAttributeValue = function _setAttributeValue(currentNode, name, namespaceURI, value) {
			try {
				if (namespaceURI) currentNode.setAttributeNS(namespaceURI, name, value);
				else currentNode.setAttribute(name, value);
				if (_isClobbered(currentNode)) {
					_forceRemove(currentNode);
					return false;
				}
				return true;
			} catch (_) {
				_removeAttribute(name, currentNode);
				return false;
			}
		};
		const _sanitizeAttributes = function _sanitizeAttributes(currentNode, root) {
			_executeHooks(hooks.beforeSanitizeAttributes, currentNode, null);
			if (_handleHookDetachedNode(currentNode, root)) return;
			const attributes = currentNode.attributes;
			if (!attributes || _isClobbered(currentNode)) return;
			ALLOWED_ATTR = _forkSharedAllowlist(hooks.uponSanitizeAttribute, ALLOWED_ATTR, DEFAULT_ALLOWED_ATTR, SET_CONFIG_ALLOWED_ATTR);
			const hookEvent = {
				attrName: "",
				attrValue: "",
				keepAttr: true,
				allowedAttributes: ALLOWED_ATTR,
				forceKeepAttr: void 0
			};
			let l = attributes.length;
			const lcTag = transformCaseFunc(currentNode.nodeName);
			while (l--) {
				const attr = attributes[l];
				const name = attr.name, namespaceURI = attr.namespaceURI, attrValue = attr.value;
				const lcName = transformCaseFunc(name);
				const initValue = attrValue;
				let value = name === "value" ? initValue : stringTrim(initValue);
				let recreatedNamedProp = false;
				hookEvent.attrName = lcName;
				hookEvent.attrValue = value;
				hookEvent.keepAttr = true;
				hookEvent.forceKeepAttr = void 0;
				_executeHooks(hooks.uponSanitizeAttribute, currentNode, hookEvent);
				value = hookEvent.attrValue;
				if (SANITIZE_NAMED_PROPS && (lcName === "id" || lcName === "name") && stringIndexOf(value, SANITIZE_NAMED_PROPS_PREFIX) !== 0) {
					_removeAttribute(name, currentNode, attr);
					value = SANITIZE_NAMED_PROPS_PREFIX + value;
					recreatedNamedProp = true;
				}
				if (SAFE_FOR_XML && regExpTest(/((--!?|])>)|<\/(style|script|title|xmp|textarea|noscript|iframe|noembed|noframes)/i, value)) {
					_removeAttribute(name, currentNode, attr);
					continue;
				}
				if (lcName === "attributename" && stringMatch(value, "href")) {
					_removeAttribute(name, currentNode, attr);
					continue;
				}
				if (hookEvent.forceKeepAttr) continue;
				if (!hookEvent.keepAttr) {
					_removeAttribute(name, currentNode, attr);
					continue;
				}
				if (!ALLOW_SELF_CLOSE_IN_ATTR && regExpTest(SELF_CLOSING_TAG, value)) {
					_removeAttribute(name, currentNode, attr);
					continue;
				}
				if (SAFE_FOR_TEMPLATES) value = _stripTemplateExpressions(value);
				if (!_isValidAttribute(lcTag, lcName, value)) {
					_removeAttribute(name, currentNode, attr);
					continue;
				}
				value = _applyTrustedTypesToAttribute(lcTag, lcName, namespaceURI, value);
				if (value !== initValue) {
					if (_setAttributeValue(currentNode, name, namespaceURI, value) && recreatedNamedProp) arrayPop(DOMPurify.removed);
				}
			}
			_executeHooks(hooks.afterSanitizeAttributes, currentNode, null);
			_handleHookDetachedNode(currentNode, root);
		};
		const _sanitizeShadowDOM2 = function _sanitizeShadowDOM(fragment) {
			let shadowNode = null;
			const shadowIterator = _createNodeIterator(fragment);
			_executeHooks(hooks.beforeSanitizeShadowDOM, fragment, null);
			while (shadowNode = shadowIterator.nextNode()) {
				_executeHooks(hooks.uponSanitizeShadowNode, shadowNode, null);
				_sanitizeElements(shadowNode, fragment);
				_sanitizeAttributes(shadowNode, fragment);
				if (_isDocumentFragment(shadowNode.content)) _sanitizeShadowDOM2(shadowNode.content);
				if (_readNodeType(shadowNode) === NODE_TYPE.element) {
					const innerSr = getShadowRoot(shadowNode);
					if (_isDocumentFragment(innerSr)) {
						_sanitizeAttachedShadowRoots(innerSr);
						_sanitizeShadowDOM2(innerSr);
					}
				}
			}
			_executeHooks(hooks.afterSanitizeShadowDOM, fragment, null);
		};
		const _sanitizeAttachedShadowRoots = function _sanitizeAttachedShadowRoots(root) {
			const stack = [{
				node: root,
				shadow: null
			}];
			while (stack.length > 0) {
				const item = stack.pop();
				if (item.shadow) {
					_sanitizeShadowDOM2(item.shadow);
					continue;
				}
				const node = item.node;
				const isElement = _readNodeType(node) === NODE_TYPE.element;
				const childNodes = getChildNodes(node);
				if (childNodes) for (let i = childNodes.length - 1; i >= 0; --i) stack.push({
					node: childNodes[i],
					shadow: null
				});
				if (isElement) {
					const rootName = getNodeName ? getNodeName(node) : null;
					if (typeof rootName === "string" && transformCaseFunc(rootName) === "template") {
						const content = node.content;
						if (_isDocumentFragment(content)) stack.push({
							node: content,
							shadow: null
						});
					}
				}
				if (isElement) {
					const sr = getShadowRoot(node);
					if (_isDocumentFragment(sr)) stack.push({
						node: null,
						shadow: sr
					}, {
						node: sr,
						shadow: null
					});
				}
			}
		};
		DOMPurify.sanitize = function(dirty) {
			let cfg = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : {};
			let body = null;
			let importedNode = null;
			let currentNode = null;
			let returnNode = null;
			IS_EMPTY_INPUT = !dirty;
			if (IS_EMPTY_INPUT) dirty = "<!-->";
			if (typeof dirty !== "string" && !_isNode(dirty)) {
				dirty = stringifyValue(dirty);
				if (typeof dirty !== "string") throw typeErrorCreate("dirty is not a string, aborting");
			}
			if (!DOMPurify.isSupported) return dirty;
			if (SET_CONFIG) {
				ALLOWED_TAGS = SET_CONFIG_ALLOWED_TAGS;
				ALLOWED_ATTR = SET_CONFIG_ALLOWED_ATTR;
			} else _parseConfig(cfg);
			if (hooks.uponSanitizeElement.length > 0 || hooks.uponSanitizeAttribute.length > 0) ALLOWED_TAGS = clone(ALLOWED_TAGS);
			if (hooks.uponSanitizeAttribute.length > 0) ALLOWED_ATTR = clone(ALLOWED_ATTR);
			DOMPurify.removed = [];
			const inPlace = IN_PLACE && typeof dirty !== "string" && _isNode(dirty);
			if (inPlace) {
				_neutralizePatchLinkage(dirty);
				const nn = _readNodeName(dirty);
				if (typeof nn === "string") {
					const tagName = transformCaseFunc(nn);
					if (!ALLOWED_TAGS[tagName] || FORBID_TAGS[tagName]) {
						_neutralizeRoot(dirty);
						throw typeErrorCreate("root node is forbidden and cannot be sanitized in-place");
					}
				}
				if (_isClobbered(dirty)) {
					_neutralizeRoot(dirty);
					throw typeErrorCreate("root node is clobbered and cannot be sanitized in-place");
				}
				try {
					_sanitizeAttachedShadowRoots(dirty);
				} catch (error) {
					_neutralizeRoot(dirty);
					throw error;
				}
			} else if (_isNode(dirty)) {
				body = _initDocument("<!---->");
				importedNode = body.ownerDocument.importNode(dirty, true);
				if (importedNode.nodeType === NODE_TYPE.element && importedNode.nodeName === "BODY") body = importedNode;
				else if (importedNode.nodeName === "HTML") body = importedNode;
				else body.appendChild(importedNode);
				_sanitizeAttachedShadowRoots(body);
			} else {
				if (!RETURN_DOM && !SAFE_FOR_TEMPLATES && !WHOLE_DOCUMENT && dirty.indexOf("<") === -1) return trustedTypesPolicy && RETURN_TRUSTED_TYPE ? _createTrustedHTML(dirty) : dirty;
				body = _initDocument(dirty);
				if (!body) return RETURN_DOM ? null : RETURN_TRUSTED_TYPE ? emptyHTML : "";
			}
			if (body && FORCE_BODY) _forceRemove(body.firstChild);
			const walkRoot = inPlace ? dirty : body;
			try {
				const nodeIterator = _createNodeIterator(walkRoot);
				while (currentNode = nodeIterator.nextNode()) {
					_sanitizeElements(currentNode, walkRoot);
					_sanitizeAttributes(currentNode, walkRoot);
					if (_isDocumentFragment(currentNode.content)) _sanitizeShadowDOM2(currentNode.content);
				}
			} catch (error) {
				if (inPlace) {
					_neutralizeRoot(dirty);
					arrayForEach(DOMPurify.removed, (entry) => {
						if (entry.element) _neutralizeSubtree(entry.element);
					});
				}
				throw error;
			}
			if (inPlace) {
				let rootWasRemoved = false;
				arrayForEach(DOMPurify.removed, (entry) => {
					if (entry.element) {
						if (entry.element === dirty) rootWasRemoved = true;
						_neutralizeSubtree(entry.element);
					}
				});
				if (rootWasRemoved) throw typeErrorCreate("a node selected for removal could not be safely returned; refusing to sanitize in place");
				if (SAFE_FOR_TEMPLATES) _scrubTemplateExpressions2(dirty);
				return dirty;
			}
			if (RETURN_DOM) {
				if (SAFE_FOR_TEMPLATES) _scrubTemplateExpressions2(body);
				if (RETURN_DOM_FRAGMENT) {
					returnNode = createDocumentFragment.call(body.ownerDocument);
					while (body.firstChild) returnNode.appendChild(body.firstChild);
				} else returnNode = body;
				if (ALLOWED_ATTR.shadowroot || ALLOWED_ATTR.shadowrootmode) returnNode = importNode.call(originalDocument, returnNode, true);
				return returnNode;
			}
			let serializedHTML = WHOLE_DOCUMENT ? body.outerHTML : body.innerHTML;
			if (WHOLE_DOCUMENT && ALLOWED_TAGS["!doctype"] && body.ownerDocument && body.ownerDocument.doctype && body.ownerDocument.doctype.name && regExpTest(DOCTYPE_NAME, body.ownerDocument.doctype.name)) serializedHTML = "<!DOCTYPE " + body.ownerDocument.doctype.name + ">\n" + serializedHTML;
			if (SAFE_FOR_TEMPLATES) serializedHTML = _stripTemplateExpressions(serializedHTML);
			return trustedTypesPolicy && RETURN_TRUSTED_TYPE ? _createTrustedHTML(serializedHTML) : serializedHTML;
		};
		DOMPurify.setConfig = function() {
			let cfg = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : {};
			_parseConfig(cfg);
			SET_CONFIG = true;
			SET_CONFIG_ALLOWED_TAGS = ALLOWED_TAGS;
			SET_CONFIG_ALLOWED_ATTR = ALLOWED_ATTR;
		};
		DOMPurify.clearConfig = function() {
			CONFIG = null;
			SET_CONFIG = false;
			SET_CONFIG_ALLOWED_TAGS = null;
			SET_CONFIG_ALLOWED_ATTR = null;
			trustedTypesPolicy = defaultTrustedTypesPolicy;
			emptyHTML = "";
		};
		DOMPurify.isValidAttribute = function(tag, attr, value) {
			if (!CONFIG) _parseConfig({});
			const lcTag = transformCaseFunc(tag);
			const lcName = transformCaseFunc(attr);
			return _isValidAttribute(lcTag, lcName, value);
		};
		DOMPurify.addHook = function(entryPoint, hookFunction) {
			if (typeof hookFunction !== "function") return;
			if (!objectHasOwnProperty(hooks, entryPoint)) return;
			arrayPush(hooks[entryPoint], hookFunction);
		};
		DOMPurify.removeHook = function(entryPoint, hookFunction) {
			if (!objectHasOwnProperty(hooks, entryPoint)) return;
			if (hookFunction !== void 0) {
				const index = arrayLastIndexOf(hooks[entryPoint], hookFunction);
				return index === -1 ? void 0 : arraySplice(hooks[entryPoint], index, 1)[0];
			}
			return arrayPop(hooks[entryPoint]);
		};
		DOMPurify.removeHooks = function(entryPoint) {
			if (!objectHasOwnProperty(hooks, entryPoint)) return;
			hooks[entryPoint] = [];
		};
		DOMPurify.removeAllHooks = function() {
			hooks = _createHooksMap();
		};
		return DOMPurify;
	}
	var purify_default = createDOMPurify();
	var forbiddenTags = [
		"script",
		"style",
		"link",
		"meta",
		"base",
		"iframe",
		"object",
		"embed",
		"form",
		"input",
		"textarea",
		"select",
		"option",
		"button"
	];
	var forbiddenAttributes = [
		"style",
		"srcdoc",
		"srcset",
		"formaction",
		"contenteditable",
		"ping",
		"data-xns-deferred-src"
	];
	function sanitizeImportedNode(sourceNode, options = {}) {
		if (!sourceNode || forbiddenTags.includes(sourceNode.localName.toLowerCase())) return null;
		const imported = purify_default.sanitize(sourceNode, {
			RETURN_DOM_FRAGMENT: true,
			FORBID_TAGS: forbiddenTags,
			ADD_FORBID_CONTENTS: forbiddenTags,
			FORBID_ATTR: forbiddenAttributes,
			ADD_TAGS: ["use"]
		}).firstElementChild;
		if (!imported) return null;
		for (const node of [imported, ...imported.querySelectorAll("*")]) {
			if (node !== imported && !options.keepCommentMenu && node.matches(".comment-menu, .comment-actions")) {
				node.remove();
				continue;
			}
			if (node !== imported) node.removeAttribute("id");
			for (const name of [
				"href",
				"src",
				"poster",
				"xlink:href"
			]) {
				const value = node.getAttribute(name);
				if (value === null) continue;
				const localFragment = /^#[\w:.-]+$/.test(value.trim());
				const safeValue = node.localName === "use" ? localFragment ? value.trim() : null : name === "xlink:href" && localFragment ? value.trim() : getSafeUrlAttribute(name === "poster" ? "src" : name === "xlink:href" ? "href" : name, value);
				if (!safeValue) node.removeAttribute(name);
				else if (options.deferImages && node.localName === "img" && name === "src") {
					node.setAttribute("data-xns-deferred-src", safeValue);
					node.removeAttribute(name);
				} else node.setAttribute(name, safeValue);
			}
			if (node.localName === "a" && (node.hasAttribute("href") || node.hasAttribute("xlink:href"))) {
				node.setAttribute("target", "_blank");
				node.setAttribute("rel", "noopener noreferrer");
			}
			if (node.localName === "img") {
				node.setAttribute("loading", "lazy");
				node.setAttribute("decoding", "async");
				node.setAttribute("referrerpolicy", "origin");
			}
		}
		return document.adoptNode(imported);
	}
	function createContentParser({ documentObj, qs, qsa, parseSameOriginUrl, getPostInfo, safePositiveInt, getFloor, getCommentId, getAuthorName, getPostContent, getCurrentUserUid }) {
		const ssrCommentIndexes = new WeakMap();
		function extractReplyMetadata(item, postId) {
			const firstParagraph = getPostContent(item)?.querySelector(":scope > p:first-child");
			const firstText = firstParagraph?.textContent?.trim() || "";
			const match = /^@([^\s]+)\s+#([1-9]\d*)/.exec(firstText);
			if (!match) return null;
			const targetFloor = safePositiveInt(match[2]);
			if (targetFloor === null) return null;
			const floorLink = qsa(firstParagraph, "a").find((link) => /^#\d+$/.test((link.textContent || "").trim()));
			if (floorLink) {
				const linkedUrl = parseSameOriginUrl(floorLink.getAttribute("href") || "");
				const linkedInfo = linkedUrl ? getPostInfo(linkedUrl.href) : null;
				if (linkedInfo && linkedInfo.postId !== String(postId)) return null;
			}
			return {
				targetFloor,
				targetUser: match[1].slice(0, 80)
			};
		}
		function isPinnedComment(item) {
			return Boolean(qs(item, ".nsk-content-meta-info .hot-badge, .nsk-content-meta-info .pined-comment-badge, .nsk-content-meta-info [title=\"置顶\"], .nsk-content-meta-info [title*=\"HOT\"], .nsk-content-meta-info [class*=\"hot\"]"));
		}
		function hasOwnEditOption(item) {
			if (!item?.querySelector) return false;
			return qsa(item, ":scope > .comment-menu > .menu-item, :scope > .comment-actions > .menu-item").some((el) => (el.textContent || "").trim() === "编辑" && !el.dataset?.xnsAction);
		}
		function getCommentAuthorUid(item) {
			try {
				const match = (qs(item, ".nsk-content-meta-info a[href*=\"/space/\"], .author-name, a[href*=\"/space/\"]")?.getAttribute("href") || "").match(/\/space\/(\d+)/);
				return match ? match[1] : null;
			} catch {
				return null;
			}
		}
		function getStateUserUid(state) {
			const user = state?.user;
			const value = user && (user.id ?? user.uid ?? user.userId ?? user.memberId ?? user.member_id);
			return value === void 0 || value === null ? null : String(value);
		}
		function getCommentRecord(item, postId, page, index, current, options = {}) {
			const floor = getFloor(item);
			if (floor === null) return null;
			const node = current ? item : sanitizeImportedNode(item, {
				...options,
				deferImages: true
			});
			if (!node) return null;
			const commentId = getCommentId(item);
			const currentUserUid = (typeof options.getCurrentUserUid === "function" ? options.getCurrentUserUid() : getCurrentUserUid()) || getStateUserUid(options.state);
			return {
				floor,
				page,
				postId,
				index,
				current,
				isMine: hasOwnEditOption(item) || currentUserUid !== null && getCommentAuthorUid(item) === currentUserUid,
				pinned: isPinnedComment(item),
				author: getAuthorName(item),
				reply: extractReplyMetadata(item, postId),
				counts: commentId !== null && options.state ? getSsrCommentCounts(options.state, commentId) : null,
				node: current ? node : null,
				html: current ? null : node.outerHTML,
				parent: null,
				children: []
			};
		}
		function materializeCommentNode(record) {
			if (record?.node) return record.node;
			if (typeof record?.html !== "string" || !record.html) return null;
			const template = documentObj.createElement("template");
			template.innerHTML = record.html;
			record.node = template.content.firstElementChild || null;
			restoreDeferredImageSources(record.node);
			return record.node;
		}
		function restoreDeferredImageSources(root) {
			const images = [];
			if (root?.localName === "img") images.push(root);
			images.push(...qsa(root, "img[data-xns-deferred-src]"));
			images.forEach((image) => {
				const source = image.getAttribute("data-xns-deferred-src");
				if (source && !image.getAttribute("src")) image.setAttribute("src", source);
				image.removeAttribute("data-xns-deferred-src");
			});
		}
		function releaseCommentNode(record) {
			if (record && !record.current) record.node = null;
		}
		function releaseCommentHtml(record) {
			if (record && !record.current && record.node) record.html = null;
		}
		function getSsrCommentCounts(stateValue, commentId) {
			if (!stateValue || typeof stateValue !== "object") return null;
			let index = ssrCommentIndexes.get(stateValue);
			if (!index) {
				index = new Map();
				const comments = stateValue?.postData?.comments;
				if (Array.isArray(comments)) comments.forEach((item) => {
					if (item?.commentId !== void 0 && item?.commentId !== null && !index.has(String(item.commentId))) index.set(String(item.commentId), item);
				});
				ssrCommentIndexes.set(stateValue, index);
			}
			const comment = index.get(String(commentId));
			if (!comment) return null;
			return {
				like: safeCount(comment.upvoteCount),
				chicken: safeCount(comment.likeCount),
				dislike: safeCount(comment.dislikeCount),
				liked: Boolean(comment.upvoted),
				chickened: Boolean(comment.liked),
				disliked: Boolean(comment.disliked)
			};
		}
		return Object.freeze({
			sanitizeImportedNode,
			extractReplyMetadata,
			isPinnedComment,
			hasOwnEditOption,
			getCommentAuthorUid,
			getCommentRecord,
			materializeCommentNode,
			releaseCommentNode,
			releaseCommentHtml,
			getSsrCommentCounts
		});
	}
	var xnsContentParser = createContentParser({
		documentObj: document,
		qs,
		qsa,
		parseSameOriginUrl,
		getPostInfo,
		safePositiveInt,
		getFloor,
		getCommentId,
		getAuthorName,
		getPostContent,
		getCurrentUserUid
	});
	function getCommentRecord(...args) {
		return xnsContentParser.getCommentRecord(...args);
	}
	function materializeCommentNode(...args) {
		return xnsContentParser.materializeCommentNode(...args);
	}
	function releaseCommentNode(...args) {
		return xnsContentParser.releaseCommentNode(...args);
	}
	function getSsrCommentCounts(...args) {
		return xnsContentParser.getSsrCommentCounts(...args);
	}
	function createHttpClient({ windowObj, fetchFn, AbortControllerCtor, DOMParserCtor, requestTimeout, maxResponseBytes, isAllowedPostRequest, parseSameOriginUrl, extractSsrState, cacheTtl, cacheMaxEntries, cacheMaxBytes, cacheItemMaxBytes }) {
		const htmlCache = new Map();
		let htmlCacheBytes = 0;
		function removeCacheEntry(key) {
			const entry = htmlCache.get(key);
			if (!entry) return;
			htmlCacheBytes -= entry.bytes;
			htmlCache.delete(key);
		}
		function postIdFromUrl(url) {
			return /^\/post-(\d+)-\d+(?:\/)?$/.exec(url.pathname)?.[1] || "";
		}
		function invalidatePostCache(url) {
			const postId = postIdFromUrl(url);
			if (!postId) {
				removeCacheEntry(url.href);
				return;
			}
			Array.from(htmlCache.entries()).forEach(([key, entry]) => {
				if (entry.postId === postId) removeCacheEntry(key);
			});
		}
		function readCachedHtml(url) {
			const entry = htmlCache.get(url.href);
			if (!entry) return null;
			if (Date.now() - entry.createdAt > cacheTtl) {
				removeCacheEntry(url.href);
				return null;
			}
			htmlCache.delete(url.href);
			htmlCache.set(url.href, entry);
			return {
				html: entry.html,
				url: parseSameOriginUrl(entry.url)
			};
		}
		function writeCachedHtml(url, html) {
			const bytes = html.length;
			if (bytes > cacheItemMaxBytes) return;
			removeCacheEntry(url.href);
			while (htmlCache.size >= cacheMaxEntries || htmlCacheBytes + bytes > cacheMaxBytes) {
				const oldest = htmlCache.keys().next().value;
				if (oldest === void 0) break;
				removeCacheEntry(oldest);
			}
			htmlCache.set(url.href, {
				html,
				url: url.href,
				postId: postIdFromUrl(url),
				createdAt: Date.now(),
				bytes
			});
			htmlCacheBytes += bytes;
		}
		function getRetryDelay(response, fallback) {
			const value = response.headers?.get?.("retry-after")?.trim() || "";
			if (!value) return fallback;
			const seconds = Number(value);
			if (Number.isFinite(seconds) && seconds >= 0) return Math.min(1e4, seconds * 1e3);
			const timestamp = Date.parse(value);
			if (!Number.isNaN(timestamp)) return Math.min(1e4, Math.max(0, timestamp - Date.now()));
			return fallback;
		}
		function isCloudflareChallenge(response) {
			return response.headers?.get?.("cf-mitigated")?.trim().toLowerCase() === "challenge";
		}
		function createHttpError(message, code, status) {
			const error = new Error(message);
			error.code = code;
			if (Number.isFinite(status)) error.status = status;
			return error;
		}
		function abortError() {
			const error = new Error("请求已取消");
			error.name = "AbortError";
			return error;
		}
		function wait(delay, signal) {
			if (signal?.aborted) return Promise.reject(abortError());
			return new Promise((resolve, reject) => {
				const timer = windowObj.setTimeout(() => {
					signal?.removeEventListener("abort", cancel);
					resolve();
				}, delay);
				const cancel = () => {
					windowObj.clearTimeout(timer);
					signal?.removeEventListener("abort", cancel);
					reject(abortError());
				};
				signal?.addEventListener("abort", cancel, { once: true });
			});
		}
		function throwIfAborted(signal) {
			if (signal?.aborted) throw abortError();
		}
		async function fetchHtml(url, options = {}) {
			if (!isAllowedPostRequest(url)) throw new Error("只允许读取同一站点的帖子页面");
			const noStore = options.noStore === true;
			const allowCache = options.allowCache === true && !noStore;
			if (noStore) invalidatePostCache(url);
			if (allowCache) {
				const cached = readCachedHtml(url);
				if (cached) return cached;
			}
			for (let attempt = 1; attempt <= 3; attempt += 1) {
				throwIfAborted(options.signal);
				if (typeof options.beforeRequest === "function") await options.beforeRequest();
				throwIfAborted(options.signal);
				const controller = new AbortControllerCtor();
				const abortExternal = () => controller.abort();
				options.signal?.addEventListener("abort", abortExternal, { once: true });
				const timer = windowObj.setTimeout(() => controller.abort(), requestTimeout);
				try {
					const response = await fetchFn(url.href, {
						method: "GET",
						credentials: "same-origin",
						cache: noStore ? "no-store" : "default",
						redirect: "error",
						referrerPolicy: "same-origin",
						headers: { Accept: "text/html,application/xhtml+xml" },
						signal: controller.signal
					});
					if (typeof options.onResponse === "function") options.onResponse(response.status);
					if (isCloudflareChallenge(response)) throw createHttpError("NodeSeek 的 Cloudflare 验证拦截了此分页，请完成验证后再点重试", "CLOUDFLARE_CHALLENGE", response.status);
					if (response.status === 429 || response.status >= 500) {
						if (attempt < 3) {
							await wait(getRetryDelay(response, 600 * attempt), options.signal);
							continue;
						}
						throw new Error(`HTTP ${response.status}`);
					}
					if (!response.ok) throw new Error(`HTTP ${response.status}`);
					const responseUrl = parseSameOriginUrl(response.url);
					const contentType = (response.headers.get("content-type") || "").toLowerCase();
					const contentLength = Number(response.headers.get("content-length") || 0);
					if (!responseUrl || !isAllowedPostRequest(responseUrl) || !contentType.includes("text/html")) throw new Error("响应不是同站帖子页面");
					if (Number.isFinite(contentLength) && contentLength > maxResponseBytes) throw new Error("响应过大");
					const html = await response.text();
					if (!html || html.length > maxResponseBytes) throw new Error("响应过大或为空");
					if (allowCache) writeCachedHtml(responseUrl, html);
					return {
						html,
						url: responseUrl
					};
				} catch (error) {
					if (error?.code === "CLOUDFLARE_CHALLENGE") throw error;
					if (attempt < 3 && error?.name !== "AbortError") {
						await new Promise((resolve) => windowObj.setTimeout(resolve, 600 * attempt));
						continue;
					}
					throw error;
				} finally {
					windowObj.clearTimeout(timer);
					options.signal?.removeEventListener("abort", abortExternal);
				}
			}
			throw new Error("抓取失败");
		}
		function parseHtml(html) {
			const doc = new DOMParserCtor().parseFromString(html, "text/html");
			doc.__xnsState = extractSsrState(doc);
			return doc;
		}
		return Object.freeze({
			fetchHtml,
			parseHtml
		});
	}
	var xnsHttpClient = createHttpClient({
		windowObj: window,
		fetchFn: window.fetch.bind(window),
		AbortControllerCtor: window.AbortController,
		DOMParserCtor: window.DOMParser,
		requestTimeout: REQUEST_TIMEOUT,
		maxResponseBytes: MAX_RESPONSE_BYTES,
		cacheTtl: HTML_CACHE_TTL,
		cacheMaxEntries: 16,
		cacheMaxBytes: HTML_CACHE_MAX_BYTES,
		cacheItemMaxBytes: HTML_CACHE_ITEM_MAX_BYTES,
		isAllowedPostRequest,
		parseSameOriginUrl,
		extractSsrState
	});
	function fetchHtml(...args) {
		return xnsHttpClient.fetchHtml(...args);
	}
	function parseHtml(...args) {
		return xnsHttpClient.parseHtml(...args);
	}
	function createPaginationService({ windowObj, qsa, parseSameOriginUrl, getPostInfo }) {
		function getPaginationLinks(root) {
			const preferred = qsa(root, ".nsk-pager a[href], a.pager-pos[href]");
			return preferred.length ? preferred : qsa(root, "a[href]");
		}
		function getPageNumbers(root, postId) {
			const pages = new Set();
			const baseUrl = typeof root?.baseURI === "string" && /^https?:/.test(root.baseURI) ? root.baseURI : windowObj.location.href;
			getPaginationLinks(root).forEach((link) => {
				const url = parseSameOriginUrl(link.getAttribute("href") || "", baseUrl);
				const info = url ? getPostInfo(url.href) : null;
				if (info?.postId === String(postId)) pages.add(info.page);
			});
			return pages;
		}
		return Object.freeze({ getPageNumbers });
	}
	var xnsPaginationService = createPaginationService({
		windowObj: window,
		qsa,
		parseSameOriginUrl,
		getPostInfo
	});
	function getPageNumbers(...args) {
		return xnsPaginationService.getPageNumbers(...args);
	}
	function createPageLoader({ windowObj, maxPage, getMaxPage, concurrency, requestGapMs, fetchHtml, parseHtml, getPageNumbers, getCommentItems, getCommentRecord, getDocState, getCurrentUserUid, buildPostUrl }) {
		function createRequestGate(gapMs) {
			const cooldownGap = Number.isFinite(Number(gapMs)) ? Math.max(0, Number(gapMs)) : 0;
			let currentGap = cooldownGap;
			let successStreak = 0;
			let queue = Promise.resolve();
			let nextStartAt = 0;
			async function waitForRequestSlot() {
				const previous = queue;
				let release;
				queue = new Promise((resolve) => {
					release = resolve;
				});
				await previous;
				const delay = Math.max(0, nextStartAt - Date.now());
				if (delay) await new Promise((resolve) => windowObj.setTimeout(resolve, delay));
				nextStartAt = Date.now() + currentGap;
				release();
			}
			function observeResponse(status) {
				if (status === 429 || status >= 500) {
					currentGap = Math.min(1e3, Math.max(cooldownGap, currentGap ? currentGap * 2 : cooldownGap));
					successStreak = 0;
					return;
				}
				if (status >= 200 && status < 300) {
					successStreak += 1;
					if (successStreak >= 8 && currentGap > 0) {
						currentGap = Math.max(cooldownGap, currentGap - 25);
						successStreak = 0;
					}
				}
			}
			return Object.freeze({
				waitForRequestSlot,
				observeResponse
			});
		}
		function collectPageRecords(info, root, page) {
			const state = getDocState(root);
			return getCommentItems(root).map((item, index) => getCommentRecord(item, info.postId, page, index, false, {
				keepCommentMenu: true,
				state,
				getCurrentUserUid
			})).filter(Boolean);
		}
		async function fetchPostPages(info, firstDocument, options = {}) {
			const pageLimit = Math.min(maxPage, Math.max(1, Number(options.pageLimit) || Number(getMaxPage?.()) || maxPage));
			const noStore = options.noStore !== false;
			const pageDocs = options.retainDocuments !== false ? new Map([[info.page, firstDocument]]) : null;
			const normalizePages = (values) => Array.from(new Set((Array.isArray(values) ? values : []).map((page) => Number(page)).filter((page) => Number.isInteger(page) && page >= 1 && page <= pageLimit)));
			const onlyPages = Array.isArray(options.onlyPages) ? normalizePages(options.onlyPages) : null;
			const loadedPages = new Set([info.page, ...normalizePages(options.initialLoadedPages)]);
			const failedPages = new Set(normalizePages(options.initialFailedPages));
			const challengePages = new Set(normalizePages(options.initialChallengePages));
			const countedLoadedPages = () => Array.from(loadedPages).filter((page) => page >= 1 && page <= pageLimit).length;
			const pages = new Set([info.page]);
			const discovered = getPageNumbers(firstDocument, info.postId);
			const totalPages = discovered.size ? Math.max(...discovered, info.page) : info.page;
			const truncated = totalPages > pageLimit;
			if (onlyPages) onlyPages.forEach((page) => pages.add(page));
			else {
				discovered.forEach((page) => {
					if (page <= pageLimit) pages.add(page);
				});
				const maxSeed = truncated ? pageLimit : Math.min(pageLimit, Math.max(...pages));
				for (let page = 1; page <= maxSeed; page += 1) pages.add(page);
			}
			pages.delete(info.page);
			const progressState = () => ({
				loadedPages: countedLoadedPages(),
				failedPages: [...failedPages].sort((a, b) => a - b),
				challengePages: [...challengePages].sort((a, b) => a - b),
				truncated,
				totalPages,
				pageLimit
			});
			const pending = Array.from(pages).sort((a, b) => a - b);
			const requestGate = createRequestGate(options.requestGapMs ?? requestGapMs);
			options.onPageLoaded?.(info.page, firstDocument, progressState());
			const worker = async () => {
				while (pending.length) {
					if (options.isAborted?.()) return;
					const page = pending.shift();
					if (page === void 0 || loadedPages.has(page)) continue;
					try {
						const response = await fetchHtml(buildPostUrl(info.postId, page), {
							noStore,
							allowCache: options.allowCache === true,
							signal: options.signal,
							beforeRequest: requestGate.waitForRequestSlot,
							onResponse: requestGate.observeResponse
						});
						const parsed = parseHtml(response.html, response.url);
						loadedPages.add(page);
						failedPages.delete(page);
						challengePages.delete(page);
						if (pageDocs) pageDocs.set(page, parsed);
						options.onPageLoaded?.(page, parsed, progressState());
						if (!onlyPages) getPageNumbers(parsed, info.postId).forEach((foundPage) => {
							if (foundPage <= pageLimit && !pages.has(foundPage) && foundPage !== info.page) {
								pages.add(foundPage);
								pending.push(foundPage);
							}
						});
					} catch (error) {
						failedPages.add(page);
						if (error?.code === "CLOUDFLARE_CHALLENGE") challengePages.add(page);
						else challengePages.delete(page);
						options.onPageFailed?.(page, progressState());
					}
				}
			};
			const workerCount = Math.min(concurrency, Math.max(1, pending.length));
			await Promise.all(Array.from({ length: workerCount }, () => worker()));
			return {
				pageDocs,
				loadedPages: countedLoadedPages(),
				failedPages: [...failedPages].sort((a, b) => a - b),
				challengePages: [...challengePages].sort((a, b) => a - b),
				truncated,
				totalPages,
				pageLimit
			};
		}
		async function loadPreviewRecords(info, firstDocument, options = {}) {
			const initialRecords = Array.isArray(options.initialRecords) ? options.initialRecords : null;
			let records = mergeCommentRecords(initialRecords);
			const { loadedPages, failedPages, challengePages, truncated, totalPages, pageLimit } = await fetchPostPages(info, firstDocument, {
				...options,
				retainDocuments: false,
				onPageLoaded: (page, root, progress) => {
					if (initialRecords && page === info.page) return;
					records = mergeCommentRecords(records, collectPageRecords(info, root, page));
					options.onRecordsLoaded?.({
						records,
						...progress,
						page,
						loading: true
					});
				},
				onPageFailed: (page, progress) => {
					options.onPageFailed?.(page, progress);
					options.onRecordsLoaded?.({
						records,
						...progress,
						page,
						loading: true
					});
				}
			});
			return {
				records,
				loadedPages,
				failedPages,
				challengePages,
				truncated,
				totalPages,
				pageLimit
			};
		}
		return Object.freeze({
			collectPageRecords,
			fetchPostPages,
			loadPreviewRecords
		});
	}
	var xnsPageLoader = createPageLoader({
		windowObj: window,
		maxPage: 50,
		getMaxPage,
		concurrency: 2,
		requestGapMs: 150,
		fetchHtml,
		parseHtml,
		getPageNumbers,
		getCommentItems,
		getCommentRecord,
		getDocState,
		getCurrentUserUid,
		buildPostUrl
	});
	function collectPageRecords(...args) {
		return xnsPageLoader.collectPageRecords(...args);
	}
	function fetchPostPages(...args) {
		return xnsPageLoader.fetchPostPages(...args);
	}
	function loadPreviewRecords(...args) {
		return xnsPageLoader.loadPreviewRecords(...args);
	}
	function createVoteFeature({ windowObj, documentObj, qs, qsa, createElement, parseSameOriginUrl, safePositiveInt, dynamicSign, postAction, getActionContext, fetchFn }) {
		function getVoteIdFromLink(link) {
			const href = link.getAttribute("data-href") || link.getAttribute("href") || "";
			const match = /nsapp:\/\/vote\?id=(\d+)/.exec(href);
			return match ? safePositiveInt(match[1]) : null;
		}
		async function fetchVoteInfo(voteId) {
			const endpoint = parseSameOriginUrl(`/api/vote/info/${voteId}`);
			if (!endpoint) throw new Error("投票地址非法");
			const headers = {
				Accept: "application/json",
				"X-Requested-With": "XMLHttpRequest"
			};
			if (windowObj.crypto?.subtle) headers["x-dynamic-sign"] = await dynamicSign("GET", endpoint.href, "");
			const response = await fetchFn(endpoint.href, {
				method: "GET",
				credentials: "same-origin",
				cache: "no-store",
				redirect: "error",
				referrerPolicy: "same-origin",
				headers
			});
			const text = await response.text();
			let data = null;
			try {
				data = text ? JSON.parse(text) : null;
			} catch {}
			if (!response.ok || !data || data.success === false) throw new Error(data?.message || `HTTP ${response.status}`);
			return data;
		}
		function hasVoteResults(vote) {
			return (vote.items || []).some((item) => typeof item.count === "number");
		}
		function buildVoteResults(vote) {
			const items = vote.items || [];
			const total = items.reduce((sum, item) => sum + (typeof item.count === "number" ? item.count : 0), 0);
			const box = createElement("div", "xns-vote-results");
			items.forEach((item) => {
				const count = typeof item.count === "number" ? item.count : 0;
				const percent = total > 0 ? Math.round(count / total * 100) : 0;
				const row = createElement("div", `xns-vote-result${item.voted ? " xns-vote-mine" : ""}`);
				row.appendChild(createElement("div", "vote-item-text", item.text || ""));
				const barWrap = createElement("div", "xns-vote-bar-wrap");
				const bar = createElement("div", "xns-vote-bar");
				bar.style.width = `${percent}%`;
				bar.appendChild(documentObj.createTextNode(`${percent}%`));
				barWrap.appendChild(bar);
				row.appendChild(barWrap);
				row.appendChild(createElement("div", "xns-vote-result-meta", `${count} 票${item.voted ? "（已选）" : ""}`));
				box.appendChild(row);
			});
			box.appendChild(createElement("div", "xns-vote-total", `共 ${total} 票${vote.locked ? " · 已结束" : ""}`));
			return box;
		}
		function buildVotePanel(vote) {
			const panel = createElement("div", "vote-panel xns-vote-panel");
			panel.dataset.xnsVoteId = String(vote.id);
			const title = createElement("h2", "xns-vote-title", vote.title || "投票");
			title.style.textAlign = "center";
			title.style.fontSize = "1.2rem";
			panel.appendChild(title);
			if (hasVoteResults(vote)) {
				panel.appendChild(buildVoteResults(vote));
				panel.appendChild(createElement("div", "xns-vote-note", `nsapp://vote?id=${vote.id}${vote.isPublic ? " (公开投票)" : ""}${vote.locked ? " · 已结束" : ""}`));
				return panel;
			}
			const single = vote.multiple !== true;
			const wrapper = createElement("fieldset", "vote-stat-wrapper");
			(vote.items || []).forEach((item) => {
				const stat = createElement("div", `vote-stat${item.voted ? " voted" : " not-voted"}`);
				const input = documentObj.createElement("input");
				input.type = single ? "radio" : "checkbox";
				input.name = "vote-item";
				input.value = String(item.vote_item_id);
				if (item.voted) input.checked = true;
				const label = createElement("label", "pure-checkbox");
				label.appendChild(input);
				label.appendChild(createElement("div", "vote-item-text", item.text || ""));
				stat.appendChild(label);
				wrapper.appendChild(stat);
			});
			panel.appendChild(wrapper);
			const buttons = createElement("fieldset", "op-buttons");
			const submit = createElement("button", "pure-button pure-button-primary add-margin", vote.locked ? "已结束" : "投票");
			submit.type = "button";
			if (vote.locked) submit.setAttribute("disabled", "");
			buttons.appendChild(submit);
			panel.appendChild(buttons);
			panel.appendChild(createElement("div", "xns-vote-note", `nsapp://vote?id=${vote.id}${vote.isPublic ? " (公开投票)" : ""}`));
			return panel;
		}
		function mountVotePanel(link, data) {
			if (!link.isConnected) return;
			const vote = data?.vote;
			if (!vote || !Array.isArray(vote.items)) return;
			link.replaceWith(buildVotePanel(vote));
		}
		function scheduleVoteInfo(link, voteId) {
			const load = () => {
				if (!link.isConnected) return;
				fetchVoteInfo(voteId).then((data) => mountVotePanel(link, data)).catch(() => {
					if (link.isConnected) link.textContent = link.textContent || `投票 #${voteId}（需登录）`;
				});
			};
			if (typeof windowObj.IntersectionObserver === "function") {
				let observer;
				observer = new windowObj.IntersectionObserver((entries) => {
					if (!entries.some((entry) => entry.isIntersecting)) return;
					observer.disconnect();
					load();
				}, { rootMargin: "600px 0px" });
				observer.observe(link);
				return;
			}
			if (typeof windowObj.requestIdleCallback === "function") windowObj.requestIdleCallback(load, { timeout: 1e3 });
			else windowObj.setTimeout(load, 0);
		}
		function installPreviewVotePanels(root, options = {}) {
			const selector = ".xns-preview-content a[data-href^=\"nsapp://vote\"], .xns-preview-content a[href^=\"nsapp://vote\"]";
			const relativeSelector = root?.matches?.(".xns-preview-content") || root?.closest?.(".xns-preview-content") ? "a[data-href^=\"nsapp://vote\"], a[href^=\"nsapp://vote\"]" : selector;
			const owner = root?.matches?.(".content-item") ? root : null;
			const links = [];
			if (root?.matches?.(selector)) links.push(root);
			links.push(...qsa(root, relativeSelector));
			links.filter((link) => {
				if (owner && link.closest?.(".content-item") !== owner) return false;
				if (options.skipRemote && (link.matches?.("[data-xns-remote]") || link.closest?.("[data-xns-remote]"))) return false;
				return true;
			}).forEach((link) => {
				if (link.dataset.xnsVoteBound === "true") return;
				const voteId = getVoteIdFromLink(link);
				if (voteId === null) return;
				link.dataset.xnsVoteBound = "true";
				scheduleVoteInfo(link, voteId);
			});
		}
		function getVoteStatus(panel) {
			let status = qs(panel, ".xns-vote-status");
			if (!status) {
				status = createElement("div", "xns-vote-status");
				panel.appendChild(status);
			}
			return status;
		}
		function handleVoteClick(event) {
			const button = event.target.closest?.(".xns-vote-panel button");
			if (!button || button.disabled) return;
			const panel = button.closest(".xns-vote-panel");
			if (!panel || panel.dataset.xnsVotePending === "true") return;
			const inPreview = Boolean(panel.closest(".xns-overlay .xns-preview-content"));
			const inRemote = Boolean(panel.closest("[data-xns-remote]"));
			if (!inPreview && !inRemote) return;
			event.preventDefault();
			event.stopImmediatePropagation();
			const selected = qsa(panel, "input[name=\"vote-item\"]:checked").map((input) => input.value);
			const status = getVoteStatus(panel);
			if (!selected.length) {
				status.textContent = "请先选择选项。";
				return;
			}
			panel.dataset.xnsVotePending = "true";
			button.setAttribute("disabled", "");
			status.textContent = "正在投票…";
			const voteId = safePositiveInt(panel.dataset.xnsVoteId || "");
			postAction("/api/vote/voteforitem", { ids: selected.map((value) => Number(value)) }, { context: getActionContext(button) }).then(async () => {
				let refreshed = null;
				if (voteId !== null) try {
					refreshed = await fetchVoteInfo(voteId);
				} catch {}
				if (!panel.isConnected) return;
				if (refreshed?.vote) panel.replaceWith(buildVotePanel(refreshed.vote));
				else {
					status.textContent = "投票成功，感谢参与。";
					button.textContent = "已投票";
				}
			}).catch((error) => {
				status.textContent = `投票失败：${error.message || "网络错误"}`;
				button.removeAttribute("disabled");
				panel.dataset.xnsVotePending = "";
			});
		}
		return Object.freeze({
			installPreviewVotePanels,
			handleVoteClick,
			fetchVoteInfo
		});
	}
	var xnsVoteFeature = createVoteFeature({
		windowObj: window,
		documentObj: document,
		qs,
		qsa,
		createElement,
		parseSameOriginUrl,
		safePositiveInt,
		dynamicSign,
		postAction,
		getActionContext,
		fetchFn: window.fetch.bind(window)
	});
	function installPreviewVotePanels(...args) {
		return xnsVoteFeature.installPreviewVotePanels(...args);
	}
	function handleVoteClick(...args) {
		return xnsVoteFeature.handleVoteClick(...args);
	}
	function createPreviewLightbox({ windowObj, documentObj, state, qs, qsa, createElement, getSafeUrlAttribute }) {
		function getPreviewImageSource(image) {
			const link = image?.closest?.("a[href]");
			const candidates = [
				image?.currentSrc,
				image?.getAttribute?.("src"),
				image?.getAttribute?.("data-src"),
				image?.getAttribute?.("data-original"),
				link?.getAttribute?.("href")
			];
			for (const candidate of candidates) {
				const safe = getSafeUrlAttribute("src", candidate);
				if (safe) return safe;
			}
			return null;
		}
		function closeImageLightbox() {
			const lightbox = state.lightbox;
			if (!lightbox) return;
			lightbox.cleanup?.();
			lightbox.overlay?.remove();
			state.lightbox = null;
		}
		function openImageLightbox(image) {
			const source = getPreviewImageSource(image);
			if (!source) return;
			closeImageLightbox();
			const overlay = createElement("div", "xns-lightbox");
			overlay.tabIndex = -1;
			overlay.setAttribute("role", "dialog");
			overlay.setAttribute("aria-modal", "true");
			overlay.setAttribute("aria-label", "图片预览");
			const stage = createElement("div", "xns-lightbox-stage");
			const preview = documentObj.createElement("img");
			preview.className = "xns-lightbox-image";
			preview.src = source;
			preview.alt = image.getAttribute("alt") || "图片预览";
			preview.setAttribute("referrerpolicy", "origin");
			preview.setAttribute("draggable", "false");
			const close = createElement("button", "xns-lightbox-close", "×");
			close.type = "button";
			close.setAttribute("aria-label", "关闭图片预览");
			const original = createElement("a", "xns-lightbox-open", "打开原图");
			original.href = source;
			original.target = "_blank";
			original.rel = "noopener noreferrer";
			stage.appendChild(preview);
			overlay.append(stage, close, original);
			let scale = 1;
			let offsetX = 0;
			let offsetY = 0;
			let dragging = false;
			let pointerId = null;
			let startX = 0;
			let startY = 0;
			let startOffsetX = 0;
			let startOffsetY = 0;
			const render = () => {
				preview.style.transform = `translate3d(${offsetX}px, ${offsetY}px, 0) scale(${scale})`;
			};
			const onWheel = (event) => {
				event.preventDefault();
				scale = Math.min(4, Math.max(.5, scale * (event.deltaY < 0 ? 1.12 : .89)));
				if (scale <= 1) {
					scale = 1;
					offsetX = 0;
					offsetY = 0;
				}
				render();
			};
			const onPointerDown = (event) => {
				if (event.button !== 0) return;
				dragging = true;
				pointerId = event.pointerId;
				startX = event.clientX;
				startY = event.clientY;
				startOffsetX = offsetX;
				startOffsetY = offsetY;
				stage.classList.add("xns-dragging");
				stage.setPointerCapture?.(event.pointerId);
				event.preventDefault();
			};
			const onPointerMove = (event) => {
				if (!dragging || event.pointerId !== pointerId) return;
				offsetX = startOffsetX + event.clientX - startX;
				offsetY = startOffsetY + event.clientY - startY;
				render();
			};
			const onPointerUp = (event) => {
				if (event.pointerId !== pointerId) return;
				dragging = false;
				pointerId = null;
				stage.classList.remove("xns-dragging");
				stage.releasePointerCapture?.(event.pointerId);
			};
			const cleanup = () => {
				stage.removeEventListener("wheel", onWheel);
				stage.removeEventListener("pointerdown", onPointerDown);
				stage.removeEventListener("pointermove", onPointerMove);
				stage.removeEventListener("pointerup", onPointerUp);
				stage.removeEventListener("pointercancel", onPointerUp);
			};
			stage.addEventListener("wheel", onWheel, { passive: false });
			stage.addEventListener("pointerdown", onPointerDown);
			stage.addEventListener("pointermove", onPointerMove);
			stage.addEventListener("pointerup", onPointerUp);
			stage.addEventListener("pointercancel", onPointerUp);
			stage.addEventListener("click", (event) => {
				if (event.target === stage) closeImageLightbox();
			});
			preview.addEventListener("click", (event) => event.stopPropagation());
			close.addEventListener("click", closeImageLightbox);
			overlay.addEventListener("click", (event) => {
				if (event.target === overlay) closeImageLightbox();
			});
			documentObj.body.appendChild(overlay);
			state.lightbox = {
				overlay,
				cleanup
			};
			render();
			overlay.focus();
		}
		function installPreviewImageFallback(root, options = {}) {
			const selector = root?.matches?.(".xns-preview-content") || root?.closest?.(".xns-preview-content") ? "img" : ".xns-preview-content img";
			const images = [];
			if (root?.matches?.(".xns-preview-content img")) images.push(root);
			const owner = root?.matches?.(".content-item") ? root : null;
			images.push(...qsa(root, selector));
			images.filter((image) => {
				if (owner && image.closest?.(".content-item") !== owner) return false;
				if (options.skipRemote && (image.matches?.("[data-xns-remote]") || image.closest?.("[data-xns-remote]"))) return false;
				return true;
			}).forEach((image) => {
				const deferredSource = image.getAttribute("data-xns-deferred-src");
				if (deferredSource) {
					if (!image.getAttribute("src")) image.setAttribute("src", deferredSource);
					image.removeAttribute("data-xns-deferred-src");
				}
				if (image.dataset.xnsImageBound === "true") return;
				image.dataset.xnsImageBound = "true";
				image.setAttribute("tabindex", "0");
				image.setAttribute("role", "button");
				image.setAttribute("title", "点击放大图片");
				const open = (event) => {
					event.preventDefault();
					event.stopPropagation();
					openImageLightbox(image);
				};
				image.addEventListener("click", open);
				image.addEventListener("keydown", (event) => {
					if (event.key === "Enter" || event.key === " ") open(event);
				});
				image.addEventListener("error", () => {
					if (image.nextElementSibling?.matches(".xns-image-error")) return;
					const message = createElement("span", "xns-image-error", "图片加载失败：图片站拒绝了当前嵌入来源。仍可点击“打开原图”尝试查看。");
					image.insertAdjacentElement("afterend", message);
				}, { once: true });
			});
		}
		return Object.freeze({
			closeImageLightbox,
			openImageLightbox,
			installPreviewImageFallback
		});
	}
	var xnsPreviewLightbox = createPreviewLightbox({
		windowObj: window,
		documentObj: document,
		state,
		qs,
		qsa,
		createElement,
		getSafeUrlAttribute
	});
	function closeImageLightbox(...args) {
		return xnsPreviewLightbox.closeImageLightbox(...args);
	}
	function installPreviewImageFallback(...args) {
		return xnsPreviewLightbox.installPreviewImageFallback(...args);
	}
	function createContentFeatures({ windowObj, documentObj, navigatorObj, qs, qsa, createElement, clearElement, installPreviewImageFallback, installPreviewVotePanels }) {
		const ANSI_COLORS = [
			"black",
			"red",
			"green",
			"yellow",
			"blue",
			"magenta",
			"cyan",
			"white"
		];
		const NodeCtor = windowObj.Node;
		function createAnsiState() {
			return {
				fg: "",
				bg: "",
				bold: false,
				dim: false,
				italic: false,
				underline: false,
				strike: false,
				hidden: false,
				inverse: false
			};
		}
		function applyAnsiCodes(state, rawCodes) {
			const codes = rawCodes.length ? rawCodes : [0];
			for (let index = 0; index < codes.length; index += 1) {
				const code = Number(codes[index]);
				if (!Number.isFinite(code)) continue;
				if (code === 0) Object.assign(state, createAnsiState());
				else if (code === 1) state.bold = true;
				else if (code === 2) state.dim = true;
				else if (code === 3) state.italic = true;
				else if (code === 4) state.underline = true;
				else if (code === 7) state.inverse = true;
				else if (code === 8) state.hidden = true;
				else if (code === 9) state.strike = true;
				else if (code === 22) {
					state.bold = false;
					state.dim = false;
				} else if (code === 23) state.italic = false;
				else if (code === 24) state.underline = false;
				else if (code === 27) state.inverse = false;
				else if (code === 28) state.hidden = false;
				else if (code === 29) state.strike = false;
				else if (code === 39) state.fg = "";
				else if (code === 49) state.bg = "";
				else if (code >= 30 && code <= 37) state.fg = ANSI_COLORS[code - 30];
				else if (code >= 40 && code <= 47) state.bg = ANSI_COLORS[code - 40];
				else if (code >= 90 && code <= 97) state.fg = `bright-${ANSI_COLORS[code - 90]}`;
				else if (code >= 100 && code <= 107) state.bg = `bright-${ANSI_COLORS[code - 100]}`;
				else if (code === 38 || code === 48) {
					const mode = Number(codes[index + 1]);
					index += mode === 5 ? 2 : mode === 2 ? 4 : 0;
				}
			}
		}
		function getAnsiClasses(state) {
			return [
				state.fg && `xns-ansi-fg-${state.fg}`,
				state.bg && `xns-ansi-bg-${state.bg}`,
				state.bold && "xns-ansi-bold",
				state.dim && "xns-ansi-dim",
				state.italic && "xns-ansi-italic",
				state.underline && "xns-ansi-underline",
				state.strike && "xns-ansi-strike",
				state.hidden && "xns-ansi-hidden",
				state.inverse && "xns-ansi-inverse"
			].filter(Boolean);
		}
		function appendAnsiText(code, text, state) {
			if (!text) return;
			const classes = getAnsiClasses(state);
			if (!classes.length) {
				code.appendChild(documentObj.createTextNode(text));
				return;
			}
			const span = createElement("span", classes.join(" "));
			span.textContent = text;
			code.appendChild(span);
		}
		function isAnsiCodeBlock(pre) {
			const code = qs(pre, ":scope > code") || qs(pre, "code");
			const className = `${String(pre.className || "")} ${String(code?.className || "")}`;
			return Boolean(code && /(?:^|\s)(?:language-ansi|lang-ansi|ansi)(?:\s|$)/i.test(className));
		}
		function serializeAnsiNode(node) {
			if (node.nodeType === NodeCtor.TEXT_NODE) return node.nodeValue || "";
			if (node.nodeType !== NodeCtor.ELEMENT_NODE) return "";
			let output = "";
			if (node.matches("span[data-ansicode]")) {
				const code = Number(node.getAttribute("data-ansicode"));
				if (Number.isInteger(code) && code >= 0 && code <= 127) output += String.fromCharCode(code);
			}
			Array.from(node.childNodes).forEach((child) => {
				output += serializeAnsiNode(child);
			});
			return output;
		}
		function renderAnsiCodeBlock(pre) {
			if (!isAnsiCodeBlock(pre)) return;
			const code = qs(pre, ":scope > code") || qs(pre, "code");
			if (!code || code.dataset.xnsAnsiRendered === "true") return;
			const source = serializeAnsiNode(code).replace(/\u0008/g, "").replace(/\u000d\u000a?/g, "\n").replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, "");
			clearElement(code);
			const state = createAnsiState();
			const ansiPattern = /\u001b\[([0-9;]*)m/g;
			let cursor = 0;
			let match;
			while (match = ansiPattern.exec(source)) {
				appendAnsiText(code, source.slice(cursor, match.index), state);
				applyAnsiCodes(state, match[1].split(";").filter((value) => value !== "").map(Number));
				cursor = ansiPattern.lastIndex;
			}
			appendAnsiText(code, source.slice(cursor), state);
			code.dataset.xnsAnsiRendered = "true";
		}
		function queryPreviewContent(root, selector, options = {}) {
			if (!root) return [];
			const isPreviewRoot = root.matches?.(".xns-preview-content") || root.closest?.(".xns-preview-content");
			let querySelector = selector;
			if (isPreviewRoot) querySelector = selector.split(",").map((part) => part.trim().replace(/^\.xns-preview-content\s+/, "")).join(", ");
			const matches = [];
			if (root.matches?.(selector)) matches.push(root);
			matches.push(...qsa(root, querySelector));
			const owner = root.matches?.(".content-item") ? root : null;
			return matches.filter((node) => {
				if (owner && node.closest?.(".content-item") !== owner) return false;
				if (options.skipRemote && (node.matches?.("[data-xns-remote]") || node.closest?.("[data-xns-remote]"))) return false;
				return true;
			});
		}
		function installPreviewAnsiBlocks(root, options = {}) {
			queryPreviewContent(root, ".xns-preview-content pre", options).forEach(renderAnsiCodeBlock);
		}
		function installPreviewMagicTabs(root, options = {}) {
			queryPreviewContent(root, ".xns-preview-content .nsk-magic-tabs", options).forEach((tabs) => {
				if (tabs.dataset.xnsMagicTabsBound === "true") return;
				const titles = qsa(tabs, ":scope > .nsk-magic-tab-title");
				const bodies = qsa(tabs, ":scope > .nsk-magic-tab-body");
				if (!titles.length || titles.length !== bodies.length) return;
				const activate = (selected) => {
					titles.forEach((title, index) => {
						const active = index === selected;
						title.classList.toggle("xns-active", active);
						title.setAttribute("aria-selected", active ? "true" : "false");
						bodies[index].classList.toggle("xns-active", active);
						bodies[index].setAttribute("aria-hidden", active ? "false" : "true");
					});
				};
				titles.forEach((title, index) => {
					title.setAttribute("role", "tab");
					title.setAttribute("tabindex", "0");
					title.addEventListener("click", () => activate(index));
					title.addEventListener("keydown", (event) => {
						if (event.key === "Enter" || event.key === " ") {
							event.preventDefault();
							activate(index);
						}
					});
				});
				bodies.forEach((body) => body.setAttribute("role", "tabpanel"));
				activate(0);
				tabs.dataset.xnsMagicTabsBound = "true";
			});
		}
		function getDirectiveText(node) {
			if (!node || node.nodeType !== NodeCtor.ELEMENT_NODE || node.matches("pre, code")) return "";
			return (node.textContent || "").trim().replace(/\s+/g, " ");
		}
		function getMarkdownTabLabel(text) {
			return /^:::\s*tab-item(?:\s+(.+?))?\s*$/i.exec(text)?.[1]?.trim() || "标签页";
		}
		function installPreviewMarkdownTabs(root, options = {}) {
			queryPreviewContent(root, ".xns-preview-content .post-content, .xns-preview-content article.post-content", options).forEach((content) => {
				if (content.dataset.xnsTabsBound === "true") return;
				const children = Array.from(content.children);
				const start = children.findIndex((node) => getDirectiveText(node) === ":::: tabs");
				if (start < 0) return;
				const tabs = [];
				const markers = [children[start]];
				let current = null;
				let end = -1;
				for (let index = start + 1; index < children.length; index += 1) {
					const node = children[index];
					const text = getDirectiveText(node);
					if (/^:::\s*tab-item(?:\s+(.+?))?\s*$/i.exec(text)) {
						current = {
							label: getMarkdownTabLabel(text),
							nodes: []
						};
						tabs.push(current);
						markers.push(node);
						continue;
					}
					if (text === ":::") {
						markers.push(node);
						current = null;
						continue;
					}
					if (text === "::::") {
						markers.push(node);
						end = index;
						break;
					}
					if (current) current.nodes.push(node);
				}
				if (end < 0 || !tabs.length) return;
				const wrapper = createElement("section", "xns-markdown-tabs");
				const nav = createElement("div", "xns-markdown-tabs-nav");
				nav.setAttribute("role", "tablist");
				wrapper.appendChild(nav);
				content.insertBefore(wrapper, children[start]);
				tabs.forEach((tab, tabIndex) => {
					const button = createElement("button", "xns-markdown-tab", tab.label);
					const panel = createElement("div", "xns-markdown-tab-panel");
					const active = tabIndex === 0;
					button.type = "button";
					button.setAttribute("role", "tab");
					button.setAttribute("aria-selected", active ? "true" : "false");
					panel.setAttribute("role", "tabpanel");
					if (active) {
						button.classList.add("is-active");
						panel.classList.add("is-active");
					}
					tab.nodes.forEach((node) => panel.appendChild(node));
					button.addEventListener("click", () => {
						Array.from(nav.children).forEach((item, index) => {
							const selected = index === tabIndex;
							item.classList.toggle("is-active", selected);
							item.setAttribute("aria-selected", selected ? "true" : "false");
						});
						Array.from(wrapper.querySelectorAll(".xns-markdown-tab-panel")).forEach((item, index) => {
							item.classList.toggle("is-active", index === tabIndex);
						});
					});
					nav.appendChild(button);
					wrapper.appendChild(panel);
				});
				markers.forEach((node) => node.remove());
				content.dataset.xnsTabsBound = "true";
			});
		}
		function fallbackCopyText(text) {
			const textarea = createElement("textarea");
			textarea.value = text;
			textarea.setAttribute("readonly", "");
			textarea.style.position = "fixed";
			textarea.style.top = "-10000px";
			textarea.style.left = "-10000px";
			textarea.style.opacity = "0";
			documentObj.body.appendChild(textarea);
			textarea.focus();
			textarea.select();
			let copied = false;
			try {
				copied = documentObj.execCommand("copy");
			} catch {
				copied = false;
			}
			textarea.remove();
			return copied;
		}
		function copyText(text) {
			if (navigatorObj.clipboard?.writeText) return navigatorObj.clipboard.writeText(text).catch(() => {
				if (!fallbackCopyText(text)) throw new Error("copy failed");
			});
			return fallbackCopyText(text) ? Promise.resolve() : Promise.reject(new Error("copy failed"));
		}
		function installPreviewCodeBlocks(root, options = {}) {
			queryPreviewContent(root, ".xns-preview-content pre", options).forEach((pre) => {
				if (pre.dataset.xnsCodeBound === "true") return;
				const code = qs(pre, ":scope > code") || qs(pre, "code");
				if (!code) return;
				pre.dataset.xnsCodeBound = "true";
				pre.classList.add("xns-code-block");
				const button = createElement("button", "xns-code-copy-btn", "复制");
				button.type = "button";
				button.setAttribute("aria-label", "复制代码");
				button.addEventListener("click", (event) => {
					event.preventDefault();
					event.stopPropagation();
					const text = code.innerText ?? code.textContent ?? "";
					button.disabled = true;
					copyText(text).then(() => {
						button.textContent = "已复制";
						button.classList.remove("xns-copy-failed");
					}).catch(() => {
						button.textContent = "复制失败";
						button.classList.add("xns-copy-failed");
					}).finally(() => {
						windowObj.setTimeout(() => {
							if (!button.isConnected) return;
							button.disabled = false;
							button.textContent = "复制";
							button.classList.remove("xns-copy-failed");
						}, 2e3);
					});
				});
				pre.appendChild(button);
			});
		}
		function installPreviewFeatures(root, options = {}) {
			installPreviewMagicTabs(root, options);
			installPreviewMarkdownTabs(root, options);
			installPreviewAnsiBlocks(root, options);
			installPreviewImageFallback(root, options);
			installPreviewCodeBlocks(root, options);
			installPreviewVotePanels(root, options);
		}
		return Object.freeze({
			installPreviewFeatures,
			installPreviewCodeBlocks
		});
	}
	var xnsContentFeatures = createContentFeatures({
		windowObj: window,
		documentObj: document,
		navigatorObj: navigator,
		qs,
		qsa,
		createElement,
		clearElement,
		installPreviewImageFallback,
		installPreviewVotePanels
	});
	function installPreviewFeatures(...args) {
		return xnsContentFeatures.installPreviewFeatures(...args);
	}
	function createPreviewModalUi({ windowObj, documentObj, state, createElement, closeImageLightbox }) {
		function removeBodyLock() {
			if (!state.modal) documentObj.documentElement.style.removeProperty("overflow");
		}
		function createScrollArrow(points) {
			const svg = documentObj.createElementNS("http://www.w3.org/2000/svg", "svg");
			svg.setAttribute("viewBox", "0 0 24 24");
			svg.setAttribute("aria-hidden", "true");
			const polyline = documentObj.createElementNS("http://www.w3.org/2000/svg", "polyline");
			polyline.setAttribute("points", points);
			svg.appendChild(polyline);
			return svg;
		}
		function createRefreshArrow() {
			const svg = documentObj.createElementNS("http://www.w3.org/2000/svg", "svg");
			svg.setAttribute("viewBox", "0 0 24 24");
			svg.setAttribute("aria-hidden", "true");
			const path = documentObj.createElementNS("http://www.w3.org/2000/svg", "path");
			path.setAttribute("d", "M20 11a8 8 0 1 1-2.34-5.66");
			const polyline = documentObj.createElementNS("http://www.w3.org/2000/svg", "polyline");
			polyline.setAttribute("points", "20 4 20 11 13 11");
			svg.append(path, polyline);
			return svg;
		}
		function createRefreshButton(onClick) {
			const button = createElement("button", "xns-modal-tool xns-refresh-post");
			button.type = "button";
			button.title = "刷新帖子";
			button.setAttribute("aria-label", "刷新帖子");
			button.append(createRefreshArrow(), createElement("span", "xns-modal-tool-label", "刷新"));
			button.addEventListener("click", onClick);
			return button;
		}
		function createShareButton(onClick) {
			const button = createElement("button", "xns-modal-tool xns-modal-share");
			button.type = "button";
			button.title = "复制帖子链接";
			button.setAttribute("aria-label", "复制帖子链接");
			const label = createElement("span", "xns-modal-tool-label", "分享");
			button.append(createCopyIcon(), label);
			button.addEventListener("click", () => {
				onClick?.({ setLabel: (value) => {
					label.textContent = value;
				} });
			});
			return button;
		}
		function createCopyIcon() {
			const svg = documentObj.createElementNS("http://www.w3.org/2000/svg", "svg");
			svg.setAttribute("viewBox", "0 0 24 24");
			svg.setAttribute("aria-hidden", "true");
			const back = documentObj.createElementNS("http://www.w3.org/2000/svg", "rect");
			back.setAttribute("x", "5");
			back.setAttribute("y", "5");
			back.setAttribute("width", "11");
			back.setAttribute("height", "13");
			back.setAttribute("rx", "2");
			const front = documentObj.createElementNS("http://www.w3.org/2000/svg", "path");
			front.setAttribute("d", "M9 5V4a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-2");
			svg.append(back, front);
			return svg;
		}
		function installPreviewScrollButtons(dialog, body) {
			const group = createElement("div", "xns-preview-scroll-btns");
			group.setAttribute("role", "toolbar");
			group.setAttribute("aria-label", "阅读导航");
			const top = createElement("button", "xns-scroll-btn xns-to-top");
			top.type = "button";
			top.title = "回到顶部";
			top.setAttribute("aria-label", "回到顶部");
			top.setAttribute("data-xns-tip", "回到顶部");
			top.appendChild(createScrollArrow("18 15 12 9 6 15"));
			const bottom = createElement("button", "xns-scroll-btn xns-to-bottom");
			bottom.type = "button";
			bottom.title = "回到底部";
			bottom.setAttribute("aria-label", "回到底部");
			bottom.setAttribute("data-xns-tip", "回到底部");
			bottom.appendChild(createScrollArrow("6 9 12 15 18 9"));
			const scrollTo = (edge) => {
				const topPosition = edge === "bottom" ? Math.max(0, body.scrollHeight - body.clientHeight) : 0;
				body.scrollTo({
					top: topPosition,
					behavior: "smooth"
				});
			};
			top.addEventListener("click", () => scrollTo("top"));
			bottom.addEventListener("click", () => scrollTo("bottom"));
			group.append(top, bottom);
			dialog.appendChild(group);
			const update = () => {
				const distanceFromBottom = body.scrollHeight - (body.scrollTop + body.clientHeight);
				top.classList.toggle("hidden", body.scrollTop <= 300);
				bottom.classList.toggle("hidden", distanceFromBottom <= 300);
			};
			const cleanup = () => {
				body.removeEventListener("scroll", update);
				windowObj.removeEventListener("resize", update);
				mutationObserver?.disconnect();
				resizeObserver?.disconnect();
				group.remove();
			};
			const mutationObserver = windowObj.MutationObserver ? new windowObj.MutationObserver(update) : null;
			const resizeObserver = windowObj.ResizeObserver ? new windowObj.ResizeObserver(update) : null;
			body.addEventListener("scroll", update, { passive: true });
			windowObj.addEventListener("resize", update, { passive: true });
			mutationObserver?.observe(body, {
				childList: true,
				subtree: true
			});
			resizeObserver?.observe(body);
			windowObj.setTimeout(update, 0);
			update();
			return cleanup;
		}
		function closeModal() {
			closeImageLightbox();
			state.modal?.requestController?.abort();
			state.modal?.replySyncController?.abort();
			state.modal?.featureCleanup?.();
			state.modal?.refreshScrollCleanup?.();
			state.modal?.scrollCleanup?.();
			state.modal?.overlay?.remove();
			state.modal = null;
			removeBodyLock();
		}
		function createCloseButton(onClick) {
			const button = createElement("button", "xns-modal-close", "×");
			button.type = "button";
			button.setAttribute("aria-label", "关闭");
			button.title = "关闭预览（Esc）";
			button.addEventListener("click", onClick);
			return button;
		}
		return Object.freeze({
			removeBodyLock,
			installPreviewScrollButtons,
			closeModal,
			createCloseButton,
			createRefreshButton,
			createShareButton
		});
	}
	var xnsPreviewModalUi = createPreviewModalUi({
		windowObj: window,
		documentObj: document,
		state,
		createElement,
		closeImageLightbox
	});
	function installPreviewScrollButtons(...args) {
		return xnsPreviewModalUi.installPreviewScrollButtons(...args);
	}
	function closeModal(...args) {
		return xnsPreviewModalUi.closeModal(...args);
	}
	function createCloseButton(...args) {
		return xnsPreviewModalUi.createCloseButton(...args);
	}
	function createRefreshButton(...args) {
		return xnsPreviewModalUi.createRefreshButton(...args);
	}
	function createShareButton(...args) {
		return xnsPreviewModalUi.createShareButton(...args);
	}
	function createPreviewRenderUtils({ qs, qsa, createElement, buildPostUrl }) {
		function stripRenderArtifacts(item) {
			if (!item?.classList) return;
			qsa(item, ".xns-reply-list, .xns-remote-floor-link").forEach((node) => node.remove());
			item.classList.remove("xns-comment-root", "xns-comment-child", "xns-floor-highlight");
			item.removeAttribute("data-xns-floor");
			item.removeAttribute("data-xns-depth");
			item.removeAttribute("data-xns-parent-floor");
			item.removeAttribute("data-xns-remote");
			item.removeAttribute("data-xns-source-page");
			item.style.removeProperty("--xns-indent");
		}
		function setFloorLinkUrl(source, record, postId) {
			if (!source) return;
			const url = buildPostUrl(postId, record.page, record.floor);
			if (!url) return;
			source.href = url.href;
			source.target = "_blank";
			source.rel = "noopener noreferrer";
			source.title = `打开原楼层 #${record.floor}`;
			source.setAttribute("aria-label", `打开原楼层 #${record.floor}`);
		}
		function addRemoteNote(record, postId, remote = record.node?.hasAttribute("data-xns-remote")) {
			if (!record.node) return;
			const floorLinks = qsa(record.node, ".floor-link-wrapper > .floor-link, .nsk-content-meta-info .floor-link");
			const existing = floorLinks.find((link) => link.closest(".floor-link-wrapper")) || floorLinks[0] || null;
			if (!remote) {
				floorLinks.forEach((link) => setFloorLinkUrl(link, record, postId));
				return;
			}
			const meta = qs(record.node, ":scope > .nsk-content-meta-info");
			let source = existing;
			let wrapper = source?.closest(".floor-link-wrapper");
			if (!source) {
				wrapper = createElement("div", "floor-link-wrapper");
				source = createElement("a", "floor-link", `#${record.floor}`);
				wrapper.appendChild(source);
				(meta || record.node).appendChild(wrapper);
			} else {
				source.textContent = `#${record.floor}`;
				wrapper = wrapper || (() => {
					const created = createElement("div", "floor-link-wrapper");
					source.replaceWith(created);
					created.appendChild(source);
					return created;
				})();
			}
			setFloorLinkUrl(source, record, postId);
			qsa(record.node, ".floor-link-wrapper > .floor-link, .nsk-content-meta-info .floor-link").forEach((link) => setFloorLinkUrl(link, record, postId));
			wrapper?.classList.add("xns-remote-floor-link");
		}
		return Object.freeze({
			stripRenderArtifacts,
			addRemoteNote
		});
	}
	var xnsPreviewRenderUtils = createPreviewRenderUtils({
		qs,
		qsa,
		createElement,
		buildPostUrl
	});
	function stripRenderArtifacts(...args) {
		return xnsPreviewRenderUtils.stripRenderArtifacts(...args);
	}
	function addRemoteNote(...args) {
		return xnsPreviewRenderUtils.addRemoteNote(...args);
	}
	function createCommentVirtualizer({ windowObj, documentObj, createElement, estimatedHeight = 150, overscanScreens = 2 } = {}) {
		let host = null;
		let entries = [];
		let renderItem = null;
		let onMount = null;
		let onUnmount = null;
		let isPinned = null;
		let getViewport = null;
		let viewport = null;
		let frame = 0;
		let destroyed = false;
		let forceIndex = null;
		const mounted = new Map();
		const heights = new Map();
		const keyOf = (entry) => {
			const record = entry?.record || entry;
			return `${record?.postId || ""}:${record?.floor ?? ""}`;
		};
		const isWindowViewport = (value) => !value || value === windowObj || value === windowObj.window;
		function getHeight(index) {
			return Math.max(1, Number(heights.get(keyOf(entries[index]))) || Number(estimatedHeight) || 1);
		}
		function sumHeights(start, end) {
			let total = 0;
			for (let index = Math.max(0, start); index < Math.min(entries.length, end); index += 1) total += getHeight(index);
			return total;
		}
		function findIndexAtOffset(offset) {
			const target = Math.max(0, Number(offset) || 0);
			let passed = 0;
			for (let index = 0; index < entries.length; index += 1) {
				const next = passed + getHeight(index);
				if (target < next) return index;
				passed = next;
			}
			return entries.length;
		}
		function resolveViewport() {
			return (typeof getViewport === "function" ? getViewport() : viewport) || windowObj;
		}
		function getHostOffset(nextViewport) {
			if (isWindowViewport(nextViewport)) return (host?.getBoundingClientRect?.().top || 0) + (Number(windowObj.scrollY) || 0);
			const scrollTop = Math.max(0, Number(nextViewport.scrollTop) || 0);
			const hostRect = host?.getBoundingClientRect?.();
			const viewportRect = nextViewport.getBoundingClientRect?.();
			if (!hostRect || !viewportRect) return Math.max(0, Number(host?.offsetTop) || 0);
			return Math.max(0, hostRect.top - viewportRect.top - (Number(nextViewport.clientTop) || 0) + scrollTop);
		}
		function getViewportMetrics() {
			const nextViewport = resolveViewport();
			if (nextViewport !== viewport) bindViewport(nextViewport);
			if (isWindowViewport(nextViewport)) {
				const scrollTop = Number(windowObj.scrollY) || 0;
				const hostTop = getHostOffset(nextViewport);
				const height = Math.max(1, Number(windowObj.innerHeight) || 800);
				return {
					start: Math.max(0, scrollTop - hostTop),
					end: Math.max(0, scrollTop - hostTop) + height,
					height
				};
			}
			const height = Math.max(1, Number(nextViewport.clientHeight) || 800);
			const scrollTop = Math.max(0, Number(nextViewport.scrollTop) || 0);
			const start = Math.max(0, scrollTop - getHostOffset(nextViewport));
			return {
				start,
				end: start + height,
				height
			};
		}
		function createSpacer(height) {
			const spacer = createElement("li", "xns-virtual-spacer");
			spacer.setAttribute("aria-hidden", "true");
			spacer.style.height = `${Math.max(0, Math.round(height))}px`;
			return spacer;
		}
		function defaultPinned(node) {
			if (!node) return false;
			if (node.hasAttribute("data-xns-pinned")) return true;
			if (node.querySelector(".xns-preview-composer, [aria-expanded=\"true\"]")) return true;
			return Array.from(node.querySelectorAll("video")).some((video) => !video.paused);
		}
		function scheduleRender() {
			if (destroyed || frame) return;
			frame = windowObj.requestAnimationFrame(() => {
				frame = 0;
				renderWindow();
			});
		}
		function measureNode(node) {
			if (!node?.getBoundingClientRect) return 0;
			let height = node.getBoundingClientRect().height;
			try {
				const style = windowObj.getComputedStyle(node);
				height += Number.parseFloat(style.marginTop) || 0;
				height += Number.parseFloat(style.marginBottom) || 0;
			} catch {}
			return Math.max(1, height);
		}
		const resizeObserver = typeof windowObj.ResizeObserver === "function" ? new windowObj.ResizeObserver((observations) => {
			let changed = false;
			observations.forEach((observation) => {
				const index = Array.from(mounted.entries()).find(([, node]) => node === observation.target)?.[0];
				if (index === void 0) return;
				const key = keyOf(entries[index]);
				const height = measureNode(observation.target);
				if (Math.abs((heights.get(key) || 0) - height) > 1) {
					heights.set(key, height);
					changed = true;
				}
			});
			if (changed) scheduleRender();
		}) : null;
		function unmount(index) {
			const node = mounted.get(index);
			if (!node) return;
			resizeObserver?.unobserve(node);
			mounted.delete(index);
			onUnmount?.(node, entries[index], index);
		}
		function renderWindow() {
			if (destroyed || !host) return;
			if (!entries.length) {
				mounted.forEach((_, index) => unmount(index));
				host.replaceChildren();
				return;
			}
			const metrics = getViewportMetrics();
			const overscan = Math.max(metrics.height, metrics.height * Math.max(0, Number(overscanScreens) || 0));
			let start = findIndexAtOffset(metrics.start - overscan);
			let end = findIndexAtOffset(metrics.end + overscan) + 1;
			if (start >= entries.length) start = Math.max(0, entries.length - 1);
			end = Math.min(entries.length, Math.max(start + 1, end));
			const pin = typeof isPinned === "function" ? isPinned : defaultPinned;
			const desired = new Set();
			for (let index = start; index < end; index += 1) desired.add(index);
			if (forceIndex !== null && forceIndex >= 0 && forceIndex < entries.length) desired.add(forceIndex);
			mounted.forEach((node, index) => {
				if (pin(node, entries[index], index)) desired.add(index);
			});
			mounted.forEach((_, index) => {
				if (!desired.has(index)) unmount(index);
			});
			const newlyMounted = [];
			Array.from(desired).sort((a, b) => a - b).forEach((index) => {
				if (mounted.has(index)) return;
				const node = renderItem?.(entries[index], index);
				if (!node) return;
				mounted.set(index, node);
				newlyMounted.push({
					index,
					node
				});
			});
			const fragment = documentObj.createDocumentFragment();
			let cursor = 0;
			Array.from(desired).sort((a, b) => a - b).forEach((index) => {
				if (index > cursor) fragment.appendChild(createSpacer(sumHeights(cursor, index)));
				const node = mounted.get(index);
				if (node) fragment.appendChild(node);
				cursor = index + 1;
			});
			if (cursor < entries.length) fragment.appendChild(createSpacer(sumHeights(cursor, entries.length)));
			host.replaceChildren(fragment);
			newlyMounted.forEach(({ index, node }) => {
				resizeObserver?.observe(node);
				onMount?.(node, entries[index], index);
				const height = measureNode(node);
				const key = keyOf(entries[index]);
				if (Math.abs((heights.get(key) || 0) - height) > 1) heights.set(key, height);
			});
		}
		function bindViewport(nextViewport) {
			if (nextViewport === viewport) return;
			if (viewport?.removeEventListener) {
				viewport.removeEventListener("scroll", scheduleRender);
				viewport.removeEventListener("load", scheduleRender, true);
				viewport.removeEventListener("error", scheduleRender, true);
			}
			viewport = nextViewport || windowObj;
			viewport?.addEventListener?.("scroll", scheduleRender, { passive: true });
			viewport?.addEventListener?.("load", scheduleRender, true);
			viewport?.addEventListener?.("error", scheduleRender, true);
		}
		function setEntries(nextEntries, options = {}) {
			if (destroyed) return;
			if (typeof options.renderItem === "function") renderItem = options.renderItem;
			if (typeof options.onMount === "function") onMount = options.onMount;
			if (typeof options.onUnmount === "function") onUnmount = options.onUnmount;
			if (typeof options.isPinned === "function") isPinned = options.isPinned;
			if (typeof options.getViewport === "function") getViewport = options.getViewport;
			const normalized = Array.isArray(nextEntries) ? nextEntries.map((entry, index) => ({
				...entry,
				index
			})) : [];
			const nextKeys = new Set(normalized.map(keyOf));
			mounted.forEach((_, index) => {
				const oldKey = keyOf(entries[index]);
				const nextKey = keyOf(normalized[index]);
				if (!nextKeys.has(oldKey) || oldKey !== nextKey) unmount(index);
			});
			entries = normalized;
			host?.classList.add("xns-virtual-list");
			host?.setAttribute("data-xns-virtual-count", String(entries.length));
			renderWindow();
		}
		function mount(nextHost, options = {}) {
			if (destroyed) return api;
			host = nextHost;
			if (typeof options.renderItem === "function") renderItem = options.renderItem;
			if (typeof options.onMount === "function") onMount = options.onMount;
			if (typeof options.onUnmount === "function") onUnmount = options.onUnmount;
			if (typeof options.isPinned === "function") isPinned = options.isPinned;
			if (typeof options.getViewport === "function") getViewport = options.getViewport;
			host?.classList.add("xns-virtual-list");
			host?.setAttribute("data-xns-virtual-count", String(entries.length));
			if (host) host.__xnsVirtualizer = api;
			renderWindow();
			return api;
		}
		function scrollToIndex(index, behavior = "smooth") {
			if (!host || index < 0 || index >= entries.length) return null;
			forceIndex = index;
			renderWindow();
			const nextViewport = resolveViewport();
			const offset = sumHeights(0, index);
			if (isWindowViewport(nextViewport)) {
				const top = getHostOffset(nextViewport) + offset;
				windowObj.scrollTo?.({
					top,
					behavior
				});
			} else nextViewport.scrollTo?.({
				top: getHostOffset(nextViewport) + offset,
				behavior
			});
			forceIndex = null;
			scheduleRender();
			return mounted.get(index) || null;
		}
		function scrollToFloor(floor) {
			const index = entries.findIndex((entry) => String(entry.record?.floor) === String(floor));
			return index < 0 ? null : scrollToIndex(index, "auto");
		}
		function destroy() {
			if (destroyed) return;
			destroyed = true;
			if (frame) windowObj.cancelAnimationFrame(frame);
			if (viewport?.removeEventListener) {
				viewport.removeEventListener("scroll", scheduleRender);
				viewport.removeEventListener("load", scheduleRender, true);
				viewport.removeEventListener("error", scheduleRender, true);
			}
			resizeObserver?.disconnect();
			mounted.forEach((_, index) => unmount(index));
			mounted.clear();
			if (host?.__xnsVirtualizer === api) delete host.__xnsVirtualizer;
			host?.classList.remove("xns-virtual-list");
			host?.removeAttribute("data-xns-virtual-count");
			host?.replaceChildren();
		}
		const api = Object.freeze({
			mount,
			setEntries,
			scrollToIndex,
			scrollToFloor,
			destroy
		});
		return api;
	}
	function createPageStatusFormatter({ maxPage, getMaxPage }) {
		function format(options = {}) {
			const configuredLimit = Number(options.pageLimit) || Number(getMaxPage?.()) || maxPage;
			const pageLimit = Math.min(maxPage, Math.max(1, configuredLimit));
			const totalPages = Number(options.totalPages) || 0;
			const loadedPages = Math.max(0, Number(options.loadedPages) || 0);
			const failedCount = Array.isArray(options.failedPages) ? options.failedPages.length : 0;
			const targetPages = Math.min(pageLimit, totalPages || loadedPages);
			const pageProgress = targetPages ? `已读取 ${loadedPages}/${targetPages} 页` : "";
			const stage = options.loading ? pageProgress ? `正在读取其他分页 · ${pageProgress}` : "正在读取其他分页…" : pageProgress;
			const failed = failedCount ? `${failedCount} 页读取失败` : "";
			const challengeCount = Array.isArray(options.challengePages) ? options.challengePages.length : 0;
			const challenge = challengeCount ? `${challengeCount} 页被 Cloudflare 验证拦截，请完成验证后重试` : "";
			const truncated = options.truncated ? `帖子共 ${totalPages || pageLimit} 页，仅读取前 ${pageLimit} 页，后面的内容没有显示` : "";
			const detail = [
				stage,
				failed,
				challenge,
				truncated
			].filter(Boolean).join(" · ");
			return {
				targetPages,
				loadedPages,
				failedCount,
				stage,
				failed,
				challenge,
				challengeCount,
				truncated,
				detail,
				compact: [
					Number.isFinite(options.commentCount) ? `${options.commentCount} 条回复` : "",
					failedCount ? `${failedCount} 页失败` : "",
					challengeCount ? `${challengeCount} 页需验证` : ""
				].filter(Boolean).join(" · ") || detail,
				tone: failedCount ? "is-failed" : ""
			};
		}
		return Object.freeze({ format });
	}
	var xnsPageStatusFormatter = createPageStatusFormatter({
		maxPage: 50,
		getMaxPage
	});
	function formatPageStatus(...args) {
		return xnsPageStatusFormatter.format(...args);
	}
	function createPreviewRenderer({ document, windowObj, pageInfo, selectors, maxPage, qs, qsa, createElement, clearElement, getPostInfo, buildPostUrl, getDocState, getCommentId, getSsrCommentCounts, safeCount, sanitizeImportedNode, materializeCommentNode, getDirectCommentMenu, ensurePreviewMenu, stripRenderArtifacts, buildReplyTree, flattenReplyTree, createCommentVirtualizer, addRemoteNote, formatPageStatus }) {
		function ensurePreviewEditOption(node, record) {
			if (!node || !record?.isMine) return;
			const menu = getDirectCommentMenu(node);
			if (!menu) return;
			let item = qsa(menu, ":scope > .menu-item").find((el) => (el.textContent || "").trim() === "编辑" && !el.dataset?.xnsAction);
			if (record.current && item) {
				item.setAttribute("aria-label", "编辑");
				return;
			}
			if (!item) {
				item = createElement("span", "menu-item");
				item.setAttribute("role", "button");
				item.tabIndex = 0;
				item.innerHTML = "<svg class=\"iconpark-icon\" aria-hidden=\"true\"><use href=\"#edit\"></use></svg><span>编辑</span>";
				menu.appendChild(item);
			}
			item.setAttribute("aria-label", "编辑");
			if (record.current) return;
			if (item.dataset.xnsEditBound === "true") return;
			item.dataset.xnsEditBound = "true";
			item.addEventListener("click", (event) => {
				event.preventDefault();
				event.stopPropagation();
				const postId = record.postId || pageInfo?.postId || getPostInfo(windowObj.location.href)?.postId || "";
				const floor = record.floor;
				const url = buildPostUrl(postId, record.page || 1, floor >= 0 ? floor : null);
				if (url) windowObj.open(url.href, "_blank", "noopener");
			});
		}
		function prepareCommentRecord(record, depth) {
			const node = materializeCommentNode(record);
			if (!node) return null;
			stripRenderArtifacts(record.node);
			node.setAttribute("data-xns-floor", String(record.floor));
			if (!record.current) {
				node.setAttribute("data-xns-remote", "true");
				node.setAttribute("data-xns-source-page", String(record.page));
			}
			node.setAttribute("data-xns-depth", String(depth));
			node.style.setProperty("--xns-indent", `${Math.min(8, Math.max(0, depth)) * 18}px`);
			node.classList.add(depth === 0 ? "xns-comment-root" : "xns-comment-child");
			if (depth > 0 && record.parent) node.setAttribute("data-xns-parent-floor", String(record.parent.floor));
			ensurePreviewMenu(node, {
				includeFavorite: false,
				counts: record.counts || void 0
			});
			ensurePreviewEditOption(node, record);
			return node;
		}
		function appendNestedRecord(record, container, depth) {
			const node = prepareCommentRecord(record, depth);
			if (!node) return;
			container.appendChild(node);
			if (!record.children.length) return;
			const replyList = createElement("ul", "xns-reply-list");
			record.children.forEach((child) => appendNestedRecord(child, replyList, depth + 1));
			node.appendChild(replyList);
		}
		function buildPreviewPostNode(parsed, info) {
			const postRoot = qs(parsed, ".nsk-post");
			let node = sanitizeImportedNode(postRoot?.matches?.(".content-item") ? postRoot : qs(postRoot, ":scope > .content-item, .content-item") || postRoot || qs(parsed, selectors.postContent), { keepCommentMenu: true });
			if (!node) return null;
			if (node.matches?.("article.post-content")) {
				const wrapper = createElement("div", "content-item");
				wrapper.appendChild(node);
				node = wrapper;
			}
			node.classList.add("content-item", "xns-preview-post", "xns-comment-root");
			node.setAttribute("data-xns-floor", "0");
			node.setAttribute("data-xns-target-type", "post");
			node.setAttribute("data-xns-post-id", info.postId);
			const floorLink = qs(node, ".floor-link-wrapper > .floor-link, .nsk-content-meta-info .floor-link");
			const floorUrl = buildPostUrl(info.postId, 1, 0);
			if (floorLink && floorUrl) {
				floorLink.href = floorUrl.href;
				floorLink.target = "_blank";
				floorLink.rel = "noopener noreferrer";
				floorLink.title = "打开原帖 #0";
				floorLink.setAttribute("aria-label", "打开原帖 #0");
			}
			const postState = getDocState(parsed);
			const postCommentId = getCommentId(node);
			const counts = postCommentId !== null && postState ? getSsrCommentCounts(postState, postCommentId) : null;
			if (counts) {
				const collectionCount = safeCount(postState?.postData?.collectionCount);
				if (collectionCount !== null) counts.favorite = collectionCount;
				if (postState?.postData?.collected) counts.collected = true;
			}
			ensurePreviewMenu(node, {
				includeFavorite: true,
				counts
			});
			return node;
		}
		function renderPreviewStatus(section, options = {}) {
			const status = formatPageStatus(options);
			const statusNode = options.statusNode || qs(section, ":scope > .xns-preview-status") || createElement("div", "xns-preview-status");
			if (!statusNode.parentNode) section.insertBefore(statusNode, qs(section, ":scope > .xns-preview-thread"));
			clearElement(statusNode);
			statusNode.className = options.statusNode ? "xns-modal-toolbar-status xns-preview-status" : "xns-preview-status";
			statusNode.removeAttribute("title");
			statusNode.setAttribute("role", "status");
			statusNode.setAttribute("aria-live", "polite");
			if (options.loading) {
				statusNode.classList.add("is-loading");
				statusNode.appendChild(createElement("span", "xns-page-loading", status.stage));
			} else if (status.stage) statusNode.appendChild(createElement("span", "xns-page-complete", status.stage));
			if (status.failed) {
				statusNode.classList.add("is-failed");
				statusNode.appendChild(createElement("span", "xns-page-failed", status.failed));
				if (typeof options.onRetry === "function") {
					const retry = createElement("button", "xns-inline-retry", "重试");
					retry.type = "button";
					retry.title = "重新读取失败分页";
					retry.setAttribute("aria-label", "重新读取失败分页");
					retry.addEventListener("click", (event) => {
						event.preventDefault();
						event.stopPropagation();
						options.onRetry();
					});
					statusNode.appendChild(retry);
				}
			}
			if (status.challenge) {
				statusNode.classList.add("is-failed");
				statusNode.appendChild(createElement("span", "xns-page-challenge", status.challenge));
			}
			if (status.truncated) {
				statusNode.classList.add("is-truncated");
				statusNode.appendChild(createElement("span", "xns-page-truncated", status.truncated));
			}
			statusNode.hidden = !statusNode.childNodes.length;
			return statusNode;
		}
		function renderPreviewRecords(section, info, records, options = {}) {
			const heading = qs(section, ":scope > h3");
			const thread = qs(section, ":scope > .xns-preview-thread");
			if (!heading || !thread) return;
			heading.textContent = `${records.length} 条回复`;
			qs(section, ":scope > .xns-preview-empty")?.remove();
			if (records.length) {
				const onNodeMounted = (node, entry) => {
					const record = entry.record;
					addRemoteNote(record, info.postId, record.page !== info.page);
					options.onNodeMounted?.(node, record);
				};
				const onNodeUnmounted = (node, entry) => {
					if (!entry.record.current) entry.record.node = null;
					options.onNodeUnmounted?.(node, entry.record);
				};
				const renderItem = (entry) => prepareCommentRecord(entry.record, entry.depth);
				const virtualizerOptions = {
					getViewport: () => thread.closest(".xns-modal-body") || windowObj,
					renderItem,
					onMount: onNodeMounted,
					onUnmount: onNodeUnmounted
				};
				const virtualizer = section.__xnsVirtualizer || createCommentVirtualizer({
					windowObj,
					documentObj: document,
					createElement,
					estimatedHeight: 135,
					overscanScreens: 2
				}).mount(thread, virtualizerOptions);
				section.__xnsVirtualizer = virtualizer;
				virtualizer.setEntries(flattenReplyTree(records), virtualizerOptions);
			} else {
				section.__xnsVirtualizer?.destroy();
				delete section.__xnsVirtualizer;
				clearElement(thread);
				section.appendChild(createElement("p", "xns-status xns-preview-empty", "没有读取到评论。"));
			}
			renderPreviewStatus(section, options);
		}
		return Object.freeze({
			ensurePreviewEditOption,
			prepareCommentRecord,
			appendNestedRecord,
			buildPreviewPostNode,
			renderPreviewStatus,
			renderPreviewRecords
		});
	}
	var xnsPreviewRenderer = createPreviewRenderer({
		document,
		windowObj: window,
		pageInfo,
		selectors: SELECTORS,
		maxPage: 50,
		qs,
		qsa,
		createElement,
		clearElement,
		getPostInfo,
		buildPostUrl,
		getDocState,
		getCommentId,
		getSsrCommentCounts,
		safeCount,
		sanitizeImportedNode,
		materializeCommentNode,
		getDirectCommentMenu,
		ensurePreviewMenu,
		stripRenderArtifacts,
		buildReplyTree,
		flattenReplyTree,
		createCommentVirtualizer,
		addRemoteNote,
		formatPageStatus
	});
	function prepareCommentRecord(...args) {
		return xnsPreviewRenderer.prepareCommentRecord(...args);
	}
	function buildPreviewPostNode(...args) {
		return xnsPreviewRenderer.buildPreviewPostNode(...args);
	}
	function renderPreviewRecords(...args) {
		return xnsPreviewRenderer.renderPreviewRecords(...args);
	}
	function createPreviewController({ windowObj, documentObj, state, selectors, maxPage, qs, qsa, createElement, clearElement, getPostInfo, buildPostUrl, sanitizeImportedNode, parseHtml, fetchHtml, getPageNumbers, collectPageRecords, loadPreviewRecords, buildPreviewPostNode, renderPreviewRecords, installPreviewFeatures, installPreviewScrollButtons, closeImageLightbox, closeModal, createCloseButton, createRefreshButton, createShareButton, openPreviewComposer }) {
		async function copyPreviewLink(url, setLabel) {
			const text = url?.href || "";
			if (!text) throw new Error("原帖链接不可用");
			if (windowObj.navigator?.clipboard?.writeText) await windowObj.navigator.clipboard.writeText(text);
			else {
				const input = documentObj.createElement("textarea");
				input.value = text;
				input.setAttribute("readonly", "");
				input.style.position = "fixed";
				input.style.opacity = "0";
				documentObj.body.appendChild(input);
				input.select();
				const copied = documentObj.execCommand?.("copy");
				input.remove();
				if (!copied) throw new Error("浏览器拒绝复制");
			}
			setLabel?.("已复制");
			windowObj.setTimeout(() => setLabel?.("分享"), 1800);
		}
		function getCanonicalPostUrl(url) {
			const info = getPostInfo(url?.href || "");
			if (!info) return url;
			return buildPostUrl(info.postId, 1) || url;
		}
		function getPreviewHeaderMeta(parsed) {
			const textOf = (node) => node?.textContent?.trim().replace(/\s+/g, " ").slice(0, 120) || "";
			const post = qs(parsed, ".nsk-post") || parsed;
			return {
				node: textOf(qs(post, "[data-node-name], .node-name, .node-title, .category-name")) || textOf(qsa(post, "a[href*=\"/node/\"], a[href*=\"/category/\"]").find((link) => textOf(link))),
				author: textOf(qs(post, ".nsk-content-meta-info a.author-name, .nsk-content-meta-info a[href*=\"/space/\"], a.author-name")),
				time: textOf(qs(post, ".nsk-content-meta-info time, .nsk-content-meta-info [datetime], time[datetime]")),
				replyCount: null
			};
		}
		function updatePreviewHeaderMeta(modal, meta) {
			if (!modal?.headerMeta) return;
			const values = {
				node: meta?.node || "",
				author: meta?.author || "",
				time: meta?.time || "",
				replies: Number.isFinite(meta?.replyCount) ? `${meta.replyCount} 条回复` : ""
			};
			Object.entries(values).forEach(([key, value]) => {
				const item = modal.headerMeta[key];
				if (!item) return;
				item.value.textContent = value;
				item.item.hidden = !value;
			});
		}
		function renderPreviewSection(section, info, records, options = {}) {
			const onNodeMounted = options.onNodeMounted;
			return renderPreviewRecords(section, info, records, {
				...options,
				onNodeMounted: (node, record) => {
					installPreviewFeatures(node);
					onNodeMounted?.(node, record);
				}
			});
		}
		function applyPreviewResult(modal, result) {
			if (!modal || !result) return;
			modal.previewRecords = Array.isArray(result.records) ? result.records : [];
			modal.loadedPages = result.loadedPages;
			modal.failedPages = Array.isArray(result.failedPages) ? result.failedPages : [];
			modal.challengePages = Array.isArray(result.challengePages) ? result.challengePages : [];
			modal.truncated = Boolean(result.truncated);
			modal.totalPages = result.totalPages;
			modal.pageLimit = result.pageLimit;
		}
		function createPreviewHeaderMeta() {
			const root = createElement("div", "xns-modal-meta");
			const items = {};
			[
				["node", "节点"],
				["author", "作者"],
				["time", "时间"],
				["replies", "回复"]
			].forEach(([key, label]) => {
				const item = createElement("span", "xns-modal-meta-item");
				item.hidden = true;
				item.append(createElement("span", "xns-modal-meta-label", label), createElement("span", "xns-modal-meta-value"));
				root.appendChild(item);
				items[key] = {
					item,
					value: item.lastElementChild
				};
			});
			return {
				root,
				items
			};
		}
		function buildPreviewContent(url, parsed, options = {}) {
			const wrapper = createElement("div", "xns-preview-content");
			const title = qs(parsed, selectors.postTitle)?.textContent?.trim() || "";
			const headerMeta = getPreviewHeaderMeta(parsed);
			const info = getPostInfo(url.href);
			const importedPost = info ? buildPreviewPostNode(parsed, info) : null;
			if (importedPost) wrapper.appendChild(importedPost);
			else {
				const importedContent = sanitizeImportedNode(qs(parsed, selectors.postContent));
				if (importedContent) wrapper.appendChild(importedContent);
				else wrapper.appendChild(createElement("p", "xns-status", "没有找到帖子正文。"));
			}
			if (!info) return {
				title,
				headerMeta,
				content: wrapper,
				hydrate: null
			};
			const currentRecords = collectPageRecords(info, parsed, info.page);
			headerMeta.replyCount = currentRecords.length;
			const knownPages = getPageNumbers(parsed, info.postId);
			const hasRemotePages = Array.from(knownPages).some((page) => page !== info.page);
			const section = createElement("section", "xns-preview-comments");
			section.appendChild(createElement("h3"));
			const thread = createElement("ul", "xns-preview-thread");
			section.appendChild(thread);
			renderPreviewSection(section, info, currentRecords, {
				loading: hasRemotePages,
				statusNode: options.statusNode,
				onRetry: options.onRetry
			});
			wrapper.appendChild(section);
			let progressiveTimer = 0;
			let pendingProgress = null;
			let renderedProgress = false;
			const renderProgress = (progress) => {
				if (!progress || !section.isConnected) return false;
				renderPreviewSection(section, info, progress.records, {
					...progress,
					statusNode: options.statusNode,
					onRetry: options.onRetry
				});
				return true;
			};
			const scheduleProgressiveRender = (progress) => {
				if (options.renderDetached === true) return;
				pendingProgress = progress;
				if (progressiveTimer) return;
				progressiveTimer = windowObj.setTimeout(() => {
					progressiveTimer = 0;
					const next = pendingProgress;
					pendingProgress = null;
					if (renderProgress(next)) renderedProgress = true;
				}, renderedProgress ? 500 : 300);
			};
			return {
				title,
				headerMeta,
				content: wrapper,
				hydrate: loadPreviewRecords(info, parsed, {
					noStore: options.noStore === true,
					allowCache: options.allowCache === true,
					initialRecords: currentRecords,
					signal: options.signal,
					onRecordsLoaded: scheduleProgressiveRender
				}).then((preview) => {
					if (progressiveTimer) windowObj.clearTimeout(progressiveTimer);
					progressiveTimer = 0;
					pendingProgress = null;
					if (section.isConnected || options.renderDetached === true) renderPreviewSection(section, info, preview.records, {
						...preview,
						statusNode: options.statusNode,
						onRetry: options.onRetry
					});
					return preview;
				})
			};
		}
		function getPreviewScrollOwners(body) {
			return qsa(body, ".xns-preview-post, .xns-preview-thread .content-item[data-comment-id], .xns-preview-thread .content-item[data-xns-floor]");
		}
		function getPreviewScrollOwner(node) {
			return node?.closest?.(".xns-preview-post, .xns-preview-thread .content-item[data-comment-id], .xns-preview-thread .content-item[data-xns-floor]") || null;
		}
		function getPreviewScrollCandidates(body) {
			const seen = new Set();
			const candidates = [];
			getPreviewScrollOwners(body).forEach((owner) => {
				[owner, ...qsa(owner, ":scope > .post-title, :scope > .nsk-content-meta-info, :scope > article.post-content > *, :scope > .post-content > *")].forEach((node) => {
					if (!node || seen.has(node) || getPreviewScrollOwner(node) !== owner) return;
					seen.add(node);
					candidates.push(node);
				});
			});
			return candidates;
		}
		function getPreviewChildPath(owner, node) {
			const path = [];
			let current = node;
			while (current && current !== owner) {
				const parent = current.parentElement;
				if (!parent) return [];
				const index = Array.prototype.indexOf.call(parent.children, current);
				if (index < 0) return [];
				path.unshift(index);
				current = parent;
			}
			return current === owner ? path : [];
		}
		function capturePreviewScroll(body) {
			const maxScrollTop = Math.max(0, body.scrollHeight - body.clientHeight);
			const snapshot = {
				scrollTop: body.scrollTop,
				maxScrollTop,
				ratio: maxScrollTop > 0 ? body.scrollTop / maxScrollTop : 0,
				atTop: body.scrollTop <= 3,
				atBottom: maxScrollTop - body.scrollTop <= 24,
				anchor: null
			};
			if (snapshot.atTop || snapshot.atBottom || maxScrollTop === 0) return snapshot;
			const bodyRect = body.getBoundingClientRect();
			const anchorLine = bodyRect.top + Math.min(12, Math.max(2, body.clientHeight * .03));
			const rows = getPreviewScrollCandidates(body).map((node) => ({
				node,
				rect: node.getBoundingClientRect()
			})).filter(({ rect }) => rect.height > 0 && rect.bottom > bodyRect.top && rect.top < bodyRect.bottom);
			const chosen = rows.filter(({ rect }) => rect.top <= anchorLine && rect.bottom > anchorLine).reduce((best, row) => !best || row.rect.top > best.rect.top ? row : best, null) || rows.filter(({ rect }) => rect.top > anchorLine).sort((left, right) => left.rect.top - right.rect.top)[0] || null;
			if (!chosen) return snapshot;
			const owner = getPreviewScrollOwner(chosen.node);
			if (!owner) return snapshot;
			const isPost = owner.matches(".xns-preview-post, [data-xns-target-type=\"post\"]");
			snapshot.anchor = {
				isPost,
				commentId: isPost ? "" : owner.getAttribute("data-comment-id") || "",
				floor: owner.getAttribute("data-xns-floor") || "",
				path: getPreviewChildPath(owner, chosen.node),
				tagName: chosen.node.tagName,
				offset: chosen.rect.top - bodyRect.top
			};
			return snapshot;
		}
		function findPreviewScrollOwner(body, anchor) {
			if (anchor.isPost) return qs(body, ".xns-preview-post, [data-xns-target-type=\"post\"]");
			if (anchor.commentId) {
				const byCommentId = qs(body, `.xns-preview-thread .content-item[data-comment-id="${CSS.escape(anchor.commentId)}"]`);
				if (byCommentId) return byCommentId;
			}
			if (anchor.floor) return qs(body, `.xns-preview-thread .content-item[data-xns-floor="${CSS.escape(anchor.floor)}"]`);
			return null;
		}
		function resolvePreviewScrollAnchor(body, anchor) {
			const owner = findPreviewScrollOwner(body, anchor);
			if (!owner) return null;
			let node = owner;
			for (const index of anchor.path || []) {
				node = node?.children?.[index] || null;
				if (!node) return owner;
			}
			return !anchor.tagName || node.tagName === anchor.tagName ? node : owner;
		}
		function restorePreviewScroll(body, snapshot) {
			if (!snapshot) return;
			const maxScrollTop = Math.max(0, body.scrollHeight - body.clientHeight);
			if (snapshot.atTop) {
				body.scrollTop = 0;
				return;
			}
			if (snapshot.atBottom) {
				body.scrollTop = maxScrollTop;
				return;
			}
			const anchor = snapshot.anchor ? resolvePreviewScrollAnchor(body, snapshot.anchor) : null;
			if (anchor) {
				const currentOffset = anchor.getBoundingClientRect().top - body.getBoundingClientRect().top;
				const targetScrollTop = body.scrollTop + currentOffset - snapshot.anchor.offset;
				body.scrollTop = Math.max(0, Math.min(targetScrollTop, maxScrollTop));
				return;
			}
			const proportional = Number.isFinite(snapshot.ratio) ? snapshot.ratio * maxScrollTop : snapshot.scrollTop;
			body.scrollTop = Math.max(0, Math.min(proportional, maxScrollTop));
		}
		function stabilizePreviewScroll(modal, snapshot, generation) {
			modal.refreshScrollCleanup?.();
			const body = modal.body;
			let active = true;
			let frame = 0;
			const timers = [];
			const imageHandlers = [];
			const apply = () => {
				frame = 0;
				if (!active || state.modal !== modal || modal.loadGeneration !== generation) return;
				restorePreviewScroll(body, snapshot);
			};
			const schedule = () => {
				if (!active || frame) return;
				frame = windowObj.requestAnimationFrame(apply);
			};
			const cleanup = () => {
				if (!active) return;
				active = false;
				if (frame) windowObj.cancelAnimationFrame(frame);
				timers.forEach((timer) => windowObj.clearTimeout(timer));
				resizeObserver?.disconnect();
				imageHandlers.forEach(({ image, done }) => {
					image.removeEventListener("load", done);
					image.removeEventListener("error", done);
				});
				[
					"wheel",
					"touchstart",
					"pointerdown",
					"keydown"
				].forEach((name) => modal.overlay.removeEventListener(name, cleanup, true));
				if (modal.refreshScrollCleanup === cleanup) modal.refreshScrollCleanup = null;
			};
			const resizeObserver = windowObj.ResizeObserver ? new windowObj.ResizeObserver(schedule) : null;
			resizeObserver?.observe(body.firstElementChild || body);
			qsa(body, "img").forEach((image) => {
				if (image.complete) return;
				const done = () => schedule();
				imageHandlers.push({
					image,
					done
				});
				image.addEventListener("load", done, { once: true });
				image.addEventListener("error", done, { once: true });
			});
			[
				"wheel",
				"touchstart",
				"pointerdown",
				"keydown"
			].forEach((name) => modal.overlay.addEventListener(name, cleanup, {
				capture: true,
				passive: true
			}));
			[
				0,
				60,
				180,
				420,
				900,
				1400
			].forEach((delay) => timers.push(windowObj.setTimeout(schedule, delay)));
			timers.push(windowObj.setTimeout(cleanup, 1800));
			modal.refreshScrollCleanup = cleanup;
			restorePreviewScroll(body, snapshot);
		}
		function showPreviewLoadError(modal, error) {
			clearElement(modal.body);
			const toolbarStatus = qs(modal.dialog, ".xns-modal-toolbar-status");
			if (toolbarStatus) {
				toolbarStatus.className = "xns-modal-toolbar-status xns-preview-status is-failed";
				toolbarStatus.hidden = false;
				const detail = error?.message || "网络错误";
				toolbarStatus.textContent = "预览加载失败";
				toolbarStatus.title = detail;
			}
			modal.body.appendChild(createElement("p", "xns-status", `预览加载失败：${error?.message || "网络错误"}`));
			if (modal.fallbackLink) {
				const link = createElement("a", "", "在原页面打开");
				link.href = modal.fallbackLink.href;
				link.target = "_blank";
				link.rel = "noopener noreferrer";
				modal.body.appendChild(link);
			}
		}
		function showPreviewRefreshError(modal, error) {
			const toolbarStatus = qs(modal.dialog, ".xns-modal-toolbar-status");
			if (toolbarStatus) {
				toolbarStatus.className = "xns-modal-toolbar-status xns-preview-status xns-refresh-status is-failed";
				toolbarStatus.hidden = false;
				const detail = error?.message || "网络错误";
				toolbarStatus.textContent = `刷新失败，保留当前内容 · ${detail}`;
				toolbarStatus.title = detail;
			}
		}
		async function syncPreviewReply(modal) {
			if (!modal || state.modal !== modal) return false;
			if (modal.loading) {
				modal.pendingReplySync = true;
				return false;
			}
			if (modal.replySyncPromise) return modal.replySyncPromise;
			const info = getPostInfo(modal.url?.href || "");
			const seed = modal.previewSeed;
			if (!info || !seed) return false;
			const knownPages = getPageNumbers(seed, info.postId);
			const discoveredLastPage = knownPages.size ? Math.max(...knownPages) : info.page;
			const lastPage = Math.max(1, Number(modal.totalPages) || discoveredLastPage || info.page || 1);
			const pages = Array.from(new Set([lastPage, lastPage + 1]));
			const controller = windowObj.AbortController ? new windowObj.AbortController() : null;
			modal.replySyncController = controller;
			modal.replySyncing = true;
			const promise = (async () => {
				const additions = [];
				let successfulReads = 0;
				for (const page of pages) {
					if (state.modal !== modal) return false;
					try {
						const response = await fetchHtml(buildPostUrl(info.postId, page), {
							noStore: true,
							allowCache: false,
							signal: controller?.signal
						});
						const parsed = parseHtml(response.html, response.url);
						additions.push(...collectPageRecords(info, parsed, page));
						successfulReads += 1;
					} catch {}
				}
				if (state.modal !== modal) return false;
				if (successfulReads === 0) return false;
				modal.previewRecords = mergeCommentRecords(modal.previewRecords, additions);
				const section = qs(modal.body, ".xns-preview-comments");
				if (section) renderPreviewSection(section, info, modal.previewRecords, {
					loadedPages: modal.loadedPages,
					failedPages: modal.failedPages,
					challengePages: modal.challengePages,
					truncated: modal.truncated,
					totalPages: modal.totalPages,
					pageLimit: modal.pageLimit,
					statusNode: modal.toolbarStatus,
					loading: false,
					onRetry: () => {
						if (state.modal === modal && !modal.loading) retryPreviewPages(modal);
					}
				});
				updatePreviewHeaderMeta(modal, {
					node: modal.headerMeta?.node?.value?.textContent || "",
					author: modal.headerMeta?.author?.value?.textContent || "",
					time: modal.headerMeta?.time?.value?.textContent || "",
					replyCount: modal.previewRecords.length
				});
				return true;
			})().catch(() => false);
			modal.replySyncPromise = promise;
			try {
				return await promise;
			} finally {
				if (modal.replySyncPromise === promise) modal.replySyncPromise = null;
				if (modal.replySyncController === controller) modal.replySyncController = null;
				modal.replySyncing = false;
			}
		}
		function getPreviewFailedPages(modal) {
			return Array.from(new Set((Array.isArray(modal?.failedPages) ? modal.failedPages : []).map((page) => Number(page)).filter((page) => Number.isInteger(page) && page >= 1))).sort((a, b) => a - b);
		}
		async function retryPreviewPages(modal) {
			if (!modal || modal.loading) return false;
			const retryPages = getPreviewFailedPages(modal);
			const info = getPostInfo(modal.url?.href || "");
			const section = qs(modal.body, ".xns-preview-comments");
			if (!retryPages.length || !info || !section || !modal.previewSeed) return false;
			const requestController = windowObj.AbortController ? new windowObj.AbortController() : null;
			modal.requestController?.abort();
			modal.requestController = requestController;
			modal.loading = true;
			const refresh = qs(modal.dialog, ".xns-refresh-post");
			const toolbarStatus = qs(modal.dialog, ".xns-modal-toolbar-status");
			refresh?.classList.add("xns-action-pending");
			refresh?.setAttribute("aria-busy", "true");
			if (toolbarStatus) {
				toolbarStatus.className = "xns-modal-toolbar-status xns-preview-status is-loading";
				toolbarStatus.hidden = false;
				toolbarStatus.removeAttribute("title");
				toolbarStatus.textContent = `正在重试 ${retryPages.length} 个失败分页…`;
			}
			const pageLimit = Math.min(maxPage, Math.max(1, Number(modal.pageLimit) || maxPage));
			const totalPages = Math.max(1, Number(modal.totalPages) || pageLimit);
			const targetPages = Math.min(pageLimit, totalPages);
			const loadedPages = Array.from({ length: targetPages }, (_, index) => index + 1).filter((page) => !retryPages.includes(page));
			const retryAgain = () => {
				if (state.modal === modal && !modal.loading) retryPreviewPages(modal);
			};
			const renderProgress = (progress, loading) => {
				if (state.modal !== modal || !progress) return;
				modal.failedPages = [...progress.failedPages || []];
				modal.totalPages = progress.totalPages || modal.totalPages;
				modal.pageLimit = progress.pageLimit || modal.pageLimit;
				const currentLimit = Math.min(maxPage, Math.max(1, Number(modal.pageLimit) || maxPage));
				const currentTotal = Math.max(1, Number(modal.totalPages) || currentLimit);
				modal.loadedPages = Math.max(0, Math.min(currentLimit, currentTotal) - modal.failedPages.length);
				modal.challengePages = [...progress.challengePages || []];
				renderPreviewSection(section, info, progress.records, {
					...progress,
					loadedPages: modal.loadedPages,
					statusNode: toolbarStatus,
					loading,
					onRetry: retryAgain
				});
			};
			try {
				const preview = await loadPreviewRecords(info, modal.previewSeed, {
					noStore: true,
					allowCache: false,
					pageLimit,
					initialRecords: modal.previewRecords || [],
					onlyPages: retryPages,
					initialLoadedPages: loadedPages,
					initialFailedPages: retryPages,
					initialChallengePages: (modal.challengePages || []).filter((page) => retryPages.includes(Number(page))),
					signal: requestController?.signal,
					onRecordsLoaded: (progress) => renderProgress(progress, true)
				});
				if (state.modal !== modal) return false;
				applyPreviewResult(modal, preview);
				renderProgress({
					...preview,
					records: preview.records
				}, false);
				updatePreviewHeaderMeta(modal, {
					node: modal.headerMeta?.node?.value?.textContent || "",
					author: modal.headerMeta?.author?.value?.textContent || "",
					time: modal.headerMeta?.time?.value?.textContent || "",
					replyCount: preview.records.length
				});
				return true;
			} catch (error) {
				if (state.modal === modal) showPreviewRefreshError(modal, error);
				return false;
			} finally {
				if (modal.requestController === requestController) modal.requestController = null;
				modal.loading = false;
				refresh?.classList.remove("xns-action-pending");
				refresh?.removeAttribute("aria-busy");
			}
		}
		async function loadPreviewModal(modal, loadingText, options = {}) {
			if (!modal || modal.loading) return false;
			const preserveContent = Boolean(options.preserveContent);
			const fresh = preserveContent || options.noStore === true;
			const requestController = windowObj.AbortController ? new windowObj.AbortController() : null;
			modal.requestController?.abort();
			modal.requestController = requestController;
			modal.refreshScrollCleanup?.();
			modal.featureCleanup?.();
			modal.featureCleanup = null;
			modal.loading = true;
			const generation = (modal.loadGeneration || 0) + 1;
			modal.loadGeneration = generation;
			const refresh = qs(modal.dialog, ".xns-refresh-post");
			const toolbarStatus = qs(modal.dialog, ".xns-modal-toolbar-status");
			refresh?.classList.add("xns-action-pending");
			refresh?.setAttribute("aria-busy", "true");
			if (toolbarStatus) {
				toolbarStatus.className = "xns-modal-toolbar-status xns-preview-status is-loading";
				toolbarStatus.hidden = false;
				toolbarStatus.removeAttribute("title");
				toolbarStatus.textContent = preserveContent ? "正在刷新…" : "正在读取…";
			}
			closeImageLightbox();
			if (!preserveContent) {
				modal.body.scrollTop = 0;
				clearElement(modal.body);
				modal.body.appendChild(createElement("p", "xns-loading", loadingText));
			}
			try {
				const response = await fetchHtml(modal.url, {
					noStore: fresh,
					allowCache: !fresh,
					signal: requestController?.signal
				});
				const parsed = parseHtml(response.html, response.url);
				modal.previewSeed = parsed;
				const preview = buildPreviewContent(modal.url, parsed, {
					noStore: fresh,
					allowCache: !fresh,
					renderDetached: preserveContent,
					signal: requestController?.signal,
					statusNode: toolbarStatus,
					onRetry: () => {
						if (state.modal === modal && !modal.loading) retryPreviewPages(modal);
					}
				});
				let hydratedPreview = null;
				if (preserveContent && preview.hydrate) hydratedPreview = await preview.hydrate;
				if (state.modal !== modal || modal.loadGeneration !== generation) return false;
				const scrollSnapshot = preserveContent ? capturePreviewScroll(modal.body) : null;
				modal.title.textContent = preview.title || "NodeSeek 帖子预览";
				updatePreviewHeaderMeta(modal, preview.headerMeta);
				clearElement(modal.body);
				modal.body.appendChild(preview.content);
				if (modal.composer && !modal.composer.isConnected) modal.body.appendChild(modal.composer);
				const previewPost = qs(modal.body, ".xns-preview-post");
				if (previewPost) installPreviewFeatures(previewPost);
				if (!preserveContent && preview.hydrate) {
					hydratedPreview = await preview.hydrate;
					if (state.modal !== modal || modal.loadGeneration !== generation) return false;
				}
				updatePreviewHeaderMeta(modal, {
					...preview.headerMeta,
					replyCount: hydratedPreview?.records?.length ?? preview.headerMeta?.replyCount
				});
				if (hydratedPreview) {
					modal.previewSeed = parsed;
					applyPreviewResult(modal, hydratedPreview);
				}
				if (preserveContent) stabilizePreviewScroll(modal, scrollSnapshot, generation);
			} catch (error) {
				if (state.modal === modal && modal.loadGeneration === generation) {
					if (preserveContent) showPreviewRefreshError(modal, error);
					else showPreviewLoadError(modal, error);
				}
			} finally {
				if (modal.requestController === requestController) modal.requestController = null;
				modal.loading = false;
				refresh?.classList.remove("xns-action-pending");
				refresh?.removeAttribute("aria-busy");
				if (modal.pendingReplySync && state.modal === modal) {
					modal.pendingReplySync = false;
					windowObj.setTimeout(() => {
						syncPreviewReply(modal);
					}, 0);
				}
			}
			return true;
		}
		function refreshPreviewModal() {
			const modal = state.modal;
			if (!modal || modal.loading || modal.replySyncing) return;
			loadPreviewModal(modal, "正在刷新帖子…", { preserveContent: true });
		}
		function openPreviewModal(url, fallbackLink) {
			closeModal();
			const fetchUrl = url.search || url.hash ? new URL(url.pathname, url.origin) : url;
			const shareUrl = getCanonicalPostUrl(fetchUrl);
			const overlay = createElement("div", "xns-overlay");
			overlay.tabIndex = -1;
			overlay.addEventListener("click", (event) => {
				if (event.target === overlay) closeModal();
			});
			const dialog = createElement("section", "xns-modal");
			dialog.setAttribute("role", "dialog");
			dialog.setAttribute("aria-modal", "true");
			const header = createElement("header", "xns-modal-header");
			const heading = createElement("div", "xns-modal-heading");
			const title = createElement("h2", "xns-modal-title", "正在加载帖子…");
			const headerMeta = createPreviewHeaderMeta();
			heading.append(title, headerMeta.root);
			const actions = createElement("div", "xns-modal-actions");
			const replyPost = createElement("button", "xns-modal-reply", "回复帖子");
			replyPost.type = "button";
			replyPost.title = "回复帖子";
			replyPost.addEventListener("click", () => openPreviewComposer("post-reply", null));
			const original = createElement("a", "xns-modal-original", "打开原帖");
			original.href = url.href;
			original.target = "_blank";
			original.rel = "noopener noreferrer";
			original.title = "在新标签打开原帖";
			const share = createShareButton(({ setLabel }) => {
				copyPreviewLink(shareUrl, setLabel).catch(() => {
					setLabel("复制失败");
					windowObj.setTimeout(() => setLabel("分享"), 1800);
				});
			});
			const close = createCloseButton(closeModal);
			actions.append(replyPost, original, share, close);
			header.append(heading, actions);
			const toolbar = createElement("div", "xns-modal-toolbar");
			toolbar.setAttribute("role", "toolbar");
			toolbar.setAttribute("aria-label", "预览工具");
			const toolbarStatus = createElement("span", "xns-modal-toolbar-status xns-preview-status", "准备读取…");
			toolbar.append(toolbarStatus, createRefreshButton(() => {
				refreshPreviewModal();
			}));
			const composerHost = createElement("div", "xns-preview-composer-host");
			composerHost.hidden = true;
			const body = createElement("div", "xns-modal-body");
			body.appendChild(createElement("p", "xns-loading", "正在读取帖子内容…"));
			dialog.append(header, toolbar, composerHost);
			dialog.appendChild(body);
			const scrollCleanup = installPreviewScrollButtons(dialog, body);
			overlay.appendChild(dialog);
			documentObj.body.appendChild(overlay);
			documentObj.documentElement.style.overflow = "hidden";
			state.modal = {
				overlay,
				dialog,
				body,
				composerHost,
				title,
				url: fetchUrl,
				fallbackLink,
				postId: getPostInfo(fetchUrl.href)?.postId || "",
				composer: null,
				scrollCleanup,
				featureCleanup: null,
				headerMeta: headerMeta.items,
				loading: false,
				loadGeneration: 0,
				requestController: null,
				replySyncController: null,
				replySyncPromise: null,
				replySyncing: false,
				pendingReplySync: false,
				toolbarStatus,
				previewSeed: null,
				previewRecords: [],
				loadedPages: 0,
				failedPages: [],
				challengePages: [],
				truncated: false,
				totalPages: null,
				pageLimit: maxPage
			};
			overlay.focus();
			loadPreviewModal(state.modal, "正在读取帖子内容…");
		}
		return Object.freeze({
			buildPreviewContent,
			loadPreviewModal,
			refreshPreviewModal,
			syncPreviewReply,
			openPreviewModal
		});
	}
	var xnsPreviewController = createPreviewController({
		windowObj: window,
		documentObj: document,
		state,
		selectors: SELECTORS,
		maxPage: 50,
		qs,
		qsa,
		createElement,
		clearElement,
		getPostInfo,
		buildPostUrl,
		sanitizeImportedNode,
		parseHtml,
		fetchHtml,
		getPageNumbers,
		collectPageRecords,
		loadPreviewRecords,
		buildPreviewPostNode,
		renderPreviewRecords,
		installPreviewFeatures,
		installPreviewScrollButtons,
		closeImageLightbox,
		closeModal,
		createCloseButton,
		createRefreshButton,
		createShareButton,
		openPreviewComposer: (...args) => openPreviewComposer(...args)
	});
	function syncPreviewReply(...args) {
		return xnsPreviewController.syncPreviewReply(...args);
	}
	function openPreviewModal(...args) {
		return xnsPreviewController.openPreviewModal(...args);
	}
	function createCommentActions({ windowObj, documentObj, state, pageInfo, qs, qsa, createElement, getPostInfo, buildPostUrl, parseSameOriginUrl, safePositiveInt, getFloor, getCommentId, getAuthorName, getPostContent, findCommentList, postAction, syncPreviewReply }) {
		const PREVIEW_ACTIONS = [
			[
				"like",
				"点赞",
				"♡",
				true
			],
			[
				"chicken",
				"加鸡腿",
				"🍗",
				true
			],
			[
				"dislike",
				"反对",
				"♧",
				true
			],
			[
				"favorite",
				"收藏",
				"☆",
				true
			],
			[
				"quote",
				"引用",
				"❝",
				false
			],
			[
				"reply",
				"回复",
				"↩",
				false
			]
		];
		const MENU_ITEMS_SELECTOR = ":scope > .menu-item";
		function getDirectCommentMenu(comment) {
			return Array.from(comment?.children || []).find((child) => child.matches?.(".comment-menu, .comment-actions")) || null;
		}
		function getMenuActionKey(menuItem) {
			const values = [
				menuItem?.dataset?.action,
				menuItem?.dataset?.type,
				menuItem?.getAttribute?.("title"),
				menuItem?.getAttribute?.("aria-label"),
				menuItem?.textContent
			].filter(Boolean).join(" ").toLowerCase();
			if (/\b(like|upvote)\b|点赞/.test(values)) return "like";
			if (/\b(chicken|freelike)\b|鸡腿|投喂/.test(values)) return "chicken";
			if (/\b(dislike|downvote)\b|反对|踩/.test(values)) return "dislike";
			if (/\b(favorite|favourite|collection)\b|收藏/.test(values)) return "favorite";
			if (/\bquote\b|引用/.test(values)) return "quote";
			if (/\breply\b|回复/.test(values)) return "reply";
			return "";
		}
		function createPreviewMenuItem([key, label, icon, withCount]) {
			const item = createElement("span", "menu-item");
			item.dataset.xnsAction = key;
			item.title = label;
			item.setAttribute("role", "button");
			item.tabIndex = 0;
			const iconNode = createElement("span", "xns-action-icon", icon);
			iconNode.setAttribute("aria-hidden", "true");
			item.appendChild(iconNode);
			if (withCount) item.appendChild(createElement("span", "xns-action-count", "0"));
			item.appendChild(createElement("span", "xns-action-label", label));
			item.setAttribute("aria-label", label);
			return item;
		}
		function createPreviewMenu(includeFavorite = true) {
			const menu = createElement("div", "comment-menu xns-preview-menu");
			PREVIEW_ACTIONS.filter(([key]) => includeFavorite || key !== "favorite").forEach((action) => menu.appendChild(createPreviewMenuItem(action)));
			return menu;
		}
		function getMenuCountElement(menuItem) {
			return qsa(menuItem, ":scope > span").find((node) => /^\d+$/.test((node.textContent || "").trim())) || null;
		}
		function ensurePreviewMenu(comment, options = {}) {
			const includeFavorite = options.includeFavorite !== false;
			let menu = getDirectCommentMenu(comment);
			if (!menu) {
				menu = createPreviewMenu(includeFavorite);
				comment.appendChild(menu);
			}
			menu.classList.add("comment-menu", "xns-preview-menu");
			let menuItems = qsa(menu, MENU_ITEMS_SELECTOR);
			if (!includeFavorite) menuItems = menuItems.filter((item) => {
				if (getMenuActionKey(item) === "favorite") {
					item.remove();
					return false;
				}
				return true;
			});
			const existingActions = new Set(menuItems.map(getMenuActionKey).filter(Boolean));
			PREVIEW_ACTIONS.filter(([key]) => includeFavorite || key !== "favorite").filter(([key]) => !existingActions.has(key)).forEach((action) => {
				const item = createPreviewMenuItem(action);
				menu.appendChild(item);
				menuItems.push(item);
			});
			menuItems.forEach((item) => {
				const action = getMenuActionKey(item);
				if (action) {
					item.dataset.xnsAction = action;
					const actionMeta = PREVIEW_ACTIONS.find(([key]) => key === action);
					if (!item.hasAttribute("aria-label")) item.setAttribute("aria-label", actionMeta?.[1] || action);
					if (action === "favorite" && /已收藏|取消收藏/.test(`${item.title} ${item.textContent}`)) item.dataset.xnsFavoriteState = "added";
				}
				if (!item.hasAttribute("role")) item.setAttribute("role", "button");
				if (!item.hasAttribute("tabindex")) item.tabIndex = 0;
			});
			const counts = options.counts || null;
			if (counts) menuItems.forEach((item) => {
				const action = getMenuActionKey(item);
				const value = counts[action];
				const countNode = qs(item, ":scope > .xns-action-count") || getMenuCountElement(item);
				if (countNode && Number.isFinite(value) && value >= 0) countNode.textContent = String(value);
				if (action === "favorite" && counts.collected && item.dataset.xnsFavoriteState !== "removed") item.dataset.xnsFavoriteState = "added";
			});
			return menu;
		}
		function getDisplayFloor(comment) {
			if ((comment?.getAttribute("data-xns-floor") || comment?.getAttribute("id") || "") === "0") return 0;
			return getFloor(comment);
		}
		function getActionTargetId(comment) {
			const commentId = getCommentId(comment);
			if (commentId !== null) return commentId;
			if (comment?.getAttribute("data-xns-target-type") === "post") return safePositiveInt(comment.getAttribute("data-xns-post-id") || "") || safePositiveInt(state.modal?.postId || "");
			return null;
		}
		function getPageActionContext() {
			return {
				modal: null,
				postId: (pageInfo || getPostInfo(windowObj.location.href))?.postId || "",
				url: parseSameOriginUrl(windowObj.location.href)
			};
		}
		function getActionContext(menuItem) {
			const modal = menuItem?.closest?.(".xns-overlay") ? state.modal : null;
			if (modal) return {
				modal,
				postId: modal.postId,
				url: modal.url
			};
			return getPageActionContext();
		}
		function setActionState(menuItem, text, failed = false) {
			menuItem.classList.toggle("xns-action-failed", failed);
			let stateNode = qs(menuItem, ":scope > .xns-action-state");
			if (!stateNode) {
				stateNode = createElement("span", "xns-action-state");
				menuItem.appendChild(stateNode);
			}
			stateNode.textContent = text;
		}
		function bumpMenuCount(menuItem, delta) {
			const count = getMenuCountElement(menuItem);
			if (!count) return;
			const value = Number(count.textContent || 0);
			count.textContent = String(Math.max(0, value + delta));
		}
		function getPreviewCommentText(comment) {
			const content = getPostContent(comment);
			if (!content) return "";
			const copy = content.cloneNode(true);
			qsa(copy, ".xns-remote-floor-link, .floor-link-wrapper").forEach((node) => node.remove());
			return (copy.innerText || copy.textContent || "").trim().slice(0, 12e3);
		}
		function getPreviewSourceUrl(comment, context = null) {
			const contextUrl = context?.url?.href || state.modal?.url?.href || windowObj.location.href;
			if (!comment) return contextUrl;
			const contextInfo = getPostInfo(contextUrl);
			const modalInfo = context?.postId ? {
				postId: String(context.postId),
				page: contextInfo?.page || 1
			} : contextInfo || (state.modal?.postId ? {
				postId: state.modal.postId,
				page: 1
			} : null);
			if (!modalInfo) return contextUrl;
			const page = safePositiveInt(comment?.getAttribute("data-xns-source-page")) || modalInfo.page;
			const floor = getDisplayFloor(comment);
			return buildPostUrl(modalInfo.postId, page, floor)?.href || contextUrl;
		}
		function getDirectComposer(comment) {
			return Array.from(comment?.children || []).find((child) => child.matches?.(":scope.xns-preview-composer")) || null;
		}
		function openPreviewComposer(action, comment, context = null) {
			const modal = context?.modal || state.modal;
			const actionContext = context || {
				modal,
				postId: modal?.postId || pageInfo?.postId || "",
				url: modal?.url || parseSameOriginUrl(windowObj.location.href)
			};
			const isPostReply = !comment || action === "post-reply";
			const host = isPostReply ? modal?.composerHost || modal?.body || findCommentList() : comment || findCommentList();
			if (!host) return;
			(isPostReply ? modal?.composer || state.post?.composer : getDirectComposer(comment))?.remove();
			const floor = isPostReply ? null : getDisplayFloor(comment);
			const author = isPostReply ? "" : getAuthorName(comment);
			const isReply = action === "reply" && !isPostReply;
			const composer = createElement("section", "xns-preview-composer");
			const floorLabel = floor === null ? "" : floor;
			const composerTitle = isPostReply ? "回复帖子" : `${isReply ? "回复" : "引用"} #${floorLabel} · ${author}`;
			composer.appendChild(createElement("h3", "xns-preview-composer-title", composerTitle));
			const textarea = documentObj.createElement("textarea");
			textarea.setAttribute("aria-label", isPostReply || isReply ? "回复内容" : "引用内容");
			const sourceUrl = isPostReply ? actionContext.url?.href || windowObj.location.href : getPreviewSourceUrl(comment, actionContext);
			if (isPostReply) {
				textarea.placeholder = "输入对帖子的回复内容…";
				textarea.value = "";
			} else {
				const replyToken = `@${author} [#${floorLabel}](${sourceUrl})`;
				const quoted = getPreviewCommentText(comment).split(/\r?\n/).slice(0, 80).map((line) => `> ${line}`).join("\n");
				textarea.value = isReply ? `${replyToken} ` : `> ${replyToken}\n${quoted}\n\n`;
			}
			composer.appendChild(textarea);
			const actions = createElement("div", "xns-preview-composer-actions");
			const submit = createElement("button", "", "发送回复");
			submit.type = "button";
			const original = createElement("a", "", "打开原帖回复");
			original.href = getPreviewSourceUrl(comment, actionContext);
			original.target = "_blank";
			original.rel = "noopener noreferrer";
			const cancel = createElement("button", "", "取消");
			cancel.type = "button";
			const status = createElement("span", "xns-preview-composer-status");
			actions.append(submit, original, cancel, status);
			composer.appendChild(actions);
			if (isPostReply && modal?.composerHost) {
				modal.composerHost.hidden = false;
				modal.composerHost.classList.add("is-open");
				modal.composerHost.appendChild(composer);
				modal.composer = composer;
			} else {
				const menu = qs(comment, ".xns-preview-menu");
				if (menu) menu.insertAdjacentElement("afterend", composer);
				else host.appendChild(composer);
				if (isPostReply && state.post) state.post.composer = composer;
			}
			textarea.focus();
			if (!isPostReply || !modal?.composerHost) composer.scrollIntoView({
				behavior: "smooth",
				block: "nearest"
			});
			cancel.addEventListener("click", () => {
				composer.remove();
				if (modal?.composer === composer) {
					modal.composer = null;
					modal.composerHost?.classList.remove("is-open");
					if (modal.composerHost) modal.composerHost.hidden = true;
				}
				if (!modal && state.post?.composer === composer) state.post.composer = null;
			});
			submit.addEventListener("click", async () => {
				const content = textarea.value.trim();
				if (!content) {
					status.textContent = "请输入内容。";
					textarea.focus();
					return;
				}
				submit.disabled = true;
				status.textContent = "正在发送…";
				try {
					await postAction("/api/content/new-comment", {
						content,
						mode: "new-comment",
						postId: Number(actionContext.postId)
					}, { context: actionContext });
					status.textContent = "回复已发送，正在更新楼中楼…";
					textarea.readOnly = true;
					submit.remove();
					if (actionContext.modal && state.modal === actionContext.modal) {
						const postModal = actionContext.modal;
						if (postModal.composer === composer) {
							postModal.composer = null;
							postModal.composerHost?.classList.remove("is-open");
							if (postModal.composerHost) postModal.composerHost.hidden = true;
						}
						composer.remove();
						syncPreviewReply?.(postModal);
					} else if (state.post) {
						const post = state.post;
						if (post.composer === composer) post.composer = null;
						composer.remove();
						await post.reloadPages({ refreshCurrentPage: true });
					}
				} catch (error) {
					status.textContent = `发送失败：${error.message || "网络错误"}`;
					submit.disabled = false;
				}
			});
		}
		async function runPreviewAction(action, menuItem, comment, context = null) {
			const actionContext = context || getActionContext(menuItem);
			if (action === "quote" || action === "reply") {
				openPreviewComposer(action, comment, actionContext);
				return;
			}
			const postId = safePositiveInt(actionContext?.postId || "");
			const targetId = getActionTargetId(comment);
			if (action !== "favorite" && targetId === null || action === "favorite" && postId === null) {
				setActionState(menuItem, action === "favorite" ? "缺少帖子ID" : "缺少目标ID", true);
				return;
			}
			if (action !== "favorite" && menuItem.dataset.xnsActionDone === "true") {
				setActionState(menuItem, "已操作");
				return;
			}
			if (menuItem.classList.contains("xns-action-pending")) return;
			if (action === "chicken" && !windowObj.confirm("确认给这条评论加鸡腿？NodeSeek 可能会消耗鸡腿。")) return;
			if (action === "dislike" && !windowObj.confirm("确认反对这条评论？NodeSeek 可能会消耗两个鸡腿。")) return;
			const isFavoriteRemoval = action === "favorite" && menuItem.dataset.xnsFavoriteState === "added";
			menuItem.classList.add("xns-action-pending");
			menuItem.classList.remove("xns-action-failed");
			setActionState(menuItem, "处理中…");
			try {
				if (action === "like") await postAction("/api/statistics/upvote", {
					commentId: targetId,
					action: "add"
				}, { context: actionContext });
				else if (action === "chicken") await postAction("/api/statistics/like", {
					commentId: targetId,
					action: "add"
				}, { context: actionContext });
				else if (action === "dislike") await postAction("/api/statistics/dislike", {
					commentId: targetId,
					action: "add"
				}, { context: actionContext });
				else if (action === "favorite") await postAction("/api/statistics/collection", {
					action: isFavoriteRemoval ? "del" : "add",
					postId
				}, { context: actionContext });
				if (action === "favorite") {
					menuItem.dataset.xnsFavoriteState = isFavoriteRemoval ? "removed" : "added";
					bumpMenuCount(menuItem, isFavoriteRemoval ? -1 : 1);
				} else {
					menuItem.dataset.xnsActionDone = "true";
					bumpMenuCount(menuItem, 1);
				}
				setActionState(menuItem, "✓");
				windowObj.setTimeout(() => {
					if (menuItem.isConnected && !menuItem.classList.contains("xns-action-failed")) qs(menuItem, ":scope > .xns-action-state")?.remove();
				}, 1800);
			} catch (error) {
				setActionState(menuItem, `失败：${error.message || "操作未完成"}`, true);
			} finally {
				menuItem.classList.remove("xns-action-pending");
			}
		}
		return Object.freeze({
			getDirectCommentMenu,
			getMenuActionKey,
			ensurePreviewMenu,
			getActionContext,
			openPreviewComposer,
			runPreviewAction
		});
	}
	var xnsCommentActions = createCommentActions({
		windowObj: window,
		documentObj: document,
		state,
		pageInfo,
		qs,
		qsa,
		createElement,
		getPostInfo,
		buildPostUrl,
		parseSameOriginUrl,
		safePositiveInt,
		getFloor,
		getCommentId,
		getAuthorName,
		getPostContent,
		findCommentList,
		postAction,
		syncPreviewReply: (...args) => syncPreviewReply(...args)
	});
	function getDirectCommentMenu(...args) {
		return xnsCommentActions.getDirectCommentMenu(...args);
	}
	function getMenuActionKey(...args) {
		return xnsCommentActions.getMenuActionKey(...args);
	}
	function ensurePreviewMenu(...args) {
		return xnsCommentActions.ensurePreviewMenu(...args);
	}
	function getActionContext(...args) {
		return xnsCommentActions.getActionContext(...args);
	}
	function openPreviewComposer(...args) {
		return xnsCommentActions.openPreviewComposer(...args);
	}
	function runPreviewAction(...args) {
		return xnsCommentActions.runPreviewAction(...args);
	}
	function createAppEvents({ state, qsa, getMenuActionKey, getActionContext, runPreviewAction, closeImageLightbox, closeModal }) {
		function handlePreviewActionClick(event) {
			const menuItem = event.target.closest?.(".xns-preview-menu > .menu-item");
			if (!menuItem) return;
			const inPreview = Boolean(menuItem.closest(".xns-overlay .xns-preview-content"));
			const inPost = Boolean(menuItem.closest(".comment-container"));
			if (!inPreview && !inPost) return;
			const comment = menuItem.closest(".content-item");
			const action = menuItem.dataset.xnsAction || getMenuActionKey(menuItem);
			if (!comment) return;
			if (inPost && !action && (menuItem.textContent || "").trim() === "编辑") {
				if (state.post?.prepareNativeEdit?.(comment)) {
					event.preventDefault();
					event.stopImmediatePropagation();
				}
				return;
			}
			if (!action) return;
			event.preventDefault();
			event.stopImmediatePropagation();
			runPreviewAction(action, menuItem, comment, getActionContext(menuItem));
		}
		function handleKeydown(event) {
			const menuItem = event.target.closest?.(".xns-preview-menu > .menu-item");
			if (menuItem && (event.key === "Enter" || event.key === " ")) {
				event.preventDefault();
				menuItem.click();
				return;
			}
			const inEditor = event.target.closest?.("textarea, input, [contenteditable=\"true\"]");
			if (event.key !== "Escape") return;
			if (inEditor) return;
			if (state.settingsPanel) {
				event.preventDefault();
				state.settingsPanel.close?.();
				return;
			}
			if (state.lightbox) {
				event.preventDefault();
				closeImageLightbox();
			} else if (state.modal) closeModal();
		}
		return Object.freeze({
			handlePreviewActionClick,
			handleKeydown
		});
	}
	var xnsAppEvents = createAppEvents({
		state,
		qsa,
		getMenuActionKey,
		getActionContext,
		runPreviewAction,
		closeImageLightbox,
		closeModal
	});
	function handlePreviewActionClick(...args) {
		return xnsAppEvents.handlePreviewActionClick(...args);
	}
	function handleKeydown(...args) {
		return xnsAppEvents.handleKeydown(...args);
	}
	function createPostPageController({ documentObj, windowObj, appState, selectors, maxPage, findCommentList, createElement, qs, qsa, fetchHtml, parseHtml, getFloor, getCommentItems, sanitizeImportedNode, releaseCommentNode, getDocState, getCurrentUserUid, getCommentRecord, fetchPostPages, flattenReplyTree, createCommentVirtualizer, prepareCommentRecord, addRemoteNote, installPreviewFeatures, formatPageStatus, updateSettings, getMaxPage, buildPostUrl }) {
		const NATIVE_EDIT_REQUEST_KEY = "xns-comment-preview-native-edit";
		return class PostPageController {
			constructor(info) {
				this.info = info;
				this.list = null;
				this.originalChildren = [];
				this.records = [];
				this.loadedPages = 0;
				this.failedPages = [];
				this.challengePages = [];
				this.truncated = false;
				this.totalPages = null;
				this.toolbar = null;
				this.statusNode = null;
				this.loadingNode = null;
				this.toolbarStatusText = "";
				this.toolbarStatusTone = "";
				this.toolbarStatusDetail = "";
				this.loading = false;
				this.hasRemotePages = false;
				this.virtualizer = null;
				this.generation = 0;
				this.progressiveTimer = 0;
				this.progressiveRendered = false;
				this.composer = null;
				this.requestController = null;
			}
			consumeNativeEditRequest() {
				try {
					const raw = windowObj.sessionStorage?.getItem(NATIVE_EDIT_REQUEST_KEY);
					windowObj.sessionStorage?.removeItem(NATIVE_EDIT_REQUEST_KEY);
					const request = raw ? JSON.parse(raw) : null;
					if (!request || String(request.postId) !== String(this.info.postId)) return null;
					if (!/^\d{1,15}$/.test(String(request.floor))) return null;
					return String(request.floor);
				} catch {
					return null;
				}
			}
			openNativeEditAfterReload(floor) {
				const started = Date.now();
				const findEdit = () => {
					const comment = Array.from(this.list?.children || []).find((node) => node.nodeType === 1 && String(node.id) === String(floor));
					return Array.from(comment?.querySelectorAll?.(":scope > .comment-menu > .menu-item, :scope > .comment-actions > .menu-item") || []).find((item) => (item.textContent || "").trim() === "编辑");
				};
				const check = () => {
					const edit = findEdit();
					if (edit) {
						edit.click();
						return;
					}
					if (Date.now() - started < 12e3) windowObj.setTimeout(check, 80);
				};
				check();
			}
			async init() {
				this.list = await this.waitForCommentList();
				if (!this.list) return;
				this.originalChildren = Array.from(this.list.childNodes);
				this.createToolbar();
				const nativeEditFloor = this.consumeNativeEditRequest();
				if (nativeEditFloor) {
					appState.mode = "original";
					this.showStatus("原版评论已恢复。");
					this.openNativeEditAfterReload(nativeEditFloor);
					return;
				}
				await this.reloadPages();
			}
			waitForCommentList() {
				return new Promise((resolve) => {
					const started = Date.now();
					const check = () => {
						const list = findCommentList();
						if (list || Date.now() - started > 12e3) resolve(list);
						else windowObj.setTimeout(check, 80);
					};
					check();
				});
			}
			createToolbar() {
				if (this.toolbar || !this.list) return;
				const toolbar = createElement("nav", "xns-post-toolbar");
				toolbar.setAttribute("aria-label", "评论布局");
				const modeSwitch = createElement("span", "xns-post-mode-switch");
				modeSwitch.setAttribute("role", "group");
				modeSwitch.setAttribute("aria-label", "评论布局");
				[[
					"thread",
					"楼中楼",
					"切换到楼中楼布局"
				], [
					"original",
					"原版",
					"恢复官方评论布局"
				]].forEach(([mode, text, title]) => {
					const button = createElement("button", "", text);
					button.type = "button";
					button.dataset.mode = mode;
					button.title = title;
					button.setAttribute("aria-label", title);
					button.addEventListener("click", () => this.setMode(mode));
					modeSwitch.appendChild(button);
				});
				toolbar.appendChild(modeSwitch);
				toolbar.appendChild(createElement("span", "xns-toolbar-status"));
				const refresh = createElement("button", "xns-post-refresh", "刷新");
				refresh.type = "button";
				refresh.title = "重新读取当前页和评论分页";
				refresh.setAttribute("aria-label", "重新读取当前页和评论分页");
				refresh.addEventListener("click", () => {
					if (this.loading) return;
					if (this.failedPages.length) this.reloadPages({
						onlyPages: [...this.failedPages],
						initialChallengePages: [...this.challengePages]
					});
					else this.reloadPages({ refreshCurrentPage: true });
				});
				toolbar.appendChild(refresh);
				this.list.closest(selectors.commentContainer)?.insertBefore(toolbar, this.list);
				this.toolbar = toolbar;
				this.updateToolbar();
			}
			updateToolbar() {
				if (!this.toolbar) return;
				qsa(this.toolbar, "[data-mode]").forEach((button) => {
					button.setAttribute("aria-pressed", String(button.dataset.mode === appState.mode));
				});
				const refresh = qs(this.toolbar, ".xns-post-refresh");
				if (refresh) {
					refresh.disabled = this.loading;
					refresh.setAttribute("aria-busy", String(this.loading));
					const retrying = !this.loading && this.failedPages.length > 0;
					refresh.textContent = retrying ? "重试" : "刷新";
					refresh.title = retrying ? "重新读取分页" : "重新读取当前页和评论分页";
					refresh.setAttribute("aria-label", retrying ? "重新读取分页" : "重新读取当前页和评论分页");
				}
				const status = qs(this.toolbar, ".xns-toolbar-status");
				if (!status) return;
				const text = this.toolbarStatusText || (this.records.length ? `${this.records.length} 条评论` : "读取中…");
				status.className = `xns-toolbar-status${this.toolbarStatusTone ? ` ${this.toolbarStatusTone}` : ""}`;
				status.textContent = text;
				const detail = this.toolbarStatusDetail || (text.length > 24 ? text : "");
				if (detail && detail !== text) status.title = detail;
				else if (text.length > 24) status.title = text;
				else status.removeAttribute("title");
			}
			async reloadPages(options = {}) {
				if (!this.list) return;
				const pageLimit = Math.min(maxPage, Math.max(1, Number(getMaxPage?.()) || maxPage));
				const retryPages = Array.isArray(options.onlyPages) ? [...new Set(options.onlyPages.map((page) => Number(page)).filter((page) => Number.isInteger(page) && page >= 1 && page <= pageLimit))] : [];
				const retryOnly = retryPages.length > 0;
				const generation = ++this.generation;
				this.clearProgressiveRender();
				this.progressiveRendered = false;
				this.requestController?.abort();
				const requestController = windowObj.AbortController ? new windowObj.AbortController() : null;
				this.requestController = requestController;
				this.loading = true;
				this.showLoading(retryOnly ? `正在重试 ${retryPages.length} 个失败分页…` : "正在读取评论分页…");
				try {
					if (options.refreshCurrentPage) await this.adoptNewReplies(generation, requestController?.signal);
					if (generation !== this.generation) return;
					if (!retryOnly) this.loadCurrentPage();
					if (appState.mode === "thread") this.render({ progressive: true });
					await this.loadPages(generation, {
						...options,
						onlyPages: retryOnly ? retryPages : void 0
					}, requestController?.signal);
					if (generation !== this.generation) return;
					this.clearProgressiveRender();
					this.loading = false;
					if (appState.mode === "thread") this.render();
					else this.showStatus("原版评论已刷新。");
				} catch (error) {
					if (generation !== this.generation) return;
					this.restoreOriginal();
					this.showStatus(`楼中楼读取失败：${error.message || "网络错误"}，已保留原版布局。`);
				} finally {
					if (this.requestController === requestController) this.requestController = null;
					if (generation === this.generation) {
						this.clearProgressiveRender();
						this.loading = false;
						this.loadingNode?.remove();
						this.loadingNode = null;
						this.updateToolbar();
					}
				}
			}
			loadCurrentPage() {
				const state = getDocState(documentObj);
				const records = [];
				this.originalChildren.forEach((item, index) => {
					if (item.nodeType !== 1) return;
					const record = getCommentRecord(item, this.info.postId, this.info.page, index, true, {
						keepCommentMenu: true,
						state,
						getCurrentUserUid
					});
					if (record) records.push(record);
				});
				this.records = records;
				this.loadedPages = 1;
				this.failedPages = [];
				this.challengePages = [];
				const discovered = getPageNumbers(documentObj, this.info.postId);
				this.totalPages = discovered.size ? Math.max(...discovered, this.info.page) : this.info.page;
				this.truncated = this.totalPages > getMaxPage();
				this.hasRemotePages = this.totalPages > 1 || this.info.page > 1;
			}
			async adoptNewReplies(generation, signal) {
				try {
					const response = await fetchHtml(buildPostUrl(this.info.postId, this.info.page), {
						noStore: true,
						signal
					});
					if (generation !== this.generation) return;
					const parsed = parseHtml(response.html, response.url);
					const knownFloors = new Set(this.originalChildren.filter((node) => node.nodeType === Node.ELEMENT_NODE).map((node) => getFloor(node)).filter((floor) => floor !== null));
					getCommentItems(parsed).forEach((item) => {
						const floor = getFloor(item);
						if (floor === null || knownFloors.has(floor)) return;
						const imported = sanitizeImportedNode(item, { keepCommentMenu: true });
						if (!imported) return;
						knownFloors.add(floor);
						this.list.appendChild(imported);
						this.originalChildren.push(imported);
					});
				} catch {}
			}
			async loadPages(generation, options = {}, signal) {
				const retryPages = Array.isArray(options.onlyPages) ? options.onlyPages : [];
				const retryOnly = retryPages.length > 0;
				this.failedPages = retryOnly ? [...retryPages] : [];
				this.challengePages = retryOnly ? (options.initialChallengePages || []).filter((page) => retryPages.includes(Number(page))).map(Number) : [];
				const remoteRecords = [];
				const updateProgress = (progress) => {
					if (!progress || generation !== this.generation) return;
					this.loadedPages = progress.loadedPages;
					this.failedPages = [...progress.failedPages];
					this.challengePages = [...progress.challengePages || []];
					this.truncated = progress.truncated;
					this.totalPages = progress.totalPages;
					this.records = mergeCommentRecords(this.records, remoteRecords);
					this.scheduleProgressiveRender(generation);
				};
				const fresh = options.noStore === true || options.refreshCurrentPage === true;
				const pageLimit = Math.min(maxPage, Math.max(1, Number(getMaxPage?.()) || maxPage));
				const knownTotalPages = Math.max(1, Number(this.totalPages) || pageLimit);
				const initialLoadedPages = retryOnly ? Array.from({ length: Math.min(pageLimit, knownTotalPages) }, (_, index) => index + 1).filter((page) => !retryPages.includes(page)) : void 0;
				const { loadedPages, failedPages, challengePages, truncated, totalPages } = await fetchPostPages(this.info, documentObj, {
					noStore: fresh,
					allowCache: !fresh,
					retainDocuments: false,
					...retryOnly ? {
						onlyPages: retryPages,
						initialLoadedPages,
						initialFailedPages: retryPages,
						initialChallengePages: (options.initialChallengePages || []).filter((page) => retryPages.includes(Number(page)))
					} : {},
					signal,
					onPageLoaded: (page, root, progress) => {
						if (page !== this.info.page) {
							remoteRecords.push(...this.collectRemoteRecords(root, page));
							updateProgress(progress);
						}
					},
					onPageFailed: (_page, progress) => updateProgress(progress),
					isAborted: () => generation !== this.generation
				});
				if (generation !== this.generation) return;
				this.loadedPages = loadedPages;
				this.failedPages = failedPages;
				this.challengePages = challengePages;
				this.truncated = truncated;
				this.totalPages = totalPages;
				this.records = mergeCommentRecords(this.records, remoteRecords);
			}
			scheduleProgressiveRender(generation) {
				if (generation !== this.generation || appState.mode !== "thread" || this.progressiveTimer) return;
				const delay = this.progressiveRendered ? 500 : 300;
				this.progressiveTimer = windowObj.setTimeout(() => {
					this.progressiveTimer = 0;
					if (generation !== this.generation || !this.loading || appState.mode !== "thread") return;
					this.progressiveRendered = true;
					this.render({ progressive: true });
				}, delay);
			}
			clearProgressiveRender() {
				if (this.progressiveTimer) windowObj.clearTimeout(this.progressiveTimer);
				this.progressiveTimer = 0;
			}
			collectRemoteRecords(root, page) {
				const state = getDocState(root);
				return getCommentItems(root).map((item, index) => getCommentRecord(item, this.info.postId, page, index, false, {
					keepCommentMenu: true,
					state,
					getCurrentUserUid
				})).filter(Boolean);
			}
			setMode(mode) {
				if (!["thread", "original"].includes(mode)) return;
				appState.mode = mode;
				this.updateToolbar();
				if (mode === "original") this.restoreOriginal();
				else if (this.records.length) {
					if (this.records.some((record) => !record.current && !record.node && !record.html)) this.reloadPages();
					else this.render();
				} else this.reloadPages();
				updateSettings({ mode });
			}
			prepareNativeEdit(comment) {
				if (!this.virtualizer || !this.originalChildren.includes(comment)) return false;
				const floor = comment.getAttribute("data-xns-floor") || comment.id || "";
				if (!/^\d{1,15}$/.test(String(floor))) return false;
				try {
					windowObj.sessionStorage?.setItem(NATIVE_EDIT_REQUEST_KEY, JSON.stringify({
						postId: this.info.postId,
						floor: String(floor)
					}));
				} catch {
					return false;
				}
				windowObj.location.reload();
				return true;
			}
			showLoading(text) {
				this.loadingNode?.remove();
				this.loadingNode = null;
				this.toolbarStatusText = this.records.length ? `${this.records.length} 条评论` : text;
				this.toolbarStatusTone = "is-loading";
				this.toolbarStatusDetail = text;
				this.updateToolbar();
			}
			showStatus(text, tone = "", visibleText = "") {
				this.statusNode?.remove();
				this.statusNode = null;
				this.toolbarStatusText = visibleText || (this.records.length ? `${this.records.length} 条评论` : text);
				this.toolbarStatusTone = tone;
				this.toolbarStatusDetail = text;
				this.updateToolbar();
			}
			render(options = {}) {
				if (!this.list || appState.mode !== "thread") return;
				const virtualizerOptions = {
					getViewport: () => windowObj,
					renderItem: (entry) => prepareCommentRecord(entry.record, entry.depth),
					onMount: (node, entry) => {
						const record = entry.record;
						if (!record.current) {
							addRemoteNote(record, this.info.postId);
							node.classList.add("xns-preview-content");
							installPreviewFeatures(node);
						}
					},
					onUnmount: (node, entry) => {
						if (!entry.record.current) releaseCommentNode(entry.record);
					}
				};
				if (!this.virtualizer) {
					this.restoreOriginal({ releaseRemote: false });
					this.list.classList.add("xns-preview-thread");
					this.virtualizer = createCommentVirtualizer({
						windowObj,
						documentObj,
						createElement,
						estimatedHeight: 135,
						overscanScreens: 2
					}).mount(this.list, virtualizerOptions);
				}
				this.virtualizer.setEntries(flattenReplyTree(this.records), virtualizerOptions);
				const loadedPages = this.loadedPages;
				const loading = this.loading || options.progressive;
				const pagination = formatPageStatus({
					loadedPages,
					totalPages: this.totalPages,
					failedPages: this.failedPages,
					challengePages: this.challengePages,
					truncated: this.truncated,
					loading: loading && this.hasRemotePages,
					commentCount: this.records.length
				});
				const detail = pagination.detail || "暂无分页信息";
				this.showStatus(`楼中楼已整理 · ${detail}`, pagination.tone, pagination.compact);
			}
			restoreOriginal(options = {}) {
				if (!this.list) return;
				this.virtualizer?.destroy();
				this.virtualizer = null;
				this.list.classList.remove("xns-preview-thread");
				qsa(this.list, ".xns-reply-list, .xns-remote-note").forEach((node) => node.remove());
				this.originalChildren.forEach(stripRenderArtifacts);
				while (this.list.firstChild) this.list.removeChild(this.list.firstChild);
				this.originalChildren.forEach((node) => this.list.appendChild(node));
				if (options.releaseRemote !== false) this.records.forEach(releaseCommentNode);
				this.statusNode?.remove();
				this.statusNode = null;
				this.loadingNode?.remove();
				this.loadingNode = null;
				if (appState.mode === "original") {
					this.toolbarStatusText = "原版评论";
					this.toolbarStatusTone = "";
					this.toolbarStatusDetail = "";
				} else {
					this.toolbarStatusText = "";
					this.toolbarStatusTone = "";
					this.toolbarStatusDetail = "";
				}
				this.updateToolbar();
			}
		};
	}
	var PostEnhancer = createPostPageController({
		documentObj: document,
		windowObj: window,
		appState: state,
		selectors: SELECTORS,
		maxPage: 50,
		findCommentList,
		createElement,
		qs,
		qsa,
		fetchHtml,
		parseHtml,
		getFloor,
		getCommentItems,
		sanitizeImportedNode,
		releaseCommentNode,
		getDocState,
		getCurrentUserUid,
		getCommentRecord,
		fetchPostPages,
		flattenReplyTree,
		createCommentVirtualizer,
		prepareCommentRecord,
		addRemoteNote,
		installPreviewFeatures,
		formatPageStatus,
		updateSettings,
		getMaxPage,
		buildPostUrl
	});
	function createPreviewEntryController({ document, location, parseSameOriginUrl, getPostInfo, openPreviewModal }) {
		const titleSelectors = [
			"h3 a[href]",
			".post-item > a[href]",
			".post-item h3 a[href]",
			".post-list-item > a[href]",
			".post-list-item h3 a[href]",
			".post-list-item .post-title a[href]",
			".topic-item h3 a[href]",
			".topic-title a[href]"
		];
		function isListTitle(link) {
			if (!link?.matches?.(titleSelectors.join(", "))) return false;
			return Boolean(link.closest("main, .post-list, .post-item, .post-list-item, .topic-item, .topic-title, h3"));
		}
		function handle(event) {
			if (event.defaultPrevented || event.button !== 0) return;
			if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
			if (getPostInfo(location.href) || event.target.closest?.(".xns-overlay")) return;
			const link = event.target.closest?.("a[href]");
			if (!link || !isListTitle(link)) return;
			const url = parseSameOriginUrl(link.getAttribute("href") || "");
			if (!url || !getPostInfo(url.href)) return;
			event.preventDefault();
			event.stopImmediatePropagation();
			openPreviewModal(url, link);
		}
		return Object.freeze({
			handle,
			isListTitle
		});
	}
	function createFloorNavigationController({ enabled, handleFloorClick }) {
		function handle(event) {
			if (!enabled || event.defaultPrevented) return;
			handleFloorClick(event);
		}
		return Object.freeze({ handle });
	}
	function createFloorNavigation({ windowObj, documentObj, selectors, enabled, parseSameOriginUrl, getPostInfo, safePositiveInt }) {
		function scrollToFloor(floor) {
			let target = documentObj.querySelector(`[data-xns-floor="${CSS.escape(String(floor))}"]`);
			if (!target) {
				const virtualLists = Array.from(documentObj.querySelectorAll(".xns-virtual-list"));
				for (const list of virtualLists) {
					target = list.__xnsVirtualizer?.scrollToFloor(floor) || null;
					if (target) break;
				}
			}
			if (!target) return false;
			target.scrollIntoView({
				behavior: "smooth",
				block: "center"
			});
			target.classList.remove("xns-floor-highlight");
			windowObj.requestAnimationFrame(() => target.classList.add("xns-floor-highlight"));
			return true;
		}
		function handleFloorClick(event) {
			const link = event.target.closest?.("a[href]");
			if (!link || !link.closest(selectors.commentContainer) || link.closest(".xns-remote-floor-link")) return;
			const rawHref = link.getAttribute("href") || "";
			const directMatch = /^#([1-9]\d*)$/.exec(rawHref);
			const linkedUrl = directMatch ? null : parseSameOriginUrl(rawHref);
			const linkedInfo = linkedUrl ? getPostInfo(linkedUrl.href) : null;
			if (linkedInfo && enabled && linkedInfo.postId !== getPostInfo(windowObj.location.href)?.postId) return;
			const match = directMatch || (linkedUrl ? /^#([1-9]\d*)$/.exec(linkedUrl.hash || "") : null);
			if (!match) return;
			const floor = safePositiveInt(match[1]);
			if (floor === null || !scrollToFloor(floor)) return;
			event.preventDefault();
			event.stopImmediatePropagation();
		}
		return Object.freeze({
			scrollToFloor,
			handleFloorClick
		});
	}
	function createFloorNavigationFeature(options) {
		return { handle: createFloorNavigation(options).handleFloorClick };
	}
	var xnsFloorNavigation = createFloorNavigationFeature({
		windowObj: window,
		documentObj: document,
		selectors: SELECTORS,
		enabled: Boolean(pageInfo),
		parseSameOriginUrl,
		getPostInfo,
		safePositiveInt
	});
	function handleFloorClick(...args) {
		return xnsFloorNavigation.handle(...args);
	}
	var require_react_production = __commonJSMin(((exports) => {
		var REACT_ELEMENT_TYPE = Symbol.for("react.transitional.element");
		var REACT_PORTAL_TYPE = Symbol.for("react.portal");
		var REACT_FRAGMENT_TYPE = Symbol.for("react.fragment");
		var REACT_STRICT_MODE_TYPE = Symbol.for("react.strict_mode");
		var REACT_PROFILER_TYPE = Symbol.for("react.profiler");
		var REACT_CONSUMER_TYPE = Symbol.for("react.consumer");
		var REACT_CONTEXT_TYPE = Symbol.for("react.context");
		var REACT_FORWARD_REF_TYPE = Symbol.for("react.forward_ref");
		var REACT_SUSPENSE_TYPE = Symbol.for("react.suspense");
		var REACT_MEMO_TYPE = Symbol.for("react.memo");
		var REACT_LAZY_TYPE = Symbol.for("react.lazy");
		var REACT_ACTIVITY_TYPE = Symbol.for("react.activity");
		var REACT_VIEW_TRANSITION_TYPE = Symbol.for("react.view_transition");
		var MAYBE_ITERATOR_SYMBOL = Symbol.iterator;
		function getIteratorFn(maybeIterable) {
			if (null === maybeIterable || "object" !== typeof maybeIterable) return null;
			maybeIterable = MAYBE_ITERATOR_SYMBOL && maybeIterable[MAYBE_ITERATOR_SYMBOL] || maybeIterable["@@iterator"];
			return "function" === typeof maybeIterable ? maybeIterable : null;
		}
		var ReactNoopUpdateQueue = {
			isMounted: function() {
				return !1;
			},
			enqueueForceUpdate: function() {},
			enqueueReplaceState: function() {},
			enqueueSetState: function() {}
		};
		var assign = Object.assign;
		var emptyObject = {};
		function Component(props, context, updater) {
			this.props = props;
			this.context = context;
			this.refs = emptyObject;
			this.updater = updater || ReactNoopUpdateQueue;
		}
		Component.prototype.isReactComponent = {};
		Component.prototype.setState = function(partialState, callback) {
			if ("object" !== typeof partialState && "function" !== typeof partialState && null != partialState) throw Error("takes an object of state variables to update or a function which returns an object of state variables.");
			this.updater.enqueueSetState(this, partialState, callback, "setState");
		};
		Component.prototype.forceUpdate = function(callback) {
			this.updater.enqueueForceUpdate(this, callback, "forceUpdate");
		};
		function ComponentDummy() {}
		ComponentDummy.prototype = Component.prototype;
		function PureComponent(props, context, updater) {
			this.props = props;
			this.context = context;
			this.refs = emptyObject;
			this.updater = updater || ReactNoopUpdateQueue;
		}
		var pureComponentPrototype = PureComponent.prototype = new ComponentDummy();
		pureComponentPrototype.constructor = PureComponent;
		assign(pureComponentPrototype, Component.prototype);
		pureComponentPrototype.isPureReactComponent = !0;
		var isArrayImpl = Array.isArray;
		function noop() {}
		var ReactSharedInternals = {
			H: null,
			A: null,
			T: null,
			S: null
		};
		var hasOwnProperty = Object.prototype.hasOwnProperty;
		function ReactElement(type, key, props) {
			var refProp = props.ref;
			return {
				$$typeof: REACT_ELEMENT_TYPE,
				type,
				key,
				ref: void 0 !== refProp ? refProp : null,
				props
			};
		}
		function cloneAndReplaceKey(oldElement, newKey) {
			return ReactElement(oldElement.type, newKey, oldElement.props);
		}
		function isValidElement(object) {
			return "object" === typeof object && null !== object && object.$$typeof === REACT_ELEMENT_TYPE;
		}
		function escape(key) {
			var escaperLookup = {
				"=": "=0",
				":": "=2"
			};
			return "$" + key.replace(/[=:]/g, function(match) {
				return escaperLookup[match];
			});
		}
		var userProvidedKeyEscapeRegex = /\/+/g;
		function getElementKey(element, index) {
			return "object" === typeof element && null !== element && null != element.key ? escape("" + element.key) : index.toString(36);
		}
		function resolveThenable(thenable) {
			switch (thenable.status) {
				case "fulfilled": return thenable.value;
				case "rejected": throw thenable.reason;
				default: switch ("string" === typeof thenable.status ? thenable.then(noop, noop) : (thenable.status = "pending", thenable.then(function(fulfilledValue) {
					"pending" === thenable.status && (thenable.status = "fulfilled", thenable.value = fulfilledValue);
				}, function(error) {
					"pending" === thenable.status && (thenable.status = "rejected", thenable.reason = error);
				})), thenable.status) {
					case "fulfilled": return thenable.value;
					case "rejected": throw thenable.reason;
				}
			}
			throw thenable;
		}
		function mapIntoArray(children, array, escapedPrefix, nameSoFar, callback) {
			var type = typeof children;
			if ("undefined" === type || "boolean" === type) children = null;
			var invokeCallback = !1;
			if (null === children) invokeCallback = !0;
			else switch (type) {
				case "bigint":
				case "string":
				case "number":
					invokeCallback = !0;
					break;
				case "object": switch (children.$$typeof) {
					case REACT_ELEMENT_TYPE:
					case REACT_PORTAL_TYPE:
						invokeCallback = !0;
						break;
					case REACT_LAZY_TYPE: return invokeCallback = children._init, mapIntoArray(invokeCallback(children._payload), array, escapedPrefix, nameSoFar, callback);
				}
			}
			if (invokeCallback) return callback = callback(children), invokeCallback = "" === nameSoFar ? "." + getElementKey(children, 0) : nameSoFar, isArrayImpl(callback) ? (escapedPrefix = "", null != invokeCallback && (escapedPrefix = invokeCallback.replace(userProvidedKeyEscapeRegex, "$&/") + "/"), mapIntoArray(callback, array, escapedPrefix, "", function(c) {
				return c;
			})) : null != callback && (isValidElement(callback) && (callback = cloneAndReplaceKey(callback, escapedPrefix + (null == callback.key || children && children.key === callback.key ? "" : ("" + callback.key).replace(userProvidedKeyEscapeRegex, "$&/") + "/") + invokeCallback)), array.push(callback)), 1;
			invokeCallback = 0;
			var nextNamePrefix = "" === nameSoFar ? "." : nameSoFar + ":";
			if (isArrayImpl(children)) for (var i = 0; i < children.length; i++) nameSoFar = children[i], type = nextNamePrefix + getElementKey(nameSoFar, i), invokeCallback += mapIntoArray(nameSoFar, array, escapedPrefix, type, callback);
			else if (i = getIteratorFn(children), "function" === typeof i) for (children = i.call(children), i = 0; !(nameSoFar = children.next()).done;) nameSoFar = nameSoFar.value, type = nextNamePrefix + getElementKey(nameSoFar, i++), invokeCallback += mapIntoArray(nameSoFar, array, escapedPrefix, type, callback);
			else if ("object" === type) {
				if ("function" === typeof children.then) return mapIntoArray(resolveThenable(children), array, escapedPrefix, nameSoFar, callback);
				array = String(children);
				throw Error("Objects are not valid as a React child (found: " + ("[object Object]" === array ? "object with keys {" + Object.keys(children).join(", ") + "}" : array) + "). If you meant to render a collection of children, use an array instead.");
			}
			return invokeCallback;
		}
		function mapChildren(children, func, context) {
			if (null == children) return children;
			var result = [], count = 0;
			mapIntoArray(children, result, "", "", function(child) {
				return func.call(context, child, count++);
			});
			return result;
		}
		function lazyInitializer(payload) {
			if (-1 === payload._status) {
				var ctor = payload._result, thenable = ctor();
				thenable.then(function(moduleObject) {
					if (0 === payload._status || -1 === payload._status) payload._status = 1, payload._result = moduleObject, void 0 === thenable.status && (thenable.status = "fulfilled", thenable.value = moduleObject);
				}, function(error) {
					if (0 === payload._status || -1 === payload._status) payload._status = 2, payload._result = error, void 0 === thenable.status && (thenable.status = "rejected", thenable.reason = error);
				});
				-1 === payload._status && (payload._status = 0, payload._result = thenable);
			}
			if (1 === payload._status) return payload._result.default;
			throw payload._result;
		}
		var reportGlobalError = "function" === typeof reportError ? reportError : function(error) {
			if ("object" === typeof window && "function" === typeof window.ErrorEvent) {
				var event = new window.ErrorEvent("error", {
					bubbles: !0,
					cancelable: !0,
					message: "object" === typeof error && null !== error && "string" === typeof error.message ? String(error.message) : String(error),
					error
				});
				if (!window.dispatchEvent(event)) return;
			} else if ("object" === typeof process && "function" === typeof process.emit) {
				process.emit("uncaughtException", error);
				return;
			}
			console.error(error);
		};
		function startTransition(scope) {
			var prevTransition = ReactSharedInternals.T, currentTransition = {};
			currentTransition.types = null !== prevTransition ? prevTransition.types : null;
			ReactSharedInternals.T = currentTransition;
			try {
				var returnValue = scope(), onStartTransitionFinish = ReactSharedInternals.S;
				null !== onStartTransitionFinish && onStartTransitionFinish(currentTransition, returnValue);
				"object" === typeof returnValue && null !== returnValue && "function" === typeof returnValue.then && returnValue.then(noop, reportGlobalError);
			} catch (error) {
				reportGlobalError(error);
			} finally {
				null !== prevTransition && null !== currentTransition.types && (prevTransition.types = currentTransition.types), ReactSharedInternals.T = prevTransition;
			}
		}
		function addTransitionType(type) {
			var transition = ReactSharedInternals.T;
			if (null !== transition) {
				var transitionTypes = transition.types;
				null === transitionTypes ? transition.types = [type] : -1 === transitionTypes.indexOf(type) && transitionTypes.push(type);
			} else startTransition(addTransitionType.bind(null, type));
		}
		var Children = {
			map: mapChildren,
			forEach: function(children, forEachFunc, forEachContext) {
				mapChildren(children, function() {
					forEachFunc.apply(this, arguments);
				}, forEachContext);
			},
			count: function(children) {
				var n = 0;
				mapChildren(children, function() {
					n++;
				});
				return n;
			},
			toArray: function(children) {
				return mapChildren(children, function(child) {
					return child;
				}) || [];
			},
			only: function(children) {
				if (!isValidElement(children)) throw Error("React.Children.only expected to receive a single React element child.");
				return children;
			}
		};
		exports.Activity = REACT_ACTIVITY_TYPE;
		exports.Children = Children;
		exports.Component = Component;
		exports.Fragment = REACT_FRAGMENT_TYPE;
		exports.Profiler = REACT_PROFILER_TYPE;
		exports.PureComponent = PureComponent;
		exports.StrictMode = REACT_STRICT_MODE_TYPE;
		exports.Suspense = REACT_SUSPENSE_TYPE;
		exports.ViewTransition = REACT_VIEW_TRANSITION_TYPE;
		exports.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE = ReactSharedInternals;
		exports.__COMPILER_RUNTIME = {
			__proto__: null,
			c: function(size) {
				return ReactSharedInternals.H.useMemoCache(size);
			}
		};
		exports.addTransitionType = addTransitionType;
		exports.cache = function(fn) {
			return function() {
				return fn.apply(null, arguments);
			};
		};
		exports.cacheSignal = function() {
			return null;
		};
		exports.cloneElement = function(element, config, children) {
			if (null === element || void 0 === element) throw Error("The argument must be a React element, but you passed " + element + ".");
			var props = assign({}, element.props), key = element.key;
			if (null != config) for (propName in void 0 !== config.key && (key = "" + config.key), config) !hasOwnProperty.call(config, propName) || "key" === propName || "__self" === propName || "__source" === propName || "ref" === propName && void 0 === config.ref || (props[propName] = config[propName]);
			var propName = arguments.length - 2;
			if (1 === propName) props.children = children;
			else if (1 < propName) {
				for (var childArray = Array(propName), i = 0; i < propName; i++) childArray[i] = arguments[i + 2];
				props.children = childArray;
			}
			return ReactElement(element.type, key, props);
		};
		exports.createContext = function(defaultValue) {
			defaultValue = {
				$$typeof: REACT_CONTEXT_TYPE,
				_currentValue: defaultValue,
				_currentValue2: defaultValue,
				_threadCount: 0,
				Provider: null,
				Consumer: null
			};
			defaultValue.Provider = defaultValue;
			defaultValue.Consumer = {
				$$typeof: REACT_CONSUMER_TYPE,
				_context: defaultValue
			};
			return defaultValue;
		};
		exports.createElement = function(type, config, children) {
			var propName, props = {}, key = null;
			if (null != config) for (propName in void 0 !== config.key && (key = "" + config.key), config) hasOwnProperty.call(config, propName) && "key" !== propName && "__self" !== propName && "__source" !== propName && (props[propName] = config[propName]);
			var childrenLength = arguments.length - 2;
			if (1 === childrenLength) props.children = children;
			else if (1 < childrenLength) {
				for (var childArray = Array(childrenLength), i = 0; i < childrenLength; i++) childArray[i] = arguments[i + 2];
				props.children = childArray;
			}
			if (type && type.defaultProps) for (propName in childrenLength = type.defaultProps, childrenLength) void 0 === props[propName] && (props[propName] = childrenLength[propName]);
			return ReactElement(type, key, props);
		};
		exports.createRef = function() {
			return { current: null };
		};
		exports.forwardRef = function(render) {
			return {
				$$typeof: REACT_FORWARD_REF_TYPE,
				render
			};
		};
		exports.isValidElement = isValidElement;
		exports.lazy = function(ctor) {
			return {
				$$typeof: REACT_LAZY_TYPE,
				_payload: {
					_status: -1,
					_result: ctor
				},
				_init: lazyInitializer
			};
		};
		exports.memo = function(type, compare) {
			return {
				$$typeof: REACT_MEMO_TYPE,
				type,
				compare: void 0 === compare ? null : compare
			};
		};
		exports.startTransition = startTransition;
		exports.unstable_useCacheRefresh = function() {
			return ReactSharedInternals.H.useCacheRefresh();
		};
		exports.use = function(usable) {
			return ReactSharedInternals.H.use(usable);
		};
		exports.useActionState = function(action, initialState, permalink) {
			return ReactSharedInternals.H.useActionState(action, initialState, permalink);
		};
		exports.useCallback = function(callback, deps) {
			return ReactSharedInternals.H.useCallback(callback, deps);
		};
		exports.useContext = function(Context) {
			return ReactSharedInternals.H.useContext(Context);
		};
		exports.useDebugValue = function() {};
		exports.useDeferredValue = function(value, initialValue) {
			return ReactSharedInternals.H.useDeferredValue(value, initialValue);
		};
		exports.useEffect = function(create, deps) {
			return ReactSharedInternals.H.useEffect(create, deps);
		};
		exports.useEffectEvent = function(callback) {
			return ReactSharedInternals.H.useEffectEvent(callback);
		};
		exports.useId = function() {
			return ReactSharedInternals.H.useId();
		};
		exports.useImperativeHandle = function(ref, create, deps) {
			return ReactSharedInternals.H.useImperativeHandle(ref, create, deps);
		};
		exports.useInsertionEffect = function(create, deps) {
			return ReactSharedInternals.H.useInsertionEffect(create, deps);
		};
		exports.useLayoutEffect = function(create, deps) {
			return ReactSharedInternals.H.useLayoutEffect(create, deps);
		};
		exports.useMemo = function(create, deps) {
			return ReactSharedInternals.H.useMemo(create, deps);
		};
		exports.useOptimistic = function(passthrough, reducer) {
			return ReactSharedInternals.H.useOptimistic(passthrough, reducer);
		};
		exports.useReducer = function(reducer, initialArg, init) {
			return ReactSharedInternals.H.useReducer(reducer, initialArg, init);
		};
		exports.useRef = function(initialValue) {
			return ReactSharedInternals.H.useRef(initialValue);
		};
		exports.useState = function(initialState) {
			return ReactSharedInternals.H.useState(initialState);
		};
		exports.useSyncExternalStore = function(subscribe, getSnapshot, getServerSnapshot) {
			return ReactSharedInternals.H.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
		};
		exports.useTransition = function() {
			return ReactSharedInternals.H.useTransition();
		};
		exports.version = "19.3.0";
	}));
	var require_react = __commonJSMin(((exports, module) => {
		module.exports = require_react_production();
	}));
	var require_scheduler_production = __commonJSMin(((exports) => {
		function push(heap, node) {
			var index = heap.length;
			heap.push(node);
			a: for (; 0 < index;) {
				var parentIndex = index - 1 >>> 1, parent = heap[parentIndex];
				if (0 < compare(parent, node)) heap[parentIndex] = node, heap[index] = parent, index = parentIndex;
				else break a;
			}
		}
		function peek(heap) {
			return 0 === heap.length ? null : heap[0];
		}
		function pop(heap) {
			if (0 === heap.length) return null;
			var first = heap[0], last = heap.pop();
			if (last !== first) {
				heap[0] = last;
				a: for (var index = 0, length = heap.length, halfLength = length >>> 1; index < halfLength;) {
					var leftIndex = 2 * (index + 1) - 1, left = heap[leftIndex], rightIndex = leftIndex + 1, right = heap[rightIndex];
					if (0 > compare(left, last)) rightIndex < length && 0 > compare(right, left) ? (heap[index] = right, heap[rightIndex] = last, index = rightIndex) : (heap[index] = left, heap[leftIndex] = last, index = leftIndex);
					else if (rightIndex < length && 0 > compare(right, last)) heap[index] = right, heap[rightIndex] = last, index = rightIndex;
					else break a;
				}
			}
			return first;
		}
		function compare(a, b) {
			var diff = a.sortIndex - b.sortIndex;
			return 0 !== diff ? diff : a.id - b.id;
		}
		exports.unstable_now = void 0;
		if ("object" === typeof performance && "function" === typeof performance.now) {
			var localPerformance = performance;
			exports.unstable_now = function() {
				return localPerformance.now();
			};
		} else {
			var localDate = Date, initialTime = localDate.now();
			exports.unstable_now = function() {
				return localDate.now() - initialTime;
			};
		}
		var taskQueue = [];
		var timerQueue = [];
		var taskIdCounter = 1;
		var currentTask = null;
		var currentPriorityLevel = 3;
		var isPerformingWork = !1;
		var isHostCallbackScheduled = !1;
		var isHostTimeoutScheduled = !1;
		var needsPaint = !1;
		var localSetTimeout = "function" === typeof setTimeout ? setTimeout : null;
		var localClearTimeout = "function" === typeof clearTimeout ? clearTimeout : null;
		var localSetImmediate = "undefined" !== typeof setImmediate ? setImmediate : null;
		function advanceTimers(currentTime) {
			for (var timer = peek(timerQueue); null !== timer;) {
				if (null === timer.callback) pop(timerQueue);
				else if (timer.startTime <= currentTime) pop(timerQueue), timer.sortIndex = timer.expirationTime, push(taskQueue, timer);
				else break;
				timer = peek(timerQueue);
			}
		}
		function handleTimeout(currentTime) {
			isHostTimeoutScheduled = !1;
			advanceTimers(currentTime);
			if (!isHostCallbackScheduled) if (null !== peek(taskQueue)) isHostCallbackScheduled = !0, isMessageLoopRunning || (isMessageLoopRunning = !0, schedulePerformWorkUntilDeadline());
			else {
				var firstTimer = peek(timerQueue);
				null !== firstTimer && requestHostTimeout(handleTimeout, firstTimer.startTime - currentTime);
			}
		}
		var isMessageLoopRunning = !1;
		var taskTimeoutID = -1;
		var frameInterval = 5;
		var startTime = -1;
		function shouldYieldToHost() {
			return needsPaint ? !0 : exports.unstable_now() - startTime < frameInterval ? !1 : !0;
		}
		function performWorkUntilDeadline() {
			needsPaint = !1;
			if (isMessageLoopRunning) {
				var currentTime = exports.unstable_now();
				startTime = currentTime;
				var hasMoreWork = !0;
				try {
					a: {
						isHostCallbackScheduled = !1;
						isHostTimeoutScheduled && (isHostTimeoutScheduled = !1, localClearTimeout(taskTimeoutID), taskTimeoutID = -1);
						isPerformingWork = !0;
						var previousPriorityLevel = currentPriorityLevel;
						try {
							b: {
								advanceTimers(currentTime);
								for (currentTask = peek(taskQueue); null !== currentTask && !(currentTask.expirationTime > currentTime && shouldYieldToHost());) {
									var callback = currentTask.callback;
									if ("function" === typeof callback) {
										currentTask.callback = null;
										currentPriorityLevel = currentTask.priorityLevel;
										var continuationCallback = callback(currentTask.expirationTime <= currentTime);
										currentTime = exports.unstable_now();
										if ("function" === typeof continuationCallback) {
											currentTask.callback = continuationCallback;
											advanceTimers(currentTime);
											hasMoreWork = !0;
											break b;
										}
										currentTask === peek(taskQueue) && pop(taskQueue);
										advanceTimers(currentTime);
									} else pop(taskQueue);
									currentTask = peek(taskQueue);
								}
								if (null !== currentTask) hasMoreWork = !0;
								else {
									var firstTimer = peek(timerQueue);
									null !== firstTimer && requestHostTimeout(handleTimeout, firstTimer.startTime - currentTime);
									hasMoreWork = !1;
								}
							}
							break a;
						} finally {
							currentTask = null, currentPriorityLevel = previousPriorityLevel, isPerformingWork = !1;
						}
						hasMoreWork = void 0;
					}
				} finally {
					hasMoreWork ? schedulePerformWorkUntilDeadline() : isMessageLoopRunning = !1;
				}
			}
		}
		var schedulePerformWorkUntilDeadline;
		if ("function" === typeof localSetImmediate) schedulePerformWorkUntilDeadline = function() {
			localSetImmediate(performWorkUntilDeadline);
		};
		else if ("undefined" !== typeof MessageChannel) {
			var channel = new MessageChannel(), port = channel.port2;
			channel.port1.onmessage = performWorkUntilDeadline;
			schedulePerformWorkUntilDeadline = function() {
				port.postMessage(null);
			};
		} else schedulePerformWorkUntilDeadline = function() {
			localSetTimeout(performWorkUntilDeadline, 0);
		};
		function requestHostTimeout(callback, ms) {
			taskTimeoutID = localSetTimeout(function() {
				callback(exports.unstable_now());
			}, ms);
		}
		exports.unstable_IdlePriority = 5;
		exports.unstable_ImmediatePriority = 1;
		exports.unstable_LowPriority = 4;
		exports.unstable_NormalPriority = 3;
		exports.unstable_Profiling = null;
		exports.unstable_UserBlockingPriority = 2;
		exports.unstable_cancelCallback = function(task) {
			task.callback = null;
		};
		exports.unstable_forceFrameRate = function(fps) {
			0 > fps || 125 < fps ? console.error("forceFrameRate takes a positive int between 0 and 125, forcing frame rates higher than 125 fps is not supported") : frameInterval = 0 < fps ? Math.floor(1e3 / fps) : 5;
		};
		exports.unstable_getCurrentPriorityLevel = function() {
			return currentPriorityLevel;
		};
		exports.unstable_next = function(eventHandler) {
			switch (currentPriorityLevel) {
				case 1:
				case 2:
				case 3:
					var priorityLevel = 3;
					break;
				default: priorityLevel = currentPriorityLevel;
			}
			var previousPriorityLevel = currentPriorityLevel;
			currentPriorityLevel = priorityLevel;
			try {
				return eventHandler();
			} finally {
				currentPriorityLevel = previousPriorityLevel;
			}
		};
		exports.unstable_requestPaint = function() {
			needsPaint = !0;
		};
		exports.unstable_runWithPriority = function(priorityLevel, eventHandler) {
			switch (priorityLevel) {
				case 1:
				case 2:
				case 3:
				case 4:
				case 5: break;
				default: priorityLevel = 3;
			}
			var previousPriorityLevel = currentPriorityLevel;
			currentPriorityLevel = priorityLevel;
			try {
				return eventHandler();
			} finally {
				currentPriorityLevel = previousPriorityLevel;
			}
		};
		exports.unstable_scheduleCallback = function(priorityLevel, callback, options) {
			var currentTime = exports.unstable_now();
			"object" === typeof options && null !== options ? (options = options.delay, options = "number" === typeof options && 0 < options ? currentTime + options : currentTime) : options = currentTime;
			switch (priorityLevel) {
				case 1:
					var timeout = -1;
					break;
				case 2:
					timeout = 250;
					break;
				case 5:
					timeout = 1073741823;
					break;
				case 4:
					timeout = 1e4;
					break;
				default: timeout = 5e3;
			}
			timeout = options + timeout;
			priorityLevel = {
				id: taskIdCounter++,
				callback,
				priorityLevel,
				startTime: options,
				expirationTime: timeout,
				sortIndex: -1
			};
			options > currentTime ? (priorityLevel.sortIndex = options, push(timerQueue, priorityLevel), null === peek(taskQueue) && priorityLevel === peek(timerQueue) && (isHostTimeoutScheduled ? (localClearTimeout(taskTimeoutID), taskTimeoutID = -1) : isHostTimeoutScheduled = !0, requestHostTimeout(handleTimeout, options - currentTime))) : (priorityLevel.sortIndex = timeout, push(taskQueue, priorityLevel), isHostCallbackScheduled || isPerformingWork || (isHostCallbackScheduled = !0, isMessageLoopRunning || (isMessageLoopRunning = !0, schedulePerformWorkUntilDeadline())));
			return priorityLevel;
		};
		exports.unstable_shouldYield = shouldYieldToHost;
		exports.unstable_wrapCallback = function(callback) {
			var parentPriorityLevel = currentPriorityLevel;
			return function() {
				var previousPriorityLevel = currentPriorityLevel;
				currentPriorityLevel = parentPriorityLevel;
				try {
					return callback.apply(this, arguments);
				} finally {
					currentPriorityLevel = previousPriorityLevel;
				}
			};
		};
	}));
	var require_scheduler = __commonJSMin(((exports, module) => {
		module.exports = require_scheduler_production();
	}));
	var require_react_dom_production = __commonJSMin(((exports) => {
		var React = require_react();
		function formatProdErrorMessage(code) {
			var url = "https://react.dev/errors/" + code;
			if (1 < arguments.length) {
				url += "?args[]=" + encodeURIComponent(arguments[1]);
				for (var i = 2; i < arguments.length; i++) url += "&args[]=" + encodeURIComponent(arguments[i]);
			}
			return "Minified React error #" + code + "; visit " + url + " for the full message or use the non-minified dev environment for full errors and additional helpful warnings.";
		}
		function noop() {}
		var Internals = {
			d: {
				f: noop,
				r: function() {
					throw Error(formatProdErrorMessage(522));
				},
				D: noop,
				C: noop,
				L: noop,
				m: noop,
				X: noop,
				S: noop,
				M: noop
			},
			p: 0,
			findDOMNode: null
		};
		var REACT_PORTAL_TYPE = Symbol.for("react.portal");
		var REACT_RECOVERABLE_TYPE = Symbol.for("react.recoverable");
		var REACT_OPTIMISTIC_KEY = Symbol.for("react.optimistic_key");
		function createPortal$1(children, containerInfo, implementation) {
			var key = 3 < arguments.length && void 0 !== arguments[3] ? arguments[3] : null;
			return {
				$$typeof: REACT_PORTAL_TYPE,
				key: null == key ? null : key === REACT_OPTIMISTIC_KEY ? REACT_OPTIMISTIC_KEY : "" + key,
				children,
				containerInfo,
				implementation
			};
		}
		var ReactSharedInternals = React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
		function getCrossOriginStringAs(as, input) {
			if ("font" === as) return "";
			if ("string" === typeof input) return "use-credentials" === input ? input : "";
		}
		exports.__DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE = Internals;
		exports.browser = function(reason) {
			return {
				$$typeof: REACT_RECOVERABLE_TYPE,
				_reason: reason
			};
		};
		exports.createPortal = function(children, container) {
			var key = 2 < arguments.length && void 0 !== arguments[2] ? arguments[2] : null;
			if (!container || 1 !== container.nodeType && 9 !== container.nodeType && 11 !== container.nodeType) throw Error(formatProdErrorMessage(299));
			return createPortal$1(children, container, null, key);
		};
		exports.flushSync = function(fn) {
			var previousTransition = ReactSharedInternals.T, previousUpdatePriority = Internals.p;
			try {
				if (ReactSharedInternals.T = null, Internals.p = 2, fn) return fn();
			} finally {
				ReactSharedInternals.T = previousTransition, Internals.p = previousUpdatePriority, Internals.d.f();
			}
		};
		exports.preconnect = function(href, options) {
			"string" === typeof href && (options ? (options = options.crossOrigin, options = "string" === typeof options ? "use-credentials" === options ? options : "" : void 0) : options = null, Internals.d.C(href, options));
		};
		exports.prefetchDNS = function(href) {
			"string" === typeof href && Internals.d.D(href);
		};
		exports.preinit = function(href, options) {
			if ("string" === typeof href && options && "string" === typeof options.as) {
				var as = options.as, crossOrigin = getCrossOriginStringAs(as, options.crossOrigin), integrity = "string" === typeof options.integrity ? options.integrity : void 0, fetchPriority = "string" === typeof options.fetchPriority ? options.fetchPriority : void 0;
				"style" === as ? Internals.d.S(href, "string" === typeof options.precedence ? options.precedence : void 0, {
					crossOrigin,
					integrity,
					fetchPriority
				}) : "script" === as && Internals.d.X(href, {
					crossOrigin,
					integrity,
					fetchPriority,
					nonce: "string" === typeof options.nonce ? options.nonce : void 0
				});
			}
		};
		exports.preinitModule = function(href, options) {
			if ("string" === typeof href) if ("object" === typeof options && null !== options) {
				if (null == options.as || "script" === options.as) {
					var crossOrigin = getCrossOriginStringAs(options.as, options.crossOrigin);
					Internals.d.M(href, {
						crossOrigin,
						integrity: "string" === typeof options.integrity ? options.integrity : void 0,
						nonce: "string" === typeof options.nonce ? options.nonce : void 0,
						fetchPriority: "string" === typeof options.fetchPriority ? options.fetchPriority : void 0
					});
				}
			} else options ?? Internals.d.M(href);
		};
		exports.preload = function(href, options) {
			if ("string" === typeof href && "object" === typeof options && null !== options && "string" === typeof options.as) {
				var as = options.as, crossOrigin = getCrossOriginStringAs(as, options.crossOrigin);
				Internals.d.L(href, as, {
					crossOrigin,
					integrity: "string" === typeof options.integrity ? options.integrity : void 0,
					nonce: "string" === typeof options.nonce ? options.nonce : void 0,
					type: "string" === typeof options.type ? options.type : void 0,
					fetchPriority: "string" === typeof options.fetchPriority ? options.fetchPriority : void 0,
					referrerPolicy: "string" === typeof options.referrerPolicy ? options.referrerPolicy : void 0,
					imageSrcSet: "string" === typeof options.imageSrcSet ? options.imageSrcSet : void 0,
					imageSizes: "string" === typeof options.imageSizes ? options.imageSizes : void 0,
					media: "string" === typeof options.media ? options.media : void 0
				});
			}
		};
		exports.preloadModule = function(href, options) {
			if ("string" === typeof href) if (options) {
				var crossOrigin = getCrossOriginStringAs(options.as, options.crossOrigin);
				Internals.d.m(href, {
					as: "string" === typeof options.as && "script" !== options.as ? options.as : void 0,
					crossOrigin,
					integrity: "string" === typeof options.integrity ? options.integrity : void 0,
					nonce: "string" === typeof options.nonce ? options.nonce : void 0,
					fetchPriority: "string" === typeof options.fetchPriority ? options.fetchPriority : void 0
				});
			} else Internals.d.m(href);
		};
		exports.requestFormReset = function(form) {
			Internals.d.r(form);
		};
		exports.unstable_batchedUpdates = function(fn, a) {
			return fn(a);
		};
		exports.useFormState = function(action, initialState, permalink) {
			return ReactSharedInternals.H.useFormState(action, initialState, permalink);
		};
		exports.useFormStatus = function() {
			return ReactSharedInternals.H.useHostTransitionStatus();
		};
		exports.version = "19.3.0";
	}));
	var require_react_dom = __commonJSMin(((exports, module) => {
		function checkDCE() {
			if (typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ === "undefined" || typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE !== "function") return;
			try {
				__REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE(checkDCE);
			} catch (err) {
				console.error(err);
			}
		}
		checkDCE();
		module.exports = require_react_dom_production();
	}));
	var require_react_dom_client_production = __commonJSMin(((exports) => {
		var Scheduler = require_scheduler();
		var React = require_react();
		var ReactDOM = require_react_dom();
		function formatProdErrorMessage(code) {
			var url = "https://react.dev/errors/" + code;
			if (1 < arguments.length) {
				url += "?args[]=" + encodeURIComponent(arguments[1]);
				for (var i = 2; i < arguments.length; i++) url += "&args[]=" + encodeURIComponent(arguments[i]);
			}
			return "Minified React error #" + code + "; visit " + url + " for the full message or use the non-minified dev environment for full errors and additional helpful warnings.";
		}
		function isValidContainer(node) {
			return !(!node || 1 !== node.nodeType && 9 !== node.nodeType && 11 !== node.nodeType);
		}
		function getNearestMountedFiber(fiber) {
			for (var node = fiber, nextNode = node; nextNode && !nextNode.alternate;) node = nextNode, 0 !== (node.flags & 4098) && (fiber = node.return), nextNode = node.return;
			for (; node.return;) node = node.return;
			return 3 === node.tag ? fiber : null;
		}
		function getSuspenseInstanceFromFiber(fiber) {
			if (13 === fiber.tag) {
				var suspenseState = fiber.memoizedState;
				null === suspenseState && (fiber = fiber.alternate, null !== fiber && (suspenseState = fiber.memoizedState));
				if (null !== suspenseState) return suspenseState.dehydrated;
			}
			return null;
		}
		function getActivityInstanceFromFiber(fiber) {
			if (31 === fiber.tag) {
				var activityState = fiber.memoizedState;
				null === activityState && (fiber = fiber.alternate, null !== fiber && (activityState = fiber.memoizedState));
				if (null !== activityState) return activityState.dehydrated;
			}
			return null;
		}
		function assertIsMounted(fiber) {
			if (getNearestMountedFiber(fiber) !== fiber) throw Error(formatProdErrorMessage(188));
		}
		function findCurrentFiberUsingSlowPath(fiber) {
			var alternate = fiber.alternate;
			if (!alternate) {
				alternate = getNearestMountedFiber(fiber);
				if (null === alternate) throw Error(formatProdErrorMessage(188));
				return alternate !== fiber ? null : fiber;
			}
			for (var a = fiber, b = alternate;;) {
				var parentA = a.return;
				if (null === parentA) break;
				var parentB = parentA.alternate;
				if (null === parentB) {
					b = parentA.return;
					if (null !== b) {
						a = b;
						continue;
					}
					break;
				}
				if (parentA.child === parentB.child) {
					for (parentB = parentA.child; parentB;) {
						if (parentB === a) return assertIsMounted(parentA), fiber;
						if (parentB === b) return assertIsMounted(parentA), alternate;
						parentB = parentB.sibling;
					}
					throw Error(formatProdErrorMessage(188));
				}
				if (a.return !== b.return) a = parentA, b = parentB;
				else {
					for (var didFindChild = !1, child$0 = parentA.child; child$0;) {
						if (child$0 === a) {
							didFindChild = !0;
							a = parentA;
							b = parentB;
							break;
						}
						if (child$0 === b) {
							didFindChild = !0;
							b = parentA;
							a = parentB;
							break;
						}
						child$0 = child$0.sibling;
					}
					if (!didFindChild) {
						for (child$0 = parentB.child; child$0;) {
							if (child$0 === a) {
								didFindChild = !0;
								a = parentB;
								b = parentA;
								break;
							}
							if (child$0 === b) {
								didFindChild = !0;
								b = parentB;
								a = parentA;
								break;
							}
							child$0 = child$0.sibling;
						}
						if (!didFindChild) throw Error(formatProdErrorMessage(189));
					}
				}
				if (a.alternate !== b) throw Error(formatProdErrorMessage(190));
			}
			if (3 !== a.tag) throw Error(formatProdErrorMessage(188));
			return a.stateNode.current === a ? fiber : alternate;
		}
		function findCurrentHostFiberImpl(node) {
			var tag = node.tag;
			if (5 === tag || 26 === tag || 27 === tag || 6 === tag) return node;
			for (node = node.child; null !== node;) {
				tag = findCurrentHostFiberImpl(node);
				if (null !== tag) return tag;
				node = node.sibling;
			}
			return null;
		}
		function traverseVisibleInstancesAndTextInstances(child, searchWithinHosts, fn, a, b, c) {
			for (; null !== child;) {
				if ((5 === child.tag || 27 === child.tag || 6 === child.tag) && fn(child, a, b, c) || (22 !== child.tag || null === child.memoizedState) && (searchWithinHosts || 5 !== child.tag && 27 !== child.tag) && traverseVisibleInstancesAndTextInstances(child.child, searchWithinHosts, fn, a, b, c)) return !0;
				child = child.sibling;
			}
			return !1;
		}
		function getFragmentParentInstanceOrContainerFiber(fiber) {
			for (fiber = fiber.return; null !== fiber;) {
				if (3 === fiber.tag || 5 === fiber.tag || 27 === fiber.tag) return fiber;
				fiber = fiber.return;
			}
			return null;
		}
		function fiberIsPortaledIntoHost(fiber) {
			var foundPortalParent = !1;
			for (fiber = fiber.return; null !== fiber;) {
				4 === fiber.tag && (foundPortalParent = !0);
				if (3 === fiber.tag || 5 === fiber.tag || 27 === fiber.tag) break;
				fiber = fiber.return;
			}
			return foundPortalParent;
		}
		function getFragmentInstanceOrTextInstanceSiblings(fiber) {
			var result = [null, null], parentHostFiber = getFragmentParentInstanceOrContainerFiber(fiber);
			if (null === parentHostFiber) return result;
			findFragmentInstanceOrTextInstanceSiblings(result, fiber, parentHostFiber.child, { foundSelf: !1 });
			return result;
		}
		function findFragmentInstanceOrTextInstanceSiblings(result, self, child, state) {
			for (; null !== child;) {
				if (child === self) state.foundSelf = !0;
				else if (5 === child.tag || 27 === child.tag || 6 === child.tag) {
					if (state.foundSelf) return result[1] = child, !0;
					result[0] = child;
				} else if ((22 !== child.tag || null === child.memoizedState) && findFragmentInstanceOrTextInstanceSiblings(result, self, child.child, state)) return !0;
				child = child.sibling;
			}
			return !1;
		}
		function getInstanceFromHostFiber(fiber) {
			switch (fiber.tag) {
				case 5:
				case 27:
				case 6: return fiber.stateNode;
				case 3: return fiber.stateNode.containerInfo;
				default: throw Error(formatProdErrorMessage(559));
			}
		}
		var searchTarget = null;
		var searchBoundary = null;
		function isFiberPrecedingCheck(child, target, boundary) {
			return child === boundary ? !0 : child === target ? (searchTarget = child, !0) : !1;
		}
		function isFiberFollowingCheck(child, target, boundary) {
			return child === boundary ? (searchBoundary = child, !1) : child === target ? (null !== searchBoundary && (searchTarget = child), !0) : !1;
		}
		function getParentForFragmentAncestors(inst) {
			if (null === inst) return null;
			do
				inst = null === inst ? null : inst.return;
			while (inst && 5 !== inst.tag && 27 !== inst.tag && 3 !== inst.tag);
			return inst ? inst : null;
		}
		function getLowestCommonAncestor(instA, instB, getParent) {
			for (var depthA = 0, tempA = instA; tempA; tempA = getParent(tempA)) depthA++;
			tempA = 0;
			for (var tempB = instB; tempB; tempB = getParent(tempB)) tempA++;
			for (; 0 < depthA - tempA;) instA = getParent(instA), depthA--;
			for (; 0 < tempA - depthA;) instB = getParent(instB), tempA--;
			for (; depthA--;) {
				if (instA === instB || null !== instB && instA === instB.alternate) return instA;
				instA = getParent(instA);
				instB = getParent(instB);
			}
			return null;
		}
		var assign = Object.assign;
		var REACT_LEGACY_ELEMENT_TYPE = Symbol.for("react.element");
		var REACT_ELEMENT_TYPE = Symbol.for("react.transitional.element");
		var REACT_PORTAL_TYPE = Symbol.for("react.portal");
		var REACT_FRAGMENT_TYPE = Symbol.for("react.fragment");
		var REACT_STRICT_MODE_TYPE = Symbol.for("react.strict_mode");
		var REACT_PROFILER_TYPE = Symbol.for("react.profiler");
		var REACT_CONSUMER_TYPE = Symbol.for("react.consumer");
		var REACT_CONTEXT_TYPE = Symbol.for("react.context");
		var REACT_FORWARD_REF_TYPE = Symbol.for("react.forward_ref");
		var REACT_SUSPENSE_TYPE = Symbol.for("react.suspense");
		var REACT_SUSPENSE_LIST_TYPE = Symbol.for("react.suspense_list");
		var REACT_MEMO_TYPE = Symbol.for("react.memo");
		var REACT_LAZY_TYPE = Symbol.for("react.lazy");
		var REACT_ACTIVITY_TYPE = Symbol.for("react.activity");
		var REACT_LEGACY_HIDDEN_TYPE = Symbol.for("react.legacy_hidden");
		var REACT_MEMO_CACHE_SENTINEL = Symbol.for("react.memo_cache_sentinel");
		var REACT_VIEW_TRANSITION_TYPE = Symbol.for("react.view_transition");
		var REACT_RECOVERABLE_TYPE = Symbol.for("react.recoverable");
		var MAYBE_ITERATOR_SYMBOL = Symbol.iterator;
		function getIteratorFn(maybeIterable) {
			if (null === maybeIterable || "object" !== typeof maybeIterable) return null;
			maybeIterable = MAYBE_ITERATOR_SYMBOL && maybeIterable[MAYBE_ITERATOR_SYMBOL] || maybeIterable["@@iterator"];
			return "function" === typeof maybeIterable ? maybeIterable : null;
		}
		var REACT_CLIENT_REFERENCE = Symbol.for("react.client.reference");
		function getComponentNameFromType(type) {
			if (null == type) return null;
			if ("function" === typeof type) return type.$$typeof === REACT_CLIENT_REFERENCE ? null : type.displayName || type.name || null;
			if ("string" === typeof type) return type;
			switch (type) {
				case REACT_FRAGMENT_TYPE: return "Fragment";
				case REACT_PROFILER_TYPE: return "Profiler";
				case REACT_STRICT_MODE_TYPE: return "StrictMode";
				case REACT_SUSPENSE_TYPE: return "Suspense";
				case REACT_SUSPENSE_LIST_TYPE: return "SuspenseList";
				case REACT_ACTIVITY_TYPE: return "Activity";
				case REACT_VIEW_TRANSITION_TYPE: return "ViewTransition";
			}
			if ("object" === typeof type) switch (type.$$typeof) {
				case REACT_PORTAL_TYPE: return "Portal";
				case REACT_CONTEXT_TYPE: return type.displayName || "Context";
				case REACT_CONSUMER_TYPE: return (type._context.displayName || "Context") + ".Consumer";
				case REACT_FORWARD_REF_TYPE:
					var innerType = type.render;
					type = type.displayName;
					type || (type = innerType.displayName || innerType.name || "", type = "" !== type ? "ForwardRef(" + type + ")" : "ForwardRef");
					return type;
				case REACT_MEMO_TYPE: return innerType = type.displayName || null, null !== innerType ? innerType : getComponentNameFromType(type.type) || "Memo";
				case REACT_LAZY_TYPE:
					innerType = type._payload;
					type = type._init;
					try {
						return getComponentNameFromType(type(innerType));
					} catch (x) {}
			}
			return null;
		}
		var isArrayImpl = Array.isArray;
		var ReactSharedInternals = React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
		var ReactDOMSharedInternals = ReactDOM.__DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
		var sharedNotPendingObject = {
			pending: !1,
			data: null,
			method: null,
			action: null
		};
		var valueStack = [];
		var index = -1;
		function createCursor(defaultValue) {
			return { current: defaultValue };
		}
		function pop(cursor) {
			0 > index || (cursor.current = valueStack[index], valueStack[index] = null, index--);
		}
		function push(cursor, value) {
			index++;
			valueStack[index] = cursor.current;
			cursor.current = value;
		}
		var contextStackCursor = createCursor(null);
		var contextFiberStackCursor = createCursor(null);
		var rootInstanceStackCursor = createCursor(null);
		var hostTransitionProviderCursor = createCursor(null);
		function pushHostContainer(fiber, nextRootInstance) {
			push(rootInstanceStackCursor, nextRootInstance);
			push(contextFiberStackCursor, fiber);
			push(contextStackCursor, null);
			switch (nextRootInstance.nodeType) {
				case 9:
				case 11:
					fiber = (fiber = nextRootInstance.documentElement) ? (fiber = fiber.namespaceURI) ? getOwnHostContext(fiber) : 0 : 0;
					break;
				default: if (fiber = nextRootInstance.tagName, nextRootInstance = nextRootInstance.namespaceURI) nextRootInstance = getOwnHostContext(nextRootInstance), fiber = getChildHostContextProd(nextRootInstance, fiber);
				else switch (fiber) {
					case "svg":
						fiber = 1;
						break;
					case "math":
						fiber = 2;
						break;
					default: fiber = 0;
				}
			}
			pop(contextStackCursor);
			push(contextStackCursor, fiber);
		}
		function popHostContainer() {
			pop(contextStackCursor);
			pop(contextFiberStackCursor);
			pop(rootInstanceStackCursor);
		}
		function pushHostContext(fiber) {
			var stateHook = fiber.memoizedState;
			null !== stateHook && (HostTransitionContext._currentValue = stateHook.memoizedState, push(hostTransitionProviderCursor, fiber));
			stateHook = contextStackCursor.current;
			var JSCompiler_inline_result = getChildHostContextProd(stateHook, fiber.type);
			stateHook !== JSCompiler_inline_result && (push(contextFiberStackCursor, fiber), push(contextStackCursor, JSCompiler_inline_result));
		}
		function popHostContext(fiber) {
			contextFiberStackCursor.current === fiber && (pop(contextStackCursor), pop(contextFiberStackCursor));
			hostTransitionProviderCursor.current === fiber && (pop(hostTransitionProviderCursor), HostTransitionContext._currentValue = sharedNotPendingObject);
		}
		var prefix;
		var suffix;
		function describeBuiltInComponentFrame(name) {
			if (void 0 === prefix) try {
				throw Error();
			} catch (x) {
				var match = x.stack.trim().match(/\n( *(at )?)/);
				prefix = match && match[1] || "";
				suffix = -1 < x.stack.indexOf("\n    at") ? " (<anonymous>)" : -1 < x.stack.indexOf("@") ? "@unknown:0:0" : "";
			}
			return "\n" + prefix + name + suffix;
		}
		var reentry = !1;
		function describeNativeComponentFrame(fn, construct) {
			if (!fn || reentry) return "";
			reentry = !0;
			var previousPrepareStackTrace = Error.prepareStackTrace;
			Error.prepareStackTrace = void 0;
			try {
				var RunInRootFrame = { DetermineComponentFrameRoot: function() {
					try {
						if (construct) {
							var Fake = function() {
								throw Error();
							};
							Object.defineProperty(Fake.prototype, "props", { set: function() {
								throw Error();
							} });
							if ("object" === typeof Reflect && Reflect.construct) {
								try {
									Reflect.construct(Fake, []);
								} catch (x) {
									var control = x;
								}
								Reflect.construct(fn, [], Fake);
							} else {
								try {
									Fake.call();
								} catch (x$1) {
									control = x$1;
								}
								Fake = !1;
								try {
									var prevProps = Object.getOwnPropertyDescriptor(fn.prototype, "props");
									Object.defineProperty(fn.prototype, "props", {
										configurable: !0,
										set: function() {
											throw Error();
										}
									});
									Fake = !0;
									new fn();
								} finally {
									Fake && (void 0 !== prevProps ? Object.defineProperty(fn.prototype, "props", prevProps) : delete fn.prototype.props);
								}
							}
						} else {
							try {
								throw Error();
							} catch (x$2) {
								control = x$2;
							}
							(Fake = fn()) && "function" === typeof Fake.catch && Fake.catch(function() {});
						}
					} catch (sample) {
						if (sample && control && "string" === typeof sample.stack) return [sample.stack, control.stack];
					}
					return [null, null];
				} };
				RunInRootFrame.DetermineComponentFrameRoot.displayName = "DetermineComponentFrameRoot";
				var namePropDescriptor = Object.getOwnPropertyDescriptor(RunInRootFrame.DetermineComponentFrameRoot, "name");
				namePropDescriptor && namePropDescriptor.configurable && Object.defineProperty(RunInRootFrame.DetermineComponentFrameRoot, "name", { value: "DetermineComponentFrameRoot" });
				var _RunInRootFrame$Deter = RunInRootFrame.DetermineComponentFrameRoot(), sampleStack = _RunInRootFrame$Deter[0], controlStack = _RunInRootFrame$Deter[1];
				if (sampleStack && controlStack) {
					var sampleLines = sampleStack.split("\n"), controlLines = controlStack.split("\n");
					for (namePropDescriptor = RunInRootFrame = 0; RunInRootFrame < sampleLines.length && !sampleLines[RunInRootFrame].includes("DetermineComponentFrameRoot");) RunInRootFrame++;
					for (; namePropDescriptor < controlLines.length && !controlLines[namePropDescriptor].includes("DetermineComponentFrameRoot");) namePropDescriptor++;
					if (RunInRootFrame === sampleLines.length || namePropDescriptor === controlLines.length) for (RunInRootFrame = sampleLines.length - 1, namePropDescriptor = controlLines.length - 1; 1 <= RunInRootFrame && 0 <= namePropDescriptor && sampleLines[RunInRootFrame] !== controlLines[namePropDescriptor];) namePropDescriptor--;
					for (; 1 <= RunInRootFrame && 0 <= namePropDescriptor; RunInRootFrame--, namePropDescriptor--) if (sampleLines[RunInRootFrame] !== controlLines[namePropDescriptor]) {
						if (1 !== RunInRootFrame || 1 !== namePropDescriptor) do
							if (RunInRootFrame--, namePropDescriptor--, 0 > namePropDescriptor || sampleLines[RunInRootFrame] !== controlLines[namePropDescriptor]) {
								var frame = "\n" + sampleLines[RunInRootFrame].replace(" at new ", " at ");
								fn.displayName && frame.includes("<anonymous>") && (frame = frame.replace("<anonymous>", fn.displayName));
								return frame;
							}
						while (1 <= RunInRootFrame && 0 <= namePropDescriptor);
						break;
					}
				}
			} finally {
				reentry = !1, Error.prepareStackTrace = previousPrepareStackTrace;
			}
			return (previousPrepareStackTrace = fn ? fn.displayName || fn.name : "") ? describeBuiltInComponentFrame(previousPrepareStackTrace) : "";
		}
		function describeFiber(fiber, childFiber) {
			switch (fiber.tag) {
				case 26:
				case 27:
				case 5: return describeBuiltInComponentFrame(fiber.type);
				case 16: return describeBuiltInComponentFrame("Lazy");
				case 13: return fiber.child !== childFiber && null !== childFiber ? describeBuiltInComponentFrame("Suspense Fallback") : describeBuiltInComponentFrame("Suspense");
				case 19: return describeBuiltInComponentFrame("SuspenseList");
				case 0:
				case 15: return describeNativeComponentFrame(fiber.type, !1);
				case 11: return describeNativeComponentFrame(fiber.type.render, !1);
				case 1: return describeNativeComponentFrame(fiber.type, !0);
				case 31: return describeBuiltInComponentFrame("Activity");
				case 30: return describeBuiltInComponentFrame("ViewTransition");
				default: return "";
			}
		}
		function getStackByFiberInDevAndProd(workInProgress) {
			try {
				var info = "", previous = null;
				do
					info += describeFiber(workInProgress, previous), previous = workInProgress, workInProgress = workInProgress.return;
				while (workInProgress);
				return info;
			} catch (x) {
				return "\nError generating stack: " + x.message + "\n" + x.stack;
			}
		}
		var hasOwnProperty = Object.prototype.hasOwnProperty;
		var scheduleCallback$3 = Scheduler.unstable_scheduleCallback;
		var cancelCallback$1 = Scheduler.unstable_cancelCallback;
		var shouldYield = Scheduler.unstable_shouldYield;
		var requestPaint = Scheduler.unstable_requestPaint;
		var now = Scheduler.unstable_now;
		var getCurrentPriorityLevel = Scheduler.unstable_getCurrentPriorityLevel;
		var ImmediatePriority = Scheduler.unstable_ImmediatePriority;
		var UserBlockingPriority = Scheduler.unstable_UserBlockingPriority;
		var NormalPriority$1 = Scheduler.unstable_NormalPriority;
		var LowPriority = Scheduler.unstable_LowPriority;
		var IdlePriority = Scheduler.unstable_IdlePriority;
		var log$1 = Scheduler.log;
		var unstable_setDisableYieldValue = Scheduler.unstable_setDisableYieldValue;
		var rendererID = null;
		var injectedHook = null;
		function setIsStrictModeForDevtools(newIsStrictMode) {
			"function" === typeof log$1 && unstable_setDisableYieldValue(newIsStrictMode);
			if (injectedHook && "function" === typeof injectedHook.setStrictMode) try {
				injectedHook.setStrictMode(rendererID, newIsStrictMode);
			} catch (err) {}
		}
		var clz32 = Math.clz32 ? Math.clz32 : clz32Fallback;
		var log = Math.log;
		var LN2 = Math.LN2;
		function clz32Fallback(x) {
			x >>>= 0;
			return 0 === x ? 32 : 31 - (log(x) / LN2 | 0) | 0;
		}
		var nextTransitionUpdateLane = 256;
		var nextTransitionDeferredLane = 262144;
		var nextRetryLane = 4194304;
		function getHighestPriorityLanes(lanes) {
			var pendingSyncLanes = lanes & 42;
			if (0 !== pendingSyncLanes) return pendingSyncLanes;
			switch (lanes & -lanes) {
				case 1: return 1;
				case 2: return 2;
				case 4: return 4;
				case 8: return 8;
				case 16: return 16;
				case 32: return 32;
				case 64: return 64;
				case 128: return 128;
				case 256:
				case 512:
				case 1024:
				case 2048:
				case 4096:
				case 8192:
				case 16384:
				case 32768:
				case 65536:
				case 131072: return lanes & -lanes;
				case 262144:
				case 524288:
				case 1048576:
				case 2097152: return lanes & 3932160;
				case 4194304:
				case 8388608:
				case 16777216:
				case 33554432: return lanes & 62914560;
				case 67108864: return 67108864;
				case 134217728: return 134217728;
				case 268435456: return 268435456;
				case 536870912: return 536870912;
				case 1073741824: return 0;
				default: return lanes;
			}
		}
		function getNextLanes(root, wipLanes, rootHasPendingCommit) {
			var pendingLanes = root.pendingLanes;
			if (0 === pendingLanes) return 0;
			var nextLanes = 0, suspendedLanes = root.suspendedLanes, pingedLanes = root.pingedLanes;
			root = root.warmLanes;
			var nonIdlePendingLanes = pendingLanes & 134217727;
			0 !== nonIdlePendingLanes ? (pendingLanes = nonIdlePendingLanes & ~suspendedLanes, 0 !== pendingLanes ? nextLanes = getHighestPriorityLanes(pendingLanes) : (pingedLanes &= nonIdlePendingLanes, 0 !== pingedLanes ? nextLanes = getHighestPriorityLanes(pingedLanes) : rootHasPendingCommit || (rootHasPendingCommit = nonIdlePendingLanes & ~root, 0 !== rootHasPendingCommit && (nextLanes = getHighestPriorityLanes(rootHasPendingCommit))))) : (nonIdlePendingLanes = pendingLanes & ~suspendedLanes, 0 !== nonIdlePendingLanes ? nextLanes = getHighestPriorityLanes(nonIdlePendingLanes) : 0 !== pingedLanes ? nextLanes = getHighestPriorityLanes(pingedLanes) : rootHasPendingCommit || (rootHasPendingCommit = pendingLanes & ~root, 0 !== rootHasPendingCommit && (nextLanes = getHighestPriorityLanes(rootHasPendingCommit))));
			return 0 === nextLanes ? 0 : 0 !== wipLanes && wipLanes !== nextLanes && 0 === (wipLanes & suspendedLanes) && (suspendedLanes = nextLanes & -nextLanes, rootHasPendingCommit = wipLanes & -wipLanes, suspendedLanes >= rootHasPendingCommit || 32 === suspendedLanes && 0 !== (rootHasPendingCommit & 4194048)) ? wipLanes : nextLanes;
		}
		function checkIfRootIsPrerendering(root, renderLanes) {
			return 0 === (root.pendingLanes & ~(root.suspendedLanes & ~root.pingedLanes) & renderLanes);
		}
		function getEntangledLanes(root, renderLanes) {
			0 !== (renderLanes & 8) && (renderLanes |= renderLanes & 32);
			var allEntangledLanes = root.entangledLanes;
			if (0 !== allEntangledLanes) for (root = root.entanglements, allEntangledLanes &= renderLanes; 0 < allEntangledLanes;) {
				var index$4 = 31 - clz32(allEntangledLanes), lane = 1 << index$4;
				renderLanes |= root[index$4];
				allEntangledLanes &= ~lane;
			}
			return renderLanes;
		}
		function computeExpirationTime(lane, currentTime) {
			switch (lane) {
				case 1:
				case 2:
				case 4:
				case 8:
				case 64: return currentTime + 250;
				case 16:
				case 32:
				case 128:
				case 256:
				case 512:
				case 1024:
				case 2048:
				case 4096:
				case 8192:
				case 16384:
				case 32768:
				case 65536:
				case 131072:
				case 262144:
				case 524288:
				case 1048576:
				case 2097152: return currentTime + 5e3;
				case 4194304:
				case 8388608:
				case 16777216:
				case 33554432: return -1;
				case 67108864:
				case 134217728:
				case 268435456:
				case 536870912:
				case 1073741824: return -1;
				default: return -1;
			}
		}
		function claimNextRetryLane() {
			var lane = nextRetryLane;
			nextRetryLane <<= 1;
			0 === (nextRetryLane & 62914560) && (nextRetryLane = 4194304);
			return lane;
		}
		function createLaneMap(initial) {
			for (var laneMap = [], i = 0; 31 > i; i++) laneMap.push(initial);
			return laneMap;
		}
		function markRootUpdated$1(root, updateLane) {
			root.pendingLanes |= updateLane;
			268435456 !== updateLane && (root.suspendedLanes = 0, root.pingedLanes = 0, root.warmLanes = 0);
		}
		function markRootFinished(root, finishedLanes, remainingLanes, spawnedLane, updatedLanes, suspendedRetryLanes) {
			var previouslyPendingLanes = root.pendingLanes;
			root.pendingLanes = remainingLanes;
			root.suspendedLanes = 0;
			root.pingedLanes = 0;
			root.warmLanes = 0;
			root.expiredLanes &= remainingLanes;
			root.entangledLanes &= remainingLanes;
			root.errorRecoveryDisabledLanes &= remainingLanes;
			root.shellSuspendCounter = 0;
			var entanglements = root.entanglements, expirationTimes = root.expirationTimes, hiddenUpdates = root.hiddenUpdates;
			for (remainingLanes = previouslyPendingLanes & ~remainingLanes; 0 < remainingLanes;) {
				var index$7 = 31 - clz32(remainingLanes), lane = 1 << index$7;
				entanglements[index$7] = 0;
				expirationTimes[index$7] = -1;
				var hiddenUpdatesForLane = hiddenUpdates[index$7];
				if (null !== hiddenUpdatesForLane) for (hiddenUpdates[index$7] = null, index$7 = 0; index$7 < hiddenUpdatesForLane.length; index$7++) {
					var update = hiddenUpdatesForLane[index$7];
					null !== update && (update.lane &= -536870913);
				}
				remainingLanes &= ~lane;
			}
			0 !== spawnedLane && markSpawnedDeferredLane(root, spawnedLane, 0);
			0 !== suspendedRetryLanes && 0 === updatedLanes && 0 !== root.tag && (root.suspendedLanes |= suspendedRetryLanes & ~(previouslyPendingLanes & ~finishedLanes));
		}
		function markSpawnedDeferredLane(root, spawnedLane, entangledLanes) {
			root.pendingLanes |= spawnedLane;
			root.suspendedLanes &= ~spawnedLane;
			var spawnedLaneIndex = 31 - clz32(spawnedLane);
			root.entangledLanes |= spawnedLane;
			root.entanglements[spawnedLaneIndex] = root.entanglements[spawnedLaneIndex] | 1073741824 | entangledLanes & 261930;
		}
		function markRootEntangled(root, entangledLanes) {
			var rootEntangledLanes = root.entangledLanes |= entangledLanes;
			for (root = root.entanglements; rootEntangledLanes;) {
				var index$8 = 31 - clz32(rootEntangledLanes), lane = 1 << index$8;
				lane & entangledLanes | root[index$8] & entangledLanes && (root[index$8] |= entangledLanes);
				rootEntangledLanes &= ~lane;
			}
		}
		function getBumpedLaneForHydration(root, renderLanes) {
			var renderLane = renderLanes & -renderLanes;
			renderLane = 0 !== (renderLane & 42) ? 1 : getBumpedLaneForHydrationByLane(renderLane);
			return 0 !== (renderLane & (root.suspendedLanes | renderLanes)) ? 0 : renderLane;
		}
		function getBumpedLaneForHydrationByLane(lane) {
			switch (lane) {
				case 2:
					lane = 1;
					break;
				case 8:
					lane = 4;
					break;
				case 32:
					lane = 16;
					break;
				case 256:
				case 512:
				case 1024:
				case 2048:
				case 4096:
				case 8192:
				case 16384:
				case 32768:
				case 65536:
				case 131072:
				case 262144:
				case 524288:
				case 1048576:
				case 2097152:
				case 4194304:
				case 8388608:
				case 16777216:
				case 33554432:
					lane = 128;
					break;
				case 268435456:
					lane = 134217728;
					break;
				default: lane = 0;
			}
			return lane;
		}
		function lanesToEventPriority(lanes) {
			lanes &= -lanes;
			return 2 < lanes ? 8 < lanes ? 0 !== (lanes & 134217727) ? 32 : 268435456 : 8 : 2;
		}
		function resolveUpdatePriority() {
			var updatePriority = ReactDOMSharedInternals.p;
			if (0 !== updatePriority) return updatePriority;
			updatePriority = window.event;
			return void 0 === updatePriority ? 32 : getEventPriority(updatePriority.type);
		}
		function runWithPriority(priority, fn) {
			var previousPriority = ReactDOMSharedInternals.p;
			try {
				return ReactDOMSharedInternals.p = priority, fn();
			} finally {
				ReactDOMSharedInternals.p = previousPriority;
			}
		}
		var randomKey = Math.random().toString(36).slice(2);
		var internalInstanceKey = "__reactFiber$" + randomKey;
		var internalPropsKey = "__reactProps$" + randomKey;
		var internalContainerInstanceKey = "__reactContainer$" + randomKey;
		var internalEventHandlersKey = "__reactEvents$" + randomKey;
		var internalEventHandlerListenersKey = "__reactListeners$" + randomKey;
		var internalEventHandlesSetKey = "__reactHandles$" + randomKey;
		var internalRootNodeResourcesKey = "__reactResources$" + randomKey;
		var internalHoistableMarker = "__reactMarker$" + randomKey;
		var internalLoadPendingKey = "__reactLoad$" + randomKey;
		function detachDeletedInstance(node) {
			delete node[internalInstanceKey];
			delete node[internalPropsKey];
			delete node[internalEventHandlerListenersKey];
			delete node[internalEventHandlesSetKey];
		}
		function getClosestInstanceFromNode(targetNode) {
			var targetInst;
			if (targetInst = targetNode[internalInstanceKey]) return targetInst;
			for (var parentNode = targetNode.parentNode; parentNode;) {
				if (targetInst = parentNode[internalContainerInstanceKey] || parentNode[internalInstanceKey]) {
					parentNode = targetInst.alternate;
					if (null !== targetInst.child || null !== parentNode && null !== parentNode.child) for (targetNode = getParentHydrationBoundary(targetNode); null !== targetNode;) {
						if (parentNode = targetNode[internalInstanceKey]) return parentNode;
						targetNode = getParentHydrationBoundary(targetNode);
					}
					return targetInst;
				}
				targetNode = parentNode;
				parentNode = targetNode.parentNode;
			}
			return null;
		}
		function getInstanceFromNode(node) {
			if (node = node[internalInstanceKey] || node[internalContainerInstanceKey]) {
				var tag = node.tag;
				if (5 === tag || 6 === tag || 13 === tag || 31 === tag || 26 === tag || 27 === tag || 3 === tag) return node;
			}
			return null;
		}
		function getNodeFromInstance(inst) {
			var tag = inst.tag;
			if (5 === tag || 26 === tag || 27 === tag || 6 === tag) return inst.stateNode;
			throw Error(formatProdErrorMessage(33));
		}
		function getResourcesFromRoot(root) {
			var resources = root[internalRootNodeResourcesKey];
			resources || (resources = root[internalRootNodeResourcesKey] = {
				hoistableStyles: new Map(),
				hoistableScripts: new Map()
			});
			return resources;
		}
		function markNodeAsHoistable(node) {
			node[internalHoistableMarker] = !0;
		}
		function clearPendingLoadOnNode(node) {
			node[internalLoadPendingKey] = void 0;
		}
		var allNativeEvents = new Set();
		var registrationNameDependencies = {};
		function registerTwoPhaseEvent(registrationName, dependencies) {
			registerDirectEvent(registrationName, dependencies);
			registerDirectEvent(registrationName + "Capture", dependencies);
		}
		function registerDirectEvent(registrationName, dependencies) {
			registrationNameDependencies[registrationName] = dependencies;
			for (registrationName = 0; registrationName < dependencies.length; registrationName++) allNativeEvents.add(dependencies[registrationName]);
		}
		var VALID_ATTRIBUTE_NAME_REGEX = RegExp("^[:A-Z_a-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD][:A-Z_a-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD\\-.0-9\\u00B7\\u0300-\\u036F\\u203F-\\u2040]*$");
		var illegalAttributeNameCache = {};
		var validatedAttributeNameCache = {};
		function isAttributeNameSafe(attributeName) {
			if (hasOwnProperty.call(validatedAttributeNameCache, attributeName)) return !0;
			if (hasOwnProperty.call(illegalAttributeNameCache, attributeName)) return !1;
			if (VALID_ATTRIBUTE_NAME_REGEX.test(attributeName)) return validatedAttributeNameCache[attributeName] = !0;
			illegalAttributeNameCache[attributeName] = !0;
			return !1;
		}
		var viewTransitionMutationContext = !1;
		function pushMutationContext() {
			var prev = viewTransitionMutationContext;
			viewTransitionMutationContext = !1;
			return prev;
		}
		function setValueForAttribute(node, name, value) {
			if (isAttributeNameSafe(name)) if (null === value) node.removeAttribute(name);
			else {
				switch (typeof value) {
					case "undefined":
					case "function":
					case "symbol":
						node.removeAttribute(name);
						return;
					case "boolean":
						var prefix$10 = name.toLowerCase().slice(0, 5);
						if ("data-" !== prefix$10 && "aria-" !== prefix$10) {
							node.removeAttribute(name);
							return;
						}
				}
				node.setAttribute(name, value);
			}
		}
		function setValueForKnownAttribute(node, name, value) {
			if (null === value) node.removeAttribute(name);
			else {
				switch (typeof value) {
					case "undefined":
					case "function":
					case "symbol":
					case "boolean":
						node.removeAttribute(name);
						return;
				}
				node.setAttribute(name, value);
			}
		}
		function setValueForNamespacedAttribute(node, namespace, name, value) {
			if (null === value) node.removeAttribute(name);
			else {
				switch (typeof value) {
					case "undefined":
					case "function":
					case "symbol":
					case "boolean":
						node.removeAttribute(name);
						return;
				}
				node.setAttributeNS(namespace, name, value);
			}
		}
		function getToStringValue(value) {
			switch (typeof value) {
				case "bigint":
				case "boolean":
				case "number":
				case "string":
				case "undefined": return value;
				case "object": return value;
				default: return "";
			}
		}
		function isCheckable(elem) {
			var type = elem.type;
			return (elem = elem.nodeName) && "input" === elem.toLowerCase() && ("checkbox" === type || "radio" === type);
		}
		function trackValueOnNode(node, valueField, currentValue) {
			var descriptor = Object.getOwnPropertyDescriptor(node.constructor.prototype, valueField);
			if (!node.hasOwnProperty(valueField) && "undefined" !== typeof descriptor && "function" === typeof descriptor.get && "function" === typeof descriptor.set) {
				var get = descriptor.get, set = descriptor.set;
				Object.defineProperty(node, valueField, {
					configurable: !0,
					get: function() {
						return get.call(this);
					},
					set: function(value) {
						currentValue = "" + value;
						set.call(this, value);
					}
				});
				Object.defineProperty(node, valueField, { enumerable: descriptor.enumerable });
				return {
					getValue: function() {
						return currentValue;
					},
					setValue: function(value) {
						currentValue = "" + value;
					},
					stopTracking: function() {
						node._valueTracker = null;
						delete node[valueField];
					}
				};
			}
		}
		function track(node) {
			if (!node._valueTracker) {
				var valueField = isCheckable(node) ? "checked" : "value";
				node._valueTracker = trackValueOnNode(node, valueField, "" + node[valueField]);
			}
		}
		function updateValueIfChanged(node) {
			if (!node) return !1;
			var tracker = node._valueTracker;
			if (!tracker) return !0;
			var lastValue = tracker.getValue();
			var value = "";
			node && (value = isCheckable(node) ? node.checked ? "true" : "false" : node.value);
			node = value;
			return node !== lastValue ? (tracker.setValue(node), !0) : !1;
		}
		var escapeSelectorAttributeValueInsideDoubleQuotesRegex = /[\n"\\]/g;
		function escapeSelectorAttributeValueInsideDoubleQuotes(value) {
			return value.replace(escapeSelectorAttributeValueInsideDoubleQuotesRegex, function(ch) {
				return "\\" + ch.charCodeAt(0).toString(16) + " ";
			});
		}
		function updateInput(element, value, defaultValue, lastDefaultValue, checked, defaultChecked, type, name) {
			element.name = "";
			null != type && "function" !== typeof type && "symbol" !== typeof type && "boolean" !== typeof type ? element.type = type : element.removeAttribute("type");
			if (null != value) if ("number" === type) {
				if (0 === value && "" === element.value || element.value != value) element.value = "" + getToStringValue(value);
			} else element.value !== "" + getToStringValue(value) && (element.value = "" + getToStringValue(value));
			else "submit" !== type && "reset" !== type || element.removeAttribute("value");
			null != value ? "number" === type && element.value == value ? setDefaultValue(element, getToStringValue(element.value)) : setDefaultValue(element, getToStringValue(value)) : null != defaultValue ? setDefaultValue(element, getToStringValue(defaultValue)) : null != lastDefaultValue && element.removeAttribute("value");
			null == checked && null != defaultChecked && (element.defaultChecked = !!defaultChecked);
			null != checked && (element.checked = checked && "function" !== typeof checked && "symbol" !== typeof checked);
			null != name && "function" !== typeof name && "symbol" !== typeof name && "boolean" !== typeof name ? element.name = "" + getToStringValue(name) : element.removeAttribute("name");
		}
		function initInput(element, value, defaultValue, checked, defaultChecked, type, name, isHydrating) {
			null != type && "function" !== typeof type && "symbol" !== typeof type && "boolean" !== typeof type && (element.type = type);
			if (null != value || null != defaultValue) {
				if (!("submit" !== type && "reset" !== type || void 0 !== value && null !== value)) {
					track(element);
					return;
				}
				defaultValue = null != defaultValue ? "" + getToStringValue(defaultValue) : "";
				value = null != value ? "" + getToStringValue(value) : defaultValue;
				isHydrating || value === element.value || (element.value = value);
				element.defaultValue = value;
			}
			checked = null != checked ? checked : defaultChecked;
			checked = "function" !== typeof checked && "symbol" !== typeof checked && !!checked;
			element.checked = isHydrating ? element.checked : !!checked;
			element.defaultChecked = !!checked;
			null != name && "function" !== typeof name && "symbol" !== typeof name && "boolean" !== typeof name && (element.name = name);
			track(element);
		}
		function setDefaultValue(node, value) {
			node.defaultValue !== "" + value && (node.defaultValue = "" + value);
		}
		function updateOptions(node, multiple, propValue, setDefaultSelected) {
			node = node.options;
			if (multiple) {
				multiple = {};
				for (var i = 0; i < propValue.length; i++) multiple["$" + propValue[i]] = !0;
				for (propValue = 0; propValue < node.length; propValue++) i = multiple.hasOwnProperty("$" + node[propValue].value), node[propValue].selected !== i && (node[propValue].selected = i), i && setDefaultSelected && (node[propValue].defaultSelected = !0);
			} else {
				propValue = "" + getToStringValue(propValue);
				multiple = null;
				for (i = 0; i < node.length; i++) {
					if (node[i].value === propValue) {
						node[i].selected = !0;
						setDefaultSelected && (node[i].defaultSelected = !0);
						return;
					}
					null !== multiple || node[i].disabled || (multiple = node[i]);
				}
				null !== multiple && (multiple.selected = !0);
			}
		}
		function updateTextarea(element, value, defaultValue) {
			if (null != value && (value = "" + getToStringValue(value), value !== element.value && (element.value = value), null == defaultValue)) {
				element.defaultValue !== value && (element.defaultValue = value);
				return;
			}
			element.defaultValue = null != defaultValue ? "" + getToStringValue(defaultValue) : "";
		}
		function initTextarea(element, value, defaultValue, children) {
			if (null == value) {
				if (null != children) {
					if (null != defaultValue) throw Error(formatProdErrorMessage(92));
					if (isArrayImpl(children)) {
						if (1 < children.length) throw Error(formatProdErrorMessage(93));
						children = children[0];
					}
					defaultValue = children;
				}
				defaultValue ??= "";
				value = defaultValue;
			}
			defaultValue = getToStringValue(value);
			element.defaultValue = defaultValue;
			children = element.textContent;
			children === defaultValue && "" !== children && null !== children && (element.value = children);
			track(element);
		}
		function setTextContent(node, text) {
			if (text) {
				var firstChild = node.firstChild;
				if (firstChild && firstChild === node.lastChild && 3 === firstChild.nodeType) {
					firstChild.nodeValue = text;
					return;
				}
			}
			node.textContent = text;
		}
		var unitlessNumbers = new Set("animationIterationCount aspectRatio borderImageOutset borderImageSlice borderImageWidth boxFlex boxFlexGroup boxOrdinalGroup columnCount columns flex flexGrow flexPositive flexShrink flexNegative flexOrder gridArea gridRow gridRowEnd gridRowSpan gridRowStart gridColumn gridColumnEnd gridColumnSpan gridColumnStart fontWeight lineClamp lineHeight opacity order orphans scale tabSize widows zIndex zoom fillOpacity floodOpacity stopOpacity strokeDasharray strokeDashoffset strokeMiterlimit strokeOpacity strokeWidth MozAnimationIterationCount MozBoxFlex MozBoxFlexGroup MozLineClamp msAnimationIterationCount msFlex msZoom msFlexGrow msFlexNegative msFlexOrder msFlexPositive msFlexShrink msGridColumn msGridColumnSpan msGridRow msGridRowSpan WebkitAnimationIterationCount WebkitBoxFlex WebKitBoxFlexGroup WebkitBoxOrdinalGroup WebkitColumnCount WebkitColumns WebkitFlex WebkitFlexGrow WebkitFlexPositive WebkitFlexShrink WebkitLineClamp".split(" "));
		function setValueForStyle(style, styleName, value) {
			var isCustomProperty = 0 === styleName.indexOf("--");
			null == value || "boolean" === typeof value || "" === value ? isCustomProperty ? style.setProperty(styleName, "") : "float" === styleName ? style.cssFloat = "" : style[styleName] = "" : isCustomProperty ? style.setProperty(styleName, value) : "number" !== typeof value || 0 === value || unitlessNumbers.has(styleName) ? "float" === styleName ? style.cssFloat = value : style[styleName] = ("" + value).trim() : style[styleName] = value + "px";
		}
		function setValueForStyles(node, styles, prevStyles) {
			if (null != styles && "object" !== typeof styles) throw Error(formatProdErrorMessage(62));
			node = node.style;
			if (null != prevStyles) {
				for (var styleName in prevStyles) !prevStyles.hasOwnProperty(styleName) || null != styles && styles.hasOwnProperty(styleName) || (0 === styleName.indexOf("--") ? node.setProperty(styleName, "") : "float" === styleName ? node.cssFloat = "" : node[styleName] = "", viewTransitionMutationContext = !0);
				for (var styleName$16 in styles) styleName = styles[styleName$16], styles.hasOwnProperty(styleName$16) && prevStyles[styleName$16] !== styleName && (setValueForStyle(node, styleName$16, styleName), viewTransitionMutationContext = !0);
			} else for (var styleName$17 in styles) styles.hasOwnProperty(styleName$17) && setValueForStyle(node, styleName$17, styles[styleName$17]);
		}
		function isCustomElement(tagName) {
			if (-1 === tagName.indexOf("-")) return !1;
			switch (tagName) {
				case "annotation-xml":
				case "color-profile":
				case "font-face":
				case "font-face-src":
				case "font-face-uri":
				case "font-face-format":
				case "font-face-name":
				case "missing-glyph": return !1;
				default: return !0;
			}
		}
		var aliases = new Map([
			["acceptCharset", "accept-charset"],
			["htmlFor", "for"],
			["httpEquiv", "http-equiv"],
			["crossOrigin", "crossorigin"],
			["accentHeight", "accent-height"],
			["alignmentBaseline", "alignment-baseline"],
			["arabicForm", "arabic-form"],
			["baselineShift", "baseline-shift"],
			["capHeight", "cap-height"],
			["clipPath", "clip-path"],
			["clipRule", "clip-rule"],
			["colorInterpolation", "color-interpolation"],
			["colorInterpolationFilters", "color-interpolation-filters"],
			["colorProfile", "color-profile"],
			["colorRendering", "color-rendering"],
			["dominantBaseline", "dominant-baseline"],
			["enableBackground", "enable-background"],
			["fillOpacity", "fill-opacity"],
			["fillRule", "fill-rule"],
			["floodColor", "flood-color"],
			["floodOpacity", "flood-opacity"],
			["fontFamily", "font-family"],
			["fontSize", "font-size"],
			["fontSizeAdjust", "font-size-adjust"],
			["fontStretch", "font-stretch"],
			["fontStyle", "font-style"],
			["fontVariant", "font-variant"],
			["fontWeight", "font-weight"],
			["glyphName", "glyph-name"],
			["glyphOrientationHorizontal", "glyph-orientation-horizontal"],
			["glyphOrientationVertical", "glyph-orientation-vertical"],
			["horizAdvX", "horiz-adv-x"],
			["horizOriginX", "horiz-origin-x"],
			["imageRendering", "image-rendering"],
			["letterSpacing", "letter-spacing"],
			["lightingColor", "lighting-color"],
			["markerEnd", "marker-end"],
			["markerMid", "marker-mid"],
			["markerStart", "marker-start"],
			["maskType", "mask-type"],
			["overlinePosition", "overline-position"],
			["overlineThickness", "overline-thickness"],
			["paintOrder", "paint-order"],
			["panose-1", "panose-1"],
			["pointerEvents", "pointer-events"],
			["renderingIntent", "rendering-intent"],
			["shapeRendering", "shape-rendering"],
			["stopColor", "stop-color"],
			["stopOpacity", "stop-opacity"],
			["strikethroughPosition", "strikethrough-position"],
			["strikethroughThickness", "strikethrough-thickness"],
			["strokeDasharray", "stroke-dasharray"],
			["strokeDashoffset", "stroke-dashoffset"],
			["strokeLinecap", "stroke-linecap"],
			["strokeLinejoin", "stroke-linejoin"],
			["strokeMiterlimit", "stroke-miterlimit"],
			["strokeOpacity", "stroke-opacity"],
			["strokeWidth", "stroke-width"],
			["textAnchor", "text-anchor"],
			["textDecoration", "text-decoration"],
			["textRendering", "text-rendering"],
			["transformOrigin", "transform-origin"],
			["underlinePosition", "underline-position"],
			["underlineThickness", "underline-thickness"],
			["unicodeBidi", "unicode-bidi"],
			["unicodeRange", "unicode-range"],
			["unitsPerEm", "units-per-em"],
			["vAlphabetic", "v-alphabetic"],
			["vHanging", "v-hanging"],
			["vIdeographic", "v-ideographic"],
			["vMathematical", "v-mathematical"],
			["vectorEffect", "vector-effect"],
			["vertAdvY", "vert-adv-y"],
			["vertOriginX", "vert-origin-x"],
			["vertOriginY", "vert-origin-y"],
			["wordSpacing", "word-spacing"],
			["writingMode", "writing-mode"],
			["xmlnsXlink", "xmlns:xlink"],
			["xHeight", "x-height"]
		]);
		var isJavaScriptProtocol = /^[\u0000-\u001F ]*j[\r\n\t]*a[\r\n\t]*v[\r\n\t]*a[\r\n\t]*s[\r\n\t]*c[\r\n\t]*r[\r\n\t]*i[\r\n\t]*p[\r\n\t]*t[\r\n\t]*:/i;
		function sanitizeURL(url) {
			return isJavaScriptProtocol.test("" + url) ? "javascript:throw new Error('React has blocked a javascript: URL as a security precaution.')" : url;
		}
		function noop$1() {}
		var currentReplayingEvent = null;
		function getEventTarget(nativeEvent) {
			nativeEvent = nativeEvent.target || nativeEvent.srcElement || window;
			nativeEvent.correspondingUseElement && (nativeEvent = nativeEvent.correspondingUseElement);
			return 3 === nativeEvent.nodeType ? nativeEvent.parentNode : nativeEvent;
		}
		var restoreTarget = null;
		var restoreQueue = null;
		function restoreStateOfTarget(target) {
			var internalInstance = getInstanceFromNode(target);
			if (internalInstance && (target = internalInstance.stateNode)) {
				var props = target[internalPropsKey] || null;
				a: switch (target = internalInstance.stateNode, internalInstance.type) {
					case "input":
						updateInput(target, props.value, props.defaultValue, props.defaultValue, props.checked, props.defaultChecked, props.type, props.name);
						internalInstance = props.name;
						if ("radio" === props.type && null != internalInstance) {
							for (props = target; props.parentNode;) props = props.parentNode;
							props = props.querySelectorAll("input[name=\"" + escapeSelectorAttributeValueInsideDoubleQuotes("" + internalInstance) + "\"][type=\"radio\"]");
							for (internalInstance = 0; internalInstance < props.length; internalInstance++) {
								var otherNode = props[internalInstance];
								if (otherNode !== target && otherNode.form === target.form) {
									var otherProps = otherNode[internalPropsKey] || null;
									if (!otherProps) throw Error(formatProdErrorMessage(90));
									updateInput(otherNode, otherProps.value, otherProps.defaultValue, otherProps.defaultValue, otherProps.checked, otherProps.defaultChecked, otherProps.type, otherProps.name);
								}
							}
							for (internalInstance = 0; internalInstance < props.length; internalInstance++) otherNode = props[internalInstance], otherNode.form === target.form && updateValueIfChanged(otherNode);
						}
						break a;
					case "textarea":
						updateTextarea(target, props.value, props.defaultValue);
						break a;
					case "select": internalInstance = props.value, null != internalInstance && updateOptions(target, !!props.multiple, internalInstance, !1);
				}
			}
		}
		var isInsideEventHandler = !1;
		function batchedUpdates$1(fn, a, b) {
			if (isInsideEventHandler) return fn(a, b);
			isInsideEventHandler = !0;
			try {
				return fn(a);
			} finally {
				if (isInsideEventHandler = !1, null !== restoreTarget || null !== restoreQueue) {
					if (flushSyncWork$1(), restoreTarget && (a = restoreTarget, fn = restoreQueue, restoreQueue = restoreTarget = null, restoreStateOfTarget(a), fn)) for (a = 0; a < fn.length; a++) restoreStateOfTarget(fn[a]);
				}
			}
		}
		function getListener(inst, registrationName) {
			var stateNode = inst.stateNode;
			if (null === stateNode) return null;
			var props = stateNode[internalPropsKey] || null;
			if (null === props) return null;
			stateNode = props[registrationName];
			a: switch (registrationName) {
				case "onClick":
				case "onClickCapture":
				case "onDoubleClick":
				case "onDoubleClickCapture":
				case "onMouseDown":
				case "onMouseDownCapture":
				case "onMouseMove":
				case "onMouseMoveCapture":
				case "onMouseUp":
				case "onMouseUpCapture":
				case "onMouseEnter":
					(props = !props.disabled) || (inst = inst.type, props = !("button" === inst || "input" === inst || "select" === inst || "textarea" === inst));
					inst = !props;
					break a;
				default: inst = !1;
			}
			if (inst) return null;
			if (stateNode && "function" !== typeof stateNode) throw Error(formatProdErrorMessage(231, registrationName, typeof stateNode));
			return stateNode;
		}
		var canUseDOM = !("undefined" === typeof window || "undefined" === typeof window.document || "undefined" === typeof window.document.createElement);
		var passiveBrowserEventsSupported = !1;
		if (canUseDOM) try {
			var options = {};
			Object.defineProperty(options, "passive", { get: function() {
				passiveBrowserEventsSupported = !0;
			} });
			window.addEventListener("test", options, options);
			window.removeEventListener("test", options, options);
		} catch (e) {
			passiveBrowserEventsSupported = !1;
		}
		var root = null;
		var startText = null;
		var fallbackText = null;
		function getData() {
			if (fallbackText) return fallbackText;
			var start, startValue = startText, startLength = startValue.length, end, endValue = "value" in root ? root.value : root.textContent, endLength = endValue.length;
			for (start = 0; start < startLength && startValue[start] === endValue[start]; start++);
			var minEnd = startLength - start;
			for (end = 1; end <= minEnd && startValue[startLength - end] === endValue[endLength - end]; end++);
			return fallbackText = endValue.slice(start, 1 < end ? 1 - end : void 0);
		}
		function getEventCharCode(nativeEvent) {
			var keyCode = nativeEvent.keyCode;
			"charCode" in nativeEvent ? (nativeEvent = nativeEvent.charCode, 0 === nativeEvent && 13 === keyCode && (nativeEvent = 13)) : nativeEvent = keyCode;
			10 === nativeEvent && (nativeEvent = 13);
			return 32 <= nativeEvent || 13 === nativeEvent ? nativeEvent : 0;
		}
		function functionThatReturnsTrue() {
			return !0;
		}
		function functionThatReturnsFalse() {
			return !1;
		}
		function createSyntheticEvent(Interface) {
			function SyntheticBaseEvent(reactName, reactEventType, targetInst, nativeEvent, nativeEventTarget) {
				this._reactName = reactName;
				this._targetInst = targetInst;
				this.type = reactEventType;
				this.nativeEvent = nativeEvent;
				this.target = nativeEventTarget;
				this.currentTarget = null;
				for (var propName in Interface) Interface.hasOwnProperty(propName) && (reactName = Interface[propName], this[propName] = reactName ? reactName(nativeEvent) : nativeEvent[propName]);
				this.isDefaultPrevented = (null != nativeEvent.defaultPrevented ? nativeEvent.defaultPrevented : !1 === nativeEvent.returnValue) ? functionThatReturnsTrue : functionThatReturnsFalse;
				this.isPropagationStopped = functionThatReturnsFalse;
				return this;
			}
			assign(SyntheticBaseEvent.prototype, {
				preventDefault: function() {
					this.defaultPrevented = !0;
					var event = this.nativeEvent;
					event && (event.preventDefault ? event.preventDefault() : "unknown" !== typeof event.returnValue && (event.returnValue = !1), this.isDefaultPrevented = functionThatReturnsTrue);
				},
				stopPropagation: function() {
					var event = this.nativeEvent;
					event && (event.stopPropagation ? event.stopPropagation() : "unknown" !== typeof event.cancelBubble && (event.cancelBubble = !0), this.isPropagationStopped = functionThatReturnsTrue);
				},
				persist: function() {},
				isPersistent: functionThatReturnsTrue
			});
			return SyntheticBaseEvent;
		}
		var EventInterface = {
			eventPhase: 0,
			bubbles: 0,
			cancelable: 0,
			timeStamp: function(event) {
				return event.timeStamp || Date.now();
			},
			defaultPrevented: 0,
			isTrusted: 0
		};
		var SyntheticEvent = createSyntheticEvent(EventInterface);
		var UIEventInterface = assign({}, EventInterface, {
			view: 0,
			detail: 0
		});
		var SyntheticUIEvent = createSyntheticEvent(UIEventInterface);
		var lastMovementX;
		var lastMovementY;
		var lastMouseEvent;
		var MouseEventInterface = assign({}, UIEventInterface, {
			screenX: 0,
			screenY: 0,
			clientX: 0,
			clientY: 0,
			pageX: 0,
			pageY: 0,
			ctrlKey: 0,
			shiftKey: 0,
			altKey: 0,
			metaKey: 0,
			getModifierState: getEventModifierState,
			button: 0,
			buttons: 0,
			relatedTarget: function(event) {
				return void 0 === event.relatedTarget ? event.fromElement === event.srcElement ? event.toElement : event.fromElement : event.relatedTarget;
			},
			movementX: function(event) {
				if ("movementX" in event) return event.movementX;
				event !== lastMouseEvent && (lastMouseEvent && "mousemove" === event.type ? (lastMovementX = event.screenX - lastMouseEvent.screenX, lastMovementY = event.screenY - lastMouseEvent.screenY) : lastMovementY = lastMovementX = 0, lastMouseEvent = event);
				return lastMovementX;
			},
			movementY: function(event) {
				return "movementY" in event ? event.movementY : lastMovementY;
			}
		});
		var SyntheticMouseEvent = createSyntheticEvent(MouseEventInterface);
		var SyntheticDragEvent = createSyntheticEvent(assign({}, MouseEventInterface, { dataTransfer: 0 }));
		var SyntheticFocusEvent = createSyntheticEvent(assign({}, UIEventInterface, { relatedTarget: 0 }));
		var SyntheticAnimationEvent = createSyntheticEvent(assign({}, EventInterface, {
			animationName: 0,
			elapsedTime: 0,
			pseudoElement: 0
		}));
		var SyntheticClipboardEvent = createSyntheticEvent(assign({}, EventInterface, { clipboardData: function(event) {
			return "clipboardData" in event ? event.clipboardData : window.clipboardData;
		} }));
		var SyntheticCompositionEvent = createSyntheticEvent(assign({}, EventInterface, { data: 0 }));
		var normalizeKey = {
			Esc: "Escape",
			Spacebar: " ",
			Left: "ArrowLeft",
			Up: "ArrowUp",
			Right: "ArrowRight",
			Down: "ArrowDown",
			Del: "Delete",
			Win: "OS",
			Menu: "ContextMenu",
			Apps: "ContextMenu",
			Scroll: "ScrollLock",
			MozPrintableKey: "Unidentified"
		};
		var translateToKey = {
			8: "Backspace",
			9: "Tab",
			12: "Clear",
			13: "Enter",
			16: "Shift",
			17: "Control",
			18: "Alt",
			19: "Pause",
			20: "CapsLock",
			27: "Escape",
			32: " ",
			33: "PageUp",
			34: "PageDown",
			35: "End",
			36: "Home",
			37: "ArrowLeft",
			38: "ArrowUp",
			39: "ArrowRight",
			40: "ArrowDown",
			45: "Insert",
			46: "Delete",
			112: "F1",
			113: "F2",
			114: "F3",
			115: "F4",
			116: "F5",
			117: "F6",
			118: "F7",
			119: "F8",
			120: "F9",
			121: "F10",
			122: "F11",
			123: "F12",
			144: "NumLock",
			145: "ScrollLock",
			224: "Meta"
		};
		var modifierKeyToProp = {
			Alt: "altKey",
			Control: "ctrlKey",
			Meta: "metaKey",
			Shift: "shiftKey"
		};
		function modifierStateGetter(keyArg) {
			var nativeEvent = this.nativeEvent;
			return nativeEvent.getModifierState ? nativeEvent.getModifierState(keyArg) : (keyArg = modifierKeyToProp[keyArg]) ? !!nativeEvent[keyArg] : !1;
		}
		function getEventModifierState() {
			return modifierStateGetter;
		}
		var SyntheticKeyboardEvent = createSyntheticEvent(assign({}, UIEventInterface, {
			key: function(nativeEvent) {
				if (nativeEvent.key) {
					var key = normalizeKey[nativeEvent.key] || nativeEvent.key;
					if ("Unidentified" !== key) return key;
				}
				return "keypress" === nativeEvent.type ? (nativeEvent = getEventCharCode(nativeEvent), 13 === nativeEvent ? "Enter" : String.fromCharCode(nativeEvent)) : "keydown" === nativeEvent.type || "keyup" === nativeEvent.type ? translateToKey[nativeEvent.keyCode] || "Unidentified" : "";
			},
			code: 0,
			location: 0,
			ctrlKey: 0,
			shiftKey: 0,
			altKey: 0,
			metaKey: 0,
			repeat: 0,
			locale: 0,
			getModifierState: getEventModifierState,
			charCode: function(event) {
				return "keypress" === event.type ? getEventCharCode(event) : 0;
			},
			keyCode: function(event) {
				return "keydown" === event.type || "keyup" === event.type ? event.keyCode : 0;
			},
			which: function(event) {
				return "keypress" === event.type ? getEventCharCode(event) : "keydown" === event.type || "keyup" === event.type ? event.keyCode : 0;
			}
		}));
		var SyntheticPointerEvent = createSyntheticEvent(assign({}, MouseEventInterface, {
			pointerId: 0,
			width: 0,
			height: 0,
			pressure: 0,
			tangentialPressure: 0,
			tiltX: 0,
			tiltY: 0,
			twist: 0,
			pointerType: 0,
			isPrimary: 0
		}));
		var SyntheticSubmitEvent = createSyntheticEvent(assign({}, EventInterface, { submitter: 0 }));
		var SyntheticTouchEvent = createSyntheticEvent(assign({}, UIEventInterface, {
			touches: 0,
			targetTouches: 0,
			changedTouches: 0,
			altKey: 0,
			metaKey: 0,
			ctrlKey: 0,
			shiftKey: 0,
			getModifierState: getEventModifierState
		}));
		var SyntheticTransitionEvent = createSyntheticEvent(assign({}, EventInterface, {
			propertyName: 0,
			elapsedTime: 0,
			pseudoElement: 0
		}));
		var SyntheticWheelEvent = createSyntheticEvent(assign({}, MouseEventInterface, {
			deltaX: function(event) {
				return "deltaX" in event ? event.deltaX : "wheelDeltaX" in event ? -event.wheelDeltaX : 0;
			},
			deltaY: function(event) {
				return "deltaY" in event ? event.deltaY : "wheelDeltaY" in event ? -event.wheelDeltaY : "wheelDelta" in event ? -event.wheelDelta : 0;
			},
			deltaZ: 0,
			deltaMode: 0
		}));
		var SyntheticToggleEvent = createSyntheticEvent(assign({}, EventInterface, {
			newState: 0,
			oldState: 0,
			source: 0
		}));
		var END_KEYCODES = [
			9,
			13,
			27,
			32
		];
		var canUseCompositionEvent = canUseDOM && "CompositionEvent" in window;
		var documentMode = null;
		canUseDOM && "documentMode" in document && (documentMode = document.documentMode);
		var canUseTextInputEvent = canUseDOM && "TextEvent" in window && !documentMode;
		var useFallbackCompositionData = canUseDOM && (!canUseCompositionEvent || documentMode && 8 < documentMode && 11 >= documentMode);
		var SPACEBAR_CHAR = String.fromCharCode(32);
		var hasSpaceKeypress = !1;
		function isFallbackCompositionEnd(domEventName, nativeEvent) {
			switch (domEventName) {
				case "keyup": return -1 !== END_KEYCODES.indexOf(nativeEvent.keyCode);
				case "keydown": return 229 !== nativeEvent.keyCode;
				case "keypress":
				case "mousedown":
				case "focusout": return !0;
				default: return !1;
			}
		}
		function getDataFromCustomEvent(nativeEvent) {
			nativeEvent = nativeEvent.detail;
			return "object" === typeof nativeEvent && "data" in nativeEvent ? nativeEvent.data : null;
		}
		var isComposing = !1;
		function getNativeBeforeInputChars(domEventName, nativeEvent) {
			switch (domEventName) {
				case "compositionend": return getDataFromCustomEvent(nativeEvent);
				case "keypress":
					if (32 !== nativeEvent.which) return null;
					hasSpaceKeypress = !0;
					return SPACEBAR_CHAR;
				case "textInput": return domEventName = nativeEvent.data, domEventName === SPACEBAR_CHAR && hasSpaceKeypress ? null : domEventName;
				default: return null;
			}
		}
		function getFallbackBeforeInputChars(domEventName, nativeEvent) {
			if (isComposing) return "compositionend" === domEventName || !canUseCompositionEvent && isFallbackCompositionEnd(domEventName, nativeEvent) ? (domEventName = getData(), fallbackText = startText = root = null, isComposing = !1, domEventName) : null;
			switch (domEventName) {
				case "paste": return null;
				case "keypress":
					if (!(nativeEvent.ctrlKey || nativeEvent.altKey || nativeEvent.metaKey) || nativeEvent.ctrlKey && nativeEvent.altKey) {
						if (nativeEvent.char && 1 < nativeEvent.char.length) return nativeEvent.char;
						if (nativeEvent.which) return String.fromCharCode(nativeEvent.which);
					}
					return null;
				case "compositionend": return useFallbackCompositionData && "ko" !== nativeEvent.locale ? null : nativeEvent.data;
				default: return null;
			}
		}
		var supportedInputTypes = {
			color: !0,
			date: !0,
			datetime: !0,
			"datetime-local": !0,
			email: !0,
			month: !0,
			number: !0,
			password: !0,
			range: !0,
			search: !0,
			tel: !0,
			text: !0,
			time: !0,
			url: !0,
			week: !0
		};
		function isTextInputElement(elem) {
			var nodeName = elem && elem.nodeName && elem.nodeName.toLowerCase();
			return "input" === nodeName ? !!supportedInputTypes[elem.type] : "textarea" === nodeName ? !0 : !1;
		}
		function createAndAccumulateChangeEvent(dispatchQueue, inst, nativeEvent, target) {
			restoreTarget ? restoreQueue ? restoreQueue.push(target) : restoreQueue = [target] : restoreTarget = target;
			inst = accumulateTwoPhaseListeners(inst, "onChange");
			0 < inst.length && (nativeEvent = new SyntheticEvent("onChange", "change", null, nativeEvent, target), dispatchQueue.push({
				event: nativeEvent,
				listeners: inst
			}));
		}
		var activeElement$1 = null;
		var activeElementInst$1 = null;
		function runEventInBatch(dispatchQueue) {
			processDispatchQueue(dispatchQueue, 0);
		}
		function getInstIfValueChanged(targetInst) {
			if (updateValueIfChanged(getNodeFromInstance(targetInst))) return targetInst;
		}
		function getTargetInstForChangeEvent(domEventName, targetInst) {
			if ("change" === domEventName) return targetInst;
		}
		var isInputEventSupported = !1;
		if (canUseDOM) {
			var JSCompiler_inline_result$jscomp$318;
			if (canUseDOM) {
				var isSupported$jscomp$inline_474 = "oninput" in document;
				if (!isSupported$jscomp$inline_474) {
					var element$jscomp$inline_475 = document.createElement("div");
					element$jscomp$inline_475.setAttribute("oninput", "return;");
					isSupported$jscomp$inline_474 = "function" === typeof element$jscomp$inline_475.oninput;
				}
				JSCompiler_inline_result$jscomp$318 = isSupported$jscomp$inline_474;
			} else JSCompiler_inline_result$jscomp$318 = !1;
			isInputEventSupported = JSCompiler_inline_result$jscomp$318 && (!document.documentMode || 9 < document.documentMode);
		}
		function stopWatchingForValueChange() {
			activeElement$1 && (activeElement$1.detachEvent("onpropertychange", handlePropertyChange), activeElementInst$1 = activeElement$1 = null);
		}
		function handlePropertyChange(nativeEvent) {
			if ("value" === nativeEvent.propertyName && getInstIfValueChanged(activeElementInst$1)) {
				var dispatchQueue = [];
				createAndAccumulateChangeEvent(dispatchQueue, activeElementInst$1, nativeEvent, getEventTarget(nativeEvent));
				batchedUpdates$1(runEventInBatch, dispatchQueue);
			}
		}
		function handleEventsForInputEventPolyfill(domEventName, target, targetInst) {
			"focusin" === domEventName ? (stopWatchingForValueChange(), activeElement$1 = target, activeElementInst$1 = targetInst, activeElement$1.attachEvent("onpropertychange", handlePropertyChange)) : "focusout" === domEventName && stopWatchingForValueChange();
		}
		function getTargetInstForInputEventPolyfill(domEventName) {
			if ("selectionchange" === domEventName || "keyup" === domEventName || "keydown" === domEventName) return getInstIfValueChanged(activeElementInst$1);
		}
		function getTargetInstForClickEvent(domEventName, targetInst) {
			if ("click" === domEventName) return getInstIfValueChanged(targetInst);
		}
		function getTargetInstForInputOrChangeEvent(domEventName, targetInst) {
			if ("input" === domEventName || "change" === domEventName) return getInstIfValueChanged(targetInst);
		}
		function is(x, y) {
			return x === y && (0 !== x || 1 / x === 1 / y) || x !== x && y !== y;
		}
		var objectIs = "function" === typeof Object.is ? Object.is : is;
		function shallowEqual(objA, objB) {
			if (objectIs(objA, objB)) return !0;
			if ("object" !== typeof objA || null === objA || "object" !== typeof objB || null === objB) return !1;
			var keysA = Object.keys(objA), keysB = Object.keys(objB);
			if (keysA.length !== keysB.length) return !1;
			for (keysB = 0; keysB < keysA.length; keysB++) {
				var currentKey = keysA[keysB];
				if (!hasOwnProperty.call(objB, currentKey) || !objectIs(objA[currentKey], objB[currentKey])) return !1;
			}
			return !0;
		}
		function getActiveElement(doc) {
			doc = doc || ("undefined" !== typeof document ? document : void 0);
			if ("undefined" === typeof doc) return null;
			try {
				return doc.activeElement || doc.body;
			} catch (e$20) {
				return doc.body;
			}
		}
		function getLeafNode(node) {
			for (; node && node.firstChild;) node = node.firstChild;
			return node;
		}
		function getNodeForCharacterOffset(root, offset) {
			var node = getLeafNode(root);
			root = 0;
			for (var nodeEnd; node;) {
				if (3 === node.nodeType) {
					nodeEnd = root + node.textContent.length;
					if (root <= offset && nodeEnd >= offset) return {
						node,
						offset: offset - root
					};
					root = nodeEnd;
				}
				a: {
					for (; node;) {
						if (node.nextSibling) {
							node = node.nextSibling;
							break a;
						}
						node = node.parentNode;
					}
					node = void 0;
				}
				node = getLeafNode(node);
			}
		}
		function containsNode(outerNode, innerNode) {
			return outerNode && innerNode ? outerNode === innerNode ? !0 : outerNode && 3 === outerNode.nodeType ? !1 : innerNode && 3 === innerNode.nodeType ? containsNode(outerNode, innerNode.parentNode) : "contains" in outerNode ? outerNode.contains(innerNode) : outerNode.compareDocumentPosition ? !!(outerNode.compareDocumentPosition(innerNode) & 16) : !1 : !1;
		}
		function getActiveElementDeep(containerInfo) {
			containerInfo = null != containerInfo && null != containerInfo.ownerDocument && null != containerInfo.ownerDocument.defaultView ? containerInfo.ownerDocument.defaultView : window;
			for (var element = getActiveElement(containerInfo.document); element instanceof containerInfo.HTMLIFrameElement;) {
				try {
					var JSCompiler_inline_result = "string" === typeof element.contentWindow.location.href;
				} catch (err) {
					JSCompiler_inline_result = !1;
				}
				if (JSCompiler_inline_result) containerInfo = element.contentWindow;
				else break;
				element = getActiveElement(containerInfo.document);
			}
			return element;
		}
		function hasSelectionCapabilities(elem) {
			var nodeName = elem && elem.nodeName && elem.nodeName.toLowerCase();
			return nodeName && ("input" === nodeName && ("text" === elem.type || "search" === elem.type || "tel" === elem.type || "url" === elem.type || "password" === elem.type) || "textarea" === nodeName || "true" === elem.contentEditable);
		}
		var skipSelectionChangeEvent = canUseDOM && "documentMode" in document && 11 >= document.documentMode;
		var activeElement = null;
		var activeElementInst = null;
		var lastSelection = null;
		var mouseDown = !1;
		function constructSelectEvent(dispatchQueue, nativeEvent, nativeEventTarget) {
			var doc = nativeEventTarget.window === nativeEventTarget ? nativeEventTarget.document : 9 === nativeEventTarget.nodeType ? nativeEventTarget : nativeEventTarget.ownerDocument;
			mouseDown || null == activeElement || activeElement !== getActiveElement(doc) || (doc = activeElement, "selectionStart" in doc && hasSelectionCapabilities(doc) ? doc = {
				start: doc.selectionStart,
				end: doc.selectionEnd
			} : (doc = (doc.ownerDocument && doc.ownerDocument.defaultView || window).getSelection(), doc = {
				anchorNode: doc.anchorNode,
				anchorOffset: doc.anchorOffset,
				focusNode: doc.focusNode,
				focusOffset: doc.focusOffset
			}), lastSelection && shallowEqual(lastSelection, doc) || (lastSelection = doc, doc = accumulateTwoPhaseListeners(activeElementInst, "onSelect"), 0 < doc.length && (nativeEvent = new SyntheticEvent("onSelect", "select", null, nativeEvent, nativeEventTarget), dispatchQueue.push({
				event: nativeEvent,
				listeners: doc
			}), nativeEvent.target = activeElement)));
		}
		function makePrefixMap(styleProp, eventName) {
			var prefixes = {};
			prefixes[styleProp.toLowerCase()] = eventName.toLowerCase();
			prefixes["Webkit" + styleProp] = "webkit" + eventName;
			prefixes["Moz" + styleProp] = "moz" + eventName;
			return prefixes;
		}
		var vendorPrefixes = {
			animationend: makePrefixMap("Animation", "AnimationEnd"),
			animationiteration: makePrefixMap("Animation", "AnimationIteration"),
			animationstart: makePrefixMap("Animation", "AnimationStart"),
			transitionrun: makePrefixMap("Transition", "TransitionRun"),
			transitionstart: makePrefixMap("Transition", "TransitionStart"),
			transitioncancel: makePrefixMap("Transition", "TransitionCancel"),
			transitionend: makePrefixMap("Transition", "TransitionEnd")
		};
		var prefixedEventNames = {};
		var style = {};
		canUseDOM && (style = document.createElement("div").style, "AnimationEvent" in window || (delete vendorPrefixes.animationend.animation, delete vendorPrefixes.animationiteration.animation, delete vendorPrefixes.animationstart.animation), "TransitionEvent" in window || delete vendorPrefixes.transitionend.transition);
		function getVendorPrefixedEventName(eventName) {
			if (prefixedEventNames[eventName]) return prefixedEventNames[eventName];
			if (!vendorPrefixes[eventName]) return eventName;
			var prefixMap = vendorPrefixes[eventName], styleProp;
			for (styleProp in prefixMap) if (prefixMap.hasOwnProperty(styleProp) && styleProp in style) return prefixedEventNames[eventName] = prefixMap[styleProp];
			return eventName;
		}
		var ANIMATION_END = getVendorPrefixedEventName("animationend");
		var ANIMATION_ITERATION = getVendorPrefixedEventName("animationiteration");
		var ANIMATION_START = getVendorPrefixedEventName("animationstart");
		var TRANSITION_RUN = getVendorPrefixedEventName("transitionrun");
		var TRANSITION_START = getVendorPrefixedEventName("transitionstart");
		var TRANSITION_CANCEL = getVendorPrefixedEventName("transitioncancel");
		var TRANSITION_END = getVendorPrefixedEventName("transitionend");
		var topLevelEventsToReactNames = new Map();
		var simpleEventPluginEvents = "abort auxClick beforeToggle cancel canPlay canPlayThrough click close contextMenu copy cut drag dragEnd dragEnter dragExit dragLeave dragOver dragStart drop durationChange emptied encrypted ended error fullscreenChange fullscreenError gotPointerCapture input invalid keyDown keyPress keyUp load loadedData loadedMetadata loadStart lostPointerCapture mouseDown mouseMove mouseOut mouseOver mouseUp paste pause play playing pointerCancel pointerDown pointerMove pointerOut pointerOver pointerUp progress rateChange reset resize seeked seeking stalled submit suspend timeUpdate touchCancel touchEnd touchStart volumeChange scroll toggle touchMove waiting wheel".split(" ");
		simpleEventPluginEvents.push("scrollEnd");
		function registerSimpleEvent(domEventName, reactName) {
			topLevelEventsToReactNames.set(domEventName, reactName);
			registerTwoPhaseEvent(reactName, [domEventName]);
		}
		var globalClientIdCounter$1 = 0;
		function getViewTransitionName(props, instance) {
			if (null != props.name && "auto" !== props.name) return props.name;
			if (null !== instance.autoName) return instance.autoName;
			props = pendingEffectsRoot.identifierPrefix;
			var globalClientId = globalClientIdCounter$1++;
			props = "_" + props + "t_" + globalClientId.toString(32) + "_";
			return instance.autoName = props;
		}
		function getClassNameByType(classByType) {
			if (null == classByType || "string" === typeof classByType) return classByType;
			var className = null, activeTypes = pendingTransitionTypes;
			if (null !== activeTypes) for (var i = 0; i < activeTypes.length; i++) {
				var match = classByType[activeTypes[i]];
				if (null != match) {
					if ("none" === match) return "none";
					className = null == className ? match : className + (" " + match);
				}
			}
			return null == className ? classByType.default : className;
		}
		function getViewTransitionClassName(defaultClass, eventClass) {
			defaultClass = getClassNameByType(defaultClass);
			eventClass = getClassNameByType(eventClass);
			return null == eventClass ? "auto" === defaultClass ? null : defaultClass : "auto" === eventClass ? null : eventClass;
		}
		var reportGlobalError = "function" === typeof reportError ? reportError : function(error) {
			if ("object" === typeof window && "function" === typeof window.ErrorEvent) {
				var event = new window.ErrorEvent("error", {
					bubbles: !0,
					cancelable: !0,
					message: "object" === typeof error && null !== error && "string" === typeof error.message ? String(error.message) : String(error),
					error
				});
				if (!window.dispatchEvent(event)) return;
			} else if ("object" === typeof process && "function" === typeof process.emit) {
				process.emit("uncaughtException", error);
				return;
			}
			console.error(error);
		};
		var concurrentQueues = [];
		var concurrentQueuesIndex = 0;
		var concurrentlyUpdatedLanes = 0;
		function finishQueueingConcurrentUpdates() {
			for (var endIndex = concurrentQueuesIndex, i = concurrentlyUpdatedLanes = concurrentQueuesIndex = 0; i < endIndex;) {
				var fiber = concurrentQueues[i];
				concurrentQueues[i++] = null;
				var queue = concurrentQueues[i];
				concurrentQueues[i++] = null;
				var update = concurrentQueues[i];
				concurrentQueues[i++] = null;
				var lane = concurrentQueues[i];
				concurrentQueues[i++] = null;
				if (null !== queue && null !== update) {
					var pending = queue.pending;
					null === pending ? update.next = update : (update.next = pending.next, pending.next = update);
					queue.pending = update;
				}
				0 !== lane && markUpdateLaneFromFiberToRoot(fiber, update, lane);
			}
		}
		function enqueueUpdate$1(fiber, queue, update, lane) {
			concurrentQueues[concurrentQueuesIndex++] = fiber;
			concurrentQueues[concurrentQueuesIndex++] = queue;
			concurrentQueues[concurrentQueuesIndex++] = update;
			concurrentQueues[concurrentQueuesIndex++] = lane;
			concurrentlyUpdatedLanes |= lane;
			fiber.lanes |= lane;
			fiber = fiber.alternate;
			null !== fiber && (fiber.lanes |= lane);
		}
		function enqueueConcurrentHookUpdate(fiber, queue, update, lane) {
			enqueueUpdate$1(fiber, queue, update, lane);
			return getRootForUpdatedFiber(fiber);
		}
		function enqueueConcurrentRenderForLane(fiber, lane) {
			enqueueUpdate$1(fiber, null, null, lane);
			return getRootForUpdatedFiber(fiber);
		}
		function markUpdateLaneFromFiberToRoot(sourceFiber, update, lane) {
			sourceFiber.lanes |= lane;
			var alternate = sourceFiber.alternate;
			null !== alternate && (alternate.lanes |= lane);
			for (var isHidden = !1, parent = sourceFiber.return; null !== parent;) parent.childLanes |= lane, alternate = parent.alternate, null !== alternate && (alternate.childLanes |= lane), 22 === parent.tag && (sourceFiber = parent.stateNode, null === sourceFiber || sourceFiber._visibility & 1 || (isHidden = !0)), sourceFiber = parent, parent = parent.return;
			return 3 === sourceFiber.tag ? (parent = sourceFiber.stateNode, isHidden && null !== update && (isHidden = 31 - clz32(lane), sourceFiber = parent.hiddenUpdates, alternate = sourceFiber[isHidden], null === alternate ? sourceFiber[isHidden] = [update] : alternate.push(update), update.lane = lane | 536870912), parent) : null;
		}
		function getRootForUpdatedFiber(sourceFiber) {
			if (50 < nestedUpdateCount) throw nestedUpdateCount = 0, rootWithNestedUpdates = null, Error(formatProdErrorMessage(185));
			for (var parent = sourceFiber.return; null !== parent;) sourceFiber = parent, parent = sourceFiber.return;
			return 3 === sourceFiber.tag ? sourceFiber.stateNode : null;
		}
		var emptyContextObject = {};
		function FiberNode(tag, pendingProps, key, mode) {
			this.tag = tag;
			this.key = key;
			this.sibling = this.child = this.return = this.stateNode = this.type = this.elementType = null;
			this.index = 0;
			this.refCleanup = this.ref = null;
			this.pendingProps = pendingProps;
			this.dependencies = this.memoizedState = this.updateQueue = this.memoizedProps = null;
			this.mode = mode;
			this.subtreeFlags = this.flags = 0;
			this.deletions = null;
			this.childLanes = this.lanes = 0;
			this.alternate = null;
		}
		function createFiberImplClass(tag, pendingProps, key, mode) {
			return new FiberNode(tag, pendingProps, key, mode);
		}
		function shouldConstruct(Component) {
			Component = Component.prototype;
			return !(!Component || !Component.isReactComponent);
		}
		function createWorkInProgress(current, pendingProps) {
			var workInProgress = current.alternate;
			null === workInProgress ? (workInProgress = createFiberImplClass(current.tag, pendingProps, current.key, current.mode), workInProgress.elementType = current.elementType, workInProgress.type = current.type, workInProgress.stateNode = current.stateNode, workInProgress.alternate = current, current.alternate = workInProgress) : (workInProgress.pendingProps = pendingProps, workInProgress.type = current.type, workInProgress.flags = 0, workInProgress.subtreeFlags = 0, workInProgress.deletions = null);
			workInProgress.flags = current.flags & 1206910976;
			workInProgress.childLanes = current.childLanes;
			workInProgress.lanes = current.lanes;
			workInProgress.child = current.child;
			workInProgress.memoizedProps = current.memoizedProps;
			workInProgress.memoizedState = current.memoizedState;
			workInProgress.updateQueue = current.updateQueue;
			pendingProps = current.dependencies;
			workInProgress.dependencies = null === pendingProps ? null : {
				lanes: pendingProps.lanes,
				firstContext: pendingProps.firstContext
			};
			workInProgress.sibling = current.sibling;
			workInProgress.index = current.index;
			workInProgress.ref = current.ref;
			workInProgress.refCleanup = current.refCleanup;
			return workInProgress;
		}
		function resetWorkInProgress(workInProgress, renderLanes) {
			workInProgress.flags &= 1206910978;
			var current = workInProgress.alternate;
			null === current ? (workInProgress.childLanes = 0, workInProgress.lanes = renderLanes, workInProgress.child = null, workInProgress.subtreeFlags = 0, workInProgress.memoizedProps = null, workInProgress.memoizedState = null, workInProgress.updateQueue = null, workInProgress.dependencies = null, workInProgress.stateNode = null) : (workInProgress.childLanes = current.childLanes, workInProgress.lanes = current.lanes, workInProgress.child = current.child, workInProgress.subtreeFlags = 0, workInProgress.deletions = null, workInProgress.memoizedProps = current.memoizedProps, workInProgress.memoizedState = current.memoizedState, workInProgress.updateQueue = current.updateQueue, workInProgress.type = current.type, renderLanes = current.dependencies, workInProgress.dependencies = null === renderLanes ? null : {
				lanes: renderLanes.lanes,
				firstContext: renderLanes.firstContext
			});
			return workInProgress;
		}
		function createFiberFromTypeAndProps(type, key, pendingProps, owner, mode, lanes) {
			var fiberTag = 0;
			owner = type;
			if ("function" === typeof owner) shouldConstruct(owner) && (fiberTag = 1);
			else if ("string" === typeof owner) fiberTag = isHostHoistableType(type, pendingProps, contextStackCursor.current) ? 26 : "html" === type || "head" === type || "body" === type ? 27 : 5;
			else a: switch (owner) {
				case REACT_ACTIVITY_TYPE: return type = createFiberImplClass(31, pendingProps, key, mode), type.elementType = REACT_ACTIVITY_TYPE, type.lanes = lanes, type;
				case REACT_FRAGMENT_TYPE: return createFiberFromFragment(pendingProps.children, mode, lanes, key);
				case REACT_STRICT_MODE_TYPE:
					fiberTag = 8;
					mode |= 24;
					break;
				case REACT_PROFILER_TYPE: return type = createFiberImplClass(12, pendingProps, key, mode | 2), type.elementType = REACT_PROFILER_TYPE, type.lanes = lanes, type;
				case REACT_SUSPENSE_TYPE: return type = createFiberImplClass(13, pendingProps, key, mode), type.elementType = REACT_SUSPENSE_TYPE, type.lanes = lanes, type;
				case REACT_SUSPENSE_LIST_TYPE: return type = createFiberImplClass(19, pendingProps, key, mode), type.elementType = REACT_SUSPENSE_LIST_TYPE, type.lanes = lanes, type;
				case REACT_LEGACY_HIDDEN_TYPE:
				case REACT_VIEW_TRANSITION_TYPE: return type = mode | 32, type = createFiberImplClass(30, pendingProps, key, type), type.elementType = REACT_VIEW_TRANSITION_TYPE, type.lanes = lanes, type.stateNode = {
					autoName: null,
					paired: null,
					clones: null,
					ref: null
				}, type;
				default:
					if ("object" === typeof owner && null !== owner) switch (owner.$$typeof) {
						case REACT_CONTEXT_TYPE:
							fiberTag = 10;
							break a;
						case REACT_CONSUMER_TYPE:
							fiberTag = 9;
							break a;
						case REACT_FORWARD_REF_TYPE:
							fiberTag = 11;
							break a;
						case REACT_MEMO_TYPE:
							fiberTag = 14;
							break a;
						case REACT_LAZY_TYPE:
							fiberTag = 16;
							owner = null;
							break a;
					}
					fiberTag = 29;
					pendingProps = Error(formatProdErrorMessage(130, null === type ? "null" : typeof type, ""));
					owner = null;
			}
			key = createFiberImplClass(fiberTag, pendingProps, key, mode);
			key.elementType = type;
			key.type = owner;
			key.lanes = lanes;
			return key;
		}
		function createFiberFromFragment(elements, mode, lanes, key) {
			elements = createFiberImplClass(7, elements, key, mode);
			elements.lanes = lanes;
			return elements;
		}
		function createFiberFromText(content, mode, lanes) {
			content = createFiberImplClass(6, content, null, mode);
			content.lanes = lanes;
			return content;
		}
		function createFiberFromDehydratedFragment(dehydratedNode) {
			var fiber = createFiberImplClass(18, null, null, 0);
			fiber.stateNode = dehydratedNode;
			return fiber;
		}
		function createFiberFromPortal(portal, mode, lanes) {
			mode = createFiberImplClass(4, null !== portal.children ? portal.children : [], portal.key, mode);
			mode.lanes = lanes;
			mode.stateNode = {
				containerInfo: portal.containerInfo,
				pendingChildren: null,
				implementation: portal.implementation
			};
			return mode;
		}
		var CapturedStacks = new WeakMap();
		function createCapturedValueAtFiber(value, source) {
			if ("object" === typeof value && null !== value) {
				var existing = CapturedStacks.get(value);
				if (void 0 !== existing) return existing;
				source = {
					value,
					source,
					stack: getStackByFiberInDevAndProd(source)
				};
				CapturedStacks.set(value, source);
				return source;
			}
			return {
				value,
				source,
				stack: getStackByFiberInDevAndProd(source)
			};
		}
		var forkStack = [];
		var forkStackIndex = 0;
		var treeForkProvider = null;
		var treeForkCount = 0;
		var idStack = [];
		var idStackIndex = 0;
		var treeContextProvider = null;
		var treeContextId = 1;
		var treeContextOverflow = "";
		function pushTreeFork(workInProgress, totalChildren) {
			forkStack[forkStackIndex++] = treeForkCount;
			forkStack[forkStackIndex++] = treeForkProvider;
			treeForkProvider = workInProgress;
			treeForkCount = totalChildren;
		}
		function pushTreeId(workInProgress, totalChildren, index) {
			idStack[idStackIndex++] = treeContextId;
			idStack[idStackIndex++] = treeContextOverflow;
			idStack[idStackIndex++] = treeContextProvider;
			treeContextProvider = workInProgress;
			var baseIdWithLeadingBit = treeContextId;
			workInProgress = treeContextOverflow;
			var baseLength = 32 - clz32(baseIdWithLeadingBit) - 1;
			baseIdWithLeadingBit &= ~(1 << baseLength);
			index += 1;
			var length = 32 - clz32(totalChildren) + baseLength;
			if (30 < length) {
				var numberOfOverflowBits = baseLength - baseLength % 5;
				length = (baseIdWithLeadingBit & (1 << numberOfOverflowBits) - 1).toString(32);
				baseIdWithLeadingBit >>= numberOfOverflowBits;
				baseLength -= numberOfOverflowBits;
				treeContextId = 1 << 32 - clz32(totalChildren) + baseLength | index << baseLength | baseIdWithLeadingBit;
				treeContextOverflow = length + workInProgress;
			} else treeContextId = 1 << length | index << baseLength | baseIdWithLeadingBit, treeContextOverflow = workInProgress;
		}
		function pushMaterializedTreeId(workInProgress) {
			null !== workInProgress.return && (pushTreeFork(workInProgress, 1), pushTreeId(workInProgress, 1, 0));
		}
		function popTreeContext(workInProgress) {
			for (; workInProgress === treeForkProvider;) treeForkProvider = forkStack[--forkStackIndex], forkStack[forkStackIndex] = null, treeForkCount = forkStack[--forkStackIndex], forkStack[forkStackIndex] = null;
			for (; workInProgress === treeContextProvider;) treeContextProvider = idStack[--idStackIndex], idStack[idStackIndex] = null, treeContextOverflow = idStack[--idStackIndex], idStack[idStackIndex] = null, treeContextId = idStack[--idStackIndex], idStack[idStackIndex] = null;
		}
		function restoreSuspendedTreeContext(workInProgress, suspendedContext) {
			idStack[idStackIndex++] = treeContextId;
			idStack[idStackIndex++] = treeContextOverflow;
			idStack[idStackIndex++] = treeContextProvider;
			treeContextId = suspendedContext.id;
			treeContextOverflow = suspendedContext.overflow;
			treeContextProvider = workInProgress;
		}
		var hydrationParentFiber = null;
		var nextHydratableInstance = null;
		var isHydrating = !1;
		var hydrationErrors = null;
		var rootOrSingletonContext = !1;
		var HydrationMismatchException = Error(formatProdErrorMessage(519));
		function throwOnHydrationMismatch(fiber) {
			queueHydrationError(createCapturedValueAtFiber(Error(formatProdErrorMessage(418, 1 < arguments.length && void 0 !== arguments[1] && arguments[1] ? "text" : "HTML", "")), fiber));
			throw HydrationMismatchException;
		}
		function prepareToHydrateHostInstance(fiber) {
			var instance = fiber.stateNode, type = fiber.type, props = fiber.memoizedProps;
			instance[internalInstanceKey] = fiber;
			instance[internalPropsKey] = props;
			switch (type) {
				case "dialog":
					listenToNonDelegatedEvent("cancel", instance);
					listenToNonDelegatedEvent("close", instance);
					break;
				case "iframe":
				case "object":
				case "embed":
					listenToNonDelegatedEvent("load", instance);
					break;
				case "video":
				case "audio":
					for (type = 0; type < mediaEventTypes.length; type++) listenToNonDelegatedEvent(mediaEventTypes[type], instance);
					break;
				case "source":
					listenToNonDelegatedEvent("error", instance);
					break;
				case "img":
				case "image":
				case "link":
					listenToNonDelegatedEvent("error", instance);
					listenToNonDelegatedEvent("load", instance);
					break;
				case "details":
					listenToNonDelegatedEvent("toggle", instance);
					break;
				case "input":
					listenToNonDelegatedEvent("invalid", instance);
					initInput(instance, props.value, props.defaultValue, props.checked, props.defaultChecked, props.type, props.name, !0);
					break;
				case "select":
					listenToNonDelegatedEvent("invalid", instance);
					break;
				case "textarea": listenToNonDelegatedEvent("invalid", instance), initTextarea(instance, props.value, props.defaultValue, props.children);
			}
			type = props.children;
			"string" !== typeof type && "number" !== typeof type && "bigint" !== typeof type || instance.textContent === "" + type || !0 === props.suppressHydrationWarning || checkForUnmatchedText(instance.textContent, type) ? (null != props.popover && (listenToNonDelegatedEvent("beforetoggle", instance), listenToNonDelegatedEvent("toggle", instance)), null != props.onScroll && listenToNonDelegatedEvent("scroll", instance), null != props.onScrollEnd && listenToNonDelegatedEvent("scrollend", instance), null != props.onClick && (instance.onclick = noop$1), instance = !0) : instance = !1;
			instance || throwOnHydrationMismatch(fiber, !0);
		}
		function popToNextHostParent(fiber) {
			for (hydrationParentFiber = fiber.return; hydrationParentFiber;) switch (hydrationParentFiber.tag) {
				case 5:
				case 31:
				case 13:
					rootOrSingletonContext = !1;
					return;
				case 27:
				case 3:
					rootOrSingletonContext = !0;
					return;
				default: hydrationParentFiber = hydrationParentFiber.return;
			}
		}
		function popHydrationState(fiber) {
			if (fiber !== hydrationParentFiber) return !1;
			if (!isHydrating) return popToNextHostParent(fiber), isHydrating = !0, !1;
			var tag = fiber.tag, JSCompiler_temp;
			if (JSCompiler_temp = 3 !== tag && 27 !== tag) {
				if (JSCompiler_temp = 5 === tag) JSCompiler_temp = fiber.type, JSCompiler_temp = !("form" !== JSCompiler_temp && "button" !== JSCompiler_temp) || shouldSetTextContent(fiber.type, fiber.memoizedProps);
				JSCompiler_temp = !JSCompiler_temp;
			}
			JSCompiler_temp && nextHydratableInstance && throwOnHydrationMismatch(fiber);
			popToNextHostParent(fiber);
			if (13 === tag) {
				fiber = fiber.memoizedState;
				fiber = null !== fiber ? fiber.dehydrated : null;
				if (!fiber) throw Error(formatProdErrorMessage(317));
				nextHydratableInstance = getNextHydratableInstanceAfterHydrationBoundary(fiber);
			} else if (31 === tag) {
				fiber = fiber.memoizedState;
				fiber = null !== fiber ? fiber.dehydrated : null;
				if (!fiber) throw Error(formatProdErrorMessage(317));
				nextHydratableInstance = getNextHydratableInstanceAfterHydrationBoundary(fiber);
			} else 27 === tag ? (tag = nextHydratableInstance, isSingletonScope(fiber.type) ? (fiber = previousHydratableOnEnteringScopedSingleton, previousHydratableOnEnteringScopedSingleton = null, nextHydratableInstance = fiber) : nextHydratableInstance = tag) : nextHydratableInstance = hydrationParentFiber ? getNextHydratable(fiber.stateNode.nextSibling) : null;
			return !0;
		}
		function resetHydrationState() {
			nextHydratableInstance = hydrationParentFiber = null;
			isHydrating = !1;
		}
		function upgradeHydrationErrorsToRecoverable() {
			var queuedErrors = hydrationErrors;
			null !== queuedErrors && (null === workInProgressRootRecoverableErrors ? workInProgressRootRecoverableErrors = queuedErrors : workInProgressRootRecoverableErrors.push.apply(workInProgressRootRecoverableErrors, queuedErrors), hydrationErrors = null);
			return queuedErrors;
		}
		function queueHydrationError(error) {
			null === hydrationErrors ? hydrationErrors = [error] : hydrationErrors.push(error);
		}
		var valueCursor = createCursor(null);
		var currentlyRenderingFiber$1 = null;
		var lastContextDependency = null;
		function pushProvider(providerFiber, context, nextValue) {
			push(valueCursor, context._currentValue);
			context._currentValue = nextValue;
		}
		function popProvider(context) {
			context._currentValue = valueCursor.current;
			pop(valueCursor);
		}
		function scheduleContextWorkOnParentPath(parent, renderLanes, propagationRoot) {
			for (; null !== parent;) {
				var alternate = parent.alternate;
				(parent.childLanes & renderLanes) !== renderLanes ? (parent.childLanes |= renderLanes, null !== alternate && (alternate.childLanes |= renderLanes)) : null !== alternate && (alternate.childLanes & renderLanes) !== renderLanes && (alternate.childLanes |= renderLanes);
				if (parent === propagationRoot) break;
				parent = parent.return;
			}
		}
		function propagateContextChanges(workInProgress, contexts, renderLanes, forcePropagateEntireTree) {
			var fiber = workInProgress.child;
			null !== fiber && (fiber.return = workInProgress);
			for (; null !== fiber;) {
				var list = fiber.dependencies;
				if (null !== list) {
					var nextFiber = fiber.child;
					list = list.firstContext;
					a: for (; null !== list;) {
						var dependency = list;
						list = fiber;
						for (var i = 0; i < contexts.length; i++) if (dependency.context === contexts[i]) {
							list.lanes |= renderLanes;
							dependency = list.alternate;
							null !== dependency && (dependency.lanes |= renderLanes);
							scheduleContextWorkOnParentPath(list.return, renderLanes, workInProgress);
							forcePropagateEntireTree || (nextFiber = null);
							break a;
						}
						list = dependency.next;
					}
				} else if (18 === fiber.tag) {
					nextFiber = fiber.return;
					if (null === nextFiber) throw Error(formatProdErrorMessage(341));
					nextFiber.lanes |= renderLanes;
					list = nextFiber.alternate;
					null !== list && (list.lanes |= renderLanes);
					scheduleContextWorkOnParentPath(nextFiber, renderLanes, workInProgress);
					nextFiber = null;
				} else 13 === fiber.tag && null !== fiber.memoizedState && null === fiber.memoizedState.dehydrated ? (fiber.lanes |= renderLanes, nextFiber = fiber.alternate, null !== nextFiber && (nextFiber.lanes |= renderLanes), scheduleContextWorkOnParentPath(fiber.return, renderLanes, workInProgress), nextFiber = fiber.child, nextFiber = null !== nextFiber ? nextFiber.sibling : null) : nextFiber = fiber.child;
				if (null !== nextFiber) nextFiber.return = fiber;
				else for (nextFiber = fiber; null !== nextFiber;) {
					if (nextFiber === workInProgress) {
						nextFiber = null;
						break;
					}
					fiber = nextFiber.sibling;
					if (null !== fiber) {
						fiber.return = nextFiber.return;
						nextFiber = fiber;
						break;
					}
					nextFiber = nextFiber.return;
				}
				fiber = nextFiber;
			}
		}
		function propagateParentContextChanges(current, workInProgress, renderLanes, forcePropagateEntireTree) {
			current = null;
			for (var parent = workInProgress, isInsidePropagationBailout = !1; null !== parent;) {
				if (!isInsidePropagationBailout) {
					if (0 !== (parent.flags & 524288)) isInsidePropagationBailout = !0;
					else if (0 !== (parent.flags & 262144)) break;
				}
				if (10 === parent.tag) {
					var currentParent = parent.alternate;
					if (null === currentParent) throw Error(formatProdErrorMessage(387));
					currentParent = currentParent.memoizedProps;
					if (null !== currentParent) {
						var context = parent.type;
						objectIs(parent.pendingProps.value, currentParent.value) || (null !== current ? current.push(context) : current = [context]);
					}
				} else if (parent === hostTransitionProviderCursor.current) {
					currentParent = parent.alternate;
					if (null === currentParent) throw Error(formatProdErrorMessage(387));
					currentParent.memoizedState.memoizedState !== parent.memoizedState.memoizedState && (null !== current ? current.push(HostTransitionContext) : current = [HostTransitionContext]);
				}
				parent = parent.return;
			}
			null !== current && propagateContextChanges(workInProgress, current, renderLanes, forcePropagateEntireTree);
			workInProgress.flags |= 262144;
			return null !== current;
		}
		function checkIfContextChanged(currentDependencies) {
			for (currentDependencies = currentDependencies.firstContext; null !== currentDependencies;) {
				if (!objectIs(currentDependencies.context._currentValue, currentDependencies.memoizedValue)) return !0;
				currentDependencies = currentDependencies.next;
			}
			return !1;
		}
		function prepareToReadContext(workInProgress) {
			currentlyRenderingFiber$1 = workInProgress;
			lastContextDependency = null;
			workInProgress = workInProgress.dependencies;
			null !== workInProgress && (workInProgress.firstContext = null);
		}
		function readContext(context) {
			return readContextForConsumer(currentlyRenderingFiber$1, context);
		}
		function readContextDuringReconciliation(consumer, context) {
			null === currentlyRenderingFiber$1 && prepareToReadContext(consumer);
			return readContextForConsumer(consumer, context);
		}
		function readContextForConsumer(consumer, context) {
			var value = context._currentValue;
			context = {
				context,
				memoizedValue: value,
				next: null
			};
			if (null === lastContextDependency) {
				if (null === consumer) throw Error(formatProdErrorMessage(308));
				lastContextDependency = context;
				consumer.dependencies = {
					lanes: 0,
					firstContext: context
				};
				consumer.flags |= 524288;
			} else lastContextDependency = lastContextDependency.next = context;
			return value;
		}
		var AbortControllerLocal = "undefined" !== typeof AbortController ? AbortController : function() {
			var listeners = [], signal = this.signal = {
				aborted: !1,
				addEventListener: function(type, listener) {
					listeners.push(listener);
				}
			};
			this.abort = function() {
				signal.aborted = !0;
				listeners.forEach(function(listener) {
					return listener();
				});
			};
		};
		var scheduleCallback$2 = Scheduler.unstable_scheduleCallback;
		var NormalPriority = Scheduler.unstable_NormalPriority;
		var CacheContext = {
			$$typeof: REACT_CONTEXT_TYPE,
			Consumer: null,
			Provider: null,
			_currentValue: null,
			_currentValue2: null,
			_threadCount: 0
		};
		function createCache() {
			return {
				controller: new AbortControllerLocal(),
				data: new Map(),
				refCount: 0
			};
		}
		function releaseCache(cache) {
			cache.refCount--;
			0 === cache.refCount && scheduleCallback$2(NormalPriority, function() {
				cache.controller.abort();
			});
		}
		function queueTransitionTypes(root, transitionTypes) {
			if (0 !== (root.pendingLanes & 4194048)) {
				var queued = root.transitionTypes;
				null === queued && (queued = root.transitionTypes = []);
				for (root = 0; root < transitionTypes.length; root++) {
					var transitionType = transitionTypes[root];
					-1 === queued.indexOf(transitionType) && queued.push(transitionType);
				}
			}
		}
		var entangledTransitionTypes = null;
		function claimQueuedTransitionTypes(root) {
			var claimed = root.transitionTypes;
			root.transitionTypes = null;
			return claimed;
		}
		var currentEntangledListeners = null;
		var currentEntangledPendingCount = 0;
		var currentEntangledLane = 0;
		var currentEntangledActionThenable = null;
		function entangleAsyncAction(transition, thenable) {
			if (null === currentEntangledListeners) {
				var entangledListeners = currentEntangledListeners = [];
				currentEntangledPendingCount = 0;
				currentEntangledLane = requestTransitionLane();
				currentEntangledActionThenable = {
					status: "pending",
					value: void 0,
					then: function(resolve) {
						entangledListeners.push(resolve);
					}
				};
			}
			currentEntangledPendingCount++;
			thenable.then(pingEngtangledActionScope, pingEngtangledActionScope);
			return thenable;
		}
		function pingEngtangledActionScope() {
			if (0 === --currentEntangledPendingCount && (entangledTransitionTypes = null, null !== currentEntangledListeners)) {
				null !== currentEntangledActionThenable && (currentEntangledActionThenable.status = "fulfilled");
				var listeners = currentEntangledListeners;
				currentEntangledListeners = null;
				currentEntangledLane = 0;
				currentEntangledActionThenable = null;
				for (var i = 0; i < listeners.length; i++) (0, listeners[i])();
			}
		}
		function chainThenableValue(thenable, result) {
			var listeners = [], thenableWithOverride = {
				status: "pending",
				value: null,
				reason: null,
				then: function(resolve) {
					listeners.push(resolve);
				}
			};
			thenable.then(function() {
				thenableWithOverride.status = "fulfilled";
				thenableWithOverride.value = result;
				for (var i = 0; i < listeners.length; i++) (0, listeners[i])(result);
			}, function(error) {
				thenableWithOverride.status = "rejected";
				thenableWithOverride.reason = error;
				for (error = 0; error < listeners.length; error++) (0, listeners[error])(void 0);
			});
			return thenableWithOverride;
		}
		var prevOnStartTransitionFinish = ReactSharedInternals.S;
		ReactSharedInternals.S = function(transition, returnValue) {
			globalMostRecentTransitionTime = now();
			"object" === typeof returnValue && null !== returnValue && "function" === typeof returnValue.then && entangleAsyncAction(transition, returnValue);
			if (null !== entangledTransitionTypes) for (var root$28 = firstScheduledRoot; null !== root$28;) queueTransitionTypes(root$28, entangledTransitionTypes), root$28 = root$28.next;
			root$28 = transition.types;
			if (null !== root$28) {
				for (var root$29 = firstScheduledRoot; null !== root$29;) queueTransitionTypes(root$29, root$28), root$29 = root$29.next;
				if (0 !== currentEntangledLane) {
					root$29 = entangledTransitionTypes;
					null === root$29 && (root$29 = entangledTransitionTypes = []);
					for (var i = 0; i < root$28.length; i++) {
						var transitionType = root$28[i];
						-1 === root$29.indexOf(transitionType) && root$29.push(transitionType);
					}
				}
			}
			null !== prevOnStartTransitionFinish && prevOnStartTransitionFinish(transition, returnValue);
		};
		var resumedCache = createCursor(null);
		function peekCacheFromPool() {
			var cacheResumedFromPreviousRender = resumedCache.current;
			return null !== cacheResumedFromPreviousRender ? cacheResumedFromPreviousRender : workInProgressRoot.pooledCache;
		}
		function pushTransition(offscreenWorkInProgress, prevCachePool) {
			null === prevCachePool ? push(resumedCache, resumedCache.current) : push(resumedCache, prevCachePool.pool);
		}
		function getSuspendedCache() {
			var cacheFromPool = peekCacheFromPool();
			return null === cacheFromPool ? null : {
				parent: CacheContext._currentValue,
				pool: cacheFromPool
			};
		}
		var SuspenseException = Error(formatProdErrorMessage(460));
		var SuspenseyCommitException = Error(formatProdErrorMessage(474));
		var SuspenseActionException = Error(formatProdErrorMessage(542));
		var noopSuspenseyCommitThenable = { then: function() {} };
		function isThenableResolved(thenable) {
			thenable = thenable.status;
			return "fulfilled" === thenable || "rejected" === thenable;
		}
		function trackUsedThenable(thenableState, thenable, index) {
			index = thenableState[index];
			void 0 === index ? thenableState.push(thenable) : index !== thenable && (thenable.then(noop$1, noop$1), thenable = index);
			switch (thenable.status) {
				case "fulfilled": return thenable.value;
				case "rejected":
					thenableState = thenable.reason;
					checkIfUseWrappedInAsyncCatch(thenableState);
					if (void 0 === thenableState && !("reason" in thenable)) throw Error(formatProdErrorMessage(600));
					throw thenableState;
				default:
					if ("string" === typeof thenable.status) thenable.then(noop$1, noop$1);
					else {
						thenableState = workInProgressRoot;
						if (null !== thenableState && 100 < thenableState.shellSuspendCounter) throw Error(formatProdErrorMessage(482));
						thenableState = thenable;
						thenableState.status = "pending";
						thenableState.then(function(fulfilledValue) {
							if ("pending" === thenable.status) {
								var fulfilledThenable = thenable;
								fulfilledThenable.status = "fulfilled";
								fulfilledThenable.value = fulfilledValue;
							}
						}, function(error) {
							if ("pending" === thenable.status) {
								var rejectedThenable = thenable;
								rejectedThenable.status = "rejected";
								rejectedThenable.reason = error;
							}
						});
					}
					switch (thenable.status) {
						case "fulfilled": return thenable.value;
						case "rejected": throw thenableState = thenable.reason, checkIfUseWrappedInAsyncCatch(thenableState), thenableState;
					}
					suspendedThenable = thenable;
					throw SuspenseException;
			}
		}
		function resolveLazy(lazyType) {
			try {
				var init = lazyType._init;
				return init(lazyType._payload);
			} catch (x) {
				if (null !== x && "object" === typeof x && "function" === typeof x.then) throw suspendedThenable = x, SuspenseException;
				throw x;
			}
		}
		var suspendedThenable = null;
		function getSuspendedThenable() {
			if (null === suspendedThenable) throw Error(formatProdErrorMessage(459));
			var thenable = suspendedThenable;
			suspendedThenable = null;
			return thenable;
		}
		function checkIfUseWrappedInAsyncCatch(rejectedReason) {
			if (rejectedReason === SuspenseException || rejectedReason === SuspenseActionException) throw Error(formatProdErrorMessage(483));
		}
		var thenableState$1 = null;
		var thenableIndexCounter$1 = 0;
		function unwrapThenable(thenable) {
			var index = thenableIndexCounter$1;
			thenableIndexCounter$1 += 1;
			null === thenableState$1 && (thenableState$1 = []);
			return trackUsedThenable(thenableState$1, thenable, index);
		}
		function coerceRef(workInProgress, element) {
			element = element.props.ref;
			workInProgress.ref = void 0 !== element ? element : null;
		}
		function throwOnInvalidObjectTypeImpl(returnFiber, newChild) {
			if (newChild.$$typeof === REACT_LEGACY_ELEMENT_TYPE) throw Error(formatProdErrorMessage(525));
			returnFiber = Object.prototype.toString.call(newChild);
			throw Error(formatProdErrorMessage(31, "[object Object]" === returnFiber ? "object with keys {" + Object.keys(newChild).join(", ") + "}" : returnFiber));
		}
		function createChildReconciler(shouldTrackSideEffects) {
			function deleteChild(returnFiber, childToDelete) {
				if (shouldTrackSideEffects) {
					var deletions = returnFiber.deletions;
					null === deletions ? (returnFiber.deletions = [childToDelete], returnFiber.flags |= 16) : deletions.push(childToDelete);
				}
			}
			function deleteRemainingChildren(returnFiber, currentFirstChild) {
				if (!shouldTrackSideEffects) return null;
				for (; null !== currentFirstChild;) deleteChild(returnFiber, currentFirstChild), currentFirstChild = currentFirstChild.sibling;
				return null;
			}
			function mapRemainingChildren(currentFirstChild) {
				for (var existingChildren = new Map(); null !== currentFirstChild;) null === currentFirstChild.key ? existingChildren.set(currentFirstChild.index, currentFirstChild) : existingChildren.set(currentFirstChild.key, currentFirstChild), currentFirstChild = currentFirstChild.sibling;
				return existingChildren;
			}
			function useFiber(fiber, pendingProps) {
				fiber = createWorkInProgress(fiber, pendingProps);
				fiber.index = 0;
				fiber.sibling = null;
				return fiber;
			}
			function placeChild(newFiber, lastPlacedIndex, newIndex) {
				newFiber.index = newIndex;
				if (!shouldTrackSideEffects) return newFiber.flags |= 1048576, lastPlacedIndex;
				newIndex = newFiber.alternate;
				if (null !== newIndex) return newIndex = newIndex.index, newIndex < lastPlacedIndex ? (newFiber.flags |= 2, lastPlacedIndex) : newIndex;
				newFiber.flags |= 134217730;
				return lastPlacedIndex;
			}
			function placeSingleChild(newFiber) {
				shouldTrackSideEffects && null === newFiber.alternate && (newFiber.flags |= 134217730);
				return newFiber;
			}
			function updateTextNode(returnFiber, current, textContent, lanes) {
				if (null === current || 6 !== current.tag) return current = createFiberFromText(textContent, returnFiber.mode, lanes), current.return = returnFiber, current;
				current = useFiber(current, textContent);
				current.return = returnFiber;
				return current;
			}
			function updateElement(returnFiber, current, element, lanes) {
				var elementType = element.type;
				if (elementType === REACT_FRAGMENT_TYPE) return returnFiber = updateFragment(returnFiber, current, element.props.children, lanes, element.key), coerceRef(returnFiber, element), returnFiber;
				if (null !== current && (current.elementType === elementType || "object" === typeof elementType && null !== elementType && elementType.$$typeof === REACT_LAZY_TYPE && resolveLazy(elementType) === current.type)) return current = useFiber(current, element.props), coerceRef(current, element), current.return = returnFiber, current;
				current = createFiberFromTypeAndProps(element.type, element.key, element.props, null, returnFiber.mode, lanes);
				coerceRef(current, element);
				current.return = returnFiber;
				return current;
			}
			function updatePortal(returnFiber, current, portal, lanes) {
				if (null === current || 4 !== current.tag || current.stateNode.containerInfo !== portal.containerInfo || current.stateNode.implementation !== portal.implementation) return current = createFiberFromPortal(portal, returnFiber.mode, lanes), current.return = returnFiber, current;
				current = useFiber(current, portal.children || []);
				current.return = returnFiber;
				return current;
			}
			function updateFragment(returnFiber, current, fragment, lanes, key) {
				if (null === current || 7 !== current.tag) return current = createFiberFromFragment(fragment, returnFiber.mode, lanes, key), current.return = returnFiber, current;
				current = useFiber(current, fragment);
				current.return = returnFiber;
				return current;
			}
			function createChild(returnFiber, newChild, lanes) {
				if ("string" === typeof newChild && "" !== newChild || "number" === typeof newChild || "bigint" === typeof newChild) return newChild = createFiberFromText("" + newChild, returnFiber.mode, lanes), newChild.return = returnFiber, newChild;
				if ("object" === typeof newChild && null !== newChild) {
					switch (newChild.$$typeof) {
						case REACT_ELEMENT_TYPE: return lanes = createFiberFromTypeAndProps(newChild.type, newChild.key, newChild.props, null, returnFiber.mode, lanes), coerceRef(lanes, newChild), lanes.return = returnFiber, lanes;
						case REACT_PORTAL_TYPE: return newChild = createFiberFromPortal(newChild, returnFiber.mode, lanes), newChild.return = returnFiber, newChild;
						case REACT_LAZY_TYPE: return newChild = resolveLazy(newChild), createChild(returnFiber, newChild, lanes);
					}
					if (isArrayImpl(newChild) || getIteratorFn(newChild)) return newChild = createFiberFromFragment(newChild, returnFiber.mode, lanes, null), newChild.return = returnFiber, newChild;
					if ("function" === typeof newChild.then) return createChild(returnFiber, unwrapThenable(newChild), lanes);
					if (newChild.$$typeof === REACT_CONTEXT_TYPE) return createChild(returnFiber, readContextDuringReconciliation(returnFiber, newChild), lanes);
					throwOnInvalidObjectTypeImpl(returnFiber, newChild);
				}
				return null;
			}
			function updateSlot(returnFiber, oldFiber, newChild, lanes) {
				var key = null !== oldFiber ? oldFiber.key : null;
				if ("string" === typeof newChild && "" !== newChild || "number" === typeof newChild || "bigint" === typeof newChild) return null !== key ? null : updateTextNode(returnFiber, oldFiber, "" + newChild, lanes);
				if ("object" === typeof newChild && null !== newChild) {
					switch (newChild.$$typeof) {
						case REACT_ELEMENT_TYPE: return newChild.key === key ? updateElement(returnFiber, oldFiber, newChild, lanes) : null;
						case REACT_PORTAL_TYPE: return newChild.key === key ? updatePortal(returnFiber, oldFiber, newChild, lanes) : null;
						case REACT_LAZY_TYPE: return newChild = resolveLazy(newChild), updateSlot(returnFiber, oldFiber, newChild, lanes);
					}
					if (isArrayImpl(newChild) || getIteratorFn(newChild)) return null !== key ? null : updateFragment(returnFiber, oldFiber, newChild, lanes, null);
					if ("function" === typeof newChild.then) return updateSlot(returnFiber, oldFiber, unwrapThenable(newChild), lanes);
					if (newChild.$$typeof === REACT_CONTEXT_TYPE) return updateSlot(returnFiber, oldFiber, readContextDuringReconciliation(returnFiber, newChild), lanes);
					throwOnInvalidObjectTypeImpl(returnFiber, newChild);
				}
				return null;
			}
			function updateFromMap(existingChildren, returnFiber, newIdx, newChild, lanes) {
				if ("string" === typeof newChild && "" !== newChild || "number" === typeof newChild || "bigint" === typeof newChild) return existingChildren = existingChildren.get(newIdx) || null, updateTextNode(returnFiber, existingChildren, "" + newChild, lanes);
				if ("object" === typeof newChild && null !== newChild) {
					switch (newChild.$$typeof) {
						case REACT_ELEMENT_TYPE: return existingChildren = existingChildren.get(null === newChild.key ? newIdx : newChild.key) || null, updateElement(returnFiber, existingChildren, newChild, lanes);
						case REACT_PORTAL_TYPE: return existingChildren = existingChildren.get(null === newChild.key ? newIdx : newChild.key) || null, updatePortal(returnFiber, existingChildren, newChild, lanes);
						case REACT_LAZY_TYPE: return newChild = resolveLazy(newChild), updateFromMap(existingChildren, returnFiber, newIdx, newChild, lanes);
					}
					if (isArrayImpl(newChild) || getIteratorFn(newChild)) return existingChildren = existingChildren.get(newIdx) || null, updateFragment(returnFiber, existingChildren, newChild, lanes, null);
					if ("function" === typeof newChild.then) return updateFromMap(existingChildren, returnFiber, newIdx, unwrapThenable(newChild), lanes);
					if (newChild.$$typeof === REACT_CONTEXT_TYPE) return updateFromMap(existingChildren, returnFiber, newIdx, readContextDuringReconciliation(returnFiber, newChild), lanes);
					throwOnInvalidObjectTypeImpl(returnFiber, newChild);
				}
				return null;
			}
			function reconcileChildrenArray(returnFiber, currentFirstChild, newChildren, lanes) {
				for (var resultingFirstChild = null, previousNewFiber = null, oldFiber = currentFirstChild, newIdx = currentFirstChild = 0, nextOldFiber = null; null !== oldFiber && newIdx < newChildren.length; newIdx++) {
					oldFiber.index > newIdx ? (nextOldFiber = oldFiber, oldFiber = null) : nextOldFiber = oldFiber.sibling;
					var newFiber = updateSlot(returnFiber, oldFiber, newChildren[newIdx], lanes);
					if (null === newFiber) {
						null === oldFiber && (oldFiber = nextOldFiber);
						break;
					}
					shouldTrackSideEffects && oldFiber && null === newFiber.alternate && deleteChild(returnFiber, oldFiber);
					currentFirstChild = placeChild(newFiber, currentFirstChild, newIdx);
					null === previousNewFiber ? resultingFirstChild = newFiber : previousNewFiber.sibling = newFiber;
					previousNewFiber = newFiber;
					oldFiber = nextOldFiber;
				}
				if (newIdx === newChildren.length) return deleteRemainingChildren(returnFiber, oldFiber), isHydrating && pushTreeFork(returnFiber, newIdx), resultingFirstChild;
				if (null === oldFiber) {
					for (; newIdx < newChildren.length; newIdx++) oldFiber = createChild(returnFiber, newChildren[newIdx], lanes), null !== oldFiber && (currentFirstChild = placeChild(oldFiber, currentFirstChild, newIdx), null === previousNewFiber ? resultingFirstChild = oldFiber : previousNewFiber.sibling = oldFiber, previousNewFiber = oldFiber);
					isHydrating && pushTreeFork(returnFiber, newIdx);
					return resultingFirstChild;
				}
				for (oldFiber = mapRemainingChildren(oldFiber); newIdx < newChildren.length; newIdx++) nextOldFiber = updateFromMap(oldFiber, returnFiber, newIdx, newChildren[newIdx], lanes), null !== nextOldFiber && (shouldTrackSideEffects && (newFiber = nextOldFiber.alternate, null !== newFiber && oldFiber.delete(null === newFiber.key ? newIdx : newFiber.key)), currentFirstChild = placeChild(nextOldFiber, currentFirstChild, newIdx), null === previousNewFiber ? resultingFirstChild = nextOldFiber : previousNewFiber.sibling = nextOldFiber, previousNewFiber = nextOldFiber);
				shouldTrackSideEffects && oldFiber.forEach(function(child) {
					return deleteChild(returnFiber, child);
				});
				isHydrating && pushTreeFork(returnFiber, newIdx);
				return resultingFirstChild;
			}
			function reconcileChildrenIterator(returnFiber, currentFirstChild, newChildren, lanes) {
				if (null == newChildren) throw Error(formatProdErrorMessage(151));
				for (var resultingFirstChild = null, previousNewFiber = null, oldFiber = currentFirstChild, newIdx = currentFirstChild = 0, nextOldFiber = null, step = newChildren.next(); null !== oldFiber && !step.done; newIdx++, step = newChildren.next()) {
					oldFiber.index > newIdx ? (nextOldFiber = oldFiber, oldFiber = null) : nextOldFiber = oldFiber.sibling;
					var newFiber = updateSlot(returnFiber, oldFiber, step.value, lanes);
					if (null === newFiber) {
						null === oldFiber && (oldFiber = nextOldFiber);
						break;
					}
					shouldTrackSideEffects && oldFiber && null === newFiber.alternate && deleteChild(returnFiber, oldFiber);
					currentFirstChild = placeChild(newFiber, currentFirstChild, newIdx);
					null === previousNewFiber ? resultingFirstChild = newFiber : previousNewFiber.sibling = newFiber;
					previousNewFiber = newFiber;
					oldFiber = nextOldFiber;
				}
				if (step.done) return deleteRemainingChildren(returnFiber, oldFiber), isHydrating && pushTreeFork(returnFiber, newIdx), resultingFirstChild;
				if (null === oldFiber) {
					for (; !step.done; newIdx++, step = newChildren.next()) step = createChild(returnFiber, step.value, lanes), null !== step && (currentFirstChild = placeChild(step, currentFirstChild, newIdx), null === previousNewFiber ? resultingFirstChild = step : previousNewFiber.sibling = step, previousNewFiber = step);
					isHydrating && pushTreeFork(returnFiber, newIdx);
					return resultingFirstChild;
				}
				for (oldFiber = mapRemainingChildren(oldFiber); !step.done; newIdx++, step = newChildren.next()) step = updateFromMap(oldFiber, returnFiber, newIdx, step.value, lanes), null !== step && (shouldTrackSideEffects && (nextOldFiber = step.alternate, null !== nextOldFiber && oldFiber.delete(null === nextOldFiber.key ? newIdx : nextOldFiber.key)), currentFirstChild = placeChild(step, currentFirstChild, newIdx), null === previousNewFiber ? resultingFirstChild = step : previousNewFiber.sibling = step, previousNewFiber = step);
				shouldTrackSideEffects && oldFiber.forEach(function(child) {
					return deleteChild(returnFiber, child);
				});
				isHydrating && pushTreeFork(returnFiber, newIdx);
				return resultingFirstChild;
			}
			function reconcileChildFibersImpl(returnFiber, currentFirstChild, newChild, lanes) {
				"object" === typeof newChild && null !== newChild && newChild.type === REACT_FRAGMENT_TYPE && null === newChild.key && void 0 === newChild.props.ref && (newChild = newChild.props.children);
				if ("object" === typeof newChild && null !== newChild) {
					switch (newChild.$$typeof) {
						case REACT_ELEMENT_TYPE:
							a: {
								for (var key = newChild.key; null !== currentFirstChild;) {
									if (currentFirstChild.key === key) {
										key = newChild.type;
										if (key === REACT_FRAGMENT_TYPE) {
											if (7 === currentFirstChild.tag) {
												deleteRemainingChildren(returnFiber, currentFirstChild.sibling);
												lanes = useFiber(currentFirstChild, newChild.props.children);
												coerceRef(lanes, newChild);
												lanes.return = returnFiber;
												returnFiber = lanes;
												break a;
											}
										} else if (currentFirstChild.elementType === key || "object" === typeof key && null !== key && key.$$typeof === REACT_LAZY_TYPE && resolveLazy(key) === currentFirstChild.type) {
											deleteRemainingChildren(returnFiber, currentFirstChild.sibling);
											lanes = useFiber(currentFirstChild, newChild.props);
											coerceRef(lanes, newChild);
											lanes.return = returnFiber;
											returnFiber = lanes;
											break a;
										}
										deleteRemainingChildren(returnFiber, currentFirstChild);
										break;
									} else deleteChild(returnFiber, currentFirstChild);
									currentFirstChild = currentFirstChild.sibling;
								}
								newChild.type === REACT_FRAGMENT_TYPE ? (lanes = createFiberFromFragment(newChild.props.children, returnFiber.mode, lanes, newChild.key), coerceRef(lanes, newChild), lanes.return = returnFiber, returnFiber = lanes) : (lanes = createFiberFromTypeAndProps(newChild.type, newChild.key, newChild.props, null, returnFiber.mode, lanes), coerceRef(lanes, newChild), lanes.return = returnFiber, returnFiber = lanes);
							}
							return placeSingleChild(returnFiber);
						case REACT_PORTAL_TYPE:
							a: {
								for (key = newChild.key; null !== currentFirstChild;) {
									if (currentFirstChild.key === key) if (4 === currentFirstChild.tag && currentFirstChild.stateNode.containerInfo === newChild.containerInfo && currentFirstChild.stateNode.implementation === newChild.implementation) {
										deleteRemainingChildren(returnFiber, currentFirstChild.sibling);
										lanes = useFiber(currentFirstChild, newChild.children || []);
										lanes.return = returnFiber;
										returnFiber = lanes;
										break a;
									} else {
										deleteRemainingChildren(returnFiber, currentFirstChild);
										break;
									}
									else deleteChild(returnFiber, currentFirstChild);
									currentFirstChild = currentFirstChild.sibling;
								}
								lanes = createFiberFromPortal(newChild, returnFiber.mode, lanes);
								lanes.return = returnFiber;
								returnFiber = lanes;
							}
							return placeSingleChild(returnFiber);
						case REACT_LAZY_TYPE: return newChild = resolveLazy(newChild), reconcileChildFibersImpl(returnFiber, currentFirstChild, newChild, lanes);
					}
					if (isArrayImpl(newChild)) return reconcileChildrenArray(returnFiber, currentFirstChild, newChild, lanes);
					if (getIteratorFn(newChild)) {
						key = getIteratorFn(newChild);
						if ("function" !== typeof key) throw Error(formatProdErrorMessage(150));
						newChild = key.call(newChild);
						return reconcileChildrenIterator(returnFiber, currentFirstChild, newChild, lanes);
					}
					if ("function" === typeof newChild.then) return reconcileChildFibersImpl(returnFiber, currentFirstChild, unwrapThenable(newChild), lanes);
					if (newChild.$$typeof === REACT_CONTEXT_TYPE) return reconcileChildFibersImpl(returnFiber, currentFirstChild, readContextDuringReconciliation(returnFiber, newChild), lanes);
					throwOnInvalidObjectTypeImpl(returnFiber, newChild);
				}
				return "string" === typeof newChild && "" !== newChild || "number" === typeof newChild || "bigint" === typeof newChild ? (newChild = "" + newChild, null !== currentFirstChild && 6 === currentFirstChild.tag ? (deleteRemainingChildren(returnFiber, currentFirstChild.sibling), lanes = useFiber(currentFirstChild, newChild), lanes.return = returnFiber, returnFiber = lanes) : (deleteRemainingChildren(returnFiber, currentFirstChild), lanes = createFiberFromText(newChild, returnFiber.mode, lanes), lanes.return = returnFiber, returnFiber = lanes), placeSingleChild(returnFiber)) : deleteRemainingChildren(returnFiber, currentFirstChild);
			}
			return function(returnFiber, currentFirstChild, newChild, lanes) {
				try {
					thenableIndexCounter$1 = 0;
					var firstChildFiber = reconcileChildFibersImpl(returnFiber, currentFirstChild, newChild, lanes);
					thenableState$1 = null;
					return firstChildFiber;
				} catch (x) {
					if (x === SuspenseException || x === SuspenseActionException) throw x;
					var fiber = createFiberImplClass(29, x, null, returnFiber.mode);
					fiber.lanes = lanes;
					fiber.return = returnFiber;
					return fiber;
				}
			};
		}
		var reconcileChildFibers = createChildReconciler(!0);
		var mountChildFibers = createChildReconciler(!1);
		var hasForceUpdate = !1;
		function initializeUpdateQueue(fiber) {
			fiber.updateQueue = {
				baseState: fiber.memoizedState,
				firstBaseUpdate: null,
				lastBaseUpdate: null,
				shared: {
					pending: null,
					lanes: 0,
					hiddenCallbacks: null
				},
				callbacks: null
			};
		}
		function cloneUpdateQueue(current, workInProgress) {
			current = current.updateQueue;
			workInProgress.updateQueue === current && (workInProgress.updateQueue = {
				baseState: current.baseState,
				firstBaseUpdate: current.firstBaseUpdate,
				lastBaseUpdate: current.lastBaseUpdate,
				shared: current.shared,
				callbacks: null
			});
		}
		function createUpdate(lane) {
			return {
				lane,
				tag: 0,
				payload: null,
				callback: null,
				next: null
			};
		}
		function enqueueUpdate(fiber, update, lane) {
			var updateQueue = fiber.updateQueue;
			if (null === updateQueue) return null;
			updateQueue = updateQueue.shared;
			if (0 !== (executionContext & 2)) {
				var pending = updateQueue.pending;
				null === pending ? update.next = update : (update.next = pending.next, pending.next = update);
				updateQueue.pending = update;
				update = getRootForUpdatedFiber(fiber);
				markUpdateLaneFromFiberToRoot(fiber, null, lane);
				return update;
			}
			enqueueUpdate$1(fiber, updateQueue, update, lane);
			return getRootForUpdatedFiber(fiber);
		}
		function entangleTransitions(root, fiber, lane) {
			fiber = fiber.updateQueue;
			if (null !== fiber && (fiber = fiber.shared, 0 !== (lane & 4194048))) {
				var queueLanes = fiber.lanes;
				queueLanes &= root.pendingLanes;
				lane |= queueLanes;
				fiber.lanes = lane;
				markRootEntangled(root, lane);
			}
		}
		function enqueueCapturedUpdate(workInProgress, capturedUpdate) {
			var queue = workInProgress.updateQueue, current = workInProgress.alternate;
			if (null !== current && (current = current.updateQueue, queue === current)) {
				var newFirst = null, newLast = null;
				queue = queue.firstBaseUpdate;
				if (null !== queue) {
					do {
						var clone = {
							lane: queue.lane,
							tag: queue.tag,
							payload: queue.payload,
							callback: null,
							next: null
						};
						null === newLast ? newFirst = newLast = clone : newLast = newLast.next = clone;
						queue = queue.next;
					} while (null !== queue);
					null === newLast ? newFirst = newLast = capturedUpdate : newLast = newLast.next = capturedUpdate;
				} else newFirst = newLast = capturedUpdate;
				queue = {
					baseState: current.baseState,
					firstBaseUpdate: newFirst,
					lastBaseUpdate: newLast,
					shared: current.shared,
					callbacks: current.callbacks
				};
				workInProgress.updateQueue = queue;
				return;
			}
			workInProgress = queue.lastBaseUpdate;
			null === workInProgress ? queue.firstBaseUpdate = capturedUpdate : workInProgress.next = capturedUpdate;
			queue.lastBaseUpdate = capturedUpdate;
		}
		var didReadFromEntangledAsyncAction = !1;
		function suspendIfUpdateReadFromEntangledAsyncAction() {
			if (didReadFromEntangledAsyncAction) {
				var entangledActionThenable = currentEntangledActionThenable;
				if (null !== entangledActionThenable) throw entangledActionThenable;
			}
		}
		function processUpdateQueue(workInProgress$jscomp$0, props, instance$jscomp$0, renderLanes) {
			didReadFromEntangledAsyncAction = !1;
			var queue = workInProgress$jscomp$0.updateQueue;
			hasForceUpdate = !1;
			var firstBaseUpdate = queue.firstBaseUpdate, lastBaseUpdate = queue.lastBaseUpdate, pendingQueue = queue.shared.pending;
			if (null !== pendingQueue) {
				queue.shared.pending = null;
				var lastPendingUpdate = pendingQueue, firstPendingUpdate = lastPendingUpdate.next;
				lastPendingUpdate.next = null;
				null === lastBaseUpdate ? firstBaseUpdate = firstPendingUpdate : lastBaseUpdate.next = firstPendingUpdate;
				lastBaseUpdate = lastPendingUpdate;
				var current = workInProgress$jscomp$0.alternate;
				null !== current && (current = current.updateQueue, pendingQueue = current.lastBaseUpdate, pendingQueue !== lastBaseUpdate && (null === pendingQueue ? current.firstBaseUpdate = firstPendingUpdate : pendingQueue.next = firstPendingUpdate, current.lastBaseUpdate = lastPendingUpdate));
			}
			if (null !== firstBaseUpdate) {
				var newState = queue.baseState;
				lastBaseUpdate = 0;
				current = firstPendingUpdate = lastPendingUpdate = null;
				pendingQueue = firstBaseUpdate;
				do {
					var updateLane = pendingQueue.lane & -536870913, isHiddenUpdate = updateLane !== pendingQueue.lane;
					if (isHiddenUpdate ? (workInProgressRootRenderLanes & updateLane) === updateLane : (renderLanes & updateLane) === updateLane) {
						0 !== updateLane && updateLane === currentEntangledLane && (didReadFromEntangledAsyncAction = !0);
						null !== current && (current = current.next = {
							lane: 0,
							tag: pendingQueue.tag,
							payload: pendingQueue.payload,
							callback: null,
							next: null
						});
						a: {
							var workInProgress = workInProgress$jscomp$0, update = pendingQueue;
							updateLane = props;
							var instance = instance$jscomp$0;
							switch (update.tag) {
								case 1:
									workInProgress = update.payload;
									if ("function" === typeof workInProgress) {
										newState = workInProgress.call(instance, newState, updateLane);
										break a;
									}
									newState = workInProgress;
									break a;
								case 3: workInProgress.flags = workInProgress.flags & -65537 | 128;
								case 0:
									workInProgress = update.payload;
									updateLane = "function" === typeof workInProgress ? workInProgress.call(instance, newState, updateLane) : workInProgress;
									if (null === updateLane || void 0 === updateLane) break a;
									newState = assign({}, newState, updateLane);
									break a;
								case 2: hasForceUpdate = !0;
							}
						}
						updateLane = pendingQueue.callback;
						null !== updateLane && (workInProgress$jscomp$0.flags |= 64, isHiddenUpdate && (workInProgress$jscomp$0.flags |= 8192), isHiddenUpdate = queue.callbacks, null === isHiddenUpdate ? queue.callbacks = [updateLane] : isHiddenUpdate.push(updateLane));
					} else isHiddenUpdate = {
						lane: updateLane,
						tag: pendingQueue.tag,
						payload: pendingQueue.payload,
						callback: pendingQueue.callback,
						next: null
					}, null === current ? (firstPendingUpdate = current = isHiddenUpdate, lastPendingUpdate = newState) : current = current.next = isHiddenUpdate, lastBaseUpdate |= updateLane;
					pendingQueue = pendingQueue.next;
					if (null === pendingQueue) if (pendingQueue = queue.shared.pending, null === pendingQueue) break;
					else isHiddenUpdate = pendingQueue, pendingQueue = isHiddenUpdate.next, isHiddenUpdate.next = null, queue.lastBaseUpdate = isHiddenUpdate, queue.shared.pending = null;
				} while (1);
				null === current && (lastPendingUpdate = newState);
				queue.baseState = lastPendingUpdate;
				queue.firstBaseUpdate = firstPendingUpdate;
				queue.lastBaseUpdate = current;
				null === firstBaseUpdate && (queue.shared.lanes = 0);
				workInProgressRootSkippedLanes |= lastBaseUpdate;
				workInProgress$jscomp$0.lanes = lastBaseUpdate;
				workInProgress$jscomp$0.memoizedState = newState;
			}
		}
		function callCallback(callback, context) {
			if ("function" !== typeof callback) throw Error(formatProdErrorMessage(191, callback));
			callback.call(context);
		}
		function commitCallbacks(updateQueue, context) {
			var callbacks = updateQueue.callbacks;
			if (null !== callbacks) for (updateQueue.callbacks = null, updateQueue = 0; updateQueue < callbacks.length; updateQueue++) callCallback(callbacks[updateQueue], context);
		}
		var currentTreeHiddenStackCursor = createCursor(null);
		var prevEntangledRenderLanesCursor = createCursor(0);
		function pushHiddenContext(fiber, context) {
			fiber = entangledRenderLanes;
			push(prevEntangledRenderLanesCursor, fiber);
			push(currentTreeHiddenStackCursor, context);
			entangledRenderLanes = fiber | context.baseLanes;
		}
		function reuseHiddenContextOnStack() {
			push(prevEntangledRenderLanesCursor, entangledRenderLanes);
			push(currentTreeHiddenStackCursor, currentTreeHiddenStackCursor.current);
		}
		function popHiddenContext() {
			entangledRenderLanes = prevEntangledRenderLanesCursor.current;
			pop(currentTreeHiddenStackCursor);
			pop(prevEntangledRenderLanesCursor);
		}
		var suspenseHandlerStackCursor = createCursor(null);
		var shellBoundary = null;
		function pushPrimaryTreeSuspenseHandler(handler) {
			var current = handler.alternate;
			push(suspenseStackCursor, suspenseStackCursor.current & 1);
			push(suspenseHandlerStackCursor, handler);
			null === shellBoundary && (null === current || null !== currentTreeHiddenStackCursor.current ? shellBoundary = handler : null !== current.memoizedState && (shellBoundary = handler));
		}
		function pushDehydratedActivitySuspenseHandler(fiber) {
			push(suspenseStackCursor, suspenseStackCursor.current);
			push(suspenseHandlerStackCursor, fiber);
			null === shellBoundary && (shellBoundary = fiber);
		}
		function pushOffscreenSuspenseHandler(fiber) {
			22 === fiber.tag ? (push(suspenseStackCursor, suspenseStackCursor.current), push(suspenseHandlerStackCursor, fiber), null === shellBoundary && (shellBoundary = fiber)) : reuseSuspenseHandlerOnStack();
		}
		function reuseSuspenseHandlerOnStack() {
			push(suspenseStackCursor, suspenseStackCursor.current);
			push(suspenseHandlerStackCursor, suspenseHandlerStackCursor.current);
		}
		function popSuspenseHandler(fiber) {
			pop(suspenseHandlerStackCursor);
			shellBoundary === fiber && (shellBoundary = null);
			pop(suspenseStackCursor);
		}
		var suspenseStackCursor = createCursor(0);
		function pushSuspenseListContext(fiber, newContext) {
			push(suspenseHandlerStackCursor, suspenseHandlerStackCursor.current);
			push(suspenseStackCursor, newContext);
		}
		function popSuspenseListContext(fiber) {
			pop(suspenseStackCursor);
			pop(suspenseHandlerStackCursor);
			shellBoundary === fiber && (shellBoundary = null);
		}
		function findFirstSuspended(row) {
			for (var node = row; null !== node;) {
				if (13 === node.tag) {
					var state = node.memoizedState;
					if (null !== state && (state = state.dehydrated, null === state || isSuspenseInstancePending(state) || isSuspenseInstanceFallback(state))) return node;
				} else if (19 === node.tag && "independent" !== node.memoizedProps.revealOrder) {
					if (0 !== (node.flags & 128)) return node;
				} else if (null !== node.child) {
					node.child.return = node;
					node = node.child;
					continue;
				}
				if (node === row) break;
				for (; null === node.sibling;) {
					if (null === node.return || node.return === row) return null;
					node = node.return;
				}
				node.sibling.return = node.return;
				node = node.sibling;
			}
			return null;
		}
		var renderLanes = 0;
		var currentlyRenderingFiber = null;
		var currentHook = null;
		var workInProgressHook = null;
		var didScheduleRenderPhaseUpdate = !1;
		var didScheduleRenderPhaseUpdateDuringThisPass = !1;
		var shouldDoubleInvokeUserFnsInHooksDEV = !1;
		var localIdCounter = 0;
		var thenableIndexCounter = 0;
		var thenableState = null;
		var globalClientIdCounter = 0;
		function throwInvalidHookError() {
			throw Error(formatProdErrorMessage(321));
		}
		function areHookInputsEqual(nextDeps, prevDeps) {
			if (null === prevDeps) return !1;
			for (var i = 0; i < prevDeps.length && i < nextDeps.length; i++) if (!objectIs(nextDeps[i], prevDeps[i])) return !1;
			return !0;
		}
		function renderWithHooks(current, workInProgress, Component, props, secondArg, nextRenderLanes) {
			renderLanes = nextRenderLanes;
			currentlyRenderingFiber = workInProgress;
			workInProgress.memoizedState = null;
			workInProgress.updateQueue = null;
			workInProgress.lanes = 0;
			ReactSharedInternals.H = null === current || null === current.memoizedState ? HooksDispatcherOnMount : HooksDispatcherOnUpdate;
			shouldDoubleInvokeUserFnsInHooksDEV = !1;
			nextRenderLanes = Component(props, secondArg);
			shouldDoubleInvokeUserFnsInHooksDEV = !1;
			didScheduleRenderPhaseUpdateDuringThisPass && (nextRenderLanes = renderWithHooksAgain(workInProgress, Component, props, secondArg));
			finishRenderingHooks(current);
			return nextRenderLanes;
		}
		function finishRenderingHooks(current) {
			ReactSharedInternals.H = ContextOnlyDispatcher;
			var didRenderTooFewHooks = null !== currentHook && null !== currentHook.next;
			renderLanes = 0;
			workInProgressHook = currentHook = currentlyRenderingFiber = null;
			didScheduleRenderPhaseUpdate = !1;
			thenableIndexCounter = 0;
			thenableState = null;
			if (didRenderTooFewHooks) throw Error(formatProdErrorMessage(300));
			null === current || didReceiveUpdate || (current = current.dependencies, null !== current && checkIfContextChanged(current) && (didReceiveUpdate = !0));
		}
		function renderWithHooksAgain(workInProgress, Component, props, secondArg) {
			currentlyRenderingFiber = workInProgress;
			var numberOfReRenders = 0;
			do {
				didScheduleRenderPhaseUpdateDuringThisPass && (thenableState = null);
				thenableIndexCounter = 0;
				didScheduleRenderPhaseUpdateDuringThisPass = !1;
				if (25 <= numberOfReRenders) throw Error(formatProdErrorMessage(301));
				numberOfReRenders += 1;
				workInProgressHook = currentHook = null;
				if (null != workInProgress.updateQueue) {
					var children = workInProgress.updateQueue;
					children.lastEffect = null;
					children.events = null;
					children.stores = null;
					null != children.memoCache && (children.memoCache.index = 0);
				}
				ReactSharedInternals.H = HooksDispatcherOnRerender;
				children = Component(props, secondArg);
			} while (didScheduleRenderPhaseUpdateDuringThisPass);
			return children;
		}
		function TransitionAwareHostComponent() {
			var dispatcher = ReactSharedInternals.H, maybeThenable = dispatcher.useState()[0];
			maybeThenable = "function" === typeof maybeThenable.then ? useThenable(maybeThenable) : maybeThenable;
			dispatcher = dispatcher.useState()[0];
			(null !== currentHook ? currentHook.memoizedState : null) !== dispatcher && (currentlyRenderingFiber.flags |= 1024);
			return maybeThenable;
		}
		function checkDidRenderIdHook() {
			var didRenderIdHook = 0 !== localIdCounter;
			localIdCounter = 0;
			return didRenderIdHook;
		}
		function bailoutHooks(current, workInProgress, lanes) {
			workInProgress.updateQueue = current.updateQueue;
			workInProgress.flags &= -2053;
			current.lanes &= ~lanes;
		}
		function resetHooksOnUnwind(workInProgress) {
			if (didScheduleRenderPhaseUpdate) {
				for (workInProgress = workInProgress.memoizedState; null !== workInProgress;) {
					var queue = workInProgress.queue;
					null !== queue && (queue.pending = null);
					workInProgress = workInProgress.next;
				}
				didScheduleRenderPhaseUpdate = !1;
			}
			renderLanes = 0;
			workInProgressHook = currentHook = currentlyRenderingFiber = null;
			didScheduleRenderPhaseUpdateDuringThisPass = !1;
			thenableIndexCounter = localIdCounter = 0;
			thenableState = null;
		}
		function mountWorkInProgressHook() {
			var hook = {
				memoizedState: null,
				baseState: null,
				baseQueue: null,
				queue: null,
				next: null
			};
			null === workInProgressHook ? currentlyRenderingFiber.memoizedState = workInProgressHook = hook : workInProgressHook = workInProgressHook.next = hook;
			return workInProgressHook;
		}
		function updateWorkInProgressHook() {
			if (null === currentHook) {
				var nextCurrentHook = currentlyRenderingFiber.alternate;
				nextCurrentHook = null !== nextCurrentHook ? nextCurrentHook.memoizedState : null;
			} else nextCurrentHook = currentHook.next;
			var nextWorkInProgressHook = null === workInProgressHook ? currentlyRenderingFiber.memoizedState : workInProgressHook.next;
			if (null !== nextWorkInProgressHook) workInProgressHook = nextWorkInProgressHook, currentHook = nextCurrentHook;
			else {
				if (null === nextCurrentHook) {
					if (null === currentlyRenderingFiber.alternate) throw Error(formatProdErrorMessage(467));
					throw Error(formatProdErrorMessage(310));
				}
				currentHook = nextCurrentHook;
				nextCurrentHook = {
					memoizedState: currentHook.memoizedState,
					baseState: currentHook.baseState,
					baseQueue: currentHook.baseQueue,
					queue: currentHook.queue,
					next: null
				};
				null === workInProgressHook ? currentlyRenderingFiber.memoizedState = workInProgressHook = nextCurrentHook : workInProgressHook = workInProgressHook.next = nextCurrentHook;
			}
			return workInProgressHook;
		}
		function createFunctionComponentUpdateQueue() {
			return {
				lastEffect: null,
				events: null,
				stores: null,
				memoCache: null
			};
		}
		function useThenable(thenable) {
			var index = thenableIndexCounter;
			thenableIndexCounter += 1;
			null === thenableState && (thenableState = []);
			thenable = trackUsedThenable(thenableState, thenable, index);
			index = currentlyRenderingFiber;
			null === (null === workInProgressHook ? index.memoizedState : workInProgressHook.next) && (index = index.alternate, ReactSharedInternals.H = null === index || null === index.memoizedState ? HooksDispatcherOnMount : HooksDispatcherOnUpdate);
			return thenable;
		}
		function use(usable) {
			if (null !== usable && "object" === typeof usable) {
				if ("function" === typeof usable.then) return useThenable(usable);
				if (usable.$$typeof === REACT_RECOVERABLE_TYPE) return;
				if (usable.$$typeof === REACT_CONTEXT_TYPE) return readContext(usable);
			}
			throw Error(formatProdErrorMessage(438, String(usable)));
		}
		function useMemoCache(size) {
			var memoCache = null, updateQueue = currentlyRenderingFiber.updateQueue;
			null !== updateQueue && (memoCache = updateQueue.memoCache);
			if (null == memoCache) {
				var current = currentlyRenderingFiber.alternate;
				null !== current && (current = current.updateQueue, null !== current && (current = current.memoCache, null != current && (memoCache = {
					data: current.data.map(function(array) {
						return array.slice();
					}),
					index: 0
				})));
			}
			memoCache ??= {
				data: [],
				index: 0
			};
			null === updateQueue && (updateQueue = createFunctionComponentUpdateQueue(), currentlyRenderingFiber.updateQueue = updateQueue);
			updateQueue.memoCache = memoCache;
			updateQueue = memoCache.data[memoCache.index];
			if (void 0 === updateQueue) for (updateQueue = memoCache.data[memoCache.index] = Array(size), current = 0; current < size; current++) updateQueue[current] = REACT_MEMO_CACHE_SENTINEL;
			memoCache.index++;
			return updateQueue;
		}
		function basicStateReducer(state, action) {
			return "function" === typeof action ? action(state) : action;
		}
		function updateReducer(reducer) {
			return updateReducerImpl(updateWorkInProgressHook(), currentHook, reducer);
		}
		function updateReducerImpl(hook, current, reducer) {
			var queue = hook.queue;
			if (null === queue) throw Error(formatProdErrorMessage(311));
			queue.lastRenderedReducer = reducer;
			var baseQueue = hook.baseQueue, pendingQueue = queue.pending;
			if (null !== pendingQueue) {
				if (null !== baseQueue) {
					var baseFirst = baseQueue.next;
					baseQueue.next = pendingQueue.next;
					pendingQueue.next = baseFirst;
				}
				current.baseQueue = baseQueue = pendingQueue;
				queue.pending = null;
			}
			pendingQueue = hook.baseState;
			if (null === baseQueue) hook.memoizedState = pendingQueue;
			else {
				current = baseQueue.next;
				var newBaseQueueFirst = baseFirst = null, newBaseQueueLast = null, update = current, didReadFromEntangledAsyncAction$64 = !1;
				do {
					var updateLane = update.lane & -536870913;
					if (updateLane !== update.lane ? (workInProgressRootRenderLanes & updateLane) === updateLane : (renderLanes & updateLane) === updateLane) {
						var revertLane = update.revertLane;
						if (0 === revertLane) null !== newBaseQueueLast && (newBaseQueueLast = newBaseQueueLast.next = {
							lane: 0,
							revertLane: 0,
							gesture: null,
							action: update.action,
							hasEagerState: update.hasEagerState,
							eagerState: update.eagerState,
							next: null
						}), updateLane === currentEntangledLane && (didReadFromEntangledAsyncAction$64 = !0);
						else if ((renderLanes & revertLane) === revertLane) {
							update = update.next;
							revertLane === currentEntangledLane && (didReadFromEntangledAsyncAction$64 = !0);
							continue;
						} else updateLane = {
							lane: 0,
							revertLane: update.revertLane,
							gesture: null,
							action: update.action,
							hasEagerState: update.hasEagerState,
							eagerState: update.eagerState,
							next: null
						}, null === newBaseQueueLast ? (newBaseQueueFirst = newBaseQueueLast = updateLane, baseFirst = pendingQueue) : newBaseQueueLast = newBaseQueueLast.next = updateLane, currentlyRenderingFiber.lanes |= revertLane, workInProgressRootSkippedLanes |= revertLane;
						updateLane = update.action;
						shouldDoubleInvokeUserFnsInHooksDEV && reducer(pendingQueue, updateLane);
						pendingQueue = update.hasEagerState ? update.eagerState : reducer(pendingQueue, updateLane);
					} else revertLane = {
						lane: updateLane,
						revertLane: update.revertLane,
						gesture: update.gesture,
						action: update.action,
						hasEagerState: update.hasEagerState,
						eagerState: update.eagerState,
						next: null
					}, null === newBaseQueueLast ? (newBaseQueueFirst = newBaseQueueLast = revertLane, baseFirst = pendingQueue) : newBaseQueueLast = newBaseQueueLast.next = revertLane, currentlyRenderingFiber.lanes |= updateLane, workInProgressRootSkippedLanes |= updateLane;
					update = update.next;
				} while (null !== update && update !== current);
				null === newBaseQueueLast ? baseFirst = pendingQueue : newBaseQueueLast.next = newBaseQueueFirst;
				if (!objectIs(pendingQueue, hook.memoizedState) && (didReceiveUpdate = !0, didReadFromEntangledAsyncAction$64 && (reducer = currentEntangledActionThenable, null !== reducer))) throw reducer;
				hook.memoizedState = pendingQueue;
				hook.baseState = baseFirst;
				hook.baseQueue = newBaseQueueLast;
				queue.lastRenderedState = pendingQueue;
			}
			null === baseQueue && (queue.lanes = 0);
			return [hook.memoizedState, queue.dispatch];
		}
		function rerenderReducer(reducer) {
			var hook = updateWorkInProgressHook(), queue = hook.queue;
			if (null === queue) throw Error(formatProdErrorMessage(311));
			queue.lastRenderedReducer = reducer;
			var dispatch = queue.dispatch, lastRenderPhaseUpdate = queue.pending, newState = hook.memoizedState;
			if (null !== lastRenderPhaseUpdate) {
				queue.pending = null;
				var update = lastRenderPhaseUpdate = lastRenderPhaseUpdate.next;
				do
					newState = reducer(newState, update.action), update = update.next;
				while (update !== lastRenderPhaseUpdate);
				objectIs(newState, hook.memoizedState) || (didReceiveUpdate = !0);
				hook.memoizedState = newState;
				null === hook.baseQueue && (hook.baseState = newState);
				queue.lastRenderedState = newState;
			}
			return [newState, dispatch];
		}
		function updateSyncExternalStore(subscribe, getSnapshot, getServerSnapshot) {
			var fiber = currentlyRenderingFiber, hook = updateWorkInProgressHook(), isHydrating$jscomp$0 = isHydrating;
			if (isHydrating$jscomp$0) {
				if (void 0 === getServerSnapshot) throw Error(formatProdErrorMessage(407));
				getServerSnapshot = getServerSnapshot();
			} else getServerSnapshot = getSnapshot();
			var snapshotChanged = !objectIs((currentHook || hook).memoizedState, getServerSnapshot);
			snapshotChanged && (hook.memoizedState = getServerSnapshot, didReceiveUpdate = !0);
			hook = hook.queue;
			updateEffect(subscribeToStore.bind(null, fiber, hook, subscribe), [subscribe]);
			subscribe = hook.getSnapshot !== getSnapshot || snapshotChanged || null !== workInProgressHook && 0 !== (workInProgressHook.memoizedState.tag & 1);
			pushSimpleEffect(subscribe ? 9 : 8, { destroy: void 0 }, updateStoreInstance.bind(null, fiber, hook, getServerSnapshot, getSnapshot), null);
			if (subscribe) {
				fiber.flags |= 2048;
				if (null === workInProgressRoot) throw Error(formatProdErrorMessage(349));
				isHydrating$jscomp$0 || 0 !== (renderLanes & 127) || pushStoreConsistencyCheck(fiber, getSnapshot, getServerSnapshot);
			}
			return getServerSnapshot;
		}
		function pushStoreConsistencyCheck(fiber, getSnapshot, renderedSnapshot) {
			fiber.flags |= 16384;
			fiber = {
				getSnapshot,
				value: renderedSnapshot
			};
			getSnapshot = currentlyRenderingFiber.updateQueue;
			null === getSnapshot ? (getSnapshot = createFunctionComponentUpdateQueue(), currentlyRenderingFiber.updateQueue = getSnapshot, getSnapshot.stores = [fiber]) : (renderedSnapshot = getSnapshot.stores, null === renderedSnapshot ? getSnapshot.stores = [fiber] : renderedSnapshot.push(fiber));
		}
		function updateStoreInstance(fiber, inst, nextSnapshot, getSnapshot) {
			inst.value = nextSnapshot;
			inst.getSnapshot = getSnapshot;
			checkIfSnapshotChanged(inst) && forceStoreRerender(fiber);
		}
		function subscribeToStore(fiber, inst, subscribe) {
			return subscribe(function() {
				checkIfSnapshotChanged(inst) && forceStoreRerender(fiber);
			});
		}
		function checkIfSnapshotChanged(inst) {
			var latestGetSnapshot = inst.getSnapshot;
			inst = inst.value;
			try {
				var nextValue = latestGetSnapshot();
				return !objectIs(inst, nextValue);
			} catch (error) {
				return !0;
			}
		}
		function forceStoreRerender(fiber) {
			var root = enqueueConcurrentRenderForLane(fiber, 2);
			null !== root && scheduleUpdateOnFiber(root, fiber, 2);
		}
		function mountStateImpl(initialState) {
			var hook = mountWorkInProgressHook();
			if ("function" === typeof initialState) {
				var initialStateInitializer = initialState;
				initialState = initialStateInitializer();
				if (shouldDoubleInvokeUserFnsInHooksDEV) {
					setIsStrictModeForDevtools(!0);
					try {
						initialStateInitializer();
					} finally {
						setIsStrictModeForDevtools(!1);
					}
				}
			}
			hook.memoizedState = hook.baseState = initialState;
			hook.queue = {
				pending: null,
				lanes: 0,
				dispatch: null,
				lastRenderedReducer: basicStateReducer,
				lastRenderedState: initialState
			};
			return hook;
		}
		function updateOptimisticImpl(hook, current, passthrough, reducer) {
			hook.baseState = passthrough;
			return updateReducerImpl(hook, currentHook, "function" === typeof reducer ? reducer : basicStateReducer);
		}
		function dispatchActionState(fiber, actionQueue, setPendingState, setState, payload) {
			if (isRenderPhaseUpdate(fiber)) throw Error(formatProdErrorMessage(485));
			fiber = actionQueue.action;
			if (null !== fiber) {
				var actionNode = {
					payload,
					action: fiber,
					next: null,
					isTransition: !0,
					status: "pending",
					value: null,
					reason: null,
					listeners: [],
					then: function(listener) {
						actionNode.listeners.push(listener);
					}
				};
				null !== ReactSharedInternals.T ? setPendingState(!0) : actionNode.isTransition = !1;
				setState(actionNode);
				setPendingState = actionQueue.pending;
				null === setPendingState ? (actionNode.next = actionQueue.pending = actionNode, runActionStateAction(actionQueue, actionNode)) : (actionNode.next = setPendingState.next, actionQueue.pending = setPendingState.next = actionNode);
			}
		}
		function runActionStateAction(actionQueue, node) {
			var action = node.action, payload = node.payload, prevState = actionQueue.state;
			if (node.isTransition) {
				var prevTransition = ReactSharedInternals.T, currentTransition = {};
				currentTransition.types = null !== prevTransition ? prevTransition.types : null;
				ReactSharedInternals.T = currentTransition;
				try {
					var returnValue = action(prevState, payload), onStartTransitionFinish = ReactSharedInternals.S;
					null !== onStartTransitionFinish && onStartTransitionFinish(currentTransition, returnValue);
					handleActionReturnValue(actionQueue, node, returnValue);
				} catch (error) {
					onActionError(actionQueue, node, error);
				} finally {
					null !== prevTransition && null !== currentTransition.types && (prevTransition.types = currentTransition.types), ReactSharedInternals.T = prevTransition;
				}
			} else try {
				prevTransition = action(prevState, payload), handleActionReturnValue(actionQueue, node, prevTransition);
			} catch (error$70) {
				onActionError(actionQueue, node, error$70);
			}
		}
		function handleActionReturnValue(actionQueue, node, returnValue) {
			null !== returnValue && "object" === typeof returnValue && "function" === typeof returnValue.then ? returnValue.then(function(nextState) {
				onActionSuccess(actionQueue, node, nextState);
			}, function(error) {
				return onActionError(actionQueue, node, error);
			}) : onActionSuccess(actionQueue, node, returnValue);
		}
		function onActionSuccess(actionQueue, actionNode, nextState) {
			actionNode.status = "fulfilled";
			actionNode.value = nextState;
			notifyActionListeners(actionNode);
			actionQueue.state = nextState;
			actionNode = actionQueue.pending;
			null !== actionNode && (nextState = actionNode.next, nextState === actionNode ? actionQueue.pending = null : (nextState = nextState.next, actionNode.next = nextState, runActionStateAction(actionQueue, nextState)));
		}
		function onActionError(actionQueue, actionNode, error) {
			var last = actionQueue.pending;
			actionQueue.pending = null;
			if (null !== last) {
				last = last.next;
				do
					actionNode.status = "rejected", actionNode.reason = error, notifyActionListeners(actionNode), actionNode = actionNode.next;
				while (actionNode !== last);
			}
			actionQueue.action = null;
		}
		function notifyActionListeners(actionNode) {
			actionNode = actionNode.listeners;
			for (var i = 0; i < actionNode.length; i++) (0, actionNode[i])();
		}
		function actionStateReducer(oldState, newState) {
			return newState;
		}
		function mountActionState(action, initialStateProp) {
			if (isHydrating) {
				var ssrFormState = workInProgressRoot.formState;
				if (null !== ssrFormState) {
					a: {
						var JSCompiler_inline_result = currentlyRenderingFiber;
						if (isHydrating) {
							if (nextHydratableInstance) {
								b: {
									var JSCompiler_inline_result$jscomp$0 = nextHydratableInstance;
									for (var inRootOrSingleton = rootOrSingletonContext; 8 !== JSCompiler_inline_result$jscomp$0.nodeType;) {
										if (!inRootOrSingleton) {
											JSCompiler_inline_result$jscomp$0 = null;
											break b;
										}
										JSCompiler_inline_result$jscomp$0 = getNextHydratable(JSCompiler_inline_result$jscomp$0.nextSibling);
										if (null === JSCompiler_inline_result$jscomp$0) {
											JSCompiler_inline_result$jscomp$0 = null;
											break b;
										}
									}
									inRootOrSingleton = JSCompiler_inline_result$jscomp$0.data;
									JSCompiler_inline_result$jscomp$0 = "F!" === inRootOrSingleton || "F" === inRootOrSingleton ? JSCompiler_inline_result$jscomp$0 : null;
								}
								if (JSCompiler_inline_result$jscomp$0) {
									nextHydratableInstance = getNextHydratable(JSCompiler_inline_result$jscomp$0.nextSibling);
									JSCompiler_inline_result = "F!" === JSCompiler_inline_result$jscomp$0.data;
									break a;
								}
							}
							throwOnHydrationMismatch(JSCompiler_inline_result);
						}
						JSCompiler_inline_result = !1;
					}
					JSCompiler_inline_result && (initialStateProp = ssrFormState[0]);
				}
			}
			ssrFormState = mountWorkInProgressHook();
			ssrFormState.memoizedState = ssrFormState.baseState = initialStateProp;
			JSCompiler_inline_result = {
				pending: null,
				lanes: 0,
				dispatch: null,
				lastRenderedReducer: actionStateReducer,
				lastRenderedState: initialStateProp
			};
			ssrFormState.queue = JSCompiler_inline_result;
			ssrFormState = dispatchSetState.bind(null, currentlyRenderingFiber, JSCompiler_inline_result);
			JSCompiler_inline_result.dispatch = ssrFormState;
			JSCompiler_inline_result = mountStateImpl(!1);
			inRootOrSingleton = dispatchOptimisticSetState.bind(null, currentlyRenderingFiber, !1, JSCompiler_inline_result.queue);
			JSCompiler_inline_result = mountWorkInProgressHook();
			JSCompiler_inline_result$jscomp$0 = {
				state: initialStateProp,
				dispatch: null,
				action,
				pending: null
			};
			JSCompiler_inline_result.queue = JSCompiler_inline_result$jscomp$0;
			ssrFormState = dispatchActionState.bind(null, currentlyRenderingFiber, JSCompiler_inline_result$jscomp$0, inRootOrSingleton, ssrFormState);
			JSCompiler_inline_result$jscomp$0.dispatch = ssrFormState;
			JSCompiler_inline_result.memoizedState = action;
			return [
				initialStateProp,
				ssrFormState,
				!1
			];
		}
		function updateActionState(action) {
			return updateActionStateImpl(updateWorkInProgressHook(), currentHook, action);
		}
		function updateActionStateImpl(stateHook, currentStateHook, action) {
			currentStateHook = updateReducerImpl(stateHook, currentStateHook, actionStateReducer)[0];
			stateHook = updateReducer(basicStateReducer)[0];
			if ("object" === typeof currentStateHook && null !== currentStateHook && "function" === typeof currentStateHook.then) try {
				var state = useThenable(currentStateHook);
			} catch (x) {
				if (x === SuspenseException) throw SuspenseActionException;
				throw x;
			}
			else state = currentStateHook;
			currentStateHook = updateWorkInProgressHook();
			var actionQueue = currentStateHook.queue, dispatch = actionQueue.dispatch;
			action !== currentStateHook.memoizedState && (currentlyRenderingFiber.flags |= 2048, pushSimpleEffect(9, { destroy: void 0 }, actionStateActionEffect.bind(null, actionQueue, action), null));
			return [
				state,
				dispatch,
				stateHook
			];
		}
		function actionStateActionEffect(actionQueue, action) {
			actionQueue.action = action;
		}
		function rerenderActionState(action) {
			var stateHook = updateWorkInProgressHook(), currentStateHook = currentHook;
			if (null !== currentStateHook) return updateActionStateImpl(stateHook, currentStateHook, action);
			updateWorkInProgressHook();
			stateHook = stateHook.memoizedState;
			currentStateHook = updateWorkInProgressHook();
			var dispatch = currentStateHook.queue.dispatch;
			currentStateHook.memoizedState = action;
			return [
				stateHook,
				dispatch,
				!1
			];
		}
		function pushSimpleEffect(tag, inst, create, deps) {
			tag = {
				tag,
				create,
				deps,
				inst,
				next: null
			};
			inst = currentlyRenderingFiber.updateQueue;
			null === inst && (inst = createFunctionComponentUpdateQueue(), currentlyRenderingFiber.updateQueue = inst);
			create = inst.lastEffect;
			null === create ? inst.lastEffect = tag.next = tag : (deps = create.next, create.next = tag, tag.next = deps, inst.lastEffect = tag);
			return tag;
		}
		function updateRef() {
			return updateWorkInProgressHook().memoizedState;
		}
		function mountEffectImpl(fiberFlags, hookFlags, create, deps) {
			var hook = mountWorkInProgressHook();
			currentlyRenderingFiber.flags |= fiberFlags;
			hook.memoizedState = pushSimpleEffect(1 | hookFlags, { destroy: void 0 }, create, void 0 === deps ? null : deps);
		}
		function updateEffectImpl(fiberFlags, hookFlags, create, deps) {
			var hook = updateWorkInProgressHook();
			deps = void 0 === deps ? null : deps;
			var inst = hook.memoizedState.inst;
			null !== currentHook && null !== deps && areHookInputsEqual(deps, currentHook.memoizedState.deps) ? hook.memoizedState = pushSimpleEffect(hookFlags, inst, create, deps) : (currentlyRenderingFiber.flags |= fiberFlags, hook.memoizedState = pushSimpleEffect(1 | hookFlags, inst, create, deps));
		}
		function mountEffect(create, deps) {
			mountEffectImpl(8390656, 8, create, deps);
		}
		function updateEffect(create, deps) {
			updateEffectImpl(2048, 8, create, deps);
		}
		function useEffectEventImpl(payload) {
			currentlyRenderingFiber.flags |= 4;
			var componentUpdateQueue = currentlyRenderingFiber.updateQueue;
			if (null === componentUpdateQueue) componentUpdateQueue = createFunctionComponentUpdateQueue(), currentlyRenderingFiber.updateQueue = componentUpdateQueue, componentUpdateQueue.events = [payload];
			else {
				var events = componentUpdateQueue.events;
				null === events ? componentUpdateQueue.events = [payload] : events.push(payload);
			}
		}
		function updateEvent(callback) {
			var ref = updateWorkInProgressHook().memoizedState;
			useEffectEventImpl({
				ref,
				nextImpl: callback
			});
			return function() {
				if (0 !== (executionContext & 2)) throw Error(formatProdErrorMessage(440));
				return ref.impl.apply(void 0, arguments);
			};
		}
		function updateInsertionEffect(create, deps) {
			return updateEffectImpl(4, 2, create, deps);
		}
		function updateLayoutEffect(create, deps) {
			return updateEffectImpl(4, 4, create, deps);
		}
		function imperativeHandleEffect(create, ref) {
			if ("function" === typeof ref) {
				create = create();
				var refCleanup = ref(create);
				return function() {
					"function" === typeof refCleanup ? refCleanup() : ref(null);
				};
			}
			if (null !== ref && void 0 !== ref) return create = create(), ref.current = create, function() {
				ref.current = null;
			};
		}
		function updateImperativeHandle(ref, create, deps) {
			deps = null !== deps && void 0 !== deps ? deps.concat([ref]) : null;
			updateEffectImpl(4, 4, imperativeHandleEffect.bind(null, create, ref), deps);
		}
		function mountDebugValue() {}
		function updateCallback(callback, deps) {
			var hook = updateWorkInProgressHook();
			deps = void 0 === deps ? null : deps;
			var prevState = hook.memoizedState;
			if (null !== deps && areHookInputsEqual(deps, prevState[1])) return prevState[0];
			hook.memoizedState = [callback, deps];
			return callback;
		}
		function updateMemo(nextCreate, deps) {
			var hook = updateWorkInProgressHook();
			deps = void 0 === deps ? null : deps;
			var prevState = hook.memoizedState;
			if (null !== deps && areHookInputsEqual(deps, prevState[1])) return prevState[0];
			prevState = nextCreate();
			if (shouldDoubleInvokeUserFnsInHooksDEV) {
				setIsStrictModeForDevtools(!0);
				try {
					nextCreate();
				} finally {
					setIsStrictModeForDevtools(!1);
				}
			}
			hook.memoizedState = [prevState, deps];
			return prevState;
		}
		function mountDeferredValueImpl(hook, value, initialValue) {
			if (void 0 === initialValue || 0 !== (renderLanes & 1073741824) && 0 === (workInProgressRootRenderLanes & 261930)) return hook.memoizedState = value;
			hook.memoizedState = initialValue;
			hook = requestDeferredLane();
			currentlyRenderingFiber.lanes |= hook;
			workInProgressRootSkippedLanes |= hook;
			return initialValue;
		}
		function updateDeferredValueImpl(hook, prevValue, value, initialValue) {
			if (objectIs(value, prevValue)) return value;
			if (null !== currentTreeHiddenStackCursor.current) return hook = mountDeferredValueImpl(hook, value, initialValue), objectIs(hook, prevValue) || (didReceiveUpdate = !0), hook;
			if (0 === (renderLanes & 106) || 0 !== (renderLanes & 1073741824) && 0 === (workInProgressRootRenderLanes & 261930)) return didReceiveUpdate = !0, hook.memoizedState = value;
			hook = requestDeferredLane();
			currentlyRenderingFiber.lanes |= hook;
			workInProgressRootSkippedLanes |= hook;
			return prevValue;
		}
		function startTransition(fiber, queue, pendingState, finishedState, callback) {
			var previousPriority = ReactDOMSharedInternals.p;
			ReactDOMSharedInternals.p = 0 !== previousPriority && 8 > previousPriority ? previousPriority : 8;
			var prevTransition = ReactSharedInternals.T, currentTransition = {};
			currentTransition.types = null !== prevTransition ? prevTransition.types : null;
			ReactSharedInternals.T = currentTransition;
			dispatchOptimisticSetState(fiber, !1, queue, pendingState);
			try {
				var returnValue = callback(), onStartTransitionFinish = ReactSharedInternals.S;
				null !== onStartTransitionFinish && onStartTransitionFinish(currentTransition, returnValue);
				if (null !== returnValue && "object" === typeof returnValue && "function" === typeof returnValue.then) dispatchSetStateInternal(fiber, queue, chainThenableValue(returnValue, finishedState), requestUpdateLane(fiber));
				else dispatchSetStateInternal(fiber, queue, finishedState, requestUpdateLane(fiber));
			} catch (error) {
				dispatchSetStateInternal(fiber, queue, {
					then: function() {},
					status: "rejected",
					reason: error
				}, requestUpdateLane());
			} finally {
				ReactDOMSharedInternals.p = previousPriority, null !== prevTransition && null !== currentTransition.types && (prevTransition.types = currentTransition.types), ReactSharedInternals.T = prevTransition;
			}
		}
		function noop() {}
		function startHostTransition(formFiber, pendingState, action, formData) {
			if (5 !== formFiber.tag) throw Error(formatProdErrorMessage(476));
			var queue = ensureFormComponentIsStateful(formFiber).queue;
			startTransition(formFiber, queue, pendingState, sharedNotPendingObject, null === action ? noop : function() {
				requestFormReset$1(formFiber);
				return action(formData);
			});
		}
		function ensureFormComponentIsStateful(formFiber) {
			var existingStateHook = formFiber.memoizedState;
			if (null !== existingStateHook) return existingStateHook;
			existingStateHook = {
				memoizedState: sharedNotPendingObject,
				baseState: sharedNotPendingObject,
				baseQueue: null,
				queue: {
					pending: null,
					lanes: 0,
					dispatch: null,
					lastRenderedReducer: basicStateReducer,
					lastRenderedState: sharedNotPendingObject
				},
				next: null
			};
			var initialResetState = {};
			existingStateHook.next = {
				memoizedState: initialResetState,
				baseState: initialResetState,
				baseQueue: null,
				queue: {
					pending: null,
					lanes: 0,
					dispatch: null,
					lastRenderedReducer: basicStateReducer,
					lastRenderedState: initialResetState
				},
				next: null
			};
			formFiber.memoizedState = existingStateHook;
			formFiber = formFiber.alternate;
			null !== formFiber && (formFiber.memoizedState = existingStateHook);
			return existingStateHook;
		}
		function requestFormReset$1(formFiber) {
			var stateHook = ensureFormComponentIsStateful(formFiber);
			null === stateHook.next && (stateHook = formFiber.alternate.memoizedState);
			dispatchSetStateInternal(formFiber, stateHook.next.queue, {}, requestUpdateLane());
		}
		function useHostTransitionStatus() {
			return readContext(HostTransitionContext);
		}
		function updateId() {
			return updateWorkInProgressHook().memoizedState;
		}
		function updateRefresh() {
			return updateWorkInProgressHook().memoizedState;
		}
		function refreshCache(fiber) {
			for (var provider = fiber.return; null !== provider;) {
				switch (provider.tag) {
					case 24:
					case 3:
						var lane = requestUpdateLane();
						fiber = createUpdate(lane);
						var root$73 = enqueueUpdate(provider, fiber, lane);
						null !== root$73 && (scheduleUpdateOnFiber(root$73, provider, lane), entangleTransitions(root$73, provider, lane));
						provider = { cache: createCache() };
						fiber.payload = provider;
						return;
				}
				provider = provider.return;
			}
		}
		function dispatchReducerAction(fiber, queue, action) {
			var lane = requestUpdateLane();
			action = {
				lane,
				revertLane: 0,
				gesture: null,
				action,
				hasEagerState: !1,
				eagerState: null,
				next: null
			};
			isRenderPhaseUpdate(fiber) ? enqueueRenderPhaseUpdate(queue, action) : (action = enqueueConcurrentHookUpdate(fiber, queue, action, lane), null !== action && (scheduleUpdateOnFiber(action, fiber, lane), entangleTransitionUpdate(action, queue, lane)));
		}
		function dispatchSetState(fiber, queue, action) {
			dispatchSetStateInternal(fiber, queue, action, requestUpdateLane());
		}
		function dispatchSetStateInternal(fiber, queue, action, lane) {
			var update = {
				lane,
				revertLane: 0,
				gesture: null,
				action,
				hasEagerState: !1,
				eagerState: null,
				next: null
			};
			if (isRenderPhaseUpdate(fiber)) enqueueRenderPhaseUpdate(queue, update);
			else {
				var alternate = fiber.alternate;
				if (0 === fiber.lanes && (null === alternate || 0 === alternate.lanes) && (alternate = queue.lastRenderedReducer, null !== alternate)) try {
					var currentState = queue.lastRenderedState, eagerState = alternate(currentState, action);
					update.hasEagerState = !0;
					update.eagerState = eagerState;
					if (objectIs(eagerState, currentState)) return enqueueUpdate$1(fiber, queue, update, 0), null === workInProgressRoot && finishQueueingConcurrentUpdates(), !1;
				} catch (error) {}
				action = enqueueConcurrentHookUpdate(fiber, queue, update, lane);
				if (null !== action) return scheduleUpdateOnFiber(action, fiber, lane), entangleTransitionUpdate(action, queue, lane), !0;
			}
			return !1;
		}
		function dispatchOptimisticSetState(fiber, throwIfDuringRender, queue, action) {
			action = {
				lane: 2,
				revertLane: requestTransitionLane(),
				gesture: null,
				action,
				hasEagerState: !1,
				eagerState: null,
				next: null
			};
			if (isRenderPhaseUpdate(fiber)) {
				if (throwIfDuringRender) throw Error(formatProdErrorMessage(479));
			} else throwIfDuringRender = enqueueConcurrentHookUpdate(fiber, queue, action, 2), null !== throwIfDuringRender && scheduleUpdateOnFiber(throwIfDuringRender, fiber, 2);
		}
		function isRenderPhaseUpdate(fiber) {
			var alternate = fiber.alternate;
			return fiber === currentlyRenderingFiber || null !== alternate && alternate === currentlyRenderingFiber;
		}
		function enqueueRenderPhaseUpdate(queue, update) {
			didScheduleRenderPhaseUpdateDuringThisPass = didScheduleRenderPhaseUpdate = !0;
			var pending = queue.pending;
			null === pending ? update.next = update : (update.next = pending.next, pending.next = update);
			queue.pending = update;
		}
		function entangleTransitionUpdate(root, queue, lane) {
			if (0 !== (lane & 4194048)) {
				var queueLanes = queue.lanes;
				queueLanes &= root.pendingLanes;
				lane |= queueLanes;
				queue.lanes = lane;
				markRootEntangled(root, lane);
			}
		}
		var ContextOnlyDispatcher = {
			readContext,
			use,
			useCallback: throwInvalidHookError,
			useContext: throwInvalidHookError,
			useEffect: throwInvalidHookError,
			useImperativeHandle: throwInvalidHookError,
			useLayoutEffect: throwInvalidHookError,
			useInsertionEffect: throwInvalidHookError,
			useMemo: throwInvalidHookError,
			useReducer: throwInvalidHookError,
			useRef: throwInvalidHookError,
			useState: throwInvalidHookError,
			useDebugValue: throwInvalidHookError,
			useDeferredValue: throwInvalidHookError,
			useTransition: throwInvalidHookError,
			useSyncExternalStore: throwInvalidHookError,
			useId: throwInvalidHookError,
			useHostTransitionStatus: throwInvalidHookError,
			useFormState: throwInvalidHookError,
			useActionState: throwInvalidHookError,
			useOptimistic: throwInvalidHookError,
			useMemoCache: throwInvalidHookError,
			useCacheRefresh: throwInvalidHookError,
			useEffectEvent: throwInvalidHookError
		};
		var HooksDispatcherOnMount = {
			readContext,
			use,
			useCallback: function(callback, deps) {
				mountWorkInProgressHook().memoizedState = [callback, void 0 === deps ? null : deps];
				return callback;
			},
			useContext: readContext,
			useEffect: mountEffect,
			useImperativeHandle: function(ref, create, deps) {
				deps = null !== deps && void 0 !== deps ? deps.concat([ref]) : null;
				mountEffectImpl(4194308, 4, imperativeHandleEffect.bind(null, create, ref), deps);
			},
			useLayoutEffect: function(create, deps) {
				return mountEffectImpl(4194308, 4, create, deps);
			},
			useInsertionEffect: function(create, deps) {
				mountEffectImpl(4, 2, create, deps);
			},
			useMemo: function(nextCreate, deps) {
				var hook = mountWorkInProgressHook();
				deps = void 0 === deps ? null : deps;
				var nextValue = nextCreate();
				if (shouldDoubleInvokeUserFnsInHooksDEV) {
					setIsStrictModeForDevtools(!0);
					try {
						nextCreate();
					} finally {
						setIsStrictModeForDevtools(!1);
					}
				}
				hook.memoizedState = [nextValue, deps];
				return nextValue;
			},
			useReducer: function(reducer, initialArg, init) {
				var hook = mountWorkInProgressHook();
				if (void 0 !== init) {
					var initialState = init(initialArg);
					if (shouldDoubleInvokeUserFnsInHooksDEV) {
						setIsStrictModeForDevtools(!0);
						try {
							init(initialArg);
						} finally {
							setIsStrictModeForDevtools(!1);
						}
					}
				} else initialState = initialArg;
				hook.memoizedState = hook.baseState = initialState;
				reducer = {
					pending: null,
					lanes: 0,
					dispatch: null,
					lastRenderedReducer: reducer,
					lastRenderedState: initialState
				};
				hook.queue = reducer;
				reducer = reducer.dispatch = dispatchReducerAction.bind(null, currentlyRenderingFiber, reducer);
				return [hook.memoizedState, reducer];
			},
			useRef: function(initialValue) {
				var hook = mountWorkInProgressHook();
				initialValue = { current: initialValue };
				return hook.memoizedState = initialValue;
			},
			useState: function(initialState) {
				initialState = mountStateImpl(initialState);
				var queue = initialState.queue, dispatch = dispatchSetState.bind(null, currentlyRenderingFiber, queue);
				queue.dispatch = dispatch;
				return [initialState.memoizedState, dispatch];
			},
			useDebugValue: mountDebugValue,
			useDeferredValue: function(value, initialValue) {
				return mountDeferredValueImpl(mountWorkInProgressHook(), value, initialValue);
			},
			useTransition: function() {
				var stateHook = mountStateImpl(!1);
				stateHook = startTransition.bind(null, currentlyRenderingFiber, stateHook.queue, !0, !1);
				mountWorkInProgressHook().memoizedState = stateHook;
				return [!1, stateHook];
			},
			useSyncExternalStore: function(subscribe, getSnapshot, getServerSnapshot) {
				var fiber = currentlyRenderingFiber, hook = mountWorkInProgressHook();
				if (isHydrating) {
					if (void 0 === getServerSnapshot) throw Error(formatProdErrorMessage(407));
					getServerSnapshot = getServerSnapshot();
				} else {
					getServerSnapshot = getSnapshot();
					if (null === workInProgressRoot) throw Error(formatProdErrorMessage(349));
					0 !== (workInProgressRootRenderLanes & 127) || pushStoreConsistencyCheck(fiber, getSnapshot, getServerSnapshot);
				}
				hook.memoizedState = getServerSnapshot;
				var inst = {
					value: getServerSnapshot,
					getSnapshot
				};
				hook.queue = inst;
				mountEffect(subscribeToStore.bind(null, fiber, inst, subscribe), [subscribe]);
				fiber.flags |= 2048;
				pushSimpleEffect(9, { destroy: void 0 }, updateStoreInstance.bind(null, fiber, inst, getServerSnapshot, getSnapshot), null);
				return getServerSnapshot;
			},
			useId: function() {
				var hook = mountWorkInProgressHook(), identifierPrefix = workInProgressRoot.identifierPrefix;
				if (isHydrating) {
					var JSCompiler_inline_result = treeContextOverflow;
					var idWithLeadingBit = treeContextId;
					JSCompiler_inline_result = (idWithLeadingBit & ~(1 << 32 - clz32(idWithLeadingBit) - 1)).toString(32) + JSCompiler_inline_result;
					identifierPrefix = "_" + identifierPrefix + "R_" + JSCompiler_inline_result;
					JSCompiler_inline_result = localIdCounter++;
					0 < JSCompiler_inline_result && (identifierPrefix += "H" + JSCompiler_inline_result.toString(32));
					identifierPrefix += "_";
				} else JSCompiler_inline_result = globalClientIdCounter++, identifierPrefix = "_" + identifierPrefix + "r_" + JSCompiler_inline_result.toString(32) + "_";
				return hook.memoizedState = identifierPrefix;
			},
			useHostTransitionStatus,
			useFormState: mountActionState,
			useActionState: mountActionState,
			useOptimistic: function(passthrough) {
				var hook = mountWorkInProgressHook();
				hook.memoizedState = hook.baseState = passthrough;
				var queue = {
					pending: null,
					lanes: 0,
					dispatch: null,
					lastRenderedReducer: null,
					lastRenderedState: null
				};
				hook.queue = queue;
				hook = dispatchOptimisticSetState.bind(null, currentlyRenderingFiber, !0, queue);
				queue.dispatch = hook;
				return [passthrough, hook];
			},
			useMemoCache,
			useCacheRefresh: function() {
				return mountWorkInProgressHook().memoizedState = refreshCache.bind(null, currentlyRenderingFiber);
			},
			useEffectEvent: function(callback) {
				var hook = mountWorkInProgressHook(), ref = { impl: callback };
				hook.memoizedState = ref;
				return function() {
					if (0 !== (executionContext & 2)) throw Error(formatProdErrorMessage(440));
					return ref.impl.apply(void 0, arguments);
				};
			}
		};
		var HooksDispatcherOnUpdate = {
			readContext,
			use,
			useCallback: updateCallback,
			useContext: readContext,
			useEffect: updateEffect,
			useImperativeHandle: updateImperativeHandle,
			useInsertionEffect: updateInsertionEffect,
			useLayoutEffect: updateLayoutEffect,
			useMemo: updateMemo,
			useReducer: updateReducer,
			useRef: updateRef,
			useState: function() {
				return updateReducer(basicStateReducer);
			},
			useDebugValue: mountDebugValue,
			useDeferredValue: function(value, initialValue) {
				return updateDeferredValueImpl(updateWorkInProgressHook(), currentHook.memoizedState, value, initialValue);
			},
			useTransition: function() {
				var booleanOrThenable = updateReducer(basicStateReducer)[0], start = updateWorkInProgressHook().memoizedState;
				return ["boolean" === typeof booleanOrThenable ? booleanOrThenable : useThenable(booleanOrThenable), start];
			},
			useSyncExternalStore: updateSyncExternalStore,
			useId: updateId,
			useHostTransitionStatus,
			useFormState: updateActionState,
			useActionState: updateActionState,
			useOptimistic: function(passthrough, reducer) {
				return updateOptimisticImpl(updateWorkInProgressHook(), currentHook, passthrough, reducer);
			},
			useMemoCache,
			useCacheRefresh: updateRefresh,
			useEffectEvent: updateEvent
		};
		var HooksDispatcherOnRerender = {
			readContext,
			use,
			useCallback: updateCallback,
			useContext: readContext,
			useEffect: updateEffect,
			useImperativeHandle: updateImperativeHandle,
			useInsertionEffect: updateInsertionEffect,
			useLayoutEffect: updateLayoutEffect,
			useMemo: updateMemo,
			useReducer: rerenderReducer,
			useRef: updateRef,
			useState: function() {
				return rerenderReducer(basicStateReducer);
			},
			useDebugValue: mountDebugValue,
			useDeferredValue: function(value, initialValue) {
				var hook = updateWorkInProgressHook();
				return null === currentHook ? mountDeferredValueImpl(hook, value, initialValue) : updateDeferredValueImpl(hook, currentHook.memoizedState, value, initialValue);
			},
			useTransition: function() {
				var booleanOrThenable = rerenderReducer(basicStateReducer)[0], start = updateWorkInProgressHook().memoizedState;
				return ["boolean" === typeof booleanOrThenable ? booleanOrThenable : useThenable(booleanOrThenable), start];
			},
			useSyncExternalStore: updateSyncExternalStore,
			useId: updateId,
			useHostTransitionStatus,
			useFormState: rerenderActionState,
			useActionState: rerenderActionState,
			useOptimistic: function(passthrough, reducer) {
				var hook = updateWorkInProgressHook();
				if (null !== currentHook) return updateOptimisticImpl(hook, currentHook, passthrough, reducer);
				hook.baseState = passthrough;
				return [passthrough, hook.queue.dispatch];
			},
			useMemoCache,
			useCacheRefresh: updateRefresh,
			useEffectEvent: updateEvent
		};
		function applyDerivedStateFromProps(workInProgress, ctor, getDerivedStateFromProps, nextProps) {
			ctor = workInProgress.memoizedState;
			getDerivedStateFromProps = getDerivedStateFromProps(nextProps, ctor);
			getDerivedStateFromProps = null === getDerivedStateFromProps || void 0 === getDerivedStateFromProps ? ctor : assign({}, ctor, getDerivedStateFromProps);
			workInProgress.memoizedState = getDerivedStateFromProps;
			0 === workInProgress.lanes && (workInProgress.updateQueue.baseState = getDerivedStateFromProps);
		}
		var classComponentUpdater = {
			enqueueSetState: function(inst, payload, callback) {
				inst = inst._reactInternals;
				var lane = requestUpdateLane(), update = createUpdate(lane);
				update.payload = payload;
				void 0 !== callback && null !== callback && (update.callback = callback);
				payload = enqueueUpdate(inst, update, lane);
				null !== payload && (scheduleUpdateOnFiber(payload, inst, lane), entangleTransitions(payload, inst, lane));
			},
			enqueueReplaceState: function(inst, payload, callback) {
				inst = inst._reactInternals;
				var lane = requestUpdateLane(), update = createUpdate(lane);
				update.tag = 1;
				update.payload = payload;
				void 0 !== callback && null !== callback && (update.callback = callback);
				payload = enqueueUpdate(inst, update, lane);
				null !== payload && (scheduleUpdateOnFiber(payload, inst, lane), entangleTransitions(payload, inst, lane));
			},
			enqueueForceUpdate: function(inst, callback) {
				inst = inst._reactInternals;
				var lane = requestUpdateLane(), update = createUpdate(lane);
				update.tag = 2;
				void 0 !== callback && null !== callback && (update.callback = callback);
				callback = enqueueUpdate(inst, update, lane);
				null !== callback && (scheduleUpdateOnFiber(callback, inst, lane), entangleTransitions(callback, inst, lane));
			}
		};
		function checkShouldComponentUpdate(workInProgress, ctor, oldProps, newProps, oldState, newState, nextContext) {
			workInProgress = workInProgress.stateNode;
			return "function" === typeof workInProgress.shouldComponentUpdate ? workInProgress.shouldComponentUpdate(newProps, newState, nextContext) : ctor.prototype && ctor.prototype.isPureReactComponent ? !shallowEqual(oldProps, newProps) || !shallowEqual(oldState, newState) : !0;
		}
		function callComponentWillReceiveProps(workInProgress, instance, newProps, nextContext) {
			workInProgress = instance.state;
			"function" === typeof instance.componentWillReceiveProps && instance.componentWillReceiveProps(newProps, nextContext);
			"function" === typeof instance.UNSAFE_componentWillReceiveProps && instance.UNSAFE_componentWillReceiveProps(newProps, nextContext);
			instance.state !== workInProgress && classComponentUpdater.enqueueReplaceState(instance, instance.state, null);
		}
		function resolveClassComponentProps(Component, baseProps) {
			var newProps = baseProps;
			if ("ref" in baseProps) {
				newProps = {};
				for (var propName in baseProps) "ref" !== propName && (newProps[propName] = baseProps[propName]);
			}
			if (Component = Component.defaultProps) {
				newProps === baseProps && (newProps = assign({}, newProps));
				for (var propName$77 in Component) void 0 === newProps[propName$77] && (newProps[propName$77] = Component[propName$77]);
			}
			return newProps;
		}
		function defaultOnUncaughtError(error) {
			reportGlobalError(error);
		}
		function defaultOnCaughtError(error) {
			console.error(error);
		}
		function defaultOnRecoverableError(error) {
			reportGlobalError(error);
		}
		function logUncaughtError(root, errorInfo) {
			try {
				var onUncaughtError = root.onUncaughtError;
				onUncaughtError(errorInfo.value, { componentStack: errorInfo.stack });
			} catch (e$78) {
				setTimeout(function() {
					throw e$78;
				});
			}
		}
		function logCaughtError(root, boundary, errorInfo) {
			try {
				var onCaughtError = root.onCaughtError;
				onCaughtError(errorInfo.value, {
					componentStack: errorInfo.stack,
					errorBoundary: 1 === boundary.tag ? boundary.stateNode : null
				});
			} catch (e$79) {
				setTimeout(function() {
					throw e$79;
				});
			}
		}
		function createRootErrorUpdate(root, errorInfo, lane) {
			lane = createUpdate(lane);
			lane.tag = 3;
			lane.payload = { element: null };
			lane.callback = function() {
				logUncaughtError(root, errorInfo);
			};
			return lane;
		}
		function createClassErrorUpdate(lane) {
			lane = createUpdate(lane);
			lane.tag = 3;
			return lane;
		}
		function initializeClassErrorUpdate(update, root, fiber, errorInfo) {
			var getDerivedStateFromError = fiber.type.getDerivedStateFromError;
			if ("function" === typeof getDerivedStateFromError) {
				var error = errorInfo.value;
				update.payload = function() {
					return getDerivedStateFromError(error);
				};
				update.callback = function() {
					logCaughtError(root, fiber, errorInfo);
				};
			}
			var inst = fiber.stateNode;
			null !== inst && "function" === typeof inst.componentDidCatch && (update.callback = function() {
				logCaughtError(root, fiber, errorInfo);
				"function" !== typeof getDerivedStateFromError && (null === legacyErrorBoundariesThatAlreadyFailed ? legacyErrorBoundariesThatAlreadyFailed = new Set([this]) : legacyErrorBoundariesThatAlreadyFailed.add(this));
				var stack = errorInfo.stack;
				this.componentDidCatch(errorInfo.value, { componentStack: null !== stack ? stack : "" });
			});
		}
		function throwException(root, returnFiber, sourceFiber, value, rootRenderLanes) {
			sourceFiber.flags |= 32768;
			if (null !== value && "object" === typeof value && "function" === typeof value.then) {
				returnFiber = sourceFiber.alternate;
				null !== returnFiber && propagateParentContextChanges(returnFiber, sourceFiber, rootRenderLanes, !0);
				sourceFiber = suspenseHandlerStackCursor.current;
				if (null !== sourceFiber) {
					switch (sourceFiber.tag) {
						case 31:
						case 13:
						case 19: return null === shellBoundary ? renderDidSuspendDelayIfPossible() : null === sourceFiber.alternate && 0 === workInProgressRootExitStatus && (workInProgressRootExitStatus = 3), sourceFiber.flags &= -257, sourceFiber.flags |= 65536, sourceFiber.lanes = rootRenderLanes, value === noopSuspenseyCommitThenable ? sourceFiber.flags |= 16384 : (returnFiber = sourceFiber.updateQueue, null === returnFiber ? sourceFiber.updateQueue = new Set([value]) : returnFiber.add(value), attachPingListener(root, value, rootRenderLanes)), !1;
						case 22: return sourceFiber.flags |= 65536, value === noopSuspenseyCommitThenable ? sourceFiber.flags |= 16384 : (returnFiber = sourceFiber.updateQueue, null === returnFiber ? (returnFiber = {
							transitions: null,
							markerInstances: null,
							retryQueue: new Set([value])
						}, sourceFiber.updateQueue = returnFiber) : (sourceFiber = returnFiber.retryQueue, null === sourceFiber ? returnFiber.retryQueue = new Set([value]) : sourceFiber.add(value)), attachPingListener(root, value, rootRenderLanes)), !1;
					}
					throw Error(formatProdErrorMessage(435, sourceFiber.tag));
				}
				attachPingListener(root, value, rootRenderLanes);
				renderDidSuspendDelayIfPossible();
				return !1;
			}
			if (isHydrating) return returnFiber = suspenseHandlerStackCursor.current, null !== returnFiber ? (0 === (returnFiber.flags & 65536) && (returnFiber.flags |= 256), returnFiber.flags |= 65536, returnFiber.lanes = rootRenderLanes, value !== HydrationMismatchException && (root = Error(formatProdErrorMessage(422), { cause: value }), queueHydrationError(createCapturedValueAtFiber(root, sourceFiber)))) : (value !== HydrationMismatchException && (returnFiber = Error(formatProdErrorMessage(423), { cause: value }), queueHydrationError(createCapturedValueAtFiber(returnFiber, sourceFiber))), root = root.current.alternate, root.flags |= 65536, rootRenderLanes &= -rootRenderLanes, root.lanes |= rootRenderLanes, value = createCapturedValueAtFiber(value, sourceFiber), rootRenderLanes = createRootErrorUpdate(root.stateNode, value, rootRenderLanes), enqueueCapturedUpdate(root, rootRenderLanes), 4 !== workInProgressRootExitStatus && (workInProgressRootExitStatus = 2)), !1;
			var wrapperError = Error(formatProdErrorMessage(520), { cause: value });
			wrapperError = createCapturedValueAtFiber(wrapperError, sourceFiber);
			null === workInProgressRootConcurrentErrors ? workInProgressRootConcurrentErrors = [wrapperError] : workInProgressRootConcurrentErrors.push(wrapperError);
			4 !== workInProgressRootExitStatus && (workInProgressRootExitStatus = 2);
			if (null === returnFiber) return !0;
			value = createCapturedValueAtFiber(value, sourceFiber);
			sourceFiber = returnFiber;
			do {
				switch (sourceFiber.tag) {
					case 3: return sourceFiber.flags |= 65536, root = rootRenderLanes & -rootRenderLanes, sourceFiber.lanes |= root, root = createRootErrorUpdate(sourceFiber.stateNode, value, root), enqueueCapturedUpdate(sourceFiber, root), !1;
					case 1:
						returnFiber = sourceFiber.type;
						wrapperError = sourceFiber.stateNode;
						if (0 === (sourceFiber.flags & 128) && ("function" === typeof returnFiber.getDerivedStateFromError || null !== wrapperError && "function" === typeof wrapperError.componentDidCatch && (null === legacyErrorBoundariesThatAlreadyFailed || !legacyErrorBoundariesThatAlreadyFailed.has(wrapperError)))) return sourceFiber.flags |= 65536, rootRenderLanes &= -rootRenderLanes, sourceFiber.lanes |= rootRenderLanes, rootRenderLanes = createClassErrorUpdate(rootRenderLanes), initializeClassErrorUpdate(rootRenderLanes, root, sourceFiber, value), enqueueCapturedUpdate(sourceFiber, rootRenderLanes), !1;
						break;
					case 22: if (null !== sourceFiber.memoizedState) return sourceFiber.flags |= 65536, !1;
				}
				sourceFiber = sourceFiber.return;
			} while (null !== sourceFiber);
			return !1;
		}
		var SelectiveHydrationException = Error(formatProdErrorMessage(461));
		var didReceiveUpdate = !1;
		function reconcileChildren(current, workInProgress, nextChildren, renderLanes) {
			workInProgress.child = null === current ? mountChildFibers(workInProgress, null, nextChildren, renderLanes) : reconcileChildFibers(workInProgress, current.child, nextChildren, renderLanes);
		}
		function updateForwardRef(current, workInProgress, Component, nextProps, renderLanes) {
			Component = Component.render;
			var ref = workInProgress.ref;
			if ("ref" in nextProps) {
				var propsWithoutRef = {};
				for (var key in nextProps) "ref" !== key && (propsWithoutRef[key] = nextProps[key]);
			} else propsWithoutRef = nextProps;
			prepareToReadContext(workInProgress);
			nextProps = renderWithHooks(current, workInProgress, Component, propsWithoutRef, ref, renderLanes);
			key = checkDidRenderIdHook();
			if (null !== current && !didReceiveUpdate) return bailoutHooks(current, workInProgress, renderLanes), bailoutOnAlreadyFinishedWork(current, workInProgress, renderLanes);
			isHydrating && key && pushMaterializedTreeId(workInProgress);
			workInProgress.flags |= 1;
			reconcileChildren(current, workInProgress, nextProps, renderLanes);
			return workInProgress.child;
		}
		function updateMemoComponent(current, workInProgress, Component, nextProps, renderLanes) {
			if (null === current) {
				var type = Component.type;
				if ("function" === typeof type && !shouldConstruct(type) && void 0 === type.defaultProps && null === Component.compare) return workInProgress.tag = 15, workInProgress.type = type, updateSimpleMemoComponent(current, workInProgress, type, nextProps, renderLanes);
				current = createFiberFromTypeAndProps(Component.type, null, nextProps, workInProgress, workInProgress.mode, renderLanes);
				current.ref = workInProgress.ref;
				current.return = workInProgress;
				return workInProgress.child = current;
			}
			type = current.child;
			if (!checkScheduledUpdateOrContext(current, renderLanes)) {
				var prevProps = type.memoizedProps;
				Component = Component.compare;
				Component = null !== Component ? Component : shallowEqual;
				if (Component(prevProps, nextProps) && current.ref === workInProgress.ref) return bailoutOnAlreadyFinishedWork(current, workInProgress, renderLanes);
			}
			workInProgress.flags |= 1;
			current = createWorkInProgress(type, nextProps);
			current.ref = workInProgress.ref;
			current.return = workInProgress;
			return workInProgress.child = current;
		}
		function updateSimpleMemoComponent(current, workInProgress, Component, nextProps, renderLanes) {
			if (null !== current) {
				var prevProps = current.memoizedProps;
				if (shallowEqual(prevProps, nextProps) && current.ref === workInProgress.ref) if (didReceiveUpdate = !1, workInProgress.pendingProps = nextProps = prevProps, checkScheduledUpdateOrContext(current, renderLanes)) 0 !== (current.flags & 131072) && (didReceiveUpdate = !0);
				else return workInProgress.lanes = current.lanes, bailoutOnAlreadyFinishedWork(current, workInProgress, renderLanes);
			}
			return updateFunctionComponent(current, workInProgress, Component, nextProps, renderLanes);
		}
		function updateOffscreenComponent(current, workInProgress, renderLanes, nextProps) {
			var nextChildren = nextProps.children, prevState = null !== current ? current.memoizedState : null;
			null === current && null === workInProgress.stateNode && (workInProgress.stateNode = {
				_visibility: 1,
				_pendingMarkers: null,
				_retryCache: null,
				_transitions: null
			});
			if ("hidden" === nextProps.mode) {
				if (0 !== (workInProgress.flags & 128)) {
					prevState = null !== prevState ? prevState.baseLanes | renderLanes : renderLanes;
					if (null !== current) {
						nextProps = workInProgress.child = current.child;
						for (nextChildren = 0; null !== nextProps;) nextChildren = nextChildren | nextProps.lanes | nextProps.childLanes, nextProps = nextProps.sibling;
						nextProps = nextChildren & ~prevState;
					} else nextProps = 0, workInProgress.child = null;
					return deferHiddenOffscreenComponent(current, workInProgress, prevState, renderLanes, nextProps);
				}
				if (0 !== (renderLanes & 536870912)) workInProgress.memoizedState = {
					baseLanes: 0,
					cachePool: null
				}, null !== current && pushTransition(workInProgress, null !== prevState ? prevState.cachePool : null), null !== prevState ? pushHiddenContext(workInProgress, prevState) : reuseHiddenContextOnStack(), pushOffscreenSuspenseHandler(workInProgress);
				else return nextProps = workInProgress.lanes = 536870912, deferHiddenOffscreenComponent(current, workInProgress, null !== prevState ? prevState.baseLanes | renderLanes : renderLanes, renderLanes, nextProps);
			} else null !== prevState ? (pushTransition(workInProgress, prevState.cachePool), pushHiddenContext(workInProgress, prevState), reuseSuspenseHandlerOnStack(), workInProgress.memoizedState = null) : (null !== current && pushTransition(workInProgress, null), reuseHiddenContextOnStack(), reuseSuspenseHandlerOnStack());
			reconcileChildren(current, workInProgress, nextChildren, renderLanes);
			return workInProgress.child;
		}
		function bailoutOffscreenComponent(current, workInProgress) {
			null !== current && 22 === current.tag || null !== workInProgress.stateNode || (workInProgress.stateNode = {
				_visibility: 1,
				_pendingMarkers: null,
				_retryCache: null,
				_transitions: null
			});
			return workInProgress.sibling;
		}
		function deferHiddenOffscreenComponent(current, workInProgress, nextBaseLanes, renderLanes, remainingChildLanes) {
			var JSCompiler_inline_result = peekCacheFromPool();
			JSCompiler_inline_result = null === JSCompiler_inline_result ? null : {
				parent: CacheContext._currentValue,
				pool: JSCompiler_inline_result
			};
			workInProgress.memoizedState = {
				baseLanes: nextBaseLanes,
				cachePool: JSCompiler_inline_result
			};
			null !== current && pushTransition(workInProgress, null);
			reuseHiddenContextOnStack();
			pushOffscreenSuspenseHandler(workInProgress);
			null !== current && propagateParentContextChanges(current, workInProgress, renderLanes, !0);
			workInProgress.childLanes = remainingChildLanes;
			return null;
		}
		function mountActivityChildren(workInProgress, nextProps) {
			nextProps = mountWorkInProgressOffscreenFiber({
				mode: nextProps.mode,
				children: nextProps.children
			}, workInProgress.mode);
			nextProps.ref = workInProgress.ref;
			workInProgress.child = nextProps;
			nextProps.return = workInProgress;
			return nextProps;
		}
		function retryActivityComponentWithoutHydrating(current, workInProgress, renderLanes) {
			reconcileChildFibers(workInProgress, current.child, null, renderLanes);
			current = mountActivityChildren(workInProgress, workInProgress.pendingProps);
			current.flags |= 2;
			popSuspenseHandler(workInProgress);
			workInProgress.memoizedState = null;
			return current;
		}
		function updateActivityComponent(current, workInProgress, renderLanes) {
			var nextProps = workInProgress.pendingProps, didSuspend = 0 !== (workInProgress.flags & 128);
			workInProgress.flags &= -129;
			if (null === current) {
				if (isHydrating) {
					if ("hidden" === nextProps.mode) return current = mountActivityChildren(workInProgress, nextProps), workInProgress.lanes = 536870912, current.memoizedState = {
						baseLanes: 0,
						cachePool: null
					}, bailoutOffscreenComponent(null, current);
					pushDehydratedActivitySuspenseHandler(workInProgress);
					(current = nextHydratableInstance) ? (current = canHydrateHydrationBoundary(current, rootOrSingletonContext), current = null !== current && "&" === current.data ? current : null, null !== current && (workInProgress.memoizedState = {
						dehydrated: current,
						treeContext: null !== treeContextProvider ? {
							id: treeContextId,
							overflow: treeContextOverflow
						} : null,
						retryLane: 536870912,
						hydrationErrors: null
					}, renderLanes = createFiberFromDehydratedFragment(current), renderLanes.return = workInProgress, workInProgress.child = renderLanes, hydrationParentFiber = workInProgress, nextHydratableInstance = null)) : current = null;
					if (null === current) throw throwOnHydrationMismatch(workInProgress);
					workInProgress.lanes = 536870912;
					return null;
				}
				return mountActivityChildren(workInProgress, nextProps);
			}
			var prevState = current.memoizedState;
			if (null !== prevState) {
				var dehydrated = prevState.dehydrated;
				pushDehydratedActivitySuspenseHandler(workInProgress);
				if (didSuspend) if (workInProgress.flags & 256) workInProgress.flags &= -257, workInProgress = retryActivityComponentWithoutHydrating(current, workInProgress, renderLanes);
				else if (null !== workInProgress.memoizedState) workInProgress.child = current.child, workInProgress.flags |= 128, workInProgress = null;
				else throw Error(formatProdErrorMessage(558));
				else if (didReceiveUpdate || propagateParentContextChanges(current, workInProgress, renderLanes, !1), didSuspend = 0 !== (renderLanes & current.childLanes), didReceiveUpdate || didSuspend) {
					if (null === currentTreeHiddenStackCursor.current) {
						nextProps = workInProgressRoot;
						if (null !== nextProps && (dehydrated = getBumpedLaneForHydration(nextProps, renderLanes), 0 !== dehydrated && dehydrated !== prevState.retryLane)) throw prevState.retryLane = dehydrated, enqueueConcurrentRenderForLane(current, dehydrated), scheduleUpdateOnFiber(nextProps, current, dehydrated), SelectiveHydrationException;
						renderDidSuspendDelayIfPossible();
					}
					workInProgress = retryActivityComponentWithoutHydrating(current, workInProgress, renderLanes);
				} else current = prevState.treeContext, nextHydratableInstance = getNextHydratable(dehydrated.nextSibling), hydrationParentFiber = workInProgress, isHydrating = !0, hydrationErrors = null, rootOrSingletonContext = !1, null !== current && restoreSuspendedTreeContext(workInProgress, current), workInProgress = mountActivityChildren(workInProgress, nextProps), workInProgress.flags |= 134221824;
				return workInProgress;
			}
			current = createWorkInProgress(current.child, {
				mode: nextProps.mode,
				children: nextProps.children
			});
			current.ref = workInProgress.ref;
			workInProgress.child = current;
			current.return = workInProgress;
			return current;
		}
		function markRef(current, workInProgress) {
			var ref = workInProgress.ref;
			if (null === ref) null !== current && null !== current.ref && (workInProgress.flags |= 4194816);
			else {
				if ("function" !== typeof ref && "object" !== typeof ref) throw Error(formatProdErrorMessage(284));
				if (null === current || current.ref !== ref) workInProgress.flags |= 4194816;
			}
		}
		function updateFunctionComponent(current, workInProgress, Component, nextProps, renderLanes) {
			prepareToReadContext(workInProgress);
			Component = renderWithHooks(current, workInProgress, Component, nextProps, void 0, renderLanes);
			nextProps = checkDidRenderIdHook();
			if (null !== current && !didReceiveUpdate) return bailoutHooks(current, workInProgress, renderLanes), bailoutOnAlreadyFinishedWork(current, workInProgress, renderLanes);
			isHydrating && nextProps && pushMaterializedTreeId(workInProgress);
			workInProgress.flags |= 1;
			reconcileChildren(current, workInProgress, Component, renderLanes);
			return workInProgress.child;
		}
		function replayFunctionComponent(current, workInProgress, nextProps, Component, secondArg, renderLanes) {
			prepareToReadContext(workInProgress);
			workInProgress.updateQueue = null;
			nextProps = renderWithHooksAgain(workInProgress, Component, nextProps, secondArg);
			finishRenderingHooks(current);
			Component = checkDidRenderIdHook();
			if (null !== current && !didReceiveUpdate) return bailoutHooks(current, workInProgress, renderLanes), bailoutOnAlreadyFinishedWork(current, workInProgress, renderLanes);
			isHydrating && Component && pushMaterializedTreeId(workInProgress);
			workInProgress.flags |= 1;
			reconcileChildren(current, workInProgress, nextProps, renderLanes);
			return workInProgress.child;
		}
		function updateClassComponent(current, workInProgress, Component, nextProps, renderLanes) {
			prepareToReadContext(workInProgress);
			if (null === workInProgress.stateNode) {
				var context = emptyContextObject, contextType = Component.contextType;
				"object" === typeof contextType && null !== contextType && (context = readContext(contextType));
				context = new Component(nextProps, context);
				workInProgress.memoizedState = null !== context.state && void 0 !== context.state ? context.state : null;
				context.updater = classComponentUpdater;
				workInProgress.stateNode = context;
				context._reactInternals = workInProgress;
				context = workInProgress.stateNode;
				context.props = nextProps;
				context.state = workInProgress.memoizedState;
				context.refs = {};
				initializeUpdateQueue(workInProgress);
				contextType = Component.contextType;
				context.context = "object" === typeof contextType && null !== contextType ? readContext(contextType) : emptyContextObject;
				context.state = workInProgress.memoizedState;
				contextType = Component.getDerivedStateFromProps;
				"function" === typeof contextType && (applyDerivedStateFromProps(workInProgress, Component, contextType, nextProps), context.state = workInProgress.memoizedState);
				"function" === typeof Component.getDerivedStateFromProps || "function" === typeof context.getSnapshotBeforeUpdate || "function" !== typeof context.UNSAFE_componentWillMount && "function" !== typeof context.componentWillMount || (contextType = context.state, "function" === typeof context.componentWillMount && context.componentWillMount(), "function" === typeof context.UNSAFE_componentWillMount && context.UNSAFE_componentWillMount(), contextType !== context.state && classComponentUpdater.enqueueReplaceState(context, context.state, null), processUpdateQueue(workInProgress, nextProps, context, renderLanes), suspendIfUpdateReadFromEntangledAsyncAction(), context.state = workInProgress.memoizedState);
				"function" === typeof context.componentDidMount && (workInProgress.flags |= 4194308);
				nextProps = !0;
			} else if (null === current) {
				context = workInProgress.stateNode;
				var unresolvedOldProps = workInProgress.memoizedProps, oldProps = resolveClassComponentProps(Component, unresolvedOldProps);
				context.props = oldProps;
				var oldContext = context.context, contextType$jscomp$0 = Component.contextType;
				contextType = emptyContextObject;
				"object" === typeof contextType$jscomp$0 && null !== contextType$jscomp$0 && (contextType = readContext(contextType$jscomp$0));
				var getDerivedStateFromProps = Component.getDerivedStateFromProps;
				contextType$jscomp$0 = "function" === typeof getDerivedStateFromProps || "function" === typeof context.getSnapshotBeforeUpdate;
				unresolvedOldProps = workInProgress.pendingProps !== unresolvedOldProps;
				contextType$jscomp$0 || "function" !== typeof context.UNSAFE_componentWillReceiveProps && "function" !== typeof context.componentWillReceiveProps || (unresolvedOldProps || oldContext !== contextType) && callComponentWillReceiveProps(workInProgress, context, nextProps, contextType);
				hasForceUpdate = !1;
				var oldState = workInProgress.memoizedState;
				context.state = oldState;
				processUpdateQueue(workInProgress, nextProps, context, renderLanes);
				suspendIfUpdateReadFromEntangledAsyncAction();
				oldContext = workInProgress.memoizedState;
				unresolvedOldProps || oldState !== oldContext || hasForceUpdate ? ("function" === typeof getDerivedStateFromProps && (applyDerivedStateFromProps(workInProgress, Component, getDerivedStateFromProps, nextProps), oldContext = workInProgress.memoizedState), (oldProps = hasForceUpdate || checkShouldComponentUpdate(workInProgress, Component, oldProps, nextProps, oldState, oldContext, contextType)) ? (contextType$jscomp$0 || "function" !== typeof context.UNSAFE_componentWillMount && "function" !== typeof context.componentWillMount || ("function" === typeof context.componentWillMount && context.componentWillMount(), "function" === typeof context.UNSAFE_componentWillMount && context.UNSAFE_componentWillMount()), "function" === typeof context.componentDidMount && (workInProgress.flags |= 4194308)) : ("function" === typeof context.componentDidMount && (workInProgress.flags |= 4194308), workInProgress.memoizedProps = nextProps, workInProgress.memoizedState = oldContext), context.props = nextProps, context.state = oldContext, context.context = contextType, nextProps = oldProps) : ("function" === typeof context.componentDidMount && (workInProgress.flags |= 4194308), nextProps = !1);
			} else {
				context = workInProgress.stateNode;
				cloneUpdateQueue(current, workInProgress);
				contextType = workInProgress.memoizedProps;
				contextType$jscomp$0 = resolveClassComponentProps(Component, contextType);
				context.props = contextType$jscomp$0;
				getDerivedStateFromProps = workInProgress.pendingProps;
				oldState = context.context;
				oldContext = Component.contextType;
				oldProps = emptyContextObject;
				"object" === typeof oldContext && null !== oldContext && (oldProps = readContext(oldContext));
				unresolvedOldProps = Component.getDerivedStateFromProps;
				(oldContext = "function" === typeof unresolvedOldProps || "function" === typeof context.getSnapshotBeforeUpdate) || "function" !== typeof context.UNSAFE_componentWillReceiveProps && "function" !== typeof context.componentWillReceiveProps || (contextType !== getDerivedStateFromProps || oldState !== oldProps) && callComponentWillReceiveProps(workInProgress, context, nextProps, oldProps);
				hasForceUpdate = !1;
				oldState = workInProgress.memoizedState;
				context.state = oldState;
				processUpdateQueue(workInProgress, nextProps, context, renderLanes);
				suspendIfUpdateReadFromEntangledAsyncAction();
				var newState = workInProgress.memoizedState;
				contextType !== getDerivedStateFromProps || oldState !== newState || hasForceUpdate || null !== current && null !== current.dependencies && checkIfContextChanged(current.dependencies) ? ("function" === typeof unresolvedOldProps && (applyDerivedStateFromProps(workInProgress, Component, unresolvedOldProps, nextProps), newState = workInProgress.memoizedState), (contextType$jscomp$0 = hasForceUpdate || checkShouldComponentUpdate(workInProgress, Component, contextType$jscomp$0, nextProps, oldState, newState, oldProps) || null !== current && null !== current.dependencies && checkIfContextChanged(current.dependencies)) ? (oldContext || "function" !== typeof context.UNSAFE_componentWillUpdate && "function" !== typeof context.componentWillUpdate || ("function" === typeof context.componentWillUpdate && context.componentWillUpdate(nextProps, newState, oldProps), "function" === typeof context.UNSAFE_componentWillUpdate && context.UNSAFE_componentWillUpdate(nextProps, newState, oldProps)), "function" === typeof context.componentDidUpdate && (workInProgress.flags |= 4), "function" === typeof context.getSnapshotBeforeUpdate && (workInProgress.flags |= 1024)) : ("function" !== typeof context.componentDidUpdate || contextType === current.memoizedProps && oldState === current.memoizedState || (workInProgress.flags |= 4), "function" !== typeof context.getSnapshotBeforeUpdate || contextType === current.memoizedProps && oldState === current.memoizedState || (workInProgress.flags |= 1024), workInProgress.memoizedProps = nextProps, workInProgress.memoizedState = newState), context.props = nextProps, context.state = newState, context.context = oldProps, nextProps = contextType$jscomp$0) : ("function" !== typeof context.componentDidUpdate || contextType === current.memoizedProps && oldState === current.memoizedState || (workInProgress.flags |= 4), "function" !== typeof context.getSnapshotBeforeUpdate || contextType === current.memoizedProps && oldState === current.memoizedState || (workInProgress.flags |= 1024), nextProps = !1);
			}
			context = nextProps;
			markRef(current, workInProgress);
			nextProps = 0 !== (workInProgress.flags & 128);
			context || nextProps ? (context = workInProgress.stateNode, Component = nextProps && "function" !== typeof Component.getDerivedStateFromError ? null : context.render(), workInProgress.flags |= 1, null !== current && nextProps ? (workInProgress.child = reconcileChildFibers(workInProgress, current.child, null, renderLanes), workInProgress.child = reconcileChildFibers(workInProgress, null, Component, renderLanes)) : reconcileChildren(current, workInProgress, Component, renderLanes), workInProgress.memoizedState = context.state, current = workInProgress.child) : current = bailoutOnAlreadyFinishedWork(current, workInProgress, renderLanes);
			return current;
		}
		function mountHostRootWithoutHydrating(current, workInProgress, nextChildren, renderLanes) {
			resetHydrationState();
			workInProgress.flags |= 256;
			reconcileChildren(current, workInProgress, nextChildren, renderLanes);
			return workInProgress.child;
		}
		var SUSPENDED_MARKER = {
			dehydrated: null,
			treeContext: null,
			retryLane: 0,
			hydrationErrors: null
		};
		function mountSuspenseOffscreenState(renderLanes) {
			return {
				baseLanes: renderLanes,
				cachePool: getSuspendedCache()
			};
		}
		function getRemainingWorkInPrimaryTree(current, primaryTreeDidDefer, renderLanes) {
			current = null !== current ? current.childLanes & ~renderLanes : 0;
			primaryTreeDidDefer && (current |= workInProgressDeferredLane);
			return current;
		}
		function updateSuspenseComponent(current, workInProgress, renderLanes) {
			var nextProps = workInProgress.pendingProps, showFallback = !1, didSuspend = 0 !== (workInProgress.flags & 128), JSCompiler_temp;
			(JSCompiler_temp = didSuspend) || (JSCompiler_temp = null !== current && null === current.memoizedState ? !1 : 0 !== (suspenseStackCursor.current & 2));
			JSCompiler_temp && (showFallback = !0, workInProgress.flags &= -129);
			JSCompiler_temp = 0 !== (workInProgress.flags & 32);
			workInProgress.flags &= -33;
			if (null === current) {
				if (isHydrating) {
					showFallback ? pushPrimaryTreeSuspenseHandler(workInProgress) : reuseSuspenseHandlerOnStack();
					(current = nextHydratableInstance) ? (current = canHydrateHydrationBoundary(current, rootOrSingletonContext), current = null !== current && "&" !== current.data ? current : null, null !== current && (workInProgress.memoizedState = {
						dehydrated: current,
						treeContext: null !== treeContextProvider ? {
							id: treeContextId,
							overflow: treeContextOverflow
						} : null,
						retryLane: 536870912,
						hydrationErrors: null
					}, renderLanes = createFiberFromDehydratedFragment(current), renderLanes.return = workInProgress, workInProgress.child = renderLanes, hydrationParentFiber = workInProgress, nextHydratableInstance = null)) : current = null;
					if (null === current) throw throwOnHydrationMismatch(workInProgress);
					isSuspenseInstanceFallback(current) ? workInProgress.lanes = 32 : workInProgress.lanes = 536870912;
					return null;
				}
				didSuspend = nextProps.children;
				nextProps = nextProps.fallback;
				if (showFallback) return reuseSuspenseHandlerOnStack(), showFallback = workInProgress.mode, didSuspend = mountWorkInProgressOffscreenFiber({
					mode: "hidden",
					children: didSuspend
				}, showFallback), nextProps = createFiberFromFragment(nextProps, showFallback, renderLanes, null), didSuspend.return = workInProgress, nextProps.return = workInProgress, didSuspend.sibling = nextProps, workInProgress.child = didSuspend, nextProps = workInProgress.child, nextProps.memoizedState = mountSuspenseOffscreenState(renderLanes), nextProps.childLanes = getRemainingWorkInPrimaryTree(current, JSCompiler_temp, renderLanes), workInProgress.memoizedState = SUSPENDED_MARKER, bailoutOffscreenComponent(null, nextProps);
				pushPrimaryTreeSuspenseHandler(workInProgress);
				return mountSuspensePrimaryChildren(workInProgress, didSuspend);
			}
			var prevState = current.memoizedState;
			if (null !== prevState) {
				var dehydrated$96 = prevState.dehydrated;
				if (null !== dehydrated$96) return updateDehydratedSuspenseComponent(current, workInProgress, didSuspend, JSCompiler_temp, nextProps, dehydrated$96, prevState, renderLanes);
			}
			if (showFallback) return reuseSuspenseHandlerOnStack(), showFallback = nextProps.fallback, didSuspend = workInProgress.mode, prevState = current.child, dehydrated$96 = prevState.sibling, nextProps = createWorkInProgress(prevState, {
				mode: "hidden",
				children: nextProps.children
			}), nextProps.subtreeFlags = prevState.subtreeFlags & 1206910976, null !== dehydrated$96 ? showFallback = createWorkInProgress(dehydrated$96, showFallback) : (showFallback = createFiberFromFragment(showFallback, didSuspend, renderLanes, null), showFallback.flags |= 2), showFallback.return = workInProgress, nextProps.return = workInProgress, nextProps.sibling = showFallback, workInProgress.child = nextProps, bailoutOffscreenComponent(null, nextProps), nextProps = workInProgress.child, showFallback = current.child.memoizedState, null === showFallback ? showFallback = mountSuspenseOffscreenState(renderLanes) : (didSuspend = showFallback.cachePool, null !== didSuspend ? (prevState = CacheContext._currentValue, didSuspend = didSuspend.parent !== prevState ? {
				parent: prevState,
				pool: prevState
			} : didSuspend) : didSuspend = getSuspendedCache(), showFallback = {
				baseLanes: showFallback.baseLanes | renderLanes,
				cachePool: didSuspend
			}), nextProps.memoizedState = showFallback, nextProps.childLanes = getRemainingWorkInPrimaryTree(current, JSCompiler_temp, renderLanes), workInProgress.memoizedState = SUSPENDED_MARKER, bailoutOffscreenComponent(current.child, nextProps);
			pushPrimaryTreeSuspenseHandler(workInProgress);
			renderLanes = current.child;
			current = renderLanes.sibling;
			renderLanes = createWorkInProgress(renderLanes, {
				mode: "visible",
				children: nextProps.children
			});
			renderLanes.return = workInProgress;
			renderLanes.sibling = null;
			null !== current && (JSCompiler_temp = workInProgress.deletions, null === JSCompiler_temp ? (workInProgress.deletions = [current], workInProgress.flags |= 16) : JSCompiler_temp.push(current));
			workInProgress.child = renderLanes;
			workInProgress.memoizedState = null;
			return renderLanes;
		}
		function mountSuspensePrimaryChildren(workInProgress, primaryChildren) {
			primaryChildren = mountWorkInProgressOffscreenFiber({
				mode: "visible",
				children: primaryChildren
			}, workInProgress.mode);
			primaryChildren.return = workInProgress;
			return workInProgress.child = primaryChildren;
		}
		function mountWorkInProgressOffscreenFiber(offscreenProps, mode) {
			offscreenProps = createFiberImplClass(22, offscreenProps, null, mode);
			offscreenProps.lanes = 0;
			return offscreenProps;
		}
		function retrySuspenseComponentWithoutHydrating(current, workInProgress, renderLanes) {
			reconcileChildFibers(workInProgress, current.child, null, renderLanes);
			current = mountSuspensePrimaryChildren(workInProgress, workInProgress.pendingProps.children);
			current.flags |= 2;
			workInProgress.memoizedState = null;
			return current;
		}
		function updateDehydratedSuspenseComponent(current, workInProgress, didSuspend, didPrimaryChildrenDefer, nextProps, suspenseInstance, suspenseState, renderLanes) {
			if (didSuspend) {
				if (workInProgress.flags & 256) return pushPrimaryTreeSuspenseHandler(workInProgress), workInProgress.flags &= -257, retrySuspenseComponentWithoutHydrating(current, workInProgress, renderLanes);
				if (null !== workInProgress.memoizedState) return reuseSuspenseHandlerOnStack(), workInProgress.child = current.child, workInProgress.flags |= 128, null;
				reuseSuspenseHandlerOnStack();
				suspenseInstance = nextProps.fallback;
				suspenseState = workInProgress.mode;
				nextProps = mountWorkInProgressOffscreenFiber({
					mode: "visible",
					children: nextProps.children
				}, suspenseState);
				suspenseInstance = createFiberFromFragment(suspenseInstance, suspenseState, renderLanes, null);
				suspenseInstance.flags |= 2;
				nextProps.return = workInProgress;
				suspenseInstance.return = workInProgress;
				nextProps.sibling = suspenseInstance;
				workInProgress.child = nextProps;
				reconcileChildFibers(workInProgress, current.child, null, renderLanes);
				nextProps = workInProgress.child;
				nextProps.memoizedState = mountSuspenseOffscreenState(renderLanes);
				nextProps.childLanes = getRemainingWorkInPrimaryTree(current, didPrimaryChildrenDefer, renderLanes);
				workInProgress.memoizedState = SUSPENDED_MARKER;
				return bailoutOffscreenComponent(null, nextProps);
			}
			pushPrimaryTreeSuspenseHandler(workInProgress);
			if (isSuspenseInstanceFallback(suspenseInstance)) {
				didPrimaryChildrenDefer = suspenseInstance.nextSibling && suspenseInstance.nextSibling.dataset;
				if (didPrimaryChildrenDefer) var digest = didPrimaryChildrenDefer.dgst;
				didPrimaryChildrenDefer = digest;
				"" !== didPrimaryChildrenDefer && (nextProps = Error(formatProdErrorMessage(419)), nextProps.stack = "", nextProps.digest = didPrimaryChildrenDefer, queueHydrationError({
					value: nextProps,
					source: null,
					stack: null
				}));
				return retrySuspenseComponentWithoutHydrating(current, workInProgress, renderLanes);
			}
			didReceiveUpdate || propagateParentContextChanges(current, workInProgress, renderLanes, !1);
			didPrimaryChildrenDefer = 0 !== (renderLanes & current.childLanes);
			if (didReceiveUpdate || didPrimaryChildrenDefer) {
				if (null !== currentTreeHiddenStackCursor.current) return retrySuspenseComponentWithoutHydrating(current, workInProgress, renderLanes);
				didPrimaryChildrenDefer = workInProgressRoot;
				if (null !== didPrimaryChildrenDefer && (nextProps = getBumpedLaneForHydration(didPrimaryChildrenDefer, renderLanes), 0 !== nextProps && nextProps !== suspenseState.retryLane)) throw suspenseState.retryLane = nextProps, enqueueConcurrentRenderForLane(current, nextProps), scheduleUpdateOnFiber(didPrimaryChildrenDefer, current, nextProps), SelectiveHydrationException;
				isSuspenseInstancePending(suspenseInstance) || renderDidSuspendDelayIfPossible();
				return retrySuspenseComponentWithoutHydrating(current, workInProgress, renderLanes);
			}
			if (isSuspenseInstancePending(suspenseInstance)) return workInProgress.flags |= 192, workInProgress.child = current.child, null;
			current = suspenseState.treeContext;
			nextHydratableInstance = getNextHydratable(suspenseInstance.nextSibling);
			hydrationParentFiber = workInProgress;
			isHydrating = !0;
			hydrationErrors = null;
			rootOrSingletonContext = !1;
			null !== current && restoreSuspendedTreeContext(workInProgress, current);
			workInProgress = mountSuspensePrimaryChildren(workInProgress, nextProps.children);
			workInProgress.flags |= 134221824;
			return workInProgress;
		}
		function scheduleSuspenseWorkOnFiber(fiber, renderLanes, propagationRoot) {
			fiber.lanes |= renderLanes;
			var alternate = fiber.alternate;
			null !== alternate && (alternate.lanes |= renderLanes);
			scheduleContextWorkOnParentPath(fiber.return, renderLanes, propagationRoot);
		}
		function findLastContentRow(firstChild) {
			for (var lastContentRow = null; null !== firstChild;) {
				var currentRow = firstChild.alternate;
				null !== currentRow && null === findFirstSuspended(currentRow) && (lastContentRow = firstChild);
				firstChild = firstChild.sibling;
			}
			return lastContentRow;
		}
		function initSuspenseListRenderState(workInProgress, isBackwards, tail, lastContentRow, tailMode, treeForkCount) {
			var renderState = workInProgress.memoizedState;
			null === renderState ? workInProgress.memoizedState = {
				isBackwards,
				rendering: null,
				renderingStartTime: 0,
				last: lastContentRow,
				tail,
				tailMode,
				treeForkCount
			} : (renderState.isBackwards = isBackwards, renderState.rendering = null, renderState.renderingStartTime = 0, renderState.last = lastContentRow, renderState.tail = tail, renderState.tailMode = tailMode, renderState.treeForkCount = treeForkCount);
		}
		function reverseChildren(fiber) {
			var row = fiber.child;
			for (fiber.child = null; null !== row;) {
				var nextRow = row.sibling;
				row.sibling = fiber.child;
				fiber.child = row;
				row = nextRow;
			}
		}
		function updateSuspenseListComponent(current, workInProgress, renderLanes) {
			var nextProps = workInProgress.pendingProps, revealOrder = nextProps.revealOrder, tailMode = nextProps.tail;
			nextProps = nextProps.children;
			var suspenseContext = suspenseStackCursor.current;
			if (workInProgress.flags & 128) return pushSuspenseListContext(workInProgress, suspenseContext), null;
			var shouldForceFallback = 0 !== (suspenseContext & 2);
			shouldForceFallback ? (suspenseContext = suspenseContext & 1 | 2, workInProgress.flags |= 128) : suspenseContext &= 1;
			pushSuspenseListContext(workInProgress, suspenseContext);
			"backwards" === revealOrder && null !== current ? (reverseChildren(current), reconcileChildren(current, workInProgress, nextProps, renderLanes), reverseChildren(current)) : reconcileChildren(current, workInProgress, nextProps, renderLanes);
			nextProps = isHydrating ? treeForkCount : 0;
			if (!shouldForceFallback && null !== current && 0 !== (current.flags & 128)) a: for (current = workInProgress.child; null !== current;) {
				if (13 === current.tag) null !== current.memoizedState && scheduleSuspenseWorkOnFiber(current, renderLanes, workInProgress);
				else if (19 === current.tag) scheduleSuspenseWorkOnFiber(current, renderLanes, workInProgress);
				else if (null !== current.child) {
					current.child.return = current;
					current = current.child;
					continue;
				}
				if (current === workInProgress) break a;
				for (; null === current.sibling;) {
					if (null === current.return || current.return === workInProgress) break a;
					current = current.return;
				}
				current.sibling.return = current.return;
				current = current.sibling;
			}
			switch (revealOrder) {
				case "backwards":
					renderLanes = findLastContentRow(workInProgress.child);
					null === renderLanes ? (revealOrder = workInProgress.child, workInProgress.child = null) : (revealOrder = renderLanes.sibling, renderLanes.sibling = null, reverseChildren(workInProgress));
					initSuspenseListRenderState(workInProgress, !0, revealOrder, null, tailMode, nextProps);
					break;
				case "unstable_legacy-backwards":
					renderLanes = null;
					revealOrder = workInProgress.child;
					for (workInProgress.child = null; null !== revealOrder;) {
						current = revealOrder.alternate;
						if (null !== current && null === findFirstSuspended(current)) {
							workInProgress.child = revealOrder;
							break;
						}
						current = revealOrder.sibling;
						revealOrder.sibling = renderLanes;
						renderLanes = revealOrder;
						revealOrder = current;
					}
					initSuspenseListRenderState(workInProgress, !0, renderLanes, null, tailMode, nextProps);
					break;
				case "together":
					initSuspenseListRenderState(workInProgress, !1, null, null, void 0, nextProps);
					break;
				case "independent":
					workInProgress.memoizedState = null;
					break;
				default: renderLanes = findLastContentRow(workInProgress.child), null === renderLanes ? (revealOrder = workInProgress.child, workInProgress.child = null) : (revealOrder = renderLanes.sibling, renderLanes.sibling = null), initSuspenseListRenderState(workInProgress, !1, revealOrder, renderLanes, tailMode, nextProps);
			}
			return workInProgress.child;
		}
		function updateContextProvider(current, workInProgress, renderLanes) {
			var newProps = workInProgress.pendingProps;
			pushProvider(workInProgress, workInProgress.type, newProps.value);
			reconcileChildren(current, workInProgress, newProps.children, renderLanes);
			return workInProgress.child;
		}
		function bailoutOnAlreadyFinishedWork(current, workInProgress, renderLanes) {
			null !== current && (workInProgress.dependencies = current.dependencies);
			workInProgressRootSkippedLanes |= workInProgress.lanes;
			if (0 === (renderLanes & workInProgress.childLanes)) if (null !== current) {
				if (propagateParentContextChanges(current, workInProgress, renderLanes, !1), 0 === (renderLanes & workInProgress.childLanes)) return null;
			} else return null;
			if (null !== current && workInProgress.child !== current.child) throw Error(formatProdErrorMessage(153));
			if (null !== workInProgress.child) {
				current = workInProgress.child;
				renderLanes = createWorkInProgress(current, current.pendingProps);
				workInProgress.child = renderLanes;
				for (renderLanes.return = workInProgress; null !== current.sibling;) current = current.sibling, renderLanes = renderLanes.sibling = createWorkInProgress(current, current.pendingProps), renderLanes.return = workInProgress;
				renderLanes.sibling = null;
			}
			return workInProgress.child;
		}
		function checkScheduledUpdateOrContext(current, renderLanes) {
			if (0 !== (current.lanes & renderLanes)) return !0;
			current = current.dependencies;
			return null !== current && checkIfContextChanged(current) ? !0 : !1;
		}
		function attemptEarlyBailoutIfNoScheduledUpdate(current, workInProgress, renderLanes) {
			switch (workInProgress.tag) {
				case 3:
					pushHostContainer(workInProgress, workInProgress.stateNode.containerInfo);
					pushProvider(workInProgress, CacheContext, current.memoizedState.cache);
					resetHydrationState();
					break;
				case 27:
				case 5:
					pushHostContext(workInProgress);
					break;
				case 4:
					pushHostContainer(workInProgress, workInProgress.stateNode.containerInfo);
					break;
				case 10:
					pushProvider(workInProgress, workInProgress.type, workInProgress.memoizedProps.value);
					break;
				case 31:
					if (null !== workInProgress.memoizedState) return workInProgress.flags |= 128, pushDehydratedActivitySuspenseHandler(workInProgress), null;
					break;
				case 13:
					var state$108 = workInProgress.memoizedState;
					if (null !== state$108) {
						if (null !== state$108.dehydrated) return pushPrimaryTreeSuspenseHandler(workInProgress), workInProgress.flags |= 128, null;
						state$108 = propagateParentContextChanges(current, workInProgress, renderLanes, !1);
						var primaryChildLanes = workInProgress.child.childLanes;
						if (state$108 || 0 !== (renderLanes & primaryChildLanes)) return updateSuspenseComponent(current, workInProgress, renderLanes);
						pushPrimaryTreeSuspenseHandler(workInProgress);
						current = bailoutOnAlreadyFinishedWork(current, workInProgress, renderLanes);
						return null !== current ? current.sibling : null;
					}
					pushPrimaryTreeSuspenseHandler(workInProgress);
					break;
				case 19:
					if (workInProgress.flags & 128) return updateSuspenseListComponent(current, workInProgress, renderLanes);
					primaryChildLanes = 0 !== (current.flags & 128);
					state$108 = 0 !== (renderLanes & workInProgress.childLanes);
					state$108 || (propagateParentContextChanges(current, workInProgress, renderLanes, !1), state$108 = 0 !== (renderLanes & workInProgress.childLanes));
					if (primaryChildLanes) {
						if (state$108) return updateSuspenseListComponent(current, workInProgress, renderLanes);
						workInProgress.flags |= 128;
					}
					primaryChildLanes = workInProgress.memoizedState;
					null !== primaryChildLanes && (primaryChildLanes.rendering = null, primaryChildLanes.tail = null, primaryChildLanes.lastEffect = null);
					pushSuspenseListContext(workInProgress, suspenseStackCursor.current);
					if (state$108) break;
					else return null;
				case 22: return workInProgress.lanes = 0, updateOffscreenComponent(current, workInProgress, renderLanes, workInProgress.pendingProps);
				case 24: pushProvider(workInProgress, CacheContext, current.memoizedState.cache);
			}
			return bailoutOnAlreadyFinishedWork(current, workInProgress, renderLanes);
		}
		function beginWork(current, workInProgress, renderLanes) {
			if (null !== current) if (current.memoizedProps !== workInProgress.pendingProps) didReceiveUpdate = !0;
			else {
				if (!checkScheduledUpdateOrContext(current, renderLanes) && 0 === (workInProgress.flags & 128)) return didReceiveUpdate = !1, attemptEarlyBailoutIfNoScheduledUpdate(current, workInProgress, renderLanes);
				didReceiveUpdate = 0 !== (current.flags & 131072) ? !0 : !1;
			}
			else didReceiveUpdate = !1, isHydrating && 0 !== (workInProgress.flags & 1048576) && pushTreeId(workInProgress, treeForkCount, workInProgress.index);
			workInProgress.lanes = 0;
			switch (workInProgress.tag) {
				case 16:
					a: {
						var props = workInProgress.pendingProps;
						current = resolveLazy(workInProgress.elementType);
						workInProgress.type = current;
						if ("function" === typeof current) shouldConstruct(current) ? (props = resolveClassComponentProps(current, props), workInProgress.tag = 1, workInProgress = updateClassComponent(null, workInProgress, current, props, renderLanes)) : (workInProgress.tag = 0, workInProgress = updateFunctionComponent(null, workInProgress, current, props, renderLanes));
						else {
							if (void 0 !== current && null !== current) {
								var $$typeof = current.$$typeof;
								if ($$typeof === REACT_FORWARD_REF_TYPE) {
									workInProgress.tag = 11;
									workInProgress = updateForwardRef(null, workInProgress, current, props, renderLanes);
									break a;
								} else if ($$typeof === REACT_MEMO_TYPE) {
									workInProgress.tag = 14;
									workInProgress = updateMemoComponent(null, workInProgress, current, props, renderLanes);
									break a;
								} else if ($$typeof === REACT_CONTEXT_TYPE) {
									workInProgress.tag = 10;
									workInProgress.type = current;
									workInProgress = updateContextProvider(null, workInProgress, renderLanes);
									break a;
								}
							}
							workInProgress = getComponentNameFromType(current) || current;
							throw Error(formatProdErrorMessage(306, workInProgress, ""));
						}
					}
					return workInProgress;
				case 0: return updateFunctionComponent(current, workInProgress, workInProgress.type, workInProgress.pendingProps, renderLanes);
				case 1: return props = workInProgress.type, $$typeof = resolveClassComponentProps(props, workInProgress.pendingProps), updateClassComponent(current, workInProgress, props, $$typeof, renderLanes);
				case 3:
					a: {
						pushHostContainer(workInProgress, workInProgress.stateNode.containerInfo);
						if (null === current) throw Error(formatProdErrorMessage(387));
						props = workInProgress.pendingProps;
						var prevState = workInProgress.memoizedState;
						$$typeof = prevState.element;
						cloneUpdateQueue(current, workInProgress);
						processUpdateQueue(workInProgress, props, null, renderLanes);
						var nextState = workInProgress.memoizedState;
						props = nextState.cache;
						pushProvider(workInProgress, CacheContext, props);
						props !== prevState.cache && propagateContextChanges(workInProgress, [CacheContext], renderLanes, !0);
						suspendIfUpdateReadFromEntangledAsyncAction();
						props = nextState.element;
						if (prevState.isDehydrated) if (prevState = {
							element: props,
							isDehydrated: !1,
							cache: nextState.cache
						}, workInProgress.updateQueue.baseState = prevState, workInProgress.memoizedState = prevState, workInProgress.flags & 256) {
							workInProgress = mountHostRootWithoutHydrating(current, workInProgress, props, renderLanes);
							break a;
						} else if (props !== $$typeof) {
							$$typeof = createCapturedValueAtFiber(Error(formatProdErrorMessage(424)), workInProgress);
							queueHydrationError($$typeof);
							workInProgress = mountHostRootWithoutHydrating(current, workInProgress, props, renderLanes);
							break a;
						} else {
							current = workInProgress.stateNode.containerInfo;
							switch (current.nodeType) {
								case 9:
									current = current.body;
									break;
								default: current = "HTML" === current.nodeName ? current.ownerDocument.body : current;
							}
							nextHydratableInstance = getNextHydratable(current.firstChild);
							hydrationParentFiber = workInProgress;
							isHydrating = !0;
							hydrationErrors = null;
							rootOrSingletonContext = !0;
							renderLanes = mountChildFibers(workInProgress, null, props, renderLanes);
							for (workInProgress.child = renderLanes; renderLanes;) renderLanes.flags = renderLanes.flags & -3 | 134221824, renderLanes = renderLanes.sibling;
						}
						else {
							resetHydrationState();
							if (props === $$typeof) {
								workInProgress = bailoutOnAlreadyFinishedWork(current, workInProgress, renderLanes);
								break a;
							}
							reconcileChildren(current, workInProgress, props, renderLanes);
						}
						workInProgress = workInProgress.child;
					}
					return workInProgress;
				case 26: return markRef(current, workInProgress), null === current ? (renderLanes = getResource(workInProgress.type, null, workInProgress.pendingProps, null)) ? workInProgress.memoizedState = renderLanes : isHydrating || (workInProgress.stateNode = createHoistableInstance(workInProgress.type, workInProgress.pendingProps, rootInstanceStackCursor.current, workInProgress)) : workInProgress.memoizedState = getResource(workInProgress.type, current.memoizedProps, workInProgress.pendingProps, current.memoizedState), null;
				case 27: return pushHostContext(workInProgress), null === current && isHydrating && (props = workInProgress.stateNode = resolveSingletonInstance(workInProgress.type, workInProgress.pendingProps, rootInstanceStackCursor.current), hydrationParentFiber = workInProgress, rootOrSingletonContext = !0, $$typeof = nextHydratableInstance, isSingletonScope(workInProgress.type) ? (previousHydratableOnEnteringScopedSingleton = $$typeof, nextHydratableInstance = getNextHydratable(props.firstChild)) : nextHydratableInstance = $$typeof), reconcileChildren(current, workInProgress, workInProgress.pendingProps.children, renderLanes), markRef(current, workInProgress), null === current && (workInProgress.flags |= 4194304), workInProgress.child;
				case 5:
					if (null === current && isHydrating) {
						if ($$typeof = props = nextHydratableInstance) props = canHydrateInstance(props, workInProgress.type, workInProgress.pendingProps, rootOrSingletonContext), null !== props ? (workInProgress.stateNode = props, hydrationParentFiber = workInProgress, nextHydratableInstance = getNextHydratable(props.firstChild), rootOrSingletonContext = !1, $$typeof = !0) : $$typeof = !1;
						$$typeof || throwOnHydrationMismatch(workInProgress);
					}
					pushHostContext(workInProgress);
					$$typeof = workInProgress.type;
					prevState = workInProgress.pendingProps;
					nextState = null !== current ? current.memoizedProps : null;
					props = prevState.children;
					shouldSetTextContent($$typeof, prevState) ? props = null : null !== nextState && shouldSetTextContent($$typeof, nextState) && (workInProgress.flags |= 32);
					null !== workInProgress.memoizedState && ($$typeof = renderWithHooks(current, workInProgress, TransitionAwareHostComponent, null, null, renderLanes), HostTransitionContext._currentValue = $$typeof);
					markRef(current, workInProgress);
					reconcileChildren(current, workInProgress, props, renderLanes);
					return workInProgress.child;
				case 6:
					if (null === current && isHydrating) {
						if (current = renderLanes = nextHydratableInstance) renderLanes = canHydrateTextInstance(renderLanes, workInProgress.pendingProps, rootOrSingletonContext), null !== renderLanes ? (workInProgress.stateNode = renderLanes, hydrationParentFiber = workInProgress, nextHydratableInstance = null, current = !0) : current = !1;
						current || throwOnHydrationMismatch(workInProgress);
					}
					return null;
				case 13: return updateSuspenseComponent(current, workInProgress, renderLanes);
				case 4: return pushHostContainer(workInProgress, workInProgress.stateNode.containerInfo), props = workInProgress.pendingProps, null === current ? workInProgress.child = reconcileChildFibers(workInProgress, null, props, renderLanes) : reconcileChildren(current, workInProgress, props, renderLanes), workInProgress.child;
				case 11: return updateForwardRef(current, workInProgress, workInProgress.type, workInProgress.pendingProps, renderLanes);
				case 7: return props = workInProgress.pendingProps, markRef(current, workInProgress), reconcileChildren(current, workInProgress, props, renderLanes), workInProgress.child;
				case 8: return reconcileChildren(current, workInProgress, workInProgress.pendingProps.children, renderLanes), workInProgress.child;
				case 12: return reconcileChildren(current, workInProgress, workInProgress.pendingProps.children, renderLanes), workInProgress.child;
				case 10: return updateContextProvider(current, workInProgress, renderLanes);
				case 9: return $$typeof = workInProgress.type._context, props = workInProgress.pendingProps.children, prepareToReadContext(workInProgress), $$typeof = readContext($$typeof), props = props($$typeof), workInProgress.flags |= 1, reconcileChildren(current, workInProgress, props, renderLanes), workInProgress.child;
				case 14: return updateMemoComponent(current, workInProgress, workInProgress.type, workInProgress.pendingProps, renderLanes);
				case 15: return updateSimpleMemoComponent(current, workInProgress, workInProgress.type, workInProgress.pendingProps, renderLanes);
				case 19: return updateSuspenseListComponent(current, workInProgress, renderLanes);
				case 31: return updateActivityComponent(current, workInProgress, renderLanes);
				case 22: return updateOffscreenComponent(current, workInProgress, renderLanes, workInProgress.pendingProps);
				case 24: return prepareToReadContext(workInProgress), props = readContext(CacheContext), null === current ? ($$typeof = peekCacheFromPool(), null === $$typeof && ($$typeof = workInProgressRoot, prevState = createCache(), $$typeof.pooledCache = prevState, prevState.refCount++, null !== prevState && ($$typeof.pooledCacheLanes |= renderLanes), $$typeof = prevState), workInProgress.memoizedState = {
					parent: props,
					cache: $$typeof
				}, initializeUpdateQueue(workInProgress), pushProvider(workInProgress, CacheContext, $$typeof)) : (0 !== (current.lanes & renderLanes) && (cloneUpdateQueue(current, workInProgress), processUpdateQueue(workInProgress, null, null, renderLanes), suspendIfUpdateReadFromEntangledAsyncAction()), $$typeof = current.memoizedState, prevState = workInProgress.memoizedState, $$typeof.parent !== props ? ($$typeof = {
					parent: props,
					cache: props
				}, workInProgress.memoizedState = $$typeof, 0 === workInProgress.lanes && (workInProgress.memoizedState = workInProgress.updateQueue.baseState = $$typeof), pushProvider(workInProgress, CacheContext, props)) : (props = prevState.cache, pushProvider(workInProgress, CacheContext, props), props !== $$typeof.cache && propagateContextChanges(workInProgress, [CacheContext], renderLanes, !0))), reconcileChildren(current, workInProgress, workInProgress.pendingProps.children, renderLanes), workInProgress.child;
				case 30: return null === workInProgress.stateNode && (workInProgress.stateNode = {
					autoName: null,
					paired: null,
					clones: null,
					ref: null
				}), props = workInProgress.pendingProps, null != props.name && "auto" !== props.name ? workInProgress.flags |= null === current ? 18882560 : 18874368 : isHydrating && pushMaterializedTreeId(workInProgress), null !== current && current.memoizedProps.name !== props.name ? workInProgress.flags |= 4194816 : markRef(current, workInProgress), reconcileChildren(current, workInProgress, props.children, renderLanes), workInProgress.child;
				case 29: throw workInProgress.pendingProps;
			}
			throw Error(formatProdErrorMessage(156, workInProgress.tag));
		}
		function markUpdate(workInProgress) {
			workInProgress.flags |= 4;
		}
		function preloadInstanceAndSuspendIfNeeded(workInProgress, type, oldProps, newProps, renderLanes) {
			var JSCompiler_temp;
			if (JSCompiler_temp = 0 !== (workInProgress.mode & 32)) JSCompiler_temp = null === oldProps ? maySuspendCommit(type, newProps) : maySuspendCommit(type, newProps) && (newProps.src !== oldProps.src || newProps.srcSet !== oldProps.srcSet);
			if (JSCompiler_temp) {
				if (workInProgress.flags |= 16777216, (renderLanes & 335544128) === renderLanes) if (workInProgress.stateNode.complete) workInProgress.flags |= 8192;
				else if (shouldRemainOnPreviousScreen()) workInProgress.flags |= 8192;
				else throw suspendedThenable = noopSuspenseyCommitThenable, SuspenseyCommitException;
			} else workInProgress.flags &= -16777217;
		}
		function preloadResourceAndSuspendIfNeeded(workInProgress, resource) {
			if ("stylesheet" !== resource.type || 0 !== (resource.state.loading & 4)) workInProgress.flags &= -16777217;
			else if (workInProgress.flags |= 16777216, !preloadResource(resource)) if (shouldRemainOnPreviousScreen()) workInProgress.flags |= 8192;
			else throw suspendedThenable = noopSuspenseyCommitThenable, SuspenseyCommitException;
		}
		function scheduleRetryEffect(workInProgress, retryQueue) {
			null !== retryQueue && (workInProgress.flags |= 4);
			workInProgress.flags & 16384 && (retryQueue = 22 !== workInProgress.tag ? claimNextRetryLane() : 536870912, workInProgress.lanes |= retryQueue, workInProgressSuspendedRetryLanes |= retryQueue);
		}
		function cutOffTailIfNeeded(renderState, hasRenderedATailFallback) {
			if (!isHydrating) switch (renderState.tailMode) {
				case "visible": break;
				case "collapsed":
					for (var tailNode = renderState.tail, lastTailNode = null; null !== tailNode;) null !== tailNode.alternate && (lastTailNode = tailNode), tailNode = tailNode.sibling;
					null === lastTailNode ? hasRenderedATailFallback || null === renderState.tail ? renderState.tail = null : renderState.tail.sibling = null : lastTailNode.sibling = null;
					break;
				default:
					hasRenderedATailFallback = renderState.tail;
					for (tailNode = null; null !== hasRenderedATailFallback;) null !== hasRenderedATailFallback.alternate && (tailNode = hasRenderedATailFallback), hasRenderedATailFallback = hasRenderedATailFallback.sibling;
					null === tailNode ? renderState.tail = null : tailNode.sibling = null;
			}
		}
		function bubbleProperties(completedWork) {
			var didBailout = null !== completedWork.alternate && completedWork.alternate.child === completedWork.child, newChildLanes = 0, subtreeFlags = 0;
			if (didBailout) for (var child$113 = completedWork.child; null !== child$113;) newChildLanes |= child$113.lanes | child$113.childLanes, subtreeFlags |= child$113.subtreeFlags & 1206910976, subtreeFlags |= child$113.flags & 1206910976, child$113.return = completedWork, child$113 = child$113.sibling;
			else for (child$113 = completedWork.child; null !== child$113;) newChildLanes |= child$113.lanes | child$113.childLanes, subtreeFlags |= child$113.subtreeFlags, subtreeFlags |= child$113.flags, child$113.return = completedWork, child$113 = child$113.sibling;
			completedWork.subtreeFlags |= subtreeFlags;
			completedWork.childLanes = newChildLanes;
			return didBailout;
		}
		function completeWork(current, workInProgress, renderLanes) {
			var newProps = workInProgress.pendingProps;
			popTreeContext(workInProgress);
			switch (workInProgress.tag) {
				case 16:
				case 15:
				case 0:
				case 11:
				case 7:
				case 8:
				case 12:
				case 9:
				case 14: return bubbleProperties(workInProgress), null;
				case 1: return bubbleProperties(workInProgress), null;
				case 3:
					renderLanes = workInProgress.stateNode;
					newProps = null;
					null !== current && (newProps = current.memoizedState.cache);
					workInProgress.memoizedState.cache !== newProps && (workInProgress.flags |= 2048);
					popProvider(CacheContext);
					popHostContainer();
					renderLanes.pendingContext && (renderLanes.context = renderLanes.pendingContext, renderLanes.pendingContext = null);
					if (null === current || null === current.child) popHydrationState(workInProgress) ? markUpdate(workInProgress) : null === current || current.memoizedState.isDehydrated && 0 === (workInProgress.flags & 256) || (workInProgress.flags |= 1024, upgradeHydrationErrorsToRecoverable());
					bubbleProperties(workInProgress);
					return null;
				case 26:
					var type = workInProgress.type, nextResource = workInProgress.memoizedState;
					null === current ? (markUpdate(workInProgress), null !== nextResource ? (bubbleProperties(workInProgress), preloadResourceAndSuspendIfNeeded(workInProgress, nextResource)) : (bubbleProperties(workInProgress), preloadInstanceAndSuspendIfNeeded(workInProgress, type, null, newProps, renderLanes))) : nextResource ? nextResource !== current.memoizedState ? (markUpdate(workInProgress), bubbleProperties(workInProgress), preloadResourceAndSuspendIfNeeded(workInProgress, nextResource)) : (bubbleProperties(workInProgress), workInProgress.flags &= -16777217) : (current = current.memoizedProps, current !== newProps && markUpdate(workInProgress), bubbleProperties(workInProgress), preloadInstanceAndSuspendIfNeeded(workInProgress, type, current, newProps, renderLanes));
					return null;
				case 27:
					popHostContext(workInProgress);
					renderLanes = rootInstanceStackCursor.current;
					type = workInProgress.type;
					if (null !== current && null != workInProgress.stateNode) current.memoizedProps !== newProps && markUpdate(workInProgress);
					else {
						if (!newProps) {
							if (null === workInProgress.stateNode) throw Error(formatProdErrorMessage(166));
							bubbleProperties(workInProgress);
							workInProgress.subtreeFlags &= -33554433;
							return null;
						}
						current = contextStackCursor.current;
						popHydrationState(workInProgress) ? prepareToHydrateHostInstance(workInProgress, current) : (current = resolveSingletonInstance(type, newProps, renderLanes), workInProgress.stateNode = current, markUpdate(workInProgress));
					}
					bubbleProperties(workInProgress);
					workInProgress.subtreeFlags &= -33554433;
					return null;
				case 5:
					popHostContext(workInProgress);
					type = workInProgress.type;
					if (null !== current && null != workInProgress.stateNode) current.memoizedProps !== newProps && markUpdate(workInProgress);
					else {
						if (!newProps) {
							if (null === workInProgress.stateNode) throw Error(formatProdErrorMessage(166));
							bubbleProperties(workInProgress);
							workInProgress.subtreeFlags &= -33554433;
							return null;
						}
						nextResource = contextStackCursor.current;
						if (popHydrationState(workInProgress)) prepareToHydrateHostInstance(workInProgress, nextResource);
						else {
							var ownerDocument = getOwnerDocumentFromRootContainer(rootInstanceStackCursor.current);
							switch (nextResource) {
								case 1:
									nextResource = ownerDocument.createElementNS("http://www.w3.org/2000/svg", type);
									break;
								case 2:
									nextResource = ownerDocument.createElementNS("http://www.w3.org/1998/Math/MathML", type);
									break;
								default: switch (type) {
									case "svg":
										nextResource = ownerDocument.createElementNS("http://www.w3.org/2000/svg", type);
										break;
									case "math":
										nextResource = ownerDocument.createElementNS("http://www.w3.org/1998/Math/MathML", type);
										break;
									case "script":
										nextResource = ownerDocument.createElement("div");
										nextResource.innerHTML = "<script><\/script>";
										nextResource = nextResource.removeChild(nextResource.firstChild);
										break;
									case "select":
										nextResource = "string" === typeof newProps.is ? ownerDocument.createElement("select", { is: newProps.is }) : ownerDocument.createElement("select");
										newProps.multiple ? nextResource.multiple = !0 : newProps.size && (nextResource.size = newProps.size);
										break;
									default: nextResource = "string" === typeof newProps.is ? ownerDocument.createElement(type, { is: newProps.is }) : ownerDocument.createElement(type);
								}
							}
							nextResource[internalInstanceKey] = workInProgress;
							nextResource[internalPropsKey] = newProps;
							a: for (ownerDocument = workInProgress.child; null !== ownerDocument;) {
								if (5 === ownerDocument.tag || 6 === ownerDocument.tag) nextResource.appendChild(ownerDocument.stateNode);
								else if (4 !== ownerDocument.tag && 27 !== ownerDocument.tag && null !== ownerDocument.child) {
									ownerDocument.child.return = ownerDocument;
									ownerDocument = ownerDocument.child;
									continue;
								}
								if (ownerDocument === workInProgress) break a;
								for (; null === ownerDocument.sibling;) {
									if (null === ownerDocument.return || ownerDocument.return === workInProgress) break a;
									ownerDocument = ownerDocument.return;
								}
								ownerDocument.sibling.return = ownerDocument.return;
								ownerDocument = ownerDocument.sibling;
							}
							workInProgress.stateNode = nextResource;
							a: switch (setInitialProperties(nextResource, type, newProps), type) {
								case "button":
								case "input":
								case "select":
								case "textarea":
									newProps = !!newProps.autoFocus;
									break a;
								case "img":
									newProps = !0;
									break a;
								default: newProps = !1;
							}
							newProps && markUpdate(workInProgress);
						}
					}
					bubbleProperties(workInProgress);
					workInProgress.subtreeFlags &= -33554433;
					preloadInstanceAndSuspendIfNeeded(workInProgress, workInProgress.type, null === current ? null : current.memoizedProps, workInProgress.pendingProps, renderLanes);
					return null;
				case 6:
					if (current && null != workInProgress.stateNode) current.memoizedProps !== newProps && markUpdate(workInProgress);
					else {
						if ("string" !== typeof newProps && null === workInProgress.stateNode) throw Error(formatProdErrorMessage(166));
						current = rootInstanceStackCursor.current;
						if (popHydrationState(workInProgress)) {
							current = workInProgress.stateNode;
							renderLanes = workInProgress.memoizedProps;
							newProps = null;
							type = hydrationParentFiber;
							if (null !== type) switch (type.tag) {
								case 27:
								case 5: newProps = type.memoizedProps;
							}
							current[internalInstanceKey] = workInProgress;
							current = current.nodeValue === renderLanes || null !== newProps && !0 === newProps.suppressHydrationWarning || checkForUnmatchedText(current.nodeValue, renderLanes) ? !0 : !1;
							current || throwOnHydrationMismatch(workInProgress, !0);
						} else current = getOwnerDocumentFromRootContainer(current).createTextNode(newProps), current[internalInstanceKey] = workInProgress, workInProgress.stateNode = current;
					}
					bubbleProperties(workInProgress);
					return null;
				case 31:
					renderLanes = workInProgress.memoizedState;
					if (null === current || null !== current.memoizedState) {
						newProps = popHydrationState(workInProgress);
						if (null !== renderLanes) {
							if (null === current) {
								if (!newProps) throw Error(formatProdErrorMessage(318));
								current = workInProgress.memoizedState;
								current = null !== current ? current.dehydrated : null;
								if (!current) throw Error(formatProdErrorMessage(557));
								current[internalInstanceKey] = workInProgress;
							} else resetHydrationState(), 0 === (workInProgress.flags & 128) && (workInProgress.memoizedState = null), workInProgress.flags |= 4;
							bubbleProperties(workInProgress);
							current = !1;
						} else renderLanes = upgradeHydrationErrorsToRecoverable(), null !== current && null !== current.memoizedState && (current.memoizedState.hydrationErrors = renderLanes), current = !0;
						if (!current) {
							if (workInProgress.flags & 256) return popSuspenseHandler(workInProgress), workInProgress;
							popSuspenseHandler(workInProgress);
							return null;
						}
						if (0 !== (workInProgress.flags & 128)) throw Error(formatProdErrorMessage(558));
					}
					bubbleProperties(workInProgress);
					return null;
				case 13:
					newProps = workInProgress.memoizedState;
					if (null === current || null !== current.memoizedState && null !== current.memoizedState.dehydrated) {
						type = popHydrationState(workInProgress);
						if (null !== newProps && null !== newProps.dehydrated) {
							if (null === current) {
								if (!type) throw Error(formatProdErrorMessage(318));
								type = workInProgress.memoizedState;
								type = null !== type ? type.dehydrated : null;
								if (!type) throw Error(formatProdErrorMessage(317));
								type[internalInstanceKey] = workInProgress;
							} else resetHydrationState(), 0 === (workInProgress.flags & 128) && (workInProgress.memoizedState = null), workInProgress.flags |= 4;
							bubbleProperties(workInProgress);
							type = !1;
						} else type = upgradeHydrationErrorsToRecoverable(), null !== current && null !== current.memoizedState && (current.memoizedState.hydrationErrors = type), type = !0;
						if (!type) {
							if (workInProgress.flags & 256) return popSuspenseHandler(workInProgress), workInProgress;
							popSuspenseHandler(workInProgress);
							return null;
						}
					}
					popSuspenseHandler(workInProgress);
					if (0 !== (workInProgress.flags & 128)) return workInProgress.lanes = renderLanes, workInProgress;
					renderLanes = null !== newProps;
					current = null !== current && null !== current.memoizedState;
					renderLanes && (newProps = workInProgress.child, type = null, null !== newProps.alternate && null !== newProps.alternate.memoizedState && null !== newProps.alternate.memoizedState.cachePool && (type = newProps.alternate.memoizedState.cachePool.pool), nextResource = null, null !== newProps.memoizedState && null !== newProps.memoizedState.cachePool && (nextResource = newProps.memoizedState.cachePool.pool), nextResource !== type && (newProps.flags |= 2048));
					renderLanes !== current && renderLanes && (workInProgress.child.flags |= 8192);
					scheduleRetryEffect(workInProgress, workInProgress.updateQueue);
					bubbleProperties(workInProgress);
					return null;
				case 4: return popHostContainer(), null === current && listenToAllSupportedEvents(workInProgress.stateNode.containerInfo), workInProgress.flags |= 67108864, bubbleProperties(workInProgress), null;
				case 10: return popProvider(workInProgress.type), bubbleProperties(workInProgress), null;
				case 19:
					popSuspenseListContext(workInProgress);
					newProps = workInProgress.memoizedState;
					if (null === newProps) return bubbleProperties(workInProgress), null;
					type = 0 !== (workInProgress.flags & 128);
					nextResource = newProps.rendering;
					if (null === nextResource) if (type) cutOffTailIfNeeded(newProps, !1);
					else {
						if (0 !== workInProgressRootExitStatus || null !== current && 0 !== (current.flags & 128)) for (current = workInProgress.child; null !== current;) {
							nextResource = findFirstSuspended(current);
							if (null !== nextResource) {
								workInProgress.flags |= 128;
								cutOffTailIfNeeded(newProps, !1);
								current = nextResource.updateQueue;
								workInProgress.updateQueue = current;
								scheduleRetryEffect(workInProgress, current);
								workInProgress.subtreeFlags = 0;
								current = renderLanes;
								for (renderLanes = workInProgress.child; null !== renderLanes;) resetWorkInProgress(renderLanes, current), renderLanes = renderLanes.sibling;
								pushSuspenseListContext(workInProgress, suspenseStackCursor.current & 1 | 2);
								isHydrating && pushTreeFork(workInProgress, newProps.treeForkCount);
								return workInProgress.child;
							}
							current = current.sibling;
						}
						null !== newProps.tail && now() > workInProgressRootRenderTargetTime && (workInProgress.flags |= 128, type = !0, cutOffTailIfNeeded(newProps, !1), workInProgress.lanes = 4194304);
					}
					else {
						if (!type) if (current = findFirstSuspended(nextResource), null !== current) {
							if (workInProgress.flags |= 128, type = !0, current = current.updateQueue, workInProgress.updateQueue = current, scheduleRetryEffect(workInProgress, current), cutOffTailIfNeeded(newProps, !0), null === newProps.tail && "collapsed" !== newProps.tailMode && "visible" !== newProps.tailMode && !nextResource.alternate && !isHydrating) return bubbleProperties(workInProgress), null;
						} else 2 * now() - newProps.renderingStartTime > workInProgressRootRenderTargetTime && 536870912 !== renderLanes && (workInProgress.flags |= 128, type = !0, cutOffTailIfNeeded(newProps, !1), workInProgress.lanes = 4194304);
						newProps.isBackwards ? (nextResource.sibling = workInProgress.child, workInProgress.child = nextResource) : (current = newProps.last, null !== current ? current.sibling = nextResource : workInProgress.child = nextResource, newProps.last = nextResource);
					}
					if (null !== newProps.tail) {
						current = newProps.tail;
						a: {
							for (renderLanes = current; null !== renderLanes;) {
								if (null !== renderLanes.alternate) {
									renderLanes = !1;
									break a;
								}
								renderLanes = renderLanes.sibling;
							}
							renderLanes = !0;
						}
						newProps.rendering = current;
						newProps.tail = current.sibling;
						newProps.renderingStartTime = now();
						current.sibling = null;
						nextResource = suspenseStackCursor.current;
						nextResource = type ? nextResource & 1 | 2 : nextResource & 1;
						"visible" === newProps.tailMode || "collapsed" === newProps.tailMode || !renderLanes || isHydrating ? pushSuspenseListContext(workInProgress, nextResource) : (renderLanes = nextResource, push(suspenseHandlerStackCursor, workInProgress), push(suspenseStackCursor, renderLanes), null === shellBoundary && (shellBoundary = workInProgress));
						isHydrating && pushTreeFork(workInProgress, newProps.treeForkCount);
						return current;
					}
					bubbleProperties(workInProgress);
					return null;
				case 22:
				case 23: return popSuspenseHandler(workInProgress), popHiddenContext(), newProps = null !== workInProgress.memoizedState, null !== current ? null !== current.memoizedState !== newProps && (workInProgress.flags |= 8192) : newProps && (workInProgress.flags |= 8192), newProps ? 0 !== (renderLanes & 536870912) && 0 === (workInProgress.flags & 128) && (bubbleProperties(workInProgress), workInProgress.subtreeFlags & 6 && (workInProgress.flags |= 8192)) : bubbleProperties(workInProgress), renderLanes = workInProgress.updateQueue, null !== renderLanes && scheduleRetryEffect(workInProgress, renderLanes.retryQueue), renderLanes = null, null !== current && null !== current.memoizedState && null !== current.memoizedState.cachePool && (renderLanes = current.memoizedState.cachePool.pool), newProps = null, null !== workInProgress.memoizedState && null !== workInProgress.memoizedState.cachePool && (newProps = workInProgress.memoizedState.cachePool.pool), newProps !== renderLanes && (workInProgress.flags |= 2048), null !== current && pop(resumedCache), null;
				case 24: return renderLanes = null, null !== current && (renderLanes = current.memoizedState.cache), workInProgress.memoizedState.cache !== renderLanes && (workInProgress.flags |= 2048), popProvider(CacheContext), bubbleProperties(workInProgress), null;
				case 25: return null;
				case 30: return workInProgress.flags |= 33554432, bubbleProperties(workInProgress), null;
			}
			throw Error(formatProdErrorMessage(156, workInProgress.tag));
		}
		function unwindWork(current, workInProgress) {
			popTreeContext(workInProgress);
			switch (workInProgress.tag) {
				case 1: return current = workInProgress.flags, current & 65536 ? (workInProgress.flags = current & -65537 | 128, workInProgress) : null;
				case 3: return popProvider(CacheContext), popHostContainer(), current = workInProgress.flags, 0 !== (current & 65536) && 0 === (current & 128) ? (workInProgress.flags = current & -65537 | 128, workInProgress) : null;
				case 26:
				case 27:
				case 5: return popHostContext(workInProgress), null;
				case 31:
					if (null !== workInProgress.memoizedState) {
						popSuspenseHandler(workInProgress);
						if (null === workInProgress.alternate) throw Error(formatProdErrorMessage(340));
						resetHydrationState();
					}
					current = workInProgress.flags;
					return current & 65536 ? (workInProgress.flags = current & -65537 | 128, workInProgress) : null;
				case 13:
					popSuspenseHandler(workInProgress);
					current = workInProgress.memoizedState;
					if (null !== current && null !== current.dehydrated) {
						if (null === workInProgress.alternate) throw Error(formatProdErrorMessage(340));
						resetHydrationState();
					}
					current = workInProgress.flags;
					return current & 65536 ? (workInProgress.flags = current & -65537 | 128, workInProgress) : null;
				case 19: return popSuspenseListContext(workInProgress), current = workInProgress.flags, current & 65536 ? (workInProgress.flags = current & -65537 | 128, current = workInProgress.memoizedState, null !== current && (current.rendering = null, current.tail = null), workInProgress.flags |= 4, workInProgress) : null;
				case 4: return popHostContainer(), null;
				case 10: return popProvider(workInProgress.type), null;
				case 22:
				case 23: return popSuspenseHandler(workInProgress), popHiddenContext(), null !== current && pop(resumedCache), current = workInProgress.flags, current & 65536 ? (workInProgress.flags = current & -65537 | 128, workInProgress) : null;
				case 24: return popProvider(CacheContext), null;
				case 25: return null;
				default: return null;
			}
		}
		function unwindInterruptedWork(current, interruptedWork) {
			popTreeContext(interruptedWork);
			switch (interruptedWork.tag) {
				case 3:
					popProvider(CacheContext);
					popHostContainer();
					break;
				case 26:
				case 27:
				case 5:
					popHostContext(interruptedWork);
					break;
				case 4:
					popHostContainer();
					break;
				case 31:
					null !== interruptedWork.memoizedState && popSuspenseHandler(interruptedWork);
					break;
				case 13:
					popSuspenseHandler(interruptedWork);
					break;
				case 19:
					popSuspenseListContext(interruptedWork);
					break;
				case 10:
					popProvider(interruptedWork.type);
					break;
				case 22:
				case 23:
					popSuspenseHandler(interruptedWork);
					popHiddenContext();
					null !== current && pop(resumedCache);
					break;
				case 24: popProvider(CacheContext);
			}
		}
		function commitHookEffectListMount(flags, finishedWork) {
			try {
				var updateQueue = finishedWork.updateQueue, lastEffect = null !== updateQueue ? updateQueue.lastEffect : null;
				if (null !== lastEffect) {
					var firstEffect = lastEffect.next;
					updateQueue = firstEffect;
					do {
						if ((updateQueue.tag & flags) === flags) {
							lastEffect = void 0;
							var create = updateQueue.create, inst = updateQueue.inst;
							lastEffect = create();
							inst.destroy = lastEffect;
						}
						updateQueue = updateQueue.next;
					} while (updateQueue !== firstEffect);
				}
			} catch (error) {
				captureCommitPhaseError(finishedWork, finishedWork.return, error);
			}
		}
		function commitHookEffectListUnmount(flags, finishedWork, nearestMountedAncestor$jscomp$0) {
			try {
				var updateQueue = finishedWork.updateQueue, lastEffect = null !== updateQueue ? updateQueue.lastEffect : null;
				if (null !== lastEffect) {
					var firstEffect = lastEffect.next;
					updateQueue = firstEffect;
					do {
						if ((updateQueue.tag & flags) === flags) {
							var inst = updateQueue.inst, destroy = inst.destroy;
							if (void 0 !== destroy) {
								inst.destroy = void 0;
								lastEffect = finishedWork;
								var nearestMountedAncestor = nearestMountedAncestor$jscomp$0, destroy_ = destroy;
								try {
									destroy_();
								} catch (error) {
									captureCommitPhaseError(lastEffect, nearestMountedAncestor, error);
								}
							}
						}
						updateQueue = updateQueue.next;
					} while (updateQueue !== firstEffect);
				}
			} catch (error) {
				captureCommitPhaseError(finishedWork, finishedWork.return, error);
			}
		}
		function commitClassCallbacks(finishedWork) {
			var updateQueue = finishedWork.updateQueue;
			if (null !== updateQueue) {
				var instance = finishedWork.stateNode;
				try {
					commitCallbacks(updateQueue, instance);
				} catch (error) {
					captureCommitPhaseError(finishedWork, finishedWork.return, error);
				}
			}
		}
		function safelyCallComponentWillUnmount(current, nearestMountedAncestor, instance) {
			instance.props = resolveClassComponentProps(current.type, current.memoizedProps);
			instance.state = current.memoizedState;
			try {
				instance.componentWillUnmount();
			} catch (error) {
				captureCommitPhaseError(current, nearestMountedAncestor, error);
			}
		}
		function safelyAttachRef(current, nearestMountedAncestor) {
			try {
				var ref = current.ref;
				if (null !== ref) {
					switch (current.tag) {
						case 26:
						case 27:
						case 5:
							var instanceToUse = current.stateNode;
							break;
						case 30:
							var instance = current.stateNode, name = getViewTransitionName(current.memoizedProps, instance);
							if (null === instance.ref || instance.ref.name !== name) instance.ref = createViewTransitionInstance(name);
							instanceToUse = instance.ref;
							break;
						case 7:
							if (null === current.stateNode) {
								var fragmentInstance = new FragmentInstance(current);
								traverseVisibleInstancesAndTextInstances(current.child, !1, addFragmentHandleToFiber, fragmentInstance, void 0, void 0);
								current.stateNode = fragmentInstance;
							}
							instanceToUse = current.stateNode;
							break;
						default: instanceToUse = current.stateNode;
					}
					"function" === typeof ref ? current.refCleanup = ref(instanceToUse) : ref.current = instanceToUse;
				}
			} catch (error) {
				captureCommitPhaseError(current, nearestMountedAncestor, error);
			}
		}
		function safelyDetachRef(current, nearestMountedAncestor) {
			var ref = current.ref, refCleanup = current.refCleanup;
			if (null !== ref) if ("function" === typeof refCleanup) try {
				refCleanup();
			} catch (error) {
				captureCommitPhaseError(current, nearestMountedAncestor, error);
			} finally {
				current.refCleanup = null, current = current.alternate, null != current && (current.refCleanup = null);
			}
			else if ("function" === typeof ref) try {
				ref(null);
			} catch (error$148) {
				captureCommitPhaseError(current, nearestMountedAncestor, error$148);
			}
			else ref.current = null;
		}
		function commitNewChildToFragmentInstances(fiber, parentFragmentInstances) {
			if ((5 === fiber.tag || 27 === fiber.tag || 6 === fiber.tag) && null === fiber.alternate && null !== parentFragmentInstances) for (var i = 0; i < parentFragmentInstances.length; i++) commitNewChildToFragmentInstance(fiber.stateNode, parentFragmentInstances[i]);
		}
		function commitFragmentInstanceInsertionEffects(fiber) {
			for (var parent = fiber.return; null !== parent;) {
				isFragmentInstanceParent(parent) && commitNewChildToFragmentInstance(fiber.stateNode, parent.stateNode);
				if (isFragmentInstanceHostBoundary(parent)) break;
				parent = parent.return;
			}
		}
		function commitFragmentInstanceDeletionEffects(fiber) {
			for (var parent = fiber.return; null !== parent;) {
				isFragmentInstanceParent(parent) && deleteChildFromFragmentInstance(fiber.stateNode, parent.stateNode);
				if (isFragmentInstanceHostBoundary(parent)) break;
				parent = parent.return;
			}
		}
		function isFragmentInstanceHostBoundary(fiber) {
			return 5 === fiber.tag || 3 === fiber.tag || 27 === fiber.tag;
		}
		function isFragmentInstanceParent(fiber) {
			return fiber && 7 === fiber.tag && null !== fiber.stateNode;
		}
		function commitHostMount(finishedWork) {
			var type = finishedWork.type, props = finishedWork.memoizedProps, instance = finishedWork.stateNode;
			try {
				a: switch (type) {
					case "button":
					case "input":
					case "select":
					case "textarea":
						props.autoFocus && instance.focus();
						break a;
					case "img": props.src ? instance.src = props.src : props.srcSet && (instance.srcset = props.srcSet);
				}
			} catch (error) {
				captureCommitPhaseError(finishedWork, finishedWork.return, error);
			}
		}
		function commitHostUpdate(finishedWork, newProps, oldProps) {
			try {
				var domElement = finishedWork.stateNode;
				updateProperties(domElement, finishedWork.type, oldProps, newProps);
				domElement[internalPropsKey] = newProps;
			} catch (error) {
				captureCommitPhaseError(finishedWork, finishedWork.return, error);
			}
		}
		function isHostParent(fiber) {
			return 5 === fiber.tag || 3 === fiber.tag || 26 === fiber.tag || 27 === fiber.tag && isSingletonScope(fiber.type) || 4 === fiber.tag;
		}
		function getHostSibling(fiber) {
			a: for (;;) {
				for (; null === fiber.sibling;) {
					if (null === fiber.return || isHostParent(fiber.return)) return null;
					fiber = fiber.return;
				}
				fiber.sibling.return = fiber.return;
				for (fiber = fiber.sibling; 5 !== fiber.tag && 6 !== fiber.tag && 18 !== fiber.tag;) {
					if (27 === fiber.tag && isSingletonScope(fiber.type)) continue a;
					if (fiber.flags & 2) continue a;
					if (null === fiber.child || 4 === fiber.tag) continue a;
					else fiber.child.return = fiber, fiber = fiber.child;
				}
				if (!(fiber.flags & 2)) return fiber.stateNode;
			}
		}
		function insertOrAppendPlacementNodeIntoContainer(node, before, parent, parentFragmentInstances) {
			var tag = node.tag;
			if (5 === tag || 6 === tag) tag = node.stateNode, before ? (9 === parent.nodeType ? parent.body : "HTML" === parent.nodeName ? parent.ownerDocument.body : parent).insertBefore(tag, before) : (before = 9 === parent.nodeType ? parent.body : "HTML" === parent.nodeName ? parent.ownerDocument.body : parent, before.appendChild(tag), parent = parent._reactRootContainer, null !== parent && void 0 !== parent || null !== before.onclick || (before.onclick = noop$1)), commitNewChildToFragmentInstances(node, parentFragmentInstances), viewTransitionMutationContext = !0;
			else if (4 !== tag && (27 === tag && (commitNewChildToFragmentInstances(node, parentFragmentInstances), parentFragmentInstances = null, isSingletonScope(node.type) && (parent = node.stateNode, before = null)), node = node.child, null !== node)) for (insertOrAppendPlacementNodeIntoContainer(node, before, parent, parentFragmentInstances), node = node.sibling; null !== node;) insertOrAppendPlacementNodeIntoContainer(node, before, parent, parentFragmentInstances), node = node.sibling;
		}
		function insertOrAppendPlacementNode(node, before, parent, parentFragmentInstances) {
			var tag = node.tag;
			if (5 === tag || 6 === tag) tag = node.stateNode, before ? parent.insertBefore(tag, before) : parent.appendChild(tag), commitNewChildToFragmentInstances(node, parentFragmentInstances), viewTransitionMutationContext = !0;
			else if (4 !== tag && (27 === tag && (commitNewChildToFragmentInstances(node, parentFragmentInstances), parentFragmentInstances = null, isSingletonScope(node.type) && (parent = node.stateNode)), node = node.child, null !== node)) for (insertOrAppendPlacementNode(node, before, parent, parentFragmentInstances), node = node.sibling; null !== node;) insertOrAppendPlacementNode(node, before, parent, parentFragmentInstances), node = node.sibling;
		}
		function commitHostSingletonAcquisition(finishedWork) {
			var singleton = finishedWork.stateNode, props = finishedWork.memoizedProps;
			try {
				for (var type = finishedWork.type, attributes = singleton.attributes; attributes.length;) singleton.removeAttributeNode(attributes[0]);
				setInitialProperties(singleton, type, props);
				singleton[internalInstanceKey] = finishedWork;
				singleton[internalPropsKey] = props;
			} catch (error) {
				captureCommitPhaseError(finishedWork, finishedWork.return, error);
			}
		}
		var shouldStartViewTransition = !1;
		var appearingViewTransitions = null;
		function trackEnterViewTransitions(placement) {
			if (30 === placement.tag || 0 !== (placement.subtreeFlags & 33554432)) shouldStartViewTransition = !0;
		}
		var viewTransitionCancelableChildren = null;
		function pushViewTransitionCancelableScope() {
			var prevChildren = viewTransitionCancelableChildren;
			viewTransitionCancelableChildren = null;
			return prevChildren;
		}
		var viewTransitionHostInstanceIdx = 0;
		function applyViewTransitionToHostInstances(fiber, name, className, collectMeasurements, stopAtNestedViewTransitions) {
			viewTransitionHostInstanceIdx = 0;
			return applyViewTransitionToHostInstancesRecursive(fiber.child, name, className, collectMeasurements, stopAtNestedViewTransitions);
		}
		function applyViewTransitionToHostInstancesRecursive(child, name, className, collectMeasurements, stopAtNestedViewTransitions) {
			for (var inViewport = !1; null !== child;) {
				if (5 === child.tag) {
					var instance = child.stateNode;
					if (null !== collectMeasurements) {
						var measurement = measureInstance(instance);
						collectMeasurements.push(measurement);
						measurement.view && (inViewport = !0);
					} else inViewport || measureInstance(instance).view && (inViewport = !0);
					shouldStartViewTransition = !0;
					applyViewTransitionName(instance, 0 === viewTransitionHostInstanceIdx ? name : name + "_" + viewTransitionHostInstanceIdx, className);
					viewTransitionHostInstanceIdx++;
				} else if (22 !== child.tag || null === child.memoizedState) 30 === child.tag && stopAtNestedViewTransitions || applyViewTransitionToHostInstancesRecursive(child.child, name, className, collectMeasurements, stopAtNestedViewTransitions) && (inViewport = !0);
				child = child.sibling;
			}
			return inViewport;
		}
		function restoreViewTransitionOnHostInstances(child, stopAtNestedViewTransitions) {
			for (; null !== child;) {
				if (5 === child.tag) restoreViewTransitionName(child.stateNode, child.memoizedProps);
				else if (22 !== child.tag || null === child.memoizedState) 30 === child.tag && stopAtNestedViewTransitions || restoreViewTransitionOnHostInstances(child.child, stopAtNestedViewTransitions);
				child = child.sibling;
			}
		}
		function commitAppearingPairViewTransitions(placement) {
			if (0 !== (placement.subtreeFlags & 18874368)) for (placement = placement.child; null !== placement;) {
				if (22 !== placement.tag || null === placement.memoizedState) {
					if (commitAppearingPairViewTransitions(placement), 30 === placement.tag && 0 !== (placement.flags & 18874368) && placement.stateNode.paired) {
						var props = placement.memoizedProps;
						if (null == props.name || "auto" === props.name) throw Error(formatProdErrorMessage(544));
						var name = props.name;
						props = getViewTransitionClassName(props.default, props.share);
						"none" !== props && (applyViewTransitionToHostInstances(placement, name, props, null, !1) || restoreViewTransitionOnHostInstances(placement.child, !1));
					}
				}
				placement = placement.sibling;
			}
		}
		function commitEnterViewTransitions(placement, gesture) {
			if (30 === placement.tag) {
				var state = placement.stateNode, props = placement.memoizedProps, name = getViewTransitionName(props, state), className = getViewTransitionClassName(props.default, state.paired ? props.share : props.enter);
				"none" !== className ? applyViewTransitionToHostInstances(placement, name, className, null, !1) ? (commitAppearingPairViewTransitions(placement), state.paired || gesture || scheduleViewTransitionEvent(placement, props.onEnter)) : restoreViewTransitionOnHostInstances(placement.child, !1) : commitAppearingPairViewTransitions(placement);
			} else if (0 !== (placement.subtreeFlags & 33554432)) for (placement = placement.child; null !== placement;) commitEnterViewTransitions(placement, gesture), placement = placement.sibling;
			else commitAppearingPairViewTransitions(placement);
		}
		function commitDeletedPairViewTransitions(deletion) {
			if (null !== appearingViewTransitions && 0 !== appearingViewTransitions.size) {
				var pairs = appearingViewTransitions;
				if (0 !== (deletion.subtreeFlags & 18874368)) for (deletion = deletion.child; null !== deletion;) {
					if (22 !== deletion.tag || null === deletion.memoizedState) {
						if (30 === deletion.tag && 0 !== (deletion.flags & 18874368)) {
							var props = deletion.memoizedProps, name = props.name;
							if (null != name && "auto" !== name) {
								var pair = pairs.get(name);
								if (void 0 !== pair) {
									var className = getViewTransitionClassName(props.default, props.share);
									"none" !== className && (applyViewTransitionToHostInstances(deletion, name, className, null, !1) ? (className = deletion.stateNode, pair.paired = className, className.paired = pair, scheduleViewTransitionEvent(deletion, props.onShare)) : restoreViewTransitionOnHostInstances(deletion.child, !1));
									pairs.delete(name);
									if (0 === pairs.size) break;
								}
							}
						}
						commitDeletedPairViewTransitions(deletion);
					}
					deletion = deletion.sibling;
				}
			}
		}
		function commitExitViewTransitions(deletion) {
			if (30 === deletion.tag) {
				var props = deletion.memoizedProps, name = getViewTransitionName(props, deletion.stateNode), pair = null !== appearingViewTransitions ? appearingViewTransitions.get(name) : void 0, className = getViewTransitionClassName(props.default, void 0 !== pair ? props.share : props.exit);
				"none" !== className && (applyViewTransitionToHostInstances(deletion, name, className, null, !1) ? void 0 !== pair ? (className = deletion.stateNode, pair.paired = className, className.paired = pair, appearingViewTransitions.delete(name), scheduleViewTransitionEvent(deletion, props.onShare)) : scheduleViewTransitionEvent(deletion, props.onExit) : restoreViewTransitionOnHostInstances(deletion.child, !1));
				null !== appearingViewTransitions && commitDeletedPairViewTransitions(deletion);
			} else if (0 !== (deletion.subtreeFlags & 33554432)) for (deletion = deletion.child; null !== deletion;) commitExitViewTransitions(deletion), deletion = deletion.sibling;
			else null !== appearingViewTransitions && commitDeletedPairViewTransitions(deletion);
		}
		function commitNestedViewTransitions(changedParent) {
			for (changedParent = changedParent.child; null !== changedParent;) {
				if (30 === changedParent.tag) {
					var props = changedParent.memoizedProps, name = getViewTransitionName(props, changedParent.stateNode);
					props = getViewTransitionClassName(props.default, props.update);
					changedParent.flags &= -5;
					"none" !== props && applyViewTransitionToHostInstances(changedParent, name, props, changedParent.memoizedState = [], !1);
				} else 0 !== (changedParent.subtreeFlags & 33554432) && commitNestedViewTransitions(changedParent);
				changedParent = changedParent.sibling;
			}
		}
		function restorePairedViewTransitions(parent) {
			if (0 !== (parent.subtreeFlags & 18874368)) for (parent = parent.child; null !== parent;) {
				if (22 !== parent.tag || null === parent.memoizedState) {
					if (30 === parent.tag && 0 !== (parent.flags & 18874368)) {
						var instance = parent.stateNode;
						null !== instance.paired && (instance.paired = null, restoreViewTransitionOnHostInstances(parent.child, !1));
					}
					restorePairedViewTransitions(parent);
				}
				parent = parent.sibling;
			}
		}
		function restoreEnterOrExitViewTransitions(fiber) {
			if (30 === fiber.tag) fiber.stateNode.paired = null, restoreViewTransitionOnHostInstances(fiber.child, !1), restorePairedViewTransitions(fiber);
			else if (0 !== (fiber.subtreeFlags & 33554432)) for (fiber = fiber.child; null !== fiber;) restoreEnterOrExitViewTransitions(fiber), fiber = fiber.sibling;
			else restorePairedViewTransitions(fiber);
		}
		function restoreNestedViewTransitions(changedParent) {
			for (changedParent = changedParent.child; null !== changedParent;) 30 === changedParent.tag ? restoreViewTransitionOnHostInstances(changedParent.child, !1) : 0 !== (changedParent.subtreeFlags & 33554432) && restoreNestedViewTransitions(changedParent), changedParent = changedParent.sibling;
		}
		function measureViewTransitionHostInstancesRecursive(parentViewTransition, child, newName, oldName, className, previousMeasurements, stopAtNestedViewTransitions) {
			for (var inViewport = !1; null !== child;) {
				if (5 === child.tag) {
					var instance = child.stateNode;
					if (null !== previousMeasurements && viewTransitionHostInstanceIdx < previousMeasurements.length) {
						var previousMeasurement = previousMeasurements[viewTransitionHostInstanceIdx], nextMeasurement = measureInstance(instance);
						if (previousMeasurement.view || nextMeasurement.view) inViewport = !0;
						var JSCompiler_temp;
						if (JSCompiler_temp = 0 === (parentViewTransition.flags & 4)) if (nextMeasurement.clip) JSCompiler_temp = !0;
						else {
							JSCompiler_temp = previousMeasurement.rect;
							var newRect = nextMeasurement.rect;
							JSCompiler_temp = JSCompiler_temp.y !== newRect.y || JSCompiler_temp.x !== newRect.x || JSCompiler_temp.height !== newRect.height || JSCompiler_temp.width !== newRect.width;
						}
						JSCompiler_temp && (parentViewTransition.flags |= 4);
						nextMeasurement.abs ? nextMeasurement = !previousMeasurement.abs : (previousMeasurement = previousMeasurement.rect, nextMeasurement = nextMeasurement.rect, nextMeasurement = previousMeasurement.height !== nextMeasurement.height || previousMeasurement.width !== nextMeasurement.width);
						nextMeasurement && (parentViewTransition.flags |= 32);
					} else parentViewTransition.flags |= 32;
					0 !== (parentViewTransition.flags & 4) && applyViewTransitionName(instance, 0 === viewTransitionHostInstanceIdx ? newName : newName + "_" + viewTransitionHostInstanceIdx, className);
					inViewport && 0 !== (parentViewTransition.flags & 4) || (null === viewTransitionCancelableChildren && (viewTransitionCancelableChildren = []), viewTransitionCancelableChildren.push(instance, 0 === viewTransitionHostInstanceIdx ? oldName : oldName + "_" + viewTransitionHostInstanceIdx, child.memoizedProps));
					viewTransitionHostInstanceIdx++;
				} else if (22 !== child.tag || null === child.memoizedState) 30 === child.tag && stopAtNestedViewTransitions ? parentViewTransition.flags |= child.flags & 32 : measureViewTransitionHostInstancesRecursive(parentViewTransition, child.child, newName, oldName, className, previousMeasurements, stopAtNestedViewTransitions) && (inViewport = !0);
				child = child.sibling;
			}
			return inViewport;
		}
		function measureNestedViewTransitions(changedParent, gesture) {
			for (changedParent = changedParent.child; null !== changedParent;) {
				if (30 === changedParent.tag) {
					var props = changedParent.memoizedProps, state = changedParent.stateNode, name = getViewTransitionName(props, state), className = getViewTransitionClassName(props.default, props.update);
					if (gesture) {
						state = state.clones;
						var previousMeasurements = null === state ? null : state.map(measureClonedInstance);
					} else previousMeasurements = changedParent.memoizedState, changedParent.memoizedState = null;
					state = changedParent;
					var child = changedParent.child;
					viewTransitionHostInstanceIdx = 0;
					name = measureViewTransitionHostInstancesRecursive(state, child, name, name, className, previousMeasurements, !1);
					0 !== (changedParent.flags & 4) && name && (gesture || scheduleViewTransitionEvent(changedParent, props.onUpdate));
				} else 0 !== (changedParent.subtreeFlags & 33554432) && measureNestedViewTransitions(changedParent, gesture);
				changedParent = changedParent.sibling;
			}
		}
		var offscreenSubtreeIsHidden = !1;
		var offscreenSubtreeWasHidden = !1;
		var offscreenDirectParentIsHidden = !1;
		var needsFormReset = !1;
		var PossiblyWeakSet = "function" === typeof WeakSet ? WeakSet : Set;
		var nextEffect = null;
		var viewTransitionContextChanged = !1;
		var inUpdateViewTransition = !1;
		var rootViewTransitionAffected = !1;
		var rootViewTransitionNameCanceled = !1;
		function commitBeforeMutationEffects(root, firstChild, committedLanes) {
			root = root.containerInfo;
			eventsEnabled = _enabled;
			root = getActiveElementDeep(root);
			if (hasSelectionCapabilities(root)) {
				if ("selectionStart" in root) var JSCompiler_temp = {
					start: root.selectionStart,
					end: root.selectionEnd
				};
				else a: {
					JSCompiler_temp = (JSCompiler_temp = root.ownerDocument) && JSCompiler_temp.defaultView || window;
					var selection = JSCompiler_temp.getSelection && JSCompiler_temp.getSelection();
					if (selection && 0 !== selection.rangeCount) {
						JSCompiler_temp = selection.anchorNode;
						var anchorOffset = selection.anchorOffset, focusNode = selection.focusNode;
						selection = selection.focusOffset;
						try {
							JSCompiler_temp.nodeType, focusNode.nodeType;
						} catch (e$21) {
							JSCompiler_temp = null;
							break a;
						}
						var length = 0, start = -1, end = -1, indexWithinAnchor = 0, indexWithinFocus = 0, node = root, parentNode = null;
						b: for (;;) {
							for (var next;;) {
								node !== JSCompiler_temp || 0 !== anchorOffset && 3 !== node.nodeType || (start = length + anchorOffset);
								node !== focusNode || 0 !== selection && 3 !== node.nodeType || (end = length + selection);
								3 === node.nodeType && (length += node.nodeValue.length);
								if (null === (next = node.firstChild)) break;
								parentNode = node;
								node = next;
							}
							for (;;) {
								if (node === root) break b;
								parentNode === JSCompiler_temp && ++indexWithinAnchor === anchorOffset && (start = length);
								parentNode === focusNode && ++indexWithinFocus === selection && (end = length);
								if (null !== (next = node.nextSibling)) break;
								node = parentNode;
								parentNode = node.parentNode;
							}
							node = next;
						}
						JSCompiler_temp = -1 === start || -1 === end ? null : {
							start,
							end
						};
					} else JSCompiler_temp = null;
				}
				JSCompiler_temp = JSCompiler_temp || {
					start: 0,
					end: 0
				};
			} else JSCompiler_temp = null;
			selectionInformation = {
				focusedElem: root,
				selectionRange: JSCompiler_temp
			};
			_enabled = !1;
			committedLanes = (committedLanes & 335544064) === committedLanes;
			nextEffect = firstChild;
			for (firstChild = committedLanes ? 9270 : 1024; null !== nextEffect;) {
				root = nextEffect;
				if (committedLanes && (JSCompiler_temp = root.deletions, null !== JSCompiler_temp)) for (anchorOffset = 0; anchorOffset < JSCompiler_temp.length; anchorOffset++) committedLanes && commitExitViewTransitions(JSCompiler_temp[anchorOffset]);
				if (null === root.alternate && 0 !== (root.flags & 2)) committedLanes && trackEnterViewTransitions(root), commitBeforeMutationEffects_complete(committedLanes);
				else {
					if (22 === root.tag) {
						if (JSCompiler_temp = root.alternate, null !== root.memoizedState) {
							null !== JSCompiler_temp && null === JSCompiler_temp.memoizedState && committedLanes && commitExitViewTransitions(JSCompiler_temp);
							commitBeforeMutationEffects_complete(committedLanes);
							continue;
						} else if (null !== JSCompiler_temp && null !== JSCompiler_temp.memoizedState) {
							committedLanes && trackEnterViewTransitions(root);
							commitBeforeMutationEffects_complete(committedLanes);
							continue;
						}
					}
					JSCompiler_temp = root.child;
					0 !== (root.subtreeFlags & firstChild) && null !== JSCompiler_temp ? (JSCompiler_temp.return = root, nextEffect = JSCompiler_temp) : (committedLanes && commitNestedViewTransitions(root), commitBeforeMutationEffects_complete(committedLanes));
				}
			}
			appearingViewTransitions = null;
		}
		function commitBeforeMutationEffects_complete(isViewTransitionEligible$jscomp$0) {
			for (; null !== nextEffect;) {
				var fiber = nextEffect, isViewTransitionEligible = isViewTransitionEligible$jscomp$0, current = fiber.alternate, flags = fiber.flags;
				switch (fiber.tag) {
					case 0:
					case 11:
					case 15: break;
					case 1:
						if (0 !== (flags & 1024) && null !== current) {
							isViewTransitionEligible = void 0;
							flags = current.memoizedProps;
							current = current.memoizedState;
							var instance = fiber.stateNode;
							try {
								var resolvedPrevProps = resolveClassComponentProps(fiber.type, flags);
								isViewTransitionEligible = instance.getSnapshotBeforeUpdate(resolvedPrevProps, current);
								instance.__reactInternalSnapshotBeforeUpdate = isViewTransitionEligible;
							} catch (error) {
								captureCommitPhaseError(fiber, fiber.return, error);
							}
						}
						break;
					case 3:
						if (0 !== (flags & 1024)) {
							if (current = fiber.stateNode.containerInfo, isViewTransitionEligible = current.nodeType, 9 === isViewTransitionEligible) clearContainerSparingly(current);
							else if (1 === isViewTransitionEligible) switch (current.nodeName) {
								case "HEAD":
								case "HTML":
								case "BODY":
									clearContainerSparingly(current);
									break;
								default: current.textContent = "";
							}
						}
						break;
					case 5:
					case 26:
					case 27:
					case 6:
					case 4:
					case 17: break;
					case 30:
						isViewTransitionEligible && null !== current && (isViewTransitionEligible = getViewTransitionName(current.memoizedProps, current.stateNode), flags = fiber.memoizedProps, flags = getViewTransitionClassName(flags.default, flags.update), "none" !== flags && applyViewTransitionToHostInstances(current, isViewTransitionEligible, flags, current.memoizedState = [], !0));
						break;
					default: if (0 !== (flags & 1024)) throw Error(formatProdErrorMessage(163));
				}
				current = fiber.sibling;
				if (null !== current) {
					current.return = fiber.return;
					nextEffect = current;
					break;
				}
				nextEffect = fiber.return;
			}
		}
		function commitLayoutEffectOnFiber(finishedRoot, current, finishedWork) {
			var flags = finishedWork.flags;
			switch (finishedWork.tag) {
				case 0:
				case 11:
				case 15:
					recursivelyTraverseLayoutEffects(finishedRoot, finishedWork);
					flags & 4 && commitHookEffectListMount(5, finishedWork);
					break;
				case 1:
					recursivelyTraverseLayoutEffects(finishedRoot, finishedWork);
					if (flags & 4) if (finishedRoot = finishedWork.stateNode, null === current) try {
						finishedRoot.componentDidMount();
					} catch (error) {
						captureCommitPhaseError(finishedWork, finishedWork.return, error);
					}
					else {
						var prevProps = resolveClassComponentProps(finishedWork.type, current.memoizedProps);
						current = current.memoizedState;
						try {
							finishedRoot.componentDidUpdate(prevProps, current, finishedRoot.__reactInternalSnapshotBeforeUpdate);
						} catch (error$146) {
							captureCommitPhaseError(finishedWork, finishedWork.return, error$146);
						}
					}
					flags & 64 && commitClassCallbacks(finishedWork);
					flags & 512 && safelyAttachRef(finishedWork, finishedWork.return);
					break;
				case 3:
					recursivelyTraverseLayoutEffects(finishedRoot, finishedWork);
					if (flags & 64 && (finishedRoot = finishedWork.updateQueue, null !== finishedRoot)) {
						current = null;
						if (null !== finishedWork.child) switch (finishedWork.child.tag) {
							case 27:
							case 5:
								current = finishedWork.child.stateNode;
								break;
							case 1: current = finishedWork.child.stateNode;
						}
						try {
							commitCallbacks(finishedRoot, current);
						} catch (error) {
							captureCommitPhaseError(finishedWork, finishedWork.return, error);
						}
					}
					break;
				case 27: null === current && flags & 4 && commitHostSingletonAcquisition(finishedWork);
				case 26:
				case 5:
					recursivelyTraverseLayoutEffects(finishedRoot, finishedWork);
					null === current && flags & 4 && commitHostMount(finishedWork);
					flags & 512 && safelyAttachRef(finishedWork, finishedWork.return);
					break;
				case 12:
					recursivelyTraverseLayoutEffects(finishedRoot, finishedWork);
					break;
				case 31:
					recursivelyTraverseLayoutEffects(finishedRoot, finishedWork);
					flags & 4 && commitActivityHydrationCallbacks(finishedRoot, finishedWork);
					break;
				case 13:
					recursivelyTraverseLayoutEffects(finishedRoot, finishedWork);
					flags & 4 && commitSuspenseHydrationCallbacks(finishedRoot, finishedWork);
					flags & 64 && (finishedRoot = finishedWork.memoizedState, null !== finishedRoot && (finishedRoot = finishedRoot.dehydrated, null !== finishedRoot && (finishedWork = retryDehydratedSuspenseBoundary.bind(null, finishedWork), registerSuspenseInstanceRetry(finishedRoot, finishedWork))));
					break;
				case 22:
					flags = null !== finishedWork.memoizedState || offscreenSubtreeIsHidden;
					if (!flags) {
						var newOffscreenSubtreeWasHidden = null !== current && null !== current.memoizedState || offscreenSubtreeWasHidden;
						current = offscreenSubtreeIsHidden;
						prevProps = offscreenSubtreeWasHidden;
						offscreenSubtreeIsHidden = flags;
						(offscreenSubtreeWasHidden = newOffscreenSubtreeWasHidden) && !prevProps ? (flags = 2, 0 !== (finishedWork.subtreeFlags & 8772) && (flags |= 1), recursivelyTraverseReappearLayoutEffects(finishedRoot, finishedWork, flags)) : recursivelyTraverseLayoutEffects(finishedRoot, finishedWork);
						offscreenSubtreeIsHidden = current;
						offscreenSubtreeWasHidden = prevProps;
					}
					break;
				case 30:
					recursivelyTraverseLayoutEffects(finishedRoot, finishedWork);
					flags & 512 && safelyAttachRef(finishedWork, finishedWork.return);
					break;
				case 7: flags & 512 && safelyAttachRef(finishedWork, finishedWork.return);
				default: recursivelyTraverseLayoutEffects(finishedRoot, finishedWork);
			}
		}
		function hideOrUnhideAllChildren(parentFiber, isHidden) {
			for (parentFiber = parentFiber.child; null !== parentFiber;) hideOrUnhideAllChildrenOnFiber(parentFiber, isHidden), parentFiber = parentFiber.sibling;
		}
		function hideOrUnhideAllChildrenOnFiber(fiber, isHidden) {
			switch (fiber.tag) {
				case 5:
				case 26:
					try {
						var instance = fiber.stateNode;
						if (isHidden) {
							var style = instance.style;
							"function" === typeof style.setProperty ? style.setProperty("display", "none", "important") : style.display = "none";
						} else {
							var instance$jscomp$0 = fiber.stateNode, styleProp = fiber.memoizedProps.style, display = void 0 !== styleProp && null !== styleProp && styleProp.hasOwnProperty("display") ? styleProp.display : null;
							instance$jscomp$0.style.display = null == display || "boolean" === typeof display ? "" : ("" + display).trim();
						}
					} catch (error) {
						captureCommitPhaseError(fiber, fiber.return, error);
					}
					hideOrUnhideNearestPortals(fiber, isHidden);
					break;
				case 6:
					try {
						fiber.stateNode.nodeValue = isHidden ? "" : fiber.memoizedProps, viewTransitionMutationContext = !0;
					} catch (error) {
						captureCommitPhaseError(fiber, fiber.return, error);
					}
					break;
				case 18:
					try {
						var instance$jscomp$1 = fiber.stateNode;
						isHidden ? hideOrUnhideDehydratedBoundary(instance$jscomp$1, !0) : hideOrUnhideDehydratedBoundary(fiber.stateNode, !1);
					} catch (error) {
						captureCommitPhaseError(fiber, fiber.return, error);
					}
					break;
				case 22:
				case 23:
					null === fiber.memoizedState && hideOrUnhideAllChildren(fiber, isHidden);
					break;
				default: hideOrUnhideAllChildren(fiber, isHidden);
			}
		}
		function hideOrUnhideNearestPortals(parentFiber, isHidden$jscomp$0) {
			if (parentFiber.subtreeFlags & 67108864) for (parentFiber = parentFiber.child; null !== parentFiber;) {
				a: {
					var fiber = parentFiber, isHidden = isHidden$jscomp$0;
					switch (fiber.tag) {
						case 4:
							hideOrUnhideAllChildrenOnFiber(fiber, isHidden);
							break a;
						case 22:
							null === fiber.memoizedState && hideOrUnhideNearestPortals(fiber, isHidden);
							break a;
						default: hideOrUnhideNearestPortals(fiber, isHidden);
					}
				}
				parentFiber = parentFiber.sibling;
			}
		}
		function detachFiberAfterEffects(fiber) {
			var alternate = fiber.alternate;
			null !== alternate && (fiber.alternate = null, detachFiberAfterEffects(alternate));
			fiber.child = null;
			fiber.deletions = null;
			fiber.sibling = null;
			5 === fiber.tag && (alternate = fiber.stateNode, null !== alternate && detachDeletedInstance(alternate));
			fiber.stateNode = null;
			fiber.return = null;
			fiber.dependencies = null;
			fiber.memoizedProps = null;
			fiber.memoizedState = null;
			fiber.pendingProps = null;
			fiber.stateNode = null;
			fiber.updateQueue = null;
		}
		var hostParent = null;
		var hostParentIsContainer = !1;
		function recursivelyTraverseDeletionEffects(finishedRoot, nearestMountedAncestor, parent) {
			for (parent = parent.child; null !== parent;) commitDeletionEffectsOnFiber(finishedRoot, nearestMountedAncestor, parent), parent = parent.sibling;
		}
		function commitDeletionEffectsOnFiber(finishedRoot, nearestMountedAncestor, deletedFiber) {
			if (injectedHook && "function" === typeof injectedHook.onCommitFiberUnmount) try {
				injectedHook.onCommitFiberUnmount(rendererID, deletedFiber);
			} catch (err) {}
			switch (deletedFiber.tag) {
				case 26:
					offscreenSubtreeWasHidden || safelyDetachRef(deletedFiber, nearestMountedAncestor);
					recursivelyTraverseDeletionEffects(finishedRoot, nearestMountedAncestor, deletedFiber);
					deletedFiber.memoizedState ? deletedFiber.memoizedState.count-- : deletedFiber.stateNode && !offscreenSubtreeWasHidden && (deletedFiber = deletedFiber.stateNode, deletedFiber.parentNode.removeChild(deletedFiber));
					break;
				case 27:
					offscreenSubtreeWasHidden || safelyDetachRef(deletedFiber, nearestMountedAncestor);
					commitFragmentInstanceDeletionEffects(deletedFiber);
					var prevHostParent = hostParent, prevHostParentIsContainer = hostParentIsContainer;
					isSingletonScope(deletedFiber.type) && (hostParent = deletedFiber.stateNode, hostParentIsContainer = !1);
					recursivelyTraverseDeletionEffects(finishedRoot, nearestMountedAncestor, deletedFiber);
					releaseSingletonInstance(deletedFiber.stateNode, deletedFiber.type, deletedFiber.memoizedProps);
					hostParent = prevHostParent;
					hostParentIsContainer = prevHostParentIsContainer;
					break;
				case 5: offscreenSubtreeWasHidden || safelyDetachRef(deletedFiber, nearestMountedAncestor), commitFragmentInstanceDeletionEffects(deletedFiber);
				case 6:
					6 === deletedFiber.tag && commitFragmentInstanceDeletionEffects(deletedFiber);
					prevHostParent = hostParent;
					prevHostParentIsContainer = hostParentIsContainer;
					hostParent = null;
					recursivelyTraverseDeletionEffects(finishedRoot, nearestMountedAncestor, deletedFiber);
					hostParent = prevHostParent;
					hostParentIsContainer = prevHostParentIsContainer;
					if (null !== hostParent) if (hostParentIsContainer) try {
						(9 === hostParent.nodeType ? hostParent.body : "HTML" === hostParent.nodeName ? hostParent.ownerDocument.body : hostParent).removeChild(deletedFiber.stateNode), viewTransitionMutationContext = !0;
					} catch (error) {
						captureCommitPhaseError(deletedFiber, nearestMountedAncestor, error);
					}
					else try {
						hostParent.removeChild(deletedFiber.stateNode), viewTransitionMutationContext = !0;
					} catch (error) {
						captureCommitPhaseError(deletedFiber, nearestMountedAncestor, error);
					}
					break;
				case 18:
					null !== hostParent && (hostParentIsContainer ? (finishedRoot = hostParent, clearHydrationBoundary(9 === finishedRoot.nodeType ? finishedRoot.body : "HTML" === finishedRoot.nodeName ? finishedRoot.ownerDocument.body : finishedRoot, deletedFiber.stateNode), retryIfBlockedOn(finishedRoot)) : clearHydrationBoundary(hostParent, deletedFiber.stateNode));
					break;
				case 4:
					prevHostParent = hostParent;
					prevHostParentIsContainer = hostParentIsContainer;
					hostParent = deletedFiber.stateNode.containerInfo;
					hostParentIsContainer = !0;
					recursivelyTraverseDeletionEffects(finishedRoot, nearestMountedAncestor, deletedFiber);
					hostParent = prevHostParent;
					hostParentIsContainer = prevHostParentIsContainer;
					break;
				case 0:
				case 11:
				case 14:
				case 15:
					commitHookEffectListUnmount(2, deletedFiber, nearestMountedAncestor);
					offscreenSubtreeWasHidden || commitHookEffectListUnmount(4, deletedFiber, nearestMountedAncestor);
					recursivelyTraverseDeletionEffects(finishedRoot, nearestMountedAncestor, deletedFiber);
					break;
				case 1:
					offscreenSubtreeWasHidden || (safelyDetachRef(deletedFiber, nearestMountedAncestor), prevHostParent = deletedFiber.stateNode, "function" === typeof prevHostParent.componentWillUnmount && safelyCallComponentWillUnmount(deletedFiber, nearestMountedAncestor, prevHostParent));
					recursivelyTraverseDeletionEffects(finishedRoot, nearestMountedAncestor, deletedFiber);
					break;
				case 21:
					recursivelyTraverseDeletionEffects(finishedRoot, nearestMountedAncestor, deletedFiber);
					break;
				case 22:
					offscreenSubtreeWasHidden = (prevHostParent = offscreenSubtreeWasHidden) || null !== deletedFiber.memoizedState;
					recursivelyTraverseDeletionEffects(finishedRoot, nearestMountedAncestor, deletedFiber);
					offscreenSubtreeWasHidden = prevHostParent;
					break;
				case 30:
					safelyDetachRef(deletedFiber, nearestMountedAncestor);
					recursivelyTraverseDeletionEffects(finishedRoot, nearestMountedAncestor, deletedFiber);
					break;
				case 7:
					offscreenSubtreeWasHidden || safelyDetachRef(deletedFiber, nearestMountedAncestor);
					recursivelyTraverseDeletionEffects(finishedRoot, nearestMountedAncestor, deletedFiber);
					break;
				default: recursivelyTraverseDeletionEffects(finishedRoot, nearestMountedAncestor, deletedFiber);
			}
		}
		function commitActivityHydrationCallbacks(finishedRoot, finishedWork) {
			if (null === finishedWork.memoizedState && (finishedRoot = finishedWork.alternate, null !== finishedRoot && (finishedRoot = finishedRoot.memoizedState, null !== finishedRoot))) {
				finishedRoot = finishedRoot.dehydrated;
				try {
					retryIfBlockedOn(finishedRoot);
				} catch (error) {
					captureCommitPhaseError(finishedWork, finishedWork.return, error);
				}
			}
		}
		function commitSuspenseHydrationCallbacks(finishedRoot, finishedWork) {
			if (null === finishedWork.memoizedState && (finishedRoot = finishedWork.alternate, null !== finishedRoot && (finishedRoot = finishedRoot.memoizedState, null !== finishedRoot && (finishedRoot = finishedRoot.dehydrated, null !== finishedRoot)))) try {
				retryIfBlockedOn(finishedRoot);
			} catch (error) {
				captureCommitPhaseError(finishedWork, finishedWork.return, error);
			}
		}
		function getRetryCache(finishedWork) {
			switch (finishedWork.tag) {
				case 31:
				case 13:
				case 19:
					var retryCache = finishedWork.stateNode;
					null === retryCache && (retryCache = finishedWork.stateNode = new PossiblyWeakSet());
					return retryCache;
				case 22: return finishedWork = finishedWork.stateNode, retryCache = finishedWork._retryCache, null === retryCache && (retryCache = finishedWork._retryCache = new PossiblyWeakSet()), retryCache;
				default: throw Error(formatProdErrorMessage(435, finishedWork.tag));
			}
		}
		function attachSuspenseRetryListeners(finishedWork, wakeables) {
			var retryCache = getRetryCache(finishedWork);
			wakeables.forEach(function(wakeable) {
				if (!retryCache.has(wakeable)) {
					retryCache.add(wakeable);
					var retry = resolveRetryWakeable.bind(null, finishedWork, wakeable);
					wakeable.then(retry, retry);
				}
			});
		}
		function recursivelyTraverseMutationEffects(root$jscomp$0, parentFiber, lanes) {
			var deletions = parentFiber.deletions;
			if (null !== deletions) for (var i = 0; i < deletions.length; i++) {
				var childToDelete = deletions[i], root = root$jscomp$0, returnFiber = parentFiber, parent = returnFiber;
				a: for (; null !== parent;) {
					switch (parent.tag) {
						case 27:
							if (isSingletonScope(parent.type)) {
								hostParent = parent.stateNode;
								hostParentIsContainer = !1;
								break a;
							}
							break;
						case 5:
							hostParent = parent.stateNode;
							hostParentIsContainer = !1;
							break a;
						case 3:
						case 4:
							hostParent = parent.stateNode.containerInfo;
							hostParentIsContainer = !0;
							break a;
					}
					parent = parent.return;
				}
				if (null === hostParent) throw Error(formatProdErrorMessage(160));
				commitDeletionEffectsOnFiber(root, returnFiber, childToDelete);
				hostParent = null;
				hostParentIsContainer = !1;
				root = childToDelete.alternate;
				null !== root && (root.return = null);
				childToDelete.return = null;
			}
			if (parentFiber.subtreeFlags & 13886) for (parentFiber = parentFiber.child; null !== parentFiber;) commitMutationEffectsOnFiber(parentFiber, root$jscomp$0, lanes), parentFiber = parentFiber.sibling;
		}
		var currentHoistableRoot = null;
		function commitMutationEffectsOnFiber(finishedWork, root, lanes) {
			var current = finishedWork.alternate, flags = finishedWork.flags;
			switch (finishedWork.tag) {
				case 0:
				case 11:
				case 14:
				case 15:
					if (flags & 4 && (current = finishedWork.updateQueue, current = null !== current ? current.events : null, null !== current)) for (var ii = 0; ii < current.length; ii++) {
						var _eventPayloads$ii2 = current[ii];
						_eventPayloads$ii2.ref.impl = _eventPayloads$ii2.nextImpl;
					}
					recursivelyTraverseMutationEffects(root, finishedWork, lanes);
					commitReconciliationEffects(finishedWork);
					flags & 4 && (commitHookEffectListUnmount(3, finishedWork, finishedWork.return), commitHookEffectListMount(3, finishedWork), commitHookEffectListUnmount(5, finishedWork, finishedWork.return));
					break;
				case 1:
					recursivelyTraverseMutationEffects(root, finishedWork, lanes);
					commitReconciliationEffects(finishedWork);
					flags & 512 && (offscreenSubtreeWasHidden || null === current || safelyDetachRef(current, current.return));
					flags & 64 && offscreenSubtreeIsHidden && (finishedWork = finishedWork.updateQueue, null !== finishedWork && (root = finishedWork.callbacks, null !== root && (lanes = finishedWork.shared.hiddenCallbacks, finishedWork.shared.hiddenCallbacks = null === lanes ? root : lanes.concat(root))));
					break;
				case 26:
					ii = currentHoistableRoot;
					recursivelyTraverseMutationEffects(root, finishedWork, lanes);
					commitReconciliationEffects(finishedWork);
					flags & 512 && (offscreenSubtreeWasHidden || null === current || safelyDetachRef(current, current.return));
					if (flags & 4) if (flags = null !== current ? current.memoizedState : null, lanes = finishedWork.memoizedState, null === current) if (null === lanes) if (null === finishedWork.stateNode) if (offscreenSubtreeIsHidden) finishedWork.stateNode = createHoistableInstance(finishedWork.type, finishedWork.memoizedProps, root.containerInfo, finishedWork);
					else {
						a: {
							root = finishedWork.type;
							lanes = finishedWork.memoizedProps;
							flags = ii.ownerDocument || ii;
							b: switch (root) {
								case "title":
									current = flags.getElementsByTagName("title")[0];
									if (!current || current[internalHoistableMarker] || current[internalInstanceKey] || "http://www.w3.org/2000/svg" === current.namespaceURI || current.hasAttribute("itemprop")) current = flags.createElement(root), flags.head.insertBefore(current, flags.querySelector("head > title"));
									setInitialProperties(current, root, lanes);
									current[internalInstanceKey] = finishedWork;
									markNodeAsHoistable(current);
									root = current;
									break a;
								case "link":
									if (ii = getHydratableHoistableCache("link", "href", flags).get(root + (lanes.href || ""))) {
										for (_eventPayloads$ii2 = 0; _eventPayloads$ii2 < ii.length; _eventPayloads$ii2++) if (current = ii[_eventPayloads$ii2], current.getAttribute("href") === (null == lanes.href || "" === lanes.href ? null : lanes.href) && current.getAttribute("rel") === (null == lanes.rel ? null : lanes.rel) && current.getAttribute("title") === (null == lanes.title ? null : lanes.title) && current.getAttribute("crossorigin") === (null == lanes.crossOrigin ? null : lanes.crossOrigin)) {
											ii.splice(_eventPayloads$ii2, 1);
											break b;
										}
									}
									current = flags.createElement(root);
									setInitialProperties(current, root, lanes);
									flags.head.appendChild(current);
									break;
								case "meta":
									if (ii = getHydratableHoistableCache("meta", "content", flags).get(root + (lanes.content || ""))) {
										for (_eventPayloads$ii2 = 0; _eventPayloads$ii2 < ii.length; _eventPayloads$ii2++) if (current = ii[_eventPayloads$ii2], current.getAttribute("content") === (null == lanes.content ? null : "" + lanes.content) && current.getAttribute("name") === (null == lanes.name ? null : lanes.name) && current.getAttribute("property") === (null == lanes.property ? null : lanes.property) && current.getAttribute("http-equiv") === (null == lanes.httpEquiv ? null : lanes.httpEquiv) && current.getAttribute("charset") === (null == lanes.charSet ? null : lanes.charSet)) {
											ii.splice(_eventPayloads$ii2, 1);
											break b;
										}
									}
									current = flags.createElement(root);
									setInitialProperties(current, root, lanes);
									flags.head.appendChild(current);
									break;
								default: throw Error(formatProdErrorMessage(468, root));
							}
							current[internalInstanceKey] = finishedWork;
							markNodeAsHoistable(current);
							root = current;
						}
						finishedWork.stateNode = root;
					}
					else offscreenSubtreeIsHidden || mountHoistable(ii, finishedWork.type, finishedWork.stateNode);
					else finishedWork.stateNode = acquireResource(ii, lanes, finishedWork.memoizedProps);
					else flags !== lanes ? (null === flags ? (root = current.stateNode, null === root || offscreenSubtreeWasHidden || root.parentNode.removeChild(root)) : flags.count--, null === lanes ? offscreenSubtreeIsHidden || mountHoistable(ii, finishedWork.type, finishedWork.stateNode) : acquireResource(ii, lanes, finishedWork.memoizedProps)) : null === lanes && null !== finishedWork.stateNode && commitHostUpdate(finishedWork, finishedWork.memoizedProps, current.memoizedProps);
					break;
				case 27:
					recursivelyTraverseMutationEffects(root, finishedWork, lanes);
					commitReconciliationEffects(finishedWork);
					flags & 512 && (offscreenSubtreeWasHidden || null === current || safelyDetachRef(current, current.return));
					null !== current && flags & 4 && commitHostUpdate(finishedWork, finishedWork.memoizedProps, current.memoizedProps);
					break;
				case 5:
					ii = offscreenDirectParentIsHidden;
					offscreenDirectParentIsHidden = !1;
					recursivelyTraverseMutationEffects(root, finishedWork, lanes);
					offscreenDirectParentIsHidden = ii;
					commitReconciliationEffects(finishedWork);
					flags & 512 && (offscreenSubtreeWasHidden || null === current || safelyDetachRef(current, current.return));
					if (finishedWork.flags & 32) {
						root = finishedWork.stateNode;
						try {
							setTextContent(root, ""), viewTransitionMutationContext = !0;
						} catch (error) {
							captureCommitPhaseError(finishedWork, finishedWork.return, error);
						}
					}
					flags & 4 && null != finishedWork.stateNode && (root = finishedWork.memoizedProps, commitHostUpdate(finishedWork, root, null !== current ? current.memoizedProps : root));
					flags & 1024 && (needsFormReset = !0);
					break;
				case 6:
					recursivelyTraverseMutationEffects(root, finishedWork, lanes);
					commitReconciliationEffects(finishedWork);
					if (flags & 4) {
						if (null === finishedWork.stateNode) throw Error(formatProdErrorMessage(162));
						root = finishedWork.memoizedProps;
						lanes = finishedWork.stateNode;
						try {
							lanes.nodeValue = root, viewTransitionMutationContext = !0;
						} catch (error) {
							captureCommitPhaseError(finishedWork, finishedWork.return, error);
						}
					}
					break;
				case 3:
					viewTransitionMutationContext = !1;
					tagCaches = null;
					ii = currentHoistableRoot;
					currentHoistableRoot = getHoistableRoot(root.containerInfo);
					recursivelyTraverseMutationEffects(root, finishedWork, lanes);
					currentHoistableRoot = ii;
					commitReconciliationEffects(finishedWork);
					if (flags & 4 && null !== current && current.memoizedState.isDehydrated) try {
						retryIfBlockedOn(root.containerInfo);
					} catch (error) {
						captureCommitPhaseError(finishedWork, finishedWork.return, error);
					}
					needsFormReset && (needsFormReset = !1, recursivelyResetForms(finishedWork));
					viewTransitionMutationContext = !1;
					break;
				case 4:
					flags = offscreenDirectParentIsHidden;
					offscreenDirectParentIsHidden = offscreenSubtreeIsHidden;
					current = pushMutationContext();
					ii = currentHoistableRoot;
					currentHoistableRoot = getHoistableRoot(finishedWork.stateNode.containerInfo);
					recursivelyTraverseMutationEffects(root, finishedWork, lanes);
					commitReconciliationEffects(finishedWork);
					currentHoistableRoot = ii;
					viewTransitionMutationContext && inUpdateViewTransition && (rootViewTransitionAffected = !0);
					viewTransitionMutationContext = current;
					offscreenDirectParentIsHidden = flags;
					break;
				case 12:
					recursivelyTraverseMutationEffects(root, finishedWork, lanes);
					commitReconciliationEffects(finishedWork);
					break;
				case 31:
					recursivelyTraverseMutationEffects(root, finishedWork, lanes);
					commitReconciliationEffects(finishedWork);
					flags & 4 && (root = finishedWork.updateQueue, null !== root && (finishedWork.updateQueue = null, attachSuspenseRetryListeners(finishedWork, root)));
					break;
				case 13:
					recursivelyTraverseMutationEffects(root, finishedWork, lanes);
					commitReconciliationEffects(finishedWork);
					finishedWork.child.flags & 8192 && null !== finishedWork.memoizedState !== (null !== current && null !== current.memoizedState) && (globalMostRecentFallbackTime = now());
					flags & 4 && (root = finishedWork.updateQueue, null !== root && (finishedWork.updateQueue = null, attachSuspenseRetryListeners(finishedWork, root)));
					break;
				case 22:
					ii = null !== finishedWork.memoizedState;
					_eventPayloads$ii2 = null !== current && null !== current.memoizedState;
					var prevOffscreenSubtreeIsHidden = offscreenSubtreeIsHidden, prevOffscreenSubtreeWasHidden = offscreenSubtreeWasHidden, prevOffscreenDirectParentIsHidden$166 = offscreenDirectParentIsHidden;
					offscreenSubtreeIsHidden = prevOffscreenSubtreeIsHidden || ii;
					offscreenDirectParentIsHidden = prevOffscreenDirectParentIsHidden$166 || ii;
					offscreenSubtreeWasHidden = prevOffscreenSubtreeWasHidden || _eventPayloads$ii2;
					recursivelyTraverseMutationEffects(root, finishedWork, lanes);
					offscreenSubtreeWasHidden = prevOffscreenSubtreeWasHidden;
					offscreenDirectParentIsHidden = prevOffscreenDirectParentIsHidden$166;
					offscreenSubtreeIsHidden = prevOffscreenSubtreeIsHidden;
					commitReconciliationEffects(finishedWork);
					flags & 8192 && (root = finishedWork.stateNode, root._visibility = ii ? root._visibility & -2 : root._visibility | 1, !ii || null === current || _eventPayloads$ii2 || offscreenSubtreeIsHidden || offscreenSubtreeWasHidden || (root = _eventPayloads$ii2 || offscreenSubtreeWasHidden, lanes = offscreenSubtreeIsHidden, current = offscreenSubtreeWasHidden, offscreenSubtreeIsHidden = ii || offscreenSubtreeIsHidden, offscreenSubtreeWasHidden = root, recursivelyTraverseDisappearLayoutEffects(finishedWork, 2), offscreenSubtreeIsHidden = lanes, offscreenSubtreeWasHidden = current), !ii && offscreenDirectParentIsHidden || hideOrUnhideAllChildren(finishedWork, ii));
					flags & 4 && (root = finishedWork.updateQueue, null !== root && (lanes = root.retryQueue, null !== lanes && (root.retryQueue = null, attachSuspenseRetryListeners(finishedWork, lanes))));
					break;
				case 19:
					recursivelyTraverseMutationEffects(root, finishedWork, lanes);
					commitReconciliationEffects(finishedWork);
					flags & 4 && (root = finishedWork.updateQueue, null !== root && (finishedWork.updateQueue = null, attachSuspenseRetryListeners(finishedWork, root)));
					break;
				case 30:
					flags & 512 && (offscreenSubtreeWasHidden || null === current || safelyDetachRef(current, current.return));
					flags = pushMutationContext();
					ii = inUpdateViewTransition;
					_eventPayloads$ii2 = (lanes & 335544064) === lanes;
					prevOffscreenSubtreeIsHidden = finishedWork.memoizedProps;
					inUpdateViewTransition = _eventPayloads$ii2 && "none" !== getViewTransitionClassName(prevOffscreenSubtreeIsHidden.default, prevOffscreenSubtreeIsHidden.update);
					recursivelyTraverseMutationEffects(root, finishedWork, lanes);
					commitReconciliationEffects(finishedWork);
					_eventPayloads$ii2 && null !== current && viewTransitionMutationContext && (finishedWork.flags |= 4);
					inUpdateViewTransition = ii;
					viewTransitionMutationContext = flags;
					break;
				case 21: break;
				case 7: flags & 512 && (offscreenSubtreeWasHidden || null === current || safelyDetachRef(current, current.return)), current && null !== current.stateNode && (current.stateNode._fragmentFiber = finishedWork);
				default: recursivelyTraverseMutationEffects(root, finishedWork, lanes), commitReconciliationEffects(finishedWork);
			}
		}
		function commitReconciliationEffects(finishedWork) {
			var flags = finishedWork.flags;
			if (flags & 2) {
				try {
					for (var hostParentFiber, parentFiber = finishedWork.return; null !== parentFiber;) {
						if (isHostParent(parentFiber)) {
							hostParentFiber = parentFiber;
							break;
						}
						parentFiber = parentFiber.return;
					}
					parentFiber = null;
					for (var parent = finishedWork.return; null !== parent;) {
						if (isFragmentInstanceParent(parent)) {
							var fragmentInstance = parent.stateNode;
							null === parentFiber ? parentFiber = [fragmentInstance] : parentFiber.push(fragmentInstance);
						}
						if (isFragmentInstanceHostBoundary(parent)) break;
						parent = parent.return;
					}
					var JSCompiler_inline_result = parentFiber;
					if (null == hostParentFiber) throw Error(formatProdErrorMessage(160));
					switch (hostParentFiber.tag) {
						case 27:
							var parent$jscomp$0 = hostParentFiber.stateNode;
							insertOrAppendPlacementNode(finishedWork, getHostSibling(finishedWork), parent$jscomp$0, JSCompiler_inline_result);
							break;
						case 5:
							var parent$149 = hostParentFiber.stateNode;
							hostParentFiber.flags & 32 && (setTextContent(parent$149, ""), hostParentFiber.flags &= -33);
							insertOrAppendPlacementNode(finishedWork, getHostSibling(finishedWork), parent$149, JSCompiler_inline_result);
							break;
						case 3:
						case 4:
							var parent$151 = hostParentFiber.stateNode.containerInfo;
							insertOrAppendPlacementNodeIntoContainer(finishedWork, getHostSibling(finishedWork), parent$151, JSCompiler_inline_result);
							break;
						default: throw Error(formatProdErrorMessage(161));
					}
				} catch (error) {
					captureCommitPhaseError(finishedWork, finishedWork.return, error);
				}
				finishedWork.flags &= -3;
			}
			flags & 4096 && (finishedWork.flags &= -4097);
		}
		function recursivelyResetForms(parentFiber) {
			if (parentFiber.subtreeFlags & 1024) for (parentFiber = parentFiber.child; null !== parentFiber;) {
				var fiber = parentFiber;
				recursivelyResetForms(fiber);
				5 === fiber.tag && fiber.flags & 1024 && (fiber = fiber.stateNode, _enabled = !0, fiber.reset(), _enabled = !1);
				parentFiber = parentFiber.sibling;
			}
		}
		function recursivelyTraverseAfterMutationEffects(root, parentFiber) {
			if (parentFiber.subtreeFlags & 9270) for (parentFiber = parentFiber.child; null !== parentFiber;) commitAfterMutationEffectsOnFiber(parentFiber, root), parentFiber = parentFiber.sibling;
			else measureNestedViewTransitions(parentFiber, !1);
		}
		function commitAfterMutationEffectsOnFiber(finishedWork, root) {
			var current = finishedWork.alternate;
			if (null === current) commitEnterViewTransitions(finishedWork, !1);
			else switch (finishedWork.tag) {
				case 3:
					rootViewTransitionNameCanceled = viewTransitionContextChanged = !1;
					pushViewTransitionCancelableScope();
					recursivelyTraverseAfterMutationEffects(root, finishedWork);
					if (!viewTransitionContextChanged && !rootViewTransitionAffected) {
						finishedWork = viewTransitionCancelableChildren;
						if (null !== finishedWork) for (var i = 0; i < finishedWork.length; i += 3) {
							current = finishedWork[i];
							var oldName = finishedWork[i + 1];
							restoreViewTransitionName(current, finishedWork[i + 2]);
							current = current.ownerDocument.documentElement;
							null !== current && current.animate({
								opacity: [0, 0],
								pointerEvents: ["none", "none"]
							}, {
								duration: 0,
								fill: "forwards",
								pseudoElement: "::view-transition-group(" + oldName + ")"
							});
						}
						finishedWork = root.containerInfo;
						finishedWork = 9 === finishedWork.nodeType ? finishedWork.documentElement : finishedWork.ownerDocument.documentElement;
						null !== finishedWork && "" === finishedWork.style.viewTransitionName && (finishedWork.style.viewTransitionName = "none", finishedWork.animate({
							opacity: [0, 0],
							pointerEvents: ["none", "none"]
						}, {
							duration: 0,
							fill: "forwards",
							pseudoElement: "::view-transition-group(root)"
						}), finishedWork.animate({
							width: [0, 0],
							height: [0, 0]
						}, {
							duration: 0,
							fill: "forwards",
							pseudoElement: "::view-transition"
						}));
						rootViewTransitionNameCanceled = !0;
					}
					viewTransitionCancelableChildren = null;
					break;
				case 5:
					recursivelyTraverseAfterMutationEffects(root, finishedWork);
					break;
				case 4:
					i = viewTransitionContextChanged;
					viewTransitionContextChanged = !1;
					recursivelyTraverseAfterMutationEffects(root, finishedWork);
					viewTransitionContextChanged && (rootViewTransitionAffected = !0);
					viewTransitionContextChanged = i;
					break;
				case 22:
					null === finishedWork.memoizedState && (null !== current.memoizedState ? commitEnterViewTransitions(finishedWork, !1) : recursivelyTraverseAfterMutationEffects(root, finishedWork));
					break;
				case 30:
					i = viewTransitionContextChanged;
					oldName = pushViewTransitionCancelableScope();
					viewTransitionContextChanged = !1;
					recursivelyTraverseAfterMutationEffects(root, finishedWork);
					viewTransitionContextChanged && (finishedWork.flags |= 4);
					var props = finishedWork.memoizedProps, state = finishedWork.stateNode;
					root = getViewTransitionName(props, state);
					state = getViewTransitionName(current.memoizedProps, state);
					var className = getViewTransitionClassName(props.default, props.update);
					"none" === className ? root = !1 : (props = current.memoizedState, current.memoizedState = null, current = finishedWork.child, viewTransitionHostInstanceIdx = 0, root = measureViewTransitionHostInstancesRecursive(finishedWork, current, root, state, className, props, !0), viewTransitionHostInstanceIdx !== (null === props ? 0 : props.length) && (finishedWork.flags |= 32));
					0 !== (finishedWork.flags & 4) && root ? (scheduleViewTransitionEvent(finishedWork, finishedWork.memoizedProps.onUpdate), viewTransitionCancelableChildren = oldName) : null !== oldName && (oldName.push.apply(oldName, viewTransitionCancelableChildren), viewTransitionCancelableChildren = oldName);
					viewTransitionContextChanged = 0 !== (finishedWork.flags & 32) ? !0 : i;
					break;
				default: recursivelyTraverseAfterMutationEffects(root, finishedWork);
			}
		}
		function recursivelyTraverseLayoutEffects(root, parentFiber) {
			if (parentFiber.subtreeFlags & 8772) for (parentFiber = parentFiber.child; null !== parentFiber;) commitLayoutEffectOnFiber(root, parentFiber.alternate, parentFiber), parentFiber = parentFiber.sibling;
		}
		function recursivelyTraverseDisappearLayoutEffects(parentFiber, layoutEffectTraversalFlags$jscomp$0) {
			for (parentFiber = parentFiber.child; null !== parentFiber;) {
				var finishedWork = parentFiber, layoutEffectTraversalFlags = layoutEffectTraversalFlags$jscomp$0;
				switch (finishedWork.tag) {
					case 0:
					case 11:
					case 14:
					case 15:
						commitHookEffectListUnmount(4, finishedWork, finishedWork.return);
						recursivelyTraverseDisappearLayoutEffects(finishedWork, layoutEffectTraversalFlags);
						break;
					case 1:
						safelyDetachRef(finishedWork, finishedWork.return);
						var instance = finishedWork.stateNode;
						"function" === typeof instance.componentWillUnmount && safelyCallComponentWillUnmount(finishedWork, finishedWork.return, instance);
						recursivelyTraverseDisappearLayoutEffects(finishedWork, layoutEffectTraversalFlags);
						break;
					case 27: 0 !== (layoutEffectTraversalFlags & 2) && releaseSingletonInstance(finishedWork.stateNode, finishedWork.type, finishedWork.memoizedProps);
					case 5:
						safelyDetachRef(finishedWork, finishedWork.return);
						5 !== finishedWork.tag && 27 !== finishedWork.tag || commitFragmentInstanceDeletionEffects(finishedWork);
						recursivelyTraverseDisappearLayoutEffects(finishedWork, layoutEffectTraversalFlags);
						break;
					case 6:
						commitFragmentInstanceDeletionEffects(finishedWork);
						break;
					case 26:
						safelyDetachRef(finishedWork, finishedWork.return);
						instance = finishedWork.stateNode;
						null !== finishedWork.memoizedState || null === instance || offscreenSubtreeWasHidden || instance.parentNode.removeChild(instance);
						recursivelyTraverseDisappearLayoutEffects(finishedWork, layoutEffectTraversalFlags);
						break;
					case 22:
						null === finishedWork.memoizedState && recursivelyTraverseDisappearLayoutEffects(finishedWork, layoutEffectTraversalFlags);
						break;
					case 30:
						safelyDetachRef(finishedWork, finishedWork.return);
						recursivelyTraverseDisappearLayoutEffects(finishedWork, layoutEffectTraversalFlags);
						break;
					case 7: safelyDetachRef(finishedWork, finishedWork.return);
					default: recursivelyTraverseDisappearLayoutEffects(finishedWork, layoutEffectTraversalFlags);
				}
				parentFiber = parentFiber.sibling;
			}
		}
		function recursivelyTraverseReappearLayoutEffects(finishedRoot$jscomp$0, parentFiber, layoutEffectTraversalFlags) {
			layoutEffectTraversalFlags = 0 !== (parentFiber.subtreeFlags & 8772) ? layoutEffectTraversalFlags : layoutEffectTraversalFlags & -2;
			for (parentFiber = parentFiber.child; null !== parentFiber;) {
				var current = parentFiber.alternate, finishedRoot = finishedRoot$jscomp$0, finishedWork = parentFiber, flags = finishedWork.flags, includeWorkInProgressEffects = 0 !== (layoutEffectTraversalFlags & 1);
				switch (finishedWork.tag) {
					case 0:
					case 11:
					case 15:
						recursivelyTraverseReappearLayoutEffects(finishedRoot, finishedWork, layoutEffectTraversalFlags);
						commitHookEffectListMount(4, finishedWork);
						break;
					case 1:
						recursivelyTraverseReappearLayoutEffects(finishedRoot, finishedWork, layoutEffectTraversalFlags);
						current = finishedWork;
						finishedRoot = current.stateNode;
						if ("function" === typeof finishedRoot.componentDidMount) try {
							finishedRoot.componentDidMount();
						} catch (error) {
							captureCommitPhaseError(current, current.return, error);
						}
						current = finishedWork;
						finishedRoot = current.updateQueue;
						if (null !== finishedRoot) {
							var instance = current.stateNode;
							try {
								var hiddenCallbacks = finishedRoot.shared.hiddenCallbacks;
								if (null !== hiddenCallbacks) for (finishedRoot.shared.hiddenCallbacks = null, finishedRoot = 0; finishedRoot < hiddenCallbacks.length; finishedRoot++) callCallback(hiddenCallbacks[finishedRoot], instance);
							} catch (error) {
								captureCommitPhaseError(current, current.return, error);
							}
						}
						includeWorkInProgressEffects && flags & 64 && commitClassCallbacks(finishedWork);
						safelyAttachRef(finishedWork, finishedWork.return);
						break;
					case 27: 0 !== (layoutEffectTraversalFlags & 2) && commitHostSingletonAcquisition(finishedWork);
					case 5:
						5 !== finishedWork.tag && 27 !== finishedWork.tag || commitFragmentInstanceInsertionEffects(finishedWork);
						recursivelyTraverseReappearLayoutEffects(finishedRoot, finishedWork, layoutEffectTraversalFlags);
						includeWorkInProgressEffects && null === current && flags & 4 && commitHostMount(finishedWork);
						safelyAttachRef(finishedWork, finishedWork.return);
						break;
					case 6:
						commitFragmentInstanceInsertionEffects(finishedWork);
						break;
					case 26:
						instance = finishedWork.stateNode;
						null !== finishedWork.memoizedState || null === instance || offscreenSubtreeIsHidden || mountHoistable(getHoistableRoot(instance.ownerDocument), finishedWork.type, instance);
						recursivelyTraverseReappearLayoutEffects(finishedRoot, finishedWork, layoutEffectTraversalFlags);
						includeWorkInProgressEffects && null === current && flags & 4 && commitHostMount(finishedWork);
						safelyAttachRef(finishedWork, finishedWork.return);
						break;
					case 12:
						recursivelyTraverseReappearLayoutEffects(finishedRoot, finishedWork, layoutEffectTraversalFlags);
						break;
					case 31:
						recursivelyTraverseReappearLayoutEffects(finishedRoot, finishedWork, layoutEffectTraversalFlags);
						includeWorkInProgressEffects && flags & 4 && commitActivityHydrationCallbacks(finishedRoot, finishedWork);
						break;
					case 13:
						recursivelyTraverseReappearLayoutEffects(finishedRoot, finishedWork, layoutEffectTraversalFlags);
						includeWorkInProgressEffects && flags & 4 && commitSuspenseHydrationCallbacks(finishedRoot, finishedWork);
						break;
					case 22:
						null === finishedWork.memoizedState && recursivelyTraverseReappearLayoutEffects(finishedRoot, finishedWork, layoutEffectTraversalFlags);
						safelyAttachRef(finishedWork, finishedWork.return);
						break;
					case 30:
						recursivelyTraverseReappearLayoutEffects(finishedRoot, finishedWork, layoutEffectTraversalFlags);
						safelyAttachRef(finishedWork, finishedWork.return);
						break;
					case 7: safelyAttachRef(finishedWork, finishedWork.return);
					default: recursivelyTraverseReappearLayoutEffects(finishedRoot, finishedWork, layoutEffectTraversalFlags);
				}
				parentFiber = parentFiber.sibling;
			}
		}
		function commitOffscreenPassiveMountEffects(current, finishedWork) {
			var previousCache = null;
			null !== current && null !== current.memoizedState && null !== current.memoizedState.cachePool && (previousCache = current.memoizedState.cachePool.pool);
			current = null;
			null !== finishedWork.memoizedState && null !== finishedWork.memoizedState.cachePool && (current = finishedWork.memoizedState.cachePool.pool);
			current !== previousCache && (null != current && current.refCount++, null != previousCache && releaseCache(previousCache));
		}
		function commitCachePassiveMountEffect(current, finishedWork) {
			current = null;
			null !== finishedWork.alternate && (current = finishedWork.alternate.memoizedState.cache);
			finishedWork = finishedWork.memoizedState.cache;
			finishedWork !== current && (finishedWork.refCount++, null != current && releaseCache(current));
		}
		function recursivelyTraversePassiveMountEffects(root, parentFiber, committedLanes, committedTransitions) {
			var isViewTransitionEligible = (committedLanes & 335544064) === committedLanes;
			if (parentFiber.subtreeFlags & (isViewTransitionEligible ? 10262 : 10256)) for (parentFiber = parentFiber.child; null !== parentFiber;) commitPassiveMountOnFiber(root, parentFiber, committedLanes, committedTransitions), parentFiber = parentFiber.sibling;
			else isViewTransitionEligible && restoreNestedViewTransitions(parentFiber);
		}
		function commitPassiveMountOnFiber(finishedRoot, finishedWork, committedLanes, committedTransitions) {
			var isViewTransitionEligible = (committedLanes & 335544064) === committedLanes;
			isViewTransitionEligible && null === finishedWork.alternate && null !== finishedWork.return && null !== finishedWork.return.alternate && restoreEnterOrExitViewTransitions(finishedWork);
			var flags = finishedWork.flags;
			switch (finishedWork.tag) {
				case 0:
				case 11:
				case 15:
					recursivelyTraversePassiveMountEffects(finishedRoot, finishedWork, committedLanes, committedTransitions);
					flags & 2048 && commitHookEffectListMount(9, finishedWork);
					break;
				case 1:
					recursivelyTraversePassiveMountEffects(finishedRoot, finishedWork, committedLanes, committedTransitions);
					break;
				case 3:
					recursivelyTraversePassiveMountEffects(finishedRoot, finishedWork, committedLanes, committedTransitions);
					isViewTransitionEligible && rootViewTransitionNameCanceled && (finishedRoot = finishedRoot.containerInfo, finishedRoot = 9 === finishedRoot.nodeType ? finishedRoot.body : "HTML" === finishedRoot.nodeName ? finishedRoot.ownerDocument.body : finishedRoot, "root" === finishedRoot.style.viewTransitionName && (finishedRoot.style.viewTransitionName = ""), finishedRoot = finishedRoot.ownerDocument.documentElement, null !== finishedRoot && "none" === finishedRoot.style.viewTransitionName && (finishedRoot.style.viewTransitionName = ""));
					flags & 2048 && (flags = null, null !== finishedWork.alternate && (flags = finishedWork.alternate.memoizedState.cache), finishedWork = finishedWork.memoizedState.cache, finishedWork !== flags && (finishedWork.refCount++, null != flags && releaseCache(flags)));
					break;
				case 12:
					if (flags & 2048) {
						recursivelyTraversePassiveMountEffects(finishedRoot, finishedWork, committedLanes, committedTransitions);
						flags = finishedWork.stateNode;
						try {
							var _finishedWork$memoize2 = finishedWork.memoizedProps, id = _finishedWork$memoize2.id, onPostCommit = _finishedWork$memoize2.onPostCommit;
							"function" === typeof onPostCommit && onPostCommit(id, null === finishedWork.alternate ? "mount" : "update", flags.passiveEffectDuration, -0);
						} catch (error) {
							captureCommitPhaseError(finishedWork, finishedWork.return, error);
						}
					} else recursivelyTraversePassiveMountEffects(finishedRoot, finishedWork, committedLanes, committedTransitions);
					break;
				case 31:
					recursivelyTraversePassiveMountEffects(finishedRoot, finishedWork, committedLanes, committedTransitions);
					break;
				case 13:
					recursivelyTraversePassiveMountEffects(finishedRoot, finishedWork, committedLanes, committedTransitions);
					break;
				case 23: break;
				case 22:
					_finishedWork$memoize2 = finishedWork.stateNode;
					id = finishedWork.alternate;
					null !== finishedWork.memoizedState ? (isViewTransitionEligible && null !== id && null === id.memoizedState && restoreEnterOrExitViewTransitions(id), _finishedWork$memoize2._visibility & 2 ? recursivelyTraversePassiveMountEffects(finishedRoot, finishedWork, committedLanes, committedTransitions) : recursivelyTraverseAtomicPassiveEffects(finishedRoot, finishedWork)) : (isViewTransitionEligible && null !== id && null !== id.memoizedState && restoreEnterOrExitViewTransitions(finishedWork), _finishedWork$memoize2._visibility & 2 ? recursivelyTraversePassiveMountEffects(finishedRoot, finishedWork, committedLanes, committedTransitions) : (_finishedWork$memoize2._visibility |= 2, recursivelyTraverseReconnectPassiveEffects(finishedRoot, finishedWork, committedLanes, committedTransitions, 0 !== (finishedWork.subtreeFlags & 10256) || !1)));
					flags & 2048 && commitOffscreenPassiveMountEffects(id, finishedWork);
					break;
				case 24:
					recursivelyTraversePassiveMountEffects(finishedRoot, finishedWork, committedLanes, committedTransitions);
					flags & 2048 && commitCachePassiveMountEffect(finishedWork.alternate, finishedWork);
					break;
				case 30:
					isViewTransitionEligible && (flags = finishedWork.alternate, null !== flags && (restoreViewTransitionOnHostInstances(flags.child, !0), restoreViewTransitionOnHostInstances(finishedWork.child, !0)));
					recursivelyTraversePassiveMountEffects(finishedRoot, finishedWork, committedLanes, committedTransitions);
					break;
				default: recursivelyTraversePassiveMountEffects(finishedRoot, finishedWork, committedLanes, committedTransitions);
			}
		}
		function recursivelyTraverseReconnectPassiveEffects(finishedRoot$jscomp$0, parentFiber, committedLanes$jscomp$0, committedTransitions$jscomp$0, includeWorkInProgressEffects) {
			includeWorkInProgressEffects = includeWorkInProgressEffects && (0 !== (parentFiber.subtreeFlags & 10256) || !1);
			for (parentFiber = parentFiber.child; null !== parentFiber;) {
				var finishedRoot = finishedRoot$jscomp$0, finishedWork = parentFiber, committedLanes = committedLanes$jscomp$0, committedTransitions = committedTransitions$jscomp$0, flags = finishedWork.flags;
				switch (finishedWork.tag) {
					case 0:
					case 11:
					case 15:
						recursivelyTraverseReconnectPassiveEffects(finishedRoot, finishedWork, committedLanes, committedTransitions, includeWorkInProgressEffects);
						commitHookEffectListMount(8, finishedWork);
						break;
					case 23: break;
					case 22:
						var instance = finishedWork.stateNode;
						null !== finishedWork.memoizedState ? instance._visibility & 2 ? recursivelyTraverseReconnectPassiveEffects(finishedRoot, finishedWork, committedLanes, committedTransitions, includeWorkInProgressEffects) : recursivelyTraverseAtomicPassiveEffects(finishedRoot, finishedWork) : (instance._visibility |= 2, recursivelyTraverseReconnectPassiveEffects(finishedRoot, finishedWork, committedLanes, committedTransitions, includeWorkInProgressEffects));
						includeWorkInProgressEffects && flags & 2048 && commitOffscreenPassiveMountEffects(finishedWork.alternate, finishedWork);
						break;
					case 24:
						recursivelyTraverseReconnectPassiveEffects(finishedRoot, finishedWork, committedLanes, committedTransitions, includeWorkInProgressEffects);
						includeWorkInProgressEffects && flags & 2048 && commitCachePassiveMountEffect(finishedWork.alternate, finishedWork);
						break;
					default: recursivelyTraverseReconnectPassiveEffects(finishedRoot, finishedWork, committedLanes, committedTransitions, includeWorkInProgressEffects);
				}
				parentFiber = parentFiber.sibling;
			}
		}
		function recursivelyTraverseAtomicPassiveEffects(finishedRoot$jscomp$0, parentFiber) {
			if (parentFiber.subtreeFlags & 10256) for (parentFiber = parentFiber.child; null !== parentFiber;) {
				var finishedRoot = finishedRoot$jscomp$0, finishedWork = parentFiber, flags = finishedWork.flags;
				switch (finishedWork.tag) {
					case 22:
						recursivelyTraverseAtomicPassiveEffects(finishedRoot, finishedWork);
						flags & 2048 && commitOffscreenPassiveMountEffects(finishedWork.alternate, finishedWork);
						break;
					case 24:
						recursivelyTraverseAtomicPassiveEffects(finishedRoot, finishedWork);
						flags & 2048 && commitCachePassiveMountEffect(finishedWork.alternate, finishedWork);
						break;
					default: recursivelyTraverseAtomicPassiveEffects(finishedRoot, finishedWork);
				}
				parentFiber = parentFiber.sibling;
			}
		}
		var suspenseyCommitFlag = 8192;
		function recursivelyAccumulateSuspenseyCommit(parentFiber, committedLanes, suspendedState) {
			if (parentFiber.subtreeFlags & suspenseyCommitFlag) for (parentFiber = parentFiber.child; null !== parentFiber;) accumulateSuspenseyCommitOnFiber(parentFiber, committedLanes, suspendedState), parentFiber = parentFiber.sibling;
		}
		function accumulateSuspenseyCommitOnFiber(fiber, committedLanes, suspendedState) {
			switch (fiber.tag) {
				case 26:
					recursivelyAccumulateSuspenseyCommit(fiber, committedLanes, suspendedState);
					fiber.flags & suspenseyCommitFlag && (null !== fiber.memoizedState ? suspendResource(suspendedState, currentHoistableRoot, fiber.memoizedState, fiber.memoizedProps) : (fiber = fiber.stateNode, (committedLanes & 335544128) === committedLanes && suspendInstance(suspendedState, fiber)));
					break;
				case 5:
					recursivelyAccumulateSuspenseyCommit(fiber, committedLanes, suspendedState);
					fiber.flags & suspenseyCommitFlag && (fiber = fiber.stateNode, (committedLanes & 335544128) === committedLanes && suspendInstance(suspendedState, fiber));
					break;
				case 3:
				case 4:
					var previousHoistableRoot = currentHoistableRoot;
					currentHoistableRoot = getHoistableRoot(fiber.stateNode.containerInfo);
					recursivelyAccumulateSuspenseyCommit(fiber, committedLanes, suspendedState);
					currentHoistableRoot = previousHoistableRoot;
					break;
				case 22:
					null === fiber.memoizedState && (previousHoistableRoot = fiber.alternate, null !== previousHoistableRoot && null !== previousHoistableRoot.memoizedState ? (previousHoistableRoot = suspenseyCommitFlag, suspenseyCommitFlag = 16777216, recursivelyAccumulateSuspenseyCommit(fiber, committedLanes, suspendedState), suspenseyCommitFlag = previousHoistableRoot) : recursivelyAccumulateSuspenseyCommit(fiber, committedLanes, suspendedState));
					break;
				case 30:
					if (0 !== (fiber.flags & suspenseyCommitFlag) && (previousHoistableRoot = fiber.memoizedProps.name, null != previousHoistableRoot && "auto" !== previousHoistableRoot)) {
						var state = fiber.stateNode;
						state.paired = null;
						null === appearingViewTransitions && (appearingViewTransitions = new Map());
						appearingViewTransitions.set(previousHoistableRoot, state);
					}
					recursivelyAccumulateSuspenseyCommit(fiber, committedLanes, suspendedState);
					break;
				default: recursivelyAccumulateSuspenseyCommit(fiber, committedLanes, suspendedState);
			}
		}
		function detachAlternateSiblings(parentFiber) {
			var previousFiber = parentFiber.alternate;
			if (null !== previousFiber && (parentFiber = previousFiber.child, null !== parentFiber)) {
				previousFiber.child = null;
				do
					previousFiber = parentFiber.sibling, parentFiber.sibling = null, parentFiber = previousFiber;
				while (null !== parentFiber);
			}
		}
		function recursivelyTraversePassiveUnmountEffects(parentFiber) {
			var deletions = parentFiber.deletions;
			if (0 !== (parentFiber.flags & 16)) {
				if (null !== deletions) for (var i = 0; i < deletions.length; i++) {
					var childToDelete = deletions[i];
					nextEffect = childToDelete;
					commitPassiveUnmountEffectsInsideOfDeletedTree_begin(childToDelete, parentFiber);
				}
				detachAlternateSiblings(parentFiber);
			}
			if (parentFiber.subtreeFlags & 10256) for (parentFiber = parentFiber.child; null !== parentFiber;) commitPassiveUnmountOnFiber(parentFiber), parentFiber = parentFiber.sibling;
		}
		function commitPassiveUnmountOnFiber(finishedWork) {
			switch (finishedWork.tag) {
				case 0:
				case 11:
				case 15:
					recursivelyTraversePassiveUnmountEffects(finishedWork);
					finishedWork.flags & 2048 && commitHookEffectListUnmount(9, finishedWork, finishedWork.return);
					break;
				case 3:
					recursivelyTraversePassiveUnmountEffects(finishedWork);
					break;
				case 12:
					recursivelyTraversePassiveUnmountEffects(finishedWork);
					break;
				case 22:
					var instance = finishedWork.stateNode;
					null !== finishedWork.memoizedState && instance._visibility & 2 && (null === finishedWork.return || 13 !== finishedWork.return.tag) ? (instance._visibility &= -3, recursivelyTraverseDisconnectPassiveEffects(finishedWork)) : recursivelyTraversePassiveUnmountEffects(finishedWork);
					break;
				default: recursivelyTraversePassiveUnmountEffects(finishedWork);
			}
		}
		function recursivelyTraverseDisconnectPassiveEffects(parentFiber) {
			var deletions = parentFiber.deletions;
			if (0 !== (parentFiber.flags & 16)) {
				if (null !== deletions) for (var i = 0; i < deletions.length; i++) {
					var childToDelete = deletions[i];
					nextEffect = childToDelete;
					commitPassiveUnmountEffectsInsideOfDeletedTree_begin(childToDelete, parentFiber);
				}
				detachAlternateSiblings(parentFiber);
			}
			for (parentFiber = parentFiber.child; null !== parentFiber;) {
				deletions = parentFiber;
				switch (deletions.tag) {
					case 0:
					case 11:
					case 15:
						commitHookEffectListUnmount(8, deletions, deletions.return);
						recursivelyTraverseDisconnectPassiveEffects(deletions);
						break;
					case 22:
						i = deletions.stateNode;
						i._visibility & 2 && (i._visibility &= -3, recursivelyTraverseDisconnectPassiveEffects(deletions));
						break;
					default: recursivelyTraverseDisconnectPassiveEffects(deletions);
				}
				parentFiber = parentFiber.sibling;
			}
		}
		function commitPassiveUnmountEffectsInsideOfDeletedTree_begin(deletedSubtreeRoot, nearestMountedAncestor) {
			for (; null !== nextEffect;) {
				var fiber = nextEffect;
				switch (fiber.tag) {
					case 0:
					case 11:
					case 15:
						commitHookEffectListUnmount(8, fiber, nearestMountedAncestor);
						break;
					case 23:
					case 22:
						if (null !== fiber.memoizedState && null !== fiber.memoizedState.cachePool) {
							var cache = fiber.memoizedState.cachePool.pool;
							null != cache && cache.refCount++;
						}
						break;
					case 24: releaseCache(fiber.memoizedState.cache);
				}
				cache = fiber.child;
				if (null !== cache) cache.return = fiber, nextEffect = cache;
				else a: for (fiber = deletedSubtreeRoot; null !== nextEffect;) {
					cache = nextEffect;
					var sibling = cache.sibling, returnFiber = cache.return;
					detachFiberAfterEffects(cache);
					if (cache === fiber) {
						nextEffect = null;
						break a;
					}
					if (null !== sibling) {
						sibling.return = returnFiber;
						nextEffect = sibling;
						break a;
					}
					nextEffect = returnFiber;
				}
			}
		}
		var DefaultAsyncDispatcher = {
			getCacheForType: function(resourceType) {
				var cache = readContext(CacheContext), cacheForType = cache.data.get(resourceType);
				void 0 === cacheForType && (cacheForType = resourceType(), cache.data.set(resourceType, cacheForType));
				return cacheForType;
			},
			cacheSignal: function() {
				return readContext(CacheContext).controller.signal;
			}
		};
		var PossiblyWeakMap = "function" === typeof WeakMap ? WeakMap : Map;
		var executionContext = 0;
		var workInProgressRoot = null;
		var workInProgress = null;
		var workInProgressRootRenderLanes = 0;
		var workInProgressSuspendedReason = 0;
		var workInProgressThrownValue = null;
		var workInProgressRootDidSkipSuspendedSiblings = !1;
		var workInProgressRootIsPrerendering = !1;
		var workInProgressRootDidAttachPingListener = !1;
		var entangledRenderLanes = 0;
		var workInProgressRootExitStatus = 0;
		var workInProgressRootSkippedLanes = 0;
		var workInProgressRootInterleavedUpdatedLanes = 0;
		var workInProgressRootPingedLanes = 0;
		var workInProgressDeferredLane = 0;
		var workInProgressSuspendedRetryLanes = 0;
		var workInProgressRootConcurrentErrors = null;
		var workInProgressRootRecoverableErrors = null;
		var workInProgressRootDidIncludeRecursiveRenderUpdate = !1;
		var globalMostRecentFallbackTime = 0;
		var globalMostRecentTransitionTime = 0;
		var workInProgressRootRenderTargetTime = Infinity;
		var workInProgressTransitions = null;
		var legacyErrorBoundariesThatAlreadyFailed = null;
		var pendingEffectsStatus = 0;
		var pendingEffectsRoot = null;
		var pendingFinishedWork = null;
		var pendingEffectsLanes = 0;
		var pendingEffectsRemainingLanes = 0;
		var pendingPassiveTransitions = null;
		var pendingRecoverableErrors = null;
		var pendingViewTransition = null;
		var pendingViewTransitionEvents = null;
		var pendingTransitionTypes = null;
		var nestedUpdateCount = 0;
		var rootWithNestedUpdates = null;
		function requestUpdateLane() {
			return 0 !== (executionContext & 2) && 0 !== workInProgressRootRenderLanes ? workInProgressRootRenderLanes & -workInProgressRootRenderLanes : null !== ReactSharedInternals.T ? requestTransitionLane() : resolveUpdatePriority();
		}
		function requestDeferredLane() {
			if (0 === workInProgressDeferredLane) if (0 === (workInProgressRootRenderLanes & 536870912) || isHydrating) {
				var lane = nextTransitionDeferredLane;
				nextTransitionDeferredLane <<= 1;
				0 === (nextTransitionDeferredLane & 3932160) && (nextTransitionDeferredLane = 262144);
				workInProgressDeferredLane = lane;
			} else workInProgressDeferredLane = 536870912;
			lane = suspenseHandlerStackCursor.current;
			null !== lane && (lane.flags |= 32);
			return workInProgressDeferredLane;
		}
		function scheduleViewTransitionEvent(fiber, callback) {
			if (null != callback) {
				var state = fiber.stateNode, instance = state.ref;
				null === instance && (instance = state.ref = createViewTransitionInstance(getViewTransitionName(fiber.memoizedProps, state)));
				null === pendingViewTransitionEvents && (pendingViewTransitionEvents = []);
				pendingViewTransitionEvents.push(callback.bind(null, instance));
			}
		}
		function scheduleUpdateOnFiber(root, fiber, lane) {
			if (root === workInProgressRoot && (2 === workInProgressSuspendedReason || 9 === workInProgressSuspendedReason) || null !== root.cancelPendingCommit) prepareFreshStack(root, 0), markRootSuspended(root, workInProgressRootRenderLanes, workInProgressDeferredLane, !1);
			markRootUpdated$1(root, lane);
			if (0 === (executionContext & 2) || root !== workInProgressRoot) root === workInProgressRoot && (0 === (executionContext & 2) && (workInProgressRootInterleavedUpdatedLanes |= lane), 4 === workInProgressRootExitStatus && markRootSuspended(root, workInProgressRootRenderLanes, workInProgressDeferredLane, !1)), ensureRootIsScheduled(root);
		}
		function performWorkOnRoot(root$jscomp$0, lanes, forceSync) {
			if (0 !== (executionContext & 6)) throw Error(formatProdErrorMessage(327));
			var shouldTimeSlice = !forceSync && 0 === (lanes & 127) && 0 === (lanes & root$jscomp$0.expiredLanes) || checkIfRootIsPrerendering(root$jscomp$0, lanes), exitStatus = shouldTimeSlice ? renderRootConcurrent(root$jscomp$0, lanes) : renderRootSync(root$jscomp$0, lanes, !0), renderWasConcurrent = shouldTimeSlice;
			do {
				if (0 === exitStatus) {
					workInProgressRootIsPrerendering && !shouldTimeSlice && markRootSuspended(root$jscomp$0, lanes, 0, !1);
					break;
				} else {
					forceSync = root$jscomp$0.current.alternate;
					if (renderWasConcurrent && !isRenderConsistentWithExternalStores(forceSync)) {
						exitStatus = renderRootSync(root$jscomp$0, lanes, !1);
						renderWasConcurrent = !1;
						continue;
					}
					if (2 === exitStatus) {
						renderWasConcurrent = lanes;
						if (root$jscomp$0.errorRecoveryDisabledLanes & renderWasConcurrent) var JSCompiler_inline_result = 0;
						else JSCompiler_inline_result = root$jscomp$0.pendingLanes & -536870913, JSCompiler_inline_result = 0 !== JSCompiler_inline_result ? JSCompiler_inline_result : JSCompiler_inline_result & 536870912 ? 536870912 : 0;
						if (0 !== JSCompiler_inline_result) {
							lanes = JSCompiler_inline_result;
							a: {
								var root = root$jscomp$0;
								exitStatus = workInProgressRootConcurrentErrors;
								var wasRootDehydrated = root.current.memoizedState.isDehydrated;
								wasRootDehydrated && (prepareFreshStack(root, JSCompiler_inline_result).flags |= 256);
								JSCompiler_inline_result = renderRootSync(root, JSCompiler_inline_result, !1);
								if (2 !== JSCompiler_inline_result && 6 !== JSCompiler_inline_result) {
									if (workInProgressRootDidAttachPingListener && !wasRootDehydrated) {
										root.errorRecoveryDisabledLanes |= renderWasConcurrent;
										workInProgressRootInterleavedUpdatedLanes |= renderWasConcurrent;
										exitStatus = 4;
										break a;
									}
									renderWasConcurrent = workInProgressRootRecoverableErrors;
									workInProgressRootRecoverableErrors = exitStatus;
									null !== renderWasConcurrent && (null === workInProgressRootRecoverableErrors ? workInProgressRootRecoverableErrors = renderWasConcurrent : workInProgressRootRecoverableErrors.push.apply(workInProgressRootRecoverableErrors, renderWasConcurrent));
								}
								exitStatus = JSCompiler_inline_result;
							}
							renderWasConcurrent = !1;
							if (2 !== exitStatus) continue;
						}
					}
					if (1 === exitStatus) {
						prepareFreshStack(root$jscomp$0, 0);
						markRootSuspended(root$jscomp$0, lanes, 0, !0);
						break;
					}
					a: {
						shouldTimeSlice = root$jscomp$0;
						renderWasConcurrent = exitStatus;
						switch (renderWasConcurrent) {
							case 0:
							case 1: throw Error(formatProdErrorMessage(345));
							case 4: if ((lanes & 4194048) !== lanes && (lanes & 62914560) !== lanes) break;
							case 6:
								markRootSuspended(shouldTimeSlice, lanes, workInProgressDeferredLane, !workInProgressRootDidSkipSuspendedSiblings);
								break a;
							case 2:
								workInProgressRootRecoverableErrors = null;
								break;
							case 3:
							case 5: break;
							default: throw Error(formatProdErrorMessage(329));
						}
						if ((lanes & 62914560) === lanes && (exitStatus = globalMostRecentFallbackTime + 300 - now(), 10 < exitStatus)) {
							markRootSuspended(shouldTimeSlice, lanes, workInProgressDeferredLane, !workInProgressRootDidSkipSuspendedSiblings);
							if (0 !== getNextLanes(shouldTimeSlice, 0, !0)) break a;
							pendingEffectsLanes = lanes;
							shouldTimeSlice.timeoutHandle = scheduleTimeout(completeRootWhenReady.bind(null, shouldTimeSlice, forceSync, workInProgressRootRecoverableErrors, workInProgressTransitions, workInProgressRootDidIncludeRecursiveRenderUpdate, lanes, workInProgressDeferredLane, workInProgressRootInterleavedUpdatedLanes, workInProgressSuspendedRetryLanes, workInProgressRootDidSkipSuspendedSiblings, renderWasConcurrent, "Throttled", -0, 0), exitStatus);
							break a;
						}
						completeRootWhenReady(shouldTimeSlice, forceSync, workInProgressRootRecoverableErrors, workInProgressTransitions, workInProgressRootDidIncludeRecursiveRenderUpdate, lanes, workInProgressDeferredLane, workInProgressRootInterleavedUpdatedLanes, workInProgressSuspendedRetryLanes, workInProgressRootDidSkipSuspendedSiblings, renderWasConcurrent, null, -0, 0);
					}
				}
				break;
			} while (1);
			ensureRootIsScheduled(root$jscomp$0);
		}
		function completeRootWhenReady(root, finishedWork, recoverableErrors, transitions, didIncludeRenderPhaseUpdate, lanes, spawnedLane, updatedLanes, suspendedRetryLanes, didSkipSuspendedSiblings, exitStatus, suspendedCommitReason, completedRenderStartTime, completedRenderEndTime) {
			root.timeoutHandle = -1;
			var subtreeFlags = finishedWork.subtreeFlags, isViewTransitionEligible = (lanes & 335544064) === lanes;
			suspendedCommitReason = null;
			if (isViewTransitionEligible || subtreeFlags & 8192 || 16785408 === (subtreeFlags & 16785408)) {
				if (suspendedCommitReason = {
					stylesheets: null,
					count: 0,
					imgCount: 0,
					imgBytes: 0,
					suspenseyImages: [],
					waitingForImages: !0,
					waitingForViewTransition: !1,
					unsuspend: noop$1
				}, appearingViewTransitions = null, accumulateSuspenseyCommitOnFiber(finishedWork, lanes, suspendedCommitReason), isViewTransitionEligible && (subtreeFlags = suspendedCommitReason, isViewTransitionEligible = root.containerInfo, isViewTransitionEligible = (9 === isViewTransitionEligible.nodeType ? isViewTransitionEligible : isViewTransitionEligible.ownerDocument).__reactViewTransition, null != isViewTransitionEligible && (subtreeFlags.count++, subtreeFlags.waitingForViewTransition = !0, subtreeFlags = onUnsuspend.bind(subtreeFlags), isViewTransitionEligible.finished.then(subtreeFlags, subtreeFlags))), subtreeFlags = (lanes & 62914560) === lanes ? globalMostRecentFallbackTime - now() : (lanes & 4194048) === lanes ? globalMostRecentTransitionTime - now() : 0, subtreeFlags = waitForCommitToBeReady(suspendedCommitReason, subtreeFlags), null !== subtreeFlags) {
					pendingEffectsLanes = lanes;
					root.cancelPendingCommit = subtreeFlags(completeRoot.bind(null, root, finishedWork, lanes, recoverableErrors, transitions, didIncludeRenderPhaseUpdate, spawnedLane, updatedLanes, suspendedRetryLanes, didSkipSuspendedSiblings, exitStatus, suspendedCommitReason, null, completedRenderStartTime, completedRenderEndTime));
					markRootSuspended(root, lanes, spawnedLane, !didSkipSuspendedSiblings);
					return;
				}
			}
			completeRoot(root, finishedWork, lanes, recoverableErrors, transitions, didIncludeRenderPhaseUpdate, spawnedLane, updatedLanes, suspendedRetryLanes, didSkipSuspendedSiblings, exitStatus, suspendedCommitReason);
		}
		function isRenderConsistentWithExternalStores(finishedWork) {
			for (var node = finishedWork;;) {
				var tag = node.tag;
				if ((0 === tag || 11 === tag || 15 === tag) && node.flags & 16384 && (tag = node.updateQueue, null !== tag && (tag = tag.stores, null !== tag))) for (var i = 0; i < tag.length; i++) {
					var check = tag[i], getSnapshot = check.getSnapshot;
					check = check.value;
					try {
						if (!objectIs(getSnapshot(), check)) return !1;
					} catch (error) {
						return !1;
					}
				}
				tag = node.child;
				if (node.subtreeFlags & 16384 && null !== tag) tag.return = node, node = tag;
				else {
					if (node === finishedWork) break;
					for (; null === node.sibling;) {
						if (null === node.return || node.return === finishedWork) return !0;
						node = node.return;
					}
					node.sibling.return = node.return;
					node = node.sibling;
				}
			}
			return !0;
		}
		function markRootSuspended(root, suspendedLanes, spawnedLane, didAttemptEntireTree) {
			suspendedLanes = getEntangledLanes(root, suspendedLanes);
			suspendedLanes &= ~workInProgressRootPingedLanes;
			suspendedLanes &= ~workInProgressRootInterleavedUpdatedLanes;
			root.suspendedLanes |= suspendedLanes;
			root.pingedLanes &= ~suspendedLanes;
			didAttemptEntireTree && (root.warmLanes |= suspendedLanes);
			didAttemptEntireTree = root.expirationTimes;
			for (var lanes = suspendedLanes; 0 < lanes;) {
				var index$6 = 31 - clz32(lanes), lane = 1 << index$6;
				didAttemptEntireTree[index$6] = -1;
				lanes &= ~lane;
			}
			0 !== spawnedLane && markSpawnedDeferredLane(root, spawnedLane, suspendedLanes);
		}
		function flushSyncWork$1() {
			return 0 === (executionContext & 6) ? (flushSyncWorkAcrossRoots_impl(0, !1), !1) : !0;
		}
		function resetWorkInProgressStack() {
			if (null !== workInProgress) {
				if (0 === workInProgressSuspendedReason) var interruptedWork = workInProgress.return;
				else interruptedWork = workInProgress, lastContextDependency = currentlyRenderingFiber$1 = null, resetHooksOnUnwind(interruptedWork), thenableState$1 = null, thenableIndexCounter$1 = 0, interruptedWork = workInProgress;
				for (; null !== interruptedWork;) unwindInterruptedWork(interruptedWork.alternate, interruptedWork), interruptedWork = interruptedWork.return;
				workInProgress = null;
			}
		}
		function prepareFreshStack(root, lanes) {
			var timeoutHandle = root.timeoutHandle;
			-1 !== timeoutHandle && (root.timeoutHandle = -1, cancelTimeout(timeoutHandle));
			timeoutHandle = root.cancelPendingCommit;
			null !== timeoutHandle && (root.cancelPendingCommit = null, timeoutHandle());
			pendingEffectsLanes = 0;
			resetWorkInProgressStack();
			workInProgressRoot = root;
			workInProgress = timeoutHandle = createWorkInProgress(root.current, null);
			workInProgressRootRenderLanes = lanes;
			workInProgressSuspendedReason = 0;
			workInProgressThrownValue = null;
			workInProgressRootDidSkipSuspendedSiblings = !1;
			workInProgressRootIsPrerendering = checkIfRootIsPrerendering(root, lanes);
			workInProgressRootDidAttachPingListener = !1;
			workInProgressSuspendedRetryLanes = workInProgressDeferredLane = workInProgressRootPingedLanes = workInProgressRootInterleavedUpdatedLanes = workInProgressRootSkippedLanes = workInProgressRootExitStatus = 0;
			workInProgressRootRecoverableErrors = workInProgressRootConcurrentErrors = null;
			workInProgressRootDidIncludeRecursiveRenderUpdate = !1;
			entangledRenderLanes = getEntangledLanes(root, lanes);
			finishQueueingConcurrentUpdates();
			return timeoutHandle;
		}
		function handleThrow(root, thrownValue) {
			currentlyRenderingFiber = null;
			ReactSharedInternals.H = ContextOnlyDispatcher;
			thrownValue === SuspenseException || thrownValue === SuspenseActionException ? (thrownValue = getSuspendedThenable(), workInProgressSuspendedReason = 3) : thrownValue === SuspenseyCommitException ? (thrownValue = getSuspendedThenable(), workInProgressSuspendedReason = 4) : workInProgressSuspendedReason = thrownValue === SelectiveHydrationException ? 8 : null !== thrownValue && "object" === typeof thrownValue && "function" === typeof thrownValue.then ? 6 : 1;
			workInProgressThrownValue = thrownValue;
			null === workInProgress && (workInProgressRootExitStatus = 1, logUncaughtError(root, createCapturedValueAtFiber(thrownValue, root.current)));
		}
		function shouldRemainOnPreviousScreen() {
			var handler = suspenseHandlerStackCursor.current;
			return null === handler ? !0 : (workInProgressRootRenderLanes & 4194048) === workInProgressRootRenderLanes ? null === shellBoundary ? !0 : !1 : (workInProgressRootRenderLanes & 62914560) === workInProgressRootRenderLanes || 0 !== (workInProgressRootRenderLanes & 536870912) ? handler === shellBoundary : !1;
		}
		function pushDispatcher() {
			var prevDispatcher = ReactSharedInternals.H;
			ReactSharedInternals.H = ContextOnlyDispatcher;
			return null === prevDispatcher ? ContextOnlyDispatcher : prevDispatcher;
		}
		function pushAsyncDispatcher() {
			var prevAsyncDispatcher = ReactSharedInternals.A;
			ReactSharedInternals.A = DefaultAsyncDispatcher;
			return prevAsyncDispatcher;
		}
		function renderDidSuspendDelayIfPossible() {
			workInProgressRootExitStatus = 4;
			workInProgressRootDidSkipSuspendedSiblings || (workInProgressRootRenderLanes & 4194048) !== workInProgressRootRenderLanes && null !== suspenseHandlerStackCursor.current || (workInProgressRootIsPrerendering = !0);
			0 === (workInProgressRootSkippedLanes & 134217727) && 0 === (workInProgressRootInterleavedUpdatedLanes & 134217727) || null === workInProgressRoot || markRootSuspended(workInProgressRoot, workInProgressRootRenderLanes, workInProgressDeferredLane, !1);
		}
		function renderRootSync(root, lanes, shouldYieldForPrerendering) {
			var prevExecutionContext = executionContext;
			executionContext |= 2;
			var prevDispatcher = pushDispatcher(), prevAsyncDispatcher = pushAsyncDispatcher();
			if (workInProgressRoot !== root || workInProgressRootRenderLanes !== lanes) workInProgressTransitions = null, prepareFreshStack(root, lanes);
			lanes = !1;
			var exitStatus = workInProgressRootExitStatus;
			a: do
				try {
					if (0 !== workInProgressSuspendedReason && null !== workInProgress) {
						var unitOfWork = workInProgress, thrownValue = workInProgressThrownValue;
						switch (workInProgressSuspendedReason) {
							case 8:
								resetWorkInProgressStack();
								exitStatus = 6;
								break a;
							case 3:
							case 2:
							case 9:
							case 6:
								null === suspenseHandlerStackCursor.current && (lanes = !0);
								var reason = workInProgressSuspendedReason;
								workInProgressSuspendedReason = 0;
								workInProgressThrownValue = null;
								throwAndUnwindWorkLoop(root, unitOfWork, thrownValue, reason);
								if (shouldYieldForPrerendering && workInProgressRootIsPrerendering) {
									exitStatus = 0;
									break a;
								}
								break;
							default: reason = workInProgressSuspendedReason, workInProgressSuspendedReason = 0, workInProgressThrownValue = null, throwAndUnwindWorkLoop(root, unitOfWork, thrownValue, reason);
						}
					}
					workLoopSync();
					exitStatus = workInProgressRootExitStatus;
					break;
				} catch (thrownValue$184) {
					handleThrow(root, thrownValue$184);
				}
			while (1);
			lanes && root.shellSuspendCounter++;
			lastContextDependency = currentlyRenderingFiber$1 = null;
			executionContext = prevExecutionContext;
			ReactSharedInternals.H = prevDispatcher;
			ReactSharedInternals.A = prevAsyncDispatcher;
			null === workInProgress && (workInProgressRoot = null, workInProgressRootRenderLanes = 0, finishQueueingConcurrentUpdates());
			return exitStatus;
		}
		function workLoopSync() {
			for (; null !== workInProgress;) performUnitOfWork(workInProgress);
		}
		function renderRootConcurrent(root, lanes) {
			var prevExecutionContext = executionContext;
			executionContext |= 2;
			var prevDispatcher = pushDispatcher(), prevAsyncDispatcher = pushAsyncDispatcher();
			workInProgressRoot !== root || workInProgressRootRenderLanes !== lanes ? (workInProgressTransitions = null, workInProgressRootRenderTargetTime = now() + 500, prepareFreshStack(root, lanes)) : workInProgressRootIsPrerendering = checkIfRootIsPrerendering(root, lanes);
			a: do
				try {
					if (0 !== workInProgressSuspendedReason && null !== workInProgress) {
						lanes = workInProgress;
						var thrownValue = workInProgressThrownValue;
						b: switch (workInProgressSuspendedReason) {
							case 1:
								workInProgressSuspendedReason = 0;
								workInProgressThrownValue = null;
								throwAndUnwindWorkLoop(root, lanes, thrownValue, 1);
								break;
							case 2:
							case 9:
								if (isThenableResolved(thrownValue)) {
									workInProgressSuspendedReason = 0;
									workInProgressThrownValue = null;
									replaySuspendedUnitOfWork(lanes);
									break;
								}
								lanes = function() {
									2 !== workInProgressSuspendedReason && 9 !== workInProgressSuspendedReason || workInProgressRoot !== root || (workInProgressSuspendedReason = 7);
									ensureRootIsScheduled(root);
								};
								thrownValue.then(lanes, lanes);
								break a;
							case 3:
								workInProgressSuspendedReason = 7;
								break a;
							case 4:
								workInProgressSuspendedReason = 5;
								break a;
							case 7:
								isThenableResolved(thrownValue) ? (workInProgressSuspendedReason = 0, workInProgressThrownValue = null, replaySuspendedUnitOfWork(lanes)) : (workInProgressSuspendedReason = 0, workInProgressThrownValue = null, throwAndUnwindWorkLoop(root, lanes, thrownValue, 7));
								break;
							case 5:
								var resource = null;
								switch (workInProgress.tag) {
									case 26: resource = workInProgress.memoizedState;
									case 5:
									case 27:
										var hostFiber = workInProgress;
										if (resource ? preloadResource(resource) : hostFiber.stateNode.complete) {
											workInProgressSuspendedReason = 0;
											workInProgressThrownValue = null;
											var sibling = hostFiber.sibling;
											if (null !== sibling) workInProgress = sibling;
											else {
												var returnFiber = hostFiber.return;
												null !== returnFiber ? (workInProgress = returnFiber, completeUnitOfWork(returnFiber)) : workInProgress = null;
											}
											break b;
										}
								}
								workInProgressSuspendedReason = 0;
								workInProgressThrownValue = null;
								throwAndUnwindWorkLoop(root, lanes, thrownValue, 5);
								break;
							case 6:
								workInProgressSuspendedReason = 0;
								workInProgressThrownValue = null;
								throwAndUnwindWorkLoop(root, lanes, thrownValue, 6);
								break;
							case 8:
								resetWorkInProgressStack();
								workInProgressRootExitStatus = 6;
								break a;
							default: throw Error(formatProdErrorMessage(462));
						}
					}
					workLoopConcurrentByScheduler();
					break;
				} catch (thrownValue$186) {
					handleThrow(root, thrownValue$186);
				}
			while (1);
			lastContextDependency = currentlyRenderingFiber$1 = null;
			ReactSharedInternals.H = prevDispatcher;
			ReactSharedInternals.A = prevAsyncDispatcher;
			executionContext = prevExecutionContext;
			if (null !== workInProgress) return 0;
			workInProgressRoot = null;
			workInProgressRootRenderLanes = 0;
			finishQueueingConcurrentUpdates();
			return workInProgressRootExitStatus;
		}
		function workLoopConcurrentByScheduler() {
			for (; null !== workInProgress && !shouldYield();) performUnitOfWork(workInProgress);
		}
		function performUnitOfWork(unitOfWork) {
			var next = beginWork(unitOfWork.alternate, unitOfWork, entangledRenderLanes);
			unitOfWork.memoizedProps = unitOfWork.pendingProps;
			null === next ? completeUnitOfWork(unitOfWork) : workInProgress = next;
		}
		function replaySuspendedUnitOfWork(unitOfWork) {
			var next = unitOfWork;
			var current = next.alternate;
			switch (next.tag) {
				case 15:
				case 0:
					next = replayFunctionComponent(current, next, next.pendingProps, next.type, void 0, workInProgressRootRenderLanes);
					break;
				case 11:
					next = replayFunctionComponent(current, next, next.pendingProps, next.type.render, next.ref, workInProgressRootRenderLanes);
					break;
				case 5:
					resetHooksOnUnwind(next);
					var fiber = next;
					fiber === hydrationParentFiber && (isHydrating ? (popToNextHostParent(fiber), 5 === fiber.tag && null != fiber.stateNode && (nextHydratableInstance = fiber.stateNode)) : (popToNextHostParent(fiber), isHydrating = !0));
				default: unwindInterruptedWork(current, next), next = workInProgress = resetWorkInProgress(next, entangledRenderLanes), next = beginWork(current, next, entangledRenderLanes);
			}
			unitOfWork.memoizedProps = unitOfWork.pendingProps;
			null === next ? completeUnitOfWork(unitOfWork) : workInProgress = next;
		}
		function throwAndUnwindWorkLoop(root, unitOfWork, thrownValue, suspendedReason) {
			lastContextDependency = currentlyRenderingFiber$1 = null;
			resetHooksOnUnwind(unitOfWork);
			thenableState$1 = null;
			thenableIndexCounter$1 = 0;
			var returnFiber = unitOfWork.return;
			try {
				if (throwException(root, returnFiber, unitOfWork, thrownValue, workInProgressRootRenderLanes)) {
					workInProgressRootExitStatus = 1;
					logUncaughtError(root, createCapturedValueAtFiber(thrownValue, root.current));
					workInProgress = null;
					return;
				}
			} catch (error) {
				if (null !== returnFiber) throw workInProgress = returnFiber, error;
				workInProgressRootExitStatus = 1;
				logUncaughtError(root, createCapturedValueAtFiber(thrownValue, root.current));
				workInProgress = null;
				return;
			}
			if (unitOfWork.flags & 32768) {
				if (isHydrating || 1 === suspendedReason) root = !0;
				else if (workInProgressRootIsPrerendering || 0 !== (workInProgressRootRenderLanes & 536870912)) root = !1;
				else if (workInProgressRootDidSkipSuspendedSiblings = root = !0, 2 === suspendedReason || 9 === suspendedReason || 3 === suspendedReason || 6 === suspendedReason) suspendedReason = suspenseHandlerStackCursor.current, null !== suspendedReason && 13 === suspendedReason.tag && (suspendedReason.flags |= 16384);
				unwindUnitOfWork(unitOfWork, root);
			} else completeUnitOfWork(unitOfWork);
		}
		function completeUnitOfWork(unitOfWork) {
			var completedWork = unitOfWork;
			do {
				if (0 !== (completedWork.flags & 32768)) {
					unwindUnitOfWork(completedWork, workInProgressRootDidSkipSuspendedSiblings);
					return;
				}
				unitOfWork = completedWork.return;
				var next = completeWork(completedWork.alternate, completedWork, entangledRenderLanes);
				if (null !== next) {
					workInProgress = next;
					return;
				}
				completedWork = completedWork.sibling;
				if (null !== completedWork) {
					workInProgress = completedWork;
					return;
				}
				workInProgress = completedWork = unitOfWork;
			} while (null !== completedWork);
			0 === workInProgressRootExitStatus && (workInProgressRootExitStatus = 5);
		}
		function unwindUnitOfWork(unitOfWork, skipSiblings) {
			do {
				var next = unwindWork(unitOfWork.alternate, unitOfWork);
				if (null !== next) {
					next.flags &= 32767;
					workInProgress = next;
					return;
				}
				next = unitOfWork.return;
				null !== next && (next.flags |= 32768, next.subtreeFlags = 0, next.deletions = null);
				if (!skipSiblings && (unitOfWork = unitOfWork.sibling, null !== unitOfWork)) {
					workInProgress = unitOfWork;
					return;
				}
				workInProgress = unitOfWork = next;
			} while (null !== unitOfWork);
			workInProgressRootExitStatus = 6;
			workInProgress = null;
		}
		function completeRoot(root, finishedWork, lanes, recoverableErrors, transitions, didIncludeRenderPhaseUpdate, spawnedLane, updatedLanes, suspendedRetryLanes, didSkipSuspendedSiblings, exitStatus, suspendedState) {
			root.cancelPendingCommit = null;
			do
				flushPendingEffects();
			while (0 !== pendingEffectsStatus);
			if (0 !== (executionContext & 6)) throw Error(formatProdErrorMessage(327));
			if (null !== finishedWork) {
				if (finishedWork === root.current) throw Error(formatProdErrorMessage(177));
				root === workInProgressRoot && (workInProgress = workInProgressRoot = null, workInProgressRootRenderLanes = 0);
				pendingFinishedWork = finishedWork;
				pendingEffectsRoot = root;
				pendingEffectsLanes = lanes;
				pendingPassiveTransitions = transitions;
				pendingRecoverableErrors = recoverableErrors;
				commitRoot(root, finishedWork, lanes, spawnedLane, updatedLanes, suspendedRetryLanes, suspendedState);
			}
		}
		function commitRoot(root, finishedWork, lanes, spawnedLane, updatedLanes, suspendedRetryLanes, suspendedState) {
			var remainingLanes = finishedWork.lanes | finishedWork.childLanes;
			pendingEffectsRemainingLanes = remainingLanes;
			remainingLanes |= concurrentlyUpdatedLanes;
			markRootFinished(root, lanes, remainingLanes, spawnedLane, updatedLanes, suspendedRetryLanes);
			pendingViewTransitionEvents = null;
			(lanes & 335544064) === lanes ? (pendingTransitionTypes = claimQueuedTransitionTypes(root), spawnedLane = 10262) : (pendingTransitionTypes = null, spawnedLane = 10256);
			0 !== (finishedWork.subtreeFlags & spawnedLane) || 0 !== (finishedWork.flags & spawnedLane) ? (root.callbackNode = null, root.callbackPriority = 0, scheduleCallback$1(NormalPriority$1, function() {
				flushPassiveEffects();
				return null;
			})) : (root.callbackNode = null, root.callbackPriority = 0);
			shouldStartViewTransition = !1;
			spawnedLane = 0 !== (finishedWork.flags & 13878);
			if (0 !== (finishedWork.subtreeFlags & 13878) || spawnedLane) {
				spawnedLane = ReactSharedInternals.T;
				ReactSharedInternals.T = null;
				updatedLanes = ReactDOMSharedInternals.p;
				ReactDOMSharedInternals.p = 2;
				suspendedRetryLanes = executionContext;
				executionContext |= 4;
				try {
					commitBeforeMutationEffects(root, finishedWork, lanes);
				} finally {
					executionContext = suspendedRetryLanes, ReactDOMSharedInternals.p = updatedLanes, ReactSharedInternals.T = spawnedLane;
				}
			}
			pendingEffectsStatus = 1;
			shouldStartViewTransition ? pendingViewTransition = startViewTransition(suspendedState, root.containerInfo, pendingTransitionTypes, flushMutationEffects, flushLayoutEffects, flushAfterMutationEffects, flushSpawnedWork, flushPassiveEffects, reportViewTransitionError, null, null) : (flushMutationEffects(), flushLayoutEffects(), flushSpawnedWork());
		}
		function reportViewTransitionError(error) {
			if (0 !== pendingEffectsStatus) {
				var onRecoverableError = pendingEffectsRoot.onRecoverableError;
				onRecoverableError(error, { componentStack: null });
			}
		}
		function flushAfterMutationEffects() {
			3 === pendingEffectsStatus && (pendingEffectsStatus = 0, commitAfterMutationEffectsOnFiber(pendingFinishedWork, pendingEffectsRoot), pendingEffectsStatus = 4);
		}
		function flushMutationEffects() {
			if (1 === pendingEffectsStatus) {
				pendingEffectsStatus = 0;
				var root = pendingEffectsRoot, finishedWork = pendingFinishedWork, lanes = pendingEffectsLanes, rootMutationHasEffect = 0 !== (finishedWork.flags & 13878);
				if (0 !== (finishedWork.subtreeFlags & 13878) || rootMutationHasEffect) {
					rootMutationHasEffect = ReactSharedInternals.T;
					ReactSharedInternals.T = null;
					var previousPriority = ReactDOMSharedInternals.p;
					ReactDOMSharedInternals.p = 2;
					var prevExecutionContext = executionContext;
					executionContext |= 4;
					try {
						inUpdateViewTransition = rootViewTransitionAffected = !1;
						commitMutationEffectsOnFiber(finishedWork, root, lanes);
						lanes = selectionInformation;
						var curFocusedElem = getActiveElementDeep(root.containerInfo), priorFocusedElem = lanes.focusedElem, priorSelectionRange = lanes.selectionRange;
						if (curFocusedElem !== priorFocusedElem && priorFocusedElem && priorFocusedElem.ownerDocument && containsNode(priorFocusedElem.ownerDocument.documentElement, priorFocusedElem)) {
							if (null !== priorSelectionRange && hasSelectionCapabilities(priorFocusedElem)) {
								var start = priorSelectionRange.start, end = priorSelectionRange.end;
								void 0 === end && (end = start);
								if ("selectionStart" in priorFocusedElem) priorFocusedElem.selectionStart = start, priorFocusedElem.selectionEnd = Math.min(end, priorFocusedElem.value.length);
								else {
									var doc = priorFocusedElem.ownerDocument || document, win = doc && doc.defaultView || window;
									if (win.getSelection) {
										var selection = win.getSelection(), length = priorFocusedElem.textContent.length, start$jscomp$0 = Math.min(priorSelectionRange.start, length), end$jscomp$0 = void 0 === priorSelectionRange.end ? start$jscomp$0 : Math.min(priorSelectionRange.end, length);
										!selection.extend && start$jscomp$0 > end$jscomp$0 && (curFocusedElem = end$jscomp$0, end$jscomp$0 = start$jscomp$0, start$jscomp$0 = curFocusedElem);
										var startMarker = getNodeForCharacterOffset(priorFocusedElem, start$jscomp$0), endMarker = getNodeForCharacterOffset(priorFocusedElem, end$jscomp$0);
										if (startMarker && endMarker && (1 !== selection.rangeCount || selection.anchorNode !== startMarker.node || selection.anchorOffset !== startMarker.offset || selection.focusNode !== endMarker.node || selection.focusOffset !== endMarker.offset)) {
											var range = doc.createRange();
											range.setStart(startMarker.node, startMarker.offset);
											selection.removeAllRanges();
											start$jscomp$0 > end$jscomp$0 ? (selection.addRange(range), selection.extend(endMarker.node, endMarker.offset)) : (range.setEnd(endMarker.node, endMarker.offset), selection.addRange(range));
										}
									}
								}
							}
							doc = [];
							for (selection = priorFocusedElem; selection = selection.parentNode;) 1 === selection.nodeType && doc.push({
								element: selection,
								left: selection.scrollLeft,
								top: selection.scrollTop
							});
							"function" === typeof priorFocusedElem.focus && priorFocusedElem.focus();
							for (priorFocusedElem = 0; priorFocusedElem < doc.length; priorFocusedElem++) {
								var info = doc[priorFocusedElem];
								info.element.scrollLeft = info.left;
								info.element.scrollTop = info.top;
							}
						}
						_enabled = !!eventsEnabled;
						selectionInformation = eventsEnabled = null;
					} finally {
						executionContext = prevExecutionContext, ReactDOMSharedInternals.p = previousPriority, ReactSharedInternals.T = rootMutationHasEffect;
					}
				}
				root.current = finishedWork;
				pendingEffectsStatus = 2;
			}
		}
		function flushLayoutEffects() {
			if (2 === pendingEffectsStatus) {
				pendingEffectsStatus = 0;
				var root = pendingEffectsRoot, finishedWork = pendingFinishedWork, rootHasLayoutEffect = 0 !== (finishedWork.flags & 8772);
				if (0 !== (finishedWork.subtreeFlags & 8772) || rootHasLayoutEffect) {
					rootHasLayoutEffect = ReactSharedInternals.T;
					ReactSharedInternals.T = null;
					var previousPriority = ReactDOMSharedInternals.p;
					ReactDOMSharedInternals.p = 2;
					var prevExecutionContext = executionContext;
					executionContext |= 4;
					try {
						commitLayoutEffectOnFiber(root, finishedWork.alternate, finishedWork);
					} finally {
						executionContext = prevExecutionContext, ReactDOMSharedInternals.p = previousPriority, ReactSharedInternals.T = rootHasLayoutEffect;
					}
				}
				pendingEffectsStatus = 3;
			}
		}
		function flushSpawnedWork() {
			if (4 === pendingEffectsStatus || 3 === pendingEffectsStatus) {
				pendingEffectsStatus = 0;
				var committedViewTransition = pendingViewTransition;
				pendingViewTransition = null;
				requestPaint();
				var root = pendingEffectsRoot, finishedWork = pendingFinishedWork, lanes = pendingEffectsLanes, recoverableErrors = pendingRecoverableErrors, passiveSubtreeMask = (lanes & 335544064) === lanes ? 10262 : 10256;
				0 !== (finishedWork.subtreeFlags & passiveSubtreeMask) || 0 !== (finishedWork.flags & passiveSubtreeMask) ? pendingEffectsStatus = 5 : (pendingEffectsStatus = 0, pendingFinishedWork = pendingEffectsRoot = null, releaseRootPooledCache(root, root.pendingLanes));
				passiveSubtreeMask = root.pendingLanes;
				0 === passiveSubtreeMask && (legacyErrorBoundariesThatAlreadyFailed = null);
				lanesToEventPriority(lanes);
				finishedWork = finishedWork.stateNode;
				if (injectedHook && "function" === typeof injectedHook.onCommitFiberRoot) try {
					injectedHook.onCommitFiberRoot(rendererID, finishedWork, void 0, 128 === (finishedWork.current.flags & 128));
				} catch (err) {}
				if (null !== recoverableErrors) {
					finishedWork = ReactSharedInternals.T;
					passiveSubtreeMask = ReactDOMSharedInternals.p;
					ReactDOMSharedInternals.p = 2;
					ReactSharedInternals.T = null;
					try {
						for (var onRecoverableError = root.onRecoverableError, i = 0; i < recoverableErrors.length; i++) {
							var recoverableError = recoverableErrors[i];
							onRecoverableError(recoverableError.value, { componentStack: recoverableError.stack });
						}
					} finally {
						ReactSharedInternals.T = finishedWork, ReactDOMSharedInternals.p = passiveSubtreeMask;
					}
				}
				recoverableErrors = pendingViewTransitionEvents;
				onRecoverableError = pendingTransitionTypes;
				pendingTransitionTypes = null;
				if (null !== recoverableErrors && (pendingViewTransitionEvents = null, null === onRecoverableError && (onRecoverableError = []), null !== committedViewTransition)) for (recoverableError = 0; recoverableError < recoverableErrors.length; recoverableError++) finishedWork = (0, recoverableErrors[recoverableError])(onRecoverableError), void 0 !== finishedWork && committedViewTransition.finished.finally(finishedWork);
				0 !== (pendingEffectsLanes & 3) && flushPendingEffects();
				ensureRootIsScheduled(root);
				passiveSubtreeMask = root.pendingLanes;
				0 !== (lanes & 261930) && 0 !== (passiveSubtreeMask & 42) ? root === rootWithNestedUpdates ? nestedUpdateCount++ : (nestedUpdateCount = 0, rootWithNestedUpdates = root) : (nestedUpdateCount = 0, rootWithNestedUpdates = null);
				flushSyncWorkAcrossRoots_impl(0, !1);
			}
		}
		function releaseRootPooledCache(root, remainingLanes) {
			0 === (root.pooledCacheLanes &= remainingLanes) && (remainingLanes = root.pooledCache, null != remainingLanes && (root.pooledCache = null, releaseCache(remainingLanes)));
		}
		function flushPendingEffects() {
			null !== pendingViewTransition && (pendingViewTransition.skipTransition(), pendingViewTransition = null);
			flushMutationEffects();
			flushLayoutEffects();
			flushSpawnedWork();
			return flushPassiveEffects();
		}
		function flushPassiveEffects() {
			if (5 !== pendingEffectsStatus) return !1;
			var root = pendingEffectsRoot, remainingLanes = pendingEffectsRemainingLanes;
			pendingEffectsRemainingLanes = 0;
			var renderPriority = lanesToEventPriority(pendingEffectsLanes), prevTransition = ReactSharedInternals.T, previousPriority = ReactDOMSharedInternals.p;
			try {
				ReactDOMSharedInternals.p = 32 > renderPriority ? 32 : renderPriority;
				ReactSharedInternals.T = null;
				renderPriority = pendingPassiveTransitions;
				pendingPassiveTransitions = null;
				var root$jscomp$0 = pendingEffectsRoot, lanes = pendingEffectsLanes;
				pendingEffectsStatus = 0;
				pendingFinishedWork = pendingEffectsRoot = null;
				pendingEffectsLanes = 0;
				if (0 !== (executionContext & 6)) throw Error(formatProdErrorMessage(331));
				var prevExecutionContext = executionContext;
				executionContext |= 4;
				commitPassiveUnmountOnFiber(root$jscomp$0.current);
				commitPassiveMountOnFiber(root$jscomp$0, root$jscomp$0.current, lanes, renderPriority);
				executionContext = prevExecutionContext;
				flushSyncWorkAcrossRoots_impl(0, !1);
				if (injectedHook && "function" === typeof injectedHook.onPostCommitFiberRoot) try {
					injectedHook.onPostCommitFiberRoot(rendererID, root$jscomp$0);
				} catch (err) {}
				return !0;
			} finally {
				ReactDOMSharedInternals.p = previousPriority, ReactSharedInternals.T = prevTransition, releaseRootPooledCache(root, remainingLanes);
			}
		}
		function captureCommitPhaseErrorOnRoot(rootFiber, sourceFiber, error) {
			sourceFiber = createCapturedValueAtFiber(error, sourceFiber);
			sourceFiber = createRootErrorUpdate(rootFiber.stateNode, sourceFiber, 2);
			rootFiber = enqueueUpdate(rootFiber, sourceFiber, 2);
			null !== rootFiber && (markRootUpdated$1(rootFiber, 2), ensureRootIsScheduled(rootFiber));
		}
		function captureCommitPhaseError(sourceFiber, nearestMountedAncestor, error) {
			if (3 === sourceFiber.tag) captureCommitPhaseErrorOnRoot(sourceFiber, sourceFiber, error);
			else for (; null !== nearestMountedAncestor;) {
				if (3 === nearestMountedAncestor.tag) {
					captureCommitPhaseErrorOnRoot(nearestMountedAncestor, sourceFiber, error);
					break;
				} else if (1 === nearestMountedAncestor.tag) {
					var instance = nearestMountedAncestor.stateNode;
					if ("function" === typeof nearestMountedAncestor.type.getDerivedStateFromError || "function" === typeof instance.componentDidCatch && (null === legacyErrorBoundariesThatAlreadyFailed || !legacyErrorBoundariesThatAlreadyFailed.has(instance))) {
						sourceFiber = createCapturedValueAtFiber(error, sourceFiber);
						error = createClassErrorUpdate(2);
						instance = enqueueUpdate(nearestMountedAncestor, error, 2);
						null !== instance && (initializeClassErrorUpdate(error, instance, nearestMountedAncestor, sourceFiber), markRootUpdated$1(instance, 2), ensureRootIsScheduled(instance));
						break;
					}
				}
				nearestMountedAncestor = nearestMountedAncestor.return;
			}
		}
		function attachPingListener(root, wakeable, lanes) {
			var pingCache = root.pingCache;
			if (null === pingCache) {
				pingCache = root.pingCache = new PossiblyWeakMap();
				var threadIDs = new Set();
				pingCache.set(wakeable, threadIDs);
			} else threadIDs = pingCache.get(wakeable), void 0 === threadIDs && (threadIDs = new Set(), pingCache.set(wakeable, threadIDs));
			threadIDs.has(lanes) || (workInProgressRootDidAttachPingListener = !0, threadIDs.add(lanes), root = pingSuspendedRoot.bind(null, root, wakeable, lanes), wakeable.then(root, root));
		}
		function pingSuspendedRoot(root, wakeable, pingedLanes) {
			var pingCache = root.pingCache;
			null !== pingCache && pingCache.delete(wakeable);
			root.pingedLanes |= root.suspendedLanes & pingedLanes;
			root.warmLanes &= ~pingedLanes;
			workInProgressRoot === root && (workInProgressRootRenderLanes & pingedLanes) === pingedLanes && (4 === workInProgressRootExitStatus || 3 === workInProgressRootExitStatus && (workInProgressRootRenderLanes & 62914560) === workInProgressRootRenderLanes && 300 > now() - globalMostRecentFallbackTime ? 0 === (executionContext & 2) ? prepareFreshStack(root, 0) : workInProgressRootPingedLanes |= pingedLanes : workInProgressRootPingedLanes |= pingedLanes, workInProgressSuspendedRetryLanes === workInProgressRootRenderLanes && (workInProgressSuspendedRetryLanes = 0));
			ensureRootIsScheduled(root);
		}
		function retryTimedOutBoundary(boundaryFiber, retryLane) {
			0 === retryLane && (retryLane = claimNextRetryLane());
			boundaryFiber = enqueueConcurrentRenderForLane(boundaryFiber, retryLane);
			null !== boundaryFiber && (markRootUpdated$1(boundaryFiber, retryLane), ensureRootIsScheduled(boundaryFiber));
		}
		function retryDehydratedSuspenseBoundary(boundaryFiber) {
			var suspenseState = boundaryFiber.memoizedState, retryLane = 0;
			null !== suspenseState && (retryLane = suspenseState.retryLane);
			retryTimedOutBoundary(boundaryFiber, retryLane);
		}
		function resolveRetryWakeable(boundaryFiber, wakeable) {
			var retryLane = 0;
			switch (boundaryFiber.tag) {
				case 31:
				case 13:
					var retryCache = boundaryFiber.stateNode;
					var suspenseState = boundaryFiber.memoizedState;
					null !== suspenseState && (retryLane = suspenseState.retryLane);
					break;
				case 19:
					retryCache = boundaryFiber.stateNode;
					break;
				case 22:
					retryCache = boundaryFiber.stateNode._retryCache;
					break;
				default: throw Error(formatProdErrorMessage(314));
			}
			null !== retryCache && retryCache.delete(wakeable);
			retryTimedOutBoundary(boundaryFiber, retryLane);
		}
		function scheduleCallback$1(priorityLevel, callback) {
			return scheduleCallback$3(priorityLevel, callback);
		}
		var firstScheduledRoot = null;
		var lastScheduledRoot = null;
		var didScheduleMicrotask = !1;
		var mightHavePendingSyncWork = !1;
		var isFlushingWork = !1;
		var currentEventTransitionLane = 0;
		function ensureRootIsScheduled(root) {
			root !== lastScheduledRoot && null === root.next && (null === lastScheduledRoot ? firstScheduledRoot = lastScheduledRoot = root : lastScheduledRoot = lastScheduledRoot.next = root);
			mightHavePendingSyncWork = !0;
			didScheduleMicrotask || (didScheduleMicrotask = !0, scheduleImmediateRootScheduleTask());
		}
		function flushSyncWorkAcrossRoots_impl(syncTransitionLanes, onlyLegacy) {
			if (!isFlushingWork && mightHavePendingSyncWork) {
				isFlushingWork = !0;
				do {
					var didPerformSomeWork = !1;
					for (var root$190 = firstScheduledRoot; null !== root$190;) {
						if (!onlyLegacy) if (0 !== syncTransitionLanes) {
							var pendingLanes = root$190.pendingLanes;
							if (0 === pendingLanes) var JSCompiler_inline_result = 0;
							else {
								var suspendedLanes = root$190.suspendedLanes, pingedLanes = root$190.pingedLanes;
								JSCompiler_inline_result = (1 << 31 - clz32(42 | syncTransitionLanes) + 1) - 1;
								JSCompiler_inline_result &= pendingLanes & ~(suspendedLanes & ~pingedLanes);
								JSCompiler_inline_result = JSCompiler_inline_result & 201326741 ? JSCompiler_inline_result & 201326741 | 1 : JSCompiler_inline_result ? JSCompiler_inline_result | 2 : 0;
							}
							0 !== JSCompiler_inline_result && (didPerformSomeWork = !0, performSyncWorkOnRoot(root$190, JSCompiler_inline_result));
						} else JSCompiler_inline_result = workInProgressRootRenderLanes, JSCompiler_inline_result = getNextLanes(root$190, root$190 === workInProgressRoot ? JSCompiler_inline_result : 0, null !== root$190.cancelPendingCommit || -1 !== root$190.timeoutHandle), 0 === (JSCompiler_inline_result & 3) || checkIfRootIsPrerendering(root$190, JSCompiler_inline_result) || (didPerformSomeWork = !0, performSyncWorkOnRoot(root$190, JSCompiler_inline_result));
						root$190 = root$190.next;
					}
				} while (didPerformSomeWork);
				isFlushingWork = !1;
			}
		}
		function processRootScheduleInImmediateTask() {
			processRootScheduleInMicrotask();
		}
		function processRootScheduleInMicrotask() {
			mightHavePendingSyncWork = didScheduleMicrotask = !1;
			var syncTransitionLanes = 0;
			0 !== currentEventTransitionLane && shouldAttemptEagerTransition() && (syncTransitionLanes = currentEventTransitionLane);
			for (var currentTime = now(), prev = null, root = firstScheduledRoot; null !== root;) {
				var next = root.next, nextLanes = scheduleTaskForRootDuringMicrotask(root, currentTime);
				if (0 === nextLanes) root.next = null, null === prev ? firstScheduledRoot = next : prev.next = next, null === next && (lastScheduledRoot = prev);
				else if (prev = root, 0 !== syncTransitionLanes || 0 !== (nextLanes & 3)) mightHavePendingSyncWork = !0;
				root = next;
			}
			0 !== pendingEffectsStatus && 5 !== pendingEffectsStatus || flushSyncWorkAcrossRoots_impl(syncTransitionLanes, !1);
			0 !== currentEventTransitionLane && (currentEventTransitionLane = 0);
		}
		function scheduleTaskForRootDuringMicrotask(root, currentTime) {
			for (var suspendedLanes = root.suspendedLanes, pingedLanes = root.pingedLanes, expirationTimes = root.expirationTimes, lanes = root.pendingLanes & -62914561; 0 < lanes;) {
				var index$5 = 31 - clz32(lanes), lane = 1 << index$5, expirationTime = expirationTimes[index$5];
				if (-1 === expirationTime) {
					if (0 === (lane & suspendedLanes) || 0 !== (lane & pingedLanes)) expirationTimes[index$5] = computeExpirationTime(lane, currentTime);
				} else expirationTime <= currentTime && (root.expiredLanes |= lane);
				lanes &= ~lane;
			}
			currentTime = workInProgressRoot;
			suspendedLanes = workInProgressRootRenderLanes;
			suspendedLanes = getNextLanes(root, root === currentTime ? suspendedLanes : 0, null !== root.cancelPendingCommit || -1 !== root.timeoutHandle);
			pingedLanes = root.callbackNode;
			if (0 === suspendedLanes || root === currentTime && (2 === workInProgressSuspendedReason || 9 === workInProgressSuspendedReason) || null !== root.cancelPendingCommit) return null !== pingedLanes && null !== pingedLanes && cancelCallback$1(pingedLanes), root.callbackNode = null, root.callbackPriority = 0;
			if (0 === (suspendedLanes & 3) || checkIfRootIsPrerendering(root, suspendedLanes)) {
				currentTime = suspendedLanes & -suspendedLanes;
				if (currentTime === root.callbackPriority) return currentTime;
				null !== pingedLanes && cancelCallback$1(pingedLanes);
				switch (lanesToEventPriority(suspendedLanes)) {
					case 2:
					case 8:
						suspendedLanes = UserBlockingPriority;
						break;
					case 32:
						suspendedLanes = NormalPriority$1;
						break;
					case 268435456:
						suspendedLanes = IdlePriority;
						break;
					default: suspendedLanes = NormalPriority$1;
				}
				pingedLanes = performWorkOnRootViaSchedulerTask.bind(null, root);
				suspendedLanes = scheduleCallback$3(suspendedLanes, pingedLanes);
				root.callbackPriority = currentTime;
				root.callbackNode = suspendedLanes;
				return currentTime;
			}
			null !== pingedLanes && null !== pingedLanes && cancelCallback$1(pingedLanes);
			root.callbackPriority = 2;
			root.callbackNode = null;
			return 2;
		}
		function performWorkOnRootViaSchedulerTask(root, didTimeout) {
			if (0 !== pendingEffectsStatus && 5 !== pendingEffectsStatus) return root.callbackNode = null, root.callbackPriority = 0, null;
			var originalCallbackNode = root.callbackNode;
			if (flushPendingEffects() && root.callbackNode !== originalCallbackNode) return null;
			var workInProgressRootRenderLanes$jscomp$0 = workInProgressRootRenderLanes;
			workInProgressRootRenderLanes$jscomp$0 = getNextLanes(root, root === workInProgressRoot ? workInProgressRootRenderLanes$jscomp$0 : 0, null !== root.cancelPendingCommit || -1 !== root.timeoutHandle);
			if (0 === workInProgressRootRenderLanes$jscomp$0) return null;
			performWorkOnRoot(root, workInProgressRootRenderLanes$jscomp$0, didTimeout);
			scheduleTaskForRootDuringMicrotask(root, now());
			return null != root.callbackNode && root.callbackNode === originalCallbackNode ? performWorkOnRootViaSchedulerTask.bind(null, root) : null;
		}
		function performSyncWorkOnRoot(root, lanes) {
			if (flushPendingEffects()) return null;
			performWorkOnRoot(root, lanes, !0);
		}
		function scheduleImmediateRootScheduleTask() {
			scheduleMicrotask(function() {
				0 !== (executionContext & 6) ? scheduleCallback$3(ImmediatePriority, processRootScheduleInImmediateTask) : processRootScheduleInMicrotask();
			});
		}
		function requestTransitionLane() {
			if (0 === currentEventTransitionLane) {
				var actionScopeLane = currentEntangledLane;
				0 === actionScopeLane && (actionScopeLane = nextTransitionUpdateLane, nextTransitionUpdateLane <<= 1, 0 === (nextTransitionUpdateLane & 261888) && (nextTransitionUpdateLane = 256));
				currentEventTransitionLane = actionScopeLane;
			}
			return currentEventTransitionLane;
		}
		function coerceFormActionProp(actionProp) {
			return null == actionProp || "symbol" === typeof actionProp || "boolean" === typeof actionProp ? null : "function" === typeof actionProp ? actionProp : sanitizeURL(actionProp);
		}
		function extractEvents$1(dispatchQueue, domEventName, maybeTargetInst, nativeEvent, nativeEventTarget) {
			if ("submit" === domEventName && maybeTargetInst && maybeTargetInst.stateNode === nativeEventTarget) {
				var action = coerceFormActionProp((nativeEventTarget[internalPropsKey] || null).action), submitter = nativeEvent.submitter;
				submitter && (domEventName = (domEventName = submitter[internalPropsKey] || null) ? coerceFormActionProp(domEventName.formAction) : submitter.getAttribute("formAction"), null !== domEventName && (action = domEventName, submitter = null));
				var event = new SyntheticEvent("action", "action", null, nativeEvent, nativeEventTarget);
				dispatchQueue.push({
					event,
					listeners: [{
						instance: null,
						listener: function() {
							if (nativeEvent.defaultPrevented) {
								if (0 !== currentEventTransitionLane) {
									var formData = new FormData(nativeEventTarget, submitter);
									startHostTransition(maybeTargetInst, {
										pending: !0,
										data: formData,
										method: nativeEventTarget.method,
										action
									}, null, formData);
								}
							} else "function" === typeof action && (event.preventDefault(), formData = new FormData(nativeEventTarget, submitter), startHostTransition(maybeTargetInst, {
								pending: !0,
								data: formData,
								method: nativeEventTarget.method,
								action
							}, action, formData));
						},
						currentTarget: nativeEventTarget
					}]
				});
			}
		}
		for (var i$jscomp$inline_1667 = 0; i$jscomp$inline_1667 < simpleEventPluginEvents.length; i$jscomp$inline_1667++) {
			var eventName$jscomp$inline_1668 = simpleEventPluginEvents[i$jscomp$inline_1667];
			registerSimpleEvent(eventName$jscomp$inline_1668.toLowerCase(), "on" + (eventName$jscomp$inline_1668[0].toUpperCase() + eventName$jscomp$inline_1668.slice(1)));
		}
		registerSimpleEvent(ANIMATION_END, "onAnimationEnd");
		registerSimpleEvent(ANIMATION_ITERATION, "onAnimationIteration");
		registerSimpleEvent(ANIMATION_START, "onAnimationStart");
		registerSimpleEvent("dblclick", "onDoubleClick");
		registerSimpleEvent("focusin", "onFocus");
		registerSimpleEvent("focusout", "onBlur");
		registerSimpleEvent(TRANSITION_RUN, "onTransitionRun");
		registerSimpleEvent(TRANSITION_START, "onTransitionStart");
		registerSimpleEvent(TRANSITION_CANCEL, "onTransitionCancel");
		registerSimpleEvent(TRANSITION_END, "onTransitionEnd");
		registerDirectEvent("onMouseEnter", ["mouseout", "mouseover"]);
		registerDirectEvent("onMouseLeave", ["mouseout", "mouseover"]);
		registerDirectEvent("onPointerEnter", ["pointerout", "pointerover"]);
		registerDirectEvent("onPointerLeave", ["pointerout", "pointerover"]);
		registerTwoPhaseEvent("onChange", "change click focusin focusout input keydown keyup selectionchange".split(" "));
		registerTwoPhaseEvent("onSelect", "focusout contextmenu dragend focusin keydown keyup mousedown mouseup selectionchange".split(" "));
		registerTwoPhaseEvent("onBeforeInput", [
			"compositionend",
			"keypress",
			"textInput",
			"paste"
		]);
		registerTwoPhaseEvent("onCompositionEnd", "compositionend focusout keydown keypress keyup mousedown".split(" "));
		registerTwoPhaseEvent("onCompositionStart", "compositionstart focusout keydown keypress keyup mousedown".split(" "));
		registerTwoPhaseEvent("onCompositionUpdate", "compositionupdate focusout keydown keypress keyup mousedown".split(" "));
		var mediaEventTypes = "abort canplay canplaythrough durationchange emptied encrypted ended error loadeddata loadedmetadata loadstart pause play playing progress ratechange resize seeked seeking stalled suspend timeupdate volumechange waiting".split(" ");
		var nonDelegatedEvents = new Set("beforetoggle cancel close invalid load scroll scrollend toggle".split(" ").concat(mediaEventTypes));
		function processDispatchQueue(dispatchQueue, eventSystemFlags) {
			eventSystemFlags = 0 !== (eventSystemFlags & 4);
			for (var i = 0; i < dispatchQueue.length; i++) {
				var _dispatchQueue$i = dispatchQueue[i], event = _dispatchQueue$i.event;
				_dispatchQueue$i = _dispatchQueue$i.listeners;
				a: {
					var previousInstance = void 0;
					if (eventSystemFlags) for (var i$jscomp$0 = _dispatchQueue$i.length - 1; 0 <= i$jscomp$0; i$jscomp$0--) {
						var _dispatchListeners$i = _dispatchQueue$i[i$jscomp$0], instance = _dispatchListeners$i.instance, currentTarget = _dispatchListeners$i.currentTarget;
						_dispatchListeners$i = _dispatchListeners$i.listener;
						if (instance !== previousInstance && event.isPropagationStopped()) break a;
						previousInstance = _dispatchListeners$i;
						event.currentTarget = currentTarget;
						try {
							previousInstance(event);
						} catch (error) {
							reportGlobalError(error);
						}
						event.currentTarget = null;
						previousInstance = instance;
					}
					else for (i$jscomp$0 = 0; i$jscomp$0 < _dispatchQueue$i.length; i$jscomp$0++) {
						_dispatchListeners$i = _dispatchQueue$i[i$jscomp$0];
						instance = _dispatchListeners$i.instance;
						currentTarget = _dispatchListeners$i.currentTarget;
						_dispatchListeners$i = _dispatchListeners$i.listener;
						if (instance !== previousInstance && event.isPropagationStopped()) break a;
						previousInstance = _dispatchListeners$i;
						event.currentTarget = currentTarget;
						try {
							previousInstance(event);
						} catch (error) {
							reportGlobalError(error);
						}
						event.currentTarget = null;
						previousInstance = instance;
					}
				}
			}
		}
		function listenToNonDelegatedEvent(domEventName, targetElement) {
			var JSCompiler_inline_result = targetElement[internalEventHandlersKey];
			void 0 === JSCompiler_inline_result && (JSCompiler_inline_result = targetElement[internalEventHandlersKey] = new Set());
			var listenerSetKey = domEventName + "__bubble";
			JSCompiler_inline_result.has(listenerSetKey) || (addTrappedEventListener(targetElement, domEventName, 2, !1), JSCompiler_inline_result.add(listenerSetKey));
		}
		function listenToNativeEvent(domEventName, isCapturePhaseListener, target) {
			var eventSystemFlags = 0;
			isCapturePhaseListener && (eventSystemFlags |= 4);
			addTrappedEventListener(target, domEventName, eventSystemFlags, isCapturePhaseListener);
		}
		var listeningMarker = "_reactListening" + Math.random().toString(36).slice(2);
		function listenToAllSupportedEvents(rootContainerElement) {
			if (!rootContainerElement[listeningMarker]) {
				rootContainerElement[listeningMarker] = !0;
				allNativeEvents.forEach(function(domEventName) {
					"selectionchange" !== domEventName && (nonDelegatedEvents.has(domEventName) || listenToNativeEvent(domEventName, !1, rootContainerElement), listenToNativeEvent(domEventName, !0, rootContainerElement));
				});
				var ownerDocument = 9 === rootContainerElement.nodeType ? rootContainerElement : rootContainerElement.ownerDocument;
				null === ownerDocument || ownerDocument[listeningMarker] || (ownerDocument[listeningMarker] = !0, listenToNativeEvent("selectionchange", !1, ownerDocument));
			}
		}
		function addTrappedEventListener(targetContainer, domEventName, eventSystemFlags, isCapturePhaseListener) {
			switch (getEventPriority(domEventName)) {
				case 2:
					var listenerWrapper = dispatchDiscreteEvent;
					break;
				case 8:
					listenerWrapper = dispatchContinuousEvent;
					break;
				default: listenerWrapper = dispatchEvent;
			}
			eventSystemFlags = listenerWrapper.bind(null, domEventName, eventSystemFlags, targetContainer);
			listenerWrapper = void 0;
			!passiveBrowserEventsSupported || "touchstart" !== domEventName && "touchmove" !== domEventName && "wheel" !== domEventName || (listenerWrapper = !0);
			isCapturePhaseListener ? void 0 !== listenerWrapper ? targetContainer.addEventListener(domEventName, eventSystemFlags, {
				capture: !0,
				passive: listenerWrapper
			}) : targetContainer.addEventListener(domEventName, eventSystemFlags, !0) : void 0 !== listenerWrapper ? targetContainer.addEventListener(domEventName, eventSystemFlags, { passive: listenerWrapper }) : targetContainer.addEventListener(domEventName, eventSystemFlags, !1);
		}
		function dispatchEventForPluginEventSystem(domEventName, eventSystemFlags, nativeEvent, targetInst$jscomp$0, targetContainer) {
			var ancestorInst = targetInst$jscomp$0;
			if (0 === (eventSystemFlags & 1) && 0 === (eventSystemFlags & 2) && null !== targetInst$jscomp$0) a: for (;;) {
				if (null === targetInst$jscomp$0) return;
				var nodeTag = targetInst$jscomp$0.tag;
				if (3 === nodeTag || 4 === nodeTag) {
					var container = targetInst$jscomp$0.stateNode.containerInfo;
					if (container === targetContainer) break;
					if (4 === nodeTag) for (nodeTag = targetInst$jscomp$0.return; null !== nodeTag;) {
						var grandTag = nodeTag.tag;
						if ((3 === grandTag || 4 === grandTag) && nodeTag.stateNode.containerInfo === targetContainer) return;
						nodeTag = nodeTag.return;
					}
					for (; null !== container;) {
						nodeTag = getClosestInstanceFromNode(container);
						if (null === nodeTag) return;
						grandTag = nodeTag.tag;
						if (5 === grandTag || 6 === grandTag || 26 === grandTag || 27 === grandTag) {
							targetInst$jscomp$0 = ancestorInst = nodeTag;
							continue a;
						}
						container = container.parentNode;
					}
				}
				targetInst$jscomp$0 = targetInst$jscomp$0.return;
			}
			batchedUpdates$1(function() {
				var targetInst = ancestorInst, nativeEventTarget = getEventTarget(nativeEvent), dispatchQueue = [];
				a: {
					var reactName = topLevelEventsToReactNames.get(domEventName);
					if (void 0 !== reactName) {
						var SyntheticEventCtor = SyntheticEvent, reactEventType = domEventName;
						switch (domEventName) {
							case "keypress": if (0 === getEventCharCode(nativeEvent)) break a;
							case "keydown":
							case "keyup":
								SyntheticEventCtor = SyntheticKeyboardEvent;
								break;
							case "focusin":
								reactEventType = "focus";
								SyntheticEventCtor = SyntheticFocusEvent;
								break;
							case "focusout":
								reactEventType = "blur";
								SyntheticEventCtor = SyntheticFocusEvent;
								break;
							case "beforeblur":
							case "afterblur":
								SyntheticEventCtor = SyntheticFocusEvent;
								break;
							case "click": if (2 === nativeEvent.button) break a;
							case "auxclick":
							case "dblclick":
							case "mousedown":
							case "mousemove":
							case "mouseup":
							case "mouseout":
							case "mouseover":
							case "contextmenu":
								SyntheticEventCtor = SyntheticMouseEvent;
								break;
							case "drag":
							case "dragend":
							case "dragenter":
							case "dragexit":
							case "dragleave":
							case "dragover":
							case "dragstart":
							case "drop":
								SyntheticEventCtor = SyntheticDragEvent;
								break;
							case "touchcancel":
							case "touchend":
							case "touchmove":
							case "touchstart":
								SyntheticEventCtor = SyntheticTouchEvent;
								break;
							case ANIMATION_END:
							case ANIMATION_ITERATION:
							case ANIMATION_START:
								SyntheticEventCtor = SyntheticAnimationEvent;
								break;
							case TRANSITION_END:
								SyntheticEventCtor = SyntheticTransitionEvent;
								break;
							case "scroll":
							case "scrollend":
								SyntheticEventCtor = SyntheticUIEvent;
								break;
							case "wheel":
								SyntheticEventCtor = SyntheticWheelEvent;
								break;
							case "copy":
							case "cut":
							case "paste":
								SyntheticEventCtor = SyntheticClipboardEvent;
								break;
							case "gotpointercapture":
							case "lostpointercapture":
							case "pointercancel":
							case "pointerdown":
							case "pointermove":
							case "pointerout":
							case "pointerover":
							case "pointerup":
								SyntheticEventCtor = SyntheticPointerEvent;
								break;
							case "submit":
								SyntheticEventCtor = SyntheticSubmitEvent;
								break;
							case "toggle":
							case "beforetoggle": SyntheticEventCtor = SyntheticToggleEvent;
						}
						var inCapturePhase = 0 !== (eventSystemFlags & 4), accumulateTargetOnly = !inCapturePhase && ("scroll" === domEventName || "scrollend" === domEventName), reactEventName = inCapturePhase ? null !== reactName ? reactName + "Capture" : null : reactName;
						inCapturePhase = [];
						for (var instance = targetInst, lastHostComponent; null !== instance;) {
							var _instance = instance;
							lastHostComponent = _instance.stateNode;
							_instance = _instance.tag;
							5 !== _instance && 26 !== _instance && 27 !== _instance || null === lastHostComponent || null === reactEventName || (_instance = getListener(instance, reactEventName), null != _instance && inCapturePhase.push(createDispatchListener(instance, _instance, lastHostComponent)));
							if (accumulateTargetOnly) break;
							instance = instance.return;
						}
						0 < inCapturePhase.length && (reactName = new SyntheticEventCtor(reactName, reactEventType, null, nativeEvent, nativeEventTarget), dispatchQueue.push({
							event: reactName,
							listeners: inCapturePhase
						}));
					}
				}
				if (0 === (eventSystemFlags & 7)) {
					a: {
						SyntheticEventCtor = "mouseover" === domEventName || "pointerover" === domEventName;
						reactName = "mouseout" === domEventName || "pointerout" === domEventName;
						if (SyntheticEventCtor && nativeEvent !== currentReplayingEvent && (reactEventType = nativeEvent.relatedTarget || nativeEvent.fromElement) && (getClosestInstanceFromNode(reactEventType) || reactEventType[internalContainerInstanceKey])) break a;
						if (reactName || SyntheticEventCtor) {
							reactEventType = nativeEventTarget.window === nativeEventTarget ? nativeEventTarget : (SyntheticEventCtor = nativeEventTarget.ownerDocument) ? SyntheticEventCtor.defaultView || SyntheticEventCtor.parentWindow : window;
							if (reactName) {
								if (SyntheticEventCtor = nativeEvent.relatedTarget || nativeEvent.toElement, reactName = targetInst, SyntheticEventCtor = SyntheticEventCtor ? getClosestInstanceFromNode(SyntheticEventCtor) : null, null !== SyntheticEventCtor && (accumulateTargetOnly = getNearestMountedFiber(SyntheticEventCtor), inCapturePhase = SyntheticEventCtor.tag, SyntheticEventCtor !== accumulateTargetOnly || 5 !== inCapturePhase && 27 !== inCapturePhase && 6 !== inCapturePhase)) SyntheticEventCtor = null;
							} else reactName = null, SyntheticEventCtor = targetInst;
							if (reactName !== SyntheticEventCtor) {
								inCapturePhase = SyntheticMouseEvent;
								_instance = "onMouseLeave";
								reactEventName = "onMouseEnter";
								instance = "mouse";
								if ("pointerout" === domEventName || "pointerover" === domEventName) inCapturePhase = SyntheticPointerEvent, _instance = "onPointerLeave", reactEventName = "onPointerEnter", instance = "pointer";
								accumulateTargetOnly = null == reactName ? reactEventType : getNodeFromInstance(reactName);
								lastHostComponent = null == SyntheticEventCtor ? reactEventType : getNodeFromInstance(SyntheticEventCtor);
								reactEventType = new inCapturePhase(_instance, instance + "leave", reactName, nativeEvent, nativeEventTarget);
								reactEventType.target = accumulateTargetOnly;
								reactEventType.relatedTarget = lastHostComponent;
								_instance = null;
								getClosestInstanceFromNode(nativeEventTarget) === targetInst && (inCapturePhase = new inCapturePhase(reactEventName, instance + "enter", SyntheticEventCtor, nativeEvent, nativeEventTarget), inCapturePhase.target = lastHostComponent, inCapturePhase.relatedTarget = accumulateTargetOnly, _instance = inCapturePhase);
								accumulateTargetOnly = _instance;
								inCapturePhase = reactName && SyntheticEventCtor ? getLowestCommonAncestor(reactName, SyntheticEventCtor, getParent) : null;
								null !== reactName && accumulateEnterLeaveListenersForEvent(dispatchQueue, reactEventType, reactName, inCapturePhase, !1);
								null !== SyntheticEventCtor && null !== accumulateTargetOnly && accumulateEnterLeaveListenersForEvent(dispatchQueue, accumulateTargetOnly, SyntheticEventCtor, inCapturePhase, !0);
							}
						}
					}
					a: {
						reactName = targetInst ? getNodeFromInstance(targetInst) : window;
						SyntheticEventCtor = reactName.nodeName && reactName.nodeName.toLowerCase();
						if ("select" === SyntheticEventCtor || "input" === SyntheticEventCtor && "file" === reactName.type) var getTargetInstFunc = getTargetInstForChangeEvent;
						else if (isTextInputElement(reactName)) if (isInputEventSupported) getTargetInstFunc = getTargetInstForInputOrChangeEvent;
						else {
							getTargetInstFunc = getTargetInstForInputEventPolyfill;
							var handleEventFunc = handleEventsForInputEventPolyfill;
						}
						else SyntheticEventCtor = reactName.nodeName, !SyntheticEventCtor || "input" !== SyntheticEventCtor.toLowerCase() || "checkbox" !== reactName.type && "radio" !== reactName.type ? targetInst && isCustomElement(targetInst.elementType) && (getTargetInstFunc = getTargetInstForChangeEvent) : getTargetInstFunc = getTargetInstForClickEvent;
						if (getTargetInstFunc && (getTargetInstFunc = getTargetInstFunc(domEventName, targetInst))) {
							createAndAccumulateChangeEvent(dispatchQueue, getTargetInstFunc, nativeEvent, nativeEventTarget);
							break a;
						}
						handleEventFunc && handleEventFunc(domEventName, reactName, targetInst);
					}
					handleEventFunc = targetInst ? getNodeFromInstance(targetInst) : window;
					switch (domEventName) {
						case "focusin":
							if (isTextInputElement(handleEventFunc) || "true" === handleEventFunc.contentEditable) activeElement = handleEventFunc, activeElementInst = targetInst, lastSelection = null;
							break;
						case "focusout":
							lastSelection = activeElementInst = activeElement = null;
							break;
						case "mousedown":
							mouseDown = !0;
							break;
						case "contextmenu":
						case "mouseup":
						case "dragend":
							mouseDown = !1;
							constructSelectEvent(dispatchQueue, nativeEvent, nativeEventTarget);
							break;
						case "selectionchange": if (skipSelectionChangeEvent) break;
						case "keydown":
						case "keyup": constructSelectEvent(dispatchQueue, nativeEvent, nativeEventTarget);
					}
					var fallbackData;
					if (canUseCompositionEvent) b: {
						switch (domEventName) {
							case "compositionstart":
								var eventType = "onCompositionStart";
								break b;
							case "compositionend":
								eventType = "onCompositionEnd";
								break b;
							case "compositionupdate":
								eventType = "onCompositionUpdate";
								break b;
						}
						eventType = void 0;
					}
					else isComposing ? isFallbackCompositionEnd(domEventName, nativeEvent) && (eventType = "onCompositionEnd") : "keydown" === domEventName && 229 === nativeEvent.keyCode && (eventType = "onCompositionStart");
					eventType && (useFallbackCompositionData && "ko" !== nativeEvent.locale && (isComposing || "onCompositionStart" !== eventType ? "onCompositionEnd" === eventType && isComposing && (fallbackData = getData()) : (root = nativeEventTarget, startText = "value" in root ? root.value : root.textContent, isComposing = !0)), handleEventFunc = accumulateTwoPhaseListeners(targetInst, eventType), 0 < handleEventFunc.length && (eventType = new SyntheticCompositionEvent(eventType, domEventName, null, nativeEvent, nativeEventTarget), dispatchQueue.push({
						event: eventType,
						listeners: handleEventFunc
					}), fallbackData ? eventType.data = fallbackData : (fallbackData = getDataFromCustomEvent(nativeEvent), null !== fallbackData && (eventType.data = fallbackData))));
					if (fallbackData = canUseTextInputEvent ? getNativeBeforeInputChars(domEventName, nativeEvent) : getFallbackBeforeInputChars(domEventName, nativeEvent)) eventType = accumulateTwoPhaseListeners(targetInst, "onBeforeInput"), 0 < eventType.length && (handleEventFunc = new SyntheticCompositionEvent("onBeforeInput", "beforeinput", null, nativeEvent, nativeEventTarget), dispatchQueue.push({
						event: handleEventFunc,
						listeners: eventType
					}), handleEventFunc.data = fallbackData);
					extractEvents$1(dispatchQueue, domEventName, targetInst, nativeEvent, nativeEventTarget);
				}
				processDispatchQueue(dispatchQueue, eventSystemFlags);
			});
		}
		function createDispatchListener(instance, listener, currentTarget) {
			return {
				instance,
				listener,
				currentTarget
			};
		}
		function accumulateTwoPhaseListeners(targetFiber, reactName) {
			for (var captureName = reactName + "Capture", listeners = []; null !== targetFiber;) {
				var _instance2 = targetFiber, stateNode = _instance2.stateNode;
				_instance2 = _instance2.tag;
				5 !== _instance2 && 26 !== _instance2 && 27 !== _instance2 || null === stateNode || (_instance2 = getListener(targetFiber, captureName), null != _instance2 && listeners.unshift(createDispatchListener(targetFiber, _instance2, stateNode)), _instance2 = getListener(targetFiber, reactName), null != _instance2 && listeners.push(createDispatchListener(targetFiber, _instance2, stateNode)));
				if (3 === targetFiber.tag) return listeners;
				targetFiber = targetFiber.return;
			}
			return [];
		}
		function getParent(inst) {
			if (null === inst) return null;
			do
				inst = inst.return;
			while (inst && 5 !== inst.tag && 27 !== inst.tag);
			return inst ? inst : null;
		}
		function accumulateEnterLeaveListenersForEvent(dispatchQueue, event, target, common, inCapturePhase) {
			for (var registrationName = event._reactName, listeners = []; null !== target && target !== common;) {
				var _instance3 = target, alternate = _instance3.alternate, stateNode = _instance3.stateNode;
				_instance3 = _instance3.tag;
				if (null !== alternate && alternate === common) break;
				5 !== _instance3 && 26 !== _instance3 && 27 !== _instance3 || null === stateNode || (alternate = stateNode, inCapturePhase ? (stateNode = getListener(target, registrationName), null != stateNode && listeners.unshift(createDispatchListener(target, stateNode, alternate))) : inCapturePhase || (stateNode = getListener(target, registrationName), null != stateNode && listeners.push(createDispatchListener(target, stateNode, alternate))));
				target = target.return;
			}
			0 !== listeners.length && dispatchQueue.push({
				event,
				listeners
			});
		}
		var NORMALIZE_NEWLINES_REGEX = /\r\n?/g;
		var NORMALIZE_NULL_AND_REPLACEMENT_REGEX = /\u0000|\uFFFD/g;
		function normalizeMarkupForTextOrAttribute(markup) {
			return ("string" === typeof markup ? markup : "" + markup).replace(NORMALIZE_NEWLINES_REGEX, "\n").replace(NORMALIZE_NULL_AND_REPLACEMENT_REGEX, "");
		}
		function checkForUnmatchedText(serverText, clientText) {
			clientText = normalizeMarkupForTextOrAttribute(clientText);
			return normalizeMarkupForTextOrAttribute(serverText) === clientText ? !0 : !1;
		}
		function setProp(domElement, tag, key, value, props, prevValue) {
			switch (key) {
				case "children":
					if ("string" === typeof value) "body" === tag || "textarea" === tag && "" === value || setTextContent(domElement, value);
					else if ("number" === typeof value || "bigint" === typeof value) "body" !== tag && setTextContent(domElement, "" + value);
					else return;
					break;
				case "className":
					setValueForKnownAttribute(domElement, "class", value);
					break;
				case "tabIndex":
					setValueForKnownAttribute(domElement, "tabindex", value);
					break;
				case "dir":
				case "role":
				case "viewBox":
				case "width":
				case "height":
					setValueForKnownAttribute(domElement, key, value);
					break;
				case "style":
					setValueForStyles(domElement, value, prevValue);
					return;
				case "data": if ("object" !== tag) {
					setValueForKnownAttribute(domElement, "data", value);
					break;
				}
				case "src":
				case "href":
					if ("" === value && ("a" !== tag || "href" !== key)) {
						domElement.removeAttribute(key);
						break;
					}
					if (null == value || "function" === typeof value || "symbol" === typeof value || "boolean" === typeof value) {
						domElement.removeAttribute(key);
						break;
					}
					value = sanitizeURL(value);
					domElement.setAttribute(key, value);
					break;
				case "action":
				case "formAction":
					if ("function" === typeof value) {
						domElement.setAttribute(key, "javascript:throw new Error('A React form was unexpectedly submitted. If you called form.submit() manually, consider using form.requestSubmit() instead. If you\\'re trying to use event.stopPropagation() in a submit event handler, consider also calling event.preventDefault().')");
						break;
					} else "function" === typeof prevValue && ("formAction" === key ? ("input" !== tag && setProp(domElement, tag, "name", props.name, props, null), setProp(domElement, tag, "formEncType", props.formEncType, props, null), setProp(domElement, tag, "formMethod", props.formMethod, props, null), setProp(domElement, tag, "formTarget", props.formTarget, props, null)) : (setProp(domElement, tag, "encType", props.encType, props, null), setProp(domElement, tag, "method", props.method, props, null), setProp(domElement, tag, "target", props.target, props, null)));
					if (null == value || "symbol" === typeof value || "boolean" === typeof value) {
						domElement.removeAttribute(key);
						break;
					}
					value = sanitizeURL(value);
					domElement.setAttribute(key, value);
					break;
				case "onClick":
					null != value && (domElement.onclick = noop$1);
					return;
				case "onScroll":
					null != value && listenToNonDelegatedEvent("scroll", domElement);
					return;
				case "onScrollEnd":
					null != value && listenToNonDelegatedEvent("scrollend", domElement);
					return;
				case "dangerouslySetInnerHTML":
					if (null != value) {
						if ("object" !== typeof value || !("__html" in value)) throw Error(formatProdErrorMessage(61));
						key = value.__html;
						if (null != key) {
							if (null != props.children) throw Error(formatProdErrorMessage(60));
							(null != prevValue ? prevValue.__html : void 0) !== key && (domElement.innerHTML = key);
						}
					}
					break;
				case "multiple":
					domElement.multiple = value && "function" !== typeof value && "symbol" !== typeof value;
					break;
				case "muted":
					domElement.muted = value && "function" !== typeof value && "symbol" !== typeof value;
					break;
				case "suppressContentEditableWarning":
				case "suppressHydrationWarning":
				case "defaultValue":
				case "defaultChecked":
				case "innerHTML":
				case "ref": break;
				case "autoFocus": break;
				case "xlinkHref":
					if (null == value || "function" === typeof value || "boolean" === typeof value || "symbol" === typeof value) {
						domElement.removeAttribute("xlink:href");
						break;
					}
					key = sanitizeURL(value);
					domElement.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", key);
					break;
				case "contentEditable":
				case "spellCheck":
				case "draggable":
				case "value":
				case "autoReverse":
				case "externalResourcesRequired":
				case "focusable":
				case "preserveAlpha":
					null != value && "function" !== typeof value && "symbol" !== typeof value ? domElement.setAttribute(key, value) : domElement.removeAttribute(key);
					break;
				case "inert":
				case "allowFullScreen":
				case "async":
				case "autoPlay":
				case "controls":
				case "credentialless":
				case "default":
				case "defer":
				case "disabled":
				case "disablePictureInPicture":
				case "disableRemotePlayback":
				case "formNoValidate":
				case "hidden":
				case "loop":
				case "noModule":
				case "noValidate":
				case "open":
				case "playsInline":
				case "readOnly":
				case "required":
				case "reversed":
				case "scoped":
				case "seamless":
				case "itemScope":
					value && "function" !== typeof value && "symbol" !== typeof value ? domElement.setAttribute(key, "") : domElement.removeAttribute(key);
					break;
				case "capture":
				case "download":
					!0 === value ? domElement.setAttribute(key, "") : !1 !== value && null != value && "function" !== typeof value && "symbol" !== typeof value ? domElement.setAttribute(key, value) : domElement.removeAttribute(key);
					break;
				case "cols":
				case "rows":
				case "size":
				case "span":
					null != value && "function" !== typeof value && "symbol" !== typeof value && !isNaN(value) && 1 <= value ? domElement.setAttribute(key, value) : domElement.removeAttribute(key);
					break;
				case "rowSpan":
				case "start":
					null == value || "function" === typeof value || "symbol" === typeof value || isNaN(value) ? domElement.removeAttribute(key) : domElement.setAttribute(key, value);
					break;
				case "popover":
					listenToNonDelegatedEvent("beforetoggle", domElement);
					listenToNonDelegatedEvent("toggle", domElement);
					setValueForAttribute(domElement, "popover", value);
					break;
				case "xlinkActuate":
					setValueForNamespacedAttribute(domElement, "http://www.w3.org/1999/xlink", "xlink:actuate", value);
					break;
				case "xlinkArcrole":
					setValueForNamespacedAttribute(domElement, "http://www.w3.org/1999/xlink", "xlink:arcrole", value);
					break;
				case "xlinkRole":
					setValueForNamespacedAttribute(domElement, "http://www.w3.org/1999/xlink", "xlink:role", value);
					break;
				case "xlinkShow":
					setValueForNamespacedAttribute(domElement, "http://www.w3.org/1999/xlink", "xlink:show", value);
					break;
				case "xlinkTitle":
					setValueForNamespacedAttribute(domElement, "http://www.w3.org/1999/xlink", "xlink:title", value);
					break;
				case "xlinkType":
					setValueForNamespacedAttribute(domElement, "http://www.w3.org/1999/xlink", "xlink:type", value);
					break;
				case "xmlBase":
					setValueForNamespacedAttribute(domElement, "http://www.w3.org/XML/1998/namespace", "xml:base", value);
					break;
				case "xmlLang":
					setValueForNamespacedAttribute(domElement, "http://www.w3.org/XML/1998/namespace", "xml:lang", value);
					break;
				case "xmlSpace":
					setValueForNamespacedAttribute(domElement, "http://www.w3.org/XML/1998/namespace", "xml:space", value);
					break;
				case "is":
					setValueForAttribute(domElement, "is", value);
					break;
				case "innerText":
				case "textContent": return;
				default: if (!(2 < key.length) || "o" !== key[0] && "O" !== key[0] || "n" !== key[1] && "N" !== key[1]) key = aliases.get(key) || key, setValueForAttribute(domElement, key, value);
				else return;
			}
			viewTransitionMutationContext = !0;
		}
		function setPropOnCustomElement(domElement, tag, key, value, props, prevValue) {
			switch (key) {
				case "style":
					setValueForStyles(domElement, value, prevValue);
					return;
				case "dangerouslySetInnerHTML":
					if (null != value) {
						if ("object" !== typeof value || !("__html" in value)) throw Error(formatProdErrorMessage(61));
						key = value.__html;
						if (null != key) {
							if (null != props.children) throw Error(formatProdErrorMessage(60));
							(null != prevValue ? prevValue.__html : void 0) !== key && (domElement.innerHTML = key);
						}
					}
					break;
				case "children":
					if ("string" === typeof value) setTextContent(domElement, value);
					else if ("number" === typeof value || "bigint" === typeof value) setTextContent(domElement, "" + value);
					else return;
					break;
				case "onScroll":
					null != value && listenToNonDelegatedEvent("scroll", domElement);
					return;
				case "onScrollEnd":
					null != value && listenToNonDelegatedEvent("scrollend", domElement);
					return;
				case "onClick":
					null != value && (domElement.onclick = noop$1);
					return;
				case "suppressContentEditableWarning":
				case "suppressHydrationWarning":
				case "innerHTML":
				case "ref": return;
				case "innerText":
				case "textContent": return;
				default:
					if (!registrationNameDependencies.hasOwnProperty(key)) a: {
						if ("o" === key[0] && "n" === key[1] && (props = key.endsWith("Capture"), prevValue = key.slice(2, props ? key.length - 7 : void 0), tag = domElement[internalPropsKey] || null, tag = null != tag ? tag[key] : null, "function" === typeof tag && domElement.removeEventListener(prevValue, tag, props), "function" === typeof value)) {
							"function" !== typeof tag && null !== tag && (key in domElement ? domElement[key] = null : domElement.hasAttribute(key) && domElement.removeAttribute(key));
							domElement.addEventListener(prevValue, value, props);
							break a;
						}
						viewTransitionMutationContext = !0;
						key in domElement ? domElement[key] = value : !0 === value ? domElement.setAttribute(key, "") : setValueForAttribute(domElement, key, value);
					}
					return;
			}
			viewTransitionMutationContext = !0;
		}
		function setInitialProperties(domElement, tag, props) {
			switch (tag) {
				case "div":
				case "span":
				case "svg":
				case "path":
				case "a":
				case "g":
				case "p":
				case "li": break;
				case "img":
					listenToNonDelegatedEvent("error", domElement);
					listenToNonDelegatedEvent("load", domElement);
					var hasSrc = !1, hasSrcSet = !1, propKey;
					for (propKey in props) if (props.hasOwnProperty(propKey)) {
						var propValue = props[propKey];
						if (null != propValue) switch (propKey) {
							case "src":
								hasSrc = !0;
								break;
							case "srcSet":
								hasSrcSet = !0;
								break;
							case "children":
							case "dangerouslySetInnerHTML": throw Error(formatProdErrorMessage(137, tag));
							default: setProp(domElement, tag, propKey, propValue, props, null);
						}
					}
					hasSrcSet && setProp(domElement, tag, "srcSet", props.srcSet, props, null);
					hasSrc && setProp(domElement, tag, "src", props.src, props, null);
					return;
				case "input":
					listenToNonDelegatedEvent("invalid", domElement);
					var defaultValue = propKey = propValue = hasSrcSet = null, checked = null, defaultChecked = null;
					for (hasSrc in props) if (props.hasOwnProperty(hasSrc)) {
						var propValue$204 = props[hasSrc];
						if (null != propValue$204) switch (hasSrc) {
							case "name":
								hasSrcSet = propValue$204;
								break;
							case "type":
								propValue = propValue$204;
								break;
							case "checked":
								checked = propValue$204;
								break;
							case "defaultChecked":
								defaultChecked = propValue$204;
								break;
							case "value":
								propKey = propValue$204;
								break;
							case "defaultValue":
								defaultValue = propValue$204;
								break;
							case "children":
							case "dangerouslySetInnerHTML":
								if (null != propValue$204) throw Error(formatProdErrorMessage(137, tag));
								break;
							default: setProp(domElement, tag, hasSrc, propValue$204, props, null);
						}
					}
					initInput(domElement, propKey, defaultValue, checked, defaultChecked, propValue, hasSrcSet, !1);
					return;
				case "select":
					listenToNonDelegatedEvent("invalid", domElement);
					hasSrc = propValue = propKey = null;
					for (hasSrcSet in props) if (props.hasOwnProperty(hasSrcSet) && (defaultValue = props[hasSrcSet], null != defaultValue)) switch (hasSrcSet) {
						case "value":
							propKey = defaultValue;
							break;
						case "defaultValue":
							propValue = defaultValue;
							break;
						case "multiple": hasSrc = defaultValue;
						default: setProp(domElement, tag, hasSrcSet, defaultValue, props, null);
					}
					tag = propKey;
					props = propValue;
					domElement.multiple = !!hasSrc;
					null != tag ? updateOptions(domElement, !!hasSrc, tag, !1) : null != props && updateOptions(domElement, !!hasSrc, props, !0);
					return;
				case "textarea":
					listenToNonDelegatedEvent("invalid", domElement);
					propKey = hasSrcSet = hasSrc = null;
					for (propValue in props) if (props.hasOwnProperty(propValue) && (defaultValue = props[propValue], null != defaultValue)) switch (propValue) {
						case "value":
							hasSrc = defaultValue;
							break;
						case "defaultValue":
							hasSrcSet = defaultValue;
							break;
						case "children":
							propKey = defaultValue;
							break;
						case "dangerouslySetInnerHTML":
							if (null != defaultValue) throw Error(formatProdErrorMessage(91));
							break;
						default: setProp(domElement, tag, propValue, defaultValue, props, null);
					}
					initTextarea(domElement, hasSrc, hasSrcSet, propKey);
					return;
				case "option":
					for (checked in props) if (props.hasOwnProperty(checked) && (hasSrc = props[checked], null != hasSrc)) switch (checked) {
						case "selected":
							domElement.selected = hasSrc && "function" !== typeof hasSrc && "symbol" !== typeof hasSrc;
							break;
						default: setProp(domElement, tag, checked, hasSrc, props, null);
					}
					return;
				case "dialog":
					listenToNonDelegatedEvent("beforetoggle", domElement);
					listenToNonDelegatedEvent("toggle", domElement);
					listenToNonDelegatedEvent("cancel", domElement);
					listenToNonDelegatedEvent("close", domElement);
					break;
				case "iframe":
				case "object":
					listenToNonDelegatedEvent("load", domElement);
					break;
				case "video":
				case "audio":
					for (hasSrc = 0; hasSrc < mediaEventTypes.length; hasSrc++) listenToNonDelegatedEvent(mediaEventTypes[hasSrc], domElement);
					break;
				case "image":
					listenToNonDelegatedEvent("error", domElement);
					listenToNonDelegatedEvent("load", domElement);
					break;
				case "details":
					listenToNonDelegatedEvent("toggle", domElement);
					break;
				case "embed":
				case "source":
				case "link": listenToNonDelegatedEvent("error", domElement), listenToNonDelegatedEvent("load", domElement);
				case "area":
				case "base":
				case "br":
				case "col":
				case "hr":
				case "keygen":
				case "meta":
				case "param":
				case "track":
				case "wbr":
				case "menuitem":
					for (defaultChecked in props) if (props.hasOwnProperty(defaultChecked) && (hasSrc = props[defaultChecked], null != hasSrc)) switch (defaultChecked) {
						case "children":
						case "dangerouslySetInnerHTML": throw Error(formatProdErrorMessage(137, tag));
						default: setProp(domElement, tag, defaultChecked, hasSrc, props, null);
					}
					return;
				default: if (isCustomElement(tag)) {
					for (propValue$204 in props) props.hasOwnProperty(propValue$204) && (hasSrc = props[propValue$204], void 0 !== hasSrc && setPropOnCustomElement(domElement, tag, propValue$204, hasSrc, props, void 0));
					return;
				}
			}
			for (defaultValue in props) props.hasOwnProperty(defaultValue) && (hasSrc = props[defaultValue], null != hasSrc && setProp(domElement, tag, defaultValue, hasSrc, props, null));
		}
		var emptyProps = {};
		function updateProperties(domElement, tag, lastProps, nextProps) {
			switch (tag) {
				case "div":
				case "span":
				case "svg":
				case "path":
				case "a":
				case "g":
				case "p":
				case "li": break;
				case "input":
					var name = null, type = null, value = null, defaultValue = null, lastDefaultValue = null, checked = null, defaultChecked = null;
					for (propKey in lastProps) {
						var lastProp = lastProps[propKey];
						if (lastProps.hasOwnProperty(propKey) && null != lastProp) switch (propKey) {
							case "checked": break;
							case "value": break;
							case "defaultValue": lastDefaultValue = lastProp;
							default: nextProps.hasOwnProperty(propKey) || setProp(domElement, tag, propKey, null, nextProps, lastProp);
						}
					}
					for (var propKey$221 in nextProps) {
						var propKey = nextProps[propKey$221];
						lastProp = lastProps[propKey$221];
						if (nextProps.hasOwnProperty(propKey$221) && (null != propKey || null != lastProp)) switch (propKey$221) {
							case "type":
								propKey !== lastProp && (viewTransitionMutationContext = !0);
								type = propKey;
								break;
							case "name":
								propKey !== lastProp && (viewTransitionMutationContext = !0);
								name = propKey;
								break;
							case "checked":
								propKey !== lastProp && (viewTransitionMutationContext = !0);
								checked = propKey;
								break;
							case "defaultChecked":
								propKey !== lastProp && (viewTransitionMutationContext = !0);
								defaultChecked = propKey;
								break;
							case "value":
								propKey !== lastProp && (viewTransitionMutationContext = !0);
								value = propKey;
								break;
							case "defaultValue":
								propKey !== lastProp && (viewTransitionMutationContext = !0);
								defaultValue = propKey;
								break;
							case "children":
							case "dangerouslySetInnerHTML":
								if (null != propKey) throw Error(formatProdErrorMessage(137, tag));
								break;
							default: propKey !== lastProp && setProp(domElement, tag, propKey$221, propKey, nextProps, lastProp);
						}
					}
					updateInput(domElement, value, defaultValue, lastDefaultValue, checked, defaultChecked, type, name);
					return;
				case "select":
					propKey = value = defaultValue = propKey$221 = null;
					for (type in lastProps) if (lastDefaultValue = lastProps[type], lastProps.hasOwnProperty(type) && null != lastDefaultValue) switch (type) {
						case "value": break;
						case "multiple": propKey = lastDefaultValue;
						default: nextProps.hasOwnProperty(type) || setProp(domElement, tag, type, null, nextProps, lastDefaultValue);
					}
					for (name in nextProps) if (type = nextProps[name], lastDefaultValue = lastProps[name], nextProps.hasOwnProperty(name) && (null != type || null != lastDefaultValue)) switch (name) {
						case "value":
							type !== lastDefaultValue && (viewTransitionMutationContext = !0);
							propKey$221 = type;
							break;
						case "defaultValue":
							type !== lastDefaultValue && (viewTransitionMutationContext = !0);
							defaultValue = type;
							break;
						case "multiple": type !== lastDefaultValue && (viewTransitionMutationContext = !0), value = type;
						default: type !== lastDefaultValue && setProp(domElement, tag, name, type, nextProps, lastDefaultValue);
					}
					tag = defaultValue;
					lastProps = value;
					nextProps = propKey;
					null != propKey$221 ? updateOptions(domElement, !!lastProps, propKey$221, !1) : !!nextProps !== !!lastProps && (null != tag ? updateOptions(domElement, !!lastProps, tag, !0) : updateOptions(domElement, !!lastProps, lastProps ? [] : "", !1));
					return;
				case "textarea":
					propKey = propKey$221 = null;
					for (defaultValue in lastProps) if (name = lastProps[defaultValue], lastProps.hasOwnProperty(defaultValue) && null != name && !nextProps.hasOwnProperty(defaultValue)) switch (defaultValue) {
						case "value": break;
						case "children": break;
						default: setProp(domElement, tag, defaultValue, null, nextProps, name);
					}
					for (value in nextProps) if (name = nextProps[value], type = lastProps[value], nextProps.hasOwnProperty(value) && (null != name || null != type)) switch (value) {
						case "value":
							name !== type && (viewTransitionMutationContext = !0);
							propKey$221 = name;
							break;
						case "defaultValue":
							name !== type && (viewTransitionMutationContext = !0);
							propKey = name;
							break;
						case "children": break;
						case "dangerouslySetInnerHTML":
							if (null != name) throw Error(formatProdErrorMessage(91));
							break;
						default: name !== type && setProp(domElement, tag, value, name, nextProps, type);
					}
					updateTextarea(domElement, propKey$221, propKey);
					return;
				case "option":
					for (var propKey$237 in lastProps) if (propKey$221 = lastProps[propKey$237], lastProps.hasOwnProperty(propKey$237) && null != propKey$221 && !nextProps.hasOwnProperty(propKey$237)) switch (propKey$237) {
						case "selected":
							domElement.selected = !1;
							break;
						default: setProp(domElement, tag, propKey$237, null, nextProps, propKey$221);
					}
					for (lastDefaultValue in nextProps) if (propKey$221 = nextProps[lastDefaultValue], propKey = lastProps[lastDefaultValue], nextProps.hasOwnProperty(lastDefaultValue) && propKey$221 !== propKey && (null != propKey$221 || null != propKey)) switch (lastDefaultValue) {
						case "selected":
							propKey$221 !== propKey && (viewTransitionMutationContext = !0);
							domElement.selected = propKey$221 && "function" !== typeof propKey$221 && "symbol" !== typeof propKey$221;
							break;
						default: setProp(domElement, tag, lastDefaultValue, propKey$221, nextProps, propKey);
					}
					return;
				case "img":
				case "link":
				case "area":
				case "base":
				case "br":
				case "col":
				case "embed":
				case "hr":
				case "keygen":
				case "meta":
				case "param":
				case "source":
				case "track":
				case "wbr":
				case "menuitem":
					for (var propKey$242 in lastProps) propKey$221 = lastProps[propKey$242], lastProps.hasOwnProperty(propKey$242) && null != propKey$221 && !nextProps.hasOwnProperty(propKey$242) && setProp(domElement, tag, propKey$242, null, nextProps, propKey$221);
					for (checked in nextProps) if (propKey$221 = nextProps[checked], propKey = lastProps[checked], nextProps.hasOwnProperty(checked) && propKey$221 !== propKey && (null != propKey$221 || null != propKey)) switch (checked) {
						case "children":
						case "dangerouslySetInnerHTML":
							if (null != propKey$221) throw Error(formatProdErrorMessage(137, tag));
							break;
						default: setProp(domElement, tag, checked, propKey$221, nextProps, propKey);
					}
					return;
				default: if (isCustomElement(tag)) {
					for (var propKey$247 in lastProps) propKey$221 = lastProps[propKey$247], lastProps.hasOwnProperty(propKey$247) && void 0 !== propKey$221 && !nextProps.hasOwnProperty(propKey$247) && setPropOnCustomElement(domElement, tag, propKey$247, void 0, nextProps, propKey$221);
					for (defaultChecked in nextProps) propKey$221 = nextProps[defaultChecked], propKey = lastProps[defaultChecked], !nextProps.hasOwnProperty(defaultChecked) || propKey$221 === propKey || void 0 === propKey$221 && void 0 === propKey || setPropOnCustomElement(domElement, tag, defaultChecked, propKey$221, nextProps, propKey);
					return;
				}
			}
			for (var propKey$252 in lastProps) propKey$221 = lastProps[propKey$252], lastProps.hasOwnProperty(propKey$252) && null != propKey$221 && !nextProps.hasOwnProperty(propKey$252) && setProp(domElement, tag, propKey$252, null, nextProps, propKey$221);
			for (lastProp in nextProps) propKey$221 = nextProps[lastProp], propKey = lastProps[lastProp], !nextProps.hasOwnProperty(lastProp) || propKey$221 === propKey || null == propKey$221 && null == propKey || setProp(domElement, tag, lastProp, propKey$221, nextProps, propKey);
		}
		function isLikelyStaticResource(initiatorType) {
			switch (initiatorType) {
				case "css":
				case "script":
				case "font":
				case "img":
				case "image":
				case "input":
				case "link": return !0;
				default: return !1;
			}
		}
		function estimateBandwidth() {
			if ("function" === typeof performance.getEntriesByType) {
				for (var count = 0, bits = 0, resourceEntries = performance.getEntriesByType("resource"), i = 0; i < resourceEntries.length; i++) {
					var entry = resourceEntries[i], transferSize = entry.transferSize, initiatorType = entry.initiatorType, duration = entry.duration;
					if (transferSize && duration && isLikelyStaticResource(initiatorType)) {
						initiatorType = 0;
						duration = entry.responseEnd;
						for (i += 1; i < resourceEntries.length; i++) {
							var overlapEntry = resourceEntries[i], overlapStartTime = overlapEntry.startTime;
							if (overlapStartTime > duration) break;
							var overlapTransferSize = overlapEntry.transferSize, overlapInitiatorType = overlapEntry.initiatorType;
							overlapTransferSize && isLikelyStaticResource(overlapInitiatorType) && (overlapEntry = overlapEntry.responseEnd, initiatorType += overlapTransferSize * (overlapEntry < duration ? 1 : (duration - overlapStartTime) / (overlapEntry - overlapStartTime)));
						}
						--i;
						bits += 8 * (transferSize + initiatorType) / (entry.duration / 1e3);
						count++;
						if (10 < count) break;
					}
				}
				if (0 < count) return bits / count / 1e6;
			}
			return navigator.connection && (count = navigator.connection.downlink, "number" === typeof count) ? count : 5;
		}
		var eventsEnabled = null;
		var selectionInformation = null;
		function getOwnerDocumentFromRootContainer(rootContainerElement) {
			return 9 === rootContainerElement.nodeType ? rootContainerElement : rootContainerElement.ownerDocument;
		}
		function getOwnHostContext(namespaceURI) {
			switch (namespaceURI) {
				case "http://www.w3.org/2000/svg": return 1;
				case "http://www.w3.org/1998/Math/MathML": return 2;
				default: return 0;
			}
		}
		function getChildHostContextProd(parentNamespace, type) {
			if (0 === parentNamespace) switch (type) {
				case "svg": return 1;
				case "math": return 2;
				default: return 0;
			}
			return 1 === parentNamespace && "foreignObject" === type ? 0 : parentNamespace;
		}
		function createHoistableInstance(type, props, rootContainerInstance, internalInstanceHandle) {
			rootContainerInstance = getOwnerDocumentFromRootContainer(rootContainerInstance).createElement(type);
			rootContainerInstance[internalInstanceKey] = internalInstanceHandle;
			rootContainerInstance[internalPropsKey] = props;
			setInitialProperties(rootContainerInstance, type, props);
			markNodeAsHoistable(rootContainerInstance);
			return rootContainerInstance;
		}
		function shouldSetTextContent(type, props) {
			return "textarea" === type || "noscript" === type || "string" === typeof props.children || "number" === typeof props.children || "bigint" === typeof props.children || "object" === typeof props.dangerouslySetInnerHTML && null !== props.dangerouslySetInnerHTML && null != props.dangerouslySetInnerHTML.__html;
		}
		var currentPopstateTransitionEvent = null;
		function shouldAttemptEagerTransition() {
			var event = window.event;
			if (event && "popstate" === event.type) {
				if (event === currentPopstateTransitionEvent) return !1;
				currentPopstateTransitionEvent = event;
				return !0;
			}
			currentPopstateTransitionEvent = null;
			return !1;
		}
		var scheduleTimeout = "function" === typeof setTimeout ? setTimeout : void 0;
		var cancelTimeout = "function" === typeof clearTimeout ? clearTimeout : void 0;
		var localPromise = "function" === typeof Promise ? Promise : void 0;
		var localRequestAnimationFrame = "function" === typeof requestAnimationFrame ? requestAnimationFrame : scheduleTimeout;
		var scheduleMicrotask = "function" === typeof queueMicrotask ? queueMicrotask : "undefined" !== typeof localPromise ? function(callback) {
			return localPromise.resolve(null).then(callback).catch(handleErrorInNextTick);
		} : scheduleTimeout;
		function handleErrorInNextTick(error) {
			setTimeout(function() {
				throw error;
			});
		}
		function isSingletonScope(type) {
			return "head" === type;
		}
		function clearHydrationBoundary(parentInstance, hydrationInstance) {
			var node = hydrationInstance, depth = 0;
			do {
				var nextNode = node.nextSibling;
				parentInstance.removeChild(node);
				if (nextNode && 8 === nextNode.nodeType) if (node = nextNode.data, "/$" === node || "/&" === node) {
					if (0 === depth) {
						parentInstance.removeChild(nextNode);
						retryIfBlockedOn(hydrationInstance);
						return;
					}
					depth--;
				} else if ("$" === node || "$?" === node || "$~" === node || "$!" === node || "&" === node) depth++;
				else if ("html" === node) clearSingletonPreambleContribution(parentInstance.ownerDocument.documentElement);
				else if ("head" === node) {
					node = parentInstance.ownerDocument.head;
					clearSingletonPreambleContribution(node);
					for (var node$jscomp$0 = node.firstChild; node$jscomp$0;) {
						var nextNode$jscomp$0 = node$jscomp$0.nextSibling, nodeName = node$jscomp$0.nodeName;
						node$jscomp$0[internalHoistableMarker] || "SCRIPT" === nodeName || "STYLE" === nodeName || "LINK" === nodeName && "stylesheet" === node$jscomp$0.rel.toLowerCase() || node.removeChild(node$jscomp$0);
						node$jscomp$0 = nextNode$jscomp$0;
					}
				} else "body" === node && clearSingletonPreambleContribution(parentInstance.ownerDocument.body);
				node = nextNode;
			} while (node);
			retryIfBlockedOn(hydrationInstance);
		}
		function hideOrUnhideDehydratedBoundary(suspenseInstance, isHidden) {
			var node = suspenseInstance;
			suspenseInstance = 0;
			do {
				var nextNode = node.nextSibling;
				1 === node.nodeType ? isHidden ? (node._stashedDisplay = node.style.display, node.style.display = "none") : (node.style.display = node._stashedDisplay || "", "" === node.getAttribute("style") && node.removeAttribute("style")) : 3 === node.nodeType && (isHidden ? (node._stashedText = node.nodeValue, node.nodeValue = "") : node.nodeValue = node._stashedText || "");
				if (nextNode && 8 === nextNode.nodeType) if (node = nextNode.data, "/$" === node) if (0 === suspenseInstance) break;
				else suspenseInstance--;
				else "$" !== node && "$?" !== node && "$~" !== node && "$!" !== node || suspenseInstance++;
				node = nextNode;
			} while (node);
		}
		function applyViewTransitionName(instance, name, className) {
			name = CSS.escape(name) !== name ? "r-" + btoa(name).replace(/=/g, "") : name;
			instance.style.viewTransitionName = name;
			null != className && (instance.style.viewTransitionClass = className);
			className = getComputedStyle(instance);
			if ("inline" === className.display) {
				name = instance.getClientRects();
				if (1 === name.length) var JSCompiler_inline_result = 1;
				else for (var i = JSCompiler_inline_result = 0; i < name.length; i++) {
					var rect = name[i];
					0 < rect.width && 0 < rect.height && JSCompiler_inline_result++;
				}
				1 === JSCompiler_inline_result && (instance = instance.style, instance.display = 1 === name.length ? "inline-block" : "block", instance.marginTop = "-" + className.paddingTop, instance.marginBottom = "-" + className.paddingBottom);
			}
		}
		function restoreViewTransitionName(instance, props) {
			instance = instance.style;
			props = props.style;
			var viewTransitionName = null != props ? props.hasOwnProperty("viewTransitionName") ? props.viewTransitionName : props.hasOwnProperty("view-transition-name") ? props["view-transition-name"] : null : null;
			instance.viewTransitionName = null == viewTransitionName || "boolean" === typeof viewTransitionName ? "" : ("" + viewTransitionName).trim();
			viewTransitionName = null != props ? props.hasOwnProperty("viewTransitionClass") ? props.viewTransitionClass : props.hasOwnProperty("view-transition-class") ? props["view-transition-class"] : null : null;
			instance.viewTransitionClass = null == viewTransitionName || "boolean" === typeof viewTransitionName ? "" : ("" + viewTransitionName).trim();
			"inline-block" === instance.display && (null == props ? instance.display = instance.margin = "" : (viewTransitionName = props.display, instance.display = null == viewTransitionName || "boolean" === typeof viewTransitionName ? "" : viewTransitionName, viewTransitionName = props.margin, null != viewTransitionName ? instance.margin = viewTransitionName : (viewTransitionName = props.hasOwnProperty("marginTop") ? props.marginTop : props["margin-top"], instance.marginTop = null == viewTransitionName || "boolean" === typeof viewTransitionName ? "" : viewTransitionName, props = props.hasOwnProperty("marginBottom") ? props.marginBottom : props["margin-bottom"], instance.marginBottom = null == props || "boolean" === typeof props ? "" : props)));
		}
		function createMeasurement(rect, computedStyle, element) {
			element = element.ownerDocument.defaultView;
			return {
				rect,
				abs: "absolute" === computedStyle.position || "fixed" === computedStyle.position,
				clip: "none" !== computedStyle.clipPath || "visible" !== computedStyle.overflow || "none" !== computedStyle.filter || "none" !== computedStyle.mask || "none" !== computedStyle.mask || "0px" !== computedStyle.borderRadius,
				view: 0 <= rect.bottom && 0 <= rect.right && rect.top <= element.innerHeight && rect.left <= element.innerWidth
			};
		}
		function measureInstance(instance) {
			return createMeasurement(instance.getBoundingClientRect(), getComputedStyle(instance), instance);
		}
		function measureClonedInstance(instance) {
			var measuredRect = instance.getBoundingClientRect();
			measuredRect = new DOMRect(measuredRect.x + 2e4, measuredRect.y + 2e4, measuredRect.width, measuredRect.height);
			var computedStyle = getComputedStyle(instance);
			return createMeasurement(measuredRect, computedStyle, instance);
		}
		function forceLayout(ownerDocument) {
			return ownerDocument.documentElement.clientHeight;
		}
		function waitForImageToLoad(resolve) {
			this.addEventListener("load", resolve);
			this.addEventListener("error", resolve);
		}
		function startViewTransition(suspendedState, rootContainer, transitionTypes, mutationCallback, layoutCallback, afterMutationCallback, spawnedWorkCallback, passiveCallback, errorCallback) {
			var ownerDocument = 9 === rootContainer.nodeType ? rootContainer : rootContainer.ownerDocument;
			try {
				var transition = ownerDocument.startViewTransition({
					update: function() {
						var ownerWindow = ownerDocument.defaultView, pendingNavigation = ownerWindow.navigation && ownerWindow.navigation.transition, previousFontLoadingStatus = ownerDocument.fonts.status;
						mutationCallback();
						var blockingPromises = [];
						"loaded" === previousFontLoadingStatus && (forceLayout(ownerDocument), "loading" === ownerDocument.fonts.status && blockingPromises.push(ownerDocument.fonts.ready));
						previousFontLoadingStatus = blockingPromises.length;
						if (null !== suspendedState) for (var suspenseyImages = suspendedState.suspenseyImages, imgBytes = 0, i = 0; i < suspenseyImages.length; i++) {
							var suspenseyImage = suspenseyImages[i];
							if (!suspenseyImage.complete) {
								var rect = suspenseyImage.getBoundingClientRect();
								if (0 < rect.bottom && 0 < rect.right && rect.top < ownerWindow.innerHeight && rect.left < ownerWindow.innerWidth) {
									imgBytes += estimateImageBytes(suspenseyImage);
									if (imgBytes > estimatedBytesWithinLimit) {
										blockingPromises.length = previousFontLoadingStatus;
										break;
									}
									suspenseyImage = new Promise(waitForImageToLoad.bind(suspenseyImage));
									blockingPromises.push(suspenseyImage);
								}
							}
						}
						if (0 < blockingPromises.length) return ownerWindow = Promise.race([Promise.all(blockingPromises), new Promise(function(resolve) {
							return setTimeout(resolve, 500);
						})]).then(layoutCallback, layoutCallback), (pendingNavigation ? Promise.allSettled([pendingNavigation.finished, ownerWindow]) : ownerWindow).then(afterMutationCallback, afterMutationCallback);
						layoutCallback();
						if (pendingNavigation) return pendingNavigation.finished.then(afterMutationCallback, afterMutationCallback);
						afterMutationCallback();
					},
					types: transitionTypes
				});
				ownerDocument.__reactViewTransition = transition;
				var viewTransitionAnimations = [];
				transition.ready.then(function() {
					for (var animations = ownerDocument.documentElement.getAnimations({ subtree: !0 }), i = 0; i < animations.length; i++) {
						var animation = animations[i], effect = animation.effect, pseudoElement = effect.pseudoElement;
						if (null != pseudoElement && pseudoElement.startsWith("::view-transition")) {
							viewTransitionAnimations.push(animation);
							animation = effect.getKeyframes();
							for (var height = pseudoElement = void 0, unchangedDimensions = !0, j = 0; j < animation.length; j++) {
								var keyframe = animation[j], w = keyframe.width;
								if (void 0 === pseudoElement) pseudoElement = w;
								else if (pseudoElement !== w) {
									unchangedDimensions = !1;
									break;
								}
								w = keyframe.height;
								if (void 0 === height) height = w;
								else if (height !== w) {
									unchangedDimensions = !1;
									break;
								}
								delete keyframe.width;
								delete keyframe.height;
								"none" === keyframe.transform && delete keyframe.transform;
							}
							unchangedDimensions && void 0 !== pseudoElement && void 0 !== height && (effect.setKeyframes(animation), unchangedDimensions = getComputedStyle(effect.target, effect.pseudoElement), unchangedDimensions.width !== pseudoElement || unchangedDimensions.height !== height) && (unchangedDimensions = animation[0], unchangedDimensions.width = pseudoElement, unchangedDimensions.height = height, unchangedDimensions = animation[animation.length - 1], unchangedDimensions.width = pseudoElement, unchangedDimensions.height = height, effect.setKeyframes(animation));
						}
					}
					spawnedWorkCallback();
				}, function(error) {
					ownerDocument.__reactViewTransition === transition && (ownerDocument.__reactViewTransition = null);
					try {
						if ("object" === typeof error && null !== error) switch (error.name) {
							case "InvalidStateError": if ("View transition was skipped because document visibility state is hidden." === error.message || "Skipping view transition because document visibility state has become hidden." === error.message || "Skipping view transition because viewport size changed." === error.message || "Transition was aborted because of invalid state" === error.message) error = null;
						}
						null !== error && errorCallback(error);
					} finally {
						mutationCallback(), layoutCallback(), spawnedWorkCallback();
					}
				});
				transition.finished.finally(function() {
					for (var i = 0; i < viewTransitionAnimations.length; i++) viewTransitionAnimations[i].cancel();
					ownerDocument.__reactViewTransition === transition && (ownerDocument.__reactViewTransition = null);
					passiveCallback();
				});
				return transition;
			} catch (x) {
				return mutationCallback(), layoutCallback(), spawnedWorkCallback(), null;
			}
		}
		function ViewTransitionPseudoElement(pseudo, name) {
			this._scope = document.documentElement;
			this._selector = "::view-transition-" + pseudo + "(" + name + ")";
		}
		ViewTransitionPseudoElement.prototype.animate = function(keyframes, options) {
			options = "number" === typeof options ? { duration: options } : assign({}, options);
			options.pseudoElement = this._selector;
			return this._scope.animate(keyframes, options);
		};
		ViewTransitionPseudoElement.prototype.getAnimations = function() {
			for (var scope = this._scope, selector = this._selector, animations = scope.getAnimations({ subtree: !0 }), result = [], i = 0; i < animations.length; i++) {
				var effect = animations[i].effect;
				null !== effect && effect.target === scope && effect.pseudoElement === selector && result.push(animations[i]);
			}
			return result;
		};
		ViewTransitionPseudoElement.prototype.getComputedStyle = function() {
			return getComputedStyle(this._scope, this._selector);
		};
		function createViewTransitionInstance(name) {
			return {
				name,
				group: new ViewTransitionPseudoElement("group", name),
				imagePair: new ViewTransitionPseudoElement("image-pair", name),
				old: new ViewTransitionPseudoElement("old", name),
				new: new ViewTransitionPseudoElement("new", name)
			};
		}
		function FragmentInstance(fragmentFiber) {
			this._fragmentFiber = fragmentFiber;
			this._observers = this._eventListeners = null;
		}
		FragmentInstance.prototype.addEventListener = function(type, listener, optionsOrUseCapture) {
			var signal = null, cleanup = null;
			if (null != optionsOrUseCapture && "boolean" !== typeof optionsOrUseCapture && (signal = optionsOrUseCapture.signal || null, null !== signal && signal.aborted)) return;
			null === this._eventListeners && (this._eventListeners = []);
			var listeners = this._eventListeners;
			if (-1 === indexOfEventListener(listeners, type, listener, optionsOrUseCapture)) {
				var fragmentInstance = this, attachedListener = listener;
				null != optionsOrUseCapture && "boolean" !== typeof optionsOrUseCapture && !0 === optionsOrUseCapture.once && (attachedListener = function(event) {
					fragmentInstance.removeEventListener(type, listener, optionsOrUseCapture);
					"function" === typeof listener ? listener.call(this, event) : listener.handleEvent(event);
				});
				null !== signal && (cleanup = fragmentInstance.removeEventListener.bind(fragmentInstance, type, listener, optionsOrUseCapture), signal.addEventListener("abort", cleanup, { once: !0 }), cleanup = signal.removeEventListener.bind(signal, "abort", cleanup));
				signal = getAttachOptions(optionsOrUseCapture);
				listeners.push({
					type,
					listener,
					optionsOrUseCapture,
					attachedListener,
					cleanup
				});
				traverseVisibleInstancesAndTextInstances(this._fragmentFiber.child, !1, addEventListenerToChild, type, attachedListener, signal);
			}
			this._eventListeners = listeners;
		};
		function addEventListenerToChild(child, type, listener, optionsOrUseCapture) {
			getInstanceFromHostFiber(child).addEventListener(type, listener, optionsOrUseCapture);
			return !1;
		}
		FragmentInstance.prototype.removeEventListener = function(type, listener, optionsOrUseCapture) {
			var listeners = this._eventListeners;
			if (null !== listeners && (listener = indexOfEventListener(listeners, type, listener, optionsOrUseCapture), -1 !== listener)) {
				var _listeners$index = listeners[listener];
				optionsOrUseCapture = _listeners$index.attachedListener;
				var cleanup = _listeners$index.cleanup;
				_listeners$index = getAttachOptions(_listeners$index.optionsOrUseCapture);
				traverseVisibleInstancesAndTextInstances(this._fragmentFiber.child, !1, removeEventListenerFromChild, type, optionsOrUseCapture, _listeners$index);
				listeners.splice(listener, 1);
				null !== cleanup && cleanup();
			}
		};
		function removeEventListenerFromChild(child, type, listener, optionsOrUseCapture) {
			getInstanceFromHostFiber(child).removeEventListener(type, listener, optionsOrUseCapture);
			return !1;
		}
		function getAttachOptions(opts) {
			return null != opts && "boolean" !== typeof opts && (!0 === opts.once || opts.signal instanceof AbortSignal) ? {
				capture: opts.capture,
				passive: opts.passive
			} : opts;
		}
		function normalizeListenerOptions(opts) {
			return null == opts ? "c=0" : "boolean" === typeof opts ? "c=" + (opts ? "1" : "0") : "c=" + (opts.capture ? "1" : "0");
		}
		function indexOfEventListener(eventListeners, type, listener, optionsOrUseCapture) {
			if (0 === eventListeners.length) return -1;
			optionsOrUseCapture = normalizeListenerOptions(optionsOrUseCapture);
			for (var i = 0; i < eventListeners.length; i++) {
				var item = eventListeners[i];
				if (item.type === type && item.listener === listener && normalizeListenerOptions(item.optionsOrUseCapture) === optionsOrUseCapture) return i;
			}
			return -1;
		}
		FragmentInstance.prototype.dispatchEvent = function(event) {
			var parentHostFiber = getFragmentParentInstanceOrContainerFiber(this._fragmentFiber);
			if (null === parentHostFiber) return !0;
			parentHostFiber = getInstanceFromHostFiber(parentHostFiber);
			var eventListeners = this._eventListeners;
			if (null !== eventListeners && 0 < eventListeners.length || !event.bubbles) {
				var temp = 9 === parentHostFiber.nodeType ? parentHostFiber.createComment("") : document.createTextNode("");
				if (eventListeners) for (var i = 0; i < eventListeners.length; i++) {
					var _eventListeners$i = eventListeners[i];
					temp.addEventListener(_eventListeners$i.type, _eventListeners$i.attachedListener, getAttachOptions(_eventListeners$i.optionsOrUseCapture));
				}
				parentHostFiber.appendChild(temp);
				event = temp.dispatchEvent(event);
				if (eventListeners) for (i = 0; i < eventListeners.length; i++) _eventListeners$i = eventListeners[i], temp.removeEventListener(_eventListeners$i.type, _eventListeners$i.attachedListener, getAttachOptions(_eventListeners$i.optionsOrUseCapture));
				parentHostFiber.removeChild(temp);
				return event;
			}
			return parentHostFiber.dispatchEvent(event);
		};
		FragmentInstance.prototype.focus = function(focusOptions) {
			traverseVisibleInstancesAndTextInstances(this._fragmentFiber.child, !0, setFocusOnFiberIfFocusable, focusOptions, void 0, void 0);
		};
		function setFocusOnFiberIfFocusable(fiber, focusOptions) {
			if (6 === fiber.tag) return !1;
			fiber = getInstanceFromHostFiber(fiber);
			return setFocusIfFocusable(fiber, focusOptions);
		}
		FragmentInstance.prototype.focusLast = function(focusOptions) {
			var children = [];
			traverseVisibleInstancesAndTextInstances(this._fragmentFiber.child, !0, collectChildren, children, void 0, void 0);
			for (var i = children.length - 1; 0 <= i && !setFocusOnFiberIfFocusable(children[i], focusOptions); i--);
		};
		function collectChildren(child, collection) {
			collection.push(child);
			return !1;
		}
		FragmentInstance.prototype.blur = function() {
			var parentHostFiber = getFragmentParentInstanceOrContainerFiber(this._fragmentFiber);
			null !== parentHostFiber && (parentHostFiber = getInstanceFromHostFiber(parentHostFiber), parentHostFiber = getOwnerDocumentFromRootContainer(parentHostFiber).activeElement, null !== parentHostFiber && traverseVisibleInstancesAndTextInstances(this._fragmentFiber.child, !1, blurActiveElementWithinFragment, parentHostFiber, void 0, void 0));
		};
		function blurActiveElementWithinFragment(child, activeElement) {
			if (6 === child.tag) return !1;
			child = getInstanceFromHostFiber(child);
			return child === activeElement || child.contains(activeElement) ? (activeElement.blur(), !0) : !1;
		}
		FragmentInstance.prototype.observeUsing = function(observer) {
			null === this._observers && (this._observers = new Set());
			this._observers.add(observer);
			traverseVisibleInstancesAndTextInstances(this._fragmentFiber.child, !1, observeChild, observer, void 0, void 0);
		};
		function observeChild(child, observer) {
			if (6 === child.tag) return !1;
			child = getInstanceFromHostFiber(child);
			observer.observe(child);
			return !1;
		}
		FragmentInstance.prototype.unobserveUsing = function(observer) {
			var observers = this._observers;
			if (null !== observers && observers.has(observer)) {
				observers.delete(observer);
				traverseVisibleInstancesAndTextInstances(this._fragmentFiber.child, !1, unobserveChild, observer, void 0, void 0);
				for (var i = observers = 0; i < pendingIntersectionUnobserves.length; i++) {
					var pending = pendingIntersectionUnobserves[i];
					pending.fragmentInstance === this && pending.observer === observer ? observer.unobserve(pending.instance) : pendingIntersectionUnobserves[observers++] = pending;
				}
				pendingIntersectionUnobserves.length = observers;
			}
		};
		function unobserveChild(child, observer) {
			if (6 === child.tag) return !1;
			child = getInstanceFromHostFiber(child);
			observer.unobserve(child);
			return !1;
		}
		var pendingIntersectionUnobserves = [];
		var intersectionUnobserveScheduled = !1;
		function schedulePendingIntersectionUnobserve(fragmentInstance, observer, instance) {
			pendingIntersectionUnobserves.push({
				fragmentInstance,
				observer,
				instance
			});
			intersectionUnobserveScheduled || (intersectionUnobserveScheduled = !0, requestPostPaintCallback(function() {
				intersectionUnobserveScheduled = !1;
				var pending = pendingIntersectionUnobserves;
				pendingIntersectionUnobserves = [];
				for (var i = 0; i < pending.length; i++) {
					var item = pending[i];
					item.observer.unobserve(item.instance);
				}
			}));
		}
		FragmentInstance.prototype.getClientRects = function() {
			var rects = [];
			traverseVisibleInstancesAndTextInstances(this._fragmentFiber.child, !1, collectClientRects, rects, void 0, void 0);
			return rects;
		};
		function collectClientRects(child, rects) {
			if (6 === child.tag) {
				child = child.stateNode;
				var range = child.ownerDocument.createRange();
				range.selectNodeContents(child);
				rects.push.apply(rects, range.getClientRects());
			} else child = getInstanceFromHostFiber(child), rects.push.apply(rects, child.getClientRects());
			return !1;
		}
		FragmentInstance.prototype.getRootNode = function(getRootNodeOptions) {
			var parentHostFiber = getFragmentParentInstanceOrContainerFiber(this._fragmentFiber);
			return null === parentHostFiber ? this : getInstanceFromHostFiber(parentHostFiber).getRootNode(getRootNodeOptions);
		};
		FragmentInstance.prototype.compareDocumentPosition = function(otherNode) {
			var parentHostFiber = getFragmentParentInstanceOrContainerFiber(this._fragmentFiber);
			if (null === parentHostFiber) return Node.DOCUMENT_POSITION_DISCONNECTED;
			var children = [];
			traverseVisibleInstancesAndTextInstances(this._fragmentFiber.child, !1, collectChildren, children, void 0, void 0);
			var parentHostInstance = getInstanceFromHostFiber(parentHostFiber);
			if (0 === children.length) {
				children = parentHostInstance;
				if (fiberIsPortaledIntoHost(this._fragmentFiber)) {
					a: {
						for (parentHostFiber = this._fragmentFiber.return; null !== parentHostFiber;) {
							if (4 === parentHostFiber.tag) {
								parentHostFiber = parentHostFiber.stateNode.containerInfo;
								break a;
							}
							if (3 === parentHostFiber.tag || 5 === parentHostFiber.tag || 27 === parentHostFiber.tag) break;
							parentHostFiber = parentHostFiber.return;
						}
						parentHostFiber = null;
					}
					null != parentHostFiber && (children = parentHostFiber);
				}
				parentHostFiber = this._fragmentFiber;
				var result = parentHostInstance = children.compareDocumentPosition(otherNode);
				children === otherNode ? result = Node.DOCUMENT_POSITION_CONTAINS : parentHostInstance & Node.DOCUMENT_POSITION_CONTAINED_BY && (children = getFragmentInstanceOrTextInstanceSiblings(parentHostFiber)[1], null === children ? result = Node.DOCUMENT_POSITION_PRECEDING : (otherNode = getInstanceFromHostFiber(children).compareDocumentPosition(otherNode), result = 0 === otherNode || otherNode & Node.DOCUMENT_POSITION_FOLLOWING ? Node.DOCUMENT_POSITION_FOLLOWING : Node.DOCUMENT_POSITION_PRECEDING));
				return result |= Node.DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC;
			}
			parentHostFiber = getInstanceFromHostFiber(children[0]);
			result = getInstanceFromHostFiber(children[children.length - 1]);
			var parentHostInstanceFromDOM = fiberIsPortaledIntoHost(this._fragmentFiber) ? parentHostFiber.parentElement : parentHostInstance;
			if (null == parentHostInstanceFromDOM) return Node.DOCUMENT_POSITION_DISCONNECTED;
			parentHostInstance = parentHostInstanceFromDOM.compareDocumentPosition(parentHostFiber) & Node.DOCUMENT_POSITION_CONTAINED_BY;
			parentHostInstanceFromDOM = parentHostInstanceFromDOM.compareDocumentPosition(result) & Node.DOCUMENT_POSITION_CONTAINED_BY;
			var firstResult = parentHostFiber.compareDocumentPosition(otherNode), lastResult = result.compareDocumentPosition(otherNode), otherNodeIsWithinFirstOrLastChild = firstResult & Node.DOCUMENT_POSITION_CONTAINED_BY || lastResult & Node.DOCUMENT_POSITION_CONTAINED_BY;
			lastResult = parentHostInstance && parentHostInstanceFromDOM && firstResult & Node.DOCUMENT_POSITION_FOLLOWING && lastResult & Node.DOCUMENT_POSITION_PRECEDING;
			parentHostFiber = parentHostInstance && parentHostFiber === otherNode || parentHostInstanceFromDOM && result === otherNode || otherNodeIsWithinFirstOrLastChild || lastResult ? Node.DOCUMENT_POSITION_CONTAINED_BY : !parentHostInstance && parentHostFiber === otherNode || !parentHostInstanceFromDOM && result === otherNode ? Node.DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC : firstResult;
			return parentHostFiber & Node.DOCUMENT_POSITION_DISCONNECTED || parentHostFiber & Node.DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC || validateDocumentPositionWithFiberTree(parentHostFiber, this._fragmentFiber, children[0], children[children.length - 1], otherNode) ? parentHostFiber : Node.DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC;
		};
		function validateDocumentPositionWithFiberTree(documentPosition, fragmentFiber, precedingBoundaryFiber, followingBoundaryFiber, otherNode) {
			var otherFiber = getClosestInstanceFromNode(otherNode);
			if (documentPosition & Node.DOCUMENT_POSITION_CONTAINED_BY) {
				if (precedingBoundaryFiber = !!otherFiber) a: {
					for (; null !== otherFiber;) {
						if (7 === otherFiber.tag && (otherFiber === fragmentFiber || otherFiber.alternate === fragmentFiber)) {
							precedingBoundaryFiber = !0;
							break a;
						}
						otherFiber = otherFiber.return;
					}
					precedingBoundaryFiber = !1;
				}
				return precedingBoundaryFiber;
			}
			if (documentPosition & Node.DOCUMENT_POSITION_CONTAINS) {
				if (null === otherFiber) return otherFiber = otherNode.ownerDocument, otherNode === otherFiber || otherNode === otherFiber.documentElement || otherNode === otherFiber.body;
				a: {
					otherFiber = fragmentFiber;
					for (fragmentFiber = getFragmentParentInstanceOrContainerFiber(fragmentFiber); null !== otherFiber;) {
						if (!(5 !== otherFiber.tag && 3 !== otherFiber.tag && 27 !== otherFiber.tag || otherFiber !== fragmentFiber && otherFiber.alternate !== fragmentFiber)) {
							otherFiber = !0;
							break a;
						}
						otherFiber = otherFiber.return;
					}
					otherFiber = !1;
				}
				return otherFiber;
			}
			return documentPosition & Node.DOCUMENT_POSITION_PRECEDING ? ((fragmentFiber = !!otherFiber) && !(fragmentFiber = otherFiber === precedingBoundaryFiber) && (fragmentFiber = getLowestCommonAncestor(precedingBoundaryFiber, otherFiber, getParentForFragmentAncestors), null === fragmentFiber ? fragmentFiber = !1 : (traverseVisibleInstancesAndTextInstances(fragmentFiber, !0, isFiberPrecedingCheck, otherFiber, precedingBoundaryFiber), otherFiber = searchTarget, searchTarget = null, fragmentFiber = null !== otherFiber)), fragmentFiber) : documentPosition & Node.DOCUMENT_POSITION_FOLLOWING ? ((fragmentFiber = !!otherFiber) && !(fragmentFiber = otherFiber === followingBoundaryFiber) && (fragmentFiber = getLowestCommonAncestor(followingBoundaryFiber, otherFiber, getParentForFragmentAncestors), null === fragmentFiber ? fragmentFiber = !1 : (traverseVisibleInstancesAndTextInstances(fragmentFiber, !0, isFiberFollowingCheck, otherFiber, followingBoundaryFiber), otherFiber = searchTarget, searchBoundary = searchTarget = null, fragmentFiber = null !== otherFiber)), fragmentFiber) : !1;
		}
		function scrollTextNodeIntoView(textNode, resolvedAlignToTop) {
			var range = textNode.ownerDocument.createRange();
			range.selectNodeContents(textNode);
			textNode = range.getBoundingClientRect();
			window.scrollTo(window.scrollX + textNode.left, resolvedAlignToTop ? window.scrollY + textNode.top : window.scrollY + textNode.bottom - window.innerHeight);
		}
		FragmentInstance.prototype.scrollIntoView = function(alignToTop) {
			if ("object" === typeof alignToTop) throw Error(formatProdErrorMessage(566));
			var children = [];
			traverseVisibleInstancesAndTextInstances(this._fragmentFiber.child, !1, collectChildren, children, void 0, void 0);
			var resolvedAlignToTop = !1 !== alignToTop;
			if (0 === children.length) {
				var hostSiblings = getFragmentInstanceOrTextInstanceSiblings(this._fragmentFiber);
				hostSiblings = resolvedAlignToTop ? hostSiblings[1] || hostSiblings[0] || getFragmentParentInstanceOrContainerFiber(this._fragmentFiber) : hostSiblings[0] || hostSiblings[1];
				if (null === hostSiblings) return;
				if (6 === hostSiblings.tag) {
					alignToTop = getInstanceFromHostFiber(hostSiblings);
					scrollTextNodeIntoView(alignToTop, resolvedAlignToTop);
					return;
				}
				hostSiblings = getInstanceFromHostFiber(hostSiblings);
				if (9 !== hostSiblings.nodeType) {
					if (11 === hostSiblings.nodeType) {
						resolvedAlignToTop = "host" in hostSiblings ? hostSiblings.host : null;
						null !== resolvedAlignToTop && resolvedAlignToTop.scrollIntoView(alignToTop);
						return;
					}
					hostSiblings.scrollIntoView(alignToTop);
				}
			}
			for (hostSiblings = resolvedAlignToTop ? children.length - 1 : 0; hostSiblings !== (resolvedAlignToTop ? -1 : children.length);) {
				var child = children[hostSiblings];
				6 === child.tag ? (child = getInstanceFromHostFiber(child), scrollTextNodeIntoView(child, resolvedAlignToTop)) : getInstanceFromHostFiber(child).scrollIntoView(alignToTop);
				hostSiblings += resolvedAlignToTop ? -1 : 1;
			}
		};
		function addFragmentHandleToFiber(child, fragmentInstance) {
			child = getInstanceFromHostFiber(child);
			addFragmentHandleToInstance(child, fragmentInstance);
			return !1;
		}
		function addFragmentHandleToInstance(instance, fragmentInstance) {
			instance.reactFragments ??= new Set();
			instance.reactFragments.add(fragmentInstance);
		}
		function commitNewChildToFragmentInstance(childInstance, fragmentInstance) {
			var eventListeners = fragmentInstance._eventListeners;
			if (null !== eventListeners) for (var i$jscomp$0 = 0; i$jscomp$0 < eventListeners.length; i$jscomp$0++) {
				var _eventListeners$i3 = eventListeners[i$jscomp$0];
				childInstance.addEventListener(_eventListeners$i3.type, _eventListeners$i3.attachedListener, getAttachOptions(_eventListeners$i3.optionsOrUseCapture));
			}
			3 !== childInstance.nodeType && (eventListeners = fragmentInstance._observers, null !== eventListeners && eventListeners.forEach(function(observer) {
				for (var writeIdx = 0, i = 0; i < pendingIntersectionUnobserves.length; i++) {
					var pending = pendingIntersectionUnobserves[i];
					if (pending.fragmentInstance !== fragmentInstance || pending.observer !== observer || pending.instance !== childInstance) pendingIntersectionUnobserves[writeIdx++] = pending;
				}
				pendingIntersectionUnobserves.length = writeIdx;
				observer.observe(childInstance);
			}), addFragmentHandleToInstance(childInstance, fragmentInstance));
		}
		function deleteChildFromFragmentInstance(childInstance, fragmentInstance) {
			var eventListeners = fragmentInstance._eventListeners;
			if (null !== eventListeners) for (var i = 0; i < eventListeners.length; i++) {
				var _eventListeners$i4 = eventListeners[i];
				childInstance.removeEventListener(_eventListeners$i4.type, _eventListeners$i4.attachedListener, getAttachOptions(_eventListeners$i4.optionsOrUseCapture));
			}
			3 !== childInstance.nodeType && (eventListeners = fragmentInstance._observers, null !== eventListeners && eventListeners.forEach(function(observer) {
				"string" === typeof observer.rootMargin ? schedulePendingIntersectionUnobserve(fragmentInstance, observer, childInstance) : observer.unobserve(childInstance);
			}), null != childInstance.reactFragments && childInstance.reactFragments.delete(fragmentInstance));
		}
		function clearContainerSparingly(container) {
			var nextNode = container.firstChild;
			nextNode && 10 === nextNode.nodeType && (nextNode = nextNode.nextSibling);
			for (; nextNode;) {
				var node = nextNode;
				nextNode = nextNode.nextSibling;
				switch (node.nodeName) {
					case "HTML":
					case "HEAD":
					case "BODY":
						clearContainerSparingly(node);
						detachDeletedInstance(node);
						continue;
					case "SCRIPT":
					case "STYLE": continue;
					case "LINK": if ("stylesheet" === node.rel.toLowerCase()) continue;
				}
				container.removeChild(node);
			}
		}
		function canHydrateInstance(instance, type, props, inRootOrSingleton) {
			for (; 1 === instance.nodeType;) {
				var anyProps = props;
				if (instance.nodeName.toLowerCase() !== type.toLowerCase()) {
					if (!inRootOrSingleton && ("INPUT" !== instance.nodeName || "hidden" !== instance.type)) break;
				} else if (!inRootOrSingleton) if ("input" === type && "hidden" === instance.type) {
					var name = null == anyProps.name ? null : "" + anyProps.name;
					if ("hidden" === anyProps.type && instance.getAttribute("name") === name) return instance;
				} else return instance;
				else if (!instance[internalHoistableMarker]) switch (type) {
					case "meta":
						if (!instance.hasAttribute("itemprop")) break;
						return instance;
					case "link":
						name = instance.getAttribute("rel");
						if ("stylesheet" === name && instance.hasAttribute("data-precedence")) break;
						else if (name !== anyProps.rel || instance.getAttribute("href") !== (null == anyProps.href || "" === anyProps.href ? null : anyProps.href) || instance.getAttribute("crossorigin") !== (null == anyProps.crossOrigin ? null : anyProps.crossOrigin) || instance.getAttribute("title") !== (null == anyProps.title ? null : anyProps.title)) break;
						return instance;
					case "style":
						if (instance.hasAttribute("data-precedence")) break;
						return instance;
					case "script":
						name = instance.getAttribute("src");
						if ((name !== (null == anyProps.src ? null : anyProps.src) || instance.getAttribute("type") !== (null == anyProps.type ? null : anyProps.type) || instance.getAttribute("crossorigin") !== (null == anyProps.crossOrigin ? null : anyProps.crossOrigin)) && name && instance.hasAttribute("async") && !instance.hasAttribute("itemprop")) break;
						return instance;
					default: return instance;
				}
				instance = getNextHydratable(instance.nextSibling);
				if (null === instance) break;
			}
			return null;
		}
		function canHydrateTextInstance(instance, text, inRootOrSingleton) {
			if ("" === text) return null;
			for (; 3 !== instance.nodeType;) {
				if ((1 !== instance.nodeType || "INPUT" !== instance.nodeName || "hidden" !== instance.type) && !inRootOrSingleton) return null;
				instance = getNextHydratable(instance.nextSibling);
				if (null === instance) return null;
			}
			return instance;
		}
		function canHydrateHydrationBoundary(instance, inRootOrSingleton) {
			for (; 8 !== instance.nodeType;) {
				if ((1 !== instance.nodeType || "INPUT" !== instance.nodeName || "hidden" !== instance.type) && !inRootOrSingleton) return null;
				instance = getNextHydratable(instance.nextSibling);
				if (null === instance) return null;
			}
			return instance;
		}
		function isSuspenseInstancePending(instance) {
			return "$?" === instance.data || "$~" === instance.data;
		}
		function isSuspenseInstanceFallback(instance) {
			return "$!" === instance.data || "$?" === instance.data && "loading" !== instance.ownerDocument.readyState;
		}
		function registerSuspenseInstanceRetry(instance, callback) {
			var ownerDocument = instance.ownerDocument;
			if ("$~" === instance.data) instance._reactRetry = callback;
			else if ("$?" !== instance.data || "loading" !== ownerDocument.readyState) callback();
			else {
				var listener = function() {
					callback();
					ownerDocument.removeEventListener("DOMContentLoaded", listener);
				};
				ownerDocument.addEventListener("DOMContentLoaded", listener);
				instance._reactRetry = listener;
			}
		}
		function getNextHydratable(node) {
			for (; null != node; node = node.nextSibling) {
				var nodeType = node.nodeType;
				if (1 === nodeType || 3 === nodeType) break;
				if (8 === nodeType) {
					nodeType = node.data;
					if ("$" === nodeType || "$!" === nodeType || "$?" === nodeType || "$~" === nodeType || "&" === nodeType || "F!" === nodeType || "F" === nodeType) break;
					if ("/$" === nodeType || "/&" === nodeType) return null;
				}
			}
			return node;
		}
		var previousHydratableOnEnteringScopedSingleton = null;
		function getNextHydratableInstanceAfterHydrationBoundary(hydrationInstance) {
			hydrationInstance = hydrationInstance.nextSibling;
			for (var depth = 0; hydrationInstance;) {
				if (8 === hydrationInstance.nodeType) {
					var data = hydrationInstance.data;
					if ("/$" === data || "/&" === data) {
						if (0 === depth) return getNextHydratable(hydrationInstance.nextSibling);
						depth--;
					} else "$" !== data && "$!" !== data && "$?" !== data && "$~" !== data && "&" !== data || depth++;
				}
				hydrationInstance = hydrationInstance.nextSibling;
			}
			return null;
		}
		function getParentHydrationBoundary(targetInstance) {
			targetInstance = targetInstance.previousSibling;
			for (var depth = 0; targetInstance;) {
				if (8 === targetInstance.nodeType) {
					var data = targetInstance.data;
					if ("$" === data || "$!" === data || "$?" === data || "$~" === data || "&" === data) {
						if (0 === depth) return targetInstance;
						depth--;
					} else "/$" !== data && "/&" !== data || depth++;
				}
				targetInstance = targetInstance.previousSibling;
			}
			return null;
		}
		function setFocusIfFocusable(node, focusOptions) {
			function handleFocus() {
				didFocus = !0;
			}
			if (node.ownerDocument.activeElement === node) return !0;
			var didFocus = !1;
			try {
				node.ownerDocument.addEventListener("focus", handleFocus, !0), (node.focus || HTMLElement.prototype.focus).call(node, focusOptions);
			} finally {
				node.ownerDocument.removeEventListener("focus", handleFocus, !0);
			}
			return didFocus;
		}
		function requestPostPaintCallback(callback) {
			localRequestAnimationFrame(function() {
				localRequestAnimationFrame(function(time) {
					return callback(time);
				});
			});
		}
		function resolveSingletonInstance(type, props, rootContainerInstance) {
			props = getOwnerDocumentFromRootContainer(rootContainerInstance);
			switch (type) {
				case "html":
					type = props.documentElement;
					if (!type) throw Error(formatProdErrorMessage(452));
					return type;
				case "head":
					type = props.head;
					if (!type) throw Error(formatProdErrorMessage(453));
					return type;
				case "body":
					type = props.body;
					if (!type) throw Error(formatProdErrorMessage(454));
					return type;
				default: throw Error(formatProdErrorMessage(451));
			}
		}
		function releaseSingletonInstance(instance, type, props) {
			for (var propKey in props) {
				var propValue = props[propKey];
				props.hasOwnProperty(propKey) && null != propValue && setProp(instance, type, propKey, null, emptyProps, propValue);
			}
			null != props.dangerouslySetInnerHTML && (instance.textContent = "");
			instance.onclick === noop$1 && (instance.onclick = null);
			detachDeletedInstance(instance);
		}
		function clearSingletonPreambleContribution(instance) {
			for (var attributes = instance.attributes; attributes.length;) instance.removeAttributeNode(attributes[0]);
			detachDeletedInstance(instance);
		}
		var preloadPropsMap = new Map();
		var preconnectsSet = new Set();
		function getHoistableRoot(container) {
			if ("function" === typeof container.getRootNode) {
				var rootNode = container.getRootNode();
				if (9 === rootNode.nodeType || 11 === rootNode.nodeType) return rootNode;
			}
			return 9 === container.nodeType ? container : container.ownerDocument;
		}
		var previousDispatcher = ReactDOMSharedInternals.d;
		ReactDOMSharedInternals.d = {
			f: flushSyncWork,
			r: requestFormReset,
			D: prefetchDNS,
			C: preconnect,
			L: preload,
			m: preloadModule,
			X: preinitScript,
			S: preinitStyle,
			M: preinitModuleScript
		};
		function flushSyncWork() {
			var previousWasRendering = previousDispatcher.f(), wasRendering = flushSyncWork$1();
			return previousWasRendering || wasRendering;
		}
		function requestFormReset(form) {
			var formInst = getInstanceFromNode(form);
			null !== formInst && 5 === formInst.tag && "form" === formInst.type ? requestFormReset$1(formInst) : previousDispatcher.r(form);
		}
		var globalDocument = "undefined" === typeof document ? null : document;
		function preconnectAs(rel, href, crossOrigin) {
			var ownerDocument = globalDocument;
			if (ownerDocument && "string" === typeof href && href) {
				var limitedEscapedHref = escapeSelectorAttributeValueInsideDoubleQuotes(href);
				limitedEscapedHref = "link[rel=\"" + rel + "\"][href=\"" + limitedEscapedHref + "\"]";
				"string" === typeof crossOrigin && (limitedEscapedHref += "[crossorigin=\"" + crossOrigin + "\"]");
				preconnectsSet.has(limitedEscapedHref) || (preconnectsSet.add(limitedEscapedHref), rel = {
					rel,
					crossOrigin,
					href
				}, null === ownerDocument.querySelector(limitedEscapedHref) && (href = ownerDocument.createElement("link"), setInitialProperties(href, "link", rel), markNodeAsHoistable(href), ownerDocument.head.appendChild(href)));
			}
		}
		function prefetchDNS(href) {
			previousDispatcher.D(href);
			preconnectAs("dns-prefetch", href, null);
		}
		function preconnect(href, crossOrigin) {
			previousDispatcher.C(href, crossOrigin);
			preconnectAs("preconnect", href, crossOrigin);
		}
		function preload(href, as, options) {
			previousDispatcher.L(href, as, options);
			var ownerDocument = globalDocument;
			if (ownerDocument && href && as) {
				var preloadSelector = "link[rel=\"preload\"][as=\"" + escapeSelectorAttributeValueInsideDoubleQuotes(as) + "\"]";
				"image" === as ? options && options.imageSrcSet ? (preloadSelector += "[imagesrcset=\"" + escapeSelectorAttributeValueInsideDoubleQuotes(options.imageSrcSet) + "\"]", "string" === typeof options.imageSizes && (preloadSelector += "[imagesizes=\"" + escapeSelectorAttributeValueInsideDoubleQuotes(options.imageSizes) + "\"]")) : preloadSelector += "[href=\"" + escapeSelectorAttributeValueInsideDoubleQuotes(href) + "\"]" : preloadSelector += "[href=\"" + escapeSelectorAttributeValueInsideDoubleQuotes(href) + "\"]";
				var key = preloadSelector;
				switch (as) {
					case "style":
						key = getStyleKey(href);
						break;
					case "script": key = getScriptKey(href);
				}
				if (!(preloadPropsMap.has(key) || (href = assign({
					rel: "preload",
					href: "image" === as && options && options.imageSrcSet ? void 0 : href,
					as
				}, options), preloadPropsMap.set(key, href), null !== ownerDocument.querySelector(preloadSelector) || "style" === as && ownerDocument.querySelector(getStylesheetSelectorFromKey(key)) || "script" === as && ownerDocument.querySelector(getScriptSelectorFromKey(key))))) {
					var instance = ownerDocument.createElement("link");
					setInitialProperties(instance, "link", href);
					"style" === as && (instance[internalLoadPendingKey] = !0, instance.onload = instance.onerror = function() {
						clearPendingLoadOnNode(instance);
					});
					markNodeAsHoistable(instance);
					ownerDocument.head.appendChild(instance);
				}
			}
		}
		function preloadModule(href, options) {
			previousDispatcher.m(href, options);
			var ownerDocument = globalDocument;
			if (ownerDocument && href) {
				var as = options && "string" === typeof options.as ? options.as : "script", preloadSelector = "link[rel=\"modulepreload\"][as=\"" + escapeSelectorAttributeValueInsideDoubleQuotes(as) + "\"][href=\"" + escapeSelectorAttributeValueInsideDoubleQuotes(href) + "\"]", key = preloadSelector;
				switch (as) {
					case "audioworklet":
					case "paintworklet":
					case "serviceworker":
					case "sharedworker":
					case "worker":
					case "script": key = getScriptKey(href);
				}
				if (!preloadPropsMap.has(key) && (href = assign({
					rel: "modulepreload",
					href
				}, options), preloadPropsMap.set(key, href), null === ownerDocument.querySelector(preloadSelector))) {
					switch (as) {
						case "audioworklet":
						case "paintworklet":
						case "serviceworker":
						case "sharedworker":
						case "worker":
						case "script": if (ownerDocument.querySelector(getScriptSelectorFromKey(key))) return;
					}
					as = ownerDocument.createElement("link");
					setInitialProperties(as, "link", href);
					markNodeAsHoistable(as);
					ownerDocument.head.appendChild(as);
				}
			}
		}
		function preinitStyle(href, precedence, options) {
			previousDispatcher.S(href, precedence, options);
			var ownerDocument = globalDocument;
			if (ownerDocument && href) {
				var styles = getResourcesFromRoot(ownerDocument).hoistableStyles, key = getStyleKey(href);
				precedence = precedence || "default";
				var resource = styles.get(key);
				if (!resource) {
					var state = {
						loading: 0,
						preload: null
					};
					if (resource = ownerDocument.querySelector(getStylesheetSelectorFromKey(key))) state.loading = 5;
					else {
						href = assign({
							rel: "stylesheet",
							href,
							"data-precedence": precedence
						}, options);
						(options = preloadPropsMap.get(key)) && adoptPreloadPropsForStylesheet(href, options);
						var link = resource = ownerDocument.createElement("link");
						markNodeAsHoistable(link);
						setInitialProperties(link, "link", href);
						link._p = new Promise(function(resolve, reject) {
							link.onload = resolve;
							link.onerror = reject;
						});
						link.addEventListener("load", function() {
							state.loading |= 1;
						});
						link.addEventListener("error", function() {
							state.loading |= 2;
						});
						state.loading |= 4;
						insertStylesheet(resource, precedence, ownerDocument);
					}
					resource = {
						type: "stylesheet",
						instance: resource,
						count: 1,
						state
					};
					styles.set(key, resource);
				}
			}
		}
		function preinitScript(src, options) {
			previousDispatcher.X(src, options);
			var ownerDocument = globalDocument;
			if (ownerDocument && src) {
				var scripts = getResourcesFromRoot(ownerDocument).hoistableScripts, key = getScriptKey(src), resource = scripts.get(key);
				resource || (resource = ownerDocument.querySelector(getScriptSelectorFromKey(key)), resource || (src = assign({
					src,
					async: !0
				}, options), (options = preloadPropsMap.get(key)) && adoptPreloadPropsForScript(src, options), resource = ownerDocument.createElement("script"), markNodeAsHoistable(resource), setInitialProperties(resource, "link", src), ownerDocument.head.appendChild(resource)), resource = {
					type: "script",
					instance: resource,
					count: 1,
					state: null
				}, scripts.set(key, resource));
			}
		}
		function preinitModuleScript(src, options) {
			previousDispatcher.M(src, options);
			var ownerDocument = globalDocument;
			if (ownerDocument && src) {
				var scripts = getResourcesFromRoot(ownerDocument).hoistableScripts, key = getScriptKey(src), resource = scripts.get(key);
				resource || (resource = ownerDocument.querySelector(getScriptSelectorFromKey(key)), resource || (src = assign({
					src,
					async: !0,
					type: "module"
				}, options), (options = preloadPropsMap.get(key)) && adoptPreloadPropsForScript(src, options), resource = ownerDocument.createElement("script"), markNodeAsHoistable(resource), setInitialProperties(resource, "link", src), ownerDocument.head.appendChild(resource)), resource = {
					type: "script",
					instance: resource,
					count: 1,
					state: null
				}, scripts.set(key, resource));
			}
		}
		function getResource(type, currentProps, pendingProps, currentResource) {
			var JSCompiler_inline_result = (JSCompiler_inline_result = rootInstanceStackCursor.current) ? getHoistableRoot(JSCompiler_inline_result) : null;
			if (!JSCompiler_inline_result) throw Error(formatProdErrorMessage(446));
			switch (type) {
				case "meta":
				case "title": return null;
				case "style": return "string" === typeof pendingProps.precedence && "string" === typeof pendingProps.href ? (pendingProps = getStyleKey(pendingProps.href), currentProps = getResourcesFromRoot(JSCompiler_inline_result).hoistableStyles, currentResource = currentProps.get(pendingProps), currentResource || (currentResource = {
					type: "style",
					instance: null,
					count: 0,
					state: null
				}, currentProps.set(pendingProps, currentResource)), currentResource) : {
					type: "void",
					instance: null,
					count: 0,
					state: null
				};
				case "link":
					if ("stylesheet" === pendingProps.rel && "string" === typeof pendingProps.href && "string" === typeof pendingProps.precedence) {
						type = getStyleKey(pendingProps.href);
						var styles$268 = getResourcesFromRoot(JSCompiler_inline_result).hoistableStyles, resource$269 = styles$268.get(type);
						resource$269 || (JSCompiler_inline_result = JSCompiler_inline_result.ownerDocument || JSCompiler_inline_result, resource$269 = {
							type: "stylesheet",
							instance: null,
							count: 0,
							state: {
								loading: 0,
								preload: null
							}
						}, styles$268.set(type, resource$269), (styles$268 = JSCompiler_inline_result.querySelector(getStylesheetSelectorFromKey(type))) ? styles$268._p || (resource$269.instance = styles$268, resource$269.state.loading = 5) : (styles$268 = preloadPropsMap.get(type), styles$268 || (styles$268 = {
							rel: "preload",
							as: "style",
							href: pendingProps.href,
							crossOrigin: pendingProps.crossOrigin,
							integrity: pendingProps.integrity,
							media: pendingProps.media,
							hrefLang: pendingProps.hrefLang,
							referrerPolicy: pendingProps.referrerPolicy
						}, preloadPropsMap.set(type, styles$268)), preloadStylesheet(JSCompiler_inline_result, type, styles$268, resource$269.state)));
						if (currentProps && null === currentResource) throw Error(formatProdErrorMessage(528, ""));
						return resource$269;
					}
					if (currentProps && null !== currentResource) throw Error(formatProdErrorMessage(529, ""));
					return null;
				case "script": return currentProps = pendingProps.async, pendingProps = pendingProps.src, "string" === typeof pendingProps && currentProps && "function" !== typeof currentProps && "symbol" !== typeof currentProps ? (pendingProps = getScriptKey(pendingProps), currentProps = getResourcesFromRoot(JSCompiler_inline_result).hoistableScripts, currentResource = currentProps.get(pendingProps), currentResource || (currentResource = {
					type: "script",
					instance: null,
					count: 0,
					state: null
				}, currentProps.set(pendingProps, currentResource)), currentResource) : {
					type: "void",
					instance: null,
					count: 0,
					state: null
				};
				default: throw Error(formatProdErrorMessage(444, type));
			}
		}
		function getStyleKey(href) {
			return "href=\"" + escapeSelectorAttributeValueInsideDoubleQuotes(href) + "\"";
		}
		function getStylesheetSelectorFromKey(key) {
			return "link[rel=\"stylesheet\"][" + key + "]";
		}
		function stylesheetPropsFromRawProps(rawProps) {
			return assign({}, rawProps, {
				"data-precedence": rawProps.precedence,
				precedence: null
			});
		}
		function preloadStylesheet(ownerDocument, key, preloadProps, state) {
			if (key = ownerDocument.querySelector("link[rel=\"preload\"][as=\"style\"][" + key + "]")) {
				if (!0 !== key[internalLoadPendingKey]) {
					state.loading = 1;
					return;
				}
			} else key = ownerDocument.createElement("link"), key[internalLoadPendingKey] = !0, key.onload = key.onerror = clearPendingLoadOnNode.bind(null, key), setInitialProperties(key, "link", preloadProps), markNodeAsHoistable(key), ownerDocument.head.appendChild(key);
			state.preload = key;
			key.addEventListener("load", function() {
				return state.loading |= 1;
			});
			key.addEventListener("error", function() {
				return state.loading |= 2;
			});
		}
		function getScriptKey(src) {
			return "[src=\"" + escapeSelectorAttributeValueInsideDoubleQuotes(src) + "\"]";
		}
		function getScriptSelectorFromKey(key) {
			return "script[async]" + key;
		}
		function acquireResource(hoistableRoot, resource, props) {
			resource.count++;
			if (null === resource.instance) switch (resource.type) {
				case "style":
					var instance = hoistableRoot.querySelector("style[data-href~=\"" + escapeSelectorAttributeValueInsideDoubleQuotes(props.href) + "\"]");
					if (instance) return resource.instance = instance, markNodeAsHoistable(instance), instance;
					var styleProps = assign({}, props, {
						"data-href": props.href,
						"data-precedence": props.precedence,
						href: null,
						precedence: null
					});
					instance = (hoistableRoot.ownerDocument || hoistableRoot).createElement("style");
					markNodeAsHoistable(instance);
					setInitialProperties(instance, "style", styleProps);
					insertStylesheet(instance, props.precedence, hoistableRoot);
					return resource.instance = instance;
				case "stylesheet":
					styleProps = getStyleKey(props.href);
					var instance$274 = hoistableRoot.querySelector(getStylesheetSelectorFromKey(styleProps));
					if (instance$274) return resource.state.loading |= 4, resource.instance = instance$274, markNodeAsHoistable(instance$274), instance$274;
					instance = stylesheetPropsFromRawProps(props);
					(styleProps = preloadPropsMap.get(styleProps)) && adoptPreloadPropsForStylesheet(instance, styleProps);
					instance$274 = (hoistableRoot.ownerDocument || hoistableRoot).createElement("link");
					markNodeAsHoistable(instance$274);
					var linkInstance = instance$274;
					linkInstance._p = new Promise(function(resolve, reject) {
						linkInstance.onload = resolve;
						linkInstance.onerror = reject;
					});
					setInitialProperties(instance$274, "link", instance);
					resource.state.loading |= 4;
					insertStylesheet(instance$274, props.precedence, hoistableRoot);
					return resource.instance = instance$274;
				case "script":
					instance$274 = getScriptKey(props.src);
					if (styleProps = hoistableRoot.querySelector(getScriptSelectorFromKey(instance$274))) return resource.instance = styleProps, markNodeAsHoistable(styleProps), styleProps;
					instance = props;
					if (styleProps = preloadPropsMap.get(instance$274)) instance = assign({}, props), adoptPreloadPropsForScript(instance, styleProps);
					hoistableRoot = hoistableRoot.ownerDocument || hoistableRoot;
					styleProps = hoistableRoot.createElement("script");
					markNodeAsHoistable(styleProps);
					setInitialProperties(styleProps, "link", instance);
					hoistableRoot.head.appendChild(styleProps);
					return resource.instance = styleProps;
				case "void": return null;
				default: throw Error(formatProdErrorMessage(443, resource.type));
			}
			else "stylesheet" === resource.type && 0 === (resource.state.loading & 4) && (instance = resource.instance, resource.state.loading |= 4, insertStylesheet(instance, props.precedence, hoistableRoot));
			return resource.instance;
		}
		function insertStylesheet(instance, precedence, root) {
			for (var nodes = root.querySelectorAll("link[rel=\"stylesheet\"][data-precedence],style[data-precedence]"), last = nodes.length ? nodes[nodes.length - 1] : null, prior = last, i = 0; i < nodes.length; i++) {
				var node = nodes[i];
				if (node.dataset.precedence === precedence) prior = node;
				else if (prior !== last) break;
			}
			prior ? prior.parentNode.insertBefore(instance, prior.nextSibling) : (precedence = 9 === root.nodeType ? root.head : root, precedence.insertBefore(instance, precedence.firstChild));
		}
		function adoptPreloadPropsForStylesheet(stylesheetProps, preloadProps) {
			stylesheetProps.crossOrigin ??= preloadProps.crossOrigin;
			stylesheetProps.referrerPolicy ??= preloadProps.referrerPolicy;
			stylesheetProps.title ??= preloadProps.title;
		}
		function adoptPreloadPropsForScript(scriptProps, preloadProps) {
			scriptProps.crossOrigin ??= preloadProps.crossOrigin;
			scriptProps.referrerPolicy ??= preloadProps.referrerPolicy;
			scriptProps.integrity ??= preloadProps.integrity;
		}
		var tagCaches = null;
		function getHydratableHoistableCache(type, keyAttribute, ownerDocument) {
			if (null === tagCaches) {
				var cache = new Map();
				var caches = tagCaches = new Map();
				caches.set(ownerDocument, cache);
			} else caches = tagCaches, cache = caches.get(ownerDocument), cache || (cache = new Map(), caches.set(ownerDocument, cache));
			if (cache.has(type)) return cache;
			cache.set(type, null);
			ownerDocument = ownerDocument.getElementsByTagName(type);
			for (caches = 0; caches < ownerDocument.length; caches++) {
				var node = ownerDocument[caches];
				if (!(node[internalHoistableMarker] || node[internalInstanceKey] || "link" === type && "stylesheet" === node.getAttribute("rel")) && "http://www.w3.org/2000/svg" !== node.namespaceURI) {
					var nodeKey = node.getAttribute(keyAttribute) || "";
					nodeKey = type + nodeKey;
					var existing = cache.get(nodeKey);
					existing ? existing.push(node) : cache.set(nodeKey, [node]);
				}
			}
			return cache;
		}
		function mountHoistable(hoistableRoot, type, instance) {
			hoistableRoot = hoistableRoot.ownerDocument || hoistableRoot;
			hoistableRoot.head.insertBefore(instance, "title" === type ? hoistableRoot.querySelector("head > title") : null);
		}
		function isHostHoistableType(type, props, hostContext) {
			if (1 === hostContext || null != props.itemProp) return !1;
			switch (type) {
				case "meta":
				case "title": return !0;
				case "style":
					if ("string" !== typeof props.precedence || "string" !== typeof props.href || "" === props.href) break;
					return !0;
				case "link":
					if ("string" !== typeof props.rel || "string" !== typeof props.href || "" === props.href || props.onLoad || props.onError) break;
					switch (props.rel) {
						case "stylesheet": return type = props.disabled, "string" === typeof props.precedence && null == type;
						default: return !0;
					}
				case "script": if (props.async && "function" !== typeof props.async && "symbol" !== typeof props.async && !props.onLoad && !props.onError && props.src && "string" === typeof props.src) return !0;
			}
			return !1;
		}
		function maySuspendCommit(type, props) {
			return "img" === type && null != props.src && "" !== props.src && null == props.onLoad && "lazy" !== props.loading;
		}
		function preloadResource(resource) {
			return "stylesheet" === resource.type && 0 === (resource.state.loading & 3) ? !1 : !0;
		}
		function estimateImageBytes(instance) {
			return (instance.width || 100) * (instance.height || 100) * ("number" === typeof devicePixelRatio ? devicePixelRatio : 1) * .25;
		}
		function suspendInstance(state, instance) {
			"function" === typeof instance.decode && (state.imgCount++, instance.complete || (state.imgBytes += estimateImageBytes(instance), state.suspenseyImages.push(instance)), state = onUnsuspendImg.bind(state), instance.decode().then(state, state));
		}
		function suspendResource(state, hoistableRoot, resource, props) {
			if ("stylesheet" === resource.type && ("string" !== typeof props.media || !1 !== matchMedia(props.media).matches) && 0 === (resource.state.loading & 4)) {
				if (null === resource.instance) {
					var key = getStyleKey(props.href), instance = hoistableRoot.querySelector(getStylesheetSelectorFromKey(key));
					if (instance) {
						hoistableRoot = instance._p;
						null !== hoistableRoot && "object" === typeof hoistableRoot && "function" === typeof hoistableRoot.then && (state.count++, state = onUnsuspend.bind(state), hoistableRoot.then(state, state));
						resource.state.loading |= 4;
						resource.instance = instance;
						markNodeAsHoistable(instance);
						return;
					}
					instance = hoistableRoot.ownerDocument || hoistableRoot;
					props = stylesheetPropsFromRawProps(props);
					(key = preloadPropsMap.get(key)) && adoptPreloadPropsForStylesheet(props, key);
					instance = instance.createElement("link");
					markNodeAsHoistable(instance);
					var linkInstance = instance;
					linkInstance._p = new Promise(function(resolve, reject) {
						linkInstance.onload = resolve;
						linkInstance.onerror = reject;
					});
					setInitialProperties(instance, "link", props);
					resource.instance = instance;
				}
				null === state.stylesheets && (state.stylesheets = new Map());
				state.stylesheets.set(resource, hoistableRoot);
				(hoistableRoot = resource.state.preload) && 0 === (resource.state.loading & 3) && (state.count++, resource = onUnsuspend.bind(state), hoistableRoot.addEventListener("load", resource), hoistableRoot.addEventListener("error", resource));
			}
		}
		var estimatedBytesWithinLimit = 0;
		function waitForCommitToBeReady(state, timeoutOffset) {
			state.stylesheets && 0 === state.count && insertSuspendedStylesheets(state, state.stylesheets);
			return 0 < state.count || 0 < state.imgCount ? function(commit) {
				var stylesheetTimer = setTimeout(function() {
					state.stylesheets && insertSuspendedStylesheets(state, state.stylesheets);
					if (state.unsuspend) {
						var unsuspend = state.unsuspend;
						state.unsuspend = null;
						unsuspend();
					}
				}, 6e4 + timeoutOffset);
				0 < state.imgBytes && 0 === estimatedBytesWithinLimit && (estimatedBytesWithinLimit = 62500 * estimateBandwidth());
				var imgTimer = setTimeout(function() {
					state.waitingForImages = !1;
					if (0 === state.count && (state.stylesheets && insertSuspendedStylesheets(state, state.stylesheets), state.unsuspend)) {
						var unsuspend = state.unsuspend;
						state.unsuspend = null;
						unsuspend();
					}
				}, (state.imgBytes > estimatedBytesWithinLimit ? 50 : 800) + timeoutOffset);
				state.unsuspend = commit;
				return function() {
					state.unsuspend = null;
					clearTimeout(stylesheetTimer);
					clearTimeout(imgTimer);
				};
			} : null;
		}
		function checkIfFullyUnsuspended(state) {
			if (0 === state.count && (0 === state.imgCount || !state.waitingForImages)) {
				if (state.stylesheets) insertSuspendedStylesheets(state, state.stylesheets);
				else if (state.unsuspend) {
					var unsuspend = state.unsuspend;
					state.unsuspend = null;
					unsuspend();
				}
			}
		}
		function onUnsuspend() {
			this.count--;
			checkIfFullyUnsuspended(this);
		}
		function onUnsuspendImg() {
			this.imgCount--;
			checkIfFullyUnsuspended(this);
		}
		var precedencesByRoot = null;
		function insertSuspendedStylesheets(state, resources) {
			state.stylesheets = null;
			null !== state.unsuspend && (state.count++, precedencesByRoot = new Map(), resources.forEach(insertStylesheetIntoRoot, state), precedencesByRoot = null, onUnsuspend.call(state));
		}
		function insertStylesheetIntoRoot(root, resource) {
			if (!(resource.state.loading & 4)) {
				var precedences = precedencesByRoot.get(root);
				if (precedences) var last = precedences.get(null);
				else {
					precedences = new Map();
					precedencesByRoot.set(root, precedences);
					for (var nodes = root.querySelectorAll("link[data-precedence],style[data-precedence]"), i = 0; i < nodes.length; i++) {
						var node = nodes[i];
						if ("LINK" === node.nodeName || "not all" !== node.getAttribute("media")) precedences.set(node.dataset.precedence, node), last = node;
					}
					last && precedences.set(null, last);
				}
				nodes = resource.instance;
				node = nodes.getAttribute("data-precedence");
				i = precedences.get(node) || last;
				i === last && precedences.set(null, nodes);
				precedences.set(node, nodes);
				this.count++;
				last = onUnsuspend.bind(this);
				nodes.addEventListener("load", last);
				nodes.addEventListener("error", last);
				i ? i.parentNode.insertBefore(nodes, i.nextSibling) : (root = 9 === root.nodeType ? root.head : root, root.insertBefore(nodes, root.firstChild));
				resource.state.loading |= 4;
			}
		}
		var HostTransitionContext = {
			$$typeof: REACT_CONTEXT_TYPE,
			Provider: null,
			Consumer: null,
			_currentValue: sharedNotPendingObject,
			_currentValue2: sharedNotPendingObject,
			_threadCount: 0
		};
		function FiberRootNode(containerInfo, tag, hydrate, identifierPrefix, onUncaughtError, onCaughtError, onRecoverableError, onDefaultTransitionIndicator, formState) {
			this.tag = 1;
			this.containerInfo = containerInfo;
			this.pingCache = this.current = this.pendingChildren = null;
			this.timeoutHandle = -1;
			this.callbackNode = this.next = this.pendingContext = this.context = this.cancelPendingCommit = null;
			this.callbackPriority = 0;
			this.expirationTimes = createLaneMap(-1);
			this.entangledLanes = this.shellSuspendCounter = this.errorRecoveryDisabledLanes = this.expiredLanes = this.warmLanes = this.pingedLanes = this.suspendedLanes = this.pendingLanes = 0;
			this.entanglements = createLaneMap(0);
			this.hiddenUpdates = createLaneMap(null);
			this.identifierPrefix = identifierPrefix;
			this.onUncaughtError = onUncaughtError;
			this.onCaughtError = onCaughtError;
			this.onRecoverableError = onRecoverableError;
			this.pooledCache = null;
			this.pooledCacheLanes = 0;
			this.formState = formState;
			this.transitionTypes = null;
			this.incompleteTransitions = new Map();
		}
		function createFiberRoot(containerInfo, tag, hydrate, initialChildren, hydrationCallbacks, isStrictMode, identifierPrefix, formState, onUncaughtError, onCaughtError, onRecoverableError, onDefaultTransitionIndicator) {
			containerInfo = new FiberRootNode(containerInfo, tag, hydrate, identifierPrefix, onUncaughtError, onCaughtError, onRecoverableError, onDefaultTransitionIndicator, formState);
			tag = 1;
			!0 === isStrictMode && (tag |= 24);
			isStrictMode = createFiberImplClass(3, null, null, tag);
			containerInfo.current = isStrictMode;
			isStrictMode.stateNode = containerInfo;
			tag = createCache();
			tag.refCount++;
			containerInfo.pooledCache = tag;
			tag.refCount++;
			isStrictMode.memoizedState = {
				element: initialChildren,
				isDehydrated: hydrate,
				cache: tag
			};
			initializeUpdateQueue(isStrictMode);
			return containerInfo;
		}
		function getContextForSubtree(parentComponent) {
			if (!parentComponent) return emptyContextObject;
			parentComponent = emptyContextObject;
			return parentComponent;
		}
		function updateContainerImpl(rootFiber, lane, element, container, parentComponent, callback) {
			parentComponent = getContextForSubtree(parentComponent);
			null === container.context ? container.context = parentComponent : container.pendingContext = parentComponent;
			container = createUpdate(lane);
			container.payload = { element };
			callback = void 0 === callback ? null : callback;
			null !== callback && (container.callback = callback);
			element = enqueueUpdate(rootFiber, container, lane);
			null !== element && (scheduleUpdateOnFiber(element, rootFiber, lane), entangleTransitions(element, rootFiber, lane));
		}
		function markRetryLaneImpl(fiber, retryLane) {
			fiber = fiber.memoizedState;
			if (null !== fiber && null !== fiber.dehydrated) {
				var a = fiber.retryLane;
				fiber.retryLane = 0 !== a && a < retryLane ? a : retryLane;
			}
		}
		function markRetryLaneIfNotHydrated(fiber, retryLane) {
			markRetryLaneImpl(fiber, retryLane);
			(fiber = fiber.alternate) && markRetryLaneImpl(fiber, retryLane);
		}
		function attemptContinuousHydration(fiber) {
			if (13 === fiber.tag || 31 === fiber.tag) {
				var root = enqueueConcurrentRenderForLane(fiber, 67108864);
				null !== root && scheduleUpdateOnFiber(root, fiber, 67108864);
				markRetryLaneIfNotHydrated(fiber, 67108864);
			}
		}
		function attemptHydrationAtCurrentPriority(fiber) {
			if (13 === fiber.tag || 31 === fiber.tag) {
				var lane = requestUpdateLane();
				lane = getBumpedLaneForHydrationByLane(lane);
				var root = enqueueConcurrentRenderForLane(fiber, lane);
				null !== root && scheduleUpdateOnFiber(root, fiber, lane);
				markRetryLaneIfNotHydrated(fiber, lane);
			}
		}
		var _enabled = !0;
		function dispatchDiscreteEvent(domEventName, eventSystemFlags, container, nativeEvent) {
			var prevTransition = ReactSharedInternals.T;
			ReactSharedInternals.T = null;
			var previousPriority = ReactDOMSharedInternals.p;
			try {
				ReactDOMSharedInternals.p = 2, dispatchEvent(domEventName, eventSystemFlags, container, nativeEvent);
			} finally {
				ReactDOMSharedInternals.p = previousPriority, ReactSharedInternals.T = prevTransition;
			}
		}
		function dispatchContinuousEvent(domEventName, eventSystemFlags, container, nativeEvent) {
			var prevTransition = ReactSharedInternals.T;
			ReactSharedInternals.T = null;
			var previousPriority = ReactDOMSharedInternals.p;
			try {
				ReactDOMSharedInternals.p = 8, dispatchEvent(domEventName, eventSystemFlags, container, nativeEvent);
			} finally {
				ReactDOMSharedInternals.p = previousPriority, ReactSharedInternals.T = prevTransition;
			}
		}
		function dispatchEvent(domEventName, eventSystemFlags, targetContainer, nativeEvent) {
			if (_enabled) {
				var blockedOn = findInstanceBlockingEvent(nativeEvent);
				if (null === blockedOn) dispatchEventForPluginEventSystem(domEventName, eventSystemFlags, nativeEvent, return_targetInst, targetContainer), clearIfContinuousEvent(domEventName, nativeEvent);
				else if (queueIfContinuousEvent(blockedOn, domEventName, eventSystemFlags, targetContainer, nativeEvent)) nativeEvent.stopPropagation();
				else if (clearIfContinuousEvent(domEventName, nativeEvent), eventSystemFlags & 4 && -1 < discreteReplayableEvents.indexOf(domEventName)) {
					for (; null !== blockedOn;) {
						var fiber = getInstanceFromNode(blockedOn);
						if (null !== fiber) switch (fiber.tag) {
							case 3:
								fiber = fiber.stateNode;
								if (fiber.current.memoizedState.isDehydrated) {
									var lanes = getHighestPriorityLanes(fiber.pendingLanes);
									if (0 !== lanes) {
										var root = fiber;
										root.pendingLanes |= 2;
										for (root.entangledLanes |= 2; lanes;) {
											var lane = 1 << 31 - clz32(lanes);
											root.entanglements[1] |= lane;
											lanes &= ~lane;
										}
										ensureRootIsScheduled(fiber);
										0 === (executionContext & 6) && (workInProgressRootRenderTargetTime = now() + 500, flushSyncWorkAcrossRoots_impl(0, !1));
									}
								}
								break;
							case 31:
							case 13: root = enqueueConcurrentRenderForLane(fiber, 2), null !== root && scheduleUpdateOnFiber(root, fiber, 2), flushSyncWork$1(), markRetryLaneIfNotHydrated(fiber, 2);
						}
						fiber = findInstanceBlockingEvent(nativeEvent);
						null === fiber && dispatchEventForPluginEventSystem(domEventName, eventSystemFlags, nativeEvent, return_targetInst, targetContainer);
						if (fiber === blockedOn) break;
						blockedOn = fiber;
					}
					null !== blockedOn && nativeEvent.stopPropagation();
				} else dispatchEventForPluginEventSystem(domEventName, eventSystemFlags, nativeEvent, null, targetContainer);
			}
		}
		function findInstanceBlockingEvent(nativeEvent) {
			nativeEvent = getEventTarget(nativeEvent);
			return findInstanceBlockingTarget(nativeEvent);
		}
		var return_targetInst = null;
		function findInstanceBlockingTarget(targetNode) {
			return_targetInst = null;
			targetNode = getClosestInstanceFromNode(targetNode);
			if (null !== targetNode) {
				var nearestMounted = getNearestMountedFiber(targetNode);
				if (null === nearestMounted) targetNode = null;
				else {
					var tag = nearestMounted.tag;
					if (13 === tag) {
						targetNode = getSuspenseInstanceFromFiber(nearestMounted);
						if (null !== targetNode) return targetNode;
						targetNode = null;
					} else if (31 === tag) {
						targetNode = getActivityInstanceFromFiber(nearestMounted);
						if (null !== targetNode) return targetNode;
						targetNode = null;
					} else if (3 === tag) {
						if (nearestMounted.stateNode.current.memoizedState.isDehydrated) return 3 === nearestMounted.tag ? nearestMounted.stateNode.containerInfo : null;
						targetNode = null;
					} else nearestMounted !== targetNode && (targetNode = null);
				}
			}
			return_targetInst = targetNode;
			return null;
		}
		function getEventPriority(domEventName) {
			switch (domEventName) {
				case "beforetoggle":
				case "cancel":
				case "click":
				case "close":
				case "contextmenu":
				case "copy":
				case "cut":
				case "auxclick":
				case "dblclick":
				case "dragend":
				case "dragstart":
				case "drop":
				case "focusin":
				case "focusout":
				case "input":
				case "invalid":
				case "keydown":
				case "keypress":
				case "keyup":
				case "mousedown":
				case "mouseup":
				case "paste":
				case "pause":
				case "play":
				case "pointercancel":
				case "pointerdown":
				case "pointerup":
				case "ratechange":
				case "reset":
				case "seeked":
				case "submit":
				case "toggle":
				case "touchcancel":
				case "touchend":
				case "touchstart":
				case "volumechange":
				case "change":
				case "selectionchange":
				case "textInput":
				case "compositionstart":
				case "compositionend":
				case "compositionupdate":
				case "beforeblur":
				case "afterblur":
				case "beforeinput":
				case "blur":
				case "fullscreenchange":
				case "fullscreenerror":
				case "focus":
				case "hashchange":
				case "popstate":
				case "select":
				case "selectstart": return 2;
				case "drag":
				case "dragenter":
				case "dragexit":
				case "dragleave":
				case "dragover":
				case "mousemove":
				case "mouseout":
				case "mouseover":
				case "pointermove":
				case "pointerout":
				case "pointerover":
				case "resize":
				case "scroll":
				case "touchmove":
				case "wheel":
				case "mouseenter":
				case "mouseleave":
				case "pointerenter":
				case "pointerleave": return 8;
				case "message": switch (getCurrentPriorityLevel()) {
					case ImmediatePriority: return 2;
					case UserBlockingPriority: return 8;
					case NormalPriority$1:
					case LowPriority: return 32;
					case IdlePriority: return 268435456;
					default: return 32;
				}
				default: return 32;
			}
		}
		var hasScheduledReplayAttempt = !1;
		var queuedFocus = null;
		var queuedDrag = null;
		var queuedMouse = null;
		var queuedPointers = new Map();
		var queuedPointerCaptures = new Map();
		var queuedExplicitHydrationTargets = [];
		var discreteReplayableEvents = "mousedown mouseup touchcancel touchend touchstart auxclick dblclick pointercancel pointerdown pointerup dragend dragstart drop compositionend compositionstart keydown keypress keyup input textInput copy cut paste click change contextmenu reset".split(" ");
		function clearIfContinuousEvent(domEventName, nativeEvent) {
			switch (domEventName) {
				case "focusin":
				case "focusout":
					queuedFocus = null;
					break;
				case "dragenter":
				case "dragleave":
					queuedDrag = null;
					break;
				case "mouseover":
				case "mouseout":
					queuedMouse = null;
					break;
				case "pointerover":
				case "pointerout":
					queuedPointers.delete(nativeEvent.pointerId);
					break;
				case "gotpointercapture":
				case "lostpointercapture": queuedPointerCaptures.delete(nativeEvent.pointerId);
			}
		}
		function accumulateOrCreateContinuousQueuedReplayableEvent(existingQueuedEvent, blockedOn, domEventName, eventSystemFlags, targetContainer, nativeEvent) {
			if (null === existingQueuedEvent || existingQueuedEvent.nativeEvent !== nativeEvent) return existingQueuedEvent = {
				blockedOn,
				domEventName,
				eventSystemFlags,
				nativeEvent,
				targetContainers: [targetContainer]
			}, null !== blockedOn && (blockedOn = getInstanceFromNode(blockedOn), null !== blockedOn && attemptContinuousHydration(blockedOn)), existingQueuedEvent;
			existingQueuedEvent.eventSystemFlags |= eventSystemFlags;
			blockedOn = existingQueuedEvent.targetContainers;
			null !== targetContainer && -1 === blockedOn.indexOf(targetContainer) && blockedOn.push(targetContainer);
			return existingQueuedEvent;
		}
		function queueIfContinuousEvent(blockedOn, domEventName, eventSystemFlags, targetContainer, nativeEvent) {
			switch (domEventName) {
				case "focusin": return queuedFocus = accumulateOrCreateContinuousQueuedReplayableEvent(queuedFocus, blockedOn, domEventName, eventSystemFlags, targetContainer, nativeEvent), !0;
				case "dragenter": return queuedDrag = accumulateOrCreateContinuousQueuedReplayableEvent(queuedDrag, blockedOn, domEventName, eventSystemFlags, targetContainer, nativeEvent), !0;
				case "mouseover": return queuedMouse = accumulateOrCreateContinuousQueuedReplayableEvent(queuedMouse, blockedOn, domEventName, eventSystemFlags, targetContainer, nativeEvent), !0;
				case "pointerover":
					var pointerId = nativeEvent.pointerId;
					queuedPointers.set(pointerId, accumulateOrCreateContinuousQueuedReplayableEvent(queuedPointers.get(pointerId) || null, blockedOn, domEventName, eventSystemFlags, targetContainer, nativeEvent));
					return !0;
				case "gotpointercapture": return pointerId = nativeEvent.pointerId, queuedPointerCaptures.set(pointerId, accumulateOrCreateContinuousQueuedReplayableEvent(queuedPointerCaptures.get(pointerId) || null, blockedOn, domEventName, eventSystemFlags, targetContainer, nativeEvent)), !0;
			}
			return !1;
		}
		function attemptExplicitHydrationTarget(queuedTarget) {
			var targetInst = getClosestInstanceFromNode(queuedTarget.target);
			if (null !== targetInst) {
				var nearestMounted = getNearestMountedFiber(targetInst);
				if (null !== nearestMounted) {
					if (targetInst = nearestMounted.tag, 13 === targetInst) {
						if (targetInst = getSuspenseInstanceFromFiber(nearestMounted), null !== targetInst) {
							queuedTarget.blockedOn = targetInst;
							runWithPriority(queuedTarget.priority, function() {
								attemptHydrationAtCurrentPriority(nearestMounted);
							});
							return;
						}
					} else if (31 === targetInst) {
						if (targetInst = getActivityInstanceFromFiber(nearestMounted), null !== targetInst) {
							queuedTarget.blockedOn = targetInst;
							runWithPriority(queuedTarget.priority, function() {
								attemptHydrationAtCurrentPriority(nearestMounted);
							});
							return;
						}
					} else if (3 === targetInst && nearestMounted.stateNode.current.memoizedState.isDehydrated) {
						queuedTarget.blockedOn = 3 === nearestMounted.tag ? nearestMounted.stateNode.containerInfo : null;
						return;
					}
				}
			}
			queuedTarget.blockedOn = null;
		}
		function attemptReplayContinuousQueuedEvent(queuedEvent) {
			if (null !== queuedEvent.blockedOn) return !1;
			for (var targetContainers = queuedEvent.targetContainers; 0 < targetContainers.length;) {
				var nextBlockedOn = findInstanceBlockingEvent(queuedEvent.nativeEvent);
				if (null === nextBlockedOn) {
					nextBlockedOn = queuedEvent.nativeEvent;
					var nativeEventClone = new nextBlockedOn.constructor(nextBlockedOn.type, nextBlockedOn);
					currentReplayingEvent = nativeEventClone;
					nextBlockedOn.target.dispatchEvent(nativeEventClone);
					currentReplayingEvent = null;
				} else return targetContainers = getInstanceFromNode(nextBlockedOn), null !== targetContainers && attemptContinuousHydration(targetContainers), queuedEvent.blockedOn = nextBlockedOn, !1;
				targetContainers.shift();
			}
			return !0;
		}
		function attemptReplayContinuousQueuedEventInMap(queuedEvent, key, map) {
			attemptReplayContinuousQueuedEvent(queuedEvent) && map.delete(key);
		}
		function replayUnblockedEvents() {
			hasScheduledReplayAttempt = !1;
			null !== queuedFocus && attemptReplayContinuousQueuedEvent(queuedFocus) && (queuedFocus = null);
			null !== queuedDrag && attemptReplayContinuousQueuedEvent(queuedDrag) && (queuedDrag = null);
			null !== queuedMouse && attemptReplayContinuousQueuedEvent(queuedMouse) && (queuedMouse = null);
			queuedPointers.forEach(attemptReplayContinuousQueuedEventInMap);
			queuedPointerCaptures.forEach(attemptReplayContinuousQueuedEventInMap);
		}
		function scheduleCallbackIfUnblocked(queuedEvent, unblocked) {
			queuedEvent.blockedOn === unblocked && (queuedEvent.blockedOn = null, hasScheduledReplayAttempt || (hasScheduledReplayAttempt = !0, Scheduler.unstable_scheduleCallback(Scheduler.unstable_NormalPriority, replayUnblockedEvents)));
		}
		var lastScheduledReplayQueue = null;
		function scheduleReplayQueueIfNeeded(formReplayingQueue) {
			lastScheduledReplayQueue !== formReplayingQueue && (lastScheduledReplayQueue = formReplayingQueue, Scheduler.unstable_scheduleCallback(Scheduler.unstable_NormalPriority, function() {
				lastScheduledReplayQueue === formReplayingQueue && (lastScheduledReplayQueue = null);
				for (var i = 0; i < formReplayingQueue.length; i += 3) {
					var form = formReplayingQueue[i], submitterOrAction = formReplayingQueue[i + 1], formData = formReplayingQueue[i + 2];
					if ("function" !== typeof submitterOrAction) if (null === findInstanceBlockingTarget(submitterOrAction || form)) continue;
					else break;
					var formInst = getInstanceFromNode(form);
					null !== formInst && (formReplayingQueue.splice(i, 3), i -= 3, startHostTransition(formInst, {
						pending: !0,
						data: formData,
						method: form.method,
						action: submitterOrAction
					}, submitterOrAction, formData));
				}
			}));
		}
		function retryIfBlockedOn(unblocked) {
			function unblock(queuedEvent) {
				return scheduleCallbackIfUnblocked(queuedEvent, unblocked);
			}
			null !== queuedFocus && scheduleCallbackIfUnblocked(queuedFocus, unblocked);
			null !== queuedDrag && scheduleCallbackIfUnblocked(queuedDrag, unblocked);
			null !== queuedMouse && scheduleCallbackIfUnblocked(queuedMouse, unblocked);
			queuedPointers.forEach(unblock);
			queuedPointerCaptures.forEach(unblock);
			for (var i = 0; i < queuedExplicitHydrationTargets.length; i++) {
				var queuedTarget = queuedExplicitHydrationTargets[i];
				queuedTarget.blockedOn === unblocked && (queuedTarget.blockedOn = null);
			}
			for (; 0 < queuedExplicitHydrationTargets.length && (i = queuedExplicitHydrationTargets[0], null === i.blockedOn);) attemptExplicitHydrationTarget(i), null === i.blockedOn && queuedExplicitHydrationTargets.shift();
			i = (unblocked.ownerDocument || unblocked).$$reactFormReplay;
			if (null != i) for (queuedTarget = 0; queuedTarget < i.length; queuedTarget += 3) {
				var form = i[queuedTarget], submitterOrAction = i[queuedTarget + 1], formProps = form[internalPropsKey] || null;
				if ("function" === typeof submitterOrAction) formProps || scheduleReplayQueueIfNeeded(i);
				else if (formProps) {
					var action = null;
					if (submitterOrAction && submitterOrAction.hasAttribute("formAction")) {
						if (form = submitterOrAction, formProps = submitterOrAction[internalPropsKey] || null) action = formProps.formAction;
						else if (null !== findInstanceBlockingTarget(form)) continue;
					} else action = formProps.action;
					"function" === typeof action ? i[queuedTarget + 1] = action : (i.splice(queuedTarget, 3), queuedTarget -= 3);
					scheduleReplayQueueIfNeeded(i);
				}
			}
		}
		function defaultOnDefaultTransitionIndicator() {
			function handleNavigate(event) {
				event.canIntercept && "react-transition" === event.info && event.intercept({
					handler: function() {
						return new Promise(function(resolve) {
							return pendingResolve = resolve;
						});
					},
					focusReset: "manual",
					scroll: "manual"
				});
			}
			function handleNavigateComplete() {
				null !== pendingResolve && (pendingResolve(), pendingResolve = null);
				isCancelled || setTimeout(startFakeNavigation, 20);
			}
			function startFakeNavigation() {
				if (!isCancelled && !navigation.transition) {
					var currentEntry = navigation.currentEntry;
					currentEntry && null != currentEntry.url && navigation.navigate(currentEntry.url, {
						state: currentEntry.getState(),
						info: "react-transition",
						history: "replace"
					});
				}
			}
			if ("object" === typeof navigation) {
				var isCancelled = !1, pendingResolve = null;
				navigation.addEventListener("navigate", handleNavigate);
				navigation.addEventListener("navigatesuccess", handleNavigateComplete);
				navigation.addEventListener("navigateerror", handleNavigateComplete);
				setTimeout(startFakeNavigation, 100);
				return function() {
					isCancelled = !0;
					navigation.removeEventListener("navigate", handleNavigate);
					navigation.removeEventListener("navigatesuccess", handleNavigateComplete);
					navigation.removeEventListener("navigateerror", handleNavigateComplete);
					null !== pendingResolve && (pendingResolve(), pendingResolve = null);
				};
			}
		}
		function ReactDOMRoot(internalRoot) {
			this._internalRoot = internalRoot;
		}
		ReactDOMHydrationRoot.prototype.render = ReactDOMRoot.prototype.render = function(children) {
			var root = this._internalRoot;
			if (null === root) throw Error(formatProdErrorMessage(409));
			var current = root.current;
			updateContainerImpl(current, requestUpdateLane(), children, root, null, null);
		};
		ReactDOMHydrationRoot.prototype.unmount = ReactDOMRoot.prototype.unmount = function() {
			var root = this._internalRoot;
			if (null !== root) {
				this._internalRoot = null;
				var container = root.containerInfo;
				updateContainerImpl(root.current, 2, null, root, null, null);
				flushSyncWork$1();
				container[internalContainerInstanceKey] = null;
			}
		};
		function ReactDOMHydrationRoot(internalRoot) {
			this._internalRoot = internalRoot;
		}
		ReactDOMHydrationRoot.prototype.unstable_scheduleHydration = function(target) {
			if (target) {
				var updatePriority = resolveUpdatePriority();
				target = {
					blockedOn: null,
					target,
					priority: updatePriority
				};
				for (var i = 0; i < queuedExplicitHydrationTargets.length && 0 !== updatePriority && updatePriority < queuedExplicitHydrationTargets[i].priority; i++);
				queuedExplicitHydrationTargets.splice(i, 0, target);
				0 === i && attemptExplicitHydrationTarget(target);
			}
		};
		var isomorphicReactPackageVersion$jscomp$inline_2043 = React.version;
		if ("19.3.0" !== isomorphicReactPackageVersion$jscomp$inline_2043) throw Error(formatProdErrorMessage(527, isomorphicReactPackageVersion$jscomp$inline_2043, "19.3.0"));
		ReactDOMSharedInternals.findDOMNode = function(componentOrElement) {
			var fiber = componentOrElement._reactInternals;
			if (void 0 === fiber) {
				if ("function" === typeof componentOrElement.render) throw Error(formatProdErrorMessage(188));
				componentOrElement = Object.keys(componentOrElement).join(",");
				throw Error(formatProdErrorMessage(268, componentOrElement));
			}
			componentOrElement = findCurrentFiberUsingSlowPath(fiber);
			componentOrElement = null !== componentOrElement ? findCurrentHostFiberImpl(componentOrElement) : null;
			componentOrElement = null === componentOrElement ? null : componentOrElement.stateNode;
			return componentOrElement;
		};
		var internals$jscomp$inline_2586 = {
			bundleType: 0,
			version: "19.3.0",
			rendererPackageName: "react-dom",
			currentDispatcherRef: ReactSharedInternals,
			reconcilerVersion: "19.3.0"
		};
		if ("undefined" !== typeof __REACT_DEVTOOLS_GLOBAL_HOOK__) {
			var hook$jscomp$inline_2587 = __REACT_DEVTOOLS_GLOBAL_HOOK__;
			if (!hook$jscomp$inline_2587.isDisabled && hook$jscomp$inline_2587.supportsFiber) try {
				rendererID = hook$jscomp$inline_2587.inject(internals$jscomp$inline_2586), injectedHook = hook$jscomp$inline_2587;
			} catch (err) {}
		}
		exports.createRoot = function(container, options) {
			if (!isValidContainer(container)) throw Error(formatProdErrorMessage(299));
			var isStrictMode = !1, identifierPrefix = "", onUncaughtError = defaultOnUncaughtError, onCaughtError = defaultOnCaughtError, onRecoverableError = defaultOnRecoverableError;
			null !== options && void 0 !== options && (!0 === options.unstable_strictMode && (isStrictMode = !0), void 0 !== options.identifierPrefix && (identifierPrefix = options.identifierPrefix), void 0 !== options.onUncaughtError && (onUncaughtError = options.onUncaughtError), void 0 !== options.onCaughtError && (onCaughtError = options.onCaughtError), void 0 !== options.onRecoverableError && (onRecoverableError = options.onRecoverableError));
			options = createFiberRoot(container, 1, !1, null, null, isStrictMode, identifierPrefix, null, onUncaughtError, onCaughtError, onRecoverableError, defaultOnDefaultTransitionIndicator);
			container[internalContainerInstanceKey] = options.current;
			listenToAllSupportedEvents(container);
			return new ReactDOMRoot(options);
		};
	}));
	var require_client = __commonJSMin(((exports, module) => {
		function checkDCE() {
			if (typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ === "undefined" || typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE !== "function") return;
			try {
				__REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE(checkDCE);
			} catch (err) {
				console.error(err);
			}
		}
		checkDCE();
		module.exports = require_react_dom_client_production();
	}));
	var require_react_jsx_runtime_production = __commonJSMin(((exports) => {
		var REACT_ELEMENT_TYPE = Symbol.for("react.transitional.element");
		function jsxProd(type, config, maybeKey) {
			var key = null;
			void 0 !== maybeKey && (key = "" + maybeKey);
			void 0 !== config.key && (key = "" + config.key);
			if ("key" in config) {
				maybeKey = {};
				for (var propName in config) "key" !== propName && (maybeKey[propName] = config[propName]);
			} else maybeKey = config;
			config = maybeKey.ref;
			return {
				$$typeof: REACT_ELEMENT_TYPE,
				type,
				key,
				ref: void 0 !== config ? config : null,
				props: maybeKey
			};
		}
		exports.jsx = jsxProd;
		exports.jsxs = jsxProd;
	}));
	var require_jsx_runtime = __commonJSMin(((exports, module) => {
		module.exports = require_react_jsx_runtime_production();
	}));
	var import_react = require_react();
	var import_client = require_client();
	var import_jsx_runtime = require_jsx_runtime();
	function Field({ label, note, children }) {
		return (0, import_jsx_runtime.jsxs)("label", {
			className: "xns-settings-field",
			children: [
				(0, import_jsx_runtime.jsx)("span", {
					className: "xns-settings-label",
					children: label
				}),
				children,
				note && (0, import_jsx_runtime.jsx)("small", {
					className: "xns-settings-note",
					children: note
				})
			]
		});
	}
	function SettingsPanel({ initialValues, onChange, onReset, onClose }) {
		const [values, setValues] = (0, import_react.useState)(initialValues);
		const closeButton = (0, import_react.useRef)(null);
		(0, import_react.useLayoutEffect)(() => {
			closeButton.current?.focus();
		}, []);
		const apply = (patch) => setValues(onChange(patch));
		return (0, import_jsx_runtime.jsxs)("section", {
			className: "xns-settings-panel",
			role: "dialog",
			"aria-modal": "true",
			"aria-labelledby": "xns-settings-title",
			children: [
				(0, import_jsx_runtime.jsxs)("header", {
					className: "xns-settings-header",
					children: [(0, import_jsx_runtime.jsx)("h2", {
						id: "xns-settings-title",
						children: "预览设置"
					}), (0, import_jsx_runtime.jsx)("button", {
						ref: closeButton,
						className: "xns-settings-close",
						type: "button",
						title: "关闭设置",
						"aria-label": "关闭设置",
						onClick: onClose,
						children: "×"
					})]
				}),
				(0, import_jsx_runtime.jsxs)("div", {
					className: "xns-settings-form",
					children: [
						(0, import_jsx_runtime.jsx)(Field, {
							label: "默认评论布局",
							note: "只影响帖子详情页，切换会立即生效。",
							children: (0, import_jsx_runtime.jsxs)("select", {
								value: values.mode,
								onChange: (event) => apply({ mode: event.currentTarget.value === "original" ? "original" : "thread" }),
								children: [(0, import_jsx_runtime.jsx)("option", {
									value: "thread",
									children: "楼中楼"
								}), (0, import_jsx_runtime.jsx)("option", {
									value: "original",
									children: "原版评论"
								})]
							})
						}),
						(0, import_jsx_runtime.jsx)(Field, {
							label: "自动读取页数",
							note: "最多 50 页；修改后在下次刷新或打开帖子时生效。",
							children: (0, import_jsx_runtime.jsx)("select", {
								value: values.maxPages,
								onChange: (event) => apply({ maxPages: Number(event.currentTarget.value) }),
								children: [
									10,
									20,
									30,
									50
								].map((pages) => (0, import_jsx_runtime.jsxs)("option", {
									value: pages,
									children: [pages, " 页"]
								}, pages))
							})
						}),
						(0, import_jsx_runtime.jsx)(Field, {
							label: "评论密度",
							children: (0, import_jsx_runtime.jsxs)("select", {
								value: values.density,
								onChange: (event) => apply({ density: event.currentTarget.value === "compact" ? "compact" : "comfortable" }),
								children: [(0, import_jsx_runtime.jsx)("option", {
									value: "comfortable",
									children: "舒适"
								}), (0, import_jsx_runtime.jsx)("option", {
									value: "compact",
									children: "紧凑"
								})]
							})
						}),
						(0, import_jsx_runtime.jsx)(Field, {
							label: "主题",
							children: (0, import_jsx_runtime.jsxs)("select", {
								value: values.theme,
								onChange: (event) => apply({ theme: event.currentTarget.value === "dark" ? "dark" : "auto" }),
								children: [(0, import_jsx_runtime.jsx)("option", {
									value: "auto",
									children: "跟随 NodeSeek"
								}), (0, import_jsx_runtime.jsx)("option", {
									value: "dark",
									children: "深色"
								})]
							})
						})
					]
				}),
				(0, import_jsx_runtime.jsxs)("footer", {
					className: "xns-settings-actions",
					children: [(0, import_jsx_runtime.jsx)("button", {
						type: "button",
						onClick: () => setValues(onReset()),
						children: "恢复默认"
					}), (0, import_jsx_runtime.jsx)("button", {
						className: "xns-settings-primary",
						type: "button",
						onClick: onClose,
						children: "完成"
					})]
				})
			]
		});
	}
	function mountSettingsPanel(host, props) {
		const root = (0, import_client.createRoot)(host);
		root.render((0, import_jsx_runtime.jsx)(SettingsPanel, { ...props }));
		return () => root.unmount();
	}
	function closeSettings() {
		state.settingsPanel?.unmount?.();
		state.settingsPanel?.overlay?.remove();
		state.settingsPanel = null;
	}
	function openSettings() {
		closeSettings();
		if (!document.body) {
			document.addEventListener("DOMContentLoaded", openSettings, { once: true });
			return;
		}
		const overlay = createElement("div", "xns-settings-overlay");
		overlay.tabIndex = -1;
		overlay.addEventListener("click", (event) => {
			if (event.target === overlay) closeSettings();
		});
		document.body.appendChild(overlay);
		const apply = (update) => {
			const previousMode = state.mode;
			const next = update();
			if (next.mode !== previousMode) state.post?.setMode?.(next.mode);
			return next;
		};
		state.settingsPanel = {
			overlay,
			close: closeSettings,
			unmount: mountSettingsPanel(overlay, {
				initialValues: getSettings(),
				onChange: (patch) => apply(() => updateSettings(patch)),
				onReset: () => apply(resetSettings),
				onClose: closeSettings
			})
		};
	}
	function registerSettingsMenu() {
		if (typeof GM_registerMenuCommand !== "function") return false;
		try {
			GM_registerMenuCommand("NodeSeek 评论预览：打开设置", openSettings);
			return true;
		} catch {
			return false;
		}
	}
	var XNS_PREVIEW_SHELL_STYLES = `
      .xns-modal { position:relative; }
      .xns-preview-scroll-btns { position:absolute; top:50%; right:8px; bottom:auto; display:flex; flex-direction:column; gap:6px; z-index:3; transform:translateY(-50%); transition:opacity .3s ease; pointer-events:none; }
      .xns-scroll-btn { position:relative; box-sizing:border-box !important; width:34px !important; min-width:34px !important; max-width:34px !important; height:34px !important; min-height:34px !important; max-height:34px !important; flex:0 0 34px; padding:0 !important; border:1px solid var(--xns-border); border-radius:50%; color:var(--xns-muted); background:rgba(255,255,255,.96); display:flex; align-items:center; justify-content:center; cursor:pointer; box-shadow:0 2px 8px rgba(15,23,42,.14); opacity:.9; line-height:1; transition:all .2s ease; pointer-events:auto; }
      .xns-scroll-btn:hover, .xns-scroll-btn:focus-visible { border-color:var(--xns-accent-strong); color:var(--xns-accent); background:var(--xns-surface); opacity:1; transform:scale(1.05); outline:none; }
      .xns-scroll-btn[data-xns-tip]::after { position:absolute; right:calc(100% + 8px); top:50%; padding:4px 7px; border:1px solid var(--xns-border); border-radius:5px; color:var(--xns-text); background:var(--xns-surface); box-shadow:0 3px 10px rgba(15,23,42,.14); content:attr(data-xns-tip); font:12px/1.2 system-ui,sans-serif; opacity:0; pointer-events:none; transform:translateY(-50%) translateX(4px); transition:opacity .15s ease,transform .15s ease; white-space:nowrap; }
      .xns-scroll-btn:hover::after, .xns-scroll-btn:focus-visible::after { opacity:1; transform:translateY(-50%) translateX(0); }
      .xns-scroll-btn svg { width:13px; height:13px; fill:none; stroke:currentColor; stroke-width:2; stroke-linecap:round; stroke-linejoin:round; }
      .xns-scroll-btn.hidden { opacity:0; pointer-events:none; }
      .xns-scroll-btn.xns-action-pending { opacity:.45; pointer-events:none; }
      @keyframes xns-spin { to { transform:rotate(360deg); } }
      .xns-refresh-post.xns-action-pending svg { animation:xns-spin .9s linear infinite; }
      .xns-overlay { position:fixed; z-index:2147483000; inset:0; display:flex; align-items:stretch; justify-content:center; padding:0 clamp(32px,5vw,110px); background:rgba(15,23,42,.55); }
      .xns-modal { display:flex; flex-direction:column; width:min(1040px,100%); height:100vh; max-height:100vh; overflow:hidden; border-radius:0; color:var(--xns-text); background:var(--xns-surface); box-shadow:0 18px 55px rgba(15,23,42,.3); }
      .xns-modal-header { display:flex; align-items:center; gap:16px; padding:11px 16px; border-bottom:1px solid rgba(100,116,139,.2); }
      .xns-modal-heading { flex:1; min-width:0; }
      .xns-modal-title { min-width:0; overflow:hidden; margin:0; font-size:17px; line-height:1.3; text-overflow:ellipsis; white-space:nowrap; }
      .xns-modal-meta { display:flex; align-items:center; flex-wrap:wrap; gap:2px 10px; margin-top:3px; color:var(--xns-muted); font:11px/1.25 system-ui,sans-serif; }
      .xns-modal-meta-item { display:inline-flex; align-items:center; gap:3px; min-width:0; }
      .xns-modal-meta-item[hidden] { display:none; }
      .xns-modal-meta-label { color:var(--xns-subtle); }
      .xns-modal-meta-value { max-width:22em; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .xns-modal-actions { display:flex; align-items:center; gap:6px; flex:0 0 auto; }
      .xns-modal-actions .xns-modal-tool { margin-left:0; }
      .xns-modal-header a, .xns-modal-header .xns-modal-reply, .xns-modal-close { padding:5px 8px; border:1px solid var(--xns-border); border-radius:6px; color:inherit; background:var(--xns-surface-muted); cursor:pointer; text-decoration:none; font:12px/1.2 system-ui,sans-serif; }
      .xns-modal-header a:hover, .xns-modal-header a:focus-visible, .xns-modal-header .xns-modal-reply:hover, .xns-modal-header .xns-modal-reply:focus-visible, .xns-modal-close:hover, .xns-modal-close:focus-visible { border-color:var(--xns-accent-strong); color:var(--xns-accent); outline:none; }
      .xns-modal-close { font-size:18px; line-height:1; }
      .xns-modal-toolbar { display:flex; align-items:center; gap:8px; min-height:38px; padding:5px 16px; border-bottom:1px solid rgba(100,116,139,.16); color:var(--xns-muted); background:var(--xns-surface-muted); font:12px/1.2 system-ui,sans-serif; }
      .xns-modal-toolbar-status { display:inline-flex; flex:1 1 auto; align-items:center; min-width:0; gap:6px; overflow:hidden; color:var(--xns-muted); white-space:nowrap; text-overflow:ellipsis; }
      .xns-modal-toolbar-status > span { min-width:0; overflow:hidden; text-overflow:ellipsis; }
      .xns-preview-status.is-loading::before { width:8px; height:8px; flex:0 0 8px; border:2px solid rgba(37,99,235,.22); border-top-color:var(--xns-accent); border-radius:50%; content:""; animation:xns-spin .9s linear infinite; }
      .xns-preview-status.is-failed { color:var(--xns-danger); }
      .xns-preview-status.is-truncated { color:#92400e; }
      .xns-preview-status > span + span::before { margin:0 4px 0 1px; color:var(--xns-subtle); content:"·"; }
      .xns-inline-retry { padding:2px 7px; border:1px solid rgba(185,28,28,.35); border-radius:5px; color:var(--xns-danger); background:var(--xns-surface); cursor:pointer; font:11px/1.2 system-ui,sans-serif; }
      .xns-inline-retry:hover, .xns-inline-retry:focus-visible { border-color:var(--xns-danger); outline:none; }
      .xns-modal-tool { display:inline-flex; align-items:center; gap:5px; margin-left:auto; padding:4px 8px; border:1px solid var(--xns-border); border-radius:6px; color:var(--xns-muted); background:var(--xns-surface); cursor:pointer; font:12px/1.2 system-ui,sans-serif; }
      .xns-modal-tool:hover, .xns-modal-tool:focus-visible { border-color:var(--xns-accent-strong); color:var(--xns-accent); outline:none; }
      .xns-modal-tool svg { width:14px; height:14px; fill:none; stroke:currentColor; stroke-width:2; stroke-linecap:round; stroke-linejoin:round; }
      .xns-modal-body { flex:1 1 auto; min-height:0; overflow:auto; padding:clamp(10px,2vw,18px); color:var(--xns-text); }
      .xns-preview-composer-host { flex:0 0 auto; padding:0 16px; border-bottom:1px solid rgba(100,116,139,.2); background:var(--xns-surface-muted); }
      .xns-preview-composer-host[hidden] { display:none; }
      .xns-preview-composer-host > .xns-preview-composer { margin:0; padding:10px 0; border-top:0; }
      .xns-modal-body img { max-width:100%; height:auto; }
      .dark-layout .xns-modal { color:var(--xns-text); background:var(--xns-surface-muted); }
      .dark-layout .xns-modal-meta { color:var(--xns-muted); }
      .dark-layout .xns-modal-meta-label { color:var(--xns-subtle); }
      .dark-layout .xns-modal-toolbar { color:var(--xns-muted); background:var(--xns-surface); }
      .dark-layout .xns-scroll-btn { border-color:var(--xns-border); color:var(--xns-muted); background:var(--xns-surface); }
      .dark-layout .xns-scroll-btn:hover, .dark-layout .xns-scroll-btn:focus-visible { border-color:var(--xns-accent-strong); color:var(--xns-accent); background:var(--xns-surface-muted); }
      .dark-layout .xns-scroll-btn[data-xns-tip]::after { color:var(--xns-text); background:var(--xns-surface); border-color:var(--xns-border); }
      .dark-layout .xns-inline-retry { color:var(--xns-danger); background:var(--xns-surface); border-color:var(--xns-border); }
      @media (max-width:800px) { .xns-preview-scroll-btns { right:6px; } .xns-scroll-btn { width:30px !important; min-width:30px !important; max-width:30px !important; height:30px !important; min-height:30px !important; max-height:30px !important; flex-basis:30px; } }
      @media (max-width:640px) { .xns-overlay { padding:0; } .xns-modal { width:100%; max-height:100vh; } .xns-modal-header { gap:8px; padding:9px 10px; } .xns-modal-actions { gap:4px; } .xns-modal-header a, .xns-modal-header .xns-modal-reply { padding:5px 6px; } .xns-modal-toolbar { padding:5px 10px; } .xns-preview-composer-host { padding:0 10px; } .xns-modal-body { padding:9px; } .xns-preview-scroll-btns { right:5px; } .xns-scroll-btn { width:28px !important; min-width:28px !important; max-width:28px !important; height:28px !important; min-height:28px !important; max-height:28px !important; flex-basis:28px; } .xns-lightbox { padding:10px; } .xns-lightbox-image { max-width:calc(100vw - 20px); max-height:calc(100vh - 20px); } .xns-toolbar-status { width:100%; max-width:none; margin-left:0; } }
`;
	var XNS_SETTINGS_STYLES = `
      .xns-settings-overlay { position:fixed; z-index:2147483600; inset:0; display:flex; align-items:center; justify-content:center; padding:18px; background:rgba(15,23,42,.5); }
      .xns-settings-panel { box-sizing:border-box; width:min(500px,100%); max-height:calc(100vh - 36px); overflow:auto; padding:16px; border:1px solid var(--xns-border); border-radius:10px; color:var(--xns-text); background:var(--xns-surface); box-shadow:0 18px 55px rgba(15,23,42,.3); font:13px/1.4 system-ui,sans-serif; }
      .xns-settings-header { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:12px; }
      .xns-settings-header h2 { margin:0; font-size:18px; line-height:1.3; }
      .xns-settings-close { padding:2px 8px; border:1px solid var(--xns-border); border-radius:6px; color:inherit; background:var(--xns-surface-muted); cursor:pointer; font-size:20px; line-height:1; }
      .xns-settings-close:hover, .xns-settings-close:focus-visible { border-color:var(--xns-accent-strong); color:var(--xns-accent); outline:none; }
      .xns-settings-form { display:grid; gap:11px; }
      .xns-settings-field { display:grid; grid-template-columns:minmax(110px,1fr) minmax(150px,1.5fr); align-items:center; gap:4px 12px; }
      .xns-settings-label { color:var(--xns-muted); font-weight:600; }
      .xns-settings-field select { min-width:0; padding:5px 7px; border:1px solid var(--xns-border); border-radius:6px; color:inherit; background:var(--xns-surface); font:inherit; }
      .xns-settings-field select:focus-visible { outline:2px solid rgba(59,130,246,.45); outline-offset:1px; }
      .xns-settings-note { grid-column:2; color:var(--xns-muted); font-size:11px; }
      .xns-settings-actions { display:flex; justify-content:flex-end; gap:8px; margin-top:16px; padding-top:12px; border-top:1px solid rgba(100,116,139,.16); }
      .xns-settings-actions button { padding:6px 11px; border:1px solid var(--xns-border); border-radius:6px; color:inherit; background:var(--xns-surface); cursor:pointer; font:inherit; }
      .xns-settings-actions button:hover, .xns-settings-actions button:focus-visible { border-color:var(--xns-accent-strong); color:var(--xns-accent); outline:none; }
      .xns-settings-actions .xns-settings-primary { color:#fff; border-color:var(--xns-accent-strong); background:var(--xns-accent-strong); }
      .xns-settings-actions .xns-settings-primary:hover, .xns-settings-actions .xns-settings-primary:focus-visible { color:#fff; background:var(--xns-accent); }
      .xns-density-compact .xns-preview-thread > .content-item { padding-top:5px; padding-bottom:4px; }
      .xns-density-compact .xns-preview-thread .xns-comment-child { padding-top:4px !important; padding-bottom:3px !important; }
      .xns-density-compact .xns-post-toolbar { padding:5px; }
      .dark-layout .xns-settings-overlay { background:rgba(2,6,23,.72); }
      @media (max-width:640px) {
        .xns-settings-overlay { padding:10px; }
        .xns-settings-panel { max-height:calc(100vh - 20px); padding:12px; }
        .xns-settings-field { grid-template-columns:1fr; gap:3px; }
        .xns-settings-note { grid-column:1; }
      }
`;
	var XNS_STYLE_TOKENS = `
      :root {
        --xns-text: #1f2937;
        --xns-muted: #64748b;
        --xns-subtle: #94a3b8;
        --xns-surface: #fff;
        --xns-surface-muted: #f8fafc;
        --xns-accent: #2563eb;
        --xns-accent-strong: #1d4ed8;
        --xns-accent-soft: #eff6ff;
        --xns-border: rgba(100,116,139,.25);
        --xns-danger: #b91c1c;
        --xns-success: #16a34a;
      }
      .dark-layout {
        --xns-text: #e5e7eb;
        --xns-muted: #9ca3af;
        --xns-subtle: #6b7280;
        --xns-surface: #111827;
        --xns-surface-muted: #18202b;
        --xns-accent: #93c5fd;
        --xns-accent-strong: #60a5fa;
        --xns-accent-soft: rgba(59,130,246,.18);
        --xns-border: rgba(148,163,184,.35);
        --xns-danger: #fca5a5;
        --xns-success: #4ade80;
      }
`;
	function createStyleInstaller({ documentObj, styleId, ansiColors, ansiFgHex, ansiBgHex, ansiBrightHex, styleTokens, settingsStyles, previewShellStyles }) {
		function ansiRulesFor(prefix, property, hexes) {
			return ansiColors.map((name, index) => `.xns-preview-content .xns-ansi-${prefix}-${name} { ${property}:${hexes[index]}; }`).join(" ");
		}
		function installStyle() {
			if (documentObj.getElementById(styleId)) return;
			const style = documentObj.createElement("style");
			style.id = styleId;
			style.textContent = `
      ${styleTokens}
      ${settingsStyles}
      ${previewShellStyles}
      .xns-post-toolbar, .xns-post-toolbar * { box-sizing: border-box; }
      .xns-post-toolbar { position:fixed; right:42px; bottom:166px; z-index:1000; display:flex; align-items:center; flex-wrap:wrap; gap:6px; margin:0; padding:7px; border:1px solid var(--xns-border); border-radius:8px; color:var(--xns-text); background:rgba(248,250,252,.96); font:13px/1.3 system-ui,sans-serif; box-shadow:0 4px 16px rgba(0,0,0,.25); }
      .xns-post-toolbar button { padding:5px 10px; border:1px solid var(--xns-border); border-radius:6px; color:inherit; background:transparent; cursor:pointer; font:inherit; }
      .xns-post-toolbar button:hover, .xns-post-toolbar button:focus-visible { border-color:var(--xns-accent-strong); outline:none; }
      .xns-post-toolbar button[aria-pressed="true"] { color:var(--xns-accent); border-color:var(--xns-accent-strong); background:var(--xns-accent-soft); }
      .xns-post-mode-switch { display:inline-flex; padding:2px; border:1px solid rgba(100,116,139,.25); border-radius:6px; background:rgba(148,163,184,.08); }
      .xns-post-mode-switch button { padding:4px 8px; border:0; border-radius:4px; background:transparent; }
      .xns-post-mode-switch button:hover, .xns-post-mode-switch button:focus-visible { border-color:transparent; color:#2563eb; background:#eff6ff; }
      .xns-post-mode-switch button[aria-pressed="true"] { border-color:transparent; color:#1d4ed8; background:#fff; box-shadow:0 1px 3px rgba(15,23,42,.12); }
      .xns-toolbar-status { display:inline-flex; align-items:center; gap:6px; max-width:min(62vw,720px); min-width:0; margin-left:auto; overflow:hidden; color:#64748b; font-size:12px; text-overflow:ellipsis; white-space:nowrap; }
      .xns-toolbar-status.is-loading::before { width:8px; height:8px; flex:0 0 8px; border:2px solid rgba(37,99,235,.22); border-top-color:#2563eb; border-radius:50%; content:""; animation:xns-spin .9s linear infinite; }
      .xns-toolbar-status.is-failed { color:var(--xns-danger); }
      .xns-loading, .xns-status { margin:10px 0; padding:7px 10px; border:1px solid rgba(100,116,139,.2); border-radius:7px; color:#64748b; background:rgba(148,163,184,.08); font:13px/1.4 system-ui,sans-serif; }
      .xns-comment-root[data-xns-floor], .xns-comment-child[data-xns-floor] { position:relative; }
      .xns-preview-thread .floor-link-wrapper, .xns-preview-content .floor-link-wrapper { position:absolute; top:9px; right:10px; }
      .xns-preview-thread .floor-link-wrapper .floor-link, .xns-preview-content .floor-link-wrapper .floor-link { padding:2px 5px; border-radius:4px; color:#c5c5c5; background:rgba(148,163,184,.1); font-size:13px; font-weight:400; line-height:19.5px; text-decoration:none; cursor:pointer; }
      .xns-preview-thread .floor-link-wrapper .floor-link:hover, .xns-preview-thread .floor-link-wrapper .floor-link:focus-visible, .xns-preview-content .floor-link-wrapper .floor-link:hover, .xns-preview-content .floor-link-wrapper .floor-link:focus-visible { color:#2563eb; background:#eff6ff; outline:none; }
      .xns-comment-child { margin-top:7px !important; margin-left:clamp(8px,2vw,28px) !important; padding-left:clamp(8px,1.5vw,18px) !important; border-left:2px solid rgba(59,130,246,.35); }
      .xns-reply-list { margin:6px 0 0 !important; padding:0 !important; list-style:none !important; }
      .xns-floor-highlight { animation:xns-floor-highlight 1.8s ease both; }
      @keyframes xns-floor-highlight { 0%,100%{box-shadow:none} 20%{box-shadow:0 0 0 4px rgba(59,130,246,.3)} }
      .xns-preview-content { font-size:14px; line-height:1.45; }
      .xns-preview-content pre { box-sizing:border-box; max-width:100%; overflow:auto; white-space:pre; }
      .xns-preview-content pre.xns-code-block { position:relative !important; padding-top:30px; font:12px/1.55 ui-monospace,SFMono-Regular,Consolas,"Liberation Mono",monospace; }
      .xns-preview-content pre.xns-code-block code { font:inherit; }
      .xns-preview-content .xns-code-copy-btn { position:absolute; top:8px; right:8px; z-index:2; padding:2px 8px; border:0; border-radius:3px; color:#fff; background:#4caf50; cursor:pointer; font:12px/1.2 system-ui,sans-serif; opacity:.85; }
      .xns-preview-content .xns-code-copy-btn:hover, .xns-preview-content .xns-code-copy-btn:focus-visible { opacity:1; outline:none; }
      .xns-preview-content .xns-code-copy-btn.xns-copy-failed { background:#dc2626; }
      ${ansiRulesFor("fg", "color", ansiFgHex)}
      ${ansiRulesFor("fg-bright", "color", ansiBrightHex)}
      ${ansiRulesFor("bg", "background", ansiBgHex)}
      ${ansiRulesFor("bg-bright", "background", ansiBrightHex)}
      .xns-preview-content .xns-ansi-bold { font-weight:700; } .xns-preview-content .xns-ansi-dim { opacity:.72; } .xns-preview-content .xns-ansi-italic { font-style:italic; } .xns-preview-content .xns-ansi-underline { text-decoration:underline; } .xns-preview-content .xns-ansi-strike { text-decoration:line-through; } .xns-preview-content .xns-ansi-hidden { visibility:hidden; } .xns-preview-content .xns-ansi-inverse { filter:invert(1); }
      .xns-preview-content .xns-markdown-tabs { margin:8px 0; overflow:hidden; border:1px solid rgba(100,116,139,.24); border-radius:7px; background:#f8fafc; }
      .xns-preview-content .xns-markdown-tabs-nav { display:flex; align-items:center; flex-wrap:wrap; gap:4px; padding:5px 6px; border-bottom:1px solid rgba(100,116,139,.2); background:rgba(148,163,184,.1); }
      .xns-preview-content .xns-markdown-tab { padding:5px 9px; border:1px solid transparent; border-radius:5px; color:#64748b; background:transparent; cursor:pointer; font:13px/1.25 system-ui,sans-serif; }
      .xns-preview-content .xns-markdown-tab:hover, .xns-preview-content .xns-markdown-tab:focus-visible { color:#2563eb; outline:none; }
      .xns-preview-content .xns-markdown-tab.is-active { border-color:rgba(59,130,246,.28); color:#1d4ed8; background:#fff; box-shadow:0 1px 2px rgba(15,23,42,.08); }
      .xns-preview-content .xns-markdown-tab-panel { display:none; padding:8px 10px; }
      .xns-preview-content .xns-markdown-tab-panel.is-active { display:block; }
      .xns-preview-content .nsk-magic-tabs { margin:8px 0; overflow:hidden; border:1px solid rgba(100,116,139,.24); border-radius:7px; background:#f8fafc; }
      .xns-preview-content .nsk-magic-tabs > .nsk-magic-tab-title { display:inline-block; box-sizing:border-box; margin:0; padding:8px 12px; border:1px solid transparent; border-bottom:0; color:#64748b; background:transparent; cursor:pointer; font-size:14px; line-height:1.3; vertical-align:bottom; }
      .xns-preview-content .nsk-magic-tabs > .nsk-magic-tab-title:hover, .xns-preview-content .nsk-magic-tabs > .nsk-magic-tab-title:focus-visible { color:#2563eb; outline:none; }
      .xns-preview-content .nsk-magic-tabs > .nsk-magic-tab-title.xns-active { border-color:rgba(100,116,139,.24); border-radius:7px 7px 0 0; color:#1d4ed8; background:#fff; }
      .xns-preview-content .nsk-magic-tabs > .nsk-magic-tab-body { display:none; clear:both; box-sizing:border-box; padding:8px 10px; border-top:1px solid rgba(100,116,139,.24); }
      .xns-preview-content .nsk-magic-tabs > .nsk-magic-tab-body.xns-active { display:block; }
      .xns-preview-content h1, .xns-preview-content h2, .xns-preview-content h3, .xns-preview-content p { line-height:1.45; }
      .xns-preview-content h1, .xns-preview-content h2, .xns-preview-content h3 { margin-top:0; }
      .xns-preview-content p { margin:3px 0 6px; }
      .xns-preview-post { margin:0 0 10px; padding:8px 10px; border:1px solid var(--xns-border); border-radius:7px; background:var(--xns-surface-muted); }
      .xns-preview-post h1, .xns-preview-post h1.post-title, .xns-preview-post .post-title { margin:0 0 4px; font-size:20px; line-height:1.3; }
      .xns-preview-post h2 { margin:5px 0 3px; font-size:17px; }
      .xns-preview-post .nsk-content-meta-info { display:flex; align-items:center; flex-wrap:wrap; gap:4px 9px; margin:0 0 4px; color:#64748b; font-size:12px; line-height:1.25; }
      .xns-preview-post .post-content, .xns-preview-post article.post-content { margin:0; line-height:1.5; }
      .xns-preview-post .post-content p, .xns-preview-post article.post-content p { margin:2px 0 5px; }
      .xns-preview-post .post-content > :first-child, .xns-preview-post article.post-content > :first-child { margin-top:0; }
      .xns-preview-post .post-content > :last-child, .xns-preview-post article.post-content > :last-child { margin-bottom:0; }
      .xns-preview-comments { margin-top:10px; padding-top:8px; border-top:1px solid rgba(100,116,139,.2); }
      .xns-preview-comments > h3 { margin:0 0 7px; font-size:15px; line-height:1.3; }
      .xns-preview-thread { margin:0; padding:0; list-style:none; }
      .xns-virtual-list > .xns-virtual-spacer { display:block !important; height:0; margin:0 !important; padding:0 !important; border:0 !important; list-style:none !important; pointer-events:none; }
      .xns-virtual-list > .content-item[data-xns-depth] { margin-left:var(--xns-indent,0px) !important; }
      .xns-preview-thread > .content-item { margin:4px 0; padding:8px 10px 7px; border:1px solid var(--xns-border); border-radius:7px; background:var(--xns-surface-muted); content-visibility:auto; contain-intrinsic-size:150px; }
      .xns-preview-thread > .content-item[data-xns-floor] { border-left:3px solid rgba(37,99,235,.72); }
      .xns-preview-thread .xns-comment-child { margin:3px 0 0 14px !important; padding:7px 8px 6px 10px !important; border:0 !important; border-left:2px solid rgba(59,130,246,.4) !important; border-radius:0 !important; background:transparent !important; }
      .xns-preview-thread .nsk-content-meta-info { display:flex; align-items:center; flex-wrap:wrap; gap:4px 8px; margin:0 0 3px; color:#64748b; font-size:12px; line-height:1.25; }
      .xns-preview-content .nsk-content-meta-info .content-info, .xns-preview-content .nsk-content-meta-info .date-created { display:inline-flex; align-items:center; flex-wrap:wrap; gap:5px; margin:0 !important; line-height:1.25; }
      .xns-preview-content .nsk-content-meta-info .date-created time { display:inline; white-space:nowrap; }
      .xns-preview-content .user-info-display { position:static !important; display:inline-flex !important; align-items:center; transform:none !important; margin:0 !important; padding:0 !important; }
      .xns-preview-thread .post-content, .xns-preview-thread article.post-content { margin:0; line-height:1.45; }
      .xns-preview-thread .post-content p, .xns-preview-thread article.post-content p { margin:2px 0 4px; }
      .xns-preview-thread .post-content > :first-child, .xns-preview-thread article.post-content > :first-child { margin-top:0; }
      .xns-preview-thread .post-content > :last-child, .xns-preview-thread article.post-content > :last-child { margin-bottom:0; }
      .xns-preview-thread .comment-menu, .xns-preview-menu { display:flex; align-items:center; flex-wrap:wrap; gap:2px 5px; margin-top:7px; padding-top:5px; border-top:1px solid rgba(100,116,139,.13); color:#8b95a1; font:12px/1.2 system-ui,sans-serif; }
      .xns-preview-thread .comment-menu > .menu-item, .xns-preview-menu > .menu-item { display:inline-flex; align-items:center; gap:4px; min-height:22px; padding:2px 5px; border:0; border-radius:4px; color:inherit; background:transparent; cursor:pointer; text-decoration:none; }
      .xns-preview-thread .comment-menu > .menu-item:hover, .xns-preview-thread .comment-menu > .menu-item:focus-visible, .xns-preview-menu > .menu-item:hover, .xns-preview-menu > .menu-item:focus-visible { color:#2563eb; background:#eff6ff; outline:none; }
      .xns-preview-thread .comment-menu > .menu-item[data-xns-action="quote"], .xns-preview-thread .comment-menu > .menu-item[data-xns-action="reply"], .xns-preview-menu > .menu-item[data-xns-action="quote"], .xns-preview-menu > .menu-item[data-xns-action="reply"] { margin-left:4px; }
      .xns-preview-thread .xns-action-icon, .xns-preview-menu .xns-action-icon { display:inline-flex; min-width:14px; justify-content:center; color:inherit; font-size:14px; line-height:1; }
      .xns-preview-thread .xns-action-count, .xns-preview-menu .xns-action-count { font-variant-numeric:tabular-nums; }
      .xns-preview-thread .comment-menu > .menu-item.xns-action-pending, .xns-preview-menu > .menu-item.xns-action-pending { opacity:.55; pointer-events:none; }
      .xns-preview-thread .comment-menu > .menu-item.xns-action-failed, .xns-preview-menu > .menu-item.xns-action-failed { color:#b91c1c; }
      .xns-action-state { font-size:11px; }
      .xns-preview-composer { margin-top:10px; padding-top:8px; border-top:1px solid rgba(100,116,139,.2); }
      .xns-preview-composer-title { margin:0 0 6px; font-size:14px; }
      .xns-preview-composer textarea { display:block; box-sizing:border-box; width:100%; min-height:100px; resize:vertical; padding:8px; border:1px solid rgba(100,116,139,.35); border-radius:6px; color:inherit; background:transparent; font:14px/1.5 system-ui,sans-serif; }
      .xns-preview-composer-actions { display:flex; align-items:center; flex-wrap:wrap; gap:8px; margin-top:8px; }
      .xns-preview-composer button, .xns-preview-composer a { padding:5px 10px; border:1px solid rgba(100,116,139,.3); border-radius:6px; color:inherit; background:transparent; cursor:pointer; text-decoration:none; font:13px/1.2 system-ui,sans-serif; }
      .xns-preview-composer button:hover, .xns-preview-composer button:focus-visible, .xns-preview-composer a:hover, .xns-preview-composer a:focus-visible { border-color:#3b82f6; outline:none; }
      .xns-preview-composer-status { color:#64748b; font-size:12px; }
      .xns-image-error { display:block; margin-top:5px; color:#b91c1c; font:12px/1.4 system-ui,sans-serif; }
      .xns-preview-content .vote-panel { margin:8px 0; }
      .xns-preview-content .vote-panel .pure-form { padding:2px 0; }
      .xns-preview-content .vote-panel form { background:#fbfbfb; border:1px solid rgba(100,116,139,.2); border-radius:7px; padding:8px 10px; }
      .xns-preview-content .vote-panel .vote-stat { display:flex; align-items:flex-start; gap:6px; margin:4px 0; }
      .xns-preview-content .vote-panel input[type="radio"] { margin-top:3px; flex:0 0 auto; }
      .xns-preview-content .vote-panel button { margin-top:8px; padding:4px 14px; border:1px solid rgba(0,120,231,.4); border-radius:6px; color:#0078e7; background:transparent; cursor:pointer; font:13px/1.3 system-ui,sans-serif; }
      .xns-preview-content .vote-panel button:disabled { opacity:.55; cursor:not-allowed; }
      .xns-vote-status { margin-top:6px; color:#64748b; font-size:12px; }
      .xns-vote-status:empty { display:none; }
      .xns-vote-results { display:flex; flex-direction:column; gap:6px; margin:4px 0 6px; }
      .xns-vote-results .xns-vote-result { display:flex; flex-direction:column; gap:2px; }
      .xns-vote-results .vote-item-text { font-size:13px; line-height:1.3; }
      .xns-vote-results .xns-vote-bar-wrap { height:16px; border:1px solid rgba(100,116,139,.25); border-radius:4px; background:rgba(148,163,184,.12); overflow:hidden; }
      .xns-vote-results .xns-vote-bar { box-sizing:border-box; min-width:26px; height:100%; padding:0 6px; display:flex; align-items:center; justify-content:flex-end; color:#fff; background:#3b82f6; font:11px/16px system-ui,sans-serif; border-radius:3px 0 0 3px; }
      .xns-vote-results .xns-vote-mine .vote-item-text { color:#1d4ed8; font-weight:600; }
      .xns-vote-results .xns-vote-result-meta { color:#64748b; font-size:12px; }
      .xns-vote-total { margin-top:4px; color:#64748b; font-size:12px; }
      .xns-preview-content img { cursor:zoom-in; }
      .xns-lightbox { position:fixed; z-index:2147483500; inset:0; display:flex; align-items:center; justify-content:center; padding:24px; background:rgba(2,6,23,.88); }
      .xns-lightbox-stage { position:relative; display:flex; align-items:center; justify-content:center; width:100%; height:100%; overflow:hidden; cursor:grab; }
      .xns-lightbox-stage.xns-dragging { cursor:grabbing; }
      .xns-lightbox-image { max-width:calc(100vw - 48px); max-height:calc(100vh - 48px); object-fit:contain; user-select:none; -webkit-user-drag:none; transform-origin:center; cursor:grab; }
      .xns-lightbox-stage.xns-dragging .xns-lightbox-image { cursor:grabbing; }
      .xns-lightbox-close, .xns-lightbox-open { position:absolute; z-index:1; padding:6px 10px; border:1px solid rgba(255,255,255,.35); border-radius:6px; color:#fff; background:rgba(15,23,42,.58); cursor:pointer; text-decoration:none; font:13px/1.2 system-ui,sans-serif; }
      .xns-lightbox-close { top:10px; right:10px; font-size:20px; line-height:1; }
      .xns-lightbox-open { left:10px; bottom:10px; }
      .xns-lightbox-close:hover, .xns-lightbox-open:hover, .xns-lightbox-close:focus-visible, .xns-lightbox-open:focus-visible { background:rgba(15,23,42,.9); outline:none; }
      .dark-layout .xns-preview-post, .dark-layout .xns-preview-thread > .content-item { color:#e5e7eb; background:#111827; }
      .dark-layout .xns-preview-thread > .content-item[data-xns-floor] { border-left-color:#60a5fa; }
      .dark-layout .xns-preview-thread .xns-comment-child { border-left-color:rgba(96,165,250,.6) !important; }
      .dark-layout .xns-preview-thread .floor-link-wrapper .floor-link, .dark-layout .xns-preview-content .floor-link-wrapper .floor-link { background:rgba(148,163,184,.14); }
      .dark-layout .xns-preview-thread .floor-link-wrapper .floor-link:hover, .dark-layout .xns-preview-thread .floor-link-wrapper .floor-link:focus-visible, .dark-layout .xns-preview-content .floor-link-wrapper .floor-link:hover, .dark-layout .xns-preview-content .floor-link-wrapper .floor-link:focus-visible { color:#93c5fd; background:rgba(59,130,246,.18); }
      .dark-layout .xns-preview-thread .comment-menu > .menu-item:hover, .dark-layout .xns-preview-thread .comment-menu > .menu-item:focus-visible, .dark-layout .xns-preview-menu > .menu-item:hover, .dark-layout .xns-preview-menu > .menu-item:focus-visible { color:#93c5fd; background:rgba(59,130,246,.18); }
      .dark-layout .xns-preview-content pre.xns-code-block { color:#e5e7eb; background:#0b1220; }
      .dark-layout .xns-preview-content .xns-ansi-fg-black { color:#e5e7eb; } .dark-layout .xns-preview-content .xns-ansi-fg-white { color:#111827; }
      .dark-layout .xns-preview-content .xns-markdown-tabs { background:#111827; } .dark-layout .xns-preview-content .xns-markdown-tabs-nav { background:rgba(15,23,42,.65); } .dark-layout .xns-preview-content .xns-markdown-tab.is-active { color:#93c5fd; background:#18202b; }
      .dark-layout .xns-preview-content .nsk-magic-tabs { background:#111827; } .dark-layout .xns-preview-content .nsk-magic-tabs > .nsk-magic-tab-title.xns-active { color:#93c5fd; background:#18202b; }
      .dark-layout .xns-post-toolbar { color:#e5e7eb; background:#1e293b; border-color:rgba(148,163,184,.3); }
      .dark-layout .xns-post-toolbar button { color:#e5e7eb; border-color:rgba(148,163,184,.35); }
      .dark-layout .xns-post-toolbar button[aria-pressed="true"] { color:#93c5fd; border-color:#3b82f6; background:rgba(59,130,246,.22); }
      .dark-layout .xns-post-mode-switch { border-color:rgba(148,163,184,.35); background:rgba(15,23,42,.35); }
      .dark-layout .xns-post-mode-switch button { border-color:transparent; }
      .dark-layout .xns-post-mode-switch button:hover, .dark-layout .xns-post-mode-switch button:focus-visible { color:#93c5fd; background:rgba(59,130,246,.18); }
      .dark-layout .xns-post-mode-switch button[aria-pressed="true"] { color:#93c5fd; background:#111827; box-shadow:0 1px 3px rgba(0,0,0,.3); }
      .dark-layout .xns-preview-composer textarea { color:#e5e7eb; }
      .dark-layout .xns-preview-composer button, .dark-layout .xns-preview-composer a { color:#e5e7eb; border-color:rgba(148,163,184,.35); }
      .dark-layout .xns-preview-content .vote-panel form { color:#e5e7eb; background:#111827; border-color:rgba(148,163,184,.25); }
      .dark-layout .xns-preview-content .vote-panel button { color:#93c5fd; border-color:rgba(59,130,246,.5); }
      .dark-layout .xns-vote-results .xns-vote-bar { color:#0b1220; background:#60a5fa; }
      .dark-layout .xns-vote-results .xns-vote-mine .vote-item-text { color:#93c5fd; }
      .dark-layout .xns-toolbar-status, .dark-layout .xns-preview-status, .dark-layout .xns-loading, .dark-layout .xns-status, .dark-layout .xns-vote-status { color:#9ca3af; }
      .dark-layout .xns-toolbar-status.is-failed { color:#fca5a5; }
      .dark-layout .xns-preview-status.is-failed { color:#fca5a5; }
      .dark-layout .xns-preview-status.is-truncated { color:#fcd34d; }
      .dark-layout .xns-preview-thread .floor-link-wrapper .floor-link, .dark-layout .xns-preview-content .floor-link-wrapper .floor-link { color:#6b7280; }
      @media (max-width:640px) { .xns-preview-post { padding:7px 8px; } .xns-preview-post h1, .xns-preview-post h1.post-title, .xns-preview-post .post-title { font-size:18px; } .xns-lightbox { padding:10px; } .xns-lightbox-image { max-width:calc(100vw - 20px); max-height:calc(100vh - 20px); } .xns-toolbar-status { width:100%; max-width:none; margin-left:0; } }
    `;
			(documentObj.head || documentObj.documentElement || documentObj.body)?.appendChild(style);
		}
		return Object.freeze({
			ansiRulesFor,
			installStyle
		});
	}
	var xnsStyleInstaller = createStyleInstaller({
		documentObj: document,
		styleId: STYLE_ID,
		ansiColors: ANSI_COLORS,
		ansiFgHex: ANSI_FG_HEX,
		ansiBgHex: ANSI_BG_HEX,
		ansiBrightHex: ANSI_BRIGHT_HEX,
		styleTokens: XNS_STYLE_TOKENS,
		settingsStyles: XNS_SETTINGS_STYLES,
		previewShellStyles: XNS_PREVIEW_SHELL_STYLES
	});
	function installStyle(...args) {
		return xnsStyleInstaller.installStyle(...args);
	}
	function createAppBootstrap({ documentObj, windowObj, pageInfo, state, installStyle, registerSettingsMenu, createPreviewEntryController, createFloorNavigationController, parseSameOriginUrl, getPostInfo, openPreviewModal, handleFloorClick, handlePreviewActionClick, handleVoteClick, handleKeydown, PostEnhancer }) {
		function start() {
			installStyle();
			registerSettingsMenu();
			const previewEntry = createPreviewEntryController({
				document: documentObj,
				location: windowObj.location,
				parseSameOriginUrl,
				getPostInfo,
				openPreviewModal
			});
			const floorNavigation = createFloorNavigationController({
				enabled: Boolean(pageInfo),
				handleFloorClick
			});
			documentObj.addEventListener("click", handlePreviewActionClick, true);
			documentObj.addEventListener("click", handleVoteClick, true);
			documentObj.addEventListener("click", previewEntry.handle, true);
			documentObj.addEventListener("click", floorNavigation.handle, true);
			documentObj.addEventListener("keydown", handleKeydown, true);
			const ready = () => {
				if (!pageInfo || state.post) return;
				state.post = new PostEnhancer(pageInfo);
				state.post.init().catch(() => state.post?.restoreOriginal());
			};
			if (documentObj.readyState === "loading") documentObj.addEventListener("DOMContentLoaded", ready, { once: true });
			else ready();
		}
		return Object.freeze({ start });
	}
	createAppBootstrap({
		documentObj: document,
		windowObj: window,
		pageInfo,
		state,
		installStyle,
		registerSettingsMenu,
		createPreviewEntryController,
		createFloorNavigationController,
		parseSameOriginUrl,
		getPostInfo,
		openPreviewModal,
		handleFloorClick,
		handlePreviewActionClick,
		handleVoteClick,
		handleKeydown,
		PostEnhancer
	}).start();
})();
