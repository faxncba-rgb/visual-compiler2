import type { BrowserContext, Dialog, Frame, Page } from "playwright";
import {
  DemonstrationSessionSchema,
  DemonstratedTargetSchema,
  RecordedActionSchema,
  type DemonstratedTarget,
  type DemonstrationSession,
  type ObservedEffect,
  type RecordedAction,
  type WorkflowVariable,
} from "../../demonstration-ir/src";
import type {
  PageContextGraph,
  PageGraphEvent,
} from "../../page-context-graph/src";
import { canonicalizeUrl, createId, sha256 } from "../../shared/src";

type BrowserTargetPayload = Omit<DemonstratedTarget, "frame" | "descriptor"> & {
  precedingLabels?: string[];
  relatedActionName?: string;
};

export type CapturedBrowserEvent = {
  kind:
    | "click"
    | "double-click"
    | "fill"
    | "select"
    | "check"
    | "uncheck"
    | "keyboard"
    | "submit"
    | "focus";
  target?: BrowserTargetPayload;
  value?: string;
  key?: string;
  occurredAt: number;
};

type MutableSession = Omit<DemonstrationSession, "actions" | "variables"> & {
  actions: RecordedAction[];
  variables: WorkflowVariable[];
};

export type RecorderStatus = {
  attached: boolean;
  active: boolean;
  actionCount: number;
  passwordEventsExcluded: number;
  crossOriginEventsExcluded: number;
  bindingErrors: string[];
};

