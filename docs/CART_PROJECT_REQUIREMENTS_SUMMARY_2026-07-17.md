# ACES Shopify Cart / Bundle Builder 需求整理稿

> 版本：2026-07-17；用途：用于项目沟通与后续验收，不替代 `Project_Master_Context_V5.4_Current_Baseline.md`（当前 SSOT）。
>
> 信息来源：V5.4 当前基线、当前代码/测试说明、`docs/JOSH_PROJECT_UPDATE_2026-07-16.md`。仓库中未找到其他可核验的 Josh 历史沟通记录；本稿不将未留存的口头结论视为已确认需求。

## 1. 项目目标

为 ACES 提供共享的 Shopify Bundle Engine，支持两种同等重要的购买入口：客户在专用 Builder 页面配置 Kit，或直接购买预定义 Bundle SKU。两种入口在购物车中均保持一个 Master Kit 父行；进入 Checkout 和 Order 后展开为组件行，并且仅扣减组件库存。

当前业务目标是先把 Bundle Admin 的草稿配置与受控发布能力在开发环境验证完整，再独立评审生产持久化与 Runtime Snapshot 是否可成为生产 authority。当前线上结账体验不得因本阶段工作改变。

## 2. 已确认的业务与架构需求

| 编号 | 需求 | 验收口径 |
| --- | --- | --- |
| R-01 | 支持两个客户购买入口：Bundle Builder 与 Pre-built Bundle SKU。 | Builder 使用专用模板并绕过原生 Dawn Add to Cart；预定义 Bundle SKU 使用正常商品加购路径；两者均产生单一 Master Kit 父行。 |
| R-02 | 每个 bundle 实例在 Cart 中只保留一条 Master Kit 父行。 | 同一实例不在 Cart 中预展开组件。 |
| R-03 | Checkout 与 Order 中展开组件行。 | 展开结果与所选 Bundle 配置一致。 |
| R-04 | 库存只扣减组件。 | Master Kit 不作为库存扣减对象。 |
| R-05 | 维持 Option C 架构。 | 不改变 R-01 至 R-04 的职责边界。 |
| R-06 | Bundle Metadata V1 必须持续兼容。 | 新增能力不得破坏既有元数据读取与展开。 |
| R-07 | `bundle_definition_id` 是稳定的 Bundle 定义 ID；`_bundle_id` 仅是每次加购实例 ID。 | 持久化编辑输入拒绝 legacy `bundle_id` 与 `_bundle_id`。 |
| R-08 | 父产品/Variant 绑定在首个 Revision 后不可变。 | 后续 Revision 不得改写该绑定。 |
| R-09 | 预定义 Bundle 可绑定至单一 Shopify SKU。 | 客户直接加入该 SKU 时，无需客户选择输入；Checkout/Order 按该 SKU 绑定的已发布组件配置展开。 |
| R-10 | 支持从现有付费应用迁移大量预定义 Bundle。 | 导入前可审阅映射与校验结果；提供逐条错误；执行可追踪、可恢复，且不静默重复或覆盖目标 Bundle。 |
| R-11 | 支持单店单产品系列的受控试点迁移。 | 仅批准范围内产品切换新 Bundle 流程；Cart、Checkout、Order、履约、库存、监控与回滚验收后，才扩大范围。 |

## 3. Bundle Admin 需求

### 3.1 草稿与版本管理

- 管理员可查看 Bundle 列表、详情和 Revision 历史。
- 可创建、克隆、编辑、校验、编译预览和比较 Draft Revision。
- `active_revision_id` 是 Definition 唯一生效指针；Revision 状态为 `draft`、`published`、`superseded`、`archived`，仅 `draft` 可编辑。
- 保存必须采用持久化读回确认；未读回到预期内容时，不得提示保存成功。
- 需要支持只读的发布审计历史。

### 3.2 Bundle Config V1 编辑体验

- 提供完整 JSON 高级编辑入口，覆盖整个 Bundle Config V1。
- 为已有 Groups、Options、Presets、Compatibility Rules、预设选择/锁定、规则条件与 fallback/展示字段提供受控表单编辑。
- 受控编辑只更新浏览器草稿；只有 `Save draft` 才能提交服务器。
- 对兼容但未在表单暴露的字段必须保留，避免局部编辑造成数据丢失。
- `group_key`、`option_key`、`preset_id`、`rule_id` 为稳定 ID，不允许在受控界面直接改写。
- 删除 Group/Option 前必须扫描所有引用；存在引用时拒绝删除，不能静默重写引用。
- 允许安全创建：Preset 默认 inactive；Compatibility Rule 以 active 默认选择生成 draft；允许克隆为 inactive/draft。
- 新增 Group/Option 与少见扩展字段仍走 JSON 编辑、校验和编译预览，直到产品/Variant/SKU/库存绑定流程获得单独验证。

### 3.3 Pre-built Bundle SKU 管理

- 运营人员可为一个预定义 Bundle 维护固定组件组合，并绑定一个 Shopify 父 Product/Variant（即客户购买的单一 SKU）。
- 同一父 Variant 只能绑定一个生效 BundleDefinition；绑定在首个 Revision 后保持不可变。
- 客户从普通商品路径加入该 SKU 时，不需要 Builder 选择属性；运行时以父 SKU 的已发布 Bundle 配置作为组件展开依据。

### 3.4 Bundle 导入与受控试点

