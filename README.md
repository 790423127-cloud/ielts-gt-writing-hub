# IELTS Writing Hub

一个面向私人学习的 IELTS Academic（A 类）与 General Training（G 类）写作题库和 AI 估分工作台。

## 当前内容

- A 类：剑雅 10–21，共 96 题。
  - Task 1：48 题，含本地图表图片。
  - Task 2：48 题。
- G 类：剑雅 15–20，共 48 题。
  - Task 1 书信：24 题。
  - Task 2 议论文：24 题。
- A/G、Task、册数、Test、大题型、小题型和关键词筛选。
- A/G Task 1/Task 2 统一评分接口。
- v6.5 纯 AI 全分段评分：双通用评分官先给出四项分；普通稳定样本直接采用完整 AI 报告，低/中分争议进入区间专家与 AI 总裁决，高分边界改由一次独立 Pro 上限复核。每个 0.5 档都是明确边界，Band 8+ 必须实际核对 Band 9。所有分数均由 AI 给出，本地规则只验证证据与路由、不加减分。
- 自然教师式四项反馈：当前表现、分数边界、全文模式、原文证据和一次优先修改。
- 95 篇全量阶梯作文：0–9 每 0.5 档 5 篇，覆盖 A/G Task 1/2，并配有 76 篇校准集、19 篇留出集和隐藏作者目标的独立 Pro 参考标签。
- 白底高对比产品 UI：学习总览、分页题库、宽幅写作工作台、紧凑计时器、评分报告、教师反馈与表达收藏。
- 原有详细反馈、作文修改、学习反馈和老师记忆功能继续保留。

> 题目与图片来自用户提供的学习材料。请只在你拥有合法使用权限的范围内使用和发布。

## 本地运行（端口 4000）

要求 Node.js 20 或更高版本。

```powershell
Copy-Item environment.template .env.local
# 在当前终端或系统环境中配置 DEEPSEEK_API_KEY
npm start
```

打开：<http://127.0.0.1:4000>

本地服务器同时提供静态页面和 `/api/*.js` 接口。没有配置 `DEEPSEEK_API_KEY` 时，题库和页面仍可使用；提交实时 AI 评分会返回明确的 `MISSING_API_KEY` 错误。

## 测试

```powershell
npm test
npm run test:calibration:static
```

默认测试覆盖：

- A/G 四类任务注册与请求校验；
- 服务端词数重算；
- 词数和其他本地风险信号不得降低、抬高或重写 AI 返回的四项分数；
- 双评分官分歧与裁决；
- 有实质分歧才启用 AI 低/中/高区间专家与 AI 总裁决；
- 四项强弱对比审计，不用本地规则强行拆分分数；
- 单次批量反馈必须返回四项完整反馈，且不得改变已冻结分数；
- 96 道 A 类题和 48 张本地图；
- 自然四项报告渲染与非机械措辞；
- 表达库渲染回归；
- 原有评分路由离线兼容测试。

`npm run test:deployed-legacy` 会访问旧的线上部署，仅用于诊断旧 production router，不属于本地验收。

配置真实 API Key 后，可以运行 95 篇阶梯校准：

```powershell
npm run test:ladder:static
npm run test:ladder:calibration
npm run test:ladder:holdout
npm run test:cost:core
npm run test:cost:feedback
```

校准报告写入 `evaluation/reports/`，包含对盲标参考与作者设计目标的两套 Overall/四项 MAE、半分命中率、严重误差率、四项同分率和四类任务覆盖。验收阈值固定在语料文件中，不能由模型自行放宽。

2026-07-16 的 v6.1 留出测试完成 19/19，运行错误 0；对隐藏作者目标的独立 Pro 参考，Overall MAE 0.579、四项 MAE 0.612、0/1 边界准确率 100%。严格总门槛没有全部通过：半分内命中率 57.9%，高分段仍存在模型间分歧。报告不会把 AI 自写目标冒充官方真人考官真值。

v6.5 延续 v6.2 的成本控制，同时修复旧模板造成的 Band-8 天花板。普通稳定且四项不完全同分的样本仍为 2 次核心调用；Band 4–7 四项同分候选通常为 3 次；低/中分争议通常为 4 次；高分边界为两次 Flash 初评加一次独立 Pro 复核，共 3 次。若 AI 返回缺失或使用非 IELTS 标准的上限理由，最多语义重试一次，并把真实调用数与 token 计入审计。四项反馈仍优先合并为 1 次 Flash 调用。小规模云端对照仅用于诊断，不修改、不提交也不推送 GitHub 标准。

## 统一评分请求

```json
{
  "examModule": "academic",
  "taskNumber": 1,
  "taskKind": "academic_visual_report",
  "questionPrompt": "Summarise the information ...",
  "essay": "The chart illustrates ...",
  "visualFacts": {
    "visualType": "line_chart",
    "keyFeatures": [],
    "sourceVerified": false
  }
}
```

其他任务标识：

- G 类 Task 1：`general_training` + `1` + `gt_letter`
- A 类 Task 1：`academic` + `1` + `academic_visual_report`
- A/G Task 2：对应模块 + `2` + `essay`

评分架构、裁决规则和 Academic Task 1 事实层说明见 [docs/SCORING-ARCHITECTURE.md](docs/SCORING-ARCHITECTURE.md)。UI 令牌、组件和产品页面规范见 [docs/UI-SYSTEM.md](docs/UI-SYSTEM.md)。

## 主要文件

- `index.html` / `style.css` / `script.js`：前端工作台。
- `data.js`：G 类题库。
- `academic-data.js`：导入并分类后的 A 类题库。
- `assets/academic/`：A 类 Task 1 本地图。
- `api/grade-writing.js`：统一评分入口。
- `api/_scoring/`：任务注册、输入校验、量表提示、模型客户端、评分一致性与裁决。
- `evaluation/`：完整金标准作文、真实接口验证器和版本化报告。
- `product-ui.css`：成熟产品 UI 的设计令牌和响应式组件层。
- `scripts/import-academic-content.cjs`：A 类压缩包批量导入脚本。
- `dev-server.js`：4000 端口本地服务器。

## 部署配置

Vercel 环境至少需要：

```text
DEEPSEEK_API_KEY=...
SCORE_EXAMINER_MODEL=deepseek-v4-flash
SCORE_SPECIALIST_MODEL=deepseek-v4-flash
SCORE_HIGH_SPECIALIST_MODEL=deepseek-v4-pro
SCORE_ADJUDICATOR_MODEL=deepseek-v4-flash
SCORE_THREE_ZONE_ENABLED=true
SCORE_CONDITIONAL_REVIEW_ENABLED=true
SCORE_FEEDBACK_MODEL=deepseek-v4-flash
SCORE_FEEDBACK_REPAIR_MODEL=deepseek-v4-pro
```

不要把真实密钥写进前端、Git 或题库文件。