const RECORDER_INIT_SCRIPT = `(() => {
  if (document.__vc2RecorderInstalled) return;
  Object.defineProperty(document, '__vc2RecorderInstalled', { value: true });
  globalThis.__vc2RecorderInstalled = true;
  const pendingInputs = new WeakMap();
  const text = value => String(value || '').replace(/\\s+/g, ' ').trim();
  const role = element => {
    const explicit = element.getAttribute('role');
    if (explicit) return explicit;
    const tag = element.tagName.toLowerCase();
    if (tag === 'textarea') return 'textbox';
    if (tag === 'select') return 'combobox';
    if (tag === 'button') return 'button';
    if (tag === 'a' && (element.href || element.onclick)) return 'link';
    if (element.isContentEditable) return 'textbox';
    if (tag === 'input') {
      const type = (element.type || 'text').toLowerCase();
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      if (['button','submit','reset'].includes(type)) return 'button';
      return 'textbox';
    }
    return undefined;
  };
  const label = element => {
    if (element.labels?.length) return text(Array.from(element.labels).map(node => node.textContent).join(' '));
    const labelledBy = element.getAttribute('aria-labelledby');
    if (labelledBy) return text(labelledBy.split(/\\s+/).map(id => document.getElementById(id)?.textContent).join(' '));
    return text(element.getAttribute('aria-label'));
  };
  const accessibleName = element => label(element) || text(element.getAttribute('aria-label')) ||
    text(element.getAttribute('title')) || (['BUTTON','A'].includes(element.tagName) ? text(element.textContent) : '');
  const relationText = element => {
    if (!element || element.matches('input,textarea,select,[contenteditable=true]')) return undefined;
    if (!element.matches('label,h1,h2,h3,h4,button,a,[role=heading]')) return undefined;
    return text(element.textContent).slice(0, 120) || undefined;
  };
  const cssPath = element => {
    const parts = [];
    let current = element;
    while (current && current.nodeType === 1 && parts.length < 7) {
      const tag = current.tagName.toLowerCase();
      const parent = current.parentElement;
      if (!parent) { parts.unshift(tag); break; }
      const peers = Array.from(parent.children).filter(node => node.tagName === current.tagName);
      const index = peers.indexOf(current) + 1;
      parts.unshift(peers.length > 1 ? tag + ':nth-of-type(' + index + ')' : tag);
      current = parent;
    }
    return parts.join(' > ');
  };
  const hash = value => {
    let result = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      result ^= value.charCodeAt(index);
      result = Math.imul(result, 16777619);
    }
    return 'fnv1a-' + (result >>> 0).toString(16).padStart(8, '0');
  };
  const target = element => {
    if (!(element instanceof Element)) return undefined;
    const inputType = element instanceof HTMLInputElement ? element.type : undefined;
    if (inputType?.toLowerCase() === 'password') return { password: true };
    const container = element.closest('section,form,article,[role=dialog],[role=region]');
    const heading = container?.querySelector('h1,h2,h3,[role=heading]');
    const parent = element.parentElement;
    const box = element.getBoundingClientRect();
    const stableNames = ['name','aria-label','title','placeholder','data-vc-field','data-vc-action','data-vc-editor','data-vc-backing'];
    const stableAttributes = {};
    for (const name of stableNames) {
      const value = element.getAttribute(name);
      if (value && !/(token|secret|patient|session)/i.test(name)) stableAttributes[name] = value.slice(0, 160);
    }
    const nearby = Array.from((container || document).querySelectorAll('label,h1,h2,h3,th'))
      .filter(node => {
        const candidate = node.getBoundingClientRect();
        return candidate.width > 0 && candidate.height > 0 && Math.abs(candidate.top - box.top) < 180;
      }).slice(0, 8).map(node => text(node.textContent)).filter(Boolean);
    const precedingLabels = Array.from(document.querySelectorAll('label,h1,h2,h3,th'))
      .filter(node => node.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING)
      .slice(-8).map(node => text(node.textContent)).filter(Boolean);
    const relatedActionName = text(
      (element.closest('form,section,article,[role=dialog],[role=region]') || document)
        .querySelector('button,[role=button],a[data-vc-action]')?.textContent
    ) || undefined;
    const semantic = container ? {
      tag: container.tagName.toLowerCase(),
      heading: text(heading?.textContent) || undefined,
      landmark: container.getAttribute('role') || undefined,
      fingerprint: hash(container.tagName + '|' + text(heading?.textContent) + '|' + container.children.length)
    } : undefined;
    const signature = [
      element.tagName.toLowerCase(), role(element), accessibleName(element), label(element),
      element.getAttribute('name'), semantic?.heading, cssPath(element)
    ].join('|');
    const allElements = Array.from(document.querySelectorAll('*'));
    const targetRole = role(element);
    const targetName = accessibleName(element);
    const targetLabel = label(element);
    const stableProbe = element.getAttribute('data-vc-field') || element.getAttribute('data-vc-action') || element.getAttribute('name');
    return {
      fingerprint: hash(signature),
      tag: element.tagName.toLowerCase(),
      role: role(element),
      accessibleName: accessibleName(element) || undefined,
      associatedLabel: label(element) || undefined,
      inputType,
      editable: !element.hasAttribute('readonly') && !element.hasAttribute('disabled') &&
        (element.matches('input:not([type=hidden]),textarea,select') || element.isContentEditable),
      readonly: element.hasAttribute('readonly'),
      visible: box.width > 0 && box.height > 0,
      enabled: !element.hasAttribute('disabled'),
      formName: element.closest('form')?.getAttribute('name') || undefined,
      semanticContainer: semantic,
      parent: parent ? { tag: parent.tagName.toLowerCase(), role: role(parent), accessibleName: accessibleName(parent) || undefined } : undefined,
      previousSibling: relationText(element.previousElementSibling),
      nextSibling: relationText(element.nextElementSibling),
      nearbyVisibleLabels: nearby,
      boundingBox: { x: box.x, y: box.y, width: box.width, height: box.height },
      rowColumnEvidence: nearby.slice(0, 3).map(value => ({ relation: 'same-row', text: value })),
      precedingLabels,
      relatedActionName,
      stableAttributes,
      unstableAttributes: ['id','class'],
      structuralPath: cssPath(element),
      beforeFingerprint: hash(signature + '|' + element.getAttribute('aria-expanded') + '|' + element.getAttribute('aria-checked')),
      editorAdapter: element.dataset?.vcEditor === 'legacy-facade' ? 'legacy-facade' :
        element.isContentEditable ? 'contenteditable' : 'playwright-fill',
      backingFieldSelector: element.dataset?.vcBacking || undefined,
      captureValidation: {
        exactTargetConnected: true,
        roleNameMatchCount: targetRole && targetName ? allElements.filter(node => role(node) === targetRole && accessibleName(node) === targetName).length : 0,
        labelMatchCount: targetLabel ? allElements.filter(node => label(node) === targetLabel).length : 0,
        stableAttributeMatchCount: stableProbe ? allElements.filter(node =>
          node.getAttribute('data-vc-field') === stableProbe ||
          node.getAttribute('data-vc-action') === stableProbe ||
          node.getAttribute('name') === stableProbe
        ).length : 0
      }
    };
  };
  const send = payload => {
    try { void globalThis.__vc2Record(payload); } catch {}
  };
  document.addEventListener('click', event => {
    const element = event.target?.closest?.('button,a,input,select,textarea,[contenteditable=true],[role=button],[role=textbox]');
    if (!element) return;
    const info = target(element);
    if (info?.password) return;
    const type = element instanceof HTMLInputElement ? element.type : '';
    const kind = type === 'checkbox' ? (element.checked ? 'check' : 'uncheck') : 'click';
    send({ kind, target: info, occurredAt: Date.now() });
  }, true);
  document.addEventListener('dblclick', event => {
    const info = target(event.target);
    if (!info?.password) send({ kind: 'double-click', target: info, occurredAt: Date.now() });
  }, true);
  document.addEventListener('input', event => {
    const element = event.target;
    const info = target(element);
    if (!info || info.password) return;
    const existing = pendingInputs.get(element);
    if (existing) clearTimeout(existing);
    pendingInputs.set(element, setTimeout(() => {
      const value = element.isContentEditable ? element.textContent : element.value;
      send({ kind: 'fill', target: info, value, occurredAt: Date.now() });
    }, 300));
  }, true);
  document.addEventListener('change', event => {
    const element = event.target;
    const info = target(element);
    if (!info || info.password) return;
    const value = element.value;
    const kind = element.tagName === 'SELECT' ? 'select' : 'fill';
    send({ kind, target: info, value, occurredAt: Date.now() });
  }, true);
  document.addEventListener('keydown', event => {
    if (!['Enter','Escape','Tab','ArrowDown','ArrowUp'].includes(event.key)) return;
    const info = target(event.target);
    if (!info?.password) send({ kind: 'keyboard', target: info, key: event.key, occurredAt: Date.now() });
  }, true);
  document.addEventListener('submit', event => {
    const info = target(event.submitter || event.target);
    if (!info?.password) send({ kind: 'submit', target: info, occurredAt: Date.now() });
  }, true);
  globalThis.addEventListener('focus', () => send({ kind: 'focus', occurredAt: Date.now() }));
})();`;

