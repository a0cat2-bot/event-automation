import 'dotenv/config';
import { chromium } from 'playwright';

const OUT = '/private/tmp/claude-501/-Users-euiwonjung-workspace-class/2534a9a3-351a-496b-934f-52f731a8f34e/scratchpad';
const SURVEY = 'ACVNJGNPVFWAA';
const email = process.env.SALLY_EMAIL ?? '';
const password = process.env.SALLY_PASSWORD ?? '';
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const p = await (await browser.newContext({ locale: 'ko-KR' })).newPage();
p.setDefaultTimeout(30000);
await p.goto('https://home.sally.coach/home', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(3500);
await p.locator('#home-body-main').getByText('로그인/회원가입').click();
await p.waitForTimeout(2500);
await p.getByPlaceholder('아이디 또는 이메일을 입력하세요').fill(email);
await p.getByPlaceholder('비밀번호를 입력하세요').fill(password);
await p.getByPlaceholder('비밀번호를 입력하세요').press('Enter');
await p.waitForTimeout(2500);
const dup = p.getByText('확인', { exact: true });
if (await dup.count()) { await dup.locator('..').click(); await p.waitForTimeout(4000); }

await p.goto(`https://sally.coach/workspaces/PT4NLHIJLAAQ/surveys/${SURVEY}/deliver`, { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(5000);
await p.getByText('URL 링크 공유', { exact: true }).first().click();
await p.waitForTimeout(3000);
await p.locator('[class*="sally-modal"]').getByText('작성', { exact: true }).locator('..').click();
await p.waitForTimeout(3000);

const confirmText = p.getByText('배포하시겠습니까?');
console.log('[1] 확인 대화상자:', await confirmText.count() > 0 ? '떴음' : '없음');
const ok = p.getByText('확인', { exact: true });
console.log('[2] "확인" 개수:', await ok.count());
await ok.last().locator('..').click();
await p.waitForTimeout(9000);

const text = (await p.locator('body').innerText()).replace(/\s+/g, ' ');
console.log('[3] 상태:', text.includes('배포됨') ? '배포됨' : text.includes('초안') ? '초안' : '?');
console.log('[4] 화면:', text.slice(0, 350));
const links = [...new Set((text.match(/https?:\/\/[^\s]+/g) ?? []))].filter((l) => !l.includes('/edit') && !l.includes('/deliver'));
console.log('[5] 텍스트 링크:', JSON.stringify(links.slice(0, 6)));
const inputs = await p.locator('input').evaluateAll((els) =>
  els.map((e) => ({ v: (e as HTMLInputElement).value, cls: String((e as HTMLElement).className).slice(0, 45) }))
     .filter((x) => x.v && x.v.startsWith('http')));
console.log('[6] 입력칸 링크:', JSON.stringify(inputs));
await p.screenshot({ path: `${OUT}/sally-deployed.png`, fullPage: true });
await browser.close();
