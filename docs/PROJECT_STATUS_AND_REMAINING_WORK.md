# 项目进展与剩余工作

## 2026-07-20 Pre-built Checkout 当前状态

- `cart-transform-poc-dev-40` 是开发店当前活动且冻结的已知可用基线。
- Huang 已确认 `prebuilt-bundle-test` 在 Cart 中保持一个 `$100.00` 父行，并在 Checkout 展开 EFI、Fuel、Ignition 三个组件，总价仍为 `$100.00`。
- 该结果验证了 Cart Transform 绑定、expand 结构、组件 Variant 和价格分配，但当前基线仍是针对批准测试 SKU 的固定 projection；不能宣称通用动态 pre-built runtime 已完成。
- 完整 mapping/Snapshot Checkout 动态解析在版本 39 仍表现为 hosted no-op，已经回滚。后续不得用中间探针替换版本 40。
- 正确方向是把固定选择在发布阶段编译成紧凑的 ready-to-expand projection，让 Checkout Function 只做轻量校验与 expand 输出。
- 详细证据见 [`PREBUILT_CHECKOUT_EXPANSION_HANDOFF_2026-07-20.md`](./PREBUILT_CHECKOUT_EXPANSION_HANDOFF_2026-07-20.md)。

更新日期：2026-07-20。本文是项目状态摘要；架构约束与可执行规则以
[`Project_Master_Context_V5.4_Current_Baseline.md`](../Project_Master_Context_V5.4_Current_Baseline.md)
和 `AGENTS.md` 为准。

## 已完成且有证据的能力

| 工作流 | 当前状态 | 已验证证据 |
| --- | --- | --- |
| Option C Cart Transform 架构 | 已锁定 | Cart 保留 Master Kit 父行；Checkout/Orders 展开组件；库存扣减组件。 |
| Production Function | 已锁定为 hard-coded Shared Core | production-clean 断言持续通过。 |
| Runtime Snapshot V1 | 开发候选路径已实现 | 解析、验证、解析器、比较器、大小门槛和 hard-coded fallback 已有测试。 |
| Bundle Domain / Publication 模型 | 已完成本地契约 | Definition、Revision、Publication、CAS、补偿和审计模型均已实现并测试。 |
| Development Shopify persistence | 已实现 | 开发专用 Metaobject/Metafield adapter、compareDigest、read-back 与错误归一化。 |
| Bundle Admin 后端与 UI | 已完成本地 MVP | 草稿创建/复制/编辑、校验、编译预览、差异、历史和持久化确认。 |
| Bundle Config V1 受控编辑 | 本地批次完成 | Groups、Options、Presets、Rules 等现有实体的受控编辑、引用保护删除、复制和安全创建。 |
| App-server 可观测性 | 已完成本地支持 | `GET /healthz` 不依赖 Shopify 鉴权或数据。 |

## 当前工程边界

- 当前 Runtime authority 仍是 Production Function 的 hard-coded Shared Core。
- Runtime Snapshot 没有被开放为 Admin 直接编辑数据，也没有成为生产 authority。
- Bundle Admin 的“保存草稿”仅保存 Revision 文档；默认 UI 不提供发布动作。
- 发布和回滚路由存在于代码中用于契约覆盖，但默认 fail-closed：缺少任意一个服务端 gate 都返回 `422 UNSUPPORTED_CAPABILITY`，且不会写 Shopify。
- Custom Distribution App、生产资源、Cart Transform 注册、Builder、主题、产品、价格和库存均未在当前本地批次中修改。

## 开发发布演练的本地安全准备

- 已确认旧 Phase 4.4D 固定测试记录存在 pointer drift：Definition 的
  `active_revision_id` 为 `null`，而产品 `aces_dev.active_revision_id_v1`
  指向旧 Revision。这组三个固定 handle 仅可作为 adapter 历史验证记录，
  不能作为发布或回滚的输入。
- Publication Service 现在在任何 Snapshot 写入前预检外部 active pointer；若
  pointer 已漂移，操作以 `external_pointer_drift` 失败且不触发补偿写入。它仍在
  Snapshot read-back 后再次检查，以防止预检与 CAS 之间发生竞争。
- 新增本地-only rehearsal planner。它固定到开发 app/store/API 版本，但不调用
  Shopify CLI、没有 `apply` 模式，也不含 mutation。它只生成 Snapshot、完整 parity
  evidence、唯一记录 ID 和操作顺序。
- 未来经单独书面批准的开发演练必须使用
  `aces_dev.bundle_runtime_snapshot_publication_rehearsal_v1` 与
  `aces_dev.active_revision_id_publication_rehearsal_v1`。规划器明确拒绝主
  `bundle_runtime_snapshot_v1`、`active_revision_id_v1` 和旧
  `bundle_runtime_snapshot_test`，因此不会影响 Cart Transform 或已有测试数据。

## 2026-07-16 本地收尾更新

