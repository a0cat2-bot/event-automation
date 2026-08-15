import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';

import type { BrowserContext } from 'playwright';

import { SallyLoginError, sallyBrowserContextOptions, sallyLogin } from './sally.js';
import {
  decryptSallyStorageState,
  encryptSallyStorageState,
  resolveSallySession,
  SallyConnectionRequiredError,
  SallySessionConfigurationError,
  storeSallySession,
  type SallyStorageState,
} from './sallySession.js';

const key = randomBytes(32).toString('base64');
const email = 'Coordinator@Example.com';
const storageState: SallyStorageState = {
  cookies: [
    {
      name: 'sally_session',
      value: 'readable-cookie-secret',
      domain: '.sally.coach',
      path: '/',
      expires: -1,
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
    },
  ],
  origins: [
    {
      origin: 'https://home.sally.coach',
      localStorage: [{ name: 'session', value: 'readable-local-storage-secret' }],
    },
  ],
};

type Query = NonNullable<Parameters<typeof storeSallySession>[2]>['query'];

test('Sally browser contexts use the Korean locale expected by the login selectors', () => {
  assert.equal(sallyBrowserContextOptions(storageState).locale, 'ko-KR');
});

test('Sally storage state encrypts and decrypts without readable plaintext', () => {
  const encrypted = encryptSallyStorageState(email, storageState, key);

  assert.deepEqual(decryptSallyStorageState(email.toLowerCase(), encrypted, key), storageState);
  assert.doesNotMatch(encrypted, /readable-cookie-secret/);
  assert.doesNotMatch(encrypted, /readable-local-storage-secret/);
});

test('a missing encryption key refuses to store a Sally session', async () => {
  let queried = false;
  const query = (async () => {
    queried = true;
    return { rows: [] };
  }) as unknown as Query;

  // Passing the key explicitly as undefined must mean undefined. It once did not: the encrypt
  // helper carried `= env.sallySessionEncryptionKey` as a default, and a default fills in for an
  // explicit undefined — so this refusal quietly became "encrypt with whatever .env holds", and
  // the test only still passed because the developer's .env had no key in it.
  await assert.rejects(
    () => storeSallySession(email, storageState, { encryptionKey: undefined, query }),
    SallySessionConfigurationError,
  );
  assert.equal(queried, false);
});

test('a supplied Sally password is redacted from login errors', async () => {
  const password = 'distinctive-password-9XZ!';
  const page = {
    setDefaultTimeout() {},
    setDefaultNavigationTimeout() {},
    goto: async () => {
      throw new Error(`forced failure containing ${password}`);
    },
    close: async () => undefined,
  };
  const context = {
    newPage: async () => page,
  } as unknown as BrowserContext;

  await assert.rejects(
    () =>
      sallyLogin(context, {
        credentials: { email: 'sally-id', password },
      }),
    (error: unknown) => {
      assert.ok(error instanceof SallyLoginError);
      assert.equal(error.message.includes(password), false);
      assert.match(error.message, /\[REDACTED\]/);
      return true;
    },
  );
});

test('Sally login accepts a dynamic workspace URL without a duplicate-session dialog', async () => {
  let confirmClicked = false;
  const loginEntry = {
    isVisible: async () => true,
    click: async () => undefined,
  };
  const passwordInput = {
    fill: async () => undefined,
    press: async () => undefined,
  };
  const page = {
    setDefaultTimeout() {},
    setDefaultNavigationTimeout() {},
    goto: async () => undefined,
    waitForTimeout: async () => undefined,
    locator: () => ({ getByText: () => loginEntry }),
    getByPlaceholder: (placeholder: string) =>
      placeholder === '비밀번호를 입력하세요' ? passwordInput : { fill: async () => undefined },
    getByText: (text: string, options: { exact: boolean }) => {
      assert.equal(text, '확인');
      assert.deepEqual(options, { exact: true });
      return {
        waitFor: async () => {
          throw new Error('dialog absent');
        },
        locator: () => ({
          click: async () => {
            confirmClicked = true;
          },
        }),
      };
    },
    waitForURL: async (matches: (url: URL) => boolean) => {
      assert.equal(matches(new URL('https://sally.coach/workspaces/account-specific-id')), true);
    },
    url: () => 'https://home.sally.coach/home',
    close: async () => undefined,
  };
  const context = { newPage: async () => page } as unknown as BrowserContext;

  const result = await sallyLogin(context, {
    credentials: { email: 'sally-id', password: 'password' },
  });

  assert.equal(result, page);
  assert.equal(confirmClicked, false);
});

test('Sally login waits for duplicate-session confirmation text and clicks its wrapper', async () => {
  let confirmClicked = false;
  let resolveWorkspace!: () => void;
  const workspaceReached = new Promise<void>((resolve) => {
    resolveWorkspace = resolve;
  });
  const loginEntry = {
    isVisible: async () => true,
    click: async () => undefined,
  };
  const passwordInput = {
    fill: async () => undefined,
    press: async () => undefined,
  };
  const page = {
    setDefaultTimeout() {},
    setDefaultNavigationTimeout() {},
    goto: async () => undefined,
    waitForTimeout: async () => undefined,
    locator: () => ({ getByText: () => loginEntry }),
    getByPlaceholder: (placeholder: string) =>
      placeholder === '비밀번호를 입력하세요' ? passwordInput : { fill: async () => undefined },
    getByText: (text: string, options: { exact: boolean }) => {
      assert.equal(text, '확인');
      assert.deepEqual(options, { exact: true });
      return {
        waitFor: async (waitOptions: { state: string; timeout: number }) => {
          assert.equal(waitOptions.state, 'visible');
          assert.ok(waitOptions.timeout >= 4_000);
          await new Promise<void>((resolve) => setImmediate(resolve));
        },
        locator: (selector: string) => {
          assert.equal(selector, '..');
          return {
            click: async () => {
              confirmClicked = true;
              resolveWorkspace();
            },
          };
        },
      };
    },
    waitForURL: async (matches: (url: URL) => boolean) => {
      assert.equal(matches(new URL('https://sally.coach/workspaces/account-specific-id')), true);
      await workspaceReached;
    },
    url: () => 'https://home.sally.coach/home',
    close: async () => undefined,
  };
  const context = { newPage: async () => page } as unknown as BrowserContext;

  const result = await sallyLogin(context, {
    credentials: { email: 'sally-id', password: 'password' },
  });

  assert.equal(result, page);
  assert.equal(confirmClicked, true);
});

test('an unusable stored Sally session keeps the connection-required error', async () => {
  const connectionRequired = new SallyConnectionRequiredError('Reconnect Sally.', true);
  const page = {
    setDefaultTimeout() {},
    setDefaultNavigationTimeout() {},
    goto: async () => undefined,
    waitForTimeout: async () => undefined,
    locator: () => ({ getByText: () => ({ isVisible: async () => false }) }),
    url: () => 'https://home.sally.coach/home',
    close: async () => undefined,
  };
  const context = { newPage: async () => page } as unknown as BrowserContext;

  await assert.rejects(
    () => sallyLogin(context, { connectionRequiredError: connectionRequired }),
    (error: unknown) => error === connectionRequired,
  );
});

test('resolving a user with no Sally session requires connection', async () => {
  const query = (async () => ({ rows: [] })) as unknown as Query;

  await assert.rejects(
    () => resolveSallySession(email, { encryptionKey: key, query }),
    (error: unknown) => {
      assert.ok(error instanceof SallyConnectionRequiredError);
      assert.equal(error.expired, false);
      return true;
    },
  );
});
