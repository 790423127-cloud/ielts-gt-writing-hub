const fs = require("fs");
const path = require("path");

const root = process.cwd();
const scriptPath = path.join(root, "script.js");
const indexPath = path.join(root, "index.html");

function fail(message) {
  console.error("ERROR:", message);
  process.exit(1);
}

if (!fs.existsSync(scriptPath)) fail("script.js not found. Run this from the project root.");
if (!fs.existsSync(indexPath)) fail("index.html not found. Run this from the project root.");

let script = fs.readFileSync(scriptPath, "utf8");
let index = fs.readFileSync(indexPath, "utf8");

const oldKeyLine = '  const GRADING_ENDPOINT_KEY = "ielts-gt-writing-hub:gradingEndpoint";';
const newKeyBlock = `  const GRADING_ENDPOINT_KEY = "ielts-gt-writing-hub:gradingEndpoint";
  const DEFAULT_GRADING_ENDPOINT = "/api/grade-ielts-production-router";`;

if (!script.includes('const DEFAULT_GRADING_ENDPOINT = "/api/grade-ielts-production-router";')) {
  if (!script.includes(oldKeyLine)) fail("Could not find GRADING_ENDPOINT_KEY line in script.js.");
  script = script.replace(oldKeyLine, newKeyBlock);
}

const oldInitLine = '    if (els.gradingEndpointInput) els.gradingEndpointInput.value = localStorage.getItem(GRADING_ENDPOINT_KEY) || "";';
const newInitBlock = `    if (els.gradingEndpointInput) {
      const savedEndpoint = localStorage.getItem(GRADING_ENDPOINT_KEY) || "";
      const migratedEndpoint = /\\/api\\/grade-ielts\\/?$/i.test(savedEndpoint)
        ? savedEndpoint.replace(/\\/api\\/grade-ielts\\/?$/i, "/api/grade-ielts-production-router")
        : savedEndpoint;
      els.gradingEndpointInput.value = migratedEndpoint || DEFAULT_GRADING_ENDPOINT;
      if (migratedEndpoint !== savedEndpoint || !savedEndpoint) {
        localStorage.setItem(GRADING_ENDPOINT_KEY, els.gradingEndpointInput.value.trim());
      }
    }`;

if (!script.includes("const migratedEndpoint = /\\/api\\/grade-ielts\\/?$/i.test(savedEndpoint)")) {
  if (!script.includes(oldInitLine)) fail("Could not find grading endpoint init line in script.js.");
  script = script.replace(oldInitLine, newInitBlock);
}

index = index.replace(
  'placeholder="https://your-domain.com/api/grade-ielts"',
  'placeholder="https://your-domain.com/api/grade-ielts-production-router"'
);

fs.writeFileSync(scriptPath, script, "utf8");
fs.writeFileSync(indexPath, index, "utf8");

console.log("Frontend endpoint switch applied.");
console.log("Default grading endpoint: /api/grade-ielts-production-router");
console.log("Old saved /api/grade-ielts localStorage values will be migrated on page load.");
