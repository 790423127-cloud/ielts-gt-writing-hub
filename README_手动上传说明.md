# IELTS GT Writing Hub 手动替换说明

本包包含两个文件：

1. `data.js`：完整替换网站题库数据。
2. `index.html`：只更新首页说明文字，并把 `data.js` 的版本号改为 `v=20260603-real-1`，避免浏览器继续读取旧缓存。

## 已录入内容

- Task 2：G15-G20，共 24 道。
- Task 1：G19-G20，共 8 道。
- Task 1：G15-G18 共 16 道暂保留原网站占位题，等你继续提供照片后再替换。

## 在 GitHub 网页上操作

1. 打开仓库：`790423127-cloud/ielts-gt-writing-hub`
2. 点开 `data.js`
3. 点右上角铅笔图标 Edit this file
4. Ctrl+A 全选旧内容
5. 粘贴本包 `data.js` 的全部内容
6. 点右上角或页面底部的 Commit changes
7. 回到仓库根目录，点开 `index.html`
8. 同样用本包 `index.html` 全量替换旧内容
9. Commit changes
10. 等 GitHub Pages 自动刷新，通常几十秒到几分钟

## 检查方法

打开：

`https://790423127-cloud.github.io/ielts-gt-writing-hub/?v=real1`

然后搜索：

- `Buying Too Many Clothes`
- `The Importance of Hobbies`
- `College Anniversary Celebration`
- `Reducing Working Hours`

能搜到就说明替换成功。
