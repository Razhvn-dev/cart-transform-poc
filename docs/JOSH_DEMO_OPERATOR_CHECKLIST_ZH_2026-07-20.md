# Josh 演示操作与验收清单 — 2026-07-20

本清单供 Huang 在开发环境发布获批后使用。演示前不得运行 seed、Function
部署、原生 Bundle Unlink 或真实导入写入。

## 演示前

- [ ] 目标 App 为 `cart-transform-poc-dev`。
- [ ] 目标店铺为 `huang-mvqquz1p.myshopify.com`。
- [ ] `/healthz` 返回 `ok: true`。
- [ ] Embedded App 能正常加载，无连接重置。
- [ ] Bundle Admin 列表能刷新，不出现 `INTERNAL_ERROR`。
- [ ] 现有测试 Bundle 商品和预期三个组件已确认。
- [ ] 购物车已清空，避免旧 Cart Transform 结果干扰。

## Synthetic import 演示

- [ ] 点击 **Open Bundle Admin**。
- [ ] 进入 **Pre-built import review**。
- [ ] 点击 **Load demo data (no writes)**。
- [ ] 点击 **Normalize and review**。
- [ ] 页面显示 **Dry-run result** 和 **No writes**。
- [ ] Total=`1`、Ready=`1`、Needs review=`0`、Rejected=`0`。
- [ ] Record 状态为 `ready_for_confirmation`。
- [ ] 页面显示 source/package fingerprints。

## Bundle Admin 演示

- [ ] 打开已有测试 Bundle。
- [ ] 能查看 parent binding、active revision 和 revision history。
- [ ] Groups、Options、Presets、Compatibility Rules 正常显示。
- [ ] 演示期间不点击或启用发布、回滚、真实导入执行。

## Storefront 演示

- [ ] 添加一个主 Bundle 商品后，购物车仅有一个主 SKU 行。
- [ ] `/cart.js` 中 Bundle Metadata V1 存在。
- [ ] Checkout 展开后准确显示三个预期组件。
- [ ] Checkout 总价与预期一致。

## 失败即停止

- Bundle Admin 重复出现 `INTERNAL_ERROR`。
- `/cart.js` 出现独立组件行或 Metadata V1 丢失。
- Checkout 不展开或组件不一致。
- 商品出现新的 `requiresComponents=true` 或原生组件关系。
- 目标 App、店铺、Function 版本或 Cart Transform 绑定不明确。

失败时只保留截图、时间、页面、请求错误和只读证据；不得通过重复部署、
重复 seed、删除 Cart Transform 或批量 Unlink 来猜测修复。
