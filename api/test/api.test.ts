import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './helpers.ts';

describe('Contoso API', () => {
  let api: Awaited<ReturnType<typeof startTestServer>>;
  before(async () => { api = await startTestServer(); });
  after(async () => { await api.close(); });

  test('GET /api/health returns ok', async () => {
    const res = await api.get('/api/health');
    assert.equal(res.status, 200);
    assert.equal((await res.json()).status, 'ok');
  });

  test('GET /api/members lists all synthetic members', async () => {
    const members = await (await api.get('/api/members')).json();
    assert.equal(members.length, 8);
  });

  test('GET /api/members filters by status', async () => {
    const members = await (await api.get('/api/members?status=deferred')).json();
    assert.deepEqual(members.map((m: { id: string }) => m.id), ['M-1006']);
  });

  test('GET /api/members rejects an unknown status with the error envelope', async () => {
    const res = await api.get('/api/members?status=unknown');
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error.code, 'BAD_REQUEST');
  });

  test('GET /api/members/:id returns 404 for an unknown member', async () => {
    const res = await api.get('/api/members/M-9999');
    assert.equal(res.status, 404);
    assert.equal((await res.json()).error.code, 'NOT_FOUND');
  });

  test('GET /api/members/:id/contributions returns the yearly history', async () => {
    const rows = await (await api.get('/api/members/M-1001/contributions')).json();
    assert.equal(rows.length, 10);
    assert.equal(rows[0].year, 2016);
  });

  test('GET /api/members/:id/statement for a full-time member', async () => {
    const statement = await (await api.get('/api/members/M-1001/statement')).json();
    assert.equal(statement.yearsOfService, 10);
    assert.equal(statement.currentPensionableSalary, 34_455);
    assert.equal(statement.currentYearAccrual, 602.96);
  });

  test('POST /api/projections projects at the standard retirement age', async () => {
    const res = await api.post('/api/projections', { memberId: 'M-1001' });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.retirementAge, 68);
    assert.ok(body.projectedAnnualPension > body.accruedToDate);
  });

  test('POST /api/projections at 68 has no reduction', async () => {
    const body = await (await api.post('/api/projections', { memberId: 'M-1001' })).json();
    assert.equal(body.earlyRetirementReduction, 0);
    assert.equal(body.projectedAnnualPension, body.unreducedAnnualPension);
  });

  test('POST /api/projections supports early retirement (M-1004 at 63)', async () => {
    const res = await api.post('/api/projections', { memberId: 'M-1004', retirementAge: 63 });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.earlyRetirementReduction, 0.325);
    assert.equal(body.yearsToRetirement, 3);
    assert.ok(Math.abs(body.unreducedAnnualPension - 13_802.81) < 0.01);
    assert.ok(Math.abs(body.projectedAnnualPension - 9_316.9) < 0.01);
  });

  test('POST /api/projections accepts the boundaries 60 (current age), 67 and 68', async () => {
    const at60 = await (await api.post('/api/projections', { memberId: 'M-1004', retirementAge: 60 })).json();
    assert.equal(at60.futureAccrual, 0);
    assert.equal(at60.earlyRetirementReduction, 0.52);
    const at67 = await (await api.post('/api/projections', { memberId: 'M-1001', retirementAge: 67 })).json();
    assert.equal(at67.earlyRetirementReduction, 0.065);
    const at68 = await (await api.post('/api/projections', { memberId: 'M-1001', retirementAge: 68 })).json();
    assert.equal(at68.earlyRetirementReduction, 0);
  });

  test('POST /api/projections returns 422 for ages 59, 69 and below the current age', async () => {
    for (const [memberId, retirementAge] of [['M-1004', 59], ['M-1004', 69], ['M-1006', 66]] as const) {
      const res = await api.post('/api/projections', { memberId, retirementAge });
      assert.equal(res.status, 422, `${memberId} at ${retirementAge}`);
      assert.equal((await res.json()).error.code, 'UNPROCESSABLE');
    }
  });

  test('POST /api/projections returns 400 for a malformed retirementAge', async () => {
    assert.equal((await api.post('/api/projections', { memberId: 'M-1004', retirementAge: 63.5 })).status, 400);
    assert.equal((await api.post('/api/projections', { memberId: 'M-1004', retirementAge: '63' })).status, 400);
  });

  test('POST /api/projections returns 422 for a member past 68 (fixed clock 2028-11-18)', async () => {
    const late = await startTestServer('2028-11-18'); // M-1006 (born 1959-11-05) is 69
    try {
      const res = await late.post('/api/projections', { memberId: 'M-1006' });
      assert.equal(res.status, 422);
      assert.ok((await res.json()).error.message);
      const res69 = await late.post('/api/projections', { memberId: 'M-1006', retirementAge: 69 });
      assert.equal(res69.status, 422);
    } finally {
      await late.close();
    }
  });

  test('GET /api/members/:id/statement returns 422 for a member past 68 (fixed clock 2028-11-18)', async () => {
    const late = await startTestServer('2028-11-18');
    try {
      const res = await late.get('/api/members/M-1006/statement');
      assert.equal(res.status, 422);
      const body = await res.json();
      assert.equal(body.error.code, 'UNPROCESSABLE');
      assert.ok(body.error.message);
    } finally {
      await late.close();
    }
  });

  test('POST /api/projections validates the body', async () => {
    const res = await api.post('/api/projections', {});
    assert.equal(res.status, 400);
    assert.deepEqual((await res.json()).error.details, ['memberId is required']);
  });

  test('POST /api/service-requests creates an open request', async () => {
    const res = await api.post('/api/service-requests', {
      memberId: 'M-1002', category: 'address-change', subject: 'New address', description: 'Moved to Assen',
    });
    assert.equal(res.status, 201);
    const created = await res.json();
    assert.equal(created.status, 'open');
    assert.match(created.id, /^SR-\d+$/);
  });

  test('GET /api/service-requests filters by status', async () => {
    const open = await (await api.get('/api/service-requests?status=closed')).json();
    assert.deepEqual(open.map((r: { id: string }) => r.id), ['SR-5002']);
  });

  test('unknown API route returns 404 envelope', async () => {
    const res = await api.get('/api/unknown');
    assert.equal(res.status, 404);
  });
});