- 发布服务已增加 active pointer 预检：若 Shopify 外部指针与预期不一致，会在任何 Runtime Snapshot 写入前失败；Snapshot read-back 后仍会再次检查，避免预检与 CAS 之间的竞争窗口。
- 新增本地-only 的发布演练规划器。它只编译两个本地 Bundle Config V1 文档、生成 parity evidence 和隔离操作计划；不调用 Shopify CLI、没有 `apply` 模式、不能写 Shopify 数据。
- 演练规划器固定使用未来专用的 `aces_dev` rehearsal carriers，并拒绝当前 dev Snapshot、active pointer 和旧测试 key。
- 本地验证已通过：`npm test` 310 项、`npm run test:function` 232 项、Adapter focused tests 14 项，以及 lint、build、`validate:local`、production-clean 和 `git diff --check`。
- 本次未部署、未提交、未推送、未修改 Shopify 数据，也未触及 Cart Transform、Theme Extension、Builder、商品、价格或库存。

## 2026-07-17 本地生产准入收口

- 新增 production persistence readiness checker：仅检查本地证据 JSON，不连接 Shopify、不读取凭据、不产生写入。
- 检查器要求明确的书面授权、完整本地验证、生产资源隔离、恢复责任、parity evidence；P4 还要求 Browser、Order/Inventory 和 hard-coded rollback 回归证据。
- 检查器会拒绝 development token、Runtime Snapshot authority 切换和任何 Custom Distribution App 活动。
- 最新本地验证已通过：`npm test` 316 项、`npm run test:function` 232 项、focused readiness tests 6 项，以及 lint、build、`validate:local`、production-clean 和 `git diff --check`。

## 尚未完成的工作

### 当前执行顺序与工程估时

1. 通用 pre-built projection 编译、校验和轻量 Function：`3-5` 个工作日。
2. 将已实现的导入计划/恢复状态机接入 Bundle Admin 与开发持久化：`2-4` 个工作日。
3. 单产品系列的 Cart -> Checkout -> Order -> Inventory -> fulfillment -> rollback 验收：`2-3` 个工作日。
4. 生产资源、监控、Runbook、迁移和发布准入收口：`3-5` 个工作日，不含外部审批等待。

在 Shopify 访问、人工验收和业务确认无等待的前提下，开发店通用 MVP 预计还需 `5-8` 个工作日；受控生产试点预计还需 `10-15` 个工作日。全量生产上线还取决于生产资源批准、运行手册、库存/订单验收以及 Collective 需求定稿。

### 需要明确授权的开发店阶段

1. 对 development-only Metaobject 与 metafield 执行受保护的发布、read-back、CAS 冲突、补偿及回滚真实验证。
2. 对完整 Bundle Admin 本地累计批次进行一次真实 embedded Shopify Admin 回归：草稿编辑、保存、刷新、校验、编译预览、差异和只读审计。
3. 验证 `/healthz` 只作为服务就绪判断，不替代 Shopify 鉴权、业务健康或 Cart Transform 验证。

### 生产化设计与批准阶段

1. 批准生产 BundleDefinition、BundleRevision、PublicationRecord、Runtime Snapshot 和 active pointer 的资源方案、命名空间、访问控制和迁移策略。
2. 明确生产发布操作人、审计保留、告警、补偿责任和故障恢复 Runbook。
3. 完成生产环境 Browser -> Cart -> Checkout -> Order -> Inventory 回归计划。
4. 仅在上述证据齐全后，审议是否将生产 Runtime Snapshot 从 hard-coded Shared Core 提升为 authority。

生产持久化的候选 carrier、阶段、补偿规则、审计证据和进入条件见
[`PRODUCTION_PERSISTENCE_ROLLOUT_PROPOSAL_V5.5_DRAFT.md`](./PRODUCTION_PERSISTENCE_ROLLOUT_PROPOSAL_V5.5_DRAFT.md)。
该文档是设计草案，不是 Shopify 写入或 authority 切换授权。

## 仍刻意保留在 JSON 高级入口的内容

- Group/Option 新建：必须同时验证 Shopify 产品、Variant、SKU、组件角色和库存绑定，不能仅凭浏览器字段安全推断。
- 稳定 ID 修改：`group_key`、`option_key`、`preset_id`、`rule_id` 会影响引用完整性，因此受控界面不允许直接改写。
- 少见或未来扩展字段：必须由完整 JSON 文档、现有 validator 和 compile preview 共同验证。

## 本地优先工作方式

日常功能、测试和文档继续在本地累计。只有 Huang 明确要求时，才跨越以下外部边界：Git commit/push、Devbox/Sealos 发布、浏览器真实验证、Shopify 数据写入或 Shopify Function 部署。详细流程见
[`LOCAL_ADMIN_DEVELOPMENT.md`](./LOCAL_ADMIN_DEVELOPMENT.md) 和
[`SEALOS_DEVBOX_RELEASE_WORKFLOW.md`](./SEALOS_DEVBOX_RELEASE_WORKFLOW.md)。
