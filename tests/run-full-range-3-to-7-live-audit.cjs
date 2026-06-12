#!/usr/bin/env node
/*
Optional live calibration runner for the IELTS GT Writing Hub.
Usage after local server/deploy is available:
  IELTS_TEST_ENDPOINT=http://localhost:3000/api/grade-ielts-production-router node tests/run-full-range-3-to-7-live-audit.cjs
  IELTS_TEST_ENDPOINT=https://your-deployment.vercel.app/api/grade-ielts-production-router node tests/run-full-range-3-to-7-live-audit.cjs
*/
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const corpusPath = path.join(root, 'tests', 'fixtures', 'full-range-3-to-7-gold-corpus-v1.json');
const corpus = JSON.parse(fs.readFileSync(corpusPath, 'utf8'));
const endpoint = process.env.IELTS_TEST_ENDPOINT || 'http://localhost:3000/api/grade-ielts-production-router';
const outDir = path.join(root, 'tests', 'reports');
fs.mkdirSync(outDir, { recursive: true });

function roundHalf(n) { return Math.round(Number(n) * 2) / 2; }
function getBand(payload) {
  const candidates = [payload.finalBand, payload.overallBand, payload.score, payload.scoreCalculation && payload.scoreCalculation.finalBand];
  for (const x of candidates) if (Number.isFinite(Number(x))) return roundHalf(Number(x));
  return null;
}
function getCriteria(payload) { return payload.finalCriteria || payload.criteria || payload.criterionScores || null; }
function flattening(criteria) {
  const vals = Object.values(criteria || {}).map(Number).filter(Number.isFinite);
  return vals.length === 4 && vals.every((v) => v === vals[0]);
}
async function post(item) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task: item.task, questionPrompt: item.prompt, essay: item.response })
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch (e) { throw new Error(`Non-JSON response for ${item.id}: ${text.slice(0, 300)}`); }
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${item.id}: ${JSON.stringify(json).slice(0, 400)}`);
  return json;
}
(async () => {
  const rows = [];
  for (const item of corpus.items) {
    const payload = await post(item);
    const band = getBand(payload);
    const criteria = getCriteria(payload);
    const absError = Number.isFinite(band) ? Math.abs(band - item.targetOverall) : null;
    const flat = flattening(criteria);
    rows.push({ id: item.id, task: item.task, targetOverall: item.targetOverall, actualOverall: band, absError, flatCriteria: flat, criteria, selectedSystem: payload.routerAudit && payload.routerAudit.selectedSystem, routeDecision: payload.routerAudit && payload.routerAudit.routeDecision });
    console.log(`${item.id}: target ${item.targetOverall}, actual ${band}, absError ${absError}, flat=${flat}`);
  }
  const mae = rows.filter(r => Number.isFinite(r.absError)).reduce((s, r) => s + r.absError, 0) / rows.filter(r => Number.isFinite(r.absError)).length;
  const highError = rows.filter(r => Number.isFinite(r.absError) && r.absError > 0.5);
  const flatMid = rows.filter(r => r.flatCriteria && r.targetOverall >= 4 && r.targetOverall <= 7);
  const report = { endpoint, corpusVersion: corpus.version, generatedAt: new Date().toISOString(), mae, highErrorCount: highError.length, flatMidCount: flatMid.length, rows };
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const jsonPath = path.join(outDir, `full-range-3-to-7-live-report-${stamp}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  const csvPath = path.join(outDir, `full-range-3-to-7-live-report-${stamp}.csv`);
  const header = ['id','task','targetOverall','actualOverall','absError','flatCriteria','selectedSystem','routeDecision'];
  const csv = [header.join(','), ...rows.map(r => header.map(h => JSON.stringify(r[h] ?? '')).join(','))].join('\n');
  fs.writeFileSync(csvPath, csv);
  console.log(`\nMAE=${mae.toFixed(3)} highError=${highError.length} flatMid=${flatMid.length}`);
  console.log(`Wrote ${jsonPath}`);
  console.log(`Wrote ${csvPath}`);
  if (highError.length || flatMid.length > 4) process.exitCode = 1;
})();
