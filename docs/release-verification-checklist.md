# Release Verification Checklist

本文用于准备 release candidate。它的目的不是让真实 BOX 上线自动放行，而是确保每次上线前测试都有同一套证据。真实资金开关仍以 `docs/release-gates.json` 和 `npm run release:gates:enforce` 为准。

测试方法和问题关闭标准见 `docs/testing-acceptance-playbook.md`。本清单只列命令和发布证据，不替代问题台账。

## Current Gate Posture - 2026-06-13

当前自动化验收状态以 `artifacts/audits/reorganized-acceptance-findings-20260613.md` 为准。

- 本地 release 验收当前已用新证据跑通：`frontend:acceptance` 147/147、`scripts:test` 60/60、80/10/10/20 browser soak、soak validator、runtime table readiness、State01 readiness、`release:gates` 和 `prelaunch:safe-checks`。
- `release:gates` 配置有效，但广泛公开 Real BOX 发布仍显示 `Real BOX launch allowed: NO`，因为人工 `public-production-release-approval` gate 仍为 pending。
- 旧 `system-auto-play-marker` 和 `played-multi-row-straight` PNG 不再是验收要求。托管出牌、顺子或其他多行出牌必须像普通出牌一样显示清晰的代码渲染牌面。
- 下方命令清单是 RC 复跑流程；不能用旧截图、旧 summary 或中断/HMR 污染过的 browser run 替代 fresh soak evidence。

## Local Evidence Commands

从仓库根目录运行：

```bash
npm run spec:validate
npm run security:audit:prod
npm run prelaunch:audit
npm run debox:share-guard
npm run typecheck
npm run build
npm test
npm run contract:check
npm run escrow:source-verification-bundle
npm run escrow:source-verification:preflight
npm run escrow:owner-approval-packet
npm run escrow:deployment-intent
npm run escrow:deployment-status
npm run escrow:bscscan:verify -- --help
npm run escrow:bscscan:verify -- --deployed-address <ESCROW_ADDRESS> --check-existing --env-file .secrets/bscscan.env
npm run escrow:deployment-evidence:validate -- artifacts/escrow-source-verification/deployment-verification-template.json --allow-template
npm run frontend:money-flow:evidence:prepare -- --help
npm run frontend:money-flow:evidence:template
npm run mobile:evidence:intake -- --help
npm run frontend:acceptance
npm run runtime-table:readiness:check
npm run frontend:browser-acceptance:launch
npm run frontend:browser-acceptance:soak
npm run frontend:browser-acceptance:soak:validate
npm run staging:readiness-report
npm run bsc:readiness:evidence -- --env-file .env
npm run bsc:readiness:evidence:validate
npm run bsc:relayer:evidence:template
npm run staging:handoff
npm run staging:package
npm run debox:evidence:prepare -- --help
npm run debox:evidence:prepare -- --operator "$USER" --frontend-url https://game.albertchai.click --backend-url https://game.albertchai.click
npm run debox:evidence:template
npm run release:evidence-consistency
npm run vps:deployment:evidence:validate
npm run prelaunch:safe-checks -- --base-url https://game.albertchai.click
npm run release:gates
```

预期：

