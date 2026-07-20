# Production Persistence Rollout Proposal V5.5 Draft

状态：本地设计草案，非 SSOT，非发布授权，禁止据此直接创建 Shopify 资源。

本文把已经实现的 Bundle Domain、Publication Service 和 development-only
adapter 约束整理为生产上线候选方案。执行时必须以届时 Shopify API 文档、实际
production app 身份、权限和书面授权重新核对。

## 1. 上线目标与非目标

目标：为 BundleDefinition、BundleRevision、PublicationRecord、Runtime Snapshot
和 `active_revision_id` 建立可审计、可补偿的生产持久化路径。

非目标：

- 本阶段不改变 Option C、Builder、Cart、Checkout、Order 或库存行为。
- 本阶段不自动将 Runtime Snapshot 提升为 Cart Transform authority。
- 本阶段不把 Runtime Snapshot 暴露为可编辑 Admin 数据。
- 本阶段不替代现有 hard-coded Shared Core；该结果保持生产 fallback。

## 2. 候选生产存储边界

| 领域记录 | 候选生产 carrier | 并发与验证边界 |
| --- | --- | --- |
| BundleDefinition | production app-owned Metaobject，单个 `document` JSON 字段 | 乐观读/写/读回；不能假设 Metaobject CAS。 |
| BundleRevision | production app-owned Metaobject，单个 `document` JSON 字段 | 已发布、superseded、archived Revision 不可修改。 |
| PublicationRecord | production app-owned Metaobject，以 `publication_id` 为 handle | handle 幂等查找；不同内容重试必须拒绝。 |
| Runtime Snapshot V1 | 父产品的 production app-owned JSON metafield | `metafieldsSet.compareDigest` + checksum/version 读回。 |
| `active_revision_id` | 同一父产品的 production app-owned text metafield | `metafieldsSet.compareDigest` + 指针读回。 |

生产 namespace、Metaobject type、metafield key、definition access 与 app owner
必须在执行前单独命名和批准。不得复用 `aces_dev`、`$app:aces_*_dev` 或任何开发
资源名称。

## 3. 不可省略的安全条件

1. 生产 app 身份、店铺、API version 和 scopes 必须在只读调用中确认。
2. Production Function entry/query/artifact 必须继续通过
   `npm run assert:function:production-clean`。
3. 发布目标必须是已验证的 draft Revision；`bundle_definition_id` 与 `_bundle_id`
   必须继续严格分离。
4. Snapshot 必须通过当前大小策略：目标 `<= 7000` bytes，警告 `> 7500` bytes，
   硬拒绝 `> 9000` bytes。
5. Promotion evidence 必须绑定确切的 definition、revision 和 Snapshot checksum，
   并证明无差异、无 unsupported fields。
6. 每次写入必须有稳定 `publication_id`、精确确认字符串、read-back 证据和
   PublicationRecord。
7. 执行人必须能在写入前识别上一个 active revision、上一个 Snapshot checksum
   和可恢复的前一个 Snapshot。

## 4. 建议的分阶段上线

### Stage P0: production readiness review（只读）

- 审核 production app 与 development app 的 Client ID、资源所有权和 scopes。
- 核对资源定义、metafield type、访问控制、payload 限制和 `compareDigest` 行为。
- 运行完整本地验证及 production-clean；不创建资源，不写数据。

退出条件：形成带时间戳的只读证据，且没有 dev key、dev type 或 Custom Distribution
App 混入。

### Stage P1: production carrier provisioning（受控写入）

- 只创建获批的 production Metaobject/metafield definitions。
- 读取并记录 definition ID、field schema、access、namespace/key 与 API version。
- 不写 Runtime Snapshot，不改 active pointer，不部署 Function。

退出条件：定义与批准清单完全匹配；未发生业务配置或 Cart Transform 变化。

### Stage P2: data migration rehearsal（受控写入）

- 将已验证的 hard-coded 配置导入为 BundleDefinition 和不可变 Revision 记录。
- 先建立可恢复的基线 Snapshot，再允许任何需要补偿的发布操作。
- 每一项创建/更新均执行读回、checksum/version 对比和幂等重试验证。

退出条件：生产记录完整，但 Production Function authority 仍为 hard-coded Shared Core。

