# 项目当前进展（2026-07-22，v60 诊断）

业务简版见 `docs/PROJECT_BUSINESS_PROGRESS_2026-07-21.md`。本文件记录当前已验证技术事实；V5.4 SSOT 与生产架构锁没有改变。

## 当前阶段

Bundle Admin 本地基线已完成。开发店的通用 pre-built Projection 路径已从单一 AF4005PK 样例推进到首个多 SKU 技术批次，并完成真实 Cart/Checkout 验收。生产仍使用 hard-coded Cart Transform Shared Core，未切换 runtime authority，未触碰 Custom Distribution App。

## 开发店已验证

- 活动开发版本：`cart-transform-poc-dev-60`（开发静态 hosted bisect）；Cart Transform registration：`gid://shopify/CartTransform/136675606`。
- `AF4005PK`：Cart 单父行；Checkout 展开 `AF4005P` + `AF2009P`；订单 `#1014` 仅含组件，总额 `$559.99`；组件 Available 库存扣减，父库存不扣减。
- `AD2011-C`：Definition、Revision、Snapshot、Projection 与 Publication 全部持久化并读回；原生商品页元数据生效；Cart 单父行；Checkout 展开 `AD2011` + `AC2008`，总额 `$369.99`；测试订单确认号 `ZUADTNN5E` 仅按组件扣减库存，父库存保持不变。
- `AD2023-C`：Definition、Revision、Snapshot、Projection 与 Publication 全部持久化并读回；原生 Add to cart 成功；Cart 单父行；Checkout 展开 `AD2023` + `AC2008`，总额 `$389.99`。本轮未重复创建第二张订单。
- 默认 product template 的五个隔离 App block 已保存并读回：`AF4005PK`、`AD2011-C`、`AD2023-C`、`AS2008C`、`AS2020PS`。
- AD2023 首次 Checkout 的 `0 ×` / `$0.00` 现象已证实为组件 `AD2023` 库存为 0 导致的 Shopify stock-problems 行为，不是 Projection 数量或 Function 计算错误；将该组件临时设为 1 后原生加购和 Checkout 均通过。
- 验收结束后购物车已清空；`AD2011-C`、`AD2023-C`、`AD2023` 的临时库存均恢复并读回为 `0/0`。

## 首个技术批次持久化结果

| Parent | Definition | Revision | Snapshot | Projection | Publication |
| --- | --- | --- | --- | --- | --- |
| `AD2011-C` | `36d5b724-8d8b-57b0-83a6-cf74e37ea223` | `b9215726-c946-5181-84bb-74724bb38bf5` | `639a025a` | `850c67b4` | `7cf2d130-b520-5db2-aa32-4e06bee37fa9` |
| `AD2023-C` | `4e27404d-877b-5b4f-9f9e-e8836115ace3` | `638377b3-83a4-5785-a3bd-9e4e59bead1e` | `1188e8dc` | `7941ca33` | `b32666a3-0ee7-5e05-85dc-875fa56d6e08` |

两条 Publication 均为 `success`，两条导入 ledger 均为 `completed`。执行清单 checksum 为 `70a50d1f`，导入包 fingerprint 为 `fd1baf03`。TLS 中断后的流程通过只读对账和精确续跑完成，没有盲目重发 mutation。

## 全目录准备度

- Bundles.app 源关系：2,052 条；唯一父 SKU：1,554 个。
- 其中 1,148 个 quantity-one Bundle 已具备本地映射候选，可进入后续分批迁移验证。
- 另外 406 个包含重复组件数量语义，需 V5.5 或更高版本规则；V5.4 不得把它们强制当作 quantity-one 导入。
- 当前完成的是三个 SKU 的技术批次，不代表 1,148 个候选已批量写入开发店。

## 本地实现与验证

- 已实现可恢复的开发店批次执行器、只读对账、精确续跑、确认短语和目标锁定。
- 已实现开发店测试 SKU 的库存窗口脚本，使用精确 allowlist、0↔1 CAS、幂等键与写后读回。
- Shopify CLI 网络仍偶发 TLS 连接失败；执行器会将其当作传输层不确定性处理，不会盲目重试 mutation。
- 根项目全量测试通过：106 个测试文件、628 个测试；Function 测试 65 个文件、426 个测试；`npm run validate:local`、`lint`、production-clean 与 `git diff --check` 通过。

## 剩余工作

1. 修复第二代表性批次在托管环境中的通用 Projection candidate 路径；当前 v60 静态 hosted bisect 已通过，但不能作为最终通用实现。
2. 完成批量导入回滚、对账、监控与运行手册演练。
3. 明确 406 个重复数量 Bundle 的 V5.5 业务语义与实现方案。
4. 验证 Shopify Collective 的订单和履约边界。
5. 在单独审批的生产阶段，重新解析正式店 GID、权限和销售渠道，先做小批量试点，再分批迁移。

## 当前安全状态

- 正式 runtime authority：hard-coded Shared Core，未改变。
- Custom Distribution App：未触碰。
- 正式店商品、库存、主题和 Bundle 数据：未修改。
- 开发店最新无痕验收会话：未提交订单；可直接关闭该浏览器会话。
- 临时测试库存：已恢复并完成读回。

