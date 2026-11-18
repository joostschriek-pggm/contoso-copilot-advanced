import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ageOn, annualAccrual, earlyRetirementReduction, contributionSplit, pensionableSalary, projectPension } from '../src/domain/pension.ts';

test('pensionable salary subtracts the franchise', () => {
  assert.equal(pensionableSalary(52_000, 1), 34_455);
});

test('pensionable salary applies the part-time factor', () => {
  assert.equal(pensionableSalary(46_000, 0.6), 17_073);
});

test('pensionable salary is capped at the salary cap', () => {
  assert.equal(pensionableSalary(150_000, 1), 120_255);
});

test('pensionable salary is never negative (salary below franchise)', () => {
  assert.equal(pensionableSalary(16_000, 0.9), 0);
});

test('pensionable salary rejects invalid part-time factors', () => {
  assert.throws(() => pensionableSalary(40_000, 0), RangeError);
  assert.throws(() => pensionableSalary(40_000, 1.2), RangeError);
});

test('annual accrual is 1.75% of pensionable salary', () => {
  assert.equal(annualAccrual(34_455), 602.96);
});

test('contribution split is 60% employer / 40% employee', () => {
  assert.deepEqual(contributionSplit(10_000), { total: 2_700, employer: 1_620, employee: 1_080 });
});

test('age is calculated in whole years', () => {
  assert.equal(ageOn('1972-04-15', '2026-11-18'), 54);
  assert.equal(ageOn('1979-12-20', '2026-11-18'), 46);
});

test('projection at the standard retirement age adds future accrual', () => {
  const result = projectPension({
    birthDate: '1972-04-15', fullTimeSalary: 52_000, partTimeFactor: 1, accruedToDate: 5_000, asOf: '2026-11-18',
  });
  assert.equal(result.yearsToRetirement, 14);
  assert.equal(result.futureAccrual, 8_441.44);
  assert.equal(result.projectedAnnualPension, 13_441.44);
  assert.equal(result.retirementDate, '2040-04-15');
});

const base = {
  birthDate: '1972-04-15', fullTimeSalary: 52_000, partTimeFactor: 1, accruedToDate: 5_000, asOf: '2026-11-18',
};

test('early retirement reduction is 6.5% per year before 68', () => {
  assert.equal(earlyRetirementReduction(68), 0);
  assert.equal(earlyRetirementReduction(67), 0.065);
  assert.equal(earlyRetirementReduction(63), 0.325);
  assert.equal(earlyRetirementReduction(60), 0.52);
});

test('projection at 63 stops accrual and reduces the total (R5)', () => {
  const result = projectPension({ ...base, retirementAge: 63 });
  assert.equal(result.yearsToRetirement, 9);
  assert.equal(result.futureAccrual, 5_426.64);
  assert.equal(result.unreducedAnnualPension, 10_426.64);
  assert.equal(result.earlyRetirementReduction, 0.325);
  assert.equal(result.projectedAnnualPension, 7_037.98);
});

test('projection at 68 has no reduction', () => {
  const result = projectPension({ ...base, retirementAge: 68 });
  assert.equal(result.earlyRetirementReduction, 0);
  assert.equal(result.projectedAnnualPension, result.unreducedAnnualPension);
});

test('projection boundaries 60 and 67', () => {
  assert.equal(projectPension({ ...base, retirementAge: 60 }).earlyRetirementReduction, 0.52);
  assert.equal(projectPension({ ...base, retirementAge: 67 }).earlyRetirementReduction, 0.065);
});

test('projection rejects ages below 60, above 68 and below the current age', () => {
  assert.throws(() => projectPension({ ...base, retirementAge: 59 }), RangeError);
  assert.throws(() => projectPension({ ...base, retirementAge: 69 }), RangeError);
  // member is 54: 53 is below 60 anyway; use an older member for current-age check
  const older = { ...base, birthDate: '1963-01-01' }; // age 63
  assert.throws(() => projectPension({ ...older, retirementAge: 62 }), RangeError);
});

test('retiring at the current age is accepted with no future accrual', () => {
  const result = projectPension({ ...base, birthDate: '1963-01-01', retirementAge: 63 });
  assert.equal(result.yearsToRetirement, 0);
  assert.equal(result.futureAccrual, 0);
});

test('salary growth applies only over the working years', () => {
  const flat = projectPension({ ...base, retirementAge: 63 });
  const grown = projectPension({ ...base, retirementAge: 63, salaryGrowthRate: 0.02 });
  const full = projectPension({ ...base, salaryGrowthRate: 0.02 });
  assert.ok(grown.futureAccrual > flat.futureAccrual);
  assert.ok(grown.futureAccrual < full.futureAccrual);
});

test('member aged 69 or older cannot be projected, even with the default age', () => {
  const old = { ...base, birthDate: '1957-01-01' }; // age 69
  assert.throws(() => projectPension(old), RangeError);
  assert.throws(() => projectPension({ ...old, retirementAge: 68 }), RangeError);
});
