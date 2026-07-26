let renderSequence = 0;

function unstable(prefix: string) {
  renderSequence += 1;
  return `${prefix}-${Date.now().toString(36)}-${renderSequence.toString(36)}`;
}

const baseStyles = `
  :root{color-scheme:light;font-family:Inter,ui-sans-serif,system-ui,-apple-system,sans-serif;color:#17211d;background:#e8ece8}
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;background:linear-gradient(135deg,#e3e9e5 0%,#f4f1e9 100%)}
  .lab{position:sticky;top:0;z-index:10;padding:10px 18px;background:#173d31;color:#f5e7a8;font-size:13px;font-weight:900;letter-spacing:.12em;text-align:center}
  header{padding:24px clamp(20px,5vw,64px);background:#f8f6ef;border-bottom:1px solid #c6cec7}
  header p{margin:4px 0 0;color:#5a665f}
  main{width:min(980px,calc(100% - 32px));margin:26px auto 60px}
  .record{background:#fff;border:1px solid #cbd3cd;border-radius:18px;box-shadow:0 16px 50px rgba(28,47,37,.08);overflow:hidden}
  .record-title{padding:18px 22px;background:#f4f1e7;border-bottom:1px solid #d7d7cd;display:flex;justify-content:space-between;align-items:center}
  .record-title h1{margin:0;font-family:Georgia,serif;font-size:24px}
  .record-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;padding:20px}
  section{border:1px solid #d9ded9;border-radius:12px;padding:18px;background:#fff}
  .consultation{grid-column:1/-1;border-color:#8fa99c;background:#fbfdfb}
  h2{margin:0 0 14px;font-size:15px;letter-spacing:.05em;text-transform:uppercase;color:#315447}
  label{display:block;margin:12px 0 6px;font-size:13px;font-weight:800;color:#435149}
  input,textarea,select,[contenteditable=true]{width:100%;border:1px solid #aeb9b2;border-radius:7px;background:white;padding:10px 11px;font:inherit;color:#17211d;outline:none}
  input:focus,textarea:focus,select:focus,[contenteditable=true]:focus{border-color:#26765b;box-shadow:0 0 0 3px rgba(38,118,91,.14)}
  textarea,[contenteditable=true]{min-height:132px;resize:vertical}
  input[readonly],textarea[readonly]{background:#ecefeb;color:#6c766f}
  input[type=hidden]{display:none}
  iframe{width:100%;height:190px;border:1px solid #aeb9b2;border-radius:8px;background:white}
  .save{display:inline-flex;margin-top:16px;padding:11px 18px;border-radius:8px;background:#185a45;color:#fff;text-decoration:none;font-weight:900;cursor:pointer;box-shadow:0 6px 14px rgba(24,90,69,.2)}
  .save:focus{outline:3px solid #e1b84b;outline-offset:3px}
  .status{min-height:24px;margin:14px 0 0;padding:10px 12px;border-radius:7px;background:#edf1ee;color:#56635c;font-weight:700}
  .status.success{background:#dbf2e5;color:#125738}
  .status.error{background:#ffe2de;color:#8b251b}
  .meta{font-family:ui-monospace,SFMono-Regular,monospace;font-size:12px;color:#607069}
  @media(max-width:700px){.record-grid{grid-template-columns:1fr}.consultation{grid-column:auto}}
`;

function consultationEditor(mode: string) {
  const id = unstable("consult-editor");
  if (mode === "contenteditable") {
    return `<label id="${id}-label">Texte de consultation</label>
      <div id="${id}" role="textbox" aria-labelledby="${id}-label" contenteditable="true" data-vc-field="consultation" data-vc-editor="contenteditable"></div>`;
  }
  if (mode === "iframe") {
    return `<label id="${id}-label">Texte de consultation</label>
      <iframe title="Éditeur de consultation" data-vc-field="consultation-frame" src="/fixture/editor-frame"></iframe>`;
  }
  if (mode === "facade") {
    return `<label id="${id}-label">Texte de consultation</label>
      <div id="${id}" role="textbox" aria-labelledby="${id}-label" contenteditable="true"
        data-vc-field="consultation" data-vc-editor="legacy-facade" data-vc-backing="[name=consultation_backing]"></div>
      <input type="hidden" name="consultation_backing" value="">`;
  }
  if (mode === "keyboard") {
    return `<label for="${id}">Texte de consultation</label>
      <textarea id="${id}" name="consultation" data-vc-field="consultation"
        data-vc-editor="keyboard" data-vc-keyboard-dependent="true"></textarea>`;
  }
  return `<label for="${id}">Texte de consultation</label>
    <textarea id="${id}" name="consultation" data-vc-field="consultation" data-vc-editor="textarea"></textarea>`;
}

