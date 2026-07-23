# Project Handoff - 2026-07-22 Rust Spike

## 一句话状态

开发商店继续保持 v64；此前的 v65 Rust Projection 候选已完成真实 10/12 组件
Checkout 验收后恢复为 inactive。当前本地 Rust hybrid 已同时覆盖 hard-coded Shared
Core 与 pre-built Projection，修复 malformed JSON panic，并通过单行最坏字符串 19
组件的 20% 指令余量门槛。下一步是单独批准新的 dev-only hybrid 候选部署与托管验收，
不是更换 Option C 业务架构。

## 当前安全状态

- 仓库：`C:\Users\Administrator\Desktop\test\cart-transform-poc\cart-transform-poc`
- 分支：`codex/prebuilt-catalog-runtime-hardening`
- 开发应用：`cart-transform-poc-dev`
- 开发商店：`huang-mvqquz1p.myshopify.com`
- 开发配置：`shopify.app.dev.toml`
- 当前开发版本：`cart-transform-poc-dev-64`
- v64 Version ID：`gid://shopify/Version/1060288921601`
- Cart Transform：`gid://shopify/CartTransform/136675606`
- Function ID：`019f5e8c-0374-7577-b756-66af47a751be`
- 测试购物车已清空。
- 8 个临时开放的组件库存均已通过 CAS 恢复为 `available=0 / on_hand=0`。
- 没有创建订单，没有填写联系、配送或支付信息。
- 正式商店、Custom Distribution App 和生产运行权均未改动。
- 本批没有 commit、push 或新的 Shopify deployment。

## 已完成业务能力

- Cart 保持一个 Master Kit 父商品。
- Checkout 和 Orders 展开真实组件。
- 只扣减组件库存。
- Bundle Metadata V1、父子映射、组件顺序和固定组件价格均保留。
- Bundle Admin 的定义、修订、校验、预览、审计和恢复基础已具备。
- 正式店迁移数据已经按 SKU 建立重新解析 Product/Variant ID 的原则，
  不能直接复用开发店 GID。
- 已识别 1,554 个唯一父 SKU、2,052 条父子关系；其中 1,148 个
  Bundle 的组件数量全部为 1，406 个包含重复数量关系，需要后续数量规则。

## 最新验证证据

### v64 真实开发店验收

- 商品：`AS2014B-BT`
- Cart：一个父商品，价格 `$989.99`
- Checkout：展开 8 个 quantity-one 组件
- Checkout 总价：`$989.99`
- 结果：通过

### 当前本地 JavaScript 指令基准

| Fixture | 指令数 | 1100 万上限结果 |
| --- | ---: | --- |
| synthetic 8 | 9,322,255 | 通过，余量 1,677,745 |
| real 10 `AS2014B2-FK-4005P` | 11,943,915 | 失败，超出 943,915 |
| synthetic 12 | 12,685,182 | 失败，超出 1,685,182 |

结论：继续压缩 JavaScript 已缺少可靠收益，转入 Rust 本地原型验证。

## 已批准的 Rust 方案

- 不修改或替换当前 JavaScript v64。
- 用 Shopify CLI 生成并行 sibling Rust Cart Transform extension。
- 复用 `prebuilt_bundle_expand_projection.v1` 和 Bundle Metadata V1。
- 非法、缺失或不匹配输入全部 fail closed，返回空 operations。
- 8、真实 10、12 组件必须与当前接受的 JavaScript 输出一致。
- Shopify 硬门槛：每个测试低于 11,000,000 指令。
- 工程目标：真实 10 和 12 组件不高于 8,800,000 指令，保留至少 20% 余量。
- 本地通过不自动授权部署；开发店部署和正式店迁移仍需单独评审。

设计和计划：

- `docs/superpowers/specs/2026-07-22-prebuilt-projection-rust-spike-design.md`
- `docs/superpowers/plans/2026-07-22-prebuilt-projection-rust-spike.md`

## Rust 工具链与本地实现状态

- stable 已完成：`rustc 1.97.1`、`cargo 1.97.1`、Rustup `1.29.0`。
- 已安装 `wasm32-unknown-unknown`、`wasm32-wasip1` 与
  `x86_64-pc-windows-msvc`；Shopify Rust extension 使用
  `wasm32-unknown-unknown`。
