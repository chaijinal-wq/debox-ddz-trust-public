# Real-Money Release Gates

本项目可以做上线前测试，但不能在这些 gate 未完成前开放真实 BOX money room。

机器可读事实源：

```text
docs/release-gates.json
```

检查命令：

```bash
npm run release:gates
```

强制真实资金上线 gate：

```bash
npm run release:gates:enforce
```

`release:gates` 用来确认 gate 配置有效并列出阻塞项。`release:gates:enforce` 用于真实发布流程；只要还有任何 blocking gate 未完成，它就必须失败。

当前预期状态：

```text
launchAllowed = false
```

这不是坏事，而是安全边界：当前项目可以继续 mock/local prelaunch 测试、证据型 staging，以及 owner 批准范围内的受控小额真实 BOX pilot；但面向公开用户扩大真实 BOX 生产房必须被 gate 挡住。

## Controlled Real BOX Pilot Boundary

`REAL_BOX_PILOT_ENABLED=true` 只是小额试运行开关，不等于 release gate 放行。它的作用是把服务端房间、加入、准备锁定限制到配置的 pilot 档位和 `REAL_BOX_PILOT_MAXIMUM_LOCK`。

受控真实 BOX pilot 仍必须先完成：

- BSC escrow 部署。
- BSCScan/source/deployment readback evidence。
- `ESCROW_ADDRESS` 写入生产 env。
- DeBox App 内 approve/deposit/withdraw/claim 手机证据。
- 受控真实 BOX session 试局证据：初始锁定、`increaseSessionLock` 续局补锁、session-end settlement、同玩家地址退款/释放。
- owner 明确批准是否填入 relayer key，并单独批准受控真实链上提交：`REAL_BOX_TX_SUBMISSION_APPROVED=true`、`BSC_SETTLEMENT_SUBMITTER_ENABLED=true` 和 worker 同时打开；默认保持 `REAL_BOX_TX_SUBMISSION_APPROVED=false`。

即使受控 pilot 完成，`release:gates:enforce` 仍应失败，直到 `public-production-release-approval` 等公开生产 gate 完成。

## 必须完成的 Gate 类型

- Contract: 单元测试、集成测试、源码验证计划、部署记录、部署后 BSCScan/source/readback evidence。独立 Codex review 已归档；paid audit 保留为 post-v1。
- Verification: game-core/backend replay fixtures、玩家私有房间视图、DeBox App 内前端 money-flow acceptance。
- Security: strict production action auth、commit-before-ready shuffle、canonical game-core deal replay、HTTP/WS abuse limits。
- Trust packaging: architecture/money-flow docs、threat model、release verification checklist。
- Operations: deployment、rollback、relayer、support、emergency。v1 synthetic monitoring 已归档；更重值班和不可篡改审计进入 post-v1。
- DeBox: production credentials、wallet signature method、runtime diagnostics、open-access platform posture、share-entry behavior。
- Money Config: initial fee、fee cap、treasury address、announcement/effective-time behavior、support contact、admin key policy。
- Responsibility: 真实资金运营责任、用户风险/支持文案、地域/政策反馈的后续处理记录。

## 更新规则

任何会改变以下配置的改动，都必须走 OpenSpec 或等价 release 记录：

- fee rate
- fee cap
- treasury address
- stake presets
- multiplier cap
- supported token
- relayer address
- admin authority
- DeBox production integration behavior

更新 gate 状态时，必须同时更新 evidence 文件或审计记录。不能只把 `pending` 改成 `complete`。
