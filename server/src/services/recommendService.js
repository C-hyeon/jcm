'use strict';
/**
 * AI 학습 추천 (UC-09)
 * ① 학습 상태 요약(개인 식별정보 제외) ② 후보 자료 ≤20건 ③ AI JSON 응답 ④ 허브 자료 ID 검증
 * AI 20초 초과·오류·JSON 파싱 실패·유효 자료 없음 → 규칙 기반 대체 추천
 */
const { z } = require('zod');
const { db, FieldValue } = require('../config/firebase');
const { userCol, metaRef } = require('../lib/refs');
const { HttpError } = require('../lib/httpError');
const { log, hashUid } = require('../lib/logger');
const { addDays } = require('../lib/dates');
const { getLearningSummary } = require('./summary');
const { getMaterials, getMaterialMap, materialCard } = require('./masters');
const { selectCandidates, ruleBasedRecommend } = require('./materialLogic');
const { getProvider } = require('./ai/providers');

const DAILY_LIMIT = Number(process.env.AI_DAILY_LIMIT || 10);
const AI_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS || 20000);
const MAX_OUTPUT_TOKENS = 800;
const RETENTION_DAYS = 180;

const ResponseSchema = z.object({
  topics: z
    .array(
      z.object({
        title: z.string().min(1).max(80),
        reason: z.string().min(1).max(300),
        subjectId: z.string().max(60).nullable().optional(),
        materialIds: z.array(z.string().max(80)).max(5).default([]),
      }),
    )
    .min(1)
    .max(3),
});

const SYSTEM_PROMPT = [
  '너는 정보처리기사 수험생의 학습 코치다. 주어진 학습 상태 요약과 후보 자료 목록만 근거로 다음에 공부할 주제 3개를 추천한다.',
  '규칙:',
  '1) materialIds에는 후보 자료 목록에 있는 id만 주제당 1~2개 넣는다. 목록에 없는 자료나 URL을 만들지 않는다.',
  '2) 문제를 새로 만들거나 정답·해설을 쓰지 않는다.',
  '3) 취약 유형 상위 항목과 진도가 낮은 과목, 복습 필요 단원을 우선 반영한다.',
  '4) title은 30자 이내, reason은 한국어 1~2문장 120자 이내로 학습 상태의 수치를 근거로 쓴다.',
  '5) 다음 JSON 형식으로만 답한다: {"topics":[{"title":"","reason":"","subjectId":"","materialIds":[""]}]}',
].join('\n');

/** 사용자별 AI 추천 일일 한도(초과 시 429) */
async function consumeQuota(uid, today) {
  const ref = metaRef(uid, 'usage');
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const d = snap.exists ? snap.data() : {};
    const count = d.aiDate === today ? d.aiCount || 0 : 0;
    if (count >= DAILY_LIMIT) {
      throw new HttpError(429, 'AI_DAILY_LIMIT', `AI 추천은 하루 ${DAILY_LIMIT}회까지 받을 수 있습니다. 내일 다시 이용하거나 학습 경로 화면을 활용해 주세요.`);
    }
    tx.set(ref, { aiDate: today, aiCount: count + 1 }, { merge: true });
    return DAILY_LIMIT - count - 1;
  });
}

function buildStatePayload(summary, candidates) {
  // 이메일·닉네임·UID·자유 메모는 넣지 않는다(명세 3.8 AI 요청 데이터 최소화)
  const reviewUnits = summary.subjects.flatMap((s) => s.units.filter((u) => u.needsReview || u.understanding === 1).map((u) => `${s.name} · ${u.name}`));
  return {
    state: {
      dday: summary.dday,
      examType: summary.examType === 'written' ? '필기' : '실기',
      stage: summary.profile?.stage || null,
      overallProgress: summary.overall,
      subjects: summary.subjects.map((s) => ({ id: s.id, name: s.name, progress: s.rate })),
      weakTypes: summary.weak.top3.map((w) => ({ subject: w.subjectName, subjectId: w.subjectId, type: w.typeTag, score: Math.round(w.score * 1000) / 10 })),
      reviewUnits: reviewUnits.slice(0, 5),
    },
    candidates: candidates.map((m) => ({ id: m.id, title: m.title, subjectId: m.subjectId, subject: summary.subjects.find((s) => s.id === m.subjectId)?.name || '공통', type: m.type, stage: m.stage, tags: m.tags })),
  };
}

