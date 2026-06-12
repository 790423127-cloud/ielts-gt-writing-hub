const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { createRequire } = require("module");

const ROOT = path.resolve(__dirname, "..");

function assert(condition, message, extra) {
  if (!condition) {
    const detail = extra ? `\n${JSON.stringify(extra, null, 2)}` : "";
    throw new Error(`${message}${detail}`);
  }
}

function makeJsonResponse(payload) {
  return {
    ok: true,
    status: 200,
    async text() {
      return JSON.stringify(payload);
    }
  };
}

function loadHandlerWithMockedFetch(fetchImpl) {
  const absolute = path.join(ROOT, "api", "essay-generator.js");
  const source = fs.readFileSync(absolute, "utf8");
  const module = { exports: {} };
  const sandbox = {
    module,
    exports: module.exports,
    require: createRequire(absolute),
    process: {
      ...process,
      env: {
        ...process.env,
        DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY || "test-key"
      }
    },
    console,
    Buffer,
    setTimeout,
    clearTimeout,
    fetch: fetchImpl,
    AbortController,
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    __dirname: path.dirname(absolute),
    __filename: absolute
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: absolute });
  return sandbox.module.exports;
}

function makeReq(body) {
  return {
    method: "POST",
    headers: {
      origin: "https://790423127-cloud.github.io",
      host: "ielts-gt-writing-hub.vercel.app",
      "x-forwarded-host": "ielts-gt-writing-hub.vercel.app",
      "x-forwarded-proto": "https",
      "content-type": "application/json"
    },
    body
  };
}

function makeRes() {
  return {
    headers: {},
    statusCode: 200,
    body: "",
    setHeader(key, value) {
      this.headers[key.toLowerCase()] = value;
    },
    end(value = "") {
      this.body = value;
      return this;
    }
  };
}

function buildChoice(contentObject) {
  return makeJsonResponse({
    choices: [
      {
        message: {
          content: JSON.stringify(contentObject)
        }
      }
    ]
  });
}

