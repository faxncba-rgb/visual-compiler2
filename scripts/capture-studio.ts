import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const outputDirectory = path.resolve("docs", "screenshots");
await mkdir(outputDirectory, { recursive: true });

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1000 },
    deviceScaleFactor: 1,
  });
  await page.goto("http://127.0.0.1:3100", {
    waitUntil: "networkidle",
  });
  await page.screenshot({
    path: path.join(outputDirectory, "studio-lab.png"),
    fullPage: true,
  });
} finally {
  await browser.close();
}
