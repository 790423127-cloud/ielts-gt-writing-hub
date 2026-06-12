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

function loadAuditFromScript() {
  const absolute = path.join(ROOT, "script.js");
  const source = fs.readFileSync(absolute, "utf8");
  const instrumented = source.replace(/\}\)\(\);\s*$/, `
window.__GEN_TEST__ = {
  generatedVerificationStatus,
  generatedVerificationSummary,
  publicGeneratedVerificationStatus,
  generatedComparisonStatus,
  isAcceptedGeneratedVersion,
  generatedVerificationMessageZh,
  normalizeGeneratedVerificationPayload
};
})();
`);
  const elementStub = () => ({
    value: "",
    innerHTML: "",
    textContent: "",
    dataset: {},
    style: {},
    hidden: false,
    disabled: false,
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener() {},
    removeEventListener() {},
    appendChild() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    closest() { return null; }
  });
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    URL,
    URLSearchParams,
    navigator: { clipboard: { writeText: async () => {} } },
    history: { replaceState() {} },
    location: { hash: "", origin: "https://example.test" },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    fetch: async () => { throw new Error("fetch should not run in unit test"); },
    document: {
      body: { contains() { return false; }, appendChild() {} },
      documentElement: { dataset: {} },
      getElementById: () => elementStub(),
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener() {},
      createElement: () => elementStub()
    },
    window: {
      IELTS_GT_DATA: { prompts: [], meta: {}, phraseBanks: { task1: {}, task2: {} } },
      location: { hash: "", origin: "https://example.test" },
      addEventListener() {},
      removeEventListener() {}
    }
  };
  sandbox.window.document = sandbox.document;
  sandbox.window.localStorage = sandbox.localStorage;
  sandbox.window.history = sandbox.history;
  sandbox.window.navigator = sandbox.navigator;
  sandbox.window.fetch = sandbox.fetch;
  sandbox.global = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(instrumented, sandbox, { filename: absolute });
  return sandbox.window.__GEN_TEST__;
}

function loadAuditFromApi() {
  const absolute = path.join(ROOT, "api", "essay-generator.js");
  const source = fs.readFileSync(absolute, "utf8");
  const wrapped = `${source}\nmodule.exports.__audit = { verificationLabel, strictVerificationStatus, applyStrictVerificationMeta };`;
  const module = { exports: {} };
  const sandbox = {
    module,
    exports: module.exports,
    require: createRequire(absolute),
    process,
    console,
    Buffer,
    setTimeout,
    clearTimeout,
    fetch: async () => { throw new Error("fetch should not run in unit test"); },
    AbortController,
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    __dirname: path.dirname(absolute),
    __filename: absolute
  };
  vm.createContext(sandbox);
  vm.runInContext(wrapped, sandbox, { filename: absolute });
  return sandbox.module.exports.__audit;
}

function run() {
  const scriptAudit = loadAuditFromScript();
  const apiAudit = loadAuditFromApi();
  const scriptSource = fs.readFileSync(path.join(ROOT, "script.js"), "utf8");

  assert(!/closest_available/.test(scriptSource), "script.js should not keep closest_available as a terminal success-like status.");

  const tooLow = scriptAudit.normalizeGeneratedVerificationPayload({ targetBand: 5.0, verifiedBand: 4.5, status: "below_target" });
  assert(tooLow.verificationStatus === "verified-too-low", "4.5 vs target 5.0 should be verified-too-low.", tooLow);
  assert(tooLow.isAcceptedForLearning === false, "Too-low version must not be accepted for learning.", tooLow);

  const tooHigh = scriptAudit.normalizeGeneratedVerificationPayload({ targetBand: 5.5, verifiedBand: 6.0, status: "target_exceeded" });
  assert(tooHigh.verificationStatus === "verified-too-high", "6.0 vs target 5.5 should be verified-too-high.", tooHigh);
  assert(tooHigh.isAcceptedForLearning === false, "Too-high version must not be accepted for learning.", tooHigh);

  const pass = scriptAudit.normalizeGeneratedVerificationPayload({ targetBand: 5.5, verifiedBand: 5.5, status: "target_met" });
  assert(pass.verificationStatus === "verified-pass", "Exact target should be verified-pass.", pass);
  assert(pass.isAcceptedForLearning === true, "Exact target should be accepted for learning.", pass);

  const apiTooLow = apiAudit.applyStrictVerificationMeta({ targetBand: 5.0, verifiedBand: 4.5, status: "below_target" });
  assert(apiTooLow.verificationStatus === "verified-too-low", "API meta should mark 4.5 vs 5.0 as verified-too-low.", apiTooLow);
  assert(apiTooLow.isAcceptedForLearning === false, "API too-low result must not be accepted.", apiTooLow);

  const apiTooHigh = apiAudit.applyStrictVerificationMeta({ targetBand: 5.5, verifiedBand: 6.0, status: "target_exceeded" });
  assert(apiTooHigh.verificationStatus === "verified-too-high", "API meta should mark 6.0 vs 5.5 as verified-too-high.", apiTooHigh);
  assert(apiTooHigh.isAcceptedForLearning === false, "API too-high result must not be accepted.", apiTooHigh);

  const apiPass = apiAudit.applyStrictVerificationMeta({ targetBand: 5.0, verifiedBand: 5.0, status: "target_met" });
  assert(apiPass.verificationStatus === "verified-pass", "API meta should mark exact target as verified-pass.", apiPass);
  assert(apiPass.isAcceptedForLearning === true, "API exact target must be accepted.", apiPass);

  console.log("essay-generator-target-validation-test: PASS");
}

run();
