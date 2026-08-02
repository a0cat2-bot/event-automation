import { mkdir, rm, rmdir } from 'node:fs/promises';
import { join } from 'node:path';

import {
  chromium,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Page,
} from 'playwright';

import { env } from '../config/env.js';
import { uploadsRoot } from '../utils/storage.js';
import {
  refreshSallySession,
  resolveSallySession,
  SallyConnectionRequiredError,
  SallySessionConfigurationError,
  storeSallySession,
  type StoredSallySession,
  type SallyStorageState,
} from './sallySession.js';
import type { SallySurveyDraft, SallySurveyQuestion } from './sallySurveyDraft.js';

const sallyHomeUrl = 'https://home.sally.coach/home';
const actionTimeoutMs = 30_000;
const creationActionTimeoutMs = 5_000;
const legacySessionDirectory = join(uploadsRoot, '.sally-session');
const legacySessionStatePath = join(legacySessionDirectory, 'state.json');
const exportDirectory = join(uploadsRoot, 'sally-exports');

export interface SallyCredentials {
  email: string;
  password: string;
}

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

export class SallyUiMismatchError extends Error {
  constructor(
    public readonly step: string,
    message: string,
  ) {
    super(message);
    this.name = 'SallyUiMismatchError';
  }
}

export class SallyCreationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SallyCreationError';
  }
}

export function errorMessage(error: unknown, suppliedSecrets: Array<string | undefined> = []) {
  let message = error instanceof Error ? error.message : String(error);
  const secrets = [
    ...new Set([env.sallyPassword, ...suppliedSecrets].filter(Boolean) as string[]),
  ].sort((left, right) => right.length - left.length);
  for (const secret of secrets) message = message.replaceAll(secret, '[REDACTED]');
  return message;
}

function fallbackCredentials(): SallyCredentials | undefined {
  if (!env.sallyEmail && !env.sallyPassword) return undefined;
  if (!env.sallyEmail || !env.sallyPassword) {
    throw new SallyConfigurationError(
      'Sally login failed: SALLY_EMAIL and SALLY_PASSWORD must both be configured',
    );
  }
  return { email: env.sallyEmail, password: env.sallyPassword };
}

export async function removeLegacySallySession(): Promise<void> {
  await rm(legacySessionStatePath, { force: true });
  try {
    await rmdir(legacySessionDirectory);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT' && code !== 'ENOTEMPTY') throw error;
  }
}

export function sallyBrowserContextOptions(
  storageState?: SallyStorageState,
): BrowserContextOptions {
  return {
    acceptDownloads: true,
    // Sally localizes the logged-out UI from the browser locale; the login selectors are Korean.
    locale: 'ko-KR',
    storageState,
  };
}

async function launchBrowserContext(storageState?: SallyStorageState) {
  // Deployment build step: run `npx playwright install chromium` so the bundled browser exists.
  // --no-sandbox is required on Linux hosts without the kernel namespace privileges Chrome's
  // sandbox needs (WSL2, most Docker/CI containers) — without it, launch() fails immediately.
  // This context only ever navigates to sally.coach with the coordinator's own credentials,
  // not arbitrary third-party pages, which keeps the sandbox trade-off reasonable here.
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  try {
    const context = await browser.newContext(sallyBrowserContextOptions(storageState));
    context.setDefaultTimeout(actionTimeoutMs);
    context.setDefaultNavigationTimeout(actionTimeoutMs);
    return { browser, context };
  } catch (error) {
    await browser.close().catch(() => undefined);
    throw error;
  }
}

export async function createBrowserContext(coordinatorEmail?: string): Promise<{
  browser: Browser;
  context: BrowserContext;
  loginCredentials?: SallyCredentials;
  storedSession?: StoredSallySession;
}> {
  if (!coordinatorEmail) {
    const loginCredentials = fallbackCredentials();
    if (!loginCredentials) {
      throw new SallyConfigurationError(
        'Sally login failed: connect a Sally account or configure SALLY_EMAIL and SALLY_PASSWORD',
      );
    }
    return { ...(await launchBrowserContext()), loginCredentials };
  }

  let storedSession: StoredSallySession | undefined;
  let loginCredentials: SallyCredentials | undefined;
  try {
    storedSession = await resolveSallySession(coordinatorEmail);
  } catch (error) {
    if (!(error instanceof SallyConnectionRequiredError)) throw error;
    if (error.expired) throw error;
    loginCredentials = fallbackCredentials();
    if (!loginCredentials) throw error;
  }

  try {
    return {
      ...(await launchBrowserContext(storedSession?.storageState)),
      loginCredentials,
      storedSession,
    };
  } catch (error) {
    if (storedSession) {
      throw new SallyConnectionRequiredError(
        'The stored Sally session is no longer usable. Reconnect the Sally account.',
        true,
        storedSession.storedAt,
        storedSession.lastUsedAt,
      );
    }
    throw error;
  }
}

