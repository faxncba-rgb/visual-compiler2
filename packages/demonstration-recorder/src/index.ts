import type { BrowserContext, Dialog, Frame, Page } from "playwright";
import {
  ApplicationOutcomeCandidateSchema,
  ApplicationStateSchema,
  DemonstrationSessionSchema,
  DemonstratedTargetSchema,
  EffectReconciliationSchema,
  RecordedActionSchema,
  type ApplicationOutcomeCandidate,
  type ApplicationState,
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
  normalizedStaticText?: string;
  hasOnclick?: boolean;
  rawTargetPromoted?: boolean;
};

type RawApplicationState = {
  historyCount?: number;
  editorPresent: boolean;
  editorEmpty?: boolean;
  successMarkerVisible: boolean;
  errorMarkerVisible: boolean;
  origin: string;
  pathname: string;
  stableFieldFingerprints: Record<string, string>;
};

export type ActionableNodeEvidence = {
  tag: string;
  role?: string;
  href?: boolean;
  hasOnclick?: boolean;
  inputType?: string;
};

export function actionableAncestorIndex(path: ActionableNodeEvidence[]) {
  return path.findIndex((node) => {
    const tag = node.tag.toLowerCase();
    const role = node.role?.toLowerCase();
    const inputType = node.inputType?.toLowerCase();
    return (
      tag === "button" ||
      (tag === "a" && Boolean(node.href || node.hasOnclick)) ||
      (tag === "input" &&
        ["button", "submit", "checkbox", "radio"].includes(inputType ?? "")) ||
      role === "button" ||
      role === "link" ||
      Boolean(node.hasOnclick)
    );
  });
}

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
  applicationStateBeforeAction?: RawApplicationState;
  occurredAt: number;
};

type MutableSession = Omit<DemonstrationSession, "actions" | "variables"> & {
  actions: RecordedAction[];
  variables: WorkflowVariable[];
};

export type OutcomeDerivationInput = {
  pageContextId: string;
  sourceActionId?: string;
  before?: ApplicationState;
  after?: ApplicationState;
  popupOpened: boolean;
  popupClosed: boolean;
  pageContextReturned: boolean;
  editorResetObserved: boolean;
  unchangedFieldLabels: string[];
  variableRefsInNewItem: string[];
  successMarkerVisible: boolean;
};

function outcomeCandidate(
  input: Omit<
    ApplicationOutcomeCandidate,
    "id" | "selected" | "required" | "rejectionReasons"
  > & {
    selected?: boolean;
    required?: boolean;
    rejectionReasons?: string[];
  },
) {
  return ApplicationOutcomeCandidateSchema.parse({
    id: createId("outcome"),
    selected: false,
    required: false,
    rejectionReasons: [],
    ...input,
  });
}

