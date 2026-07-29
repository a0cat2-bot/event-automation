import { useEffect, useState } from 'react';
import { Link, NavLink } from 'react-router-dom';

import { getProgram, type Program } from '../api/programs';
import { programDateDisplay, SELECTION_MODE_LABELS } from '../utils/program';

// Shown at the top of every /programs/:programId/* sub-page so a coordinator working inside
// one section (e.g. 참여자 선정) never loses sight of which program they're in, and can jump
// straight to another section without backing out to the detail page first.
export function ProgramContextBar({ programId }: { programId: string }) {
  const [program, setProgram] = useState<Program | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let isCurrent = true;

    getProgram(programId, controller.signal)
      .then(({ program: next }) => {
        if (isCurrent) setProgram(next);
      })
      .catch(() => {
        // Silent — the page's own data loading will surface a real error if the program
        // is genuinely missing; this bar is a convenience, not the source of truth.
      });

    return () => {
      isCurrent = false;
      controller.abort();
    };
  }, [programId]);

  if (!program) return null;

  const base = `/programs/${programId}`;
  const date = programDateDisplay(program.intake_data);

  return (
    <div className="program-context-bar">
      <div>
        <Link className="program-context-bar__name" to={base}>
          {program.name}
        </Link>
        <p className="program-context-bar__meta">
          {program.business_unit} · {SELECTION_MODE_LABELS[program.selection_mode]}
          {date ? ` · ${date}` : ''} · 참여 {program.participant_count}/{program.max_participants}명
        </p>
      </div>
      <nav className="workflow-links" aria-label="프로그램 진행 단계">
        <NavLink to={`${base}/letters`}>레터 미리보기/발송 준비</NavLink>
        <NavLink to={`${base}/applicants/upload`}>신청자 업로드</NavLink>
        <NavLink to={`${base}/selection`}>참여자 선정</NavLink>
        <NavLink to={`${base}/notifications`}>안내메일 발송</NavLink>
        <NavLink to={`${base}/surveys`}>만족도 설문 결과</NavLink>
        <NavLink to={`${base}/gifts`}>상품 수령자 선정</NavLink>
        <NavLink to={`${base}/reports`}>결과 보고서</NavLink>
      </nav>
    </div>
  );
}
