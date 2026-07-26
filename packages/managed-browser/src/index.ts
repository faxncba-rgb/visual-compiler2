import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  chromium,
  type BrowserContext,
  type Page,
  type Route,
} from "playwright";
import { PageContextGraph } from "../../page-context-graph/src";
import { isOpenAIUrl, redactUrl } from "../../shared/src";

export type ManagedBrowserOptions = {
  profileDirectory: string;
  headless?: boolean;
  slowMo?: number;
};

export type BrowserStatus = {
  open: boolean;
  headless: boolean;
  authenticationMode: "manual";
  currentUrl?: string;
  pages: number;
  blockedOpenAIAttempts: number;
};

export class ManagedBrowser {
  #context: BrowserContext | undefined;
  #graph: PageContextGraph | undefined;
  #mainPage: Page | undefined;
  #blockedOpenAIAttempts = 0;

  constructor(private readonly options: ManagedBrowserOptions) {}

  get context() {
    if (!this.#context) throw new Error("Managed browser is not open.");
    return this.#context;
  }

  get graph() {
    if (!this.#graph) throw new Error("Page Context Graph is not initialized.");
    return this.#graph;
  }

  get mainPage() {
    if (!this.#mainPage || this.#mainPage.isClosed())
      throw new Error("Managed browser main page is not available.");
    return this.#mainPage;
  }

  get blockedOpenAIAttempts() {
    return this.#blockedOpenAIAttempts;
  }

  async open(initialUrl: string) {
    if (this.#context) return this.#mainPage;
    await mkdir(path.resolve(this.options.profileDirectory), {
      recursive: true,
    });
    const context = await chromium.launchPersistentContext(
      path.resolve(this.options.profileDirectory),
      {
        headless: this.options.headless ?? false,
        ...(this.options.slowMo !== undefined
          ? { slowMo: this.options.slowMo }
          : {}),
        serviceWorkers: "block",
        viewport: { width: 1380, height: 900 },
        args: ["--disable-background-networking"],
      },
    );
    this.#context = context;
    await context.route("**/*", (route) => this.#guardRoute(route));
    await context.routeWebSocket(
      (url) => isOpenAIUrl(url.toString()),
      async (webSocket) => {
        this.#blockedOpenAIAttempts += 1;
        await webSocket.close({
          code: 1008,
          reason: "OpenAI WebSocket blocked in deterministic runtime.",
        });
      },
    );
    const graph = new PageContextGraph(context);
    this.#graph = graph;
    await graph.start();
    const pages = context.pages();
    const firstPage =
      pages.find((page) => !page.isClosed()) ?? (await context.newPage());
    this.#mainPage = firstPage;
    await firstPage.goto(initialUrl, { waitUntil: "domcontentloaded" });
    await graph.updatePage(firstPage);
    return firstPage;
  }

  async #guardRoute(route: Route) {
    const requestUrl = route.request().url();
    if (isOpenAIUrl(requestUrl)) {
      this.#blockedOpenAIAttempts += 1;
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  }

  async navigate(url: string) {
    await this.mainPage.goto(url, { waitUntil: "domcontentloaded" });
    await this.graph.updatePage(this.mainPage);
  }

  async focusContext(contextId: string) {
    const page = this.graph.page(contextId);
    if (!page || page.isClosed())
      throw new Error(`Page context ${contextId} is closed.`);
    await page.bringToFront();
    return page;
  }

  status(): BrowserStatus {
    const pages =
      this.#context?.pages().filter((page) => !page.isClosed()) ?? [];
    return {
      open: Boolean(this.#context),
      headless: this.options.headless ?? false,
      authenticationMode: "manual",
      ...(this.#mainPage && !this.#mainPage.isClosed()
        ? { currentUrl: redactUrl(this.#mainPage.url()) }
        : {}),
      pages: pages.length,
      blockedOpenAIAttempts: this.#blockedOpenAIAttempts,
    };
  }

  async close() {
    const context = this.#context;
    this.#context = undefined;
    this.#graph = undefined;
    this.#mainPage = undefined;
    if (context) await context.close();
  }
}