export function deriveOutcomeCandidates(
  input: OutcomeDerivationInput,
): ApplicationOutcomeCandidate[] {
  const historyIncrease =
    input.before?.historyCount !== undefined &&
    input.after?.historyCount !== undefined
      ? input.after.historyCount - input.before.historyCount
      : undefined;
  const historyObserved = (historyIncrease ?? 0) >= 1;
  const historyUnavailable =
    input.before?.historyCount === undefined &&
    input.after?.historyCount === undefined;
  const alternativeStructuralSuccess =
    historyUnavailable && input.successMarkerVisible;
  const historyTarget =
    input.after?.historySelector ??
    input.before?.historySelector ??
    "[data-vc-consultation-history] > li";
  const candidates: ApplicationOutcomeCandidate[] = [
    outcomeCandidate({
      type: "relative-count-increase",
      label: "Consultation history increased by one",
      pageContextId: input.pageContextId,
      target: historyTarget,
      ...(input.sourceActionId ? { sourceActionId: input.sourceActionId } : {}),
      ...(input.before?.historyCount !== undefined
        ? { beforeCount: input.before.historyCount }
        : {}),
      ...(input.after?.historyCount !== undefined
        ? { afterCount: input.after.historyCount }
        : {}),
      minimumIncrease: 1,
      observed: historyObserved,
      confidence: historyObserved ? 0.99 : 0,
      recommended: historyObserved,
      selected: historyObserved,
      required: historyObserved,
      rejectionReasons: historyObserved
        ? []
        : ["Scoped consultation-history count did not increase."],
    }),
    outcomeCandidate({
      type: "new-scoped-item",
      label: "A new scoped consultation history item appeared",
      pageContextId: input.pageContextId,
      target: historyTarget,
      ...(input.sourceActionId ? { sourceActionId: input.sourceActionId } : {}),
      observed: historyObserved,
      confidence: historyObserved ? 0.96 : 0,
      recommended: false,
      rejectionReasons: historyObserved
        ? []
        : ["No new item was observed in the scoped history container."],
    }),
    outcomeCandidate({
      type: "editor-reset",
      label: "Consultation editor reset after save",
      pageContextId: input.pageContextId,
      target: '[data-vc-field="consultation"]',
      ...(input.sourceActionId ? { sourceActionId: input.sourceActionId } : {}),
      observed: input.editorResetObserved,
      confidence: input.editorResetObserved ? 0.9 : 0,
      recommended: false,
      rejectionReasons: input.editorResetObserved
        ? []
        : ["The consultation editor was not observed empty after save."],
    }),
    outcomeCandidate({
      type: "popup-lifecycle",
      label: "Expected validation popup completed",
      pageContextId: input.pageContextId,
      target: "expected-validation-popup",
      ...(input.sourceActionId ? { sourceActionId: input.sourceActionId } : {}),
      observed: input.popupOpened && input.popupClosed,
      confidence: input.popupOpened && input.popupClosed ? 0.96 : 0,
      recommended: input.popupOpened && input.popupClosed,
      selected:
        (historyObserved || alternativeStructuralSuccess) &&
        input.popupOpened &&
        input.popupClosed,
      required:
        (historyObserved || alternativeStructuralSuccess) &&
        input.popupOpened &&
        input.popupClosed,
      rejectionReasons:
        input.popupOpened && input.popupClosed
          ? []
          : ["The expected popup open/close lifecycle was incomplete."],
    }),
    outcomeCandidate({
      type: "returned-to-page",
      label: "Returned to consultation page",
      pageContextId: input.pageContextId,
      target: input.after?.pathname ?? input.before?.pathname ?? "/",
      ...(input.sourceActionId ? { sourceActionId: input.sourceActionId } : {}),
      observed: input.pageContextReturned,
      confidence: input.pageContextReturned ? 0.94 : 0,
      recommended: input.pageContextReturned,
      selected:
        (historyObserved || alternativeStructuralSuccess) &&
        input.pageContextReturned,
      required:
        (historyObserved || alternativeStructuralSuccess) &&
        input.pageContextReturned,
      rejectionReasons: input.pageContextReturned
        ? []
        : [
            "The application did not return to the demonstrated canonical page.",
          ],
    }),
  ];
  for (const variableRef of input.variableRefsInNewItem) {
    candidates.push(
      outcomeCandidate({
        type: "new-item-contains-variable",
        label: `New history item contains ${variableRef}`,
        pageContextId: input.pageContextId,
        target: historyTarget,
        variableRef,
        ...(input.sourceActionId
          ? { sourceActionId: input.sourceActionId }
          : {}),
        observed: true,
        confidence: 0.93,
        recommended: false,
      }),
    );
  }
  for (const fieldLabel of input.unchangedFieldLabels) {
    candidates.push(
      outcomeCandidate({
        type: "field-unchanged",
        label: `${fieldLabel} remained unchanged`,
        pageContextId: input.pageContextId,
        target:
          fieldLabel === "Date"
            ? '[name="date_consultation"]'
            : '[name="heure_consultation"]',
        fieldLabel,
        ...(input.sourceActionId
          ? { sourceActionId: input.sourceActionId }
          : {}),
        observed: true,
        confidence: 0.88,
        recommended: false,
        selected: historyObserved,
        required: historyObserved,
      }),
    );
  }
  if (input.successMarkerVisible) {
    candidates.push(
      outcomeCandidate({
        type: "success-marker",
        label: "Application success marker is visible",
        pageContextId: input.pageContextId,
        target: '[data-vc-outcome="success"]',
        ...(input.sourceActionId
          ? { sourceActionId: input.sourceActionId }
          : {}),
        observed: true,
        confidence: 0.86,
        recommended: alternativeStructuralSuccess,
        selected: alternativeStructuralSuccess,
        required: alternativeStructuralSuccess,
      }),
    );
  }
  return candidates;
}

