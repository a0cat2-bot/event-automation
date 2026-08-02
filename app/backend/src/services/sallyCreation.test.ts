import assert from 'node:assert/strict';
import test from 'node:test';

import type { Page } from 'playwright';

import { createSallySurveyInEditor, SallyUiMismatchError } from './sally.js';
import type { SallySurveyDraft } from './sallySurveyDraft.js';

const editorUrl = 'https://sally.coach/workspaces/workspace-1/surveys/survey-2/edit';

interface FakePageState {
  choiceRows: number;
  clicks: string[];
  evaluateAllQueries: string[];
  fills: Array<{ target: string; value: string }>;
  firstSelections: string[];
  focusedEditorIndex: number;
  keyPresses: Array<{ target: string; key: string }>;
  placeholderQueries: string[];
  saveCloses: boolean;
  savePending: boolean;
  sequentialPresses: Array<{ target: string; value: string }>;
  textQueries: string[];
  waits: Array<{ state: string | undefined; target: string }>;
}

class FakeLocator {
  private index?: number;

  constructor(
    private readonly state: FakePageState,
    private readonly target: string,
  ) {}

  first() {
    this.state.firstSelections.push(this.target);
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
    return new FakeLocator(this.state, `${this.target} ${selector}`);
  }

  getByText(text: string) {
    this.state.textQueries.push(text);
    return new FakeLocator(this.state, `${this.target} text:${text}`);
  }

  getByPlaceholder(placeholder: string) {
    this.state.placeholderQueries.push(placeholder);
    return new FakeLocator(this.state, `placeholder:${placeholder}`);
  }

  async click() {
    if (
      ['text:단수선택', 'text:등급 척도', 'text:텍스트 응답'].includes(this.target) &&
      this.state.savePending
    ) {
      throw new Error('the next question was added before the previous save cleared');
    }
    this.state.clicks.push(this.target);
    if (this.target.endsWith('.add-circle-icon')) this.state.choiceRows += 1;
    if (this.target === 'text:저장') this.state.savePending = true;
  }

  async fill(value: string) {
    this.state.fills.push({ target: `${this.target}:${this.index ?? 0}`, value });
  }

  async press(key: string) {
    this.state.keyPresses.push({ target: `${this.target}:${this.index ?? 0}`, key });
  }

  async pressSequentially(value: string) {
    this.state.fills.push({ target: `${this.target}:${this.index ?? 0}`, value });
    this.state.sequentialPresses.push({
      target: `${this.target}:${this.index ?? 0}`,
      value,
    });
  }

  async waitFor(options?: { state?: string }) {
    this.state.waits.push({ state: options?.state, target: this.target });
    if (this.target === 'text:저장' && options?.state === 'hidden') {
      if (!this.state.saveCloses) throw new Error('save remained visible');
      this.state.savePending = false;
    }
    if (
      this.target === '.ProseMirror' &&
      (this.index ?? 0) > this.state.focusedEditorIndex + this.state.choiceRows
    ) {
      throw new Error('choice row absent');
    }
  }

  async evaluateAll() {
    this.state.evaluateAllQueries.push(this.target);
    return this.state.focusedEditorIndex;
  }
}

function fakePage(choiceRows: number, saveCloses = true) {
  const state: FakePageState = {
    choiceRows,
    clicks: [],
    evaluateAllQueries: [],
    fills: [],
    firstSelections: [],
    focusedEditorIndex: 1,
    keyPresses: [],
    placeholderQueries: [],
    saveCloses,
    savePending: false,
    sequentialPresses: [],
    textQueries: [],
    waits: [],
  };
  const page = {
    getByText: (text: string) => {
      state.textQueries.push(text);
      return new FakeLocator(state, `text:${text}`);
    },
    getByPlaceholder: (placeholder: string) => {
      state.placeholderQueries.push(placeholder);
      return new FakeLocator(state, `placeholder:${placeholder}`);
    },
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
    state.sequentialPresses
      .filter(({ value }) => ['10:00', '14:00', '16:00'].includes(value))
      .map(({ target }) => target),
    ['.ProseMirror:2', '.ProseMirror:3', '.ProseMirror:4'],
  );
  assert.deepEqual(state.evaluateAllQueries, ['.ProseMirror']);
  assert.equal(state.placeholderQueries.includes('보기를 입력해주세요'), false);
  assert.equal(state.clicks.includes('.add-circle-icon'), true);
  assert.equal(state.clicks.includes('text:⊕'), false);
  assert.equal(state.clicks.includes('text:필수'), true);
  assert.equal(state.clicks.includes('text:저장'), true);
  assert.equal(state.firstSelections.includes('text:단수선택'), true);
  assert.equal(state.textQueries.includes('배포'), false);
  assert.equal(state.textQueries.includes('설문 게시'), false);
  assert.equal(state.textQueries.includes('저장됨'), true);
});

test('the team name is blurred, because the field only commits on blur', async () => {
  const { page, state } = fakePage(2);

  await createSallySurveyInEditor(page, draft);

  assert.equal(
    state.fills.some(({ target }) => target === 'placeholder:팀명을 입력해주세요:0'),
    true,
  );
  assert.deepEqual(
    state.keyPresses.filter(({ target }) => target.startsWith('placeholder:팀명')),
    [{ target: 'placeholder:팀명을 입력해주세요:0', key: 'Tab' }],
  );
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

test('the previous question save clears before the next question is added', async () => {
  const { page, state } = fakePage(2);
  const twoQuestionDraft: SallySurveyDraft = {
    ...draft,
    questions: [
      ...draft.questions,
      { type: 'short_answer', text: '이름을 입력해주세요.' },
    ],
  };

  await createSallySurveyInEditor(page, twoQuestionDraft);

  assert.deepEqual(
    state.waits.filter(({ target }) => target === 'text:저장'),
    [
      { state: 'hidden', target: 'text:저장' },
      { state: 'hidden', target: 'text:저장' },
    ],
  );
  assert.equal(state.savePending, false);
});

test('a question card that does not close fails at that question step', async () => {
  const { page } = fakePage(2, false);

  await assert.rejects(
    () => createSallySurveyInEditor(page, draft),
    (error: unknown) => {
      assert.ok(error instanceof SallyUiMismatchError);
      assert.equal(error.step, 'add question 1');
      assert.match(error.message, /question card did not close after save/);
      return true;
    },
  );
});
