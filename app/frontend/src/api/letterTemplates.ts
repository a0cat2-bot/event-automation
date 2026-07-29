import { apiRequest } from './client';

export const LETTER_FIELD_KEYS = [
  'applicant_name',
  'applicant_email',
  'department',
  'program_name',
  'program_date',
  'program_location',
  'program_time',
  'survey_link',
  'gift_amount',
  'coordinator_name',
  'coordinator_contact',
  'static',
] as const;

export type LetterFieldKey = (typeof LETTER_FIELD_KEYS)[number];

export type TextField = {
  id: string;
  key: LetterFieldKey;
  static_text: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  font_family: string;
  font_size: number;
  font_weight: string;
  color: string;
  text_align: 'left' | 'center' | 'right';
};

export type StandardContent = {
  title_override: string | null;
  datetime_text: string | null;
  location_text: string | null;
  body_text: string;
  gift_info_text: string | null;
  precautions: string[];
  cta_text: string | null;
  cta_link: string | null;
};

export type LetterCategory = {
  id: string;
  slug: string;
  display_name: string;
  has_datetime: boolean;
  has_location: boolean;
  has_gift_info: boolean;
  has_precautions: boolean;
  has_cta_link: boolean;
  default_title_text: string;
  sort_order: number;
};

export type OrgSettings = {
  business_unit: string;
  character_image_url: string | null;
  org_display_name: string;
  default_coordinator_name: string | null;
  default_coordinator_contact: string | null;
  updated_at: string;
  updated_by: string | null;
};

export type LetterTemplate = {
  id: string | number;
  name: string;
  template_type: string;
  brand_variant: string;
  output_format: 'pdf' | 'image';
  background_image_url: string | null;
  canvas_width: number | null;
  canvas_height: number | null;
  text_fields: TextField[];
  layout_mode: 'freeform' | 'standard';
  category_id: string | null;
  standard_content: StandardContent | null;
  is_customized?: boolean;
};

export type ProgramLetterCustomization = {
  standard_content: StandardContent | null;
  text_fields: TextField[] | null;
  background_image_url: string | null;
  canvas_width: number | null;
  canvas_height: number | null;
};

type TemplateResponse = { template: LetterTemplate };
type TemplatesResponse = { templates: LetterTemplate[] };
type ProgramLetterCustomizationResponse = {
  customization: ProgramLetterCustomization;
};
type CategoriesResponse = { categories: LetterCategory[] };
type OrgSettingsResponse = { org_settings: OrgSettings };

function orgSettingsPath(suffix: string, businessUnit: string): string {
  return `/org-settings${suffix}?business_unit=${encodeURIComponent(businessUnit)}`;
}

export function getLetterTemplates(
  signal?: AbortSignal,
  programId?: string,
): Promise<TemplatesResponse> {
  const path = programId
    ? `/letter-templates?program_id=${encodeURIComponent(programId)}`
    : '/letter-templates';
  return apiRequest<TemplatesResponse>(path, { signal });
}

export function getLetterTemplate(
  templateId: string,
  signal?: AbortSignal,
): Promise<TemplateResponse> {
  return apiRequest<TemplateResponse>(`/letter-templates/${encodeURIComponent(templateId)}`, {
    signal,
  });
}

type CreateLetterTemplateInput = {
  name: string;
  template_type: string;
  brand_variant: string;
} & (
  | { layout_mode?: 'freeform'; category_id?: never }
  | { layout_mode: 'standard'; category_id: string }
);

export function createLetterTemplate(input: CreateLetterTemplateInput): Promise<TemplateResponse> {
  return apiRequest<TemplateResponse>('/letter-templates', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export function uploadLetterTemplateBackground(
  templateId: string,
  image: File,
): Promise<TemplateResponse> {
  const body = new FormData();
  body.append('image', image);

  return apiRequest<TemplateResponse>(
    `/letter-templates/${encodeURIComponent(templateId)}/background`,
    { method: 'POST', body },
  );
}

export function updateLetterTemplateFields(
  templateId: string,
  textFields: TextField[],
): Promise<TemplateResponse> {
  return apiRequest<TemplateResponse>(
    `/letter-templates/${encodeURIComponent(templateId)}/fields`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text_fields: textFields }),
    },
  );
}