function identitySection() {
  const dateId = unstable("date");
  const timeId = unstable("time");
  return `<section aria-labelledby="schedule-heading">
    <h2 id="schedule-heading">Repères de consultation</h2>
    <label for="${dateId}">Date</label>
    <input id="${dateId}" name="date_consultation" type="text" value="26/07/2026" data-original="26/07/2026">
    <label for="${timeId}">Heure</label>
    <input id="${timeId}" name="heure_consultation" type="text" value="14:30" data-original="14:30">
  </section>`;
}

function readonlySection() {
  const id = unstable("readonly");
  return `<section aria-labelledby="summary-heading">
    <h2 id="summary-heading">Résumé synthétique</h2>
    <label for="${id}">Antécédent de démonstration</label>
    <textarea id="${id}" readonly>Champ leurre en lecture seule</textarea>
  </section>`;
}

function consultationSection(mode: string) {
  return `<section class="consultation" aria-labelledby="consultation-heading" data-vc-container="consultation">
    <h2 id="consultation-heading">Consultation</h2>
    ${consultationEditor(mode)}
    <a href="#" class="save ${unstable("legacy-save")}"
      data-vc-action="save-consultation" onclick="return saveConsultation(event)"><span>Enregistrer</span></a>
    <p class="status" role="status" data-vc-outcome="pending">Aucune modification enregistrée.</p>
    <p class="meta">Activations Enregistrer : <strong data-vc-save-count>0</strong></p>
    <h3>Historique des consultations</h3>
    <ol data-vc-consultation-history></ol>
  </section>`;
}

export function renderFixture(url: URL) {
  const variant = url.searchParams.get("variant") === "B" ? "B" : "A";
  const editor = url.searchParams.get("editor") ?? "iframe";
  const shouldFail = url.searchParams.get("fail") === "1";
  const suppressHistory = url.searchParams.get("noHistory") === "1";
  const rejectInput = url.searchParams.get("rejectInput") === "1";
  const first = variant === "A" ? identitySection() : readonlySection();
  const second = variant === "A" ? readonlySection() : identitySection();
  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>DPI synthétique · variante ${variant}</title>
  <style>${baseStyles}</style>
</head>
<body data-variant="${variant}" data-editor="${editor}">
  <div class="lab">LAB MODE — SYNTHETIC TEST RECORDS ONLY</div>
  <header>
    <strong>DPI local synthétique</strong>
    <p>Dossier TEST-VC2 · aucune donnée patient réelle</p>
    <nav aria-label="Navigation DPI synthétique">
      <a href="/fixture/home">Accueil</a>
      <a href="/fixture/records">Dossiers</a>
    </nav>
  </header>
  <main>
    <article class="record">
      <div class="record-title">
        <h1>Consultation synthétique</h1>
        <span class="meta">Variante ${variant}</span>
      </div>
      <form name="consultation-record" class="record-grid" onsubmit="return saveConsultation(event)">
        ${first}
        ${second}
        ${consultationSection(editor)}
      </form>
    </article>
  </main>
  <script>
    const shouldFail = ${JSON.stringify(shouldFail)};
    const suppressHistory = ${JSON.stringify(suppressHistory)};
    const rejectInput = ${JSON.stringify(rejectInput)};
    let saves = 0;
    function consultationValue() {
      const frame = document.querySelector('[data-vc-field="consultation-frame"]');
      if (frame?.contentDocument) return frame.contentDocument.querySelector('[data-vc-field="consultation"]')?.value || '';
      const editor = document.querySelector('[data-vc-field="consultation"]');
      return editor?.value ?? editor?.textContent ?? '';
    }
    window.__validationDone = function(ok) {
      const status = document.querySelector('[data-vc-outcome]');
      const savedConsultation = consultationValue();
      if (!ok || shouldFail || !savedConsultation.trim()) {
        status.dataset.vcOutcome = 'error';
        status.className = 'status error';
        status.textContent = 'Erreur applicative synthétique : consultation non enregistrée.';
        return;
      }
      status.dataset.vcOutcome = 'success';
      status.className = 'status success';
      status.textContent = 'Consultation synthétique enregistrée.';
      const history = document.querySelector('[data-vc-consultation-history]');
      if (!suppressHistory) {
        const entry = document.createElement('li');
        entry.textContent = 'Consultation synthétique enregistrée · ' + savedConsultation;
        history.append(entry);
      }
      const frame = document.querySelector('[data-vc-field="consultation-frame"]');
      if (frame) {
        const replacement = frame.cloneNode(false);
        frame.replaceWith(replacement);
      } else {
        const editor = document.querySelector('[data-vc-field="consultation"]');
        if (editor) {
          if (editor.isContentEditable) editor.textContent = '';
          else editor.value = '';
          const backingSelector = editor.dataset?.vcBacking;
          const backing = backingSelector ? document.querySelector(backingSelector) : undefined;
          if (backing) backing.value = '';
        }
      }
    };
    window.saveConsultation = function(event) {
      event.preventDefault();
      saves += 1;
      document.querySelector('[data-vc-save-count]').textContent = String(saves);
      const popup = window.open('/fixture/validation?result=' + (shouldFail ? 'error' : 'success'), 'vc2-validation', 'width=460,height=260');
      if (!popup) window.__validationDone(false);
      return false;
    };
    document.addEventListener('keydown', event => {
      if (event.target?.dataset?.vcKeyboardDependent === 'true') {
        event.target.dataset.vcKeyboardAccepted = 'true';
      }
    }, true);
    document.addEventListener('input', event => {
      const target = event.target;
      if (
        target?.matches?.('[data-vc-field="consultation"]') &&
        (rejectInput ||
          (target.dataset?.vcKeyboardDependent === 'true' &&
            target.dataset.vcKeyboardAccepted !== 'true'))
      ) {
        if (target.isContentEditable) target.textContent = '';
        else target.value = '';
      }
      if (target?.dataset?.vcKeyboardDependent === 'true') {
        delete target.dataset.vcKeyboardAccepted;
      }
      const backingSelector = target?.dataset?.vcBacking;
      if (backingSelector) {
        const backing = document.querySelector(backingSelector);
        if (backing) backing.value = target.textContent || '';
      }
    });
  </script>
</body>
</html>`;
}

export function renderValidationPopup(url: URL) {
  const ok = url.searchParams.get("result") !== "error";
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><title>Validation synthétique</title>
<style>${baseStyles}main{max-width:430px}.dialog{margin-top:20px;padding:24px;background:#fff;border-radius:16px;border:1px solid #ccd4ce}</style>
</head><body>
<div class="lab">LAB MODE — SYNTHETIC ONLY</div>
<main><section class="dialog" aria-labelledby="validation-heading">
<h1 id="validation-heading">Validation</h1>
<p role="status">${ok ? "Validation locale réussie" : "Validation locale en erreur"}</p>
<p>Cette fenêtre se ferme automatiquement.</p>
</section></main>
<script>
  setTimeout(() => {
    if (window.opener && !window.opener.closed) window.opener.__validationDone(${JSON.stringify(ok)});
    window.close();
  }, 240);
</script></body></html>`;
}

