import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { Router, type NextFunction, type Request, type Response } from 'express';
import { imageSize } from 'image-size';
import multer from 'multer';
import type { PoolClient } from 'pg';
import { z } from 'zod';

import { pool } from '../db/pool.js';
import { validate } from '../middleware/validate.js';
import { getActorName } from '../utils/actor.js';
import { programParams } from '../schemas/common.js';
import { giftItemCreateBody, giftSelectBody } from '../schemas/contracts.js';
import { uploadsRoot } from '../utils/storage.js';

interface EligibleParticipantRow {
  participant_id: string;
}

interface GiftRecipientListRow {
  id: string;
  program_id: string;
  participant_id: string;
  gift_item_id: string | null;
  selection_rank: number | null;
  selection_reason: string | null;
  selected_at: Date;
  selected_by: string | null;
  gift_status: 'selected' | 'delivered' | 'failed';
  delivery_date: Date | null;
  delivery_method: string | null;
  created_at: Date;
  name: string | null;
  email: string | null;
  gift_item_name: string | null;
}

interface GiftItemRow {
  id: string;
  program_id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  quantity: number;
  created_at: Date;
  updated_at: Date;
}

const giftRecipientListSelect = `SELECT gr.id, gr.program_id, gr.participant_id, gr.gift_item_id,
       gr.selection_rank, gr.selection_reason, gr.selected_at, gr.selected_by,
       gr.gift_status, gr.delivery_date, gr.delivery_method, gr.created_at,
       a.name, a.email, gi.name AS gift_item_name
FROM gift_recipients gr
JOIN participants pt ON pt.id = gr.participant_id AND pt.program_id = gr.program_id
JOIN applicants a ON a.id = pt.applicant_id AND a.program_id = pt.program_id
LEFT JOIN gift_items gi ON gi.id = gr.gift_item_id`;

const giftImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
});

const imageExtensionsByMimeType: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};
const giftRecipientParams = programParams.extend({
  gift_recipient_id: z.string().uuid(),
});
const giftDeliveryBody = z.object({
  delivery_method: z.string().trim().min(1).max(50).optional(),
});