- OpenSpec 全量通过。
- Production dependency audit 生成 `artifacts/security/dependency-audit-prod.json`，并确认 production/runtime 依赖漏洞为 0。
- Prelaunch completion audit 生成 `artifacts/prelaunch/prelaunch-completion-audit.json` 和 `.md`，列出 active changes、关键 artifact、pending gates 和真实资金阻塞状态。
- TypeScript typecheck 通过。
- 所有 workspace build 通过。
- server/game-core/frontend/relayer tests 通过。
- escrow contract check 和 unit tests 通过。
- Escrow source verification bundle 生成 BSCScan standard-json-input、ABI、constructor args 编码和 compiler/hash 记录；它不代表已经部署或完成 BSCScan 验证。
- Escrow source verification preflight 通过，说明 source bundle、standard-json-input、constructor args、deployment template、approved money params 和 release gates 在部署前一致；它不部署、不签名、不完成 `source-verification-plan` gate。
- Owner deployment approval packet 生成并标记 ready，说明 owner 可以用同一份 freeze/hash/constructor 输入做部署前人工核对；它不部署、不签名、不启用真实资金。
- Escrow deployment intent 生成 no-sign/no-send 的 creation data、hash、BSCScan 字段、RPC 只读 nonce/gas/expected-address 摘要和本地钱包部署页；它不部署、不签名、不提交交易。
- Escrow deployment status 生成只读链上侦测结果，显示 owner/deployer nonce、预期地址是否有 code，以及部署后 owner/relayer/treasury/fee readback；它不替代 tx hash/receipt evidence。
- BSCScan/Etherscan v2 verification helper 可用；部署前只跑 `--help` 或 dry-run，部署后再用 `--submit --poll` 写入 `artifacts/escrow-source-verification/bscscan-verification-latest.json`。
- Escrow deployment verification template 通过 placeholder 模式校验；部署后必须用真实合约地址、deployment tx、BSCScan URL 和链上 readback 填写，再去掉 `--allow-template` 校验。
- 部署后可用 `npm run escrow:deployment-evidence:collect -- --env-file .env --deployed-address <addr> --deployment-tx-hash <tx> --bscscan-url <url> --etherscan-v2-verification artifacts/escrow-source-verification/bscscan-verification-latest.json --validate` 只读采集 receipt、tx input、deployed bytecode 和链上 readback。该命令不部署、不签名、不转账；`--bscscan-verified` 仅保留为人工 fallback。
- Frontend money-flow evidence preparer 可生成 DeBox App 真机截图/evidence bundle 对应的 filled JSON；`--mark-verified` 只在所有 artifact 已人工确认后使用。
- Mobile frontend money-flow draft/gap analysis 已归档，说明哪些 DeBox App 截图已覆盖、哪些仍需复测后才能 `--mark-verified`。
- frontend jsdom acceptance 通过。
- 斗地主局内 runtime table readiness 通过：`npm run runtime-table:readiness:check` 会重新 build、跑前端 acceptance、用 production preview 刷新 18-state 局内截图矩阵（进入/发牌、叫分、地主确认、底牌、未选牌、提示选牌、无效选择、要不起、不出、左右玩家出牌/不出、倒计时、托管实际出牌、重连、结算），并校验现有 Web App 能用 realtime `room_snapshot` 从进入牌桌完整跑到结算/继续/返回房间；同时拒绝默认 Web build 回流 AI full-screen preview、state01 source-master 大整图或旧 54 张 PNG 牌面。
- Playwright launch browser acceptance 通过：移动端至少 50 局完整牌局，并专项覆盖同房间下一局、农民胜和三独立浏览器 UI 三人局，同时生成桌面/手机/admin 截图。正式 RC 前追加 soak：80 局移动端完整路径、10 局同房间续局、10 个农民胜利目标、20 局三浏览器 UI。
- Staging readiness report 生成，明确 real BOX launch 仍由 release gates 控制。
- BSC read-only readiness evidence 生成并通过 `npm run bsc:readiness:evidence:validate`，且只包含 safe RPC label、链 id、区块高度、relayer gas、pending nonce 和 BOX token code 状态；它不代表 controlled lock/settlement tx 已完成。
- 部署和受控 lock + settlement tx 完成后，可用 `npm run bsc:relayer:evidence:collect -- --env-file .env --lock-tx-hash <lock-tx> --session-lock-request <lock-request-json> --tx-hash <settlement-tx> --settlement-request <settlement-request-json> --single-worker-confirmed --validate` 只读采集 receipt、decoded `SessionLocked` / `SessionSettled` events 和 reconciliation。该命令不签名、不提交交易、不转账。
- Staging operator handoff 生成，列出明天 VPS/DeBox 真机采证需要的输入、命令顺序和仍 pending 的 release gates。
- Staging release package 生成，包含部署到 VPS 所需的已构建 runtime artifacts、ops 模板和 manifest；它不包含 `.env` 或真实 secret。
- DeBox runtime evidence preparer 支持草稿模式，以及 `--copy-artifacts --mark-verified --validate` 的真机证据归档模式；`--mark-verified` 仍保持 `realBoxLaunchAllowed=false`。
- DeBox runtime evidence skeleton 可以生成并用 placeholder 模式通过结构校验；它不代表 DeBox 真机 evidence 已完成。
- DeBox runtime evidence 模板通过结构校验；真实 evidence 文件需用 `npm run debox:evidence:validate -- <path>` 另行校验。
- DeBox App frontend money-flow evidence 模板通过结构校验；真实 evidence 文件需用 `npm run frontend:money-flow:evidence:validate -- <path>` 另行校验。
- BSC relayer tx evidence 模板通过结构校验；真实 controlled lock/settlement evidence 需用 `npm run bsc:relayer:evidence:validate -- <path>` 另行校验。
- Release evidence consistency 通过，说明 release gates evidence 路径存在、staging manifest pending gates 与 release gates 一致、staging package 包含关键证据工具/模板，且最新 monitor 仍保持 DeBox-only share 和 `realBoxLaunchAllowed=false`。
- VPS deployment evidence validator 通过，说明最近一次 VPS staging deployment 证据 secret-safe、远端 smoke/monitor/package-only checks 全通过、relayer disabled、真实 BOX 仍 blocked。
- Prelaunch safe checks 通过，说明 release/evidence/template 检查和 staging smoke/monitor 可以一键复跑；其中 `release:gates:enforce` 预期仍以 exit 2 阻止真实 BOX。
- `release:gates` 配置有效，且真实 BOX public launch 仍显示 blocked，除非所有生产 gate 都有证据并完成 `public-production-release-approval`。

