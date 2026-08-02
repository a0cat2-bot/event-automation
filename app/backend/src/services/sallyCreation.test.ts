import assert from 'node:assert/strict';
import test from 'node:test';

import type { Page } from 'playwright';

import { createSallySurveyInEditor, SallyUiMismatchError } from './sally.js';
import type { SallySurveyDraft } from './sallySurveyDraft.js';

const editorUrl = 'https://sally.coach/workspaces/workspace-1/surveys/survey-2/edit';

interface FakePageState {
  choiceRows: number;
  clicks: string[];
  fills: Array<{ target: string; value: string }>;
  textQueries: string[];
}

class FakeLocator {
  private index?: number;

  constructor(
    private readonly state: FakePageState,
    private readonly target: string,
  ) {}

  first() {
    return this;
  }

  last() {
    return this;
  }

  nth(index: number) {
    const locator = new FakeLocator(this.state, this.target);
    locator.index = index;
    return locator;
  }

  filter() {
    return this;
  }

  locator(selector: string) {
    return new FakeLocator(this.state, selector);
  }

  getByText(text: string) {
    this.state.textQueries.push(text);
    return new FakeLocator(this.state, `text:${text}`);
  }

  getByPlaceholder(placeholder: string) {
    return new FakeLocator(this.state, `placeholder:${placeholder}`);
  }

  async click() {
    this.state.clicks.push(this.target);
    if (this.target === 'text:⊕') this.state.choiceRows += 1;
  }

  async fill(value: string) {
    this.state.fills.push({ target: `${this.target}:${this.index ?? 0}`, value });
  }

  async pressSequentially(value: string) {
    this.state.fills.push({ target: `${this.target}:${this.index ?? 0}`, value });
  }

  async waitFor() {
    if (
      this.target === 'placeholder:보기를 입력해주세요' &&
      (this.index ?? 0) >= this.state.choiceRows
    ) {
      throw new Error('choice row absent');
    }
  }
}

function fakePage(choiceRows: number) {
  const state: FakePageState = { choiceRows, clicks: [], fills: [], textQueries: [] };
  const page = {
    getByText: (text: string) => {
      state.textQueries.push(text);
      return new FakeLocator(state, `text:${text}`);
    },
    getByPlaceholder: (placeholder: string) =>
      new FakeLocator(state, `placeholder:${placeholder}`),
    locator: (selector: string) => new FakeLocator(state, selector),
    waitForURL: async (matches: (url: URL) => boolean) => {
      assert.equal(matches(new URL(editorUrl)), true);
    },
    url: () => editorUrl,
  } as unknown as Page;
  return { page, state };
}

const draft: SallySurveyDraft = {
  title: '워크숍 참여자 모집',
  team_name: 'People Team',
  description: '워크숍 설명',
  completion_message: '신청해 주셔서 감사합니다.',
  questions: [
    {
      type: 'single_choice',
      text: '참여 시간을 선택해주세요.',
      choices: ['10:00', '14:00', '16:00'],
    },
  ],
};

test('Sally creation leaves the survey as a draft and returns its editor URL', async () => {
  const { page, state } = fakePage(2);

  const result = await createSallySurveyInEditor(page, draft);

  assert.equal(result, editorUrl);
  assert.equal(state.choiceRows, 3);
  assert.deepEqual(
    state.fills
      .filter(({ target }) => target.startsWith('placeholder:보기를 입력해주세요'))
      .map(({ value }) => value),
    ['10:00', '14:00', '16:00'],
  );
  assert.equal(state.textQueries.includes('배포'), false);
  assert.equal(state.textQueries.includes('설문 게시'), false);
  assert.equal(state.textQueries.includes('저장됨'), true);
});

test('a missing single-choice row fails before the question can be saved', async () => {
  const { page, state } = fakePage(0);

  await assert.rejects(
    () => createSallySurveyInEditor(page, draft),
    (error: unknown) => {
      assert.ok(error instanceof SallyUiMismatchError);
      assert.equal(error.step, 'add question 1');
      assert.match(error.message, /expected choice row 1 of 3 did not appear/);
      return true;
    },
  );
  assert.equal(state.clicks.includes('text:저장'), false);
});