export function renderEditorFrame() {
  const id = unstable("frame-consultation");
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Éditeur encadré</title>
  <style>body{margin:0;padding:12px;font-family:system-ui}label{display:block;font-weight:800;margin-bottom:6px}textarea{box-sizing:border-box;width:100%;height:120px;padding:10px}</style>
  </head><body><label for="${id}">Texte de consultation</label>
  <textarea id="${id}" name="consultation_frame" data-vc-field="consultation" data-vc-editor="iframe"></textarea></body></html>`;
}

export function renderDataflowSource() {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Source synthétique</title>
  <style>${baseStyles}</style></head><body>
  <div class="lab">LAB MODE — SYNTHETIC ONLY</div>
  <main><section aria-labelledby="source-heading">
    <h1 id="source-heading">Source de transfert</h1>
    <label for="copy-source">Texte source</label>
    <textarea id="copy-source" readonly data-vc-copy-source="true">SYNTHETIC-RUNTIME-COPIED-CONTENT</textarea>
    <a href="/fixture/dataflow-destination" data-vc-action="open-destination">Ouvrir la destination</a>
  </section></main></body></html>`;
}

export function renderDataflowDestination() {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Destination synthétique</title>
  <style>${baseStyles}</style></head><body>
  <div class="lab">LAB MODE — SYNTHETIC ONLY</div>
  <main><section aria-labelledby="destination-heading">
    <h1 id="destination-heading">Destination de transfert</h1>
    <label for="copy-destination">Texte destination</label>
    <textarea id="copy-destination" data-vc-field="copy-destination"></textarea>
  </section></main></body></html>`;
}

export function renderPopupWorkflow() {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Workflow popup synthétique</title>
  <style>${baseStyles}</style></head><body>
  <div class="lab">LAB MODE — SYNTHETIC TEST RECORDS ONLY</div>
  <main><article class="record"><div class="record-title"><h1>Validation popup avancée</h1></div>
  <div class="record-grid"><section class="consultation">
  <h2>Action principale</h2>
  <button type="button" data-vc-open-popup>Ouvrir la validation détaillée</button>
  <p class="status" role="status" data-vc-outcome="pending">Validation en attente.</p>
  </section></div></article></main>
  <script>
    document.querySelector('[data-vc-open-popup]').addEventListener('click', () => {
      window.open('/fixture/popup-action', 'vc2-action-popup', 'width=520,height=360');
    });
    window.__popupActionDone = function(value, note) {
      const status = document.querySelector('[data-vc-outcome]');
      status.dataset.vcOutcome = 'success';
      status.className = 'status success';
      status.textContent = 'Option ' + value + ' validée dans la popup.';
      document.body.dataset.vcPopupNote = note;
    };
  </script></body></html>`;
}

