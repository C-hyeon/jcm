'use strict';

async function postJson(url, headers, body, signal) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal });
  if (!res.ok) {
    const err = new Error(`ai_http_${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

const claude = {
  async generate({ system, user, signal, maxTokens }) {
    const data = await postJson(
      'https://api.anthropic.com/v1/messages',
      { 'x-api-key': process.env.AI_API_KEY, 'anthropic-version': '2023-06-01' },
      { model: process.env.AI_MODEL || 'claude-haiku-5-5', max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] },
      signal,
    );
    return {
      text: (data.content || []).filter((c) => c.type === 'text').map((c) => c.text).join(''),
      usage: { input: data.usage?.input_tokens, output: data.usage?.output_tokens },
    };
  },
};

const gemini = {
  async generate({ system, user, signal, maxTokens }) {
    const model = process.env.AI_MODEL;
    if (!model) throw new Error('AI_MODEL is required for gemini');
    const data = await postJson(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      { 'x-goog-api-key': process.env.AI_API_KEY },
      {
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: { responseMimeType: 'application/json', maxOutputTokens: maxTokens, temperature: 0.4 },
      },
      signal,
    );
    return {
      text: (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join(''),
      usage: { input: data.usageMetadata?.promptTokenCount, output: data.usageMetadata?.candidatesTokenCount },
    };
  },
};

const openai = {
  async generate({ system, user, signal, maxTokens }) {
    const model = process.env.AI_MODEL;
    if (!model) throw new Error('AI_MODEL is required for openai');
    const data = await postJson(
      'https://api.openai.com/v1/chat/completions',
      { authorization: `Bearer ${process.env.AI_API_KEY}` },
      {
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        response_format: { type: 'json_object' },
        max_completion_tokens: maxTokens,
      },
      signal,
    );
    return {
      text: data.choices?.[0]?.message?.content || '',
      usage: { input: data.usage?.prompt_tokens, output: data.usage?.completion_tokens },
    };
  },
};

const mock = {
  async generate({ user }) {
    const payload = JSON.parse(user);
    const cands = payload.candidates || [];
    const weak = payload.state?.weakTypes || [];
    const topics = [0, 1, 2].map((i) => ({
      title: weak[i] ? `${weak[i].type} 유형 다시 잡기` : `${cands[i]?.subject || '핵심'} 개념 복습`,
      reason: weak[i] ? `${weak[i].subject} 과목 '${weak[i].type}' 취약도가 ${weak[i].score}%입니다.` : '진도가 낮은 과목을 먼저 보강하세요.',
      subjectId: cands[i]?.subjectId || null,
      materialIds: cands.slice(i * 2, i * 2 + 2).map((c) => c.id),
    }));
    if (process.env.AI_MOCK_FAIL === 'true') throw new Error('mock_failure');
    return { text: JSON.stringify({ topics }), usage: { input: user.length / 2, output: 200 } };
  },
};

const PROVIDERS = { claude, gemini, openai, mock };

function getProvider() {
  const name = (process.env.AI_PROVIDER || 'mock').toLowerCase();
  const provider = PROVIDERS[name];
  if (!provider) throw new Error(`unknown AI_PROVIDER: ${name}`);
  if (name !== 'mock' && !process.env.AI_API_KEY) throw new Error('AI_API_KEY is not set');
  return { name, provider };
}

module.exports = { getProvider };
