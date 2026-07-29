import { IconArrowRight } from '@tabler/icons-react';
import { useState } from 'react';
import { useParams } from 'react-router-dom';

import { generateReport, type Report } from '../api/reports';
import { PageShell } from '../components/PageShell';
import { ProgramContextBar } from '../components/ProgramContextBar';
import { resolveBackendAssetUrl } from '../config/api';

const SECTION_OPTIONS = [
  { value: 'summary', label: '요약' },
  { value: 'participants', label: '참여자 목록' },
  { value: 'survey_results', label: '설문 결과' },
  { value: 'gifts', label: '상품 수령자' },
] as const;

export function ResultsReportPage() {
  const { programId = '' } = useParams();
  const [format, setFormat] = useState<Report['format']>('markdown');
  const [sections, setSections] = useState<string[]>(['summary', 'participants', 'gifts']);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [report, setReport] = useState<Report | null>(null);

  function toggleSection(value: string) {
    setSections((current) =>
      current.includes(value) ? current.filter((item) => item !== value) : [...current, value],
    );
  }

  async function handleGenerate() {
    if (sections.length === 0) return;
    setIsGenerating(true);
    setGenerateError(null);

    try {
      const { report: nextReport } = await generateReport(programId, {
        format,
        include_sections: sections,
      });
      setReport(nextReport);
    } catch (error) {
      setGenerateError(error instanceof Error ? error.message : '보고서를 생성하지 못했습니다.');
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <PageShell
      title="결과 보고서"
      designSection="결과 보고서"
      description="프로그램 진행 결과를 요약한 보고서를 생성합니다."
      showStubNote={false}
    >
      <ProgramContextBar programId={programId} />
      <div className="content-card">
        <label>
          형식
          <select value={format} onChange={(event) => setFormat(event.target.value as Report['format'])}>
            <option value="markdown">Markdown</option>
            <option value="html">HTML</option>
            <option value="pdf">PDF</option>
          </select>
        </label>

        <fieldset>
          <legend>포함할 항목</legend>
          {SECTION_OPTIONS.map((option) => (
            <label key={option.value} style={{ display: 'block', fontWeight: 400 }}>
              <input
                type="checkbox"
                checked={sections.includes(option.value)}
                onChange={() => toggleSection(option.value)}
                style={{ width: 'auto', marginRight: '0.5rem' }}
              />
              {option.label}
            </label>
          ))}
        </fieldset>

        {generateError ? (
          <p className="form-error" role="alert">
            {generateError}
          </p>
        ) : null}

        <div className="standard-save-row" style={{ marginTop: '1rem' }}>
          <button
            className="button button--primary"
            type="button"
            onClick={handleGenerate}
            disabled={isGenerating || sections.length === 0}
          >
            {isGenerating ? '생성 중…' : '보고서 생성'}
          </button>
        </div>
      </div>

      {report ? (
        <div className="content-card">
          <h2>요약</h2>
          <p>
            신청자 {report.summary.applicant_count}명 · 참여자 {report.summary.participant_count}
            명 · 선정률 {(report.summary.selection_rate * 100).toFixed(1)}% · 설문 완료율{' '}
            {(report.summary.survey_completion_rate * 100).toFixed(1)}% · 평균 만족도{' '}
            {report.summary.average_satisfaction_score?.toFixed(2) ?? '—'} · 상품 수령자{' '}
            {report.summary.gift_recipient_count}명
          </p>

          {report.format === 'pdf' && report.file_path ? (
            <p>
              <a
                className="inline-link-with-icon"
                href={resolveBackendAssetUrl(report.file_path)}
                target="_blank"
                rel="noreferrer"
              >
                PDF 다운로드
                <IconArrowRight size={14} stroke={2} aria-hidden="true" />
              </a>
            </p>
          ) : null}

          {report.content ? (
            <pre
              style={{
                whiteSpace: 'pre-wrap',
                background: '#f7f9fb',
                padding: '1rem',
                borderRadius: '8px',
                maxHeight: '480px',
                overflow: 'auto',
              }}
            >
              {report.content}
            </pre>
          ) : null}
        </div>
      ) : null}
    </PageShell>
  );
}
