import { createServer, type Server } from "node:http";
import {
  renderCrossOriginFrame,
  renderDataflowDestination,
  renderDataflowSource,
  renderDialogWorkflow,
  renderEditorFrame,
  renderFixture,
  renderInteractionControls,
  renderKeyboardValidationWorkflow,
  renderPopupAction,
  renderPopupWorkflow,
  renderValidationPopup,
} from "./fixture";

function html(response: import("node:http").ServerResponse, body: string) {
  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(body);
}

export function createSyntheticDpiServer() {
  return createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true, synthetic: true }));
      return;
    }
    if (url.pathname === "/fixture") return html(response, renderFixture(url));
    if (url.pathname === "/fixture/validation")
      return html(response, renderValidationPopup(url));
    if (url.pathname === "/fixture/editor-frame")
      return html(response, renderEditorFrame());
    if (url.pathname === "/fixture/popup-workflow")
      return html(response, renderPopupWorkflow());
    if (url.pathname === "/fixture/popup-action")
      return html(response, renderPopupAction());
    if (url.pathname === "/fixture/cross-origin")
      return html(response, renderCrossOriginFrame());
    if (url.pathname === "/fixture/dataflow-source")
      return html(response, renderDataflowSource());
    if (url.pathname === "/fixture/dataflow-destination")
      return html(response, renderDataflowDestination());
    if (url.pathname === "/fixture/dialogs")
      return html(response, renderDialogWorkflow());
    if (url.pathname === "/fixture/controls")
      return html(response, renderInteractionControls());
    if (url.pathname === "/fixture/keyboard-validation")
      return html(response, renderKeyboardValidationWorkflow());
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Synthetic fixture not found");
  });
}

export async function startSyntheticDpiServer(
  port = Number(process.env.VC_FIXTURE_PORT ?? 4273),
  host = "127.0.0.1",
): Promise<Server> {
  const server = createSyntheticDpiServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve());
  });
  return server;
}