## Staging Smoke

VPS 部署后运行：

```bash
SUPPORT_ADMIN_TOKEN=<support-admin-token> npm run staging:smoke -- --base-url https://game.albertchai.click
SUPPORT_ADMIN_TOKEN=<support-admin-token> npm run staging:monitor -- --base-url https://game.albertchai.click --require-admin-status --max-delayed-settlements 0 --max-manual-review-rooms 0 --max-system-exception-rooms 0
npm run prelaunch:safe-checks -- --base-url https://game.albertchai.click
```

预期：

- HTTPS 首页返回前端静态包。
- `/api/health` OK。
- `/api/debox/diagnostics` 显示 DeBox credentials 已配置且 secret redacted。
- `/api/debox/group?gid=vx49nx5b` OK。
- `/ws/rooms` 能 ping/pong。
- `/api/admin/operations/status` 在 token 下返回 credential-safe 状态。
- `release:gates` 仍显示 `Real BOX launch allowed: NO`，直到所有真实上线 gate 和外部公开生产签字完成。

## Browser Acceptance Artifacts

`npm run runtime-table:readiness:check` 会写入：

```text
artifacts/prelaunch/ddz-runtime-table-readiness-latest.json
artifacts/browser-acceptance/ddz-runtime-table-app-20260608/summary.json
artifacts/browser-acceptance/ddz-runtime-table-app-20260608/runtime-entering.png
artifacts/browser-acceptance/ddz-runtime-table-app-20260608/runtime-bidding.png
artifacts/browser-acceptance/ddz-runtime-table-app-20260608/runtime-bidding-score-history.png
artifacts/browser-acceptance/ddz-runtime-table-app-20260608/runtime-landlord-confirmed.png
artifacts/browser-acceptance/ddz-runtime-table-app-20260608/runtime-playing-unselected.png
artifacts/browser-acceptance/ddz-runtime-table-app-20260608/runtime-playing-selected.png
artifacts/browser-acceptance/ddz-runtime-table-app-20260608/runtime-playing-invalid-selected.png
artifacts/browser-acceptance/ddz-runtime-table-app-20260608/runtime-cannot-beat.png
artifacts/browser-acceptance/ddz-runtime-table-app-20260608/runtime-self-pass.png
artifacts/browser-acceptance/ddz-runtime-table-app-20260608/runtime-left-player-play.png
artifacts/browser-acceptance/ddz-runtime-table-app-20260608/runtime-right-player-play.png
artifacts/browser-acceptance/ddz-runtime-table-app-20260608/runtime-left-pass.png
artifacts/browser-acceptance/ddz-runtime-table-app-20260608/runtime-right-pass.png
artifacts/browser-acceptance/ddz-runtime-table-app-20260608/runtime-timer-normal.png
artifacts/browser-acceptance/ddz-runtime-table-app-20260608/runtime-timer-warning.png
artifacts/browser-acceptance/ddz-runtime-table-app-20260608/runtime-trustee-system-auto.png
artifacts/browser-acceptance/ddz-runtime-table-app-20260608/runtime-reconnect.png
artifacts/browser-acceptance/ddz-runtime-table-app-20260608/runtime-settlement.png
```

