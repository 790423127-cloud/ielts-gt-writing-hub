// === 这是修改后的 Lowband 文件（api/grade-ielts-lowband.js） ===
// 重点加强了 Corrected Task 1 Band 5 规则

// 在 lowBandPrompt 函数中，把 Corrected Task 1 相关描述替换成下面这个加强版：

"Corrected Task 1 Band 5 明确规则（加强版）:
如果当前文本（修正后版本）已经满足以下条件：
- 所有 bullet points 都已覆盖
- 语气与收信人匹配（朋友信用 Dear Mark 是合适的）
- 主要意思清楚，读者能理解并采取行动
- 语法和拼写错误不再频繁阻塞理解

那么即使仍使用简单词汇和句型，也应该判为 Band 5.0–5.5，而不是 true lowband（3.0-4.5）。

只有当修正后仍然错误密集、意思仍难懂、要点严重缺失时，才保持 4.0 及以下。"

// 其他代码保持你原来的完整内容不变

// 重要提示：把上面这段替换到 lowBandPrompt 里的对应位置即可