## 2026-07-22 最新推进（v60）

- 第二技术批次 `AS2008C` 与 `AS2020PS` 已完成 Definition、Revision、Snapshot、Projection、Publication、active pointer 与 completed ledger 的持久化和精确读回。
- 活动开发主题 `test-data`（`#186771538198`）已远端读回 5 个独立 metadata block；新增绑定为 `AS2008C`、`AS2020PS`。两个真实商品页均验证到唯一 marker、脚本和原生 Dawn 表单的 Bundle Metadata V1。
- 可重复库存窗口执行器已修复跨轮次幂等键复用问题；现在每轮必须提供稳定且唯一的 `--window-id`。全部 7 个临时库存已恢复并读回为原始 `0/0`。
- v59 下两条新数据的 Checkout 仍显示父商品。活动开发版本现为 `cart-transform-poc-dev-60`，消息 `component-breadth-static-hosted-bisect`；它只增加两个精确父 Variant 的开发静态 bisect，生产入口不变。
- v60 激活后的全新无痕 Cart-to-Checkout 验收已通过：Cart 保持一个 `High Roller (Classic)` 父商品，Checkout 精确展开 3 个组件，总额保持 `$139.99`。本轮未提交订单。有界 CLI Function 日志流未输出记录，但真实 Checkout 展开已经证明活动 binding、托管调用和静态 expand payload 均正常。
- 故障现已限定在 v59 的托管 Projection candidate 路径；主题元数据、Cart 父行、Cart Transform registration 和 Shopify 组件展开能力均已排除。v60 只是开发诊断 fallback，不是通用修复。下一步从已通过的静态 payload 开始，逐层重新引入 Projection 解析与校验，做更细粒度的 hosted bisect。
- 本轮 7 个临时测试库存均已从 `1/1` 恢复并读回为原始 `0/0`；未创建订单。
- 生产 Function query、generated types 与 Wasm 已恢复并通过 production-clean；Custom Distribution App、正式店和生产 runtime authority 均未触碰。
# 2026-07-22 最新状态：v63 通用 Projection 修复

- v61 可观察诊断确认：托管运行时能够完整读取 Bundle Metadata V1、解析并校验持久化 Projection、验证父商品与价格，并成功构造候选结果；故障边界被缩小到最终候选提升阶段。
- v62 仅绕过 `promotePrebuiltBundleRuntimeCandidate` 中重复的 clone/deep-freeze 遍历后，真实三组件 Projection 在 Checkout 正常展开，组件属性与总价均正确。
- 已实施最小通用修复：复用 Builder 已拥有且深冻结的候选 operations；Shared Core operations 仍保持防御性克隆，非冻结调用仍维持旧行为，结果仍为深冻结对象。
- 活动开发版本现为 `cart-transform-poc-dev-63`，消息 `projection-promotion-runtime-cost-fix`，运行通用 `prebuilt-projection-candidate` Profile。
- v63 真实 Checkout 验收通过：`AS2008C` 保持一个父商品并展开 3 个组件，总价 `$139.99`；`AS2020PS` 保持一个父商品并展开 4 个组件，总价 `$559.99`。
- 未填写结账资料、未提交订单；购物车已清空。库存窗口 `v63-projection-fix-1` 的 7 个临时 SKU 均已从 `1/1` 恢复并精确读回为原始 `0/0`。
- 最新本地验证：109 个测试文件、640 项测试全部通过；lint、应用构建、production-clean 和 `git diff --check` 均通过。
- 正式 runtime authority 仍为 hard-coded Shared Core；Custom Distribution App、正式店与正式数据均未触碰。

## 更新后的剩余工作

1. 将当前开发店技术验收沉淀为批量导入、回滚、对账、监控和运行手册演练；通用 Projection Checkout no-op 已不再是当前阻塞项。
2. 为 406 个包含重复组件数量语义的 Bundle 制定 V5.5 业务规则与实现方案；V5.4 不做语义猜测。
3. 验证 Shopify Collective 的订单与履约边界。
4. 正式迁移必须作为独立审批阶段：重新解析正式店 GID、权限、销售渠道与库存基线，先小批量试点，再分批迁移；不得直接把开发店 GID 或库存写入正式店。

## 2026-07-22 库存窗口回执加固

- 已修复成功回执遗漏 `window_id` 的审计缺口；今后的 open/restore 回执会同时保留完整确认短语和稳定引用路径，并在输出前验证 before 状态符合计划转换、after 状态全部到达请求值。
- 这是本地证据格式修复，不会重新打开 v63 已结束的库存窗口；v63 的 7 个测试 SKU 仍保持已读回确认的原始 `0/0`。
- 修复后的最新验证为 109 个测试文件、642 项测试全部通过，完整 `validate:local` 与 `git diff --check` 通过。
- 批次执行与库存窗口输出已统一增加精确的 `shopify_writes_performed`：只读、预检和 completed 幂等重跑为 `false`；本次真正进入持久化或库存 mutation 并完成读回时为 `true`，后续汇总不得再从 `mode` 或 `status` 猜测是否发生写入。