async function openHome(page: Page) {
  await page.goto(sallyHomeUrl, {
    waitUntil: 'domcontentloaded',
    timeout: actionTimeoutMs,
  });
  // Sally is a Vue SPA; allow its logged-in/logged-out controls to render after DOM load.
  await page.waitForTimeout(750);
}

function isSallyWorkspaceUrl(url: URL): boolean {
  return (
    url.protocol === 'https:' &&
    url.hostname === 'sally.coach' &&
    /^\/workspaces\/[^/]+(?:\/|$)/.test(url.pathname)
  );
}

/**
 * Opens Sally using the context's loaded storage state and performs the recorded login flow only
 * when the logged-out control is visible. The returned page remains owned by the caller.
 */
export async function sallyLogin(
  context: BrowserContext,
  options: {
    credentials?: SallyCredentials;
    connectionRequiredError?: SallyConnectionRequiredError;
  } = {},
): Promise<Page> {
  const page = await context.newPage();
  page.setDefaultTimeout(actionTimeoutMs);
  page.setDefaultNavigationTimeout(actionTimeoutMs);

  try {
    await openHome(page);
    const loginEntry = page.locator('#home-body-main').getByText('로그인/회원가입');
    if (!(await loginEntry.isVisible())) {
      if (isSallyWorkspaceUrl(new URL(page.url()))) return page;
      throw (
        options.connectionRequiredError ??
        new Error('the login entry was unavailable and no Sally workspace session was found')
      );
    }

    const loginCredentials =
      options.credentials ?? (options.connectionRequiredError ? undefined : fallbackCredentials());
    if (!loginCredentials) {
      throw options.connectionRequiredError ?? new SallyConnectionRequiredError();
    }
    const { email, password } = loginCredentials;
    await loginEntry.click();
    await page.getByPlaceholder('아이디 또는 이메일을 입력하세요').fill(email);
    await page.getByPlaceholder('비밀번호를 입력하세요').fill(password);
    await page.getByPlaceholder('비밀번호를 입력하세요').press('Enter');
    const duplicateSessionConfirmText = page.getByText('확인', { exact: true });
    const workspaceNavigation = page
      .waitForURL(isSallyWorkspaceUrl, { timeout: actionTimeoutMs })
      .then(() => true)
      .catch(() => false);
    const loginOutcome = await Promise.race([
      workspaceNavigation.then((reached) => (reached ? 'workspace' : 'failed')),
      duplicateSessionConfirmText
        .waitFor({ state: 'visible', timeout: 5_000 })
        .then(() => 'confirm' as const)
        .catch(() => 'no-confirm' as const),
    ]);
    if (loginOutcome === 'confirm') {
      await duplicateSessionConfirmText.locator('..').click();
    }

    if (loginOutcome !== 'workspace' && !(await workspaceNavigation)) {
      throw new Error('credentials were rejected or the login session was not established');
    }

    return page;
  } catch (error) {
    await page.close().catch(() => undefined);
    if (error instanceof SallyConfigurationError || error instanceof SallyConnectionRequiredError) {
      throw error;
    }
    throw new SallyLoginError(
      `Sally login failed: ${errorMessage(error, [options.credentials?.password])}`,
    );
  }
}

