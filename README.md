# IELTS General Training Writing Practice Hub

一个纯静态的 IELTS General Training Writing 练习网站，可直接通过 GitHub Pages 发布。网站覆盖 Cambridge IELTS 15-20 的 General Training Writing 练习结构，每本书包含 Test 1-4，每个 Test 包含 Task 1 和 Task 2。

> 版权说明：当前 `data.js` 中的题目均为原创 IELTS General Training 风格占位题，不是 Cambridge IELTS 15-20 原题。请不要在没有合法授权的情况下公开发布受版权保护的真题正文。

## 文件结构

- `index.html`：网站入口文件，GitHub Pages 可直接发布。
- `style.css`：页面样式，包含手机端布局和深色/浅色模式。
- `script.js`：筛选、搜索、计时器、字数统计、复制、清空、收藏和本地保存逻辑。
- `data.js`：练习题数据、Task 1/Task 2 句型库、结构提示和分数段提示。
- `README.md`：项目说明和发布步骤。

## 已实现功能

- Cambridge IELTS 15-20 六本书入口结构。
- 每本书 Test 1-4，每个 Test 包含 Task 1 和 Task 2。
- 首页统计信息：Books、Tests、Task 1 prompts、Task 2 prompts。
- 按 Book、Test、Task、题型筛选。
- 支持关键词搜索。
- 支持深色/浅色切换。
- 手机端友好，按钮尺寸适合触屏点击。
- 草稿、收藏和计划内容会保存在当前浏览器的 localStorage。

## Task 1 练习页功能

- 书信类型
- 题目与写作要求
- 建议字数：至少 150 words
- 20 分钟计时器
- 我的作文输入区
- 实时字数统计
- 常用句型提示
- 写作结构提示
- 一键复制作文
- 清空重写
- 我的常用表达收藏区
- 写作前思路整理区
- letter purpose 分析
- Band 5 保底写法提示
- Band 6+ 提升提示

## Task 2 练习页功能

- 题型
- 题目
- 建议字数：至少 250 words
- 40 分钟计时器
- 我的作文输入区
- 实时字数统计
- position / reasons / examples 分析
- 常用连接词提示
- 四段式结构提示
- 一键复制作文
- 清空重写
- 我的常用表达收藏区
- 写作前思路整理区
- Band 5 保底写法提示
- Band 6+ 提升提示

## 本地预览

直接在浏览器中打开：

```text
index.html
```

这个项目不需要安装依赖，不需要后端，不需要数据库。

## GitHub Pages 发布步骤

1. 打开 GitHub 仓库 `Settings`。
2. 进入 `Pages`。
3. `Build and deployment` 选择 `Deploy from a branch`。
4. `Branch` 选择 `main`。
5. `Folder` 选择 `/root`。
6. 保存后等待 GitHub Pages 生成网站链接。

## 如何填入你合法拥有的 Cambridge 题目

所有题目都在 `data.js` 中生成。每道题都包含这些字段：

```js
{
  book: "Cambridge IELTS 15",
  test: "Test 1",
  module: "General Training",
  task: "Task 1",
  type: "complaint",
  title: "Noise from a Community Hall",
  prompt: "原创占位题文本",
  difficulty: "Medium",
  timeLimit: 20,
  recommendedWords: 150,
  usefulPhrases: [],
  sampleStructure: [],
  notes: {},
  sourceStatus: "original placeholder"
}
```

替换为你自己合法拥有的题目时，建议只改这些字段：

- `title`
- `prompt`
- `type`
- `difficulty`
- `notes.focus`
- `sourceStatus`

将 `sourceStatus` 从：

```js
"original placeholder"
```

改成：

```js
"user-provided"
```

请确认你对填入的题目文本有合法使用权，尤其是在公开 GitHub Pages 网站时。
