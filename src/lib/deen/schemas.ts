import { z } from "zod";

export const prayerStatus = z.enum(["ontime", "qada", "missed"]).nullable();
export type PrayerStatus = z.infer<typeof prayerStatus>;

export const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return (
      !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
    );
  }, "Use a valid calendar date");

export const deenDaySchema = z.object({
  date: dateString,
  fajr: prayerStatus.default(null),
  dhuhr: prayerStatus.default(null),
  asr: prayerStatus.default(null),
  maghrib: prayerStatus.default(null),
  isha: prayerStatus.default(null),
  morning_adhkar: z.boolean().default(false),
  evening_adhkar: z.boolean().default(false),
  night_ayat_kursi: z.boolean().default(false),
  night_baqarah: z.boolean().default(false),
  night_three_suras: z.boolean().default(false),
  ruqyah: z.boolean().default(false),
  istighfar_count: z.coerce.number().int().min(0).default(0),
  note: z.string().nullable().default(null),
});

export const deenDayUpdateSchema = z.object({
  date: dateString,
  fajr: prayerStatus.optional(),
  dhuhr: prayerStatus.optional(),
  asr: prayerStatus.optional(),
  maghrib: prayerStatus.optional(),
  isha: prayerStatus.optional(),
  morning_adhkar: z.boolean().optional(),
  evening_adhkar: z.boolean().optional(),
  night_ayat_kursi: z.boolean().optional(),
  night_baqarah: z.boolean().optional(),
  night_three_suras: z.boolean().optional(),
  ruqyah: z.boolean().optional(),
  istighfar_count: z.coerce.number().int().min(0).optional(),
  note: z.string().nullable().optional(),
});

export const observationSchema = z.object({
  id: z.string().optional(),
  timestamp: z.string(),
  text: z.string().min(1),
});

export const observationCreateSchema = z.object({
  text: z.string().min(1),
});

export const deenContentItemKeySchema = z.enum([
  "morning_adhkar",
  "evening_adhkar",
  "night_ayat",
  "ruqyah",
  "istighfar",
]);

export const evidenceGradeSchema = z.enum(["sahih", "hasan", "mawquf"]);

export const deenContentSchema = z.object({
  id: z.string(),
  item_key: deenContentItemKeySchema,
  title: z.string(),
  arabic: z.string().nullable(),
  transliteration: z.string().nullable(),
  meaning: z.string().nullable(),
  repetitions: z.string(),
  reference: z.string(),
  grade: evidenceGradeSchema,
  sort_order: z.number().int().nonnegative(),
  note: z.string().nullable(),
});

export const settingsSchema = z.object({
  timezone: z.string().default("Asia/Kolkata"),
  istighfar_target: z.coerce.number().int().positive().default(100),
});

export const settingsUpdateSchema = z.object({
  timezone: z.string().optional(),
  istighfar_target: z.coerce.number().int().positive().optional(),
});

export const resetRequestSchema = z.object({
  confirm: z.literal("RESET"),
});

export type DeenDay = z.infer<typeof deenDaySchema>;
export type DeenDayUpdate = z.infer<typeof deenDayUpdateSchema>;
export type Observation = z.infer<typeof observationSchema>;
export type ObservationCreate = z.infer<typeof observationCreateSchema>;
export type DeenContentItemKey = z.infer<typeof deenContentItemKeySchema>;
export type EvidenceGrade = z.infer<typeof evidenceGradeSchema>;
export type DeenContent = z.infer<typeof deenContentSchema>;
export type Settings = z.infer<typeof settingsSchema>;
export type SettingsUpdate = z.infer<typeof settingsUpdateSchema>;
export type ResetRequest = z.infer<typeof resetRequestSchema>;
export type ResetResponse = {
  backup_path: string;
  deleted: Record<string, number>;
};

export function emptyDay(date: string): DeenDay {
  return {
    date,
    fajr: null,
    dhuhr: null,
    asr: null,
    maghrib: null,
    isha: null,
    morning_adhkar: false,
    evening_adhkar: false,
    night_ayat_kursi: false,
    night_baqarah: false,
    night_three_suras: false,
    ruqyah: false,
    istighfar_count: 0,
    note: null,
  };
}
