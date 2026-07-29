import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import { listBusinessUnits, type BusinessUnit } from '../api/businessUnits';
import { cloneProgramLetterCustomizations } from '../api/letterTemplates';
import {
  createProgram,
  getProgram,
  SELECTION_MODES,
  type Program,
  type SelectionMode,
} from '../api/programs';
import { PageShell } from '../components/PageShell';
import { intakeField } from '../utils/program';

function getLocalDateString() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function ProgramSetupPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const cloneFrom = searchParams.get('cloneFrom');
  const [name, setName] = useState('');
  const [businessUnits, setBusinessUnits] = useState<BusinessUnit[]>([]);
  const [businessUnitId, setBusinessUnitId] = useState('');
  const [isBusinessUnitLoading, setIsBusinessUnitLoading] = useState(true);
  const [businessUnitError, setBusinessUnitError] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState<SelectionMode>('first_come_first_served');
  const [maxParticipants, setMaxParticipants] = useState('20');
  const [requiresApproval, setRequiresApproval] = useState(false);
  const [programStartDate, setProgramStartDate] = useState('');
  const [programEndDate, setProgramEndDate] = useState('');
  const [programTime, setProgramTime] = useState('');
  const [programLocation, setProgramLocation] = useState('');
  const [description, setDescription] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let isCurrent = true;

    const sourceProgramPromise: Promise<Program | null> = cloneFrom
      ? getProgram(cloneFrom, controller.signal)
          .then(({ program }) => program)
          .catch(() => null)
      : Promise.resolve(null);

    Promise.all([
      listBusinessUnits({ activeOnly: true }, controller.signal),
      sourceProgramPromise,
    ])
      .then(([{ business_units: nextBusinessUnits }, sourceProgram]) => {
        if (!isCurrent) return;
        setBusinessUnits(nextBusinessUnits);
        setBusinessUnitId(
          sourceProgram &&
            nextBusinessUnits.some(
              (businessUnit) => businessUnit.id === sourceProgram.business_unit_id,
            )
            ? sourceProgram.business_unit_id
            : nextBusinessUnits[0]?.id || '',
        );
        if (sourceProgram) {
          setName(`${sourceProgram.name} (복사본)`);
          setSelectionMode(sourceProgram.selection_mode);
          setMaxParticipants(String(sourceProgram.max_participants));
          setRequiresApproval(sourceProgram.requires_approval);
          setProgramLocation(intakeField(sourceProgram.intake_data, 'program_location') ?? '');
          setDescription(intakeField(sourceProgram.intake_data, 'description') ?? '');
        }
        setBusinessUnitError(null);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        if (!isCurrent) return;
        setBusinessUnitError(
          error instanceof Error ? error.message : '사업부 목록을 불러오지 못했습니다.',
        );
      })
      .finally(() => {
        if (isCurrent) setIsBusinessUnitLoading(false);
      });

    return () => {
      isCurrent = false;
      controller.abort();
    };
  }, [cloneFrom]);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      programStartDate &&
      programEndDate &&
      programEndDate < programStartDate
    ) {
      setCreateError('종료일은 시작일보다 빠를 수 없습니다.');
      return;
    }

    setIsCreating(true);
    setCreateError(null);

    try {
      const intakeData: Record<string, unknown> = {};
      if (programStartDate) {
        intakeData.program_start_date = programStartDate;
        if (programEndDate && programEndDate !== programStartDate) {
          intakeData.program_end_date = programEndDate;
        }
      }
      if (programTime.trim()) intakeData.program_time = programTime.trim();
      if (programLocation.trim()) intakeData.program_location = programLocation.trim();
      if (description.trim()) intakeData.description = description.trim();

      const { program } = await createProgram({
        name: name.trim(),
        business_unit_id: businessUnitId,
        selection_mode: selectionMode,
        max_participants: Number(maxParticipants),
        requires_approval: requiresApproval,
        ...(Object.keys(intakeData).length > 0 ? { intake_data: intakeData } : {}),
      });
      if (cloneFrom) {
        void cloneProgramLetterCustomizations(program.id, cloneFrom).catch(() => {});
      }
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
          {isBusinessUnitLoading ? (
            <span className="state-message">사업부를 불러오는 중입니다…</span>
          ) : null}
          {!isBusinessUnitLoading && businessUnits.length > 0 ? (
            <select
              required
              value={businessUnitId}
              onChange={(event) => setBusinessUnitId(event.target.value)}
            >
              {businessUnits.map((businessUnit) => (
                <option key={businessUnit.id} value={businessUnit.id}>
                  {businessUnit.name}
                </option>
              ))}
            </select>
          ) : null}
          {!isBusinessUnitLoading && !businessUnitError && businessUnits.length === 0 ? (
            <span className="empty-state">
              사업부가 없습니다. 먼저 <Link to="/business-units">사업부를 등록하세요.</Link>
            </span>
          ) : null}
        </label>
        {businessUnitError ? (
          <p className="form-error" role="alert">
            {businessUnitError}
          </p>
        ) : null}

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
          시작일 (선택)
          <input
            type="date"
            value={programStartDate}
            onChange={(event) => setProgramStartDate(event.target.value)}
          />
          {programStartDate && programStartDate < getLocalDateString() ? (
            <small className="field-hint field-hint--warning">
              선택한 시작일이 오늘보다 이전입니다. 확인해주세요.
            </small>
          ) : null}
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
            placeholder="어떤 프로그램인지, 참여 대상, 목적 등을 자유롭게 입력하세요."
          />
        </label>

        {createError ? (
          <p className="form-error" role="alert">
            {createError}
          </p>
        ) : null}

        <button
          className="button button--primary"
          type="submit"
          disabled={isCreating || isBusinessUnitLoading || !businessUnitId}
        >
          {isCreating ? '생성 중…' : '프로그램 만들기'}
        </button>
      </form>
    </PageShell>
  );
}
