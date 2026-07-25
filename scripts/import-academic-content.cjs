"use strict";

const fs = require("node:fs");
const path = require("node:path");

const sourceRoot = path.resolve(process.argv[2] || "_academic_import");
const projectRoot = path.resolve(__dirname, "..");
const outputFile = path.join(projectRoot, "academic-data.js");
const assetDir = path.join(projectRoot, "assets", "academic");

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);
}

const VISUAL_TYPE_OVERRIDES = {
  "10-1": "饼图", "10-2": "表格", "10-3": "柱状图", "10-4": "流程图",
  "11-1": "饼图", "11-2": "饼图", "11-3": "曲线图", "11-4": "混合图",
  "12-5": "柱状图", "12-6": "地图", "12-7": "柱状图", "12-8": "流程图",
  "13-1": "地图", "13-2": "曲线图", "13-3": "柱状图", "13-4": "地图",
  "14-1": "饼图", "14-2": "混合图", "14-3": "流程图", "14-4": "地图",
  "15-1": "柱状图", "15-2": "曲线图", "15-3": "流程图", "15-4": "混合图",
  "16-1": "曲线图", "16-2": "流程图", "16-3": "地图", "16-4": "流程图",
  "17-1": "地图", "17-2": "混合图", "17-3": "柱状图", "17-4": "曲线图",
  "18-1": "曲线图", "18-2": "柱状图", "18-3": "地图", "18-4": "曲线图",
  "19-1": "曲线图", "19-2": "地图", "19-3": "流程图", "19-4": "混合图",
  "20-1": "表格", "20-2": "地图", "20-3": "混合图", "20-4": "流程图",
  "21-1": "曲线图", "21-2": "地图", "21-3": "流程图", "21-4": "混合图"
};

function visualType(task) {
  const overrideKey = `${task.book_no}-${String(task.test_name).replace(/\D/g, "")}`;
  if (VISUAL_TYPE_OVERRIDES[overrideKey]) return VISUAL_TYPE_OVERRIDES[overrideKey];
  if (task.category) return task.category;
  const text = `${task.content || ""} ${task.sample_answer || ""}`.toLowerCase();
  const has = (pattern) => pattern.test(text);
  if (has(/process|stages|how .* (is|are) (made|produced|manufactured|created)|life cycle/)) return "流程图";
  if (has(/maps?|plans? (show|illustrate)|layout|site of|floor plan|village|town centre|island/)) return "地图";
  const types = [has(/table/) && "table", has(/pie chart|pie graph/) && "pie", has(/bar chart|bar graph/) && "bar", has(/line graph|line chart/) && "line"].filter(Boolean);
  if (types.length > 1 || has(/chart and (?:the )?(?:graph|table)|charts? and tables?|combined/)) return "混合图";
  if (types[0] === "table") return "表格";
  if (types[0] === "pie") return "饼图";
  if (types[0] === "bar") return "柱状图";
  if (types[0] === "line") return "曲线图";
  if (has(/from \d{4} to \d{4}|between \d{4} and \d{4}|over a .*year period|changes? in .* over/)) return "曲线图";
  if (has(/percentages?|proportion|account(?:s|ed) for|share/)) return "饼图";
  return "图表";
}

function essayType(content) {
  const text = String(content || "").toLowerCase();
  const questionCount = (text.match(/\?/g) || []).length;
  if (/discuss both (?:these )?views/.test(text)) return ["讨论双方观点类", "discuss both views + opinion"];
  if (/advantages? .* disadvantages?|disadvantages? .* advantages?|outweigh/.test(text)) return ["利弊分析类", /outweigh/.test(text) ? "advantages outweigh disadvantages" : "advantages + disadvantages"];
  if (/positive or negative development|positive or negative/.test(text)) return ["观点判断类", "positive / negative development"];
  if (/causes?|reasons?/.test(text) && /solutions?|measures?|what can be done/.test(text)) return ["原因与解决类", "causes / reasons + solutions"];
  if (/problems?/.test(text) && /solutions?|measures?|what can be done/.test(text)) return ["问题与解决类", "problems + solutions"];
  if (/to what extent do you agree|do you agree or disagree/.test(text) && questionCount <= 1) return ["同意与否类", "agree / disagree"];
  if (questionCount >= 2) return ["双问题类", "two-part direct questions"];
  return ["观点讨论类", "opinion / discussion"];
}

