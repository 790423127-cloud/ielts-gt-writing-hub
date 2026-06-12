// === 这是修改后的 Midband 文件（api/grade-ielts.js） ===
// 只改了 MIDBAND_4_TO_6_CALIBRATION_RULES["Task 1"] 部分，其余保持原样
// 你可以把这个文件内容替换你原来的 grade-ielts.js

// 以下是加强后的关键部分（直接复制替换对应位置）

const MIDBAND_4_TO_6_CALIBRATION_RULES = {
  "Task 1": [
    "Midband scope: this scorer is the primary production scorer for ordinary IELTS GT Task 1 letters around Band 4.0-6.5. Do not outsource ordinary Band 5 writing to lowband logic.",

    // === 重点加强：Corrected Band 5 规则 ===
    "Corrected low-band Task 1 明确规则（非常重要）: 如果信件已经过明显语法/拼写修正，三个 bullet points 都已覆盖，目的清楚，语气与收信人匹配（朋友信用 Dear Mark + Yours, Kevin 完全合适），主要意思读者能理解并行动，即使词汇普通、句型简单、仍有少量非阻塞错误，也应该正常进入 Band 5.0–5.5，而不是停留在 4.0–4.5。",
    "Band 5.0 Task 1: 目的基本清楚，要点基本覆盖，语言有限但主要意思可懂。Band 5 允许有明显但不阻塞理解的语法和拼写错误。不要因为词汇普通或句型简单就自动把 LR/GRA 压到 4.5 以下。",
    "Band 5.5 Task 1: 要点覆盖更清楚，组织更稳定，错误减少。即使仍使用简单表达，只要意思清楚、语气合适，也可给 5.5。",
    // === 结束加强 ===

    "Band 4.0 Task 1: 相关尝试但沟通不稳定；要点覆盖可能不完整或很薄；频繁基础错误使阅读费力。",
    "Band 4.5 Task 1: 大意可理解，要点可能触及，但语言问题仍明显，展开弱。",
    "Band 6.0 Task 1: 所有要点覆盖且有有用细节，语气格式合适，语言有一定控制。",
    "Band 6.5 Task 1: 完成度高，细节更好，但还不够灵活自然到 Band 7。"
  ],

  "Task 2": [
    // Task 2 部分保持原样（或按需加强）
    "Midband scope: this scorer is the primary production scorer for ordinary IELTS GT Task 2 essays around Band 4.0-6.5.",
    "Band 4.0 Task 2: 相关尝试但发展很弱，语言控制差，错误频繁。",
    "Band 4.5 Task 2: 大意可懂，但发展薄，语言仍有限。",
    "Band 5.0 Task 2: 立场清楚，基本结构存在，但想法笼统，例子简短，语言简单但主要意思可跟。",
    "Band 5.5 Task 2: 发展更一致，推进更清楚，语言更容易读懂。",
    "Band 6.0 Task 2: 回应清楚，有真实但基本的展开，错误不严重影响理解。",
    "Band 6.5 Task 2: 相关且有发展，语言有一定灵活性，但还没到 Band 7 的成熟度。"
  ]
};

// 其他代码保持你原来的完整内容不变
// ... (你原来的所有其他代码)

// 重要提示：把上面 MIDBAND_4_TO_6_CALIBRATION_RULES 替换到你原来的文件中即可