export function shouldExcludeFrame(frame: Frame) {
  try {
    const frameOrigin = new URL(frame.url()).origin;
    const pageOrigin = new URL(frame.page().url()).origin;
    return frame !== frame.page().mainFrame() && frameOrigin !== pageOrigin;
  } catch {
    return frame !== frame.page().mainFrame();
  }
}

export function variableNameForTarget(target: BrowserTargetPayload) {
  const evidence = [
    target.associatedLabel,
    target.accessibleName,
    target.stableAttributes.name,
    target.stableAttributes["data-vc-field"],
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (/date/.test(evidence)) return "date";
  if (/heure|time/.test(evidence)) return "time";
  if (/option|decision|select/.test(evidence)) return "selected_option";
  if (/consultation|observation|editor/.test(evidence))
    return "consultation_text";
  return `field_${target.fingerprint
    .replace(/[^a-z0-9]/gi, "")
    .slice(-8)
    .toLowerCase()}`;
}

function controlFamilyForTarget(target: BrowserTargetPayload) {
  const tag = target.tag.toLowerCase();
  const role = target.role?.toLowerCase();
  const inputType = target.inputType?.toLowerCase();
  if (
    tag === "textarea" ||
    target.editorAdapter === "contenteditable" ||
    target.editorAdapter === "legacy-facade"
  )
    return "multiline-text" as const;
  if (tag === "select" || role === "combobox" || role === "listbox")
    return "selection" as const;
  if (
    ["checkbox", "radio"].includes(inputType ?? "") ||
    ["checkbox", "radio", "switch"].includes(role ?? "")
  )
    return "toggle" as const;
  if (tag === "button" || role === "button") return "button" as const;
  if (tag === "a" || role === "link") return "link" as const;
  if (tag === "input" || role === "textbox") return "single-line-text" as const;
  return "other" as const;
}

async function frameHostEvidence(frame: Frame) {
  if (frame === frame.page().mainFrame()) return undefined;
  const frameElement = await frame.frameElement();
  return frameElement
    .evaluate((element) => {
      const host = element as Element;
      const normalize = (value: string | null | undefined) =>
        String(value ?? "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 120);
      const container = host.closest(
        "section,form,article,[role=dialog],[role=region]",
      );
      const heading = container?.querySelector("h1,h2,h3,[role=heading]");
      const labelRoot: ParentNode = container ?? document;
      const labels = Array.from(
        labelRoot.querySelectorAll<Element>("label,h1,h2,h3,th"),
      )
        .map((node) => normalize(node.textContent))
        .filter(Boolean)
        .slice(0, 8);
      const precedingLabels = Array.from(
        document.querySelectorAll("label,h1,h2,h3,th"),
      )
        .filter((node) =>
          Boolean(
            node.compareDocumentPosition(host) &
              Node.DOCUMENT_POSITION_FOLLOWING,
          ),
        )
        .slice(-8)
        .map((node) => normalize(node.textContent))
        .filter(Boolean);
      const action = container?.querySelector(
        "button,[role=button],a[data-vc-action]",
      );
      return {
        formName: host.closest("form")?.getAttribute("name") || undefined,
        semanticContainer: container
          ? {
              tag: container.tagName.toLowerCase(),
              heading: normalize(heading?.textContent) || undefined,
              landmark: container.getAttribute("role") || undefined,
            }
          : undefined,
        labels,
        precedingLabels,
        relatedActionName: normalize(action?.textContent) || undefined,
      };
    })
    .catch(() => undefined);
}

export function deduplicateAction(
  actions: RecordedAction[],
  candidate: RecordedAction,
  windowMs = 850,
) {
  const previous = actions.at(-1);
  if (["fill", "select"].includes(candidate.action)) {
    let earlierInputIndex = -1;
    for (let index = actions.length - 1; index >= 0; index -= 1) {
      const action = actions[index]!;
      if (
        action.action === candidate.action &&
        action.pageContextId === candidate.pageContextId &&
        action.target?.fingerprint === candidate.target?.fingerprint &&
        action.valueRef === candidate.valueRef &&
        Math.abs(action.timestampOffsetMs - candidate.timestampOffsetMs) <=
          windowMs
      ) {
        earlierInputIndex = index;
        break;
      }
    }
    if (earlierInputIndex >= 0 && earlierInputIndex !== actions.length - 1)
      return "replaced" as const;
  }
  if (
    previous &&
    previous.action === candidate.action &&
    previous.pageContextId === candidate.pageContextId &&
    previous.target?.fingerprint === candidate.target?.fingerprint &&
    Math.abs(previous.timestampOffsetMs - candidate.timestampOffsetMs) <=
      windowMs
  ) {
    actions[actions.length - 1] = candidate;
    return "replaced" as const;
  }
  actions.push(candidate);
  return "added" as const;
}

function pageLabel(role: string) {
  if (role === "popup") return "Validation popup";
  if (role === "frame") return "Editor frame";
  return "Main page";
}

function actionLabel(
  kind: CapturedBrowserEvent["kind"],
  target?: BrowserTargetPayload,
) {
  const name =
    target?.associatedLabel ??
    target?.accessibleName ??
    target?.semanticContainer?.heading ??
    target?.tag ??
    "page";
  const verb: Record<CapturedBrowserEvent["kind"], string> = {
    click: "clicked",
    "double-click": "double-clicked",
    fill: "filled",
    select: "selected",
    check: "checked",
    uncheck: "unchecked",
    keyboard: "used keyboard on",
    submit: "submitted",
    focus: "focused",
  };
  return `${verb[kind]} ${name}`;
}

export class DemonstrationRecorder {
  #attached = false;
  #active = false;
  #session: MutableSession | undefined;
  #startedAtMs = 0;
  #localValues = new Map<string, string>();
  #passwordEventsExcluded = 0;
  #crossOriginEventsExcluded = 0;
  #bindingErrors: string[] = [];
  #nextDialogResponse: "accepted" | "dismissed" = "accepted";
  readonly #dialogHandlers = new Map<Page, (dialog: Dialog) => Promise<void>>();
  readonly #wiredRecorderPages = new WeakSet<Page>();

  constructor(
    private readonly context: BrowserContext,
    private readonly graph: PageContextGraph,
  ) {}

  get session() {
    if (!this.#session) throw new Error("No demonstration session exists.");
    return DemonstrationSessionSchema.parse(this.#session);
  }

  get localValues() {
    return Object.fromEntries(this.#localValues);
  }

  status(): RecorderStatus {
    return {
      attached: this.#attached,
      active: this.#active,
      actionCount: this.#session?.actions.length ?? 0,
      passwordEventsExcluded: this.#passwordEventsExcluded,
      crossOriginEventsExcluded: this.#crossOriginEventsExcluded,
      bindingErrors: [...this.#bindingErrors],
    };
  }

  async attach() {
    if (this.#attached) return;
    this.#attached = true;
    await this.context.exposeBinding(
      "__vc2Record",
      async (source, payload: CapturedBrowserEvent) => {
        try {
          await this.#handleBrowserEvent(source.frame, payload);
        } catch (error) {
          this.#bindingErrors.push(
            error instanceof Error ? error.message : String(error),
          );
        }
      },
    );
    await this.context.addInitScript({ content: RECORDER_INIT_SCRIPT });
    this.graph.onEvent((event) => this.#handleGraphEvent(event));
    this.context.on("page", (page) => this.#wirePage(page));
    for (const page of this.context.pages()) {
      this.#wirePage(page);
      for (const frame of page.frames()) {
        await frame.evaluate(RECORDER_INIT_SCRIPT).catch(() => undefined);
      }
    }
  }

  #wirePage(page: Page) {
    this.#wireDialog(page);
    if (this.#wiredRecorderPages.has(page)) return;
    this.#wiredRecorderPages.add(page);
    void page
      .addInitScript({ content: RECORDER_INIT_SCRIPT })
      .catch(() => undefined);
    page.on("framenavigated", (frame) => {
      void frame.evaluate(RECORDER_INIT_SCRIPT).catch(() => undefined);
    });
    page.on("domcontentloaded", () => {
      void page.evaluate(RECORDER_INIT_SCRIPT).catch(() => undefined);
    });
  }

  #wireDialog(page: Page) {
    if (!this.#active || this.#dialogHandlers.has(page)) return;
    const handler = async (dialog: Dialog) => this.#handleDialog(page, dialog);
    this.#dialogHandlers.set(page, handler);
    page.on("dialog", handler);
  }

  #unwireDialogs() {
    for (const [page, handler] of this.#dialogHandlers) {
      page.off("dialog", handler);
    }
    this.#dialogHandlers.clear();
  }

  async start() {
    if (!this.#attached) await this.attach();
    if (this.#active) throw new Error("Teaching is already active.");
    const now = new Date();
    const graph = this.graph.data();
    this.#startedAtMs = now.getTime();
    this.#localValues.clear();
    this.#session = {
      id: createId("demo"),
      startedAt: now.toISOString(),
      pages: graph.nodes,
      pageGraph: graph,
      actions: [],
      variables: [],
      beforeState: await this.#snapshot(),
      authenticationExcluded: true,
    };
    this.#active = true;
    for (const page of this.context.pages()) this.#wireDialog(page);
    return this.session;
  }

  async stop() {
    if (!this.#active || !this.#session)
      throw new Error("Teaching is not active.");
    await new Promise((resolve) => setTimeout(resolve, 360));
    this.#active = false;
    this.#unwireDialogs();
    this.#session.stoppedAt = new Date().toISOString();
    this.#session.pageGraph = this.graph.data();
    this.#session.pages = this.#session.pageGraph.nodes;
    this.#session.afterState = await this.#snapshot();
    this.#session.actions.sort(
      (left, right) => left.timestampOffsetMs - right.timestampOffsetMs,
    );
    await this.#captureOutcomeEvidence();
    return this.session;
  }

  async #snapshot() {
    const page = this.context
      .pages()
      .find((candidate) => !candidate.isClosed());
    if (!page) return undefined;
    const pageContextId = await this.graph.contextIdForPage(page);
    const landmarks = await page
      .locator("h1,h2,[role=status],[role=main]")
      .allTextContents()
      .catch(() => []);
    const visibleLandmarks = landmarks
      .map((value) => value.replaceAll(/\s+/g, " ").trim())
      .filter(Boolean)
      .slice(0, 20);
    return {
      pageContextId,
      fingerprint: sha256(JSON.stringify(visibleLandmarks)),
      visibleLandmarks,
      capturedAt: new Date().toISOString(),
    };
  }

  async #captureOutcomeEvidence() {
    if (!this.#session) return;
    for (const page of this.context.pages()) {
      if (page.isClosed()) continue;
      const success = page
        .locator('[data-vc-outcome="success"]:visible')
        .first();
      if ((await success.count()) === 0) continue;
      const value = (await success.innerText()).replaceAll(/\s+/g, " ").trim();
      const pageContextId = await this.graph.contextIdForPage(page);
      const observedEffects: ObservedEffect[] = [
        {
          type: "success-visible",
          pageContextId,
          fingerprint: sha256(value),
          description: value,
        },
      ];
      this.#session.actions.push(
        RecordedActionSchema.parse({
          id: createId("action"),
          pageContextId,
          action: "assert",
          name: `${pageLabel(this.graph.node(pageContextId)?.role ?? "main")} — success state observed`,
          observedEffects,
          timestampOffsetMs: Date.now() - this.#startedAtMs,
          optional: false,
        }),
      );
    }
  }

  async #handleBrowserEvent(frame: Frame, payload: CapturedBrowserEvent) {
    if (!this.#active || !this.#session) return;
    if (shouldExcludeFrame(frame)) {
      this.#crossOriginEventsExcluded += 1;
      return;
    }
    if (payload.target?.inputType?.toLowerCase() === "password") {
      this.#passwordEventsExcluded += 1;
      return;
    }
    const pageContextId = await this.graph.contextIdForFrame(frame);
    const graphNode = this.graph.node(pageContextId);
    const hostEvidence = payload.target
      ? await frameHostEvidence(frame)
      : undefined;
    const targetFamily = payload.target
      ? controlFamilyForTarget(payload.target)
      : undefined;
    const target = payload.target
      ? DemonstratedTargetSchema.parse({
          ...payload.target,
          frame: {
            role: frame === frame.page().mainFrame() ? "main" : "same-origin",
            name: frame.name() || undefined,
            title: graphNode?.titlePattern,
            origin: graphNode?.origin ?? canonicalizeUrl(frame.url()).origin,
            pathname:
              graphNode?.pathname ?? canonicalizeUrl(frame.url()).pathname,
            structuralFingerprint:
              graphNode?.structuralFingerprint ?? sha256(frame.url()),
          },
          descriptor: {
            controlFamily: targetFamily,
            multiline: targetFamily === "multiline-text",
            editable: payload.target.editable,
            actionCompatibility: [payload.kind],
            tag: payload.target.tag,
            role: payload.target.role,
            accessibleName: payload.target.accessibleName,
            associatedLabel: payload.target.associatedLabel,
            formName: payload.target.formName,
            hostFormName: hostEvidence?.formName,
            semanticContainer: payload.target.semanticContainer
              ? {
                  tag: payload.target.semanticContainer.tag,
                  heading: payload.target.semanticContainer.heading,
                  landmark: payload.target.semanticContainer.landmark,
                }
              : hostEvidence?.semanticContainer,
            neighboringLabels: [
              ...new Set([
                ...payload.target.nearbyVisibleLabels,
                ...(hostEvidence?.labels ?? []),
              ]),
            ].slice(0, 8),
            precedingLabels: [
              ...new Set([
                ...(hostEvidence?.precedingLabels ?? []),
                ...(payload.target.precedingLabels ?? []),
              ]),
            ].slice(-8),
            relatedActionName:
              payload.target.relatedActionName ??
              hostEvidence?.relatedActionName,
            frame: {
              role: frame === frame.page().mainFrame() ? "main" : "same-origin",
              name: frame.name() || undefined,
              title: graphNode?.titlePattern,
              origin: graphNode?.origin ?? canonicalizeUrl(frame.url()).origin,
              pathname:
                graphNode?.pathname ?? canonicalizeUrl(frame.url()).pathname,
            },
          },
        })
      : undefined;
    let valueRef: string | undefined;
    if (
      target &&
      payload.value !== undefined &&
      ["fill", "select"].includes(payload.kind)
    ) {
      const name = variableNameForTarget(payload.target!);
      valueRef = `{{${name}}}`;
      this.#localValues.set(name, payload.value);
      if (!this.#session.variables.some((variable) => variable.name === name)) {
        this.#session.variables.push({
          id: createId("variable"),
          name,
          valueType: payload.kind === "select" ? "option" : "string",
          privacy: "local-variable",
          required: true,
          description: `Local value demonstrated for ${target.associatedLabel ?? target.accessibleName ?? target.tag}`,
        });
      }
    }
    const recorded = RecordedActionSchema.parse({
      id: createId("action"),
      pageContextId,
      action: payload.kind,
      name: `${pageLabel(graphNode?.role ?? "main")} — ${actionLabel(payload.kind, payload.target)}`,
      ...(target ? { target } : {}),
      ...(valueRef ? { valueRef } : {}),
      ...(payload.key ? { key: payload.key } : {}),
      observedEffects: [],
      timestampOffsetMs: Math.max(0, payload.occurredAt - this.#startedAtMs),
      optional: false,
    });
    deduplicateAction(this.#session.actions, recorded);
  }

  #handleGraphEvent(event: PageGraphEvent) {
    if (!this.#active || !this.#session) return;
    this.#session.pageGraph = this.graph.data();
    this.#session.pages = this.#session.pageGraph.nodes;
    const timestampOffsetMs = Math.max(0, Date.now() - this.#startedAtMs);
    if (event.type === "page-open" && event.context.role === "popup") {
      this.#session.actions.push(
        RecordedActionSchema.parse({
          id: createId("action"),
          pageContextId: event.context.id,
          action: "popup-open",
          name: "Validation popup — opened",
          observedEffects: [
            {
              type: "popup-opened",
              pageContextId: event.context.id,
              description: "Popup opened from the demonstrated action.",
            },
          ],
          timestampOffsetMs,
          optional: false,
        }),
      );
    } else if (event.type === "page-close" && event.context.role === "popup") {
      this.#session.actions.push(
        RecordedActionSchema.parse({
          id: createId("action"),
          pageContextId: event.context.id,
          action: "popup-close",
          name: "Validation popup — closed",
          observedEffects: [
            {
              type: "popup-closed",
              pageContextId: event.context.id,
              description: "Popup closed and focus returned to its opener.",
            },
          ],
          timestampOffsetMs,
          optional: false,
        }),
      );
    } else if (event.type === "navigation") {
      this.#session.actions.push(
        RecordedActionSchema.parse({
          id: createId("action"),
          pageContextId: event.context.id,
          action: "navigation",
          name: `${pageLabel(event.context.role)} — navigated`,
          observedEffects: [
            {
              type: "navigation",
              pageContextId: event.context.id,
              fingerprint: event.context.structuralFingerprint,
              description: `${event.context.origin}${event.context.pathname}`,
            },
          ],
          timestampOffsetMs,
          optional: false,
        }),
      );
    }
  }

  async #handleDialog(page: Page, dialog: Dialog) {
    const response = this.#nextDialogResponse;
    this.#nextDialogResponse = "accepted";
    if (this.#active && this.#session) {
      const pageContextId = await this.graph.contextIdForPage(page);
      this.#session.actions.push(
        RecordedActionSchema.parse({
          id: createId("action"),
          pageContextId,
          action: "dialog",
          name: `Main page — ${response} ${dialog.type()} dialog`,
          dialog: { type: dialog.type(), response },
          observedEffects: [
            {
              type: "dialog-opened",
              pageContextId,
              description: `${dialog.type()} dialog handled locally.`,
            },
          ],
          timestampOffsetMs: Math.max(0, Date.now() - this.#startedAtMs),
          optional: false,
        }),
      );
    }
    if (response === "accepted") await dialog.accept();
    else await dialog.dismiss();
  }

  setNextDialogResponse(response: "accepted" | "dismissed") {
    this.#nextDialogResponse = response;
  }

  renameAction(actionId: string, name: string) {
    const action = this.#session?.actions.find(
      (candidate) => candidate.id === actionId,
    );
    if (!action) throw new Error(`Unknown action ${actionId}.`);
    action.name = name.trim();
  }

  deleteAction(actionId: string) {
    if (!this.#session) throw new Error("No demonstration session exists.");
    this.#session.actions = this.#session.actions.filter(
      (candidate) => candidate.id !== actionId,
    );
  }

  setActionOptional(actionId: string, optional: boolean) {
    const action = this.#session?.actions.find(
      (candidate) => candidate.id === actionId,
    );
    if (!action) throw new Error(`Unknown action ${actionId}.`);
    action.optional = optional;
  }

  setVariablePrivacy(name: string, privacy: WorkflowVariable["privacy"]) {
    const variable = this.#session?.variables.find(
      (candidate) => candidate.name === name,
    );
    if (!variable) throw new Error(`Unknown variable ${name}.`);
    variable.privacy = privacy;
  }
}

declare global {
  var __vc2RecorderInstalled: boolean | undefined;
  var __vc2Record:
    | ((payload: CapturedBrowserEvent) => Promise<void>)
    | undefined;
}