export function getLetterCategories(signal?: AbortSignal): Promise<CategoriesResponse> {
  return apiRequest<CategoriesResponse>('/letter-categories', { signal });
}

export function updateLetterTemplateCategory(
  templateId: string,
  categoryId: string | null,
): Promise<TemplateResponse> {
  return apiRequest<TemplateResponse>(
    `/letter-templates/${encodeURIComponent(templateId)}/category`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category_id: categoryId }),
    },
  );
}

export function updateLetterTemplateStandardContent(
  templateId: string,
  content: StandardContent,
): Promise<TemplateResponse> {
  return apiRequest<TemplateResponse>(
    `/letter-templates/${encodeURIComponent(templateId)}/standard-content`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(content),
    },
  );
}

export function getProgramLetterContent(
  programId: string,
  templateId: string,
  signal?: AbortSignal,
): Promise<{
  template: LetterTemplate;
  customization: ProgramLetterCustomization | null;
  is_customized: boolean;
}> {
  return apiRequest(
    `/programs/${encodeURIComponent(programId)}/letter-templates/${encodeURIComponent(templateId)}/content`,
    { signal },
  );
}

export function updateProgramLetterStandardContent(
  programId: string,
  templateId: string,
  content: StandardContent,
): Promise<ProgramLetterCustomizationResponse> {
  return apiRequest<ProgramLetterCustomizationResponse>(
    `/programs/${encodeURIComponent(programId)}/letter-templates/${encodeURIComponent(templateId)}/content`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(content),
    },
  );
}

export function updateProgramLetterFields(
  programId: string,
  templateId: string,
  textFields: TextField[],
): Promise<ProgramLetterCustomizationResponse> {
  return apiRequest<ProgramLetterCustomizationResponse>(
    `/programs/${encodeURIComponent(programId)}/letter-templates/${encodeURIComponent(templateId)}/fields`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text_fields: textFields }),
    },
  );
}

export function uploadProgramLetterBackground(
  programId: string,
  templateId: string,
  image: File,
): Promise<ProgramLetterCustomizationResponse> {
  const body = new FormData();
  body.append('image', image);

  return apiRequest<ProgramLetterCustomizationResponse>(
    `/programs/${encodeURIComponent(programId)}/letter-templates/${encodeURIComponent(templateId)}/background`,
    { method: 'POST', body },
  );
}

export function resetProgramLetterContent(
  programId: string,
  templateId: string,
): Promise<{ template: LetterTemplate; deleted: boolean }> {
  return apiRequest(
    `/programs/${encodeURIComponent(programId)}/letter-templates/${encodeURIComponent(templateId)}/content`,
    { method: 'DELETE' },
  );
}

export function cloneProgramLetterCustomizations(
  newProgramId: string,
  sourceProgramId: string,
): Promise<{ cloned_count: number }> {
  return apiRequest(
    `/programs/${encodeURIComponent(newProgramId)}/letter-customizations/clone-from/${encodeURIComponent(sourceProgramId)}`,
    { method: 'POST' },
  );
}

export function getOrgSettings(
  signal?: AbortSignal,
  businessUnit = '',
): Promise<OrgSettingsResponse> {
  return apiRequest<OrgSettingsResponse>(orgSettingsPath('', businessUnit), { signal });
}

export function updateOrgSettings(
  input: {
    org_display_name?: string;
    default_coordinator_name?: string | null;
    default_coordinator_contact?: string | null;
  },
  businessUnit = '',
): Promise<OrgSettingsResponse> {
  return apiRequest<OrgSettingsResponse>(orgSettingsPath('', businessUnit), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export function uploadOrgSettingsCharacterImage(
  image: File,
  businessUnit = '',
): Promise<OrgSettingsResponse> {
  const body = new FormData();
  body.append('image', image);

  return apiRequest<OrgSettingsResponse>(orgSettingsPath('/character-image', businessUnit), {
    method: 'POST',
    body,
  });
}
