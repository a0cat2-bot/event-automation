import { z } from 'zod';

export const selectionMode = z.enum(['first_come_first_served', 'score', 'written_justification']);

export const programCreateBody = z.object({
  name: z.string().min(1).max(255),
  business_unit: z.string().min(1).max(100),
  intake_data: z.record(z.unknown()).optional(),
  template_version_id: z.string().uuid().optional(),
  selection_mode: selectionMode,
  max_participants: z.number().int().positive().max(4999),
  requires_approval: z.boolean().optional(),
  status: z
    .enum(['planning', 'recruitment_active', 'selection_in_progress', 'completed'])
    .optional(),
});

export const programUpdateBody = programCreateBody
  .partial()
  .refine((body) => Object.keys(body).length > 0, {
    message: 'At least one field must be supplied',
  });

export const applicantConfirmBody = z.object({
  action: z.enum(['import', 'discard']),
  conflict_resolution: z.enum(['skip_duplicates', 'overwrite']),
});

export const sallyImportApplicantsBody = z.object({
  survey_title: z.string().trim().min(1).max(255),
});

export const letterGenerateBody = z.object({
  template_id: z.string().uuid(),
  program_id: z.string().uuid(),
  applicant_ids: z.array(z.string().uuid()).min(1),
  brand_variant: z.string().min(1).max(50),
});

export const participantNotifyBody = z.object({
  template_id: z.string().uuid(),
});

export const participantSurveyResultBody = z.object({
  satisfaction_score: z.number().int().min(1).max(5),
  feedback_text: z.string().max(5000).optional(),
  sally_survey_id: z.string().min(1).max(100).optional(),
});

export const letterTemplateCreateBody = z
  .object({
    name: z.string().min(1).max(255),
    template_type: z.enum(['recruitment', 'notification', 'gift_notification']),
    brand_variant: z.string().min(1).max(50),
    // 'image' lets the notify email embed the letter inline in the body (cid attachment);
    // 'pdf' is better suited to printable/archival documents. Defaults to the DB default ('pdf').
    output_format: z.enum(['pdf', 'image']).optional(),
    layout_mode: z.enum(['freeform', 'standard']).optional(),
    category_id: z.string().uuid().optional(),
  })
  .superRefine((body, context) => {
    if (body.layout_mode === 'standard' && !body.category_id) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['category_id'],
        message: 'category_id is required when layout_mode is standard',
      });
    }

    if (body.layout_mode !== 'standard' && body.category_id) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['category_id'],
        message: 'category_id is only allowed when layout_mode is standard',
      });
    }
  });

const optionalNullableString = (maxLength: number) =>
  z.string().trim().max(maxLength).nullable().optional();

export const letterStandardContentBody = z.object({
  title_override: optionalNullableString(255),
  datetime_text: optionalNullableString(500),
  location_text: optionalNullableString(500),
  body_text: z.string().trim().min(1).max(5_000),
  gift_info_text: optionalNullableString(2_000),
  precautions: z.array(z.string().trim().min(1).max(300)).max(20),
  cta_text: optionalNullableString(255),
  cta_link: z.string().trim().url().max(2_048).nullable().optional(),
});

export const letterPlaceholderKey = z.enum([
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
]);
export type LetterPlaceholderKey = z.infer<typeof letterPlaceholderKey>;

export const letterTextField = z
  .object({
    id: z.string().min(1).max(100),
    key: letterPlaceholderKey,
    static_text: z.string().max(10_000).nullable(),
    x: z.number().finite().nonnegative(),
    y: z.number().finite().nonnegative(),
    width: z.number().finite().nonnegative(),
    height: z.number().finite().nonnegative(),
    font_family: z.string().min(1).max(255),
    font_size: z.number().finite().positive().max(1_000),
    font_weight: z.string().min(1).max(50),
    color: z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/),
    text_align: z.enum(['left', 'center', 'right']),
  })
  .superRefine((field, context) => {
    if (field.key === 'static' && field.static_text === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['static_text'],
        message: 'static_text is required when key is static',
      });
    }
  });

export const letterTextFields = z.array(letterTextField).max(200);

export const letterTemplateFieldsBody = z.object({
  text_fields: letterTextFields,
});

export const selectionGenerateBody = z.object({
  selection_mode: selectionMode,
  quality_score_threshold: z.number().nonnegative(),
  manual_review_count_multiplier: z.number().int().positive(),
  override_selections: z.array(
    z.object({
      applicant_id: z.string().uuid(),
      selected: z.boolean(),
      reason: z.string().min(1).max(255),
    }),
  ),
  // When true, computes the same candidate selection but does not write participants or an
  // audit log entry — lets a coordinator review who would be selected before committing.
  dry_run: z.boolean().optional().default(false),
  approved_by: z.string().min(1).max(255).optional(),
});

export const reportGenerateBody = z.object({
  format: z.enum(['markdown', 'html', 'pdf']),
  include_sections: z.array(z.enum(['summary', 'participants', 'survey_results', 'gifts'])).min(1),
});

export const giftItemCreateBody = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(2_000).optional(),
  // multipart/form-data (this endpoint accepts an optional image file alongside these fields)
  // always delivers text fields as strings, so quantity must be coerced.
  quantity: z.coerce.number().int().positive().max(1000),
});

export const giftSelectBody = z.object({
  gift_item_id: z.string().uuid(),
  minimum_satisfaction_score: z.number().min(1).max(5).optional(),
});
