import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { listBusinessUnits, type BusinessUnit } from '../api/businessUnits';
import {
  getProgram,
  updateProgram,
  SELECTION_MODES,
  type Program,
  type SelectionMode,
} from '../api/programs';
import { PageShell } from '../components/PageShell';

function intakeField(intakeData: Program['intake_data'], key: string): string {
  const value = intakeData?.[key];
  return typeof value === 'string' ? value : '';
}

export function ProgramEditPage() {
  const { programId = '' } = useParams();
  const navigate = useNavigate();
  const [program, setProgram] = useState<Program | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [businessUnits, setBusinessUnits] = useState<BusinessUnit[]>([]);
  const [businessUnitId, setBusinessUnitId] = useState('');
  const [selectionMode, setSelectionMode] = useState<SelectionMode>('first_come_first_served');
  const [maxParticipants, setMaxParticipants] = useState('20');
  const [requiresApproval, setRequiresApproval] = useState(false);
  const [programStartDate, setProgramStartDate] = useState('');
  const [programEndDate, setProgramEndDate] = useState('');
  const [legacyProgramDate, setLegacyProgramDate] = useState('');
  const [programTime, setProgramTime] = useState('');
  const [programLocation, setProgramLocation] = useState('');
  const [description, setDescription] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let isCurrent = true;

    Promise.all([
      getProgram(programId, controller.signal),
      listBusinessUnits(undefined, controller.signal),
    ])
      .then(([{ program: next }, { business_units: nextBusinessUnits }]) => {
        if (!isCurrent) return;
        setProgram(next);
        setBusinessUnits(nextBusinessUnits);
        setName(next.name);
        setBusinessUnitId(next.business_unit_id);
        setSelectionMode(next.selection_mode);
        setMaxParticipants(String(next.max_participants));
        setRequiresApproval(next.requires_approval);
        const nextProgramStartDate = intakeField(next.intake_data, 'program_start_date');
        setProgramStartDate(nextProgramStartDate);
        setProgramEndDate(
          nextProgramStartDate ? intakeField(next.intake_data, 'program_end_date') : '',
        );
        setLegacyProgramDate(
          nextProgramStartDate ? '' : intakeField(next.intake_data, 'program_date'),
        );
        setProgramTime(intakeField(next.intake_data, 'program_time'));
        setProgramLocation(intakeField(next.intake_data, 'program_location'));
        setDescription(intakeField(next.intake_data, 'description'));
        setLoadError(null);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        if (!isCurrent) return;
        setLoadError(error instanceof Error ? error.message : '프로그램을 불러오지 못했습니다.');
      })
      .finally(() => {
        if (isCurrent) setIsLoading(false);
      });

    return () => {
      isCurrent = false;
      controller.abort();
    };
  }, [programId]);

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      programStartDate &&
      programEndDate &&
      programEndDate < programStartDate
    ) {
      setSaveError('종료일은 시작일보다 빠를 수 없습니다.');
      return;
    }

    setIsSaving(true);
    setSaveError(null);

    try {
      const intakeData: Record<string, unknown> = {};
      if (programStartDate) {
        intakeData.program_start_date = programStartDate;
        if (programEndDate && programEndDate !== programStartDate) {
          intakeData.program_end_date = programEndDate;
        }
      } else if (legacyProgramDate) {
        intakeData.program_date = legacyProgramDate;
      }
      if (programTime.trim()) intakeData.program_time = programTime.trim();
      if (programLocation.trim()) intakeData.program_location = programLocation.trim();
      if (description.trim()) intakeData.description = description.trim();

      await updateProgram(programId, {
        name: name.trim(),
        business_unit_id: businessUnitId,
        selection_mode: selectionMode,
        max_participants: Number(maxParticipants),
        requires_approval: requiresApproval,
        intake_data: intakeData,
      });
      navigate(`/programs/${programId}`);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : '프로그램을 수정하지 못했습니다.');
    } finally {
      setIsSaving(false);
    }
  }

  const selectableBusinessUnits = businessUnits.filter(
    (businessUnit) => businessUnit.is_active || businessUnit.id === program?.business_unit_id,
  );

  return (
    <PageShell
      title="프로그램 수정"
      designSection="프로그램 수정"
      description="프로그램 기본 정보를 수정합니다."
      showStubNote={false}
    >
      {isLoading ? <p className="state-message">불러오는 중입니다…</p> : null}
      {loadError ? (
        <p className="state-message state-message--error" role="alert">
          {loadError}
        </p>
      ) : null}

      {program ? (
        <form className="stack-form" onSubmit={handleSave}>
          <label>
            프로그램명
            <input required value={name} onChange={(event) => setName(event.target.value)} />
          </label>

          <label>
            주관 부서 / 사업부
            {selectableBusinessUnits.length > 0 ? (
              <select
                required
                value={businessUnitId}
                onChange={(event) => setBusinessUnitId(event.target.value)}
              >
                {selectableBusinessUnits.map((businessUnit) => (
                  <option key={businessUnit.id} value={businessUnit.id}>
                    {businessUnit.name}
                    {businessUnit.is_active ? '' : ' (비활성)'}
                  </option>
                ))}
              </select>
            ) : (
              <span className="empty-state">
                사업부가 없습니다. 먼저 <Link to="/business-units">사업부를 등록하세요.</Link>
              </span>
            )}
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
            {program.applicant_count > 0 && selectionMode !== program.selection_mode ? (
              <small className="field-hint">
                이미 신청자가 {program.applicant_count}명 있습니다. 선정 방식을 바꾸면 기존 신청자의
                점수/지원사유 데이터와 맞지 않을 수 있습니다.
              </small>
            ) : null}
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
            시작일 (선택)
            <input
              type="date"
              value={programStartDate}
              onChange={(event) => setProgramStartDate(event.target.value)}
            />
          </label>

          <label>
            종료일 (선택, 여러 날 진행 시)
            <input
              type="date"
              value={programEndDate}
              onChange={(event) => setProgramEndDate(event.target.value)}
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
            />
          </label>

          {saveError ? (
            <p className="form-error" role="alert">
              {saveError}
            </p>
          ) : null}

          <div className="standard-save-row">
            <button
              className="button button--primary"
              type="submit"
              disabled={isSaving || !businessUnitId}
            >
              {isSaving ? '저장 중…' : '저장'}
            </button>
            <button
              className="button button--secondary"
              type="button"
              onClick={() => navigate(`/programs/${programId}`)}
              disabled={isSaving}
            >
              취소
            </button>
          </div>
        </form>
      ) : null}
    </PageShell>
  );
}