function parseAiText(text) {
  const cleaned = String(text || '').replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  return ResponseSchema.parse(JSON.parse(cleaned));
}

async function callAiWithDeadline(provider, payload) {
  const deadline = Date.now() + AI_TIMEOUT_MS;
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining < 2000) break;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), remaining);
    try {
      return await provider.generate({ ...payload, signal: ctrl.signal, maxTokens: MAX_OUTPUT_TOKENS });
    } catch (e) {
      lastErr = ctrl.signal.aborted ? new Error('ai_timeout') : e;
      if (ctrl.signal.aborted) break; // 시간 초과면 재시도하지 않음
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr || new Error('ai_timeout');
}

function expand(rec, materialMap, subjects) {
  return {
    id: rec.id,
    engine: rec.engine,
    feedback: rec.feedback ?? null,
    createdDate: rec.createdDate,
    fallbackReason: rec.fallbackReason || null,
    topics: (rec.topics || []).map((t) => ({
      title: t.title,
      reason: t.reason,
      subjectId: t.subjectId || null,
      subjectName: subjects?.find((s) => s.id === t.subjectId)?.name || null,
      materials: (t.materialIds || []).map((id) => materialCard(materialMap.get(id))).filter(Boolean),
    })),
  };
}

async function recommend(uid, today) {
  const remaining = await consumeQuota(uid, today);
  const summary = await getLearningSummary(uid, { today });
  if (!summary.profile) throw new HttpError(400, 'PROFILE_REQUIRED', '먼저 시험 정보와 학습 조건을 입력해 주세요.');

  const materials = await getMaterials();
  const candidates = selectCandidates({ materials, weakTop: summary.weak.top3, subjects: summary.subjects });
  const candidateIds = new Set(candidates.map((m) => m.id));

  let engine = 'ai';
  let topics;
  let fallbackReason = null;
  let usage = null;
  const started = Date.now();
  let providerName = 'none';
  try {
    const { name, provider } = getProvider();
    providerName = name;
    const out = await callAiWithDeadline(provider, { system: SYSTEM_PROMPT, user: JSON.stringify(buildStatePayload(summary, candidates)) });
    usage = out.usage;
    const parsed = parseAiText(out.text);
    // 허브에 없는 자료 ID는 폐기(명세 3.8 AI 응답 검증)
    topics = parsed.topics.map((t) => ({
      title: t.title,
      reason: t.reason,
      subjectId: summary.subjects.some((s) => s.id === t.subjectId) ? t.subjectId : null,
      materialIds: [...new Set(t.materialIds.filter((id) => candidateIds.has(id)))].slice(0, 3),
    }));
    if (!topics.some((t) => t.materialIds.length)) throw new Error('no_valid_material');
  } catch (e) {
    engine = 'rule';
    fallbackReason = e.message === 'ai_timeout' ? 'timeout' : e instanceof SyntaxError || e.name === 'ZodError' ? 'parse_error' : e.message === 'no_valid_material' ? 'invalid_material' : 'error';
    topics = ruleBasedRecommend({ weakTop: summary.weak.top3, subjects: summary.subjects, materials }).topics;
  }
  // 송·수신 기록: 시각, 사용자 해시, 토큰 사용량, 성공 여부만(요청 본문 미저장)
  log('ai.recommend', { user: hashUid(uid), provider: providerName, ms: Date.now() - started, engine, fallbackReason, tokensIn: usage?.input, tokensOut: usage?.output });

  const col = userCol(uid, 'recommendations');
  const ref = col.doc();
  const rec = {
    topics,
    materialIds: [...new Set(topics.flatMap((t) => t.materialIds))],
    reason: topics.map((t) => t.reason).join(' / ').slice(0, 500),
    engine,
    fallbackReason,
    feedback: null,
    createdDate: today,
    createdAt: FieldValue.serverTimestamp(),
    expireAt: new Date(Date.now() + RETENTION_DAYS * 86400000), // Firestore TTL 정책용
  };
  await ref.set(rec);

  // 보존 기간(180일) 지난 이력 정리
  const old = await col.where('createdDate', '<', addDays(today, -RETENTION_DAYS)).limit(20).get();
  if (!old.empty) {
    const batch = db().batch();
    old.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }

  const materialMap = await getMaterialMap();
  return { ...expand({ id: ref.id, ...rec }, materialMap, summary.subjects), remainingToday: remaining };
}

module.exports = { recommend, expand, parseAiText, SYSTEM_PROMPT };