function safeTitle(task, taskNumber, type) {
  const stem = String(task.content || "").split(/\n/).find(Boolean) || task.name;
  const short = stem.replace(/\s+/g, " ").slice(0, 82).replace(/[.,;:]?$/, "");
  return taskNumber === 1 ? `Academic Task 1 · ${type}` : short;
}

const files = walk(sourceRoot);
const dataFile = files.find((file) => path.basename(file) === "app-data.json");
if (!dataFile) throw new Error(`app-data.json not found under ${sourceRoot}`);
const source = JSON.parse(fs.readFileSync(dataFile, "utf8"));
fs.mkdirSync(assetDir, { recursive: true });

const prompts = source.tasks.map((task) => {
  const taskNumber = task.kind === "xiaozuowen" ? 1 : 2;
  const typeInfo = taskNumber === 1 ? [visualType(task), "select key features + overview + comparisons"] : essayType(task.content);
  const id = `academic-b${task.book_no}-t${task.test_name.replace(/\D/g, "")}-task${taskNumber}`;
  let image = "";
  if (taskNumber === 1) {
    const prefix = `${task.book_name} ${task.test_name} ${task.name}-1`;
    const sourceImage = files.find((file) => path.basename(file, path.extname(file)) === prefix && /\.png$/i.test(file));
    if (sourceImage) {
      const target = path.join(assetDir, `${id}.png`);
      fs.copyFileSync(sourceImage, target);
      image = `assets/academic/${id}.png`;
    }
  }
  return {
    id,
    book: `Cambridge IELTS ${task.book_no}`,
    test: task.test_name,
    module: "Academic",
    examModule: "academic",
    task: `Task ${taskNumber}`,
    taskNumber,
    taskKind: taskNumber === 1 ? "academic_visual_report" : "essay",
    type: typeInfo[0], bigType: typeInfo[0], purpose: typeInfo[1], subtype: typeInfo[1],
    title: safeTitle(task, taskNumber, typeInfo[0]),
    prompt: String(task.content || "").trim(),
    difficulty: "Official practice",
    timeLimit: taskNumber === 1 ? 20 : 40,
    recommendedWords: taskNumber === 1 ? 150 : 250,
    sourceStatus: "user-provided study material",
    image,
    imageAlt: `${task.book_name} ${task.test_name} Academic Task 1 visual`,
    referenceAnswer: String(task.sample_answer || "").trim(),
    visualFacts: taskNumber === 1 ? {
      visualType: typeInfo[0],
      referenceDescription: String(task.sample_answer || "").trim(),
      sourceVerified: false,
      verificationNote: "Imported reference description is useful context but has not been manually verified against every data point in the image."
    } : null,
    usefulPhrases: [],
    sampleStructure: taskNumber === 1
      ? ["Introduction: paraphrase the task", "Overview: report the main patterns", "Details 1: group and compare key features", "Details 2: report remaining key features accurately"]
      : ["Introduction: paraphrase and answer directly", "Body 1: main idea, explanation and example", "Body 2: second developed idea", "Conclusion: restate the position"],
    notes: {
      focus: taskNumber === 1 ? `Identify ${typeInfo[0]} key features, write a clear overview and make relevant comparisons.` : `Answer pattern: ${typeInfo[1]}.`,
      band5: taskNumber === 1 ? "Include an overview and report the most obvious features without inventing data." : "Answer every part and support two clear main ideas.",
      band6: taskNumber === 1 ? "Group key features logically, compare accurately and control units and time references." : "Maintain a clear position and extend each main idea with relevant support."
    },
    classification: { task: `Task ${taskNumber}`, bigType: typeInfo[0], subtype: typeInfo[1], reviewedAt: new Date().toISOString().slice(0, 10), basis: "question wording + imported study metadata" }
  };
});

const payload = {
  meta: {
    projectName: "IELTS Academic Writing Library",
    books: [...new Set(prompts.map((item) => item.book))],
    importedAt: new Date().toISOString(),
    source: process.env.ACADEMIC_SOURCE_LABEL || "A类写作小作文大作文.zip",
    promptCount: prompts.length,
    task1Count: prompts.filter((item) => item.taskNumber === 1).length,
    task2Count: prompts.filter((item) => item.taskNumber === 2).length
  },
  prompts
};
fs.writeFileSync(outputFile, `// Generated by scripts/import-academic-content.cjs from user-provided study material.\nwindow.IELTS_ACADEMIC_DATA = ${JSON.stringify(payload, null, 2)};\n`, "utf8");
console.log(JSON.stringify({ outputFile, assetDir, ...payload.meta }, null, 2));