### Stage P3: guarded publication validation（受控写入）

- 只针对明确批准的单个 BundleDefinition 执行完整 staged publication。
- 验证 Snapshot write/read-back、active pointer CAS、Revision lifecycle、审计记录和
  至少一个 CAS 冲突。
- 验证故障路径的补偿成功与补偿失败告警；不得以“未报错”替代证据。

退出条件：发布和回滚 Runbook 都有可复现的证据；仍不切换 Function authority。

### Stage P4: Runtime Snapshot authority decision（单独审批）

- 在开发店先验证候选 authority 的 Browser -> Cart -> Checkout 行为。
- 只有在 promotion parity、发布审计、补偿、Checkout 金额和库存回归都被接受后，
  才讨论生产 authority 切换。
- 切换必须保留明确的 hard-coded Function 回退版本和恢复步骤。

## 5. 发布与补偿 Runbook 要点

正常路径：

1. 读取 Definition、当前 active pointer 和当前 Snapshot checksum。
2. 验证/编译 draft，并校验 Snapshot 大小与 promotion evidence。
3. 以 expected checksum 写 Snapshot；读回 checksum/version。
4. 以 expected pointer 更新 `active_revision_id`；读回指针。
5. 将新 Revision 标为 published、前一个 active Revision 标为 superseded。
6. 写入幂等 PublicationRecord，并返回完整步骤和 warnings。

失败处理：

| 失败点 | 必须动作 |
| --- | --- |
| Snapshot 写入或读回失败 | 指针不得变更；记录失败与外部状态。 |
| active pointer CAS 失败 | 不假定成功；读回外部状态，必要时恢复 Snapshot。 |
| Revision lifecycle 写入失败 | 读回 pointer/Snapshot，执行已定义的补偿并记录结果。 |
| PublicationRecord 写入失败 | 不静默成功；记录 audit failure，并在可行时补偿。 |
| 无法恢复缺失的旧 Snapshot | 停止并标记 `UNSUPPORTED_CAPABILITY`；不得继续切换 authority。 |

Shopify 不提供跨 Metaobject 与 metafield 的事务，也不应假设 Metaobject 有
`compareDigest` 等价物。因此 read-back 和补偿不是可选项。

## 6. 证据、监控与责任

每次获批的生产操作至少保留：

- 目标 app/store/API version/scopes 的只读确认；
- Definition、Revision、publication ID、操作者和时间；
- 前后 active pointer、前后 Snapshot checksum、Snapshot configuration version；
- promotion evidence checksum 与 fixture set identity；
- 完成步骤、失败步骤、compensation 结果和最终读回状态；
- Browser -> Cart -> Checkout -> Order -> Inventory 回归记录（适用时）。

责任分离：工程执行发布程序；业务负责人批准目标 Revision 与回归结果；任何 authority
切换由 Huang 单独授权。出现 pointer drift、checksum mismatch、read-back mismatch 或
compensation failure 时，停止后续发布并保留原始证据。

## 7. 进入执行前的批准清单

- [ ] Huang 明确授权目标阶段（P0/P1/P2/P3/P4）和目标 app/store。
- [ ] 已确认不涉及 Custom Distribution App，除非授权明确写出该 app。
- [ ] 已确认 production definition/type/key 命名，且与 `aces_dev` 完全隔离。
- [ ] 已确认所需 scopes、负责人、维护窗口和恢复负责人。
- [ ] 已运行完整本地验证和 production-clean。
- [ ] 已准备上一版本 Function、Snapshot 与 active pointer 的恢复证据。

未满足任一项时，保持 hard-coded Shared Core authority，不执行 Shopify 写入。

## 8. 本地准入检查器

在任何未来生产阶段开始前，使用
[`PRODUCTION_PERSISTENCE_READINESS_EVIDENCE_V1.md`](./PRODUCTION_PERSISTENCE_READINESS_EVIDENCE_V1.md)
中定义的本地检查器审查证据包。该检查器不会连接 Shopify，也不会产生写入；它仅拒绝
不完整的批准、验证、资源隔离、恢复或 parity 证据。

检查器不是授权替代品。通过检查后，仍必须获得对应 P 阶段的单独书面授权，并在真实
环境中执行只读确认、写后读回和浏览器回归。
