'use strict';
const { z } = require('zod');
const { isValidDate } = require('./dates');
const { isSafeHttpsUrl } = require('./url');

const STAGES = ['intro', 'concept', 'practice', 'final'];
const EXAM_TYPES = ['written', 'practical'];
const MATERIAL_TYPES = ['video', 'blog', 'cbt', 'official', 'doc'];
const DIFFICULTIES = ['high', 'mid', 'low'];
const PROGRESS_STEPS = [0, 25, 50, 75, 100];

const m = (message) => ({ errorMap: () => ({ message }) });
const Id = z.string().trim().min(1).max(60);
const DateStr = z.string().refine(isValidDate, '날짜 형식(YYYY-MM-DD)이 올바르지 않습니다.');

// UC-02 시험 정보 및 학습 조건 + 벤치마킹(EBS 단추): 과목별 자신감 입력
const StudyProfileSchema = z.object({
  examType: z.enum(EXAM_TYPES, m('시험 구분(필기/실기)을 선택해 주세요.')),
  examId: Id.nullable().optional(),
  examDate: DateStr,
  dailyHours: z
    .number(m('하루 학습 시간을 숫자로 입력해 주세요.'))
    .min(0.5, '하루 학습 시간은 30분 이상이어야 합니다.')
    .max(12, '하루 학습 시간은 12시간 이하로 입력해 주세요.')
    .refine((v) => Number.isInteger(v * 2), '하루 학습 시간은 30분 단위로 입력해 주세요.'),
  studyDays: z
    .array(z.number().int().min(0).max(6))
    .min(1, '학습 요일을 하루 이상 선택해 주세요.')
    .max(7)
    .transform((a) => [...new Set(a)].sort()),
  stage: z.enum(STAGES, m('현재 학습 단계를 선택해 주세요.')),
  subjectProgress: z.record(Id, z.number().min(0).max(100)).default({}),
  subjectConfidence: z.record(Id, z.union([z.literal(1), z.literal(2), z.literal(3)])).default({}),
});

const MeUpdateSchema = z.object({
  nickname: z.string().trim().min(2, '닉네임은 2자 이상이어야 합니다.').max(20, '닉네임은 20자 이하로 입력해 주세요.').optional(),
  targetExamId: Id.nullable().optional(),
  consent: z.literal(true).optional(),
});

const TaskPatchSchema = z
  .object({
    done: z.boolean().optional(),
    actualMinutes: z.number().int().min(0).max(720).nullable().optional(),
    understanding: z.union([z.literal(1), z.literal(2), z.literal(3)]).nullable().optional(),
    needsReview: z.boolean().optional(),
    checklist: z.array(z.object({ text: z.string().max(80), done: z.boolean() })).max(6).optional(),
  })
  .refine((o) => Object.keys(o).length > 0, '변경할 항목이 없습니다.');

const ProgressPutSchema = z.object({
  unitId: Id,
  rate: z.number().refine((v) => PROGRESS_STEPS.includes(v), '진행률은 0, 25, 50, 75, 100% 중에서 선택해 주세요.'),
  confirmDecrease: z.boolean().optional(),
});

const SourceRefSchema = z
  .object({
    round: z.string().trim().max(30).optional().default(''),
    number: z.string().trim().max(20).optional().default(''),
    url: z
      .string()
      .trim()
      .max(500)
      .refine((v) => v === '' || isSafeHttpsUrl(v), '출처 링크는 https:// 주소만 입력할 수 있습니다.')
      .optional()
      .default(''),
  })
  .default({});

const WrongNoteCreateSchema = z.object({
  subjectId: Id,
  unitId: Id.nullable().optional(),
  typeTag: z.string(m('유형 태그를 선택해 주세요.')).trim().min(1, '유형 태그를 선택해 주세요.').max(30),
  difficulty: z.enum(DIFFICULTIES, m('난이도를 선택해 주세요.')),
  sourceRef: SourceRefSchema,
  memo: z.string().max(1000, '메모는 1,000자 이하로 입력해 주세요.').optional().default(''),
});
const WrongNotePatchSchema = z
  .object({
    unitId: Id.nullable().optional(),
    typeTag: z.string().trim().min(1).max(30).optional(),
    difficulty: z.enum(DIFFICULTIES).optional(),
    sourceRef: SourceRefSchema.optional(),
    memo: z.string().max(1000, '메모는 1,000자 이하로 입력해 주세요.').optional(),
    reviewed: z.boolean().optional(),
  })
  .refine((o) => Object.keys(o).length > 0, '변경할 항목이 없습니다.');


const MaterialSchema = z.object({
  title: z.string().trim().min(2, '제목은 2자 이상 입력해 주세요.').max(100),
  sourceName: z.string().trim().min(1, '출처(사이트/채널명)는 필수입니다.').max(60),
  author: z.string().trim().min(1, '원저작자는 필수입니다.').max(60),
  url: z.string().trim().max(500).refine(isSafeHttpsUrl, 'https:// 로 시작하는 공개 주소만 등록할 수 있습니다.'),
  subjectId: Id.nullable().optional().default(null),
  unitIds: z.array(Id).max(20).default([]),
  type: z.enum(MATERIAL_TYPES, m('자료 유형을 선택해 주세요.')),
  stage: z.enum(STAGES, m('학습 단계를 선택해 주세요.')),
  reason: z.string().trim().min(5, '추천 이유를 5자 이상 입력해 주세요.').max(300),
  tags: z.array(z.string().trim().min(1).max(30)).max(10).default([]),
  visible: z.boolean().default(true),
});

const ExamSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{3,40}$/, '시험 ID는 영문 소문자·숫자·하이픈만 사용합니다.'),
  year: z.number().int().min(2020).max(2100),
  round: z.number().int().min(1).max(5),
  type: z.enum(EXAM_TYPES),
  examDate: DateStr,
  source: z.string().max(200).default('Q-Net 공고'),
});
const UnitSchema = z.object({
  id: Id,
  name: z.string().trim().min(1).max(60),
  order: z.number().int().min(0),
  standardHours: z.number().min(0.5).max(100),
  core: z.boolean().default(false),
  tags: z.array(z.string().trim().min(1).max(30)).max(10).default([]),
});
const SubjectSchema = z.object({
  id: Id,
  name: z.string().trim().min(1).max(60),
  examType: z.enum(EXAM_TYPES),
  order: z.number().int().min(0),
  tags: z.array(z.string().trim().min(1).max(30)).max(30).default([]),
  units: z.array(UnitSchema).min(1).max(50),
});
const MastersSchema = z
  .object({
    exams: z.array(ExamSchema).max(100).optional(),
    subjects: z.array(SubjectSchema).max(40).optional(),
  })
  .refine((o) => o.exams || o.subjects, '변경할 마스터 데이터가 없습니다.');

module.exports = {
  z,
  STAGES,
  EXAM_TYPES,
  MATERIAL_TYPES,
  DIFFICULTIES,
  PROGRESS_STEPS,
  StudyProfileSchema,
  MeUpdateSchema,
  TaskPatchSchema,
  ProgressPutSchema,
  WrongNoteCreateSchema,
  WrongNotePatchSchema,
  MaterialSchema,
  MastersSchema,
};
