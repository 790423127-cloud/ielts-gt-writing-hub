"use strict";

const DEEPSEEK_URL = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/chat/completions";

function parseJsonContent(content) {
  const text = String(content || "").trim();
  if (!text) throw new Error("DeepSeek returned empty content.");
  try { return JSON.parse(text); } catch {}
  const fenced = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  try { return JSON.parse(fenced); } catch {}
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1));
  throw new Error("DeepSeek did not return valid JSON.");
}

function roleConfig(role) {
  if (role === "high_specialist") {
    return {
      model: process.env.SCORE_HIGH_SPECIALIST_MODEL || process.env.SCORE_FEEDBACK_REPAIR_MODEL || process.env.SCORE_TEACHER_MODEL || "deepseek-v4-pro",
      maxTokens: Number(process.env.SCORE_HIGH_SPECIALIST_MAX_TOKENS || 6000),
      reasoningEffort: process.env.SCORE_HIGH_SPECIALIST_EFFORT || "high",
      thinking: process.env.SCORE_HIGH_SPECIALIST_THINKING || "disabled"
    };
  }
  if (role === "adjudicator" || role === "meta_adjudicator" || role === "criterion_profile_adjudicator") {
    return {
      model: process.env.SCORE_ADJUDICATOR_MODEL || "deepseek-v4-flash",
      maxTokens: Number(process.env.SCORE_ADJUDICATOR_MAX_TOKENS || 5500),
      reasoningEffort: process.env.SCORE_ADJUDICATOR_EFFORT || "high",
      thinking: process.env.SCORE_ADJUDICATOR_THINKING || "disabled"
    };
  }
  if (["low_specialist", "mid_specialist", "high_specialist"].includes(role)) {
    return {
      model: process.env.SCORE_SPECIALIST_MODEL || process.env.SCORE_EXAMINER_MODEL || "deepseek-v4-flash",
      maxTokens: Number(process.env.SCORE_SPECIALIST_MAX_TOKENS || 4800),
      reasoningEffort: process.env.SCORE_SPECIALIST_EFFORT || "medium",
      thinking: process.env.SCORE_SPECIALIST_THINKING || "disabled"
    };
  }
  if (role === "feedback_repair") {
    return {
      model: process.env.SCORE_TEACHER_MODEL || process.env.SCORE_EXAMINER_MODEL || "deepseek-v4-pro",
      maxTokens: Number(process.env.SCORE_TEACHER_MAX_TOKENS || 8000),
      reasoningEffort: process.env.SCORE_TEACHER_EFFORT || "medium",
      thinking: process.env.SCORE_TEACHER_THINKING || "disabled"
    };
  }
  return {
    model: process.env.SCORE_EXAMINER_MODEL || "deepseek-v4-flash",
    maxTokens: Number(process.env.SCORE_EXAMINER_MAX_TOKENS || 4500),
    reasoningEffort: process.env.SCORE_EXAMINER_EFFORT || "medium",
    thinking: process.env.SCORE_EXAMINER_THINKING || "disabled"
  };
}

async function callDeepSeekJson({ role = "examiner", messages, signal }) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    const error = new Error("Missing DEEPSEEK_API_KEY environment variable.");
    error.code = "MISSING_API_KEY";
    throw error;
  }
  const config = roleConfig(role);
  const totalTimeoutMs = Math.min(180000, Math.max(30000, Number(process.env.SCORE_REQUEST_TIMEOUT_MS || 120000)));
  const requestStartedAt = Date.now();
  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const controller = new AbortController();
    let cancelledByCaller = false;
    const forwardAbort = () => { cancelledByCaller = true; controller.abort(); };
    if (signal?.aborted) {
      const cancelled = new Error("Scoring request was cancelled by the caller.");
      cancelled.code = "SCORING_CANCELLED";
      throw cancelled;
    }
    signal?.addEventListener?.("abort", forwardAbort, { once: true });
    const remainingMs = Math.max(1, totalTimeoutMs - (Date.now() - requestStartedAt));
    const timeout = setTimeout(() => controller.abort(), remainingMs);
    try {
      const response = await fetch(DEEPSEEK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: config.model,
          messages,
          response_format: { type: "json_object" },
          max_tokens: attempt === 1 ? config.maxTokens : Math.ceil(config.maxTokens * 1.25),
          thinking: { type: config.thinking },
          ...(config.thinking === "enabled" ? { reasoning_effort: config.reasoningEffort } : {})
        }),
        signal: controller.signal
      });
      const raw = await response.text();
      let payload;
      try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = { raw }; }
      if (!response.ok) {
        const error = new Error(`DeepSeek HTTP ${response.status}: ${payload?.error?.message || raw.slice(0, 500)}`);
        error.httpStatus = response.status;
        throw error;
      }
      const choice = payload?.choices?.[0];
      if (choice?.finish_reason === "length") throw new Error("DeepSeek JSON was truncated at max_tokens.");
      return {
        data: parseJsonContent(choice?.message?.content),
        audit: {
          role,
          model: payload.model || config.model,
          thinking: config.thinking,
          reasoningEffort: config.reasoningEffort,
          maxTokens: attempt === 1 ? config.maxTokens : Math.ceil(config.maxTokens * 1.25),
          finishReason: choice?.finish_reason || "",
          usage: payload.usage || null,
          attempt,
          requestId: response.headers.get("x-request-id") || ""
        }
      };
    } catch (error) {
      if (cancelledByCaller || signal?.aborted) {
        const cancelled = new Error("Scoring request was cancelled by the caller.");
        cancelled.code = "SCORING_CANCELLED";
        throw cancelled;
      }
      const timedOut = error?.name === "AbortError" || /aborted|timed out|timeout/i.test(String(error?.message || ""));
      if (timedOut) {
        const timeoutError = new Error(`AI provider timed out after ${totalTimeoutMs} ms. No score was accepted.`);
        timeoutError.code = "PROVIDER_TIMEOUT";
        timeoutError.httpStatus = 504;
        throw timeoutError;
      }
      lastError = error;
      const nonRetryableClientError = Number(error?.httpStatus) >= 400 && Number(error?.httpStatus) < 500 && Number(error?.httpStatus) !== 429;
      if (attempt === 2 || error?.code === "MISSING_API_KEY" || nonRetryableClientError) throw error;
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener?.("abort", forwardAbort);
    }
  }
  throw lastError || new Error("DeepSeek request failed.");
}

module.exports = { parseJsonContent, roleConfig, callDeepSeekJson };