- sibling extension 位于 `extensions/master-kit-expand-rust-spike`，未接管 v64，
  未写入正式 Shopify 配置。
- Rust hybrid 先输出 hard-coded Shared Core，再输出不冲突的 pre-built
  Projection；cross-path 冲突保留 Shared Core 并抑制 pre-built。
- Projection `jsonValue` 保持 raw `JsonValue`，进入 `run()` 后逐字段可失败解析。
  缺字段或字段类型错误不会再在 typegen 入口 panic，也不会清除有效 Shared Core。
- canonical checksum、publication header、受保护字段、Bundle Metadata V1、父级身份、
  固定价格合计与重复项均 fail closed。
- production JavaScript Shared Core 的 Standard、Advanced、compatibility、legacy
  四种输出与 Rust Wasm 精确一致。

### 2026-07-23 最终本地指令边界

- conservative release preflight：通过。
- 保守支持 envelope：单行、最多 19 个组件，以 `worst-string-19` 为依据；该 case
  为 `4,901,556` instructions，满足至少 20% 余量。
- real-19 多行探测：4 行 `8,219,481`（通过 20% 门槛）；5 行
  `10,270,584`（低于硬上限但余量不足）；6 行 `12,325,685`（硬超限）。
- worst-string-19 多行探测：2 行 `9,805,931`（余量不足）；3 行
  `14,708,582`（硬超限）。
- 超限探测继续作为 boundary report 输出，不会被误当成 release support，也不会让
  默认 preflight 因刻意探测 unsupported case 而永久失败；`--strict-probes` 保留严格
  非零语义。

### 2026-07-23 Bundle Admin 只读恢复评估

- 新增 authenticated recovery-assessment route 与 UI 诊断入口；不提供 execute、
  publish 或 rollback 操作。
- 服务端必须重新 review 原始 import input，不接受客户端 plan；一次最多 25 个 trimmed、
  non-empty、unique source identities。
- `import_id`、source/target fingerprint 与 target ID 全部参与 ledger 一致性判断。
- Shopify adapter 使用单次只读 Shop metafields batch query；任何读取失败整批返回
  `PERSISTENCE_FAILED`，不产生 ledger、target 或 publication 写入。

## 下一步工作顺序

1. 申请新的 dev-only Rust hybrid 候选部署批准；保持 v64，禁止直接覆盖正式运行权。
2. 获批后先创建 inactive candidate，再验证 Shared Core Builder 与 pre-built
   8/10/12/19 单行场景、malformed fail-closed 和混合购物车。
3. 托管验证通过后，再单独评审 active version 切换、回滚与库存窗口。
4. 为多 bundle cart 定义明确的产品限制或继续优化总购物车 instruction budget；当前
   不得宣称支持多行 worst-string 19 组件。
5. 补价格、缺货、冲突、恢复、订单和库存对账场景。
6. 完成 406 个重复数量 Bundle 的业务规则。
7. 准备正式店小批量迁移清单、权限、回滚、监控和负责人。
8. 小批量正式店试点通过后，再分批迁移剩余 Bundle。

## 新对话恢复说明

推荐下次新开对话，降低长对话上下文噪声。新对话可直接发送：

> 请读取 `Project_Master_Context_V5.4_Current_Baseline.md`、
> `docs/PROJECT_HANDOFF_2026-07-22_RUST_SPIKE.md`、Rust spike 设计和实施计划，
> 然后从 Rust stable 工具链下载继续。保持 v64，不部署、不提交，持续推进到
> 必须我手动操作或需要新的外部写入批准为止。

继续当前对话也可以，技术结果不会不同；新对话更适合后续 1-2 小时的 Rust
实现和基准测试。

## 工作区注意事项

- 工作区包含大量本轮及此前未提交改动，不得 reset、clean、checkout、stash
  或删除。
- 新 Rust 工作应严格限制在实施计划列出的新增目录和脚本。
- 当前 JS v64 之后的性能实验仍是本地改动，未部署。
- 每次 dev build 后必须恢复 production Function query、generated types 和 Wasm，
  并运行 production-clean assertion。