export async function connectSallyAccount(
  coordinatorEmail: string,
  credentials: SallyCredentials,
): Promise<void> {
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  try {
    ({ browser, context } = await launchBrowserContext());
    await sallyLogin(context, { credentials });
    await storeSallySession(coordinatorEmail, await context.storageState());
  } finally {
    credentials.password = '';
    await context?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
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
export async function downloadSurveyResults(
  coordinatorEmail: string,
  surveyTitleText: string,
): Promise<string> {
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  let storedSession: StoredSallySession | undefined;

  try {
    const browserContext = await createBrowserContext(coordinatorEmail);
    ({ browser, context, storedSession } = browserContext);
    const page = await sallyLogin(context, {
      credentials: browserContext.loginCredentials,
      connectionRequiredError: storedSession
        ? new SallyConnectionRequiredError(
            'The stored Sally session has expired. Reconnect the Sally account.',
            true,
            storedSession.storedAt,
            storedSession.lastUsedAt,
          )
        : undefined,
    });
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
    if (storedSession) {
      await refreshSallySession(coordinatorEmail, await context.storageState());
    }
    return filePath;
  } catch (error) {
    if (
      error instanceof SallyConfigurationError ||
      error instanceof SallySessionConfigurationError ||
      error instanceof SallyConnectionRequiredError ||
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

async function creationStep<T>(step: string, action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    throw new SallyUiMismatchError(
      step,
      `Sally survey creation is unavailable at step "${step}": ${errorMessage(error)}`,
    );
  }
}

function surveyQuestionType(question: SallySurveyQuestion) {
  const typeLabel = {
    short_answer: '텍스트 응답',
    single_choice: '단수선택',
    rating_scale: '등급 척도',
  }[question.type];
  return typeLabel;
}

async function fillSingleChoiceRows(
  page: Page,
  questionEditorIndex: number,
  choices: Array<string | number>,
) {
  if (choices.length === 0) {
    throw new Error('the single-choice question has no choices in its draft');
  }

  const editors = page.locator('.ProseMirror');
  for (const [choiceIndex, choice] of choices.entries()) {
    if (choiceIndex >= 2) {
      await page.locator('.add-circle-icon').click({
        timeout: creationActionTimeoutMs,
      });
    }

    const choiceEditor = editors.nth(questionEditorIndex + choiceIndex + 1);
    try {
      await choiceEditor.waitFor({ state: 'visible', timeout: creationActionTimeoutMs });
    } catch {
      throw new Error(
        `expected choice row ${choiceIndex + 1} of ${choices.length} did not appear after the focused question editor`,
      );
    }
    await choiceEditor.pressSequentially(String(choice), {
      timeout: creationActionTimeoutMs,
    });
  }
}

async function addSurveyQuestion(page: Page, question: SallySurveyQuestion) {
  await page.getByText(surveyQuestionType(question), { exact: true }).first().click({
    timeout: creationActionTimeoutMs,
  });

  const questionEditor = page.locator('.ProseMirror-focused');
  await questionEditor.pressSequentially(question.text, {
    timeout: creationActionTimeoutMs,
  });
  const questionEditorIndex = await page
    .locator('.ProseMirror')
    .evaluateAll((editors) =>
      editors.findIndex((editor) => editor.classList.contains('ProseMirror-focused')),
    );
  if (questionEditorIndex < 0) {
    throw new Error('the focused question editor is missing from the editor list');
  }

  if (question.type === 'single_choice') {
    await fillSingleChoiceRows(page, questionEditorIndex, question.choices ?? []);
  }

  await page.getByText('필수', { exact: true }).click({
    timeout: creationActionTimeoutMs,
  });
  const saveButton = page.getByText('저장', { exact: true });
  await saveButton.click({
    timeout: creationActionTimeoutMs,
  });
  try {
    await saveButton.waitFor({
      state: 'hidden',
      timeout: creationActionTimeoutMs,
    });
  } catch {
    throw new Error('the question card did not close after save');
  }
}

/**
 * Populates the draft created by Sally's editor and returns its editor URL.
 * Selectors were measured against the live Sally editor on 2026-08-02.
 */
export async function createSallySurveyInEditor(
  page: Page,
  draft: SallySurveyDraft,
): Promise<string> {
  await creationStep('open survey editor', async () => {
    await page.getByText('작성하기', { exact: true }).click({
      timeout: creationActionTimeoutMs,
    });
    const blankSurvey = page.getByText('기본 서식 만들기', { exact: true }).first();
    await Promise.all([
      page.waitForURL(
        (url) =>
          url.protocol === 'https:' &&
          url.hostname === 'sally.coach' &&
          /^\/workspaces\/[^/]+\/surveys\/[^/]+\/edit\/?$/.test(url.pathname),
        { timeout: creationActionTimeoutMs },
      ),
      blankSurvey.click({ timeout: creationActionTimeoutMs }),
    ]);
  });

  await creationStep('enter survey details', async () => {
    await page.locator('input.base-input-line__inner__content').first().fill(draft.title, {
      timeout: creationActionTimeoutMs,
    });
    if (draft.team_name) {
      const teamField = page.getByPlaceholder('팀명을 입력해주세요');
      await teamField.fill(draft.team_name, { timeout: creationActionTimeoutMs });
      // Measured 2026-08-02: this field commits on blur, not on input. Filled and left
      // focused, the value renders but is gone after a reload. The title above survives
      // only because filling this field takes focus off it.
      await teamField.press('Tab', { timeout: creationActionTimeoutMs });
    }
    if (draft.description) {
      const descriptionEditor = page.locator('.ProseMirror').first();
      await descriptionEditor.click({ timeout: creationActionTimeoutMs });
      await descriptionEditor.pressSequentially(draft.description, {
        timeout: creationActionTimeoutMs,
      });
    }
    // TODO: Map the measured "이미지 추가" control before implementing intro banner uploads.
  });

  if (draft.completion_message) {
    const completionMessage = draft.completion_message;
    await creationStep('enter completion message', async () => {
      const submitHeading = page.getByText('설문 제출', { exact: true });
      const submitSection = page
        .locator('div')
        .filter({ has: submitHeading })
        .filter({ hasText: '설문이 성공적으로 제출되었습니다.' })
        .last();
      const completionEditor = submitSection.locator('.ProseMirror').nth(1);
      await completionEditor.click({ timeout: creationActionTimeoutMs });
      await completionEditor.pressSequentially(completionMessage, {
        timeout: creationActionTimeoutMs,
      });
    });
  }

  for (const [index, question] of draft.questions.entries()) {
    await creationStep(`add question ${index + 1}`, () => addSurveyQuestion(page, question));
  }

  await creationStep('wait for draft save', async () => {
    await page.getByText('저장됨', { exact: true }).waitFor({
      state: 'visible',
      timeout: creationActionTimeoutMs,
    });
  });

  return creationStep('capture editor URL', async () => {
    const currentUrl = page.url();
    const parsed = new URL(currentUrl);
    if (
      parsed.protocol !== 'https:' ||
      parsed.hostname !== 'sally.coach' ||
      !/^\/workspaces\/[^/]+\/surveys\/[^/]+\/edit\/?$/.test(parsed.pathname)
    ) {
      throw new Error(`the current address is not a Sally survey editor URL: ${currentUrl}`);
    }
    return parsed.href;
  });
}

/** Creates and fills an autosaved Sally survey draft without publishing it. */
export async function createSallySurvey(
  coordinatorEmail: string,
  draft: SallySurveyDraft,
): Promise<string> {
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  let page: Page | undefined;
  let storedSession: StoredSallySession | undefined;

  try {
    const browserContext = await createBrowserContext(coordinatorEmail);
    ({ browser, context, storedSession } = browserContext);
    page = await sallyLogin(context, {
      credentials: browserContext.loginCredentials,
      connectionRequiredError: storedSession
        ? new SallyConnectionRequiredError(
            'The stored Sally session has expired. Reconnect the Sally account.',
            true,
            storedSession.storedAt,
            storedSession.lastUsedAt,
          )
        : undefined,
    });
    page.setDefaultTimeout(creationActionTimeoutMs);
    page.setDefaultNavigationTimeout(creationActionTimeoutMs);
    const surveyUrl = await createSallySurveyInEditor(page, draft);
    if (storedSession) {
      await refreshSallySession(coordinatorEmail, await context.storageState());
    }
    return surveyUrl;
  } catch (error) {
    if (error instanceof SallyUiMismatchError) throw error;
    if (
      error instanceof SallyConfigurationError ||
      error instanceof SallySessionConfigurationError ||
      error instanceof SallyConnectionRequiredError ||
      error instanceof SallyLoginError
    ) {
      throw error;
    }
    throw new SallyCreationError(`Sally survey creation failed: ${errorMessage(error)}`);
  } finally {
    await context?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
  }
}