export type RecorderStatus = {
  attached: boolean;
  active: boolean;
  actionCount: number;
  passwordEventsExcluded: number;
  crossOriginEventsExcluded: number;
  bindingErrors: string[];
};

export type RecorderOptions = {
  domQuietPeriodMs?: number;
  maximumFinalReconciliationMs?: number;
};

type DomStabilityResult = {
  stable: boolean;
  observedForMs: number;
  mutationCount: number;
  quietPeriodMs: number;
  maximumObservationMs: number;
};

const RECORDER_INIT_SCRIPT = `(() => {
  if (document.__vc2RecorderInstalled) return;
  Object.defineProperty(document, '__vc2RecorderInstalled', { value: true });
  globalThis.__vc2RecorderInstalled = true;
  const pendingInputs = new WeakMap();
  const text = value => String(value || '').replace(/\\s+/g, ' ').trim();
  const staticInterfaceText = value => {
    const normalized = text(value).slice(0, 120);
    if (!normalized) return undefined;
    if (/(patient|token|secret|cookie|authorization|authentication|bearer|api[-_ ]?key)/i.test(normalized)) return undefined;
    if (/\\b[0-9]{6,}\\b/.test(normalized) || /[\\w.+-]+@[\\w.-]+\\.[a-z]{2,}/i.test(normalized)) return undefined;
    return normalized;
  };
  const actionableAncestor = raw => {
    if (!(raw instanceof Element)) return undefined;
    return raw.closest(
      'button,a[href],a[onclick],input[type=button],input[type=submit],input[type=checkbox],input[type=radio],[role=button],[role=link],[onclick]'
    );
  };
  const role = element => {
    const explicit = element.getAttribute('role');
    if (explicit) return explicit;
    const tag = element.tagName.toLowerCase();
    if (tag === 'textarea') return 'textbox';
    if (tag === 'select') return 'combobox';
    if (tag === 'button') return 'button';
    if (tag === 'a' && (element.href || element.onclick)) return 'link';
    if (element.hasAttribute('onclick')) return 'button';
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
  const accessibleName = element => label(element) || staticInterfaceText(element.getAttribute('aria-label')) ||
    staticInterfaceText(element.getAttribute('title')) ||
    (['BUTTON','A'].includes(element.tagName) || element.matches('[role=button],[role=link],[onclick]')
      ? staticInterfaceText(element.textContent) ||
        staticInterfaceText(Array.from(element.querySelectorAll('img[alt]')).map(node => node.getAttribute('alt')).join(' '))
      : '');
  const normalizedStaticText = element => {
    if (element.matches('input:not([type=button]):not([type=submit]):not([type=reset]),textarea,select,[contenteditable=true]')) {
      return undefined;
    }
    if (element instanceof HTMLInputElement) return staticInterfaceText(element.value);
    if (!element.matches('button,a,label,h1,h2,h3,h4,[role=button],[role=link],[role=heading],[onclick]')) {
      return undefined;
    }
    return staticInterfaceText(element.textContent);
  };
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
  const applicationState = () => {
    const history = document.querySelector('[data-vc-consultation-history]');
    let editor = document.querySelector('[data-vc-field=consultation]');
    if (!editor) {
      for (const frame of document.querySelectorAll('iframe')) {
        try {
          editor = frame.contentDocument?.querySelector('[data-vc-field=consultation]');
          if (editor) break;
        } catch {}
      }
    }
    const editorValue = editor
      ? (editor.isContentEditable ? editor.textContent : editor.value)
      : undefined;
    const fieldFingerprints = {};
    for (const [label, selector] of [
      ['Date', '[name=date_consultation]'],
      ['Heure', '[name=heure_consultation]']
    ]) {
      const field = document.querySelector(selector);
      if (field) fieldFingerprints[label] = hash(String(field.value || ''));
    }
    const visible = selector => {
      const element = document.querySelector(selector);
      if (!element) return false;
      const box = element.getBoundingClientRect();
      return box.width > 0 && box.height > 0;
    };
    return {
      historyCount: history ? history.querySelectorAll(':scope > li').length : undefined,
      editorPresent: Boolean(editor),
      editorEmpty: editor ? text(editorValue).length === 0 : undefined,
      successMarkerVisible: visible('[data-vc-outcome=success]'),
      errorMarkerVisible: visible('[data-vc-outcome=error]'),
      origin: location.origin,
      pathname: location.pathname,
      stableFieldFingerprints: fieldFingerprints
    };
  };
  const target = (element, rawElement = element) => {
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
      normalizedStaticText: normalizedStaticText(element),
      hasOnclick: element.hasAttribute('onclick'),
      rawTargetPromoted: rawElement !== element,
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
    const raw = event.target;
    const element = actionableAncestor(raw) ||
      raw?.closest?.('input,select,textarea,[contenteditable=true],[role=textbox]');
    if (!element) return;
    const info = target(element, raw);
    if (info?.password) return;
    const type = element instanceof HTMLInputElement ? element.type : '';
    const kind = type === 'checkbox' ? (element.checked ? 'check' : 'uncheck') : 'click';
    send({
      kind,
      target: info,
      applicationStateBeforeAction: applicationState(),
      occurredAt: Date.now()
    });
  }, true);
  document.addEventListener('dblclick', event => {
    const raw = event.target;
    const element = actionableAncestor(raw) || raw;
    const info = target(element, raw);
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
    const raw = event.submitter || event.target;
    const info = target(actionableAncestor(raw) || raw, raw);
    if (!info?.password) send({
      kind: 'submit',
      target: info,
      applicationStateBeforeAction: applicationState(),
      occurredAt: Date.now()
    });
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
  #saveObservation:
    | {
        actionId: string;
        before: RawApplicationState;
      }
    | undefined;
  readonly #dialogHandlers = new Map<Page, (dialog: Dialog) => Promise<void>>();
  readonly #wiredRecorderPages = new WeakSet<Page>();

  constructor(
    private readonly context: BrowserContext,
    private readonly graph: PageContextGraph,
    private readonly options: RecorderOptions = {},
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
    this.#saveObservation = undefined;
    this.#session = {
      id: createId("demo"),
      startedAt: now.toISOString(),
      pages: graph.nodes,
      pageGraph: graph,
      actions: [],
      variables: [],
      outcomeCandidates: [],
      beforeState: await this.#snapshot(),
      authenticationExcluded: true,
    };
    this.#active = true;
    for (const page of this.context.pages()) this.#wireDialog(page);
    return this.session;
  }

  restore(session: DemonstrationSession, localValues: Record<string, string>) {
    if (this.#active) throw new Error("Stop teaching before restoring.");
    const parsed = DemonstrationSessionSchema.parse(session);
    if (!parsed.stoppedAt)
      throw new Error("Only a completed demonstration can be restored.");
    this.#session = {
      ...parsed,
      actions: [...parsed.actions],
      variables: [...parsed.variables],
    };
    this.#localValues = new Map(Object.entries(localValues));
    return this.session;
  }

  async stop() {
    if (!this.#active || !this.#session)
      throw new Error("Teaching is not active.");
    const stability = await this.#waitForDomStability();
    this.#active = false;
    this.#unwireDialogs();
    this.#session.stoppedAt = new Date().toISOString();
    this.#session.pageGraph = this.graph.data();
    this.#session.pages = this.#session.pageGraph.nodes;
    this.#session.afterState = await this.#snapshot();
    this.#session.actions.sort(
      (left, right) => left.timestampOffsetMs - right.timestampOffsetMs,
    );
    await this.#reconcileOutcomeEffects(stability);
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

  async #waitForDomStability(): Promise<DomStabilityResult> {
    const quietPeriodMs = this.options.domQuietPeriodMs ?? 500;
    const maximumObservationMs =
      this.options.maximumFinalReconciliationMs ?? 5_000;
    const page = this.context
      .pages()
      .find((candidate) => !candidate.isClosed());
    if (!page)
      return {
        stable: false,
        observedForMs: 0,
        mutationCount: 0,
        quietPeriodMs,
        maximumObservationMs,
      };
    const result = await page
      .evaluate(
        ({ quietPeriod, maximumObservation }) =>
          new Promise<{
            stable: boolean;
            observedForMs: number;
            mutationCount: number;
          }>((resolve) => {
            const started = performance.now();
            let lastMutation = started;
            let mutationCount = 0;
            const observer = new MutationObserver((records) => {
              mutationCount += records.length;
              lastMutation = performance.now();
            });
            observer.observe(document.documentElement, {
              attributes: true,
              childList: true,
              subtree: true,
            });
            const interval = setInterval(
              () => {
                const now = performance.now();
                const stable = now - lastMutation >= quietPeriod;
                const timedOut = now - started >= maximumObservation;
                if (!stable && !timedOut) return;
                clearInterval(interval);
                observer.disconnect();
                resolve({
                  stable,
                  observedForMs: Math.round(now - started),
                  mutationCount,
                });
              },
              Math.min(100, Math.max(25, quietPeriod / 5)),
            );
          }),
        {
          quietPeriod: quietPeriodMs,
          maximumObservation: maximumObservationMs,
        },
      )
      .catch(() => ({
        stable: false,
        observedForMs: 0,
        mutationCount: 0,
      }));
    return {
      ...result,
      quietPeriodMs,
      maximumObservationMs,
    };
  }

  async #captureApplicationState() {
    const page = this.context
      .pages()
      .find((candidate) => !candidate.isClosed());
    if (!page) return undefined;
    const variableEntries = [...this.#localValues.entries()].map(
      ([name, value]) => ({
        variableRef: `{{${name}}}`,
        value,
      }),
    );
    const raw = await page.evaluate((entries) => {
      const normalize = (value: unknown) =>
        String(value ?? "")
          .replace(/\s+/g, " ")
          .trim();
      const hash = (value: string) => {
        let result = 2166136261;
        for (let index = 0; index < value.length; index += 1) {
          result ^= value.charCodeAt(index);
          result = Math.imul(result, 16777619);
        }
        return `fnv1a-${(result >>> 0).toString(16).padStart(8, "0")}`;
      };
      const history = document.querySelector("[data-vc-consultation-history]");
      const historyItems = history
        ? Array.from(history.querySelectorAll(":scope > li"))
        : [];
      const lastItemText = normalize(historyItems.at(-1)?.textContent);
      let editor = document.querySelector<HTMLElement>(
        '[data-vc-field="consultation"]',
      );
      if (!editor) {
        for (const frame of document.querySelectorAll("iframe")) {
          try {
            editor =
              frame.contentDocument?.querySelector<HTMLElement>(
                '[data-vc-field="consultation"]',
              ) ?? null;
            if (editor) break;
          } catch {
            // Cross-origin frame contents remain opaque.
          }
        }
      }
      const editorValue = editor
        ? editor.isContentEditable
          ? editor.textContent
          : "value" in editor
            ? String((editor as HTMLInputElement).value)
            : editor.textContent
        : undefined;
      const stableFieldFingerprints: Record<string, string> = {};
      for (const [label, selector] of [
        ["Date", '[name="date_consultation"]'],
        ["Heure", '[name="heure_consultation"]'],
      ] as const) {
        const field = document.querySelector<HTMLInputElement>(selector);
        if (field) stableFieldFingerprints[label] = hash(field.value);
      }
      const visible = (selector: string) => {
        const element = document.querySelector(selector);
        if (!element) return false;
        const box = element.getBoundingClientRect();
        return box.width > 0 && box.height > 0;
      };
      return {
        historyCount: history ? historyItems.length : undefined,
        editorPresent: Boolean(editor),
        editorEmpty:
          editorValue === undefined ? undefined : normalize(editorValue) === "",
        successMarkerVisible: visible('[data-vc-outcome="success"]'),
        errorMarkerVisible: visible('[data-vc-outcome="error"]'),
        origin: location.origin,
        pathname: location.pathname,
        stableFieldFingerprints,
        variableRefsInLastItem: entries
          .filter(
            (entry) =>
              entry.value.length > 0 && lastItemText.includes(entry.value),
          )
          .map((entry) => entry.variableRef),
      };
    }, variableEntries);
    const pageContextId = await this.graph.contextIdForPage(page);
    const publicState = ApplicationStateSchema.parse({
      pageContextId,
      origin: raw.origin,
      pathname: raw.pathname,
      capturedAt: new Date().toISOString(),
      ...(raw.historyCount !== undefined
        ? {
            historySelector: "[data-vc-consultation-history] > li",
            historyCount: raw.historyCount,
          }
        : {}),
      editorPresent: raw.editorPresent,
      ...(raw.editorEmpty !== undefined
        ? { editorEmpty: raw.editorEmpty }
        : {}),
      successMarkerVisible: raw.successMarkerVisible,
      errorMarkerVisible: raw.errorMarkerVisible,
    });
    return {
      raw: raw as RawApplicationState,
      publicState,
      variableRefsInLastItem: raw.variableRefsInLastItem,
    };
  }

  async reconcileCurrentState(options: { useCurrentState?: boolean } = {}) {
    if (this.#active)
      throw new Error("Stop teaching before reconciling success evidence.");
    if (!this.#session) throw new Error("No demonstration session exists.");
    const stability = await this.#waitForDomStability();
    await this.#reconcileOutcomeEffects(stability, options.useCurrentState);
    this.#session.afterState = await this.#snapshot();
    this.#session.pageGraph = this.graph.data();
    this.#session.pages = this.#session.pageGraph.nodes;
    return this.session;
  }

  updateOutcomeCandidate(
    candidateId: string,
    patch: { selected?: boolean; required?: boolean },
  ) {
    if (!this.#session) throw new Error("No demonstration session exists.");
    const candidate = this.#session.outcomeCandidates.find(
      (entry) => entry.id === candidateId,
    );
    if (!candidate) throw new Error("Unknown application outcome candidate.");
    if (patch.selected === true && !candidate.observed)
      throw new Error("Unobserved evidence cannot be selected.");
    if (typeof patch.selected === "boolean")
      candidate.selected = patch.selected;
    if (typeof patch.required === "boolean")
      candidate.required = patch.required;
    if (!candidate.selected) candidate.required = false;
    return this.session;
  }

  async #reconcileOutcomeEffects(
    stability: DomStabilityResult,
    useCurrentState = false,
  ) {
    if (!this.#session) return;
    const captured = await this.#captureApplicationState();
    if (!captured) return;
    const sourceAction = this.#saveObservation
      ? this.#session.actions.find(
          (action) => action.id === this.#saveObservation?.actionId,
        )
      : [...this.#session.actions]
          .reverse()
          .find((action) => action.sequenceContext?.savesPreviousEditor);
    const before =
      this.#session.applicationStateBefore ??
      (this.#saveObservation
        ? ApplicationStateSchema.parse({
            pageContextId:
              sourceAction?.pageContextId ?? captured.publicState.pageContextId,
            origin: this.#saveObservation.before.origin,
            pathname: this.#saveObservation.before.pathname,
            capturedAt: new Date().toISOString(),
            ...(this.#saveObservation.before.historyCount !== undefined
              ? {
                  historySelector: "[data-vc-consultation-history] > li",
                  historyCount: this.#saveObservation.before.historyCount,
                }
              : {}),
            editorPresent: this.#saveObservation.before.editorPresent,
            ...(this.#saveObservation.before.editorEmpty !== undefined
              ? { editorEmpty: this.#saveObservation.before.editorEmpty }
              : {}),
            successMarkerVisible:
              this.#saveObservation.before.successMarkerVisible,
            errorMarkerVisible: this.#saveObservation.before.errorMarkerVisible,
          })
        : undefined);
    if (before) this.#session.applicationStateBefore = before;
    this.#session.applicationStateAfter = captured.publicState;
    const sourceIndex = sourceAction
      ? this.#session.actions.findIndex(
          (action) => action.id === sourceAction.id,
        )
      : -1;
    const causalTail =
      sourceIndex >= 0
        ? this.#session.actions.slice(sourceIndex + 1)
        : this.#session.actions;
    const popupOpened = causalTail.some(
      (action) => action.action === "popup-open",
    );
    const popupClosed = causalTail.some(
      (action) => action.action === "popup-close",
    );
    const pageContextReturned = Boolean(
      before &&
        before.origin === captured.publicState.origin &&
        before.pathname === captured.publicState.pathname,
    );
    const editorResetObserved = Boolean(
      before?.editorEmpty === false &&
        captured.publicState.editorEmpty === true,
    );
    const unchangedFieldLabels = this.#saveObservation
      ? Object.entries(this.#saveObservation.before.stableFieldFingerprints)
          .filter(
            ([label, fingerprint]) =>
              captured.raw.stableFieldFingerprints[label] === fingerprint,
          )
          .map(([label]) => label)
      : [];
    const frameReplacementObserved = Boolean(
      sourceAction?.sequenceContext &&
        (() => {
          const previous = this.#session!.actions.find(
            (action) =>
              action.id === sourceAction.sequenceContext?.previousActionId,
          );
          const recorded = previous
            ? this.#session!.pageGraph.nodes.find(
                (node) => node.id === previous.pageContextId,
              )
            : undefined;
          return Boolean(
            recorded?.role === "frame" &&
              recorded.status === "closed" &&
              this.#session!.pageGraph.nodes.some(
                (node) =>
                  node.id !== recorded.id &&
                  node.role === "frame" &&
                  node.status === "open" &&
                  node.origin === recorded.origin &&
                  node.pathname === recorded.pathname,
              ),
          );
        })(),
    );
    this.#session.outcomeCandidates = deriveOutcomeCandidates({
      pageContextId: captured.publicState.pageContextId,
      ...(sourceAction ? { sourceActionId: sourceAction.id } : {}),
      ...(before ? { before } : {}),
      after: captured.publicState,
      popupOpened,
      popupClosed,
      pageContextReturned,
      editorResetObserved,
      unchangedFieldLabels,
      variableRefsInNewItem: captured.variableRefsInLastItem,
      successMarkerVisible: captured.publicState.successMarkerVisible,
    });
    if (useCurrentState) {
      const marker = this.#session.outcomeCandidates.find(
        (candidate) => candidate.type === "success-marker",
      );
      if (marker) {
        marker.selected = true;
        marker.required = true;
        marker.recommended = true;
      }
    }
    this.#session.effectReconciliation = EffectReconciliationSchema.parse({
      status: !before
        ? "legacy-insufficient"
        : stability.stable
          ? "stable"
          : "timed-out",
      quietPeriodMs: stability.quietPeriodMs,
      maximumObservationMs: stability.maximumObservationMs,
      observedForMs: stability.observedForMs,
      mutationCount: stability.mutationCount,
      popupOpened,
      popupClosed,
      frameReplacementObserved,
      pageContextReturned,
      editorResetObserved,
      reconciledAt: new Date().toISOString(),
    });
    if (!sourceAction) return;
    const effects: ObservedEffect[] = [
      {
        type: "stability-reconciled",
        pageContextId: captured.publicState.pageContextId,
        description: stability.stable
          ? "Final application state reached the bounded DOM quiet period."
          : "Final application state reached the observation timeout.",
      },
      ...(frameReplacementObserved
        ? [
            {
              type: "frame-replaced" as const,
              pageContextId: captured.publicState.pageContextId,
              description:
                "The demonstrated editor frame was replaced before final reconciliation.",
            },
          ]
        : []),
      ...(popupOpened
        ? [
            {
              type: "popup-opened" as const,
              pageContextId: captured.publicState.pageContextId,
              description: "Expected validation popup opened after save.",
            },
          ]
        : []),
      ...(popupClosed
        ? [
            {
              type: "popup-closed" as const,
              pageContextId: captured.publicState.pageContextId,
              description: "Expected validation popup completed and closed.",
            },
          ]
        : []),
      ...(pageContextReturned
        ? [
            {
              type: "returned-to-page" as const,
              pageContextId: captured.publicState.pageContextId,
              description:
                "Application returned to the demonstrated canonical page.",
            },
          ]
        : []),
      ...(editorResetObserved
        ? [
            {
              type: "editor-reset" as const,
              pageContextId: captured.publicState.pageContextId,
              description: "Consultation editor was reset after save.",
            },
          ]
        : []),
      ...(this.#session.outcomeCandidates.some(
        (candidate) =>
          candidate.type === "relative-count-increase" && candidate.observed,
      )
        ? [
            {
              type: "history-increased" as const,
              pageContextId: captured.publicState.pageContextId,
              description:
                "Scoped consultation history increased relative to its pre-save count.",
            },
          ]
        : []),
      ...(captured.publicState.successMarkerVisible
        ? [
            {
              type: "success-visible" as const,
              pageContextId: captured.publicState.pageContextId,
              description: "Known structural success marker is visible.",
            },
          ]
        : []),
    ];
    for (const effect of effects) {
      if (
        !sourceAction.observedEffects.some(
          (entry) => entry.type === effect.type,
        )
      )
        sourceAction.observedEffects.push(effect);
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
            normalizedStaticText: payload.target.normalizedStaticText,
            title: payload.target.stableAttributes.title,
            ariaLabel: payload.target.stableAttributes["aria-label"],
            hasOnclick: payload.target.hasOnclick ?? false,
            rawTargetPromoted: payload.target.rawTargetPromoted ?? false,
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
    const previousInputAction = [...this.#session.actions]
      .reverse()
      .find(
        (action) => action.target && ["fill", "select"].includes(action.action),
      );
    const previousForm =
      previousInputAction?.target?.descriptor?.formName ??
      previousInputAction?.target?.descriptor?.hostFormName;
    const currentForm =
      target?.descriptor?.formName ?? target?.descriptor?.hostFormName;
    const previousContainer =
      previousInputAction?.target?.descriptor?.semanticContainer?.heading;
    const currentContainer = target?.descriptor?.semanticContainer?.heading;
    const sameForm = Boolean(
      previousForm && currentForm && previousForm === currentForm,
    );
    const sameSemanticContainer = Boolean(
      previousContainer &&
        currentContainer &&
        previousContainer === currentContainer,
    );
    const staticActionName =
      target?.descriptor?.normalizedStaticText ??
      target?.descriptor?.accessibleName ??
      "";
    const sequenceContext =
      previousInputAction &&
      ["click", "double-click", "submit"].includes(payload.kind)
        ? {
            previousActionId: previousInputAction.id,
            previousAction: previousInputAction.action as "fill" | "select",
            demonstratedAfterPrevious: true as const,
            sameForm,
            sameSemanticContainer,
            savesPreviousEditor:
              (sameForm || sameSemanticContainer) &&
              /(enregistrer|save|submit|valider|confirm)/i.test(
                staticActionName,
              ),
          }
        : undefined;
    const recorded = RecordedActionSchema.parse({
      id: createId("action"),
      pageContextId,
      action: payload.kind,
      name: `${pageLabel(graphNode?.role ?? "main")} — ${actionLabel(payload.kind, payload.target)}`,
      ...(target ? { target } : {}),
      ...(sequenceContext ? { sequenceContext } : {}),
      ...(valueRef ? { valueRef } : {}),
      ...(payload.key ? { key: payload.key } : {}),
      observedEffects: [],
      timestampOffsetMs: Math.max(0, payload.occurredAt - this.#startedAtMs),
      optional: false,
    });
    deduplicateAction(this.#session.actions, recorded);
    if (
      sequenceContext?.savesPreviousEditor &&
      payload.applicationStateBeforeAction
    ) {
      this.#saveObservation = {
        actionId: recorded.id,
        before: payload.applicationStateBeforeAction,
      };
      this.#session.applicationStateBefore = ApplicationStateSchema.parse({
        pageContextId,
        origin: payload.applicationStateBeforeAction.origin,
        pathname: payload.applicationStateBeforeAction.pathname,
        capturedAt: new Date(payload.occurredAt).toISOString(),
        ...(payload.applicationStateBeforeAction.historyCount !== undefined
          ? {
              historySelector: "[data-vc-consultation-history] > li",
              historyCount: payload.applicationStateBeforeAction.historyCount,
            }
          : {}),
        editorPresent: payload.applicationStateBeforeAction.editorPresent,
        ...(payload.applicationStateBeforeAction.editorEmpty !== undefined
          ? { editorEmpty: payload.applicationStateBeforeAction.editorEmpty }
          : {}),
        successMarkerVisible:
          payload.applicationStateBeforeAction.successMarkerVisible,
        errorMarkerVisible:
          payload.applicationStateBeforeAction.errorMarkerVisible,
      });
    }
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
