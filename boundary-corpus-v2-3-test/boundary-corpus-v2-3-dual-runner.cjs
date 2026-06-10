'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');


function criterionKeys(task) {
  return task === 'Task 1'
    ? ['Task Achievement','Coherence and Cohesion','Lexical Resource','Grammatical Range and Accuracy']
    : ['Task Response','Coherence and Cohesion','Lexical Resource','Grammatical Range and Accuracy'];
}
function getCriterion(criteria, key) {
  if (!criteria || typeof criteria !== 'object') return '';
  const aliases = {
    'Task Achievement':['Task Achievement','TA','taskAchievement'],
    'Task Response':['Task Response','TR','taskResponse'],
    'Coherence and Cohesion':['Coherence and Cohesion','CC','coherenceCohesion'],
    'Lexical Resource':['Lexical Resource','LR','lexicalResource'],
    'Grammatical Range and Accuracy':['Grammatical Range and Accuracy','GRA','grammarRangeAccuracy','grammaticalRangeAndAccuracy']
  };
  for (const k of aliases[key] || [key]) {
    if (criteria[k] !== undefined && criteria[k] !== null && criteria[k] !== '') return criteria[k];
  }
  return '';
}
function addCriterionColumns(row, prefix, task, criteria) {
  const keys = criterionKeys(task);
  const labels = task === 'Task 1'
    ? ['TA','CC','LR','GRA']
    : ['TR','CC','LR','GRA'];
  for (let i=0; i<keys.length; i++) row[`${prefix}_${labels[i]}`] = getCriterion(criteria, keys[i]);
  return row;
}
function csvEscape(value) {
  const s = String(value ?? '');
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function wordCount(text) {
  return (String(text || '').trim().match(/[A-Za-z0-9]+(?:['’\-][A-Za-z0-9]+)*/g) || []).length;
}
function bandNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : NaN;
}
function roundHalf(x) {
  const n = Number(x);
  return Number.isFinite(n) ? Math.round(n * 2) / 2 : NaN;
}
function within(score, min, max) {
  return Number.isFinite(score) && score >= min && score <= max;
}


const ROOT = __dirname;
const RESULT_DIR = path.join(ROOT, 'boundary-v2-3-results');
fs.mkdirSync(RESULT_DIR, { recursive: true });
const RUN_STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const LOG_FILE = path.join(RESULT_DIR, `boundary-corpus-v2-3-dual-run-log-${RUN_STAMP}.txt`);

const CORPUS_FILE = path.join(ROOT, 'boundary_4_0_5_5_corpus_v2_3_relabel_cleaned_20.json');
const MAIN_ENDPOINT = fs.readFileSync(path.join(ROOT, 'endpoint-main.txt'), 'utf8').trim();
const LOWBAND_ENDPOINT = fs.readFileSync(path.join(ROOT, 'endpoint-lowband.txt'), 'utf8').trim();
const DELAY_MS = Math.max(0, Math.min(Number(process.env.BOUNDARY_DELAY_MS || 700), 5000));

function logLine(msg) { console.log(msg); try { fs.appendFileSync(LOG_FILE, String(msg) + '\n', 'utf8'); } catch {} }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
process.on('uncaughtException', e => { logLine('FATAL uncaughtException: ' + (e && e.stack || e)); process.exit(1); });
process.on('unhandledRejection', e => { logLine('FATAL unhandledRejection: ' + (e && e.stack || e)); process.exit(1); });

function postJsonHttp(urlString, bodyObject, timeoutMs = 180000) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const data = JSON.stringify(bodyObject);
    const lib = url.protocol === 'http:' ? http : https;
    const req = lib.request({
      protocol: url.protocol, hostname: url.hostname, port: url.port || (url.protocol === 'http:' ? 80 : 443),
      path: url.pathname + url.search, method: 'POST',
      headers: {'Content-Type':'application/json','Content-Length':Buffer.byteLength(data),'User-Agent':'ielts-boundary-v2-3-blind-dual-runner'},
      timeout: timeoutMs
    }, res => {
      let text = ''; res.setEncoding('utf8'); res.on('data', c => text += c);
      res.on('end', () => { let data; try { data = JSON.parse(text); } catch { data = { ok:false, raw:text }; } resolve({status:res.statusCode, ok:res.statusCode>=200&&res.statusCode<300, data, text}); });
    });
    req.on('timeout', () => req.destroy(new Error('Request timeout')));
    req.on('error', reject); req.write(data); req.end();
  });
}
async function postJson(url, body) {
  if (typeof fetch !== 'function') return postJsonHttp(url, body);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 180000);
  try {
    const res = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json','User-Agent':'ielts-boundary-v2-3-blind-dual-runner'}, body:JSON.stringify(body), signal:controller.signal });
    const text = await res.text(); let data; try { data = JSON.parse(text); } catch { data = { ok:false, raw:text }; }
    return { status:res.status, ok:res.ok, data, text };
  } finally { clearTimeout(timer); }
}
function normalizeScoreResponse(data) {
  if (data && typeof data === 'object') {
    if (data.result && typeof data.result === 'object') return data.result;
    if (data.data && typeof data.data === 'object') return data.data;
    if (data.score && typeof data.score === 'object') return data.score;
  }
  return data;
}
function extractScore(data) {
  const d = normalizeScoreResponse(data);
  const score = bandNum(d?.overallBand ?? d?.scoreCalculation?.finalBand ?? d?.finalBand ?? d?.band ?? d?.overall);
  return { raw:d||{}, ok:d?.ok!==false && Number.isFinite(score), score, version:d?.scoreSystemVersion||d?.version||'', task:d?.task||d?.scoringTask||'', criteria:d?.finalCriteria||d?.criteria||d?.scoreCalculation?.criteria||{}, decision:d?.routingDecision||d?.decision||d?.lowBandDecision||'' };
}
async function callEndpoint(endpoint, sample, name) {
  // BLIND PAYLOAD: target band, expected criteria, bandCode, bandGroup, systemScope, title and rubric are NOT sent to API.
  const body = {
    mode:'score',
    aiStage:'score-core',
    task:sample.task,
    taskType:sample.task === 'Task 1' ? 'task1' : 'task2',
    scoringTask:sample.task,
    selectedTask:sample.task,
    questionPrompt:sample.prompt,
    promptText:sample.prompt,
    essay:sample.sample,
    answer:sample.sample,
    wordCount:wordCount(sample.sample),
    corpusVersion:'boundary-v2-3-blind-rubric'
  };
  let lastError;
  for (let attempt=1; attempt<=3; attempt++) {
    try {
      const response = await postJson(endpoint, body);
      const score = extractScore(response.data);
      if (!response.ok || !score.ok) throw new Error(`${name} HTTP/API ${response.status}: ${response.data?.error || response.data?.message || response.text?.slice(0,300)}`);
      return score;
    } catch (e) {
      lastError = e;
      if (attempt < 3) { logLine(`    ${name} attempt ${attempt} failed, retrying: ${String(e.message||e).slice(0,250)}`); await sleep(2500); }
    }
  }
  return { ok:false, score:NaN, version:'', task:'', criteria:{}, decision:'', error:String(lastError?.message||lastError) };
}
function decideRoute(mainScore, lowScore) {
  const gap = Number.isFinite(mainScore) && Number.isFinite(lowScore) ? Math.abs(mainScore-lowScore) : NaN;
  if (mainScore <= 4.0) return lowScore <= 4.5 ? 'lowband_confirms_low_score' : 'lowband_conflict_manual_review';
  if (mainScore === 4.5) return gap <= 0.5 ? 'use_main_lowband_consistent' : 'boundary_gap_review';
  if (mainScore === 5.0) return lowScore >= 4.5 && gap <= 0.5 ? 'use_main' : 'boundary_lowband_warning_review';
  if (mainScore >= 5.5) return (lowScore <= 4.0 || gap >= 1.5) ? 'main_high_lowband_conflict_review' : 'use_main';
  return gap >= 1.0 ? 'gap_review' : 'use_main';
}
function rowFrom(sample, main, low) {
  const target = Number(sample.targetBand), min=Number(sample.expectedMin), max=Number(sample.expectedMax);
  const gap = Number.isFinite(main.score) && Number.isFinite(low.score) ? roundHalf(Math.abs(main.score-low.score)) : '';
  let row = {
    id:sample.id, title:sample.title, task:sample.task, taskCode:sample.taskCode, bandCode:sample.bandCode, bandGroup:sample.bandGroup, systemScope:sample.systemScope, labelRisk:sample.rubricReference?.labelRisk || '',
    targetBand:target, expectedMin:min, expectedMax:max, wordCount:wordCount(sample.sample),
    mainScore:Number.isFinite(main.score)?main.score:'', lowbandScore:Number.isFinite(low.score)?low.score:'', scoreGap:gap,
    mainInRange:within(main.score,min,max), lowbandInRange:within(low.score,min,max), bothInRange:within(main.score,min,max)&&within(low.score,min,max),
    routingDecision:decideRoute(main.score, low.score), conflict:Number(gap)>=1.0 || false,
    mainVersion:main.version||'', lowbandVersion:low.version||'', mainError:main.error||'', lowbandError:low.error||'',
    prompt:sample.prompt, sampleText:sample.sample,
    rubricOverallDescriptor:sample.rubricReference?.overallDescriptor || '',
    whyThisIsNotHigher:sample.rubricReference?.whyThisIsNotHigher || '',
    whyThisIsNotLower:sample.rubricReference?.whyThisIsNotLower || '',
    expectedCriteriaJson:JSON.stringify(sample.expectedCriteriaBreakdown||{}),
    mainCriteriaJson:JSON.stringify(main.criteria||{}), lowbandCriteriaJson:JSON.stringify(low.criteria||{})
  };
  row = addCriterionColumns(row, 'expected', sample.task, sample.expectedCriteriaBreakdown || {});
  row = addCriterionColumns(row, 'main', sample.task, main.criteria || {});
  row = addCriterionColumns(row, 'lowband', sample.task, low.criteria || {});
  return row;
}
function summarize(rows) {
  const total = rows.length;
  const byTarget = {};
  for (const r of rows) {
    const k=String(r.targetBand); byTarget[k] ||= {targetBand:r.targetBand,total:0,mainInRange:0,lowbandInRange:0,bothInRange:0,conflicts:0,avgMain:[],avgLowband:[],avgGap:[]};
    const g=byTarget[k]; g.total++; if(r.mainInRange)g.mainInRange++; if(r.lowbandInRange)g.lowbandInRange++; if(r.bothInRange)g.bothInRange++; if(r.conflict)g.conflicts++;
    if(r.mainScore!=='')g.avgMain.push(Number(r.mainScore)); if(r.lowbandScore!=='')g.avgLowband.push(Number(r.lowbandScore)); if(r.scoreGap!=='')g.avgGap.push(Number(r.scoreGap));
  }
  const avg = a => a.length ? Number((a.reduce((x,y)=>x+y,0)/a.length).toFixed(2)) : null;
  return {
    total, mainInRange:rows.filter(r=>r.mainInRange).length, lowbandInRange:rows.filter(r=>r.lowbandInRange).length, bothInRange:rows.filter(r=>r.bothInRange).length, conflicts:rows.filter(r=>r.conflict).length,
    targetSummaries:Object.values(byTarget).map(g=>({targetBand:g.targetBand,total:g.total,mainInRange:g.mainInRange,lowbandInRange:g.lowbandInRange,bothInRange:g.bothInRange,conflicts:g.conflicts,avgMain:avg(g.avgMain),avgLowband:avg(g.avgLowband),avgGap:avg(g.avgGap)}))
  };
}
async function main() {
  const samples = JSON.parse(fs.readFileSync(CORPUS_FILE,'utf8'));
  logLine('IELTS Boundary Corpus v2.3 Blind Rubric Dual-System Test');
  logLine('Main endpoint: ' + MAIN_ENDPOINT);
  logLine('Lowband endpoint: ' + LOWBAND_ENDPOINT);
  logLine('Samples: ' + samples.length);
  logLine('Blind payload: target labels, rubric, bandCode, bandGroup, systemScope and title are local-only and not sent to API.');
  const rows = [];
  for (let i=0; i<samples.length; i++) {
    const s=samples[i]; logLine(`\n[${i+1}/${samples.length}] ${s.id} | ${s.title} | ${s.taskCode} | ${s.bandCode} | wc=${wordCount(s.sample)} | labelRisk=${s.rubricReference?.labelRisk || ''}`);
    const main = await callEndpoint(MAIN_ENDPOINT, s, 'main'); logLine(`  main=${main.score} ${main.version} criteria=${JSON.stringify(main.criteria||{})}`);
    await sleep(DELAY_MS);
    const low = await callEndpoint(LOWBAND_ENDPOINT, s, 'lowband'); logLine(`  lowband=${low.score} ${low.version} criteria=${JSON.stringify(low.criteria||{})}`);
    const row = rowFrom(s, main, low); rows.push(row); logLine(`  gap=${row.scoreGap} route=${row.routingDecision} mainRange=${row.mainInRange} lowRange=${row.lowbandInRange}`);
    await sleep(DELAY_MS);
  }
  const report = { mode:'boundary-corpus-v2-3-blind-rubric-dual-system', generatedAt:new Date().toISOString(), endpointMain:MAIN_ENDPOINT, endpointLowband:LOWBAND_ENDPOINT, summary:summarize(rows), rows };
  const jsonPath = path.join(RESULT_DIR, `boundary-corpus-v2-3-dual-report-${RUN_STAMP}.json`);
  const csvPath = path.join(RESULT_DIR, `boundary-corpus-v2-3-dual-report-${RUN_STAMP}.csv`);
  const summaryPath = path.join(RESULT_DIR, `boundary-corpus-v2-3-dual-summary-${RUN_STAMP}.csv`);
  fs.writeFileSync(jsonPath, JSON.stringify(report,null,2), 'utf8');
  const headers = [
    'id','title','task','taskCode','bandCode','bandGroup','systemScope','labelRisk','targetBand','expectedMin','expectedMax','wordCount',
    'expected_TA','expected_TR','expected_CC','expected_LR','expected_GRA',
    'mainScore','main_TA','main_TR','main_CC','main_LR','main_GRA',
    'lowbandScore','lowband_TA','lowband_TR','lowband_CC','lowband_LR','lowband_GRA',
    'scoreGap','mainInRange','lowbandInRange','bothInRange','routingDecision','conflict','mainVersion','lowbandVersion','mainError','lowbandError',
    'rubricOverallDescriptor','whyThisIsNotHigher','whyThisIsNotLower',
    'expectedCriteriaJson','mainCriteriaJson','lowbandCriteriaJson','prompt','sampleText'
  ];
  fs.writeFileSync(csvPath, [headers, ...rows.map(r=>headers.map(h=>r[h]))].map(a=>a.map(csvEscape).join(',')).join('\n'), 'utf8');
  const sh = ['targetBand','total','mainInRange','lowbandInRange','bothInRange','conflicts','avgMain','avgLowband','avgGap'];
  fs.writeFileSync(summaryPath, [sh, ...report.summary.targetSummaries.map(r=>sh.map(h=>r[h]))].map(a=>a.map(csvEscape).join(',')).join('\n'), 'utf8');
  logLine('\n=== Summary ===');
  logLine(`mainInRange: ${report.summary.mainInRange}/${report.summary.total}`);
  logLine(`lowbandInRange: ${report.summary.lowbandInRange}/${report.summary.total}`);
  logLine(`bothInRange: ${report.summary.bothInRange}/${report.summary.total}`);
  logLine(`conflicts: ${report.summary.conflicts}`);
  for (const t of report.summary.targetSummaries) logLine(`target ${t.targetBand}: main ${t.mainInRange}/${t.total}, low ${t.lowbandInRange}/${t.total}, both ${t.bothInRange}/${t.total}, avgMain ${t.avgMain}, avgLow ${t.avgLowband}`);
  logLine('JSON: ' + jsonPath);
  logLine('CSV: ' + csvPath);
  logLine('Summary CSV: ' + summaryPath);
  logLine('Log: ' + LOG_FILE);
}
main();