- 需要能迁移当前付费应用中已有的大量预定义 Bundle（预期规模为数千条），并将每条源 Bundle 映射为目标父 SKU 与固定组件组合。
- 导入前必须可审阅映射、校验结果和逐条错误；导入执行必须可追踪、可恢复，且不得静默重复或覆盖已有目标 Bundle。
- 首次真实采用以一个获批店铺中的一个获批产品系列为受控试点；在该范围的购买、Checkout、Order、履约、库存、监控和回滚标准被接受前，不扩大迁移范围。

## 4. 发布、回滚与运行时需求

- 当前生产 Cart Transform authority 必须保持为 `extensions/master-kit-expand/src/run.core.js` 的 hard-coded Shared Core。
- 生产 Function 的 entry/query/artifact 不得出现 Snapshot、candidate、shadow 或 `aces_dev` token；每次获批部署前必须通过 production-clean assertion。
- Runtime Snapshot V1 仅为开发候选路径：解析、校验、解析结果、与 Shared Core 的精确 parity、无 unsupported fields 和无差异均满足时才可候选；任何失败必须回退 Shared Core。
- Snapshot 大小目标 `<= 7000` bytes，`> 7500` 警告，`> 9000` 拒绝。
- 发布/回滚默认 fail-closed：缺少服务器端 opt-in 或服务器自有 promotion evidence 任一条件，接口返回 `422 UNSUPPORTED_CAPABILITY`，且不得写 Shopify。
- 发布前后必须检查 external active-pointer drift；Snapshot 与 pointer 更新必须读回验证，使用 `compareDigest` 处理 metafield 并发冲突；失败必须按 Runbook 补偿并留存审计。
- Runtime Snapshot 不得作为 Admin 可直接编辑数据，也不得在未经单独批准时提升为生产 authority。
- 对 Pre-built Bundle SKU，组件解析输入是父 SKU 的已发布 Bundle 配置；对 Bundle Builder，组件解析输入包含客户所选组件/选项。两者必须保持相同的 Cart、Checkout、Order 与库存语义。
- 导入和试点需求定义迁移目标，不构成对源应用访问、Shopify 写入、部署或真实店铺切换的授权。

## 5. 环境与范围约束

- 当前唯一允许的开发 app：`cart-transform-poc-dev`；开发店：`huang-mvqquz1p.myshopify.com`。
- 开发持久化只能使用开发专用 Metaobject/Metafield：`$app:aces_*_dev` 与 `aces_dev.*`；不得使用生产 key。
- Custom Distribution App `cart-transform-poc`、生产资源、Cart Transform 注册、Theme、商品、价格和库存均不在当前本地批次范围内。
- 不得使用 `lineUpdate` 或运行时 `productVariantComponents`。
- `GET /healthz` 仅是无鉴权服务就绪探针，不可替代 Shopify 鉴权、业务健康或 Cart Transform 验证。

## 6. Josh 已确认口径（仓库可核验）

以下内容来自 `docs/JOSH_PROJECT_UPDATE_2026-07-16.md`，作为项目沟通目标，与上述技术约束一致：

1. 团队应拥有可查看 Bundle、编辑草稿、保存、检查错误和预览结果的 Admin 页面。
2. 常用 Bundle 设置应采用简单表单；高级设置仍应可编辑。
3. 当前 live checkout experience 不变。
4. 需防止过期变更覆盖较新的 Bundle 信息。
5. 后续先在 development store 完成 publish/rollback 测试，再准备独立的生产 rollout 计划；当前没有生产改动。

## 7. 当前交付状态与下一阶段验收

### 已具备（本地验证）

- Bundle Admin 草稿管理、受控编辑、持久化读回确认、预览/比较与只读审计。
- 开发专用持久化 adapter、CAS/读回、标准化错误及发布幂等模型。
- Runtime Snapshot 候选路径及 Shared Core 回退保护。
- 发布/回滚的 fail-closed 守卫、本地 rehearsal planner、生产准备度检查器。

### 尚未完成或未获授权

1. 2026-07-17 开发店隔离 rehearsal 曾因 Shopify CLI Admin API socket hang up 停在部分状态；不得自行重跑或补偿，需经评审的恢复操作。
2. 开发店中对受保护发布、补偿、回滚的真实读回/CAS 验证。
3. 对累计 Bundle Admin 工作进行真实 embedded Shopify Admin 回归：草稿编辑、保存、刷新、校验、编译预览、差异和只读审计。
4. 生产持久化资源、访问控制、迁移、监控、回滚责任和运行手册的单独批准。
5. Browser → Cart → Checkout → Order → Inventory 全链路回归通过后，才可单独讨论 Runtime Snapshot 生产 authority。

## 8. 发布准入条件

任何外部发布、Shopify 写入、浏览器真实验证、commit 或 push 均需明确批准。进入生产阶段前至少应具备：目标 app/store/API version/scopes 的只读确认、完整本地验证、生产/开发资源隔离、恢复负责人和 Runbook、Definition/Revision/Snapshot checksum 绑定的 parity evidence，以及需要时的全链路回归证据。

## 9. 明确不在本需求稿中确认的事项

- 未留存在仓库的 Josh 历史聊天结论。
- 生产 Metaobject/metafield 的最终名称、权限和所有权。
- 生产 Runtime Snapshot authority 切换时间与方案。
- 对 Custom Distribution App 的任何操作。

这些事项需要 Huang 的单独书面确认，并应纳入 V5.5 或更高版本 SSOT，而非直接修改本基线。