async function run() {
  let callCount = 0;
  const fetchImpl = async (_url, options = {}) => {
    callCount += 1;
    const payload = JSON.parse(options.body || "{}");
    const prompt = payload.messages?.[1]?.content || "";

    if (callCount === 1) {
      const error = new Error("This operation was aborted");
      error.name = "AbortError";
      throw error;
    }

    if (/Generate exactly THREE learning outputs/i.test(prompt)) {
      throw new Error("Monolithic generation prompt should not be retried after timeout fallback.");
    }

    if (/modelAnswer/i.test(prompt) && /Question-based model answer/i.test(prompt)) {
      return buildChoice({
        partKey: "modelAnswer",
        title: "Question-based model answer",
        targetBand: 5.5,
        essay: "This is a learnable model answer.",
        whyThisIsLearnable: "It is slightly above the student level.",
        whyHigherThanUserEssay: "It is clearer and more complete.",
        studyPoints: ["Clear response", "Simple structure"],
        usefulSentences: ["This is a useful sentence."]
      });
    }

    if (/revisionPlus05/i.test(prompt) || /Band 5 rescue revision/i.test(prompt)) {
      return buildChoice({
        partKey: "revisionPlus05",
        title: "Band 5 rescue revision",
        targetBand: 5.0,
        essay: "This is the band 5 rescue revision.",
        whyItIsPlus05: "It fixes the core task problems.",
        whatChanged: ["Clearer purpose"],
        preservedContent: ["Original reason kept"],
        changedProblems: ["Grammar fixed"],
        whyCloserToTarget: "Task coverage is stronger.",
        imitableSentences: ["I am writing to ask if..."],
        whySourceBasedRevision: "It keeps the student facts.",
        sourceBasedChanges: ["Original meaning preserved"],
        studyPoints: ["Study the opening"],
        usefulSentences: ["Could you please consider..."],
        candidates: [
          {
            title: "Alternative source-based candidate for revisionPlus05",
            targetBand: 5.0,
            essay: "Alternative rescue version.",
            strategy: "source-based rescue",
            preservedContent: ["Original request kept"],
            changedProblems: ["More specific detail"],
            whyCloserToTarget: "Safer task coverage",
            imitableSentences: ["I would be grateful if..."],
            whySourceBasedRevision: "Still based on the student draft."
          }
        ]
      });
    }

    if (/revisionPlus10/i.test(prompt) || /Band 5.5 stronger revision/i.test(prompt)) {
      return buildChoice({
        partKey: "revisionPlus10",
        title: "Band 5.5 stronger revision",
        targetBand: 5.5,
        essay: "This is the stronger revision.",
        whyItIsPlus10: "It improves structure and clarity.",
        whatChangedFromPlus05: ["More natural cohesion"],
        preservedContent: ["Original position kept"],
        changedProblems: ["Wording improved"],
        whyCloserToTarget: "Development is more balanced.",
        imitableSentences: ["One reason is that..."],
        whySourceBasedRevision: "It still follows the student content.",
        sourceBasedChanges: ["Ideas preserved and reorganised"],
        studyPoints: ["Compare body paragraphs"],
        usefulSentences: ["In conclusion, ..."],
        candidates: [
          {
            title: "Alternative source-based candidate for revisionPlus10",
            targetBand: 5.5,
            essay: "Alternative stronger version.",
            strategy: "source-based stronger candidate",
            preservedContent: ["Original idea direction kept"],
            changedProblems: ["Example clearer"],
            whyCloserToTarget: "Closer to target balance",
            imitableSentences: ["Another reason is that..."],
            whySourceBasedRevision: "Still rooted in the student essay."
          }
        ]
      });
    }

    if (/learningGuide/i.test(prompt) || /How to learn/i.test(prompt)) {
      return buildChoice({
        startHere: {
          recommendedFirst: "revisionPlus05",
          whyFirst: "Start with the closest learnable version.",
          relationToCurrentLevel: "It is close to the student level.",
          whatToStudy: "Study the task coverage first.",
          notPriorityYet: "Do not start from the model answer.",
          targetAccuracyNote: "The generated version is for learning only."
        },
        keyDifferences: [
          {
            title: "Difference 1",
            originalProblem: "The request was vague.",
            originalEvidence: "I want to change my time.",
            revisionEvidence: "I would like to change my working hours to...",
            whyCloserToTarget: "The request is clearer.",
            imitationAction: "State the exact change next time."
          }
        ],
        threeStepStudyPlan: [
          {
            step: "Step 1",
            task: "Compare the original and revision.",
            whatToMark: "Mark the clearer request.",
            whatToLearn: "Learn to make requests specific.",
            practice: "Rewrite your opening."
          }
        ],
        imitablePatterns: [
          {
            pattern: "I am writing to ask if it would be possible to...",
            meaningZh: "我写信是想询问是否可以……",
            source: "revisionPlus05",
            useCase: "request letter",
            substitutionPractice: "I am writing to ask if it would be possible to change my working hours.",
            nextUse: "Use this when making a request."
          }
        ],
        nextWritingReminders: ["Be more specific."],
        doNotDo: ["Do not keep the request vague."]
      });
    }

    throw new Error(`Unexpected prompt on fetch call ${callCount}: ${prompt.slice(0, 160)}`);
  };

  const handler = loadHandlerWithMockedFetch(fetchImpl);
  const req = makeReq({
    mode: "generation_only",
    task: "Task 1",
    prompt: "Write a letter to your manager asking to change your working hours.",
    essay: "I want change my work time because I study cooking course.",
    currentResult: { finalBand: 4.0, criteria: { "Task Achievement": { band: 4.0 } } },
    frozenScore: { finalBand: 4.0 },
    verifyGeneratedScores: false
  });
  const res = makeRes();

  await handler(req, res);

  assert(res.statusCode === 200, "Handler should recover from monolithic timeout with phased generation fallback.", { statusCode: res.statusCode, body: res.body });
  const payload = JSON.parse(res.body || "{}");
  assert(payload.ok === true, "Recovered generation response should still be ok.", payload);
  assert(payload.modelAnswer && payload.modelAnswer.essay, "Fallback should return modelAnswer.", payload);
  assert(payload.revisionPlus05 && payload.revisionPlus05.essay, "Fallback should return revisionPlus05.", payload);
  assert(payload.revisionPlus10 && payload.revisionPlus10.essay, "Fallback should return revisionPlus10.", payload);
  assert(payload.learningGuide && payload.learningGuide.startHere, "Fallback should return learningGuide.", payload);
  assert(callCount >= 4, "Fallback should split work into smaller follow-up requests after timeout.", { callCount });

  console.log("essay-generator-timeout-fallback-test: PASS");
}

run().catch((error) => {
  console.error("essay-generator-timeout-fallback-test: FAIL");
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
