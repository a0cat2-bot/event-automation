import puppeteer, { type Browser } from 'puppeteer';

let browserPromise: Promise<Browser> | null = null;

/** Reuse one Chromium process for the application's trusted HTML renderers. */
export function getBrowser(): Promise<Browser> {
  if (browserPromise) return browserPromise;

  const launchedBrowser = puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  browserPromise = launchedBrowser;
  void launchedBrowser.catch(() => {
    browserPromise = null;
  });
  return launchedBrowser;
}
