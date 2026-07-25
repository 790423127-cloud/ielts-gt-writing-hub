"use strict";

const RUBRIC_VERSION = "ielts-writing-rubric-2026-07-v5-compact-score-then-feedback";

class RequestValidationError extends Error {
  constructor(message, code = "INVALID_REQUEST") {
    super(message);
    this.name = "RequestValidationError";
    this.code = code;
    this.statusCode = 400;
  }
}

const SHARED_CRITERIA = [
  "Coherence and Cohesion",
  "Lexical Resource",
  "Grammatical Range and Accuracy"
];

const TASK_REGISTRY = Object.freeze({
  "general_training:1": {
    examModule: "general_training",
    moduleLabel: "General Training",
    taskNumber: 1,
    task: "Task 1",
    taskKind: "gt_letter",
    minimumWords: 150,
    suggestedMinutes: 20,
    firstCriterion: "Task Achievement",
    criteria: ["Task Achievement", ...SHARED_CRITERIA],
    taskInstruction: [
      "Read the letter as communication to a specific person, not as a three-bullet checklist.",
      "For Task Achievement, judge whether the purpose is clear, every bullet is covered with useful detail, and the reader would know what to do or understand after reading.",
      "Treat tone and register as a relationship maintained across the whole letter. A greeting or closing alone cannot make an unsuitable body formal or informal.",
      "A brief but fully functional detail can be enough; do not reward padding or memorised letter phrases that do no communicative work.",
      "Do not score isolated grammar or vocabulary errors under Task Achievement unless they change the meaning or damage the communicative purpose."
    ]
  },
  "academic:1": {
    examModule: "academic",
    moduleLabel: "Academic",
    taskNumber: 1,
    task: "Task 1",
    taskKind: "academic_visual_report",
    minimumWords: 150,
    suggestedMinutes: 20,
    firstCriterion: "Task Achievement",
    criteria: ["Task Achievement", ...SHARED_CRITERIA],
    taskInstruction: [
      "Read the response as a selective visual summary, not as a list of every data point.",
      "For Task Achievement, judge the clarity and accuracy of the overview, the choice of major features, and the usefulness of comparisons or stage grouping.",
      "Verify numbers, units, dates, directions and relative magnitudes only against the supplied fact layer. Never infer unseen visual details.",
      "For processes, judge the sequence and grouping of major stages. For maps, judge the main additions, removals, relocations and unchanged features.",
      "Do not automatically cap a response because the overview is not in a separate paragraph; judge whether a real overview is present and clear.",
      "If the fact layer is absent or not source-verified, flag factual accuracy for human review without inventing a factual penalty."
    ]
  },
  "general_training:2": {
    examModule: "general_training",
    moduleLabel: "General Training",
    taskNumber: 2,
    task: "Task 2",
    taskKind: "essay",
    minimumWords: 250,
    suggestedMinutes: 40,
    firstCriterion: "Task Response",
    criteria: ["Task Response", ...SHARED_CRITERIA],
    taskInstruction: [
      "For Task Response, identify the exact question parts and judge how directly and sufficiently the essay answers each one.",
      "Follow the writer's position across the whole essay. Reward a nuanced or qualified position when it remains clear; do not require a simplistic one-sentence opinion.",
      "Judge development by the explanatory chain from claim to reason, consequence or example, not by paragraph length.",
      "Personal experience is valid when it genuinely supports the argument. Specialist knowledge is not required.",
      "Do not reward generic memorised paragraphs that could be pasted under a different question."
    ]
  },
  "academic:2": {
    examModule: "academic",
    moduleLabel: "Academic",
    taskNumber: 2,
    task: "Task 2",
    taskKind: "essay",
    minimumWords: 250,
    suggestedMinutes: 40,
    firstCriterion: "Task Response",
    criteria: ["Task Response", ...SHARED_CRITERIA],
    taskInstruction: [
      "For Task Response, identify the exact question parts and judge how directly and sufficiently the essay answers each one.",
      "Follow the writer's position across the whole essay. Reward a nuanced or qualified position when it remains clear; do not require a simplistic one-sentence opinion.",
      "Judge development by the explanatory chain from claim to reason, consequence or example, not by paragraph length.",
      "Expect an academic or semi-formal essay style, but do not require specialist subject knowledge or native-speaker cultural assumptions.",
      "Do not reward generic memorised paragraphs that could be pasted under a different question."
    ]
  }
});

function normalizeExamModule(value, body = {}) {
  const raw = String(value || body.module || body.testModule || "").trim().toLowerCase();
  const compact = raw.replace(/[\s_-]+/g, "");
  const taskKind = String(body.taskKind || "").toLowerCase();
  if (taskKind === "academic_visual_report") return "academic";
  if (taskKind === "gt_letter") return "general_training";
  if (["a", "ac", "academic", "atype", "aclass", "a类", "学术", "学术类"].includes(compact)) return "academic";
  if (["g", "gt", "general", "generaltraining", "gtype", "gclass", "g类", "培训", "培训类"].includes(compact)) return "general_training";
  if (/academic|学术|a类/.test(raw)) return "academic";
  if (/general|training|培训|g类/.test(raw)) return "general_training";
  return "general_training";
}

function normalizeTaskNumber(value, body = {}) {
  const raw = String(value || body.task || body.scoringTask || body.selectedTask || body.taskType || "").toLowerCase();
  if (Number(value) === 1 || /task\s*1|task1|letter|visual|report|小作文/.test(raw)) return 1;
  if (Number(value) === 2 || /task\s*2|task2|essay|大作文/.test(raw)) return 2;
  throw new RequestValidationError("taskNumber must identify Task 1 or Task 2.", "INVALID_TASK");
}

function resolveTaskConfig(body = {}) {
  const examModule = normalizeExamModule(body.examModule, body);
  const taskNumber = normalizeTaskNumber(body.taskNumber, body);
  const config = TASK_REGISTRY[`${examModule}:${taskNumber}`];
  if (!config) throw new RequestValidationError("Unsupported IELTS writing task.", "UNSUPPORTED_TASK");
  if (body.taskKind && String(body.taskKind) !== config.taskKind) {
    throw new RequestValidationError(
      `taskKind ${body.taskKind} does not match ${config.moduleLabel} Task ${taskNumber}.`,
      "TASK_KIND_MISMATCH"
    );
  }
  return { ...config, rubricVersion: RUBRIC_VERSION };
}

module.exports = {
  RUBRIC_VERSION,
  TASK_REGISTRY,
  RequestValidationError,
  normalizeExamModule,
  normalizeTaskNumber,
  resolveTaskConfig
};
