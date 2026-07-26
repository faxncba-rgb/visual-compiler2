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
  | { type: "navigation"; context: RecordedPageContext }
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
  readonly #frameIds = new WeakMap<Frame, string>();
  readonly #pageRegistrations = new WeakMap<Page, Promise<string>>();
  readonly #frameRegistrations = new WeakMap<Frame, Promise<string>>();
  readonly #pages = new Map<string, Page>();
  readonly #frames = new Map<string, Frame>();
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
    this.context.on("page", (page) => void this.registerPage(page));
    for (const page of this.context.pages()) await this.registerPage(page);
  }

  async registerPage(page: Page) {
    const existing = this.#pageIds.get(page);
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
    const id = createId("page");
    const canonical = safeCanonical(page.url());
    const role = !this.#rootId ? "main" : openerId ? "popup" : "tab";
    const title = await page.title().catch(() => "");
    const node: RecordedPageContext = {
      id,
      role,
      ...(openerId ? { parentId: openerId } : {}),
      origin: canonical.origin,
      pathname: canonical.pathname,
      ...(title ? { titlePattern: titlePattern(title) } : {}),
      structuralFingerprint: await pageFingerprint(page),
      pageRole: role === "main" ? "main-application" : role,
      sameOriginInspectable: true,
      status: "open",
    };
    if (!this.#rootId) this.#rootId = id;
    this.#pageIds.set(page, id);
    this.#pages.set(id, page);
    this.#nodes.set(id, node);
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

  #wirePage(page: Page, id: string) {
    page.on("close", () => {
      const current = this.#nodes.get(id);
      if (!current) return;
      const closed = { ...current, status: "closed" as const };
      this.#nodes.set(id, closed);
      this.#emit({ type: "page-close", context: closed });
      if (current.parentId) {
        this.#edges.push({
          from: id,
          to: current.parentId,
          relation: "focus-return",
        });
      }
    });
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) void this.updatePage(page);
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

  async updatePage(page: Page) {
    const id = this.#pageIds.get(page) ?? (await this.registerPage(page));
    const current = this.#nodes.get(id);
    if (!current) return id;
    const canonical = safeCanonical(page.url());
    const title = await page.title().catch(() => "");
    const updated: RecordedPageContext = {
      ...current,
      origin: canonical.origin,
      pathname: canonical.pathname,
      ...(title ? { titlePattern: titlePattern(title) } : {}),
      structuralFingerprint: await pageFingerprint(page),
    };
    this.#nodes.set(id, updated);
    this.#emit({ type: "navigation", context: updated });
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
    const id = createId("frame");
    const canonical = safeCanonical(frame.url());
    const pageCanonical = safeCanonical(page.url());
    const sameOrigin = canonical.origin === pageCanonical.origin;
    const title = await frame.title().catch(() => "");
    const node: RecordedPageContext = {
      id,
      role: "frame",
      parentId,
      origin: canonical.origin,
      pathname: canonical.pathname,
      ...(title ? { titlePattern: titlePattern(title) } : {}),
      structuralFingerprint: await frameFingerprint(frame),
      expectedLandmark: frame.name() || title || "iframe",
      pageRole: sameOrigin ? "same-origin-frame" : "cross-origin-frame",
      sameOriginInspectable: sameOrigin,
      status: "open",
    };
    this.#frameIds.set(frame, id);
    this.#frames.set(id, frame);
    this.#nodes.set(id, node);
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
    const id = this.#frameIds.get(frame) ?? (await this.ensureFrame(frame));
    const current = this.#nodes.get(id);
    if (!current) return id;
    const page = frame.page();
    const canonical = safeCanonical(frame.url());
    const pageCanonical = safeCanonical(page.url());
    const sameOrigin = canonical.origin === pageCanonical.origin;
    const title = await frame.title().catch(() => "");
    const updated: RecordedPageContext = {
      ...current,
      origin: canonical.origin,
      pathname: canonical.pathname,
      ...(title ? { titlePattern: titlePattern(title) } : {}),
      structuralFingerprint: await frameFingerprint(frame),
      expectedLandmark: frame.name() || title || "iframe",
      pageRole: sameOrigin ? "same-origin-frame" : "cross-origin-frame",
      sameOriginInspectable: sameOrigin,
    };
    this.#nodes.set(id, updated);
    this.#emit({ type: "navigation", context: updated });
    return id;
  }

  async contextIdForPage(page: Page) {
    return this.#pageIds.get(page) ?? this.registerPage(page);
  }

  async contextIdForFrame(frame: Frame) {
    if (frame === frame.page().mainFrame())
      return this.contextIdForPage(frame.page());
    return this.#frameIds.get(frame) ?? this.ensureFrame(frame);
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
      if (original && !original.isClosed()) {
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
