"use strict";

const { runUnifiedScoring } = require("./_scoring/engine");

function readJsonBody(req) {
  if (req.body && typeof req.body === "object") return Promise.resolve(req.body);
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 2_000_000) reject(Object.assign(new Error("Request body is too large."), { statusCode: 413 }));
    });
    req.on("end", () => {
      try { resolve(raw ? JSON.parse(raw) : {}); }
      catch { reject(Object.assign(new Error("Request body must be valid JSON."), { statusCode: 400 })); }
    });
    req.on("error", reject);
  });
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
  }
  const requestId = `score-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const startedAt = Date.now();
  const streaming = /application\/x-ndjson/i.test(String(req.headers?.accept || ""));
  const writeStreamEvent = (event) => {
    if (!streaming || res.destroyed || res.writableEnded) return;
    res.write(`${JSON.stringify(event)}\n`);
  };
  if (streaming) {
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();
  }
  const requestController = new AbortController();
  const abortPendingWork = () => {
    if (!res.writableEnded) requestController.abort();
  };
  req.once?.("aborted", abortPendingWork);
  res.once?.("close", abortPendingWork);
  try {
    const body = await readJsonBody(req);
    console.info(`[scoring] ${requestId} started ${body.examModule || body.module || "unknown"} ${body.task || body.taskNumber || "unknown"}`);
    const result = await runUnifiedScoring(body, {
      signal: requestController.signal,
      onStage: (stage, detail) => {
        const elapsedMs = Date.now() - startedAt;
        console.info(`[scoring] ${requestId} ${stage} at ${elapsedMs} ms`);
        writeStreamEvent({ type: "progress", stage, detail, elapsedMs });
      }
    });
    console.info(`[scoring] ${requestId} completed in ${Date.now() - startedAt} ms`);
    if (streaming) {
      writeStreamEvent({ type: "result", data: result, elapsedMs: Date.now() - startedAt });
      return res.end();
    }
    return res.status(200).json(result);
  } catch (error) {
    const status = Number(error.httpStatus || error.statusCode) || (error.code === "MISSING_API_KEY" ? 503 : 500);
    console.error(`[scoring] ${requestId} failed in ${Date.now() - startedAt} ms: ${error.code || error.name || "ERROR"} ${error.message || error}`);
    if (streaming) {
      writeStreamEvent({ type: "error", error: error.code || "SCORING_FAILED", detail: error.message || String(error), elapsedMs: Date.now() - startedAt });
      if (!res.destroyed && !res.writableEnded) res.end();
      return;
    }
    return res.status(status).json({
      ok: false,
      error: error.code || (status >= 500 ? "SCORING_FAILED" : "INVALID_REQUEST"),
      detail: error.message || String(error)
    });
  } finally {
    req.removeListener?.("aborted", abortPendingWork);
    res.removeListener?.("close", abortPendingWork);
  }
};

module.exports.config = { maxDuration: 180 };
