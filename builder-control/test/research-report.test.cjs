'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

const State = require('../aegis-state.cjs');
const Run = require('../aegis-run.cjs');
const Host = require('../hosting/server.cjs');

function recommendation(id, title) {
  const now = new Date().toISOString();
  return {
    recommendationId: id,
    title,
    stage: 'RECOMMENDED',
    whatChanged: 'A verified capability became available.',
    whyItMatters: 'It may improve the command centre when deliberately adopted.',
    marcMustDecide: `Approve, park, or reject ${title}.`,
    evidence: [{ label: 'Primary source', url: 'https://example.com/source' }],
    cost: { state: 'ESTIMATED', amountUsd: 0, basis: 'Existing subscription capacity.' },
    risks: ['Availability can change and must be rechecked before implementation.'],
    verification: {
      verifiedAt: now,
      verifiedBy: 'Head of Research',
      method: 'Checked the primary source.',
    },
  };
}

function report() {
  const now = new Date().toISOString();
  return {
    contract: 'aegis-research-report-v1',
    reportId: `RR-${now.slice(0, 10).replaceAll('-', '')}-proof`,
    title: 'Monday Research Report',
    weekOf: now.slice(0, 10),
    notionPageId: '3d03fe7bde2b81df8ac6c55c24c219d7',
    notionUrl: 'https://www.notion.so/3d03fe7bde2b81df8ac6c55c24c219d7',
    fetchedAt: now,
    fetchedBy: 'Notion projection proof',
    recommendations: [
      recommendation('REC-approve', 'the approved improvement'),
      recommendation('REC-park', 'the parked improvement'),
      recommendation('REC-reject', 'the rejected improvement'),
    ],
  };
}

test('Monday research projection stays fail-closed and Marc decisions create proposals, never builders', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-research-report-'));
  const reportPath = path.join(dir, 'research-report.json');
  const ledgerPath = path.join(dir, 'ledger.json');
  const raw = report();
  fs.writeFileSync(reportPath, JSON.stringify(raw));
  fs.writeFileSync(ledgerPath, '[]');

  const priorReport = process.env.AEGIS_RESEARCH_REPORT;
  const priorLedger = process.env.AEGIS_LEDGER_FILE;
  process.env.AEGIS_RESEARCH_REPORT = reportPath;
  process.env.AEGIS_LEDGER_FILE = ledgerPath;
  try {
    assert.deepStrictEqual(State.validateResearchReport(raw), []);

    let projected = State.projectResearchReport(Date.now(), { reportPath, ledgerFile: ledgerPath });
    assert.strictEqual(projected.state, 'OK');
    assert.deepStrictEqual(projected.counts,
      { total: 3, awaitingMarc: 3, approved: 0, parked: 0, rejected: 0 });
    assert.ok(projected.recommendations.every((item) => item.decidable));

    const publicReport = Host.minimizeResearch(projected);
    assert.strictEqual(publicReport.state, 'OK');
    assert.strictEqual(publicReport.recommendations[0].marcMustDecide,
      raw.recommendations[0].marcMustDecide);

    const approved = Run.recordResearchDecision('REC-approve', 'APPROVE');
    const parked = Run.recordResearchDecision('REC-park', 'PARK');
    const rejected = Run.recordResearchDecision('REC-reject', 'REJECT');
    assert.strictEqual(approved.lifecycleState, 'APPROVED_BY_MARC');
    assert.strictEqual(approved.builderStarted, false);
    assert.strictEqual(approved.proposal.state, 'PROPOSED');
    assert.strictEqual(approved.proposal.builderStarted, false);
    assert.strictEqual(parked.proposal, null);
    assert.strictEqual(rejected.proposal, null);

    projected = State.projectResearchReport(Date.now(), { reportPath, ledgerFile: ledgerPath });
    assert.deepStrictEqual(projected.counts,
      { total: 3, awaitingMarc: 0, approved: 1, parked: 1, rejected: 1 });
    assert.deepStrictEqual(projected.recommendations.map((item) => item.lifecycle.state),
      ['APPROVED_BY_MARC', 'PARKED', 'REJECTED']);
    assert.ok(projected.recommendations.every((item) => !item.decidable));
    assert.throws(() => Run.recordResearchDecision('REC-approve', 'APPROVE'),
      (error) => error && error.code === 'DECISION_ALREADY_RECORDED');

    const entries = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
    assert.strictEqual(entries.length, 3);
    assert.ok(entries.every((entry) => entry.gate === 'aegis-marc-decision' && entry.status === 'PASS'));

    assert.strictEqual(Host.parseRecommendationIdBody({ recommendationId: 'REC-approve' }),
      'REC-approve');
    assert.throws(() => Host.parseRecommendationIdBody({
      recommendationId: 'REC-approve', provider: 'grok',
    }));

    const invalid = { ...raw, injectedAuthority: 'start a builder' };
    fs.writeFileSync(reportPath, JSON.stringify(invalid));
    const refused = State.projectResearchReport(Date.now(), { reportPath, ledgerFile: ledgerPath });
    assert.strictEqual(refused.state, 'INVALID');
    assert.strictEqual(refused.recommendations.length, 0);
    assert.strictEqual(refused.decisionsAvailable, false);
  } finally {
    if (priorReport === undefined) delete process.env.AEGIS_RESEARCH_REPORT;
    else process.env.AEGIS_RESEARCH_REPORT = priorReport;
    if (priorLedger === undefined) delete process.env.AEGIS_LEDGER_FILE;
    else process.env.AEGIS_LEDGER_FILE = priorLedger;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