这些 runtime table evidence 必须证明：默认 Web 页面接入 `DdzRuntimeTable`，保留 `ddzRuntimeTable=legacy` 回滚开关；单会话 App acceptance 覆盖进入牌桌、发牌/叫分、地主确认、出牌/不出/提示、托管实际出牌、结算、继续、返回房间；18-state 截图矩阵覆盖叫分、底牌揭示、地主拿底、未选/已选/无效选择/要不起、左右对手出牌/不出、普通/警告倒计时、托管状态下实际出牌、重连 modal/toast 和结算；截图来自 production preview；牌面、按钮文字、倒计时、结算数字均由代码渲染；默认生产 build 不包含 AI full-screen preview、state01 source-master 大整图、imagegen clean felt、旧 54 张 PNG 牌面、托管占位 PNG 或多行出牌专用 PNG。`runtime-trustee-system-auto.png` 是历史场景文件名，当前验收含义是“托管状态下显示实际出牌”，不是要求出现 `系统代出` 视觉标记。

`npm run frontend:browser-acceptance:launch` 会写入：

```text
artifacts/browser-acceptance/desktop-money-flow.png
artifacts/browser-acceptance/mobile-money-flow.png
artifacts/browser-acceptance/desktop-admin-support.png
artifacts/browser-acceptance/mobile-full-game-50-rounds-summary.json
artifacts/browser-acceptance/mobile-same-room-next-round-5-rounds-summary.json
artifacts/browser-acceptance/mobile-farmer-win-5-rounds-summary.json
artifacts/browser-acceptance/mobile-three-browser-20-rounds-summary.json
```

`npm run frontend:browser-acceptance:soak` 会写入更强验收：

```text
artifacts/browser-acceptance/mobile-full-game-80-rounds-summary.json
artifacts/browser-acceptance/mobile-same-room-next-round-10-rounds-summary.json
artifacts/browser-acceptance/mobile-farmer-win-10-rounds-summary.json
artifacts/browser-acceptance/mobile-three-browser-20-rounds-summary.json
```

这些 browser summary 必须包含 provenance（git head、dirty 状态、命令、脚本 sha256、Node 版本）和每局结算不变量检查（赢家身份、倍数范围、余额非负、balanceDeltas 守恒、finalBalances 与 delta 匹配）。

`npm run frontend:browser-acceptance:soak:validate` 会拒绝不达标的证据：少于 80 局完整移动端路径、少于 10 局同房续局、少于 10 个农民胜利目标、少于 20 局三独立浏览器三人 UI、缺少结果不变量或赢家类型过窄，都会失败。

`npm run staging:readiness-report` 会写入：

```text
artifacts/staging-readiness/staging-readiness-report.md
artifacts/staging-readiness/staging-operator-handoff.md
artifacts/staging-release/manifest.json
artifacts/staging-release/debox-ddz-staging-release.tar.gz
artifacts/security/dependency-audit-prod.json
artifacts/prelaunch/prelaunch-completion-audit.json
artifacts/prelaunch/prelaunch-completion-audit.md
artifacts/prelaunch/prelaunch-safe-checks-latest.json
artifacts/prelaunch/prelaunch-safe-checks-latest.md
artifacts/frontend-money-flow-acceptance/mobile-20260530-draft.json
artifacts/frontend-money-flow-acceptance/mobile-20260530-gap-analysis.md
artifacts/staging-release/vps-deployment-20260530T191730Z.json
artifacts/staging-release/vps-deployment-20260530T191730Z.md
artifacts/escrow-source-verification/source-verification-bundle.json
artifacts/escrow-source-verification/standard-json-input.json
artifacts/escrow-source-verification/constructor-args.json
artifacts/escrow-source-verification/deployment-verification-template.json
artifacts/escrow-source-verification/source-verification-preflight-latest.json
artifacts/escrow-source-verification/source-verification-preflight-latest.md
artifacts/escrow-source-verification/owner-deployment-approval-packet-latest.json
artifacts/escrow-source-verification/owner-deployment-approval-packet-latest.md
artifacts/escrow-source-verification/deployment-intent-latest.json
artifacts/escrow-source-verification/deployment-intent-latest.md
artifacts/escrow-source-verification/deployment-intent/creation-data.txt
artifacts/escrow-source-verification/deployment-intent/deploy-with-wallet.html
artifacts/escrow-source-verification/deployment-status-latest.json
artifacts/escrow-source-verification/deployment-status-latest.md
```

