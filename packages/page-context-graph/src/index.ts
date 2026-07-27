import type { BrowserContext, Frame, Page } from "playwright";
import {
  PageContextGraphSchema,
  type DemonstratedTargetDescriptor,
  type PageContextGraphData,
  type RecordedPageContext,
} from "../../demonstration-ir/src";
import { canonicalizeUrl, createId, sha256 } from "../../shared/src";

export type PageGraphEvent =
  | {
      type: "page-open";
      context: RecordedPageContext;
      openerContextId?: string;
    }
  | { type: "page-close"; context: RecordedPageContext }
  | {
      type: "navigation";
      context: RecordedPageContext;
      previousContextId: string;
    }
  | {
      type: "frame-attached";
      context: RecordedPageContext;
      parentContextId: string;
    };

export type LiveTargetRootResolution = {
  root?: Page | Frame;
  originalDomNodeReplaced: boolean;
  semanticEquivalentFound: boolean;
};

function safeCanonical(url: string) {
  try {
    return canonicalizeUrl(url);
  } catch {
    return { origin: "opaque:", pathname: "/", canonicalUrl: "opaque:/" };
  }
}

function titlePattern(title: string) {
  return title
    .replaceAll(/\d+/g, "\\d+")
    .replaceAll(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

async function pageFingerprint(page: Page) {
  const structural = await page
    .evaluate(() => {
      const headings = Array.from(
        document.querySelectorAll("h1,h2,[role=heading]"),
      )
        .slice(0, 8)
        .map((node) => node.textContent?.trim().slice(0, 80) ?? "");
      const landmarks = Array.from(
        document.querySelectorAll(
          "main,form,nav,[role=main],[role=form],[role=dialog]",
        ),
      )
        .slice(0, 12)
        .map((node) => `${node.tagName}:${node.getAttribute("role") ?? ""}`);
      return { headings, landmarks };
    })
    .catch(() => ({ headings: [] as string[], landmarks: [] as string[] }));
  const canonical = safeCanonical(page.url());
  return sha256(
    JSON.stringify({
      origin: canonical.origin,
      pathname: canonical.pathname,
      structural,
    }),
  );
}

async function frameFingerprint(frame: Frame) {
  const canonical = safeCanonical(frame.url());
  const title = await frame.title().catch(() => "");
  return sha256(
    JSON.stringify({
      origin: canonical.origin,
      pathname: canonical.pathname,
      name: frame.name(),
      title: titlePattern(title),
    }),
  );
}

export class PageContextGraph {
  readonly #pageIds = new WeakMap<Page, string>();
  readonly #activePageDocuments = new WeakMap<Page, string>();
  readonly #pageDocumentOrdinals = new WeakMap<Page, number>();
  readonly #frameIds = new WeakMap<Frame, string>();
  readonly #frameDocumentOrdinals = new WeakMap<Frame, number>();
  readonly #pageRegistrations = new WeakMap<Page, Promise<string>>();
  readonly #frameRegistrations = new WeakMap<Frame, Promise<string>>();
  readonly #pageNavigations = new WeakMap<Page, Promise<string>>();
  readonly #pages = new Map<string, Page>();
  readonly #frames = new Map<string, Frame>();
  readonly #documentTokens = new Map<string, string>();
  readonly #nodes = new Map<string, RecordedPageContext>();
  readonly #edges: PageContextGraphData["edges"] = [];
  readonly #listeners = new Set<(event: PageGraphEvent) => void>();
  #rootId: string | undefined;
  #started = false;

  constructor(private readonly context: BrowserContext) {}

  onEvent(listener: (event: PageGraphEvent) => void) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #emit(event: PageGraphEvent) {
    for (const listener of this.#listeners) listener(event);
  }

  async start() {
    if (this.#started) return;
    this.#started = true;
    await this.context.addInitScript({
      content: `if (!globalThis.__vc2DocumentToken) {
        Object.defineProperty(globalThis, "__vc2DocumentToken", {
          value: globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2),
          configurable: false
        });
      }`,
    });
    this.context.on("page", (page) => void this.registerPage(page));
    for (const page of this.context.pages()) {
      await page
        .evaluate(() => {
          const scope = globalThis as typeof globalThis & {
            __vc2DocumentToken?: string;
          };
          if (!scope.__vc2DocumentToken)
            Object.defineProperty(scope, "__vc2DocumentToken", {
              value:
                globalThis.crypto?.randomUUID?.() ??
                Math.random().toString(36).slice(2),
              configurable: false,
            });
        })
        .catch(() => undefined);
      await this.registerPage(page);
    }
  }

  async registerPage(page: Page) {
    const existing = this.#activePageDocuments.get(page);
    if (existing) return existing;
    const pending = this.#pageRegistrations.get(page);
    if (pending) return pending;
    const registration = this.#registerPage(page);
    this.#pageRegistrations.set(page, registration);
    try {
      return await registration;
    } finally {
      this.#pageRegistrations.delete(page);
    }
  }

  async #registerPage(page: Page) {
    const opener = await page.opener();
    const openerId = opener ? await this.registerPage(opener) : undefined;
    const pageId = createId("page");
    const id = createId("document");
    const canonical = safeCanonical(page.url());
    const role = !this.#rootId ? "main" : openerId ? "popup" : "tab";
    const title = await page.title().catch(() => "");
    const node: RecordedPageContext = {
      id,
      pageId,
      documentOrdinal: 1,
      role,
      ...(openerId ? { parentId: openerId } : {}),
      origin: canonical.origin,
      pathname: canonical.pathname,
      ...(title ? { titlePattern: titlePattern(title) } : {}),
      structuralFingerprint: await pageFingerprint(page),
      pageRole: role === "main" ? "main-application" : role,
      sameOriginInspectable: true,
      status: "active",
    };
    if (!this.#rootId) this.#rootId = id;
    this.#pageIds.set(page, pageId);
    this.#activePageDocuments.set(page, id);
    this.#pageDocumentOrdinals.set(page, 1);
    this.#pages.set(id, page);
    this.#nodes.set(id, node);
    const token = await this.#documentTokenForFrame(page.mainFrame());
    if (token) this.#documentTokens.set(token, id);
    if (openerId) {
      this.#edges.push({ from: openerId, to: id, relation: "opened" });
    }
    this.#wirePage(page, id);
    this.#emit({
      type: "page-open",
      context: node,
      ...(openerId ? { openerContextId: openerId } : {}),
    });
    for (const frame of page.frames()) {
      if (frame !== page.mainFrame()) await this.ensureFrame(frame);
    }
    return id;
  }

  #wirePage(page: Page, initialDocumentId: string) {
    page.on("close", () => {
      const activeId = this.#activePageDocuments.get(page) ?? initialDocumentId;
      const current = this.#nodes.get(activeId);
      if (!current) return;
      const closed = { ...current, status: "closed" as const };
      this.#nodes.set(activeId, closed);
      this.#emit({ type: "page-close", context: closed });
      if (current.parentId) {
        this.#edges.push({
          from: activeId,
          to: current.parentId,
          relation: "focus-return",
        });
      }
    });
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) void this.#navigatePage(page);
      else void this.updateFrame(frame);
    });
    page.on("frameattached", (frame) => void this.ensureFrame(frame));
    page.on("framedetached", (frame) => {
      const frameId = this.#frameIds.get(frame);
      if (!frameId) return;
      const current = this.#nodes.get(frameId);
      if (current)
        this.#nodes.set(frameId, { ...current, status: "closed" as const });
    });
  }

  async updatePage(page: Page): Promise<string> {
    const activeId =
      this.#activePageDocuments.get(page) ?? (await this.registerPage(page));
    const current = this.#nodes.get(activeId);
    if (!current) return activeId;
    const canonical = safeCanonical(page.url());
    if (
      canonical.origin !== current.origin ||
      canonical.pathname !== current.pathname
    )
      return this.#navigatePage(page);
    const title = await page.title().catch(() => "");
    const updated: RecordedPageContext = {
      ...current,
      ...(title ? { titlePattern: titlePattern(title) } : {}),
      structuralFingerprint: await pageFingerprint(page),
    };
    this.#nodes.set(activeId, updated);
    const token = await this.#documentTokenForFrame(page.mainFrame());
    if (token) this.#documentTokens.set(token, activeId);
    return activeId;
  }

  async #navigatePage(page: Page): Promise<string> {
    const pending = this.#pageNavigations.get(page);
    if (pending) return pending;
    const navigation: Promise<string> = this.#recordPageNavigation(page);
    this.#pageNavigations.set(page, navigation);
    try {
      return await navigation;
    } finally {
      this.#pageNavigations.delete(page);
    }
  }

  async #recordPageNavigation(page: Page): Promise<string> {
    const previousId =
      this.#activePageDocuments.get(page) ?? (await this.registerPage(page));
    const previous = this.#nodes.get(previousId);
    if (!previous) return previousId;
    const canonical = safeCanonical(page.url());
    const title = await page.title().catch(() => "");
    const token = await this.#documentTokenForFrame(page.mainFrame());
    if (
      previous.origin === canonical.origin &&
      previous.pathname === canonical.pathname &&
      (!token || this.#documentTokens.get(token) === previousId)
    )
      return this.updatePage(page);
    const id = createId("document");
    const documentOrdinal =
      (this.#pageDocumentOrdinals.get(page) ?? previous.documentOrdinal) + 1;
    const updated: RecordedPageContext = {
      ...previous,
      id,
      documentOrdinal,
      parentId: previous.parentId,
      origin: canonical.origin,
      pathname: canonical.pathname,
      ...(title ? { titlePattern: titlePattern(title) } : {}),
      structuralFingerprint: await pageFingerprint(page),
      status: "active",
    };
    this.#nodes.set(previousId, { ...previous, status: "replaced" });
    this.#nodes.set(id, updated);
    this.#activePageDocuments.set(page, id);
    this.#pageDocumentOrdinals.set(page, documentOrdinal);
    this.#pages.set(id, page);
    if (token) this.#documentTokens.set(token, id);
    this.#edges.push({
      from: previousId,
      to: id,
      relation: "navigated",
    });
    this.#emit({
      type: "navigation",
      context: updated,
      previousContextId: previousId,
    });
    return id;
  }

  async ensureFrame(frame: Frame) {
    const existing = this.#frameIds.get(frame);
    if (existing) return existing;
    const pending = this.#frameRegistrations.get(frame);
    if (pending) return pending;
    const registration = this.#registerFrame(frame);
    this.#frameRegistrations.set(frame, registration);
    try {
      return await registration;
    } finally {
      this.#frameRegistrations.delete(frame);
    }
  }

  async #registerFrame(frame: Frame) {
    const page = frame.page();
    const parentId = await this.registerPage(page);
    const pageId = this.#pageIds.get(page) ?? createId("page");
    const id = createId("frame");
    const canonical = safeCanonical(frame.url());
    const pageCanonical = safeCanonical(page.url());
    const sameOrigin = canonical.origin === pageCanonical.origin;
    const title = await frame.title().catch(() => "");
    const node: RecordedPageContext = {
      id,
      pageId,
      documentOrdinal: 1,
      role: "frame",
      parentId,
      origin: canonical.origin,
      pathname: canonical.pathname,
      ...(title ? { titlePattern: titlePattern(title) } : {}),
      structuralFingerprint: await frameFingerprint(frame),
      expectedLandmark: frame.name() || title || "iframe",
      pageRole: sameOrigin ? "same-origin-frame" : "cross-origin-frame",
      sameOriginInspectable: sameOrigin,
      status: "active",
    };
    this.#frameIds.set(frame, id);
    this.#frameDocumentOrdinals.set(frame, 1);
    this.#frames.set(id, frame);
    this.#nodes.set(id, node);
    const token = await this.#documentTokenForFrame(frame);
    if (token) this.#documentTokens.set(token, id);
    this.#edges.push({
      from: parentId,
      to: id,
      relation: "contains-frame",
    });
    this.#emit({
      type: "frame-attached",
      context: node,
      parentContextId: parentId,
    });
    return id;
  }

  async updateFrame(frame: Frame) {
    const previousId =
      this.#frameIds.get(frame) ?? (await this.ensureFrame(frame));
    const current = this.#nodes.get(previousId);
    if (!current) return previousId;
    const page = frame.page();
    const canonical = safeCanonical(frame.url());
    const pageCanonical = safeCanonical(page.url());
    const sameOrigin = canonical.origin === pageCanonical.origin;
    const title = await frame.title().catch(() => "");
    const id = createId("frame-document");
    const documentOrdinal =
      (this.#frameDocumentOrdinals.get(frame) ?? current.documentOrdinal) + 1;
    const updated: RecordedPageContext = {
      ...current,
      id,
      documentOrdinal,
      origin: canonical.origin,
      pathname: canonical.pathname,
      ...(title ? { titlePattern: titlePattern(title) } : {}),
      structuralFingerprint: await frameFingerprint(frame),
      expectedLandmark: frame.name() || title || "iframe",
      pageRole: sameOrigin ? "same-origin-frame" : "cross-origin-frame",
      sameOriginInspectable: sameOrigin,
      status: "active",
    };
    this.#nodes.set(previousId, { ...current, status: "replaced" });
    this.#nodes.set(id, updated);
    this.#frameIds.set(frame, id);
    this.#frameDocumentOrdinals.set(frame, documentOrdinal);
    this.#frames.set(id, frame);
    const token = await this.#documentTokenForFrame(frame);
    if (token) this.#documentTokens.set(token, id);
    this.#edges.push({
      from: previousId,
      to: id,
      relation: "navigated",
    });
    this.#emit({
      type: "navigation",
      context: updated,
      previousContextId: previousId,
    });
    return id;
  }

  async contextIdForPage(page: Page, documentToken?: string) {
    if (documentToken) {
      const recorded = this.#documentTokens.get(documentToken);
      if (recorded) return recorded;
    }
    const active = this.#activePageDocuments.get(page);
    if (!active) return this.registerPage(page);
    const node = this.#nodes.get(active);
    const canonical = safeCanonical(page.url());
    if (
      node &&
      (node.origin !== canonical.origin || node.pathname !== canonical.pathname)
    )
      return this.#navigatePage(page);
    return active;
  }

  async contextIdForFrame(frame: Frame, documentToken?: string) {
    if (documentToken) {
      const recorded = this.#documentTokens.get(documentToken);
      if (recorded) return recorded;
    }
    if (frame === frame.page().mainFrame())
      return this.contextIdForPage(frame.page(), documentToken);
    return this.#frameIds.get(frame) ?? this.ensureFrame(frame);
  }

  async #documentTokenForFrame(frame: Frame) {
    return frame
      .evaluate(() => {
        const scope = globalThis as typeof globalThis & {
          __vc2DocumentToken?: string;
        };
        return scope.__vc2DocumentToken;
      })
      .catch(() => undefined);
  }

  page(id: string) {
    return this.#pages.get(id);
  }

  frame(id: string) {
    return this.#frames.get(id);
  }

  node(id: string) {
    return this.#nodes.get(id);
  }

  async resolveLiveTargetRoot(
    recordedContextId: string,
    frameIdentity: DemonstratedTargetDescriptor["frame"],
  ): Promise<LiveTargetRootResolution> {
    if (frameIdentity.role === "main") {
      const original = this.#pages.get(recordedContextId);
      const originalCanonical =
        original && !original.isClosed() ? safeCanonical(original.url()) : null;
      if (
        original &&
        !original.isClosed() &&
        originalCanonical?.origin === frameIdentity.origin &&
        originalCanonical.pathname === frameIdentity.pathname
      ) {
        return {
          root: original,
          originalDomNodeReplaced: false,
          semanticEquivalentFound: false,
        };
      }
      const matches = this.context.pages().filter((page) => {
        if (page.isClosed()) return false;
        const canonical = safeCanonical(page.url());
        return (
          canonical.origin === frameIdentity.origin &&
          canonical.pathname === frameIdentity.pathname
        );
      });
      return {
        ...(matches.length === 1 ? { root: matches[0] } : {}),
        originalDomNodeReplaced: Boolean(original),
        semanticEquivalentFound: matches.length === 1,
      };
    }

    const original = this.#frames.get(recordedContextId);
    if (original && !original.isDetached()) {
      return {
        root: original,
        originalDomNodeReplaced: false,
        semanticEquivalentFound: false,
      };
    }
    const matches: Frame[] = [];
    for (const page of this.context.pages()) {
      if (page.isClosed()) continue;
      for (const frame of page.frames()) {
        if (frame === page.mainFrame() || frame.isDetached()) continue;
        const canonical = safeCanonical(frame.url());
        if (
          canonical.origin !== frameIdentity.origin ||
          canonical.pathname !== frameIdentity.pathname
        )
          continue;
        if (frameIdentity.name && frame.name() !== frameIdentity.name) continue;
        if (frameIdentity.title) {
          const currentTitle = await frame.title().catch(() => "");
          if (titlePattern(currentTitle) !== frameIdentity.title) continue;
        }
        matches.push(frame);
      }
    }
    return {
      ...(matches.length === 1 ? { root: matches[0] } : {}),
      originalDomNodeReplaced: Boolean(original),
      semanticEquivalentFound: matches.length === 1,
    };
  }

  data(): PageContextGraphData {
    return PageContextGraphSchema.parse({
      ...(this.#rootId ? { rootId: this.#rootId } : {}),
      nodes: [...this.#nodes.values()],
      edges: this.#edges,
    });
  }
}
