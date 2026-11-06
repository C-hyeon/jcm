'use strict';
jest.mock('../src/config/firebase', () => require('./fakeFirebase'));
const request = require('supertest');
const fake = require('./fakeFirebase');
const { createApp } = require('../src/app');
const app = createApp();
const DocRef = fake.db().collection('x').doc('y').constructor;

test('GET 최초 생성 도중 PUT이 끼어들어도 닉네임·동의가 유지된다', async () => {
  const origGet = DocRef.prototype.get;
  let injected = false;
  DocRef.prototype.get = async function () {
    const snap = await origGet.call(this);
    if (this.path === 'users/racer' && !snap.exists && !injected) {
      injected = true; // GET이 "문서 없음"을 읽은 직후 가입 PUT 완료
      const put = await request(app).put('/api/me').set('Authorization', 'Bearer test:racer').send({ nickname: '새닉네임', consent: true });
      expect(put.status).toBe(200);
    }
    return snap;
  };
  try {
    const get = await request(app).get('/api/me').set('Authorization', 'Bearer test:racer');
    expect(get.status).toBe(200);
  } finally {
    DocRef.prototype.get = origGet;
  }
  const doc = fake._store.get('users/racer');
  expect(doc.nickname).toBe('새닉네임');
  expect(doc.consentAgreedAt).toEqual(expect.any(String));
});

test('PUT이 GET보다 먼저 도착해도 기본값이 채워지고 이후 GET이 덮어쓰지 않는다', async () => {
  const A = 'Bearer test:early';
  expect((await request(app).put('/api/me').set('Authorization', A).send({ nickname: '먼저가입', consent: true })).status).toBe(200);
  const doc = fake._store.get('users/early');
  expect(doc).toMatchObject({ nickname: '먼저가입', role: 'user', createdAt: expect.any(Date), consentAgreedAt: expect.any(String) });
  const get = await request(app).get('/api/me').set('Authorization', A);
  expect(get.body).toMatchObject({ nickname: '먼저가입', consentAgreedAt: expect.any(String) });
});
