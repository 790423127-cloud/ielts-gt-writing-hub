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
const LOG_FILE = path.join(RESULT_DIR, `boundary-corpus-v2-3-adjudicator-v3-run-log-${RUN_STAMP}.txt`);
const CORPUS_FILE = path.join(ROOT, 'boundary_4_0_5_5_corpus_v2_3_relabel_cleaned_20.json');
const ENDPOINT = fs.readFileSync(path.join(ROOT, 'endpoint-boundary-adjudicator.txt'), 'utf8').trim();
const DELAY_MS = Math.max(0, Math.min(Number(process.env.BOUNDARY_ADJUDICATOR_DELAY_MS || 900), 5000));

function logLine(msg) { console.log(msg); try { fs.appendFileSync(LOG_FILE, String(msg) + '\n', 'utf8'); } catch {} }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
process.on('uncaughtException', e => { logLine('FATAL uncaughtException: ' + (e && e.stack || e)); process.exit(1); });
process.on('unhandledRejection', e => { logLine('FATAL unhandledRejection: ' + (e && e.stack || e)); process.exit(1); });

function postJsonHttp(urlString, bodyObject, timeoutMs = 240000) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const data = JSON.stringify(bodyObject);
    const lib = url.protocol === 'http:' ? http : https;
    const req = lib.request({
      protocol:url.protocol, hostname:url.hostname, port:url.port || (url.protocol==='http:'?80:443),
      path:url.pathname + url.search, method:'POST',
      headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(data),'User-Agent':'ielts-boundary-v2-3-blind-adjudicator-v3-runner'},
      timeout:timeoutMs
    }, res => {
      let text=''; res.setEncoding('utf8'); res.on('data', c=>text+=c);
      res.on('end', () => { let data; try { data=JSON.parse(text); } catch { data={ok:false,raw:text}; } resolve({status:res.statusCode, ok:res.statusCode>=200&&res.statusCode<300, data, text}); });
    });
    req.on('timeout',()=>req.destroy(new Error('Request timeout')));
    req.on('error', reject); req.write(data); req.end();
  });
}
async function postJson(url, body) {
  if (typeof fetch !== 'function') return postJsonHttp(url, body);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 240000);
  try {
    const res = await fetch(url, {method:'POST', headers:{'Content-Type':'application/json','User-Agent':'ielts-boundary-v2-3-blind-adjudicator-v3-runner'}, body:JSON.stringify(body), signal:controller.signal});
    const text = await res.text(); let data; try { data=JSON.parse(text); } catch { data={ok:false,raw:text}; }
    return {status:res.status, ok:res.ok, data, text};
  } finally { clearTimeout(timer); }
}
async function callAdjudicator(sample) {
  // BLIND PAYLOAD: target labels, rubric, bandCode, bandGroup, systemScope and title are NOT sent to API.
  const body = {
    mode:'score',
    task:sample.task,
    taskType:sample.task==='Task 1'?'task1':'task2',
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
      const response = await postJson(ENDPOINT, body);
      if (!response.ok || response.data?.ok === false) throw new Error(`HTTP/API ${response.status}: ${response.data?.error || response.data?.message || response.text?.slice(0,300)}`);
      return response.data;
    } catch (e) {
      lastError = e;
      if (attempt < 3) { logLine(`    attempt ${attempt} failed, retrying: ${String(e.message||e).slice(0,250)}`); await sleep(3000); }
    }
  }
  throw lastError;
}
function rowFrom(sample, data, elapsedMs) {
  const finalBand = bandNum(data.finalBand ?? data.overallBand ?? data.band);
  const mainScore = bandNum(data.mainScore), lowbandScore = bandNum(data.lowbandScore);
  const min=Number(sample.expectedMin), max=Number(sample.expectedMax), target=Number(sample.targetBand);
  const mainCriteria = data.main?.criteria || data.main?.finalCriteria || {};
  const lowCriteria = data.lowband?.criteria || data.lowband?.finalCriteria || {};
  const finalCriteria = data.finalCriteria || {};
  let row = {
    id:sample.id, title:sample.title, task:sample.task, taskCode:sample.taskCode, bandCode:sample.bandCode, bandGroup:sample.bandGroup, systemScope:sample.systemScope, labelRisk:sample.rubricReference?.labelRisk || '',
    targetBand:target, expectedMin:min, expectedMax:max, wordCount:wordCount(sample.sample),
    finalBand, finalInRange:within(finalBand,min,max), finalMinusTarget:Number.isFinite(finalBand)?roundHalf(finalBand-target):'',
    finalSource:data.finalSource||'', confidence:data.confidence||'', routeDecision:data.route?.decision||'', routeZone:data.route?.zone||'', conflict:!!data.route?.conflict,
    adjudicated:data.finalSource === 'boundary-adjudicator-v3' || !!data.adjudicator, adjudicatorClassification:data.adjudicator?.classification||'',
    mainScore:Number.isFinite(mainScore)?mainScore:'', lowbandScore:Number.isFinite(lowbandScore)?lowbandScore:'', scoreGap:Number.isFinite(mainScore)&&Number.isFinite(lowbandScore)?roundHalf(Math.abs(mainScore-lowbandScore)):'',
    mainVersion:data.main?.version||'', lowbandVersion:data.lowband?.version||'', adjudicatorVersion:data.scoreSystemVersion||'',
    prompt:sample.prompt, sampleText:sample.sample,
    rubricOverallDescriptor:sample.rubricReference?.overallDescriptor || '',
    whyThisIsNotHigher:sample.rubricReference?.whyThisIsNotHigher || '',
    whyThisIsNotLower:sample.rubricReference?.whyThisIsNotLower || '',
    expectedCriteriaJson:JSON.stringify(sample.expectedCriteriaBreakdown||{}),
    finalCriteriaJson:JSON.stringify(finalCriteria), mainCriteriaJson:JSON.stringify(mainCriteria), lowbandCriteriaJson:JSON.stringify(lowCriteria), 
    routeJson:JSON.stringify(data.route||{}), adjudicatorJson:JSON.stringify(data.adjudicator||{}),
    elapsedMs, error:''
  };
  row = addCriterionColumns(row, 'expected', sample.task, sample.expectedCriteriaBreakdown || {});
  row = addCriterionColumns(row, 'main', sample.task, mainCriteria);
  row = addCriterionColumns(row, 'lowband', sample.task, lowCriteria);
  row = addCriterionColumns(row, 'final', sample.task, finalCriteria);
  return row;
}
function summarize(rows) {
  const byTarget = {};
  for (const r of rows) {
    const k=String(r.targetBand); byTarget[k] ||= {targetBand:r.targetBand,total:0,finalInRange:0,adjudicated:0,conflicts:0,avgFinal:[],avgMain:[],avgLowband:[],avgGap:[]};
    const g=byTarget[k]; g.total++; if(r.finalInRange)g.finalInRange++; if(r.adjudicated)g.adjudicated++; if(r.conflict)g.conflicts++;
    if(Number.isFinite(Number(r.finalBand)))g.avgFinal.push(Number(r.finalBand)); if(Number.isFinite(Number(r.mainScore)))g.avgMain.push(Number(r.mainScore)); if(Number.isFinite(Number(r.lowbandScore)))g.avgLowband.push(Number(r.lowbandScore)); if(Number.isFinite(Number(r.scoreGap)))g.avgGap.push(Number(r.scoreGap));
  }
  const avg=a=>a.length?Number((a.reduce((x,y)=>x+y,0)/a.length).toFixed(2)):null;
  return {total:rows.length, finalInRange:rows.filter(r=>r.finalInRange).length, finalPassRate:rows.length?Number((rows.filter(r=>r.finalInRange).length/rows.length*100).toFixed(1)):0, adjudicated:rows.filter(r=>r.adjudicated).length, conflicts:rows.filter(r=>r.conflict).length, targetSummaries:Object.values(byTarget).map(g=>({targetBand:g.targetBand,total:g.total,finalInRange:g.finalInRange,adjudicated:g.adjudicated,conflicts:g.conflicts,avgFinal:avg(g.avgFinal),avgMain:avg(g.avgMain),avgLowband:avg(g.avgLowband),avgGap:avg(g.avgGap)}))};
}
async function main() {
  const samples = JSON.parse(fs.readFileSync(CORPUS_FILE,'utf8'));
  logLine('IELTS Boundary Corpus v2.3 Blind Rubric + Boundary Adjudicator v3 Test');
  logLine('Endpoint: ' + ENDPOINT);
  logLine('Samples: ' + samples.length);
  logLine('Blind payload: target labels, rubric, bandCode, bandGroup, systemScope and title are local-only and not sent to API.');
  const rows = [];
  for (let i=0;i<samples.length;i++) {
    const s=samples[i];
    process.stdout.write(`[${i+1}/${samples.length}] ${s.id} | ${s.title} | ${s.taskCode} | ${s.bandCode} | wc=${wordCount(s.sample)} | labelRisk=${s.rubricReference?.labelRisk || ''} ... `);
    try { fs.appendFileSync(LOG_FILE, `[${i+1}/${samples.length}] ${s.id} | ${s.title} | ${s.taskCode} | ${s.bandCode} | wc=${wordCount(s.sample)} | labelRisk=${s.rubricReference?.labelRisk || ''} ... `, 'utf8'); } catch {}
    const start=Date.now();
    try {
      const data=await callAdjudicator(s);
      const row=rowFrom(s,data,Date.now()-start); rows.push(row);
      logLine(`${row.finalInRange?'PASS':'FAIL'} final=${row.finalBand} main=${row.mainScore} low=${row.lowbandScore} source=${row.finalSource} version=${row.adjudicatorVersion} finalCriteria=${row.finalCriteriaJson}`);
    } catch (e) {
      rows.push({id:s.id,title:s.title,task:s.task,taskCode:s.taskCode,bandCode:s.bandCode,bandGroup:s.bandGroup,systemScope:s.systemScope,labelRisk:s.rubricReference?.labelRisk||'',targetBand:Number(s.targetBand),expectedMin:Number(s.expectedMin),expectedMax:Number(s.expectedMax),wordCount:wordCount(s.sample),finalBand:'',finalInRange:false,finalMinusTarget:'',finalSource:'',confidence:'',routeDecision:'',routeZone:'',conflict:true,adjudicated:false,adjudicatorClassification:'',mainScore:'',lowbandScore:'',scoreGap:'',mainVersion:'',lowbandVersion:'',adjudicatorVersion:'',elapsedMs:Date.now()-start,error:String(e.message||e),prompt:s.prompt,sampleText:s.sample});
      logLine(`ERROR ${String(e.message||e).slice(0,300)}`);
    }
    if(DELAY_MS) await sleep(DELAY_MS);
  }
  const report={mode:'boundary-corpus-v2-3-blind-rubric-adjudicator-v3',endpoint:ENDPOINT,generatedAt:new Date().toISOString(),summary:summarize(rows),rows};
  const jsonPath=path.join(RESULT_DIR,`boundary-corpus-v2-3-adjudicator-v3-report-${RUN_STAMP}.json`);
  const csvPath=path.join(RESULT_DIR,`boundary-corpus-v2-3-adjudicator-v3-report-${RUN_STAMP}.csv`);
  const summaryPath=path.join(RESULT_DIR,`boundary-corpus-v2-3-adjudicator-v3-summary-${RUN_STAMP}.csv`);
  fs.writeFileSync(jsonPath,JSON.stringify(report,null,2),'utf8');
  const headers=[
    'id','title','task','taskCode','bandCode','bandGroup','systemScope','labelRisk','targetBand','expectedMin','expectedMax','wordCount',
    'expected_TA','expected_TR','expected_CC','expected_LR','expected_GRA',
    'finalBand','final_TA','final_TR','final_CC','final_LR','final_GRA',
    'mainScore','main_TA','main_TR','main_CC','main_LR','main_GRA',
    'lowbandScore','lowband_TA','lowband_TR','lowband_CC','lowband_LR','lowband_GRA',
    'scoreGap','finalInRange','finalMinusTarget','finalSource','confidence','routeDecision','routeZone','conflict','adjudicated','adjudicatorClassification',
    'mainVersion','lowbandVersion','adjudicatorVersion','elapsedMs','error',
    'rubricOverallDescriptor','whyThisIsNotHigher','whyThisIsNotLower',
    'expectedCriteriaJson','finalCriteriaJson','mainCriteriaJson','lowbandCriteriaJson','routeJson','adjudicatorJson','prompt','sampleText'
  ];
  fs.writeFileSync(csvPath,[headers,...rows.map(r=>headers.map(h=>r[h]))].map(a=>a.map(csvEscape).join(',')).join('\n'),'utf8');
  const sh=['targetBand','total','finalInRange','adjudicated','conflicts','avgFinal','avgMain','avgLowband','avgGap'];
  fs.writeFileSync(summaryPath,[sh,...report.summary.targetSummaries.map(r=>sh.map(h=>r[h]))].map(a=>a.map(csvEscape).join(',')).join('\n'),'utf8');
  logLine('\n=== Summary ===');
  logLine(`finalInRange: ${report.summary.finalInRange}/${report.summary.total} (${report.summary.finalPassRate}%)`);
  logLine(`adjudicated: ${report.summary.adjudicated}`);
  logLine(`conflicts: ${report.summary.conflicts}`);
  for(const t of report.summary.targetSummaries) logLine(`target ${t.targetBand}: final ${t.finalInRange}/${t.total}, avgFinal ${t.avgFinal}, avgMain ${t.avgMain}, avgLow ${t.avgLowband}`);
  logLine('JSON: ' + jsonPath);
  logLine('CSV: ' + csvPath);
  logLine('Summary CSV: ' + summaryPath);
  logLine('Log: ' + LOG_FILE);
}
main();
