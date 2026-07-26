import { Router, type NextFunction, type Request, type Response } from 'express';

import { pool } from '../db/pool.js';

interface LetterCategoryRow {
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
  created_at: Date;
}

export const letterCategoriesRouter = Router();

letterCategoriesRouter.get(
  '/letter-categories',
  async (_request: Request, response: Response, next: NextFunction) => {
    try {
      const result = await pool.query<LetterCategoryRow>(
        `SELECT id, slug, display_name, has_datetime, has_location, has_gift_info,
                has_precautions, has_cta_link, default_title_text, sort_order, created_at
         FROM letter_categories
         ORDER BY sort_order ASC, display_name ASC`,
      );

      response.json({ categories: result.rows });
    } catch (error) {
      next(error);
    }
  },
);
