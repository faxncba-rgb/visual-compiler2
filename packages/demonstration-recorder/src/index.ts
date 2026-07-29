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
  forbiddenValue?: boolean;
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

type RawStructuralSnapshot = {
  documentToken?: string;
  fingerprint: string;
  visibleLandmarks: string[];
  structuralOutline: string[];
  origin: string;
  pathname: string;
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
    | "focus"
    | "extract";
  target?: BrowserTargetPayload;
  value?: string;
  valueSource?: "literal" | "runtime-variable";
  runtimeVariableName?: string;
  editingTransaction?: {
    id: string;
    startedAt: number;
    phase: "update" | "commit";
    inputEvents: number;
    compositionObserved: boolean;
    pasteObserved: boolean;
    selectionObserved: boolean;
  };
  key?: string;
  keyboardScope?: "focused-element" | "page";
  applicationStateBeforeAction?: RawApplicationState;
  beforeSnapshot?: RawStructuralSnapshot;
  documentToken?: string;
  captureSequence?: number;
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
  const candidates: ApplicationOutcomeCandidate[] = [];
  if (!historyUnavailable) {
    candidates.push(
      outcomeCandidate({
        type: "relative-count-increase",
        label: "Demonstrated scoped collection increased by one",
        pageContextId: input.pageContextId,
        target: historyTarget,
        ...(input.sourceActionId
          ? { sourceActionId: input.sourceActionId }
          : {}),
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
          : ["The demonstrated scoped collection count did not increase."],
      }),
      outcomeCandidate({
        type: "new-scoped-item",
        label: "A new item appeared in the demonstrated scoped collection",
        pageContextId: input.pageContextId,
        target: historyTarget,
        ...(input.sourceActionId
          ? { sourceActionId: input.sourceActionId }
          : {}),
        observed: historyObserved,
        confidence: historyObserved ? 0.96 : 0,
        recommended: false,
        rejectionReasons: historyObserved
          ? []
          : ["No new item was observed in the scoped collection."],
      }),
    );
  }
  if (input.before?.editorPresent || input.after?.editorPresent) {
    candidates.push(
      outcomeCandidate({
        type: "editor-reset",
        label: "Demonstrated editor reset after the action",
        pageContextId: input.pageContextId,
        target: '[data-vc-field="consultation"]',
        ...(input.sourceActionId
          ? { sourceActionId: input.sourceActionId }
          : {}),
        observed: input.editorResetObserved,
        confidence: input.editorResetObserved ? 0.9 : 0,
        recommended: false,
        rejectionReasons: input.editorResetObserved
          ? []
          : ["The demonstrated editor was not observed empty afterwards."],
      }),
    );
  }
  candidates.push(
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
      label: "Returned to the demonstrated page",
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
  );
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
  const strongest = candidates
    .filter((candidate) => candidate.observed)
    .sort((left, right) => right.confidence - left.confidence)[0];
  for (const candidate of candidates) {
    candidate.selected = candidate.id === strongest?.id;
    candidate.required = candidate.id === strongest?.id;
    candidate.recommended = candidate.id === strongest?.id;
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
  globalThis.__vc2RecorderListenerController?.abort();
  const listenerController = new AbortController();
  globalThis.__vc2RecorderListenerController = listenerController;
  const listenerOptions = { capture: true, signal: listenerController.signal };
  globalThis.__vc2RecorderInstalled = true;
  let activeEdit;
  let editSequence = 0;
  let captureSequence = 0;
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
  const canonicalUrl = value => {
    if (!value) return undefined;
    try {
      const url = new URL(value, location.href);
      return url.origin + (url.pathname || '/');
    } catch {
      return undefined;
    }
  };
  const safeCode = value => {
    const normalized = text(value).slice(0, 240);
    if (!normalized) return undefined;
    return normalized
      .replace(/https?:\\/\\/[^\\s'"]+/gi, match => canonicalUrl(match) || '[REDACTED_URL]')
      .replace(/(['"])(?:(?!\\1).){12,}\\1/g, '$1[REDACTED]$1')
      .replace(/\\b\\d{6,}\\b/g, '[REDACTED]');
  };
  const structuralSnapshot = () => {
    const landmarks = Array.from(document.querySelectorAll('h1,h2,h3,[role=heading],[role=status]'))
      .map(node => staticInterfaceText(node.textContent))
      .filter(Boolean)
      .slice(0, 20);
    const outline = Array.from(document.querySelectorAll('main,nav,form,table,section,article,button,a[href],select,input,textarea,[role]'))
      .slice(0, 80)
      .map(node => [
        node.tagName.toLowerCase(),
        role(node) || '',
        staticInterfaceText(node.getAttribute('aria-label')) || '',
        staticInterfaceText(node.getAttribute('title')) || '',
        node.closest('form')?.getAttribute('name') || ''
      ].join(':'))
      .slice(0, 32);
    return {
      documentToken: globalThis.__vc2DocumentToken,
      fingerprint: hash([location.origin, location.pathname, ...outline].join('|')),
      visibleLandmarks: landmarks,
      structuralOutline: outline,
      origin: location.origin,
      pathname: location.pathname
    };
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
    const identity = [
      inputType,
      element.getAttribute('name'),
      element.getAttribute('id'),
      element.getAttribute('autocomplete'),
      element.getAttribute('aria-label'),
      element.closest('form')?.getAttribute('name'),
      element.closest('form')?.getAttribute('id'),
      element.closest('form')?.getAttribute('action')
    ].filter(Boolean).join('|');
    const forbiddenValue =
      inputType?.toLowerCase() === 'password' ||
      /(?:^|[^a-z])(user(?:name)?|login|sign[-_ ]?in|pass(?:word|wd)?|csrf|xsrf|auth(?:entication|orization)?|bearer|api[-_ ]?key|session[-_ ]?(?:id|token)|one[-_ ]?time[-_ ]?(?:code|password))(?:[^a-z]|$)/i.test(identity);
    if (forbiddenValue) return { password: inputType?.toLowerCase() === 'password', forbiddenValue: true };
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
    const transientAncestor = element.closest('[role=menu],[role=listbox],[role=dialog],dialog,[popover]');
    const raw = rawElement instanceof Element ? rawElement : element;
    const icon = raw.matches('img,svg,use,i,[role=img]') ? raw :
      raw.querySelector?.('img,svg,use,i,[role=img]') ||
      element.querySelector?.('img,svg,use,i,[role=img]');
    const link = element.closest('a') || (element.matches('a') ? element : undefined);
    const form = element.closest('form');
    const row = element.closest('tr');
    const cell = element.closest('th,td');
    const table = row?.closest('table');
    const rows = table ? Array.from(table.querySelectorAll('tr')) : [];
    const cells = row ? Array.from(row.querySelectorAll(':scope > th,:scope > td')) : [];
    const headers = table
      ? Array.from(table.querySelectorAll('thead th,tr:first-child th'))
          .map(node => staticInterfaceText(node.textContent))
          .filter(Boolean)
          .slice(0, 12)
      : [];
    const rowText = row
      ? cells
          .map(node => staticInterfaceText(node.textContent))
          .filter(Boolean)
          .slice(0, 12)
      : [];
    const rawSrc = raw instanceof HTMLImageElement ? raw.src :
      raw.getAttribute('src') || raw.getAttribute('href');
    const iconSrc = icon instanceof HTMLImageElement ? icon.src :
      icon?.getAttribute?.('src') || icon?.getAttribute?.('href');
    const canonicalHref = link ? canonicalUrl(link.href || link.getAttribute('href')) : undefined;
    const iconAlt = icon ? staticInterfaceText(icon.getAttribute('alt')) : undefined;
    const iconTitle = icon ? staticInterfaceText(icon.getAttribute('title')) : undefined;
    const canonicalIconSrc = canonicalUrl(iconSrc);
    const iconMatches = candidate => {
      if (!(candidate instanceof Element)) return false;
      if (iconAlt && staticInterfaceText(candidate.getAttribute('alt')) !== iconAlt) return false;
      if (iconTitle && staticInterfaceText(candidate.getAttribute('title')) !== iconTitle) return false;
      if (canonicalIconSrc) {
        const candidateSrc = candidate instanceof HTMLImageElement ? candidate.src :
          candidate.getAttribute('src') || candidate.getAttribute('href');
        if (canonicalUrl(candidateSrc) !== canonicalIconSrc) return false;
      }
      return Boolean(iconAlt || iconTitle || canonicalIconSrc);
    };
    const canonicalHrefMatchCount = canonicalHref
      ? Array.from(document.querySelectorAll('a[href]'))
          .filter(candidate => canonicalUrl(candidate.href || candidate.getAttribute('href')) === canonicalHref).length
      : 0;
    const iconMatchCount = icon
      ? Array.from(document.querySelectorAll('a[href] img,a[onclick] img,a[href] svg,a[onclick] svg,a[href] [role=img],a[onclick] [role=img]'))
          .filter(iconMatches).length
      : 0;
    const rowIconMatchCount = row && icon
      ? Array.from(document.querySelectorAll('tr')).reduce((count, candidateRow) => {
          const candidateTexts = Array.from(candidateRow.querySelectorAll(':scope > th,:scope > td'))
            .map(node => staticInterfaceText(node.textContent))
            .filter(Boolean);
          const sameRow = rowText.length > 0 && rowText.every(value => candidateTexts.includes(value));
          if (!sameRow) return count;
          const candidateCells = Array.from(candidateRow.querySelectorAll(':scope > th,:scope > td'));
          const candidateCell = candidateCells[Math.max(0, cells.indexOf(cell))];
          if (!candidateCell) return count;
          const candidateLinks = Array.from(candidateCell.querySelectorAll('a[href],a[onclick],[role=link]'));
          return count + candidateLinks.filter(candidateLink => {
            if (
              canonicalHref &&
              canonicalUrl(candidateLink.href || candidateLink.getAttribute('href')) !== canonicalHref
            ) return false;
            const candidateIcons = Array.from(candidateLink.querySelectorAll('img,svg,use,i,[role=img]'));
            if (iconAlt || iconTitle || canonicalIconSrc) {
              return candidateIcons.some(iconMatches);
            }
            return candidateIcons.some(candidateIcon =>
              candidateIcon.tagName.toLowerCase() === icon.tagName.toLowerCase()
            );
          }).length;
        }, 0)
      : 0;
    const clickEvidence = {
      rawTarget: {
        tag: raw.tagName.toLowerCase(),
        role: role(raw),
        alt: staticInterfaceText(raw.getAttribute('alt')),
        title: staticInterfaceText(raw.getAttribute('title')),
        src: canonicalUrl(rawSrc),
        structuralPath: cssPath(raw)
      },
      normalizedClickable: {
        tag: element.tagName.toLowerCase(),
        role: role(element),
        accessibleName: accessibleName(element) || undefined,
        structuralPath: cssPath(element)
      },
      icon: icon ? {
        tag: icon.tagName.toLowerCase(),
        alt: iconAlt,
        title: iconTitle,
        src: canonicalIconSrc
      } : undefined,
      canonicalHref,
      onclick: safeCode(element.getAttribute('onclick') || link?.getAttribute('onclick')),
      form: form ? {
        name: staticInterfaceText(form.getAttribute('name')),
        id: staticInterfaceText(form.getAttribute('id')),
        action: canonicalUrl(form.getAttribute('action'))
      } : undefined,
      table: row && cell ? {
        rowIndex: Math.max(0, rows.indexOf(row)),
        columnIndex: Math.max(0, cells.indexOf(cell)),
        headers,
        rowText
      } : undefined,
      domRelations: [
        raw === element ? 'raw-is-normalized' : 'raw-descendant-of-normalized',
        ...Array.from(raw.parentElement ? [raw.parentElement] : [])
          .map(node => node.tagName.toLowerCase() + '>' + element.tagName.toLowerCase())
      ],
      structuralSnapshot: [
        cssPath(raw),
        cssPath(element),
        ...(row ? [cssPath(row)] : []),
        ...(table ? [cssPath(table)] : [])
      ],
      captureValidation: {
        canonicalHrefMatchCount,
        iconMatchCount,
        rowIconMatchCount
      }
    };
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
      checked: element instanceof HTMLInputElement && ['checkbox','radio'].includes(element.type) ? element.checked : undefined,
      selected: element instanceof HTMLSelectElement ? element.selectedIndex >= 0 : undefined,
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
      forbiddenValue: false,
      editorAdapter: element.dataset?.vcKeyboardDependent === 'true' ? 'keyboard' :
        element.dataset?.vcEditor === 'legacy-facade' ? 'legacy-facade' :
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
      },
      captureContext: {
        transient: Boolean(transientAncestor),
        ancestorRole: transientAncestor ? (role(transientAncestor) || transientAncestor.tagName.toLowerCase()) : undefined
      },
      clickEvidence
    };
  };
  const send = payload => {
    try {
      const beforeSnapshot = structuralSnapshot();
      return Promise.resolve(globalThis.__vc2Record({
        ...payload,
        beforeSnapshot,
        documentToken: beforeSnapshot.documentToken,
        captureSequence: ++captureSequence
      })).catch(() => undefined);
    } catch {
      return Promise.resolve();
    }
  };
  const isEditable = element => element instanceof Element && (
    element.matches('input:not([type=hidden]):not([type=button]):not([type=submit]):not([type=checkbox]):not([type=radio]),textarea,select,[contenteditable=true],[role=textbox]') ||
    (document.designMode === 'on' && element === document.body)
  );
  const editableValue = element => {
    if (element instanceof HTMLSelectElement) return element.value;
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) return element.value;
    return element.textContent ?? '';
  };
  const openEdit = element => {
    if (!isEditable(element)) return undefined;
    if (activeEdit?.element === element) return activeEdit;
    flushEdit('commit');
    const info = target(element);
    if (!info || info.password || info.forbiddenValue) return undefined;
    activeEdit = {
      id: 'edit-' + Date.now().toString(36) + '-' + (++editSequence).toString(36),
      startedAt: Date.now(),
      element,
      target: info,
      value: String(editableValue(element)),
      dirty: false,
      inputEvents: 0,
      compositionObserved: false,
      pasteObserved: false,
      selectionObserved: false,
      valueSource: 'literal',
      lastPublishedValue: undefined
    };
    return activeEdit;
  };
  const publishEdit = phase => {
    const edit = activeEdit;
    if (!edit || !edit.dirty) return;
    const value = String(edit.value ?? '');
    if (phase === 'update' && edit.lastPublishedValue === value) return;
    edit.lastPublishedValue = value;
    return send({
      kind: edit.element instanceof HTMLSelectElement ? 'select' : 'fill',
      target: edit.target,
      value,
      valueSource: edit.valueSource,
      editingTransaction: {
        id: edit.id,
        startedAt: edit.startedAt,
        phase,
        inputEvents: edit.inputEvents,
        compositionObserved: edit.compositionObserved,
        pasteObserved: edit.pasteObserved,
        selectionObserved: edit.selectionObserved
      },
      occurredAt: Date.now()
    });
  };
  function flushEdit(phase = 'commit') {
    if (!activeEdit) return;
    if (activeEdit.element?.isConnected) {
      activeEdit.value = String(editableValue(activeEdit.element));
    }
    const published = publishEdit(phase);
    if (phase === 'commit') activeEdit = undefined;
    return published;
  }
  const updateEdit = (element, details = {}) => {
    const edit = openEdit(element);
    if (!edit) return;
    edit.value = String(editableValue(element));
    edit.dirty = true;
    edit.inputEvents += details.inputEvent ? 1 : 0;
    edit.compositionObserved ||= Boolean(details.composition);
    edit.pasteObserved ||= Boolean(details.paste);
    edit.selectionObserved ||= Boolean(details.selection);
    publishEdit('update');
  };
  globalThis.__vc2FlushEditingTransactions = () => flushEdit('commit');
  globalThis.__vc2ResetEditingTransactions = () => {
    activeEdit = undefined;
  };
  document.addEventListener('focusin', event => {
    openEdit(event.target);
  }, listenerOptions);
  document.addEventListener('focusout', event => {
    if (activeEdit?.element === event.target) flushEdit('commit');
  }, listenerOptions);
  document.addEventListener('beforeinput', event => {
    openEdit(event.target);
  }, listenerOptions);
  document.addEventListener('compositionstart', event => {
    const edit = openEdit(event.target);
    if (edit) edit.compositionObserved = true;
  }, listenerOptions);
  document.addEventListener('compositionupdate', event => {
    const edit = openEdit(event.target);
    if (edit) edit.compositionObserved = true;
  }, listenerOptions);
  document.addEventListener('compositionend', event => {
    updateEdit(event.target, { inputEvent: true, composition: true });
  }, listenerOptions);
  document.addEventListener('paste', event => {
    const edit = openEdit(event.target);
    if (edit) {
      edit.pasteObserved = true;
      edit.valueSource = 'runtime-variable';
    }
  }, listenerOptions);
  document.addEventListener('copy', event => {
    flushEdit('commit');
    const info = target(event.target);
    if (!info || info.password || info.forbiddenValue) return;
    send({ kind: 'extract', target: info, occurredAt: Date.now() });
  }, listenerOptions);
  document.addEventListener('click', event => {
    flushEdit('commit');
    const raw = event.target;
    const element = actionableAncestor(raw) ||
      raw?.closest?.('input,select,textarea,[contenteditable=true],[role=textbox]');
    if (!element) return;
    const info = target(element, raw);
    if (info?.password || info?.forbiddenValue) return;
    const type = element instanceof HTMLInputElement ? element.type : '';
    const kind = ['checkbox','radio'].includes(type) ? (element.checked ? 'check' : 'uncheck') : 'click';
    send({
      kind,
      target: info,
      applicationStateBeforeAction: applicationState(),
      occurredAt: Date.now()
    });
  }, listenerOptions);
  document.addEventListener('dblclick', event => {
    flushEdit('commit');
    const raw = event.target;
    const element = actionableAncestor(raw) || raw;
    const info = target(element, raw);
    if (!info?.password && !info?.forbiddenValue) send({ kind: 'double-click', target: info, occurredAt: Date.now() });
  }, listenerOptions);
  document.addEventListener('input', event => {
    const element = event.target;
    if (element instanceof HTMLInputElement && ['checkbox','radio'].includes(element.type)) return;
    updateEdit(element, { inputEvent: true });
  }, listenerOptions);
  document.addEventListener('change', event => {
    const element = event.target;
    if (element instanceof HTMLInputElement && ['checkbox','radio'].includes(element.type)) return;
    if (!activeEdit || activeEdit.element !== element) return;
    updateEdit(element, { inputEvent: true });
    flushEdit('commit');
  }, listenerOptions);
  document.addEventListener('keydown', event => {
    const modifiers = [
      event.metaKey ? 'Meta' : '',
      event.ctrlKey ? 'Control' : '',
      event.altKey ? 'Alt' : '',
      event.shiftKey ? 'Shift' : ''
    ].filter(Boolean);
    const focused = document.activeElement instanceof Element ? document.activeElement : undefined;
    const pageScoped = !focused || focused === document.documentElement ||
      (focused === document.body && !isEditable(focused));
    const focusOwner = pageScoped ? undefined : (actionableAncestor(focused) || focused);
    const significantCharacter = event.key.length === 1 &&
      (!isEditable(focusOwner) || focusOwner instanceof HTMLSelectElement);
    const meaningful = significantCharacter || ['Enter','Escape','Tab','ArrowDown','ArrowUp','ArrowLeft','ArrowRight'].includes(event.key);
    if (!meaningful && modifiers.length === 0) return;
    const info = focusOwner ? target(focusOwner, event.target) : undefined;
    const key = [...modifiers, event.key].join('+');
    if (!info?.password && !info?.forbiddenValue) send({
      kind: 'keyboard',
      target: info,
      keyboardScope: info ? 'focused-element' : 'page',
      key,
      occurredAt: Date.now()
    });
  }, listenerOptions);
  document.addEventListener('keyup', event => {
    if (activeEdit?.element === event.target && activeEdit.target.editorAdapter === 'keyboard') {
      updateEdit(event.target, { inputEvent: true });
    }
  }, listenerOptions);
  document.addEventListener('selectionchange', () => {
    if (activeEdit) activeEdit.selectionObserved = true;
  }, listenerOptions);
  document.addEventListener('submit', event => {
    flushEdit('commit');
    const raw = event.submitter || event.target;
    const info = target(actionableAncestor(raw) || raw, raw);
    if (!info?.password && !info?.forbiddenValue) send({
      kind: 'submit',
      target: info,
      applicationStateBeforeAction: applicationState(),
      occurredAt: Date.now()
    });
  }, listenerOptions);
  globalThis.addEventListener('pagehide', () => flushEdit('commit'), listenerOptions);
  globalThis.addEventListener('beforeunload', () => flushEdit('commit'), listenerOptions);
  globalThis.addEventListener('focus', () => send({ kind: 'focus', occurredAt: Date.now() }), listenerOptions);
})();`;

export async function shouldExcludeFrame(frame: Frame) {
  if (frame === frame.page().mainFrame()) return false;
  try {
    const frameOrigin = new URL(frame.url()).origin;
    const pageOrigin = new URL(frame.page().url()).origin;
    if (frameOrigin !== "null") return frameOrigin !== pageOrigin;
  } catch {
    // Empty, javascript: and other inherited URLs require a capability check.
  }
  return !(await frame
    .evaluate(() => {
      try {
        return Boolean(globalThis.top?.document);
      } catch {
        return false;
      }
    })
    .catch(() => false));
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
      const container = host.closest(
        "section,form,article,[role=dialog],[role=region]",
      );
      const heading = container?.querySelector("h1,h2,h3,[role=heading]");
      const labelRoot: ParentNode = container ?? document;
      const labels = Array.from(
        labelRoot.querySelectorAll<Element>("label,h1,h2,h3,th"),
      )
        .map((node) =>
          String(node.textContent ?? "")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 120),
        )
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
        .map((node) =>
          String(node.textContent ?? "")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 120),
        )
        .filter(Boolean);
      const action = container?.querySelector(
        "button,[role=button],a[data-vc-action]",
      );
      return {
        formName: host.closest("form")?.getAttribute("name") || undefined,
        semanticContainer: container
          ? {
              tag: container.tagName.toLowerCase(),
              heading:
                String(heading?.textContent ?? "")
                  .replace(/\s+/g, " ")
                  .trim()
                  .slice(0, 120) || undefined,
              landmark: container.getAttribute("role") || undefined,
            }
          : undefined,
        labels,
        precedingLabels,
        relatedActionName:
          String(action?.textContent ?? "")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 120) || undefined,
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
    candidate.action !== "keyboard" &&
    previous.action === candidate.action &&
    previous.pageContextId === candidate.pageContextId &&
    previous.target?.fingerprint === candidate.target?.fingerprint &&
    Math.abs(previous.timestampOffsetMs - candidate.timestampOffsetMs) <=
      windowMs
  ) {
    candidate.sequence = previous.sequence;
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
    extract: "copied from",
  };
  return `${verb[kind]} ${name}`;
}

export class DemonstrationRecorder {
  #attached = false;
  #active = false;
  #session: MutableSession | undefined;
  #startedAtMs = 0;
  #nextSequence = 1;
  readonly #pendingBrowserEvents = new Set<Promise<void>>();
  #localValues = new Map<string, string>();
  #editingActions = new Map<string, RecordedAction>();
  #recentNormalizedSelects = new Map<string, number>();
  #lastRuntimeVariableName: string | undefined;
  #nextRuntimeVariable = 1;
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
        const handle = this.#handleBrowserEvent(source.frame, payload).catch(
          (error) => {
            this.#bindingErrors.push(
              error instanceof Error ? error.message : String(error),
            );
          },
        );
        this.#pendingBrowserEvents.add(handle);
        try {
          await handle;
        } finally {
          this.#pendingBrowserEvents.delete(handle);
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
    page.on("frameattached", (frame) => {
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
    this.#nextSequence = 1;
    this.#pendingBrowserEvents.clear();
    this.#localValues.clear();
    this.#editingActions.clear();
    this.#recentNormalizedSelects.clear();
    this.#lastRuntimeVariableName = undefined;
    this.#nextRuntimeVariable = 1;
    this.#saveObservation = undefined;
    await Promise.all(
      this.context
        .pages()
        .flatMap((page) => page.frames())
        .map(async (frame) => {
          await frame.evaluate(RECORDER_INIT_SCRIPT).catch(() => undefined);
          await frame
            .evaluate("globalThis.__vc2ResetEditingTransactions?.()")
            .catch(() => undefined);
        }),
    );
    this.#session = {
      id: createId("demo"),
      startedAt: now.toISOString(),
      pages: graph.nodes,
      pageGraph: graph,
      actions: [],
      variables: [],
      outcomeCandidates: [],
      outcomeVerification: "UNVERIFIED",
      beforeState: await this.#snapshot(),
      authenticationExcluded: true,
    };
    this.#active = true;
    for (const page of this.context.pages()) this.#wireDialog(page);
    return this.session;
  }

  restore(session: DemonstrationSession, localValues: Record<string, string>) {
    if (this.#active) throw new Error("Stop teaching before restoring.");
    const migrated = {
      ...session,
      actions: session.actions.map((action, index) => ({
        ...action,
        sequence: action.sequence ?? index + 1,
      })),
      outcomeVerification:
        session.outcomeVerification !== "UNVERIFIED"
          ? session.outcomeVerification
          : session.outcomeCandidates.some((candidate) => candidate.observed)
            ? session.effectReconciliation?.status === "stable"
              ? "VERIFIED"
              : "PARTIALLY_VERIFIED"
            : "UNVERIFIED",
    };
    const parsed = DemonstrationSessionSchema.parse(migrated);
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
    await Promise.all(
      this.context
        .pages()
        .flatMap((page) => page.frames())
        .map((frame) =>
          frame
            .evaluate("globalThis.__vc2FlushEditingTransactions?.()")
            .catch(() => undefined),
        ),
    );
    while (this.#pendingBrowserEvents.size > 0)
      await Promise.all([...this.#pendingBrowserEvents]);
    const stability = await this.#waitForDomStability();
    this.#active = false;
    this.#unwireDialogs();
    this.#session.stoppedAt = new Date().toISOString();
    this.#session.pageGraph = this.graph.data();
    this.#session.pages = this.#session.pageGraph.nodes;
    this.#session.afterState = await this.#snapshot();
    this.#session.actions.sort(
      (left, right) =>
        left.timestampOffsetMs - right.timestampOffsetMs ||
        (left.captureSequence ?? left.sequence ?? 0) -
          (right.captureSequence ?? right.sequence ?? 0),
    );
    this.#normalizeSelectionsBeforeFinalize();
    this.#session.actions.forEach((action, index) => {
      action.sequence = index + 1;
    });
    this.#nextSequence = this.#session.actions.length + 1;
    await this.#reconcileOutcomeEffects(stability);
    return this.session;
  }

  async #snapshot(source?: Page | Frame) {
    const root =
      source ?? this.context.pages().find((candidate) => !candidate.isClosed());
    if (!root) return undefined;
    const page = "page" in root ? root.page() : root;
    if (page.isClosed() || ("isDetached" in root && root.isDetached()))
      return undefined;
    const frame = "page" in root ? root : root.mainFrame();
    const pageContextId = await this.graph.contextIdForFrame(frame);
    const landmarks = await root
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
      origin: canonicalizeUrl(frame.url()).origin,
      pathname: canonicalizeUrl(frame.url()).pathname,
      structuralOutline: [],
      capturedAt: new Date().toISOString(),
    };
  }

  async #waitForDomStability(
    quietPeriodMs = this.options.domQuietPeriodMs ?? 500,
    maximumObservationMs = this.options.maximumFinalReconciliationMs ?? 5_000,
    source?: Page | Frame,
  ): Promise<DomStabilityResult> {
    const root =
      source ?? this.context.pages().find((candidate) => !candidate.isClosed());
    const page = root && ("page" in root ? root.page() : root);
    if (
      !root ||
      !page ||
      page.isClosed() ||
      ("isDetached" in root && root.isDetached())
    )
      return {
        stable: false,
        observedForMs: 0,
        mutationCount: 0,
        quietPeriodMs,
        maximumObservationMs,
      };
    const result = await root
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
      const history = document.querySelector("[data-vc-consultation-history]");
      const historyItems = history
        ? Array.from(history.querySelectorAll(":scope > li"))
        : [];
      const lastItemText = String(historyItems.at(-1)?.textContent ?? "")
        .replace(/\s+/g, " ")
        .trim();
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
        if (field) {
          let fingerprint = 2166136261;
          for (let index = 0; index < field.value.length; index += 1) {
            fingerprint ^= field.value.charCodeAt(index);
            fingerprint = Math.imul(fingerprint, 16777619);
          }
          stableFieldFingerprints[label] =
            `fnv1a-${(fingerprint >>> 0).toString(16).padStart(8, "0")}`;
        }
      }
      const successMarker = document.querySelector(
        '[data-vc-outcome="success"]',
      );
      const successMarkerBox = successMarker?.getBoundingClientRect();
      const errorMarker = document.querySelector('[data-vc-outcome="error"]');
      const errorMarkerBox = errorMarker?.getBoundingClientRect();
      return {
        historyCount: history ? historyItems.length : undefined,
        editorPresent: Boolean(editor),
        editorEmpty:
          editorValue === undefined
            ? undefined
            : String(editorValue).replace(/\s+/g, " ").trim() === "",
        successMarkerVisible: Boolean(
          successMarkerBox &&
            successMarkerBox.width > 0 &&
            successMarkerBox.height > 0,
        ),
        errorMarkerVisible: Boolean(
          errorMarkerBox &&
            errorMarkerBox.width > 0 &&
            errorMarkerBox.height > 0,
        ),
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
              ["closed", "replaced"].includes(recorded.status) &&
              this.#session!.pageGraph.nodes.some(
                (node) =>
                  node.id !== recorded.id &&
                  node.role === "frame" &&
                  ["active", "open"].includes(node.status) &&
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
    const strongestOutcome = this.#session.outcomeCandidates
      .filter((candidate) => candidate.observed)
      .sort((left, right) => right.confidence - left.confidence)[0];
    this.#session.outcomeVerification = !strongestOutcome
      ? "UNVERIFIED"
      : stability.stable && strongestOutcome.confidence >= 0.85
        ? "VERIFIED"
        : "PARTIALLY_VERIFIED";
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
    if (
      payload.editingTransaction &&
      payload.editingTransaction.startedAt < this.#startedAtMs
    )
      return;
    if (await shouldExcludeFrame(frame)) {
      this.#crossOriginEventsExcluded += 1;
      return;
    }
    if (
      payload.target?.inputType?.toLowerCase() === "password" ||
      payload.target?.forbiddenValue
    ) {
      this.#passwordEventsExcluded += 1;
      return;
    }
    const pageContextId = await this.graph.contextIdForFrame(
      frame,
      payload.documentToken,
    );
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
    let outputVariable: string | undefined;
    if (payload.kind === "extract" && target) {
      outputVariable = `copied_text_${this.#nextRuntimeVariable++}`;
      this.#lastRuntimeVariableName = outputVariable;
      if (
        !this.#session.variables.some(
          (variable) => variable.name === outputVariable,
        )
      ) {
        this.#session.variables.push({
          id: createId("variable"),
          name: outputVariable,
          valueType: "string",
          privacy: "runtime-derived",
          required: true,
          description: "Ephemeral content extracted during deterministic run.",
        });
      }
    }
    let workflowValue:
      | { kind: "literal"; value: string; persistence: "workflow" }
      | {
          kind: "runtime-variable";
          name: string;
          persistence: "memory-only";
        }
      | undefined;
    if (
      target &&
      payload.value !== undefined &&
      ["fill", "select"].includes(payload.kind)
    ) {
      const runtimeVariableName =
        payload.runtimeVariableName ?? this.#lastRuntimeVariableName;
      if (payload.valueSource === "runtime-variable" && runtimeVariableName) {
        workflowValue = {
          kind: "runtime-variable",
          name: runtimeVariableName,
          persistence: "memory-only",
        };
      } else {
        workflowValue = {
          kind: "literal",
          value: payload.value,
          persistence: "workflow",
        };
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
      sequence: this.#nextSequence++,
      ...(payload.captureSequence
        ? { captureSequence: payload.captureSequence }
        : {}),
      pageContextId,
      action: payload.kind,
      name: `${pageLabel(graphNode?.role ?? "main")} — ${actionLabel(payload.kind, payload.target)}`,
      ...(target ? { target } : {}),
      ...(sequenceContext ? { sequenceContext } : {}),
      ...(workflowValue ? { value: workflowValue } : {}),
      ...(outputVariable ? { outputVariable } : {}),
      ...(payload.editingTransaction
        ? {
            editingTransaction: {
              id: payload.editingTransaction.id,
              committed: payload.editingTransaction.phase === "commit",
              inputEvents: payload.editingTransaction.inputEvents,
              compositionObserved:
                payload.editingTransaction.compositionObserved,
              pasteObserved: payload.editingTransaction.pasteObserved,
              selectionObserved: payload.editingTransaction.selectionObserved,
            },
          }
        : {}),
      ...(payload.key ? { key: payload.key } : {}),
      ...(payload.keyboardScope
        ? { keyboardScope: payload.keyboardScope }
        : {}),
      ...(payload.beforeSnapshot
        ? {
            beforeState: {
              pageContextId,
              fingerprint: payload.beforeSnapshot.fingerprint,
              visibleLandmarks: payload.beforeSnapshot.visibleLandmarks,
              origin: payload.beforeSnapshot.origin,
              pathname: payload.beforeSnapshot.pathname,
              structuralOutline: payload.beforeSnapshot.structuralOutline,
              capturedAt: new Date(payload.occurredAt).toISOString(),
            },
          }
        : {}),
      observedEffects: [],
      timestampOffsetMs: Math.max(0, payload.occurredAt - this.#startedAtMs),
      optional: false,
    });
    if (
      recorded.action === "click" &&
      recorded.target &&
      (this.#recentNormalizedSelects.get(
        `${recorded.pageContextId}:${recorded.target.fingerprint}`,
      ) ?? -Infinity) >=
        recorded.timestampOffsetMs - 600
    )
      return;
    let persistedAction: RecordedAction | undefined;
    if (payload.editingTransaction) {
      const existing = this.#editingActions.get(payload.editingTransaction.id);
      if (existing) {
        existing.value = recorded.value;
        existing.target = recorded.target;
        existing.editingTransaction = recorded.editingTransaction;
        persistedAction = existing;
      } else {
        this.#session.actions.push(recorded);
        this.#editingActions.set(payload.editingTransaction.id, recorded);
        persistedAction = recorded;
      }
      if (payload.editingTransaction.phase === "update") return;
      if (persistedAction.action === "select")
        this.#normalizeNativeSelection(persistedAction);
    } else {
      const disposition = deduplicateAction(this.#session.actions, recorded);
      persistedAction =
        disposition === "added"
          ? recorded
          : [...this.#session.actions]
              .reverse()
              .find(
                (action) =>
                  action.action === recorded.action &&
                  action.pageContextId === recorded.pageContextId &&
                  action.target?.fingerprint === recorded.target?.fingerprint,
              );
    }
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
    if (persistedAction) {
      const reaction = await this.#waitForDomStability(120, 900, frame);
      persistedAction.resultingState = await this.#snapshot(frame);
      if (
        persistedAction.target?.frame.role === "main" &&
        persistedAction.resultingState &&
        persistedAction.resultingState.pageContextId !==
          persistedAction.pageContextId &&
        !persistedAction.observedEffects.some(
          (effect) =>
            effect.type === "navigation" &&
            effect.pageContextId ===
              persistedAction.resultingState?.pageContextId,
        )
      ) {
        const resultingContext = this.graph.node(
          persistedAction.resultingState.pageContextId,
        );
        if (resultingContext)
          persistedAction.observedEffects.push({
            type: "navigation",
            pageContextId: resultingContext.id,
            fingerprint: resultingContext.structuralFingerprint,
            description: `${resultingContext.origin}${resultingContext.pathname}`,
          });
      }
      if (
        reaction.mutationCount > 0 &&
        !persistedAction.observedEffects.some(
          (effect) => effect.type === "dom-change",
        )
      ) {
        persistedAction.observedEffects.push({
          type: "dom-change",
          pageContextId,
          description: `${reaction.mutationCount} structural DOM mutation${reaction.mutationCount === 1 ? "" : "s"} observed after the action.`,
        });
      }
      if (
        !persistedAction.observedEffects.some(
          (effect) => effect.type === "stability-reconciled",
        )
      ) {
        persistedAction.observedEffects.push({
          type: "stability-reconciled",
          pageContextId,
          description: reaction.stable
            ? "The website reached a bounded stable state after the action."
            : "The bounded reaction window ended before DOM quiet.",
        });
      }
    }
  }

  #normalizeNativeSelection(selection: RecordedAction) {
    if (!this.#session || !selection.target) return;
    const selectionIndex = this.#session.actions.indexOf(selection);
    if (selectionIndex < 0) return;
    const gestureIndexes: number[] = [];
    const keys: string[] = [];
    for (let index = selectionIndex - 1; index >= 0; index -= 1) {
      const candidate = this.#session.actions[index]!;
      if (
        selection.timestampOffsetMs - candidate.timestampOffsetMs > 2_500 ||
        candidate.pageContextId !== selection.pageContextId
      )
        break;
      if (candidate.target?.fingerprint !== selection.target.fingerprint)
        continue;
      if (candidate.action === "keyboard" && candidate.key) {
        keys.unshift(candidate.key);
        gestureIndexes.unshift(index);
        continue;
      }
      if (candidate.action === "click") {
        gestureIndexes.unshift(index);
        break;
      }
    }
    if (
      keys.length === 0 ||
      !selection.editingTransaction ||
      selection.editingTransaction.inputEvents === 0
    )
      return;
    const firstGesture = this.#session.actions[gestureIndexes[0] ?? -1];
    selection.selectionGesture = {
      keys,
      nativeChangeObserved: true,
      replayKeyboardEvents: false,
    };
    if (firstGesture?.beforeState)
      selection.beforeState = firstGesture.beforeState;
    for (const index of [...gestureIndexes].sort((left, right) => right - left))
      this.#session.actions.splice(index, 1);
    this.#recentNormalizedSelects.set(
      `${selection.pageContextId}:${selection.target.fingerprint}`,
      selection.timestampOffsetMs,
    );
  }

  #normalizeSelectionsBeforeFinalize() {
    if (!this.#session) return;
    for (const action of [...this.#session.actions]) {
      if (action.action === "select" && !action.selectionGesture)
        this.#normalizeNativeSelection(action);
    }
    const normalizedSelections = this.#session.actions.filter(
      (action) => action.action === "select" && action.selectionGesture,
    );
    for (const selection of normalizedSelections) {
      const followingKeys = this.#session.actions
        .filter(
          (action) =>
            action.action === "keyboard" &&
            Boolean(action.key) &&
            action.target?.fingerprint === selection.target?.fingerprint &&
            action.pageContextId === selection.pageContextId &&
            action.timestampOffsetMs >= selection.timestampOffsetMs &&
            action.timestampOffsetMs - selection.timestampOffsetMs <= 600,
        )
        .sort(
          (left, right) =>
            left.timestampOffsetMs - right.timestampOffsetMs ||
            (left.captureSequence ?? 0) - (right.captureSequence ?? 0),
        )
        .map((action) => action.key!);
      selection.selectionGesture!.keys.push(...followingKeys);
    }
    this.#session.actions = this.#session.actions.filter((action) => {
      if (!["click", "keyboard"].includes(action.action) || !action.target)
        return true;
      return !normalizedSelections.some(
        (selection) =>
          selection.target?.fingerprint === action.target?.fingerprint &&
          selection.pageContextId === action.pageContextId &&
          action.timestampOffsetMs >= selection.timestampOffsetMs &&
          action.timestampOffsetMs - selection.timestampOffsetMs <= 600,
      );
    });
  }

  #handleGraphEvent(event: PageGraphEvent) {
    if (!this.#active || !this.#session) return;
    this.#session.pageGraph = this.graph.data();
    this.#session.pages = this.#session.pageGraph.nodes;
    const timestampOffsetMs = Math.max(0, Date.now() - this.#startedAtMs);
    const causedByActionId = [...this.#session.actions]
      .reverse()
      .find((action) =>
        [
          "click",
          "double-click",
          "fill",
          "select",
          "check",
          "uncheck",
          "keyboard",
          "submit",
          "extract",
        ].includes(action.action),
      )?.id;
    if (event.type === "page-open" && event.context.role === "popup") {
      this.#session.actions.push(
        RecordedActionSchema.parse({
          id: createId("action"),
          sequence: this.#nextSequence++,
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
          ...(causedByActionId ? { causedByActionId } : {}),
          timestampOffsetMs,
          optional: false,
        }),
      );
    } else if (event.type === "page-close" && event.context.role === "popup") {
      this.#session.actions.push(
        RecordedActionSchema.parse({
          id: createId("action"),
          sequence: this.#nextSequence++,
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
          ...(causedByActionId ? { causedByActionId } : {}),
          timestampOffsetMs,
          optional: false,
        }),
      );
    } else if (event.type === "navigation") {
      if (event.context.role === "popup") {
        const popupOpen = [...this.#session.actions]
          .reverse()
          .find(
            (action) =>
              action.action === "popup-open" &&
              action.pageContextId === event.previousContextId,
          );
        if (popupOpen) {
          popupOpen.pageContextId = event.context.id;
          for (const effect of popupOpen.observedEffects) {
            if (effect.pageContextId === event.previousContextId)
              effect.pageContextId = event.context.id;
          }
        }
      }
      const sourceAction = causedByActionId
        ? this.#session.actions.find((action) => action.id === causedByActionId)
        : undefined;
      const navigatedToDifferentDocumentPath =
        sourceAction?.beforeState?.origin !== event.context.origin ||
        sourceAction?.beforeState?.pathname !== event.context.pathname;
      if (
        sourceAction &&
        sourceAction.pageContextId === event.previousContextId &&
        navigatedToDifferentDocumentPath &&
        !sourceAction.observedEffects.some(
          (effect) =>
            effect.type === "navigation" &&
            effect.pageContextId === event.context.id,
        )
      )
        sourceAction.observedEffects.push({
          type: "navigation",
          pageContextId: event.context.id,
          fingerprint: event.context.structuralFingerprint,
          description: `${event.context.origin}${event.context.pathname}`,
        });
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
          sequence: this.#nextSequence++,
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
          ...([...this.#session.actions]
            .reverse()
            .find((action) => action.target)
            ? {
                causedByActionId: [...this.#session.actions]
                  .reverse()
                  .find((action) => action.target)!.id,
              }
            : {}),
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
