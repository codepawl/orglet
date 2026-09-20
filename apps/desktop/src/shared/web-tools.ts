import { z } from 'zod';

export const ReadWebUrl = z.object({ url: z.string().min(1).max(4096) }).strict();
export const SearchWeb = z.object({ query: z.string().trim().min(1).max(500) }).strict();
