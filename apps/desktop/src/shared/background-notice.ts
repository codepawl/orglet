import { z } from 'zod';

/** Longest title or line a system notification carries; the window cuts to this before it asks. */
export const BACKGROUND_NOTICE_CHARS = 120;

/**
 * A system notification for a chat that finished, failed or needs the person while Orglet is in the background
 * (COD-258). It names the orglet, crew or schedule and says what happened in a few words; it never carries answer
 * text or file contents, since it shows on the desktop and may be read over the person's shoulder. Clicking it
 * brings the window forward and opens `taskId`.
 */
export const BackgroundNotice = z.object({
  taskId: z.uuid(),
  title: z.string().trim().min(1).max(BACKGROUND_NOTICE_CHARS),
  body: z.string().trim().min(1).max(BACKGROUND_NOTICE_CHARS),
}).strict();
export type BackgroundNotice = z.infer<typeof BackgroundNotice>;
