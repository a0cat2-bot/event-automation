import { access, chmod, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

import { env } from '../config/env.js';
import { uploadsRoot } from '../utils/storage.js';

const sallyHomeUrl = 'https://home.sally.coach/home';
const actionTimeoutMs = 30_000;
const sessionDirectory = join(uploadsRoot, '.sally-session');
const sessionStatePath = join(sessionDirectory, 'state.json');
const exportDirectory = join(uploadsRoot, 'sally-exports');

// TODO: survey creation/duplication automation deferred — this pass only does login + results download

export class SallyConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SallyConfigurationError';
  }
}

export class SallyLoginError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SallyLoginError';
  }
}

export class SallySurveyNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SallySurveyNotFoundError';
  }
}

export class SallyDownloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SallyDownloadError';
  }
}

function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return env.sallyPassword ? message.replaceAll(env.sallyPassword, '[REDACTED]') : message;
}

function credentials() {
  if (!env.sallyEmail || !env.sallyPassword) {
    throw new SallyConfigurationError(
      'Sally login failed: SALLY_EMAIL and SALLY_PASSWORD are required',
    );
  }
  return { email: env.sallyEmail, password: env.sallyPassword };
}

async function savedStorageStatePath() {
  try {
    await access(sessionStatePath);
    return sessionStatePath;
  } catch {
    return undefined;
  }
}

async function saveStorageState(context: BrowserContext) {
  await mkdir(sessionDirectory, { recursive: true });
  await context.storageState({ path: sessionStatePath });
  await chmod(sessionStatePath, 0o600);
}

async function createBrowserContext(): Promise<{ browser: Browser; context: BrowserContext }> {
  // Deployment build step: run `npx playwright install chromium` so the bundled browser exists.
  // --no-sandbox is required on Linux hosts without the kernel namespace privileges Chrome's
  // sandbox needs (WSL2, most Docker/CI containers) — without it, launch() fails immediately.
  // This context only ever navigates to sally.coach with the coordinator's own credentials,
  // not arbitrary third-party pages, which keeps the sandbox trade-off reasonable here.
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const storageState = await savedStorageStatePath();

  let context: BrowserContext;
  try {
    context = await browser.newContext({ acceptDownloads: true, storageState });
  } catch {
    // A truncated or incompatible local state file should not prevent a fresh login.
    context = await browser.newContext({ acceptDownloads: true });
  }
  context.setDefaultTimeout(actionTimeoutMs);
  context.setDefaultNavigationTimeout(actionTimeoutMs);
  return { browser, context };
}

async function openHome(page: Page) {
  await page.goto(sallyHomeUrl, {
    waitUntil: 'domcontentloaded',
    timeout: actionTimeoutMs,
  });
  // Sally is a Vue SPA; allow its logged-in/logged-out controls to render after DOM load.
  await page.waitForTimeout(750);
}

/**
 * Opens Sally using the context's loaded storage state and performs the recorded login flow only
 * when the logged-out control is visible. The returned page remains owned by the caller.
 */
export async function sallyLogin(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  page.setDefaultTimeout(actionTimeoutMs);
  page.setDefaultNavigationTimeout(actionTimeoutMs);

  try {
    await openHome(page);
    const loginEntry = page.locator('#home-body-main').getByText('로그인/회원가입');
    if (!(await loginEntry.isVisible())) return page;

    const { email, password } = credentials();
    await loginEntry.click();
    await page.getByPlaceholder('아이디 또는 이메일을 입력하세요').fill(email);
    await page.getByPlaceholder('비밀번호를 입력하세요').fill(password);
    await page.getByPlaceholder('비밀번호를 입력하세요').press('Enter');
    await page.getByText('확인').click();

    await openHome(page);
    if (await page.locator('#home-body-main').getByText('로그인/회원가입').isVisible()) {
      throw new Error('credentials were rejected or the login session was not established');
    }

    await saveStorageState(context);
    return page;
  } catch (error) {
    await page.close().catch(() => undefined);
    if (error instanceof SallyConfigurationError) throw error;
    throw new SallyLoginError(`Sally login failed: ${errorMessage(error)}`);
  }
}

function sanitizedTitle(title: string) {
  const sanitized = title
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
  return sanitized || 'survey';
}

function exportTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

/** Downloads the first survey whose visible title text matches `surveyTitleText`. */
export async function downloadSurveyResults(surveyTitleText: string): Promise<string> {
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;

  try {
    ({ browser, context } = await createBrowserContext());
    const page = await sallyLogin(context);
    const survey = page.getByText(surveyTitleText).first();

    try {
      await survey.waitFor({ state: 'visible', timeout: actionTimeoutMs });
    } catch {
      throw new SallySurveyNotFoundError(
        `Sally survey not found: no visible survey matched "${surveyTitleText}"`,
      );
    }

    await survey.click();
    await page.getByRole('link', { name: '결과' }).click();
    await page.getByText('문항 요약').click();
    await page.getByText('가져오기').click();
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: actionTimeoutMs }),
      page.getByText('결과 전체 다운받기').click(),
    ]);

    const downloadFailure = await download.failure();
    if (downloadFailure) throw new Error(downloadFailure);

    await mkdir(exportDirectory, { recursive: true });
    const filePath = join(
      exportDirectory,
      `${exportTimestamp()}-${sanitizedTitle(surveyTitleText)}.xlsx`,
    );
    await download.saveAs(filePath);
    await saveStorageState(context);
    return filePath;
  } catch (error) {
    if (
      error instanceof SallyConfigurationError ||
      error instanceof SallyLoginError ||
      error instanceof SallySurveyNotFoundError ||
      error instanceof SallyDownloadError
    ) {
      throw error;
    }
    throw new SallyDownloadError(`Sally download failed: ${errorMessage(error)}`);
  } finally {
    await context?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
  }
}
