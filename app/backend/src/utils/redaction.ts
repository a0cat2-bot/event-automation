/**
 * Removes identifying numbers from employee-written free text before it is sent to an LLM.
 *
 * The app never puts names or emails into a prompt as structured fields — the model
 * only ever receives an opaque id and the text itself. But a justification or a survey comment is
 * written by a person, and people include contact details and employee numbers when introducing
 * themselves. No schema can prevent that, so it is stripped here.
 *
 * This matters because AI Pro requires Data Privacy team approval before a service may send
 * personal data, and that approval is not available to this app.
 *
 * Names are deliberately left in place. They are the one identifier the organisation treats as
 * acceptable to handle, and removing them reliably would mean matching Korean given names that
 * double as ordinary words — corrupting the text for a benefit the app does not need. Evaluation
 * fairness is handled where it belongs, in the screening prompt, which instructs the model to
 * disregard any name, gender, department or rank it encounters.
 *
 * Only the copy sent to the model is redacted. The stored original is untouched, so coordinators
 * still read what the employee actually wrote, report quotes stay byte-identical to the source, and
 * the non-AI fallback scores the real text.
 */

/** Run before the phone and bare-digit rules, which would otherwise split it. */
const RESIDENT_REGISTRATION_NUMBER = /\d{6}\s*[-–—]\s*\d{7}/g;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const KOREAN_MOBILE = /(?:\+?82[-\s.]?)?0?1[016789][-\s.]?\d{3,4}[-\s.]?\d{4}/g;
const DASHED_PHONE = /\d{2,4}[-\s.]\d{3,4}[-\s.]\d{4}/g;
/** Employee numbers are personal data in this organisation and are never stored by the app. */
const LABELLED_EMPLOYEE_NUMBER = /(?:사번|사원번호|직원번호)\s*[은는이가:]?\s*\d{4,}/g;
/**
 * Any remaining long digit run. A six-digit-plus number is rarely load-bearing in a motivation
 * essay or a survey comment, whereas an unlabelled employee number is exactly what it looks like.
 * Years and short quantities are four digits or fewer and survive.
 */
const LONG_DIGIT_RUN = /\d{6,}/g;

/** Redacts `text` for outbound use. Returns it unchanged when there is nothing to remove. */
export function redactPersonalData(text: string): string {
  return text
    .replace(RESIDENT_REGISTRATION_NUMBER, '[주민등록번호]')
    .replace(EMAIL, '[이메일]')
    .replace(KOREAN_MOBILE, '[전화번호]')
    .replace(DASHED_PHONE, '[전화번호]')
    .replace(LABELLED_EMPLOYEE_NUMBER, '[사번]')
    .replace(LONG_DIGIT_RUN, '[숫자]');
}

interface IdentifiedApplicant {
  email: string;
  name: string | null;
}

/**
 * Replaces applicant identity with a positional handle, for the MCP surface.
 *
 * The allowance above — that names may stay — covers the in-app provider, which is the company's
 * own gateway. It does not extend to an outside agent reading these rows through MCP, so this
 * boundary is stricter: identity is dropped rather than obscured, because a field that is never
 * sent cannot be reconstructed.
 *
 * Nothing is lost by it. Every tool that acts on an applicant takes the id, so an agent can score
 * and select without knowing who anyone is; the handle exists only so its explanation reads as
 * "신청자 3" rather than a UUID, and stays matchable against the ordering a coordinator sees in
 * the app.
 */
export function withApplicantHandles<T extends IdentifiedApplicant>(
  applicants: T[],
): Array<Omit<T, 'email' | 'name'> & { handle: string }> {
  return applicants.map(({ email: _email, name: _name, ...rest }, index) => ({
    ...rest,
    handle: `신청자 ${index + 1}`,
  }));
}