检查重点：

- 大厅、房间、牌桌、结算、admin/support 页面关键文案可见。
- settlement choice、kicked/exited、manual_review、support contact copy 不被遮挡。
- 手机宽度无横向 overflow。
- 页面明确区分 mock/local 证据和真实 DeBox 生产证据。

## Real BOX Gate Evidence

真实 BOX 房间上线前，以下 gate 不能只改状态，必须补证据文件、截图、链接或审计记录。

### DeBox

- Developer App、App key / API Key、App Secret、HTTPS 前端 URL、后端 URL、bot/sender identity；App ID 仅在 endpoint 明确要求 `app_id` 时作为可选兼容项归档。
- `window.deboxWallet` + `debox_getUserInfo` 真机字段截图。
- `eth_signTypedData_v4` 真机无资金诊断签名弹窗、signed-action payload 字段、payload hash、签名状态和返回证据。
- 房间 read/realtime viewer binding 方案。
- DeBox App 内 runtime diagnostics 截图或日志，包括 OpenAPI signed readiness 和 secret-safe evidence bundle。
- 页面“分享房间”面板、DeBox 原生分享选择/结果截图，并能关联同一个 `roomId`；Bot 群消息 fallback 只作为运营证据补充。
- 填写并通过校验的 runtime evidence JSON，格式见 `docs/debox-runtime-evidence-runbook.md`。
- DeBox 开放接入口径 evidence；若平台后续提出具体限制，再归档反馈和处理记录。

### Contract

- Frozen Solidity source、ABI、bytecode、compiler version、optimizer settings、constructor args。
- BSCScan source verification URL。
- Deployment tx hash、deployed address、BSCScan verified contract URL。
- 填写并通过 `npm run escrow:deployment-evidence:validate -- <filled-json>` 的 deployment verification evidence。
- Independent Codex review notes、v1 trusted-relayer acceptance 和 post-v1 paid-audit/backlog 记录。
- feeRateMax、treasury、owner、relayer、emergency key policy。当前 v1 部署准备值为 `feeRateMaxBps=500`、`treasury=0x7b8d2f544672289b270da23dc4adbd3dd2d74b27`、`relayer=0xa9bad0c91e5d60087ec8f99b0832cd3e58470da1`、`ownerEmergency=0x280b32cacf134355638384ed701d41ec50ea5e79`；v1 classic admin/key policy 已接受，更重 custody 升级进入 post-v1 backlog。

### Relayer

- 真实 BSC RPC primary/fallback 配置。
- RPC provider safe labels，不包含 token、apikey 或 private URL。
- 私钥托管和轮换方式。
- nonce reservation evidence；多 worker 上线前必须有持久化或托管 nonce manager。
- BNB gas 余额告警。
- submit tx、poll receipt、decode settlement event、reconcile backend evidence 的集成测试。
- pending/revert/RPC/gas/nonce/reconciliation/missing_evidence 失败进入 retry/manual_review 的证据。
- 重复 settlementId/nonce 不重复提交的证据。
- 真实 BSC receipts 中 `SessionLocked` 和 `SessionSettled` events 能解码并分别与 backend lock/settlement evidence 匹配的证据。
- 填写并通过 `npm run bsc:relayer:evidence:validate -- <filled-json>` 的 BSC relayer evidence。

### Operations And Support

- Production support group/contact 已在玩家状态中可见。
- Settlement delay、manual_review count、RPC failure、relayer gas、system_exception monitor evidence。更重 pager/值班体系为 post-v1 upgrade。
- Admin/support RBAC 和 key policy。
- Audit log retention 和 tamper-resistance 方案。
- Owner-only fund-affecting 操作流程。

## Release Candidate Notes

每次 release candidate 至少记录：

```text
date:
git ref:
change/spec ids:
commands run:
browser artifact paths:
release gate output:
known blockers:
owner approval:
real chain tx approval switch: REAL_BOX_TX_SUBMISSION_APPROVED=false until separately approved
```

如果 release 只用于本地或封闭测试，可以明确写：

```text
Real BOX launch remains blocked. This release is for local/mock or controlled prelaunch testing only.
```