## 2026-07-23 v67 Rust Hybrid 托管验收（v64 已恢复）

- v66 作为首个 inactive hybrid 候选成功创建，但 live 只读诊断发现 Builder
  Standard 仍引用两个已删除的 Variant GID，因此 v66 从未激活，最终保持
  `inactive`。
- 精确 SKU/Product read-back 确认替代身份唯一：
  - EFI `AS2212CBL-BT`：
    `51552319766806` → `51592538587414`
  - Ignition `AC2008`：
    `51552321011990` → `51592730706198`
  - Fuel `FUEL-TEST-001` 保持 `51505348346134`
- JavaScript hard-coded authority、Runtime Snapshot/config fixtures、Rust Shared
  Core 与 parity fixture 已统一到当前 live Variant。JavaScript/Rust authority
  将旧 GID 视为不可信 Builder 输入，回退到当前受信 Standard 身份且绝不输出
  旧 GID；hosted inventory/read-back 工具保留旧 GID 仅用于明确拒绝 retired
  身份，旧 GID 不再作为 authority 或正向 fixture。
- 新 guarded 候选 `cart-transform-poc-dev-67`
  (`gid://shopify/Version/1061480300545`) 以
  `rust-hybrid-live-identity-candidate` 创建。staged Wasm 为 `108,602` bytes，
  SHA256 为
  `16c43cd42cbaeaafe0c5d9b580c491678702527e144432b6039df97c19dc86c6`。
- 本地与部署门禁通过：Function `443/443`、Rust `35/35`、Shared Core parity
  `4/4`、release budget、staged app build、production-clean 与 guarded
  integration/release safety 专项 `29/29`。
- Rust crate 已纳入 `Cargo.lock`，build/test/extension build 均使用 `--locked`。
  v67 激活前置检查必须从 live version read-back 精确匹配
  `gid://shopify/Version/1061480300545`，并匹配已批准的 Wasm size/SHA256；
  缺少 Version GID 或 artifact 漂移时 fail closed。
- activation 结果不明时强制执行一次幂等 v64 release；即使瞬时 read-back
  仍显示旧 v64 active，也不会短路 recovery，随后独立验证 v64 与 registration。
- 受控库存窗口 `v67-rust-hybrid-checkout-1`（checksum `731e6cfb`）只选择
  9 个精确 `0/0` 组件，以 CAS 打开到 `1/1`；父商品被排除，已有可售组件为
  no-action。
- v67 hosted Checkout 验收全部通过：
  - Builder Standard：Cart 单一父行，Checkout 展开 3 个当前 live 组件，
    subtotal/total `$750.48`。
  - pre-built 8：展开 8 个组件，subtotal/total `$989.99`。
  - pre-built 10：展开 10 个组件，subtotal/total `$1,409.99`。
  - pre-built 12：展开 12 个组件，subtotal/total `$1,739.99`。
  - 混合购物车：Builder 3 + pre-built 8 同时展开，保留两个父级分组，
    subtotal/total `$1,740.47`。
- 未填写 contact、delivery 或 payment 信息，未创建订单。测试购物车已清空。
- 同一库存窗口以 CAS 从精确 `1/1` 恢复到 `0/0`，9/9 read-back 通过。
- Huang 目视确认的正式 UAT 使用全新
  `v67-rust-hybrid-checkout-2`。原因是已消费的 `checkout-1` 幂等键重放时
  正确保持无库存变化；当前规划器同时拒绝 retired v66 window 和已消费的
  v67 `checkout-1`。新窗口再次通过 Builder 3、pre-built 8/10/12 与混合
  3+8 的相同金额验收。
- `checkout-2` restore 请求发送后遇到 `ECONNRESET`，未重试 mutation。
  随后的独立只读 Builder 与 catalog read-back 确认 9 个精确目标均已从
  `1/1` 恢复到 `0/0`。
- 最终 live read-back：
  - v64 `active`
  - v65、v66、v67 `inactive`
  - Cart Transform `gid://shopify/CartTransform/136675606`
  - Function `019f5e8c-0374-7577-b756-66af47a751be`
  - `allRegistrationsResolve=true`
- 正式店、Custom Distribution App、生产运行权、commit 和 push 均未触碰。
