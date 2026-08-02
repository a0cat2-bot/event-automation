import { escapeHtml } from '../routes/letters.js';
import { getSallyProgramDetails, type SallySurveyProgram } from './sallySurveyDraft.js';

export const sallyDescriptionImageWidth = 1200;
export const sallyDescriptionImageHeight = 675;

export function buildSallySurveyDescriptionHtml(params: {
  program: SallySurveyProgram;
  orgDisplayName: string;
  characterDataUrl: string | null;
}): string {
  const { description, date, time, location, application_deadline } = getSallyProgramDetails(
    params.program,
  );
  const dateTime = [date, time].filter(Boolean).join(' ');
  const schedule = [
    dateTime ? `<span>${escapeHtml(dateTime)}</span>` : '',
    application_deadline
      ? `<span class="detail-deadline">${dateTime ? '신청 마감 ' : ''}${escapeHtml(application_deadline)}</span>`
      : '',
  ].join('');
  const details = [
    schedule
      ? `<div class="detail"><span class="detail-label">${dateTime ? '일시' : '마감'}</span><span class="detail-value detail-value--schedule">${schedule}</span></div>`
      : '',
    location
      ? `<div class="detail"><span class="detail-label">장소</span><span class="detail-value">${escapeHtml(location)}</span></div>`
      : '',
  ].join('');
  const character = params.characterDataUrl
    ? `<img src="${escapeHtml(params.characterDataUrl)}" alt="">`
    : '';
  const longName = Array.from(params.program.name).length > 28;
  const longDescription = Array.from(description ?? '').length > 44;
  const canvasClasses = [
    'canvas',
    longName ? 'long-name' : '',
    longDescription ? 'long-description' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<style>
  @page { size: ${sallyDescriptionImageWidth}px ${sallyDescriptionImageHeight}px; margin: 0; }
  * { box-sizing: border-box; }
  html, body { width: ${sallyDescriptionImageWidth}px; height: ${sallyDescriptionImageHeight}px; margin: 0; overflow: hidden; }
  body { font-family: Pretendard, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif; color: #1f1d1a; }
  .canvas { position: relative; display: grid; grid-template-rows: auto 1fr auto; width: 100%; height: 100%; padding: 50px 64px 54px; overflow: hidden; background: linear-gradient(145deg, #fafaf8 0%, #fff 62%, #eef4ff 100%); }
  .canvas::before { content: ""; position: absolute; top: -130px; right: -90px; width: 420px; height: 420px; border-radius: 50%; background: rgba(49, 130, 246, .09); }
  .organization { position: relative; z-index: 1; color: #1b64da; font-size: 30px; font-weight: 700; line-height: 1.2; }
  .content { position: relative; z-index: 1; display: grid; grid-template-columns: minmax(0, 1fr) 280px; gap: 42px; align-items: center; min-height: 0; padding: 22px 0 24px; overflow: hidden; }
  .copy { min-width: 0; }
  h1 { margin: 0; max-width: 100%; color: #1f1d1a; font-size: 72px; font-weight: 700; line-height: 1.08; letter-spacing: -2.4px; overflow-wrap: anywhere; word-break: keep-all; }
  .description { margin: 22px 0 0; color: #4d4a43; font-size: 40px; font-weight: 400; line-height: 1.35; letter-spacing: -.8px; white-space: pre-line; overflow-wrap: anywhere; word-break: keep-all; }
  .long-name h1 { font-size: 54px; line-height: 1.06; letter-spacing: -1.8px; }
  .long-description .description { display: -webkit-box; margin-top: 14px; overflow: hidden; text-overflow: ellipsis; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
  .character-slot { display: flex; align-items: center; justify-content: center; width: 280px; height: 280px; }
  .character-slot img { display: block; max-width: 100%; max-height: 100%; object-fit: contain; }
  .details { position: relative; z-index: 1; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 22px; }
  .detail { display: grid; grid-template-columns: 92px minmax(0, 1fr); gap: 18px; align-items: start; min-width: 0; padding-top: 22px; border-top: 3px solid #3182f6; }
  .detail-label { color: #1b64da; font-size: 44px; font-weight: 700; line-height: 1.2; }
  .detail-value { min-width: 0; color: #1f1d1a; font-size: 44px; font-weight: 600; line-height: 1.2; letter-spacing: -1px; overflow-wrap: anywhere; word-break: keep-all; }
  .detail-value--schedule { display: grid; gap: 8px; }
  .detail-deadline { color: #4d4a43; font-size: 30px; line-height: 1.2; letter-spacing: -.6px; }
</style>
</head>
<body>
  <main class="${canvasClasses}">
    <div class="organization">${escapeHtml(params.orgDisplayName)}</div>
    <div class="content">
      <div class="copy">
        <h1>${escapeHtml(params.program.name)}</h1>
        ${description ? `<p class="description">${escapeHtml(description)}</p>` : ''}
      </div>
      <div class="character-slot" aria-hidden="true">${character}</div>
    </div>
    ${details ? `<div class="details">${details}</div>` : ''}
  </main>
</body>
</html>`;
}