async function accessibleProgram(programId: string) {
  const result = await pool.query<{ id: string }>(
    `SELECT id FROM programs WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
    [programId],
  );
  return result.rows[0];
}

export const giftsRouter = Router();

giftsRouter.post(
  '/programs/:program_id/gift-items',
  validate({ params: programParams }),
  giftImageUpload.single('image'),
  validate({ body: giftItemCreateBody }),
  async (request: Request, response: Response, next: NextFunction) => {
    try {
      const programId = request.params.program_id as string;
      const { name, description, quantity } = giftItemCreateBody.parse(request.body);

      if (!(await accessibleProgram(programId))) {
        response.status(404).json({ error: '프로그램을 찾을 수 없습니다.' });
        return;
      }

      let imageUrl: string | null = null;
      const file = request.file;
      if (file) {
        if (!imageExtensionsByMimeType[file.mimetype]) {
          response.status(415).json({ error: 'PNG, JPEG, WebP 이미지만 업로드할 수 있습니다.' });
          return;
        }
        let dimensions: ReturnType<typeof imageSize>;
        try {
          dimensions = imageSize(file.buffer);
        } catch {
          response.status(400).json({ error: '업로드한 파일은 읽을 수 있는 이미지가 아닙니다.' });
          return;
        }
        const detectedExtension = dimensions.type;
        if (!detectedExtension || !['png', 'jpg', 'webp'].includes(detectedExtension)) {
          response.status(415).json({ error: 'PNG, JPEG, WebP 이미지만 업로드할 수 있습니다.' });
          return;
        }

        const contentDigest = createHash('sha256').update(file.buffer).digest('hex').slice(0, 20);
        const filename = `${randomUUID()}-${contentDigest}.${detectedExtension}`;
        const directory = join(uploadsRoot, 'gift-items');
        await mkdir(directory, { recursive: true });
        await writeFile(join(directory, filename), file.buffer, { flag: 'wx' });
        imageUrl = `/uploads/gift-items/${filename}`;
      }

      const result = await pool.query<GiftItemRow>(
        `INSERT INTO gift_items (id, program_id, name, description, image_url, quantity)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, program_id, name, description, image_url, quantity, created_at,
                   updated_at`,
        [randomUUID(), programId, name, description ?? null, imageUrl, quantity],
      );

      response.status(201).json({ gift_item: result.rows[0] });
    } catch (error) {
      next(error);
    }
  },
);

giftsRouter.get(
  '/programs/:program_id/gift-items',
  validate({ params: programParams }),
  async (request: Request, response: Response, next: NextFunction) => {
    try {
      const programId = request.params.program_id as string;
      if (!(await accessibleProgram(programId))) {
        response.status(404).json({ error: '프로그램을 찾을 수 없습니다.' });
        return;
      }

      const result = await pool.query<GiftItemRow & { selected_count: number }>(
        `SELECT gi.id, gi.program_id, gi.name, gi.description, gi.image_url, gi.quantity,
                gi.created_at, gi.updated_at,
                (SELECT COUNT(*)::int FROM gift_recipients gr WHERE gr.gift_item_id = gi.id)
                  AS selected_count
         FROM gift_items gi
         WHERE gi.program_id = $1
         ORDER BY gi.created_at ASC`,
        [programId],
      );
      response.json({ gift_items: result.rows });
    } catch (error) {
      next(error);
    }
  },
);

giftsRouter.post(
  '/programs/:program_id/gifts/select',
  validate({ params: programParams, body: giftSelectBody }),
  async (request: Request, response: Response, next: NextFunction) => {
    let client: PoolClient | null = null;
    let transactionStarted = false;
    try {
      const programId = request.params.program_id as string;
      const { gift_item_id: giftItemId, minimum_satisfaction_score: minimumScore = 3 } =
        giftSelectBody.parse(request.body);
      const selectionReason = `무작위 선정 (만족도 ${minimumScore} 이상)`;

      client = await pool.connect();
      await client.query('BEGIN');
      transactionStarted = true;

      const programResult = await client.query<{ id: string }>(
        `SELECT id
         FROM programs
         WHERE id = $1
           AND deleted_at IS NULL
         LIMIT 1`,
        [programId],
      );
      if (!programResult.rows[0]) {
        await client.query('ROLLBACK');
        transactionStarted = false;
        response.status(404).json({ error: '프로그램을 찾을 수 없습니다.' });
        return;
      }

      const giftItemResult = await client.query<{ id: string; quantity: number }>(
        `SELECT gi.id, gi.quantity,
                (SELECT COUNT(*)::int FROM gift_recipients gr WHERE gr.gift_item_id = gi.id)
                  AS already_selected
         FROM gift_items gi
         WHERE gi.id = $1 AND gi.program_id = $2
         LIMIT 1`,
        [giftItemId, programId],
      );
      const giftItem = giftItemResult.rows[0] as
        | { id: string; quantity: number; already_selected: number }
        | undefined;
      if (!giftItem) {
        await client.query('ROLLBACK');
        transactionStarted = false;
        response.status(404).json({ error: '이 프로그램의 상품을 찾을 수 없습니다.' });
        return;
      }

      const remainingQuantity = Math.max(0, giftItem.quantity - giftItem.already_selected);
      if (remainingQuantity === 0) {
        await client.query('ROLLBACK');
        transactionStarted = false;
        response.json({
          selected: [],
          requested_count: 0,
          selected_count: 0,
          warning: '이 상품은 설정된 수량만큼 이미 선정되었습니다.',
        });
        return;
      }

      const eligibleResult = await client.query<EligibleParticipantRow>(
        `SELECT pt.id AS participant_id
         FROM participants pt
         JOIN LATERAL (
           SELECT sr.satisfaction_score
           FROM survey_results sr
           WHERE sr.participant_id = pt.id
             AND sr.program_id = pt.program_id
           ORDER BY sr.completion_date DESC NULLS LAST,
                    sr.updated_at DESC,
                    sr.created_at DESC
           LIMIT 1
         ) latest_survey ON TRUE
         WHERE pt.program_id = $1
           AND pt.deselected_at IS NULL
           AND pt.survey_status = 'completed'
           AND pt.is_gift_eligible = TRUE
           AND pt.gift_status <> 'delivered'
           AND latest_survey.satisfaction_score >= $2
           AND NOT EXISTS (
             SELECT 1
             FROM gift_recipients existing_recipient
             WHERE existing_recipient.program_id = pt.program_id
               AND existing_recipient.participant_id = pt.id
           )
         ORDER BY random()
         LIMIT $3
         FOR UPDATE OF pt SKIP LOCKED`,
        [programId, minimumScore, remainingQuantity],
      );

      const selections = eligibleResult.rows.map((row, index) => ({
        id: randomUUID(),
        participantId: row.participant_id,
        rank: index + 1,
      }));

      if (selections.length > 0) {
        await client.query(
          `INSERT INTO gift_recipients
             (id, program_id, participant_id, gift_item_id, selection_rank, selection_reason,
              selected_by, gift_status)
           SELECT selected.id, $1, selected.participant_id, $2, selected.selection_rank,
                  $3, NULL, 'selected'
           FROM UNNEST($4::uuid[], $5::uuid[], $6::int[]) AS selected(
             id, participant_id, selection_rank
           )`,
          [
            programId,
            giftItemId,
            selectionReason,
            selections.map((selection) => selection.id),
            selections.map((selection) => selection.participantId),
            selections.map((selection) => selection.rank),
          ],
        );
        await client.query(
          `UPDATE participants
           SET gift_status = 'selected',
               gift_selected_at = NOW(),
               updated_at = NOW()
           WHERE program_id = $1
             AND id = ANY($2::uuid[])`,
          [programId, selections.map((selection) => selection.participantId)],
        );
      }

      const selectedResult =
        selections.length === 0
          ? { rows: [] as GiftRecipientListRow[] }
          : await client.query<GiftRecipientListRow>(
              `${giftRecipientListSelect}
               WHERE gr.program_id = $1
                 AND gr.id = ANY($2::uuid[])
               ORDER BY gr.selection_rank ASC, gr.id ASC`,
              [programId, selections.map((selection) => selection.id)],
            );

      // Written inside the transaction so the audit trail cannot record a selection that was
      // subsequently rolled back.
      await client.query(
        `INSERT INTO audit_logs
           (actor_name, action, entity_type, entity_id, program_id, details, ip_address)
         VALUES ($1, 'gift_selection', 'program', $2, $2, $3::jsonb, $4)`,
        [
          getActorName(request),
          programId,
          JSON.stringify({
            gift_item_id: giftItemId,
            requested_count: remainingQuantity,
            selected_count: selections.length,
          }),
          request.ip || null,
        ],
      );

      await client.query('COMMIT');
      transactionStarted = false;

      const warning =
        selections.length < remainingQuantity
          ? `선정 가능한 참여자는 ${selections.length}명뿐이며, 이 상품에 ${remainingQuantity}자리가 남았습니다.`
          : undefined;
      response.json({
        selected: selectedResult.rows,
        requested_count: remainingQuantity,
        selected_count: selections.length,
        ...(warning ? { warning } : {}),
      });
    } catch (error) {
      if (client && transactionStarted) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // Preserve the original transaction error for the central error handler.
        }
      }
      next(error);
    } finally {
      client?.release();
    }
  },
);

giftsRouter.get(
  '/programs/:program_id/gifts',
  validate({ params: programParams }),
  async (request: Request, response: Response, next: NextFunction) => {
    try {
      const programId = request.params.program_id as string;
      if (!(await accessibleProgram(programId))) {
        response.status(404).json({ error: '프로그램을 찾을 수 없습니다.' });
        return;
      }

      const result = await pool.query<GiftRecipientListRow>(
        `${giftRecipientListSelect}
         WHERE gr.program_id = $1
         ORDER BY gr.selected_at DESC, gr.id ASC`,
        [programId],
      );
      response.json({ gift_recipients: result.rows });
    } catch (error) {
      next(error);
    }
  },
);

giftsRouter.patch(
  '/programs/:program_id/gifts/recipients/:gift_recipient_id',
  validate({ params: giftRecipientParams, body: giftDeliveryBody }),
  async (request: Request, response: Response, next: NextFunction) => {
    let client: PoolClient | null = null;
    let transactionStarted = false;
    try {
      const programId = request.params.program_id as string;
      const giftRecipientId = request.params.gift_recipient_id as string;
      const { delivery_method: deliveryMethod } = giftDeliveryBody.parse(request.body);

      client = await pool.connect();
      await client.query('BEGIN');
      transactionStarted = true;

      const recipientResult = await client.query<{
        id: string;
        participant_id: string;
        gift_status: GiftRecipientListRow['gift_status'];
      }>(
        `SELECT id, participant_id, gift_status
         FROM gift_recipients
         WHERE id = $1
           AND program_id = $2
         FOR UPDATE`,
        [giftRecipientId, programId],
      );
      const recipient = recipientResult.rows[0];
      if (!recipient) {
        await client.query('ROLLBACK');
        transactionStarted = false;
        response.status(404).json({ error: '이 프로그램의 상품 수령자를 찾을 수 없습니다.' });
        return;
      }
      if (recipient.gift_status !== 'selected') {
        await client.query('ROLLBACK');
        transactionStarted = false;
        response.status(409).json({ error: '선정 상태인 수령자만 수령 확인할 수 있습니다.' });
        return;
      }

      await client.query(
        `UPDATE gift_recipients
         SET gift_status = 'delivered',
             delivery_date = NOW(),
             delivery_method = COALESCE($3, delivery_method)
         WHERE id = $1
           AND program_id = $2`,
        [giftRecipientId, programId, deliveryMethod ?? null],
      );
      await client.query(
        `UPDATE participants
         SET gift_status = 'delivered',
             updated_at = NOW()
         WHERE id = $1
           AND program_id = $2`,
        [recipient.participant_id, programId],
      );
      const updatedResult = await client.query<GiftRecipientListRow>(
        `${giftRecipientListSelect}
         WHERE gr.id = $1
           AND gr.program_id = $2
         LIMIT 1`,
        [giftRecipientId, programId],
      );

      await client.query('COMMIT');
      transactionStarted = false;
      response.json({ gift_recipient: updatedResult.rows[0] });
    } catch (error) {
      if (client && transactionStarted) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // Preserve the original transaction error for the central error handler.
        }
      }
      next(error);
    } finally {
      client?.release();
    }
  },
);
