import { z } from "zod";

const deviceTimeRangeFields = {
  deviceId: z.coerce.number().int().positive(),
  from: z.string().datetime({ offset: true }),
  to: z.string().datetime({ offset: true }),
};

export const positionQuerySchema = z.object({
  deviceId: z.coerce.number().int().positive().optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});

export const reportRangeQuerySchema = z.object(deviceTimeRangeFields);

export const summaryQuerySchema = z.object({
  ...deviceTimeRangeFields,
  daily: z.enum(["true", "false"]).transform((value) => value === "true").optional(),
});
