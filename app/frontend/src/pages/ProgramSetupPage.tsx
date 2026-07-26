import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { createProgram, SELECTION_MODES, type SelectionMode } from '../api/programs';
import { PageShell } from '../components/PageShell';

export function ProgramSetupPage() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [businessUnit, setBusinessUnit] = useState('');
  const [selectionMode, setSelectionMode] = useState<SelectionMode>('first_come_first_served');
  const [maxParticipants, setMaxParticipants] = useState('20');
  const [requiresApproval, setRequiresApproval] = useState(false);
  const [programDate, setProgramDate] = useState('');
  const [programTime, setProgramTime] = useState('');
  const [programLocation, setProgramLocation] = useState('');
  const [description, setDescription] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsCreating(true);
    setCreateError(null);

    try {
      const intakeData: Record<string, unknown> = {};
      if (programDate.trim()) intakeData.program_date = programDate.trim();
      if (programTime.trim()) intakeData.program_time = programTime.trim();
      if (programLocation.trim()) intakeData.program_location = programLocation.trim();
      if (description.trim()) intakeData.description = description.trim();

      const { program } = await createProgram({
        name: name.trim(),
        business_unit: businessUnit.trim(),
        selection_mode: selectionMode,
        max_participants: Number(maxParticipants),
        requires_approval: requiresApproval,
        ...(Object.keys(intakeData).length > 0 ? { intake_data: intakeData } : {}),
      });
      navigate(`/programs/${program.id}`);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : '프로그램을 만들지 못했습니다.');
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <PageShell
      title="새 프로그램"
      description="프로그램 정보를 입력하세요. 일시·장소·설명은 레터의 {{program_date}}, {{program_time}}, {{program_location}} 병합 필드에 자동으로 채워집니다."
      designSection="프로그램 설정"
      showStubNote={false}
    >
      <form className="stack-form" onSubmit={handleCreate}>
        <label>
          프로그램명
          <input
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="예: KEMA 근골격계 예방 프로그램"
          />
        </label>

        <label>
          주관 부서 / 사업부
          <input
            required
            value={businessUnit}
            onChange={(event) => setBusinessUnit(event.target.value)}
            placeholder="예: AX센터 EHS그룹"
          />
        </label>

        <label>
          선정 방식
          <select
            value={selectionMode}
            onChange={(event) => setSelectionMode(event.target.value as SelectionMode)}
          >
            {SELECTION_MODES.map((mode) => (
              <option key={mode.value} value={mode.value}>
                {mode.label}
              </option>
            ))}
          </select>
        </label>

        <label>
          최대 참여 인원
          <input
            required
            type="number"
            min={1}
            max={4999}
            value={maxParticipants}
            onChange={(event) => setMaxParticipants(event.target.value)}
          />
        </label>

        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={requiresApproval}
            onChange={(event) => setRequiresApproval(event.target.checked)}
          />
          <span>
            선정 확정 전 승인자 이름 입력 필요
            <small className="field-hint">
              별도 로그인 없이 이름만 기록되는 참고용 기능입니다.
            </small>
          </span>
        </label>

        <label>
          날짜 (선택)
          <input
            value={programDate}
            onChange={(event) => setProgramDate(event.target.value)}
            placeholder="예: 2026년 8월 20일(목)"
          />
        </label>

        <label>
          시간 (선택)
          <input
            value={programTime}
            onChange={(event) => setProgramTime(event.target.value)}
            placeholder="예: 14:00~15:00"
          />
        </label>

        <label>
          장소 (선택)
          <input
            value={programLocation}
            onChange={(event) => setProgramLocation(event.target.value)}
            placeholder="예: 본관 2층 세미나실"
          />
        </label>

        <label>
          프로그램 설명 (선택)
          <textarea
            rows={4}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="어떤 프로그램인지, 참여 대상, 목적 등을 자유롭게 입력하세요."
          />
        </label>

        {createError ? (
          <p className="form-error" role="alert">
            {createError}
          </p>
        ) : null}

        <button className="button button--primary" type="submit" disabled={isCreating}>
          {isCreating ? '생성 중…' : '프로그램 만들기'}
        </button>
      </form>
    </PageShell>
  );
}
