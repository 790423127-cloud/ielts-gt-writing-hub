// === 这是修改后的 Router 文件（api/grade-ielts-production-router.js） ===
// 只改了 routeReason 函数中的 Task 1 lowband guard 触发条件

// 把原来的 if (mainBand <= 5.0) 部分改成下面这样（更宽松一点给 Task 1）：

if (mainBand <= 4.5 || (mainBand <= 5.0 && task === "Task 2")) {
  // 原 lowband guard 逻辑
}

// 其他代码保持你原来的完整内容不变

// 这样 Task 1 在 5.0 时更倾向走 midband，而不是轻易触发 lowband guard