export function renderPopupAction() {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Choix de validation synthétique</title>
  <style>${baseStyles}</style></head><body><div class="lab">LAB MODE — SYNTHETIC ONLY</div>
  <main><section aria-labelledby="popup-heading"><h1 id="popup-heading">Validation détaillée</h1>
  <label for="popup-note">Note synthétique popup</label>
  <input id="popup-note" name="popup_note" type="text">
  <label for="decision">Décision synthétique</label>
  <select id="decision" name="decision"><option value="">Choisir</option><option value="A">Option A</option><option value="B">Option B</option></select>
  <button type="button" data-vc-confirm>Valider et fermer</button></section></main>
  <script>document.querySelector('[data-vc-confirm]').addEventListener('click', () => {
    const value = document.querySelector('#decision').value;
    const note = document.querySelector('#popup-note').value;
    if (window.opener && !window.opener.closed) window.opener.__popupActionDone(value, note);
    setTimeout(() => window.close(), 180);
  });</script></body></html>`;
}

export function renderCrossOriginFrame() {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Opaque support frame</title></head>
  <body><label>External note <textarea data-secret-content>Must remain opaque</textarea></label></body></html>`;
}

export function renderDialogWorkflow() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Synthetic dialog workflow</title>
  <style>${baseStyles}</style></head><body><div class="lab">LAB MODE — SYNTHETIC TEST RECORDS ONLY</div>
  <main><article class="record"><div class="record-title"><h1>Dialog lifecycle</h1></div>
  <div class="record-grid"><section class="consultation" aria-labelledby="dialog-heading">
  <h2 id="dialog-heading">Local browser dialogs</h2>
  <button type="button" data-dialog="alert">Open alert</button>
  <button type="button" data-dialog="confirm">Open confirm</button>
  <p class="status" role="status" data-vc-outcome="pending">No dialog handled.</p>
  </section></div></article></main>
  <script>
    const status = document.querySelector('[data-vc-outcome]');
    document.querySelector('[data-dialog="alert"]').addEventListener('click', () => setTimeout(() => {
      alert('Synthetic alert');
      status.dataset.vcOutcome = 'pending';
      status.textContent = 'Alert accepted.';
    }, 50));
    document.querySelector('[data-dialog="confirm"]').addEventListener('click', () => setTimeout(() => {
      const accepted = confirm('Synthetic confirm');
      status.dataset.vcOutcome = accepted ? 'error' : 'success';
      status.className = accepted ? 'status error' : 'status success';
      status.textContent = accepted ? 'Confirm unexpectedly accepted.' : 'Confirm dismissed as demonstrated.';
    }, 50));
  </script></body></html>`;
}

export function renderInteractionControls() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Synthetic interaction controls</title>
  <style>${baseStyles}.menu[hidden]{display:none}.menu{margin-top:8px;padding:8px;border:1px solid #aeb9b2;border-radius:8px}.menu button{display:block;width:100%;padding:8px;text-align:left}</style>
  </head><body><div class="lab">LAB MODE — SYNTHETIC TEST RECORDS ONLY</div>
  <main><article class="record"><div class="record-title"><h1>Interaction controls</h1></div>
  <form name="interaction-controls" class="record-grid">
  <section aria-labelledby="text-heading"><h2 id="text-heading">Keyboard</h2>
  <label for="note">Synthetic note</label><input id="note" name="note" type="text">
  </section>
  <section aria-labelledby="choice-heading"><h2 id="choice-heading">Choices</h2>
  <label><input name="tracking" type="checkbox"> Enable tracking</label>
  <label for="priority">Priority</label>
  <select id="priority" name="priority"><option value="">Choose</option><option value="high">High</option></select>
  <button type="button" aria-expanded="false" data-menu-trigger><span>Choose category</span></button>
  <div class="menu" role="menu" hidden>
    <button type="button" role="menuitem" data-category="review"><span>Review</span></button>
  </div>
  <p class="status" role="status" data-vc-outcome="pending">No category chosen.</p>
  </section></form></article></main>
  <script>
    const trigger = document.querySelector('[data-menu-trigger]');
    const menu = document.querySelector('[role=menu]');
    trigger.addEventListener('click', () => {
      const opening = menu.hidden;
      menu.hidden = !opening;
      trigger.setAttribute('aria-expanded', String(opening));
    });
    document.querySelector('[role=menuitem]').addEventListener('click', event => {
      const status = document.querySelector('[data-vc-outcome]');
      status.dataset.vcOutcome = 'success';
      status.className = 'status success';
      status.textContent = 'Category ' + event.currentTarget.dataset.category + ' selected.';
      menu.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
    });
  </script></body></html>`;
}
