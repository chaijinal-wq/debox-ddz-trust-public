# BSC 托管和清算流程

第一版只支持 BSC。

## 链和资产

```text
chainId: 56
chainId hex: 0x38
network: BNB Smart Chain
```

第一版只支持 BOX：

```text
BOX-BSC: 0x6386adc4bc9c21984e34fd916bb349dd861742af
```

BOX 按 18 decimals 处理。

## Gas 原则

```text
充值/锁仓 deposit gas：玩家自己出
Session 结束清算 gas：平台出
提现清算 gas：平台出
后台重试 gas：平台出
```

平台通过盈利手续费覆盖结算 gas、服务器和维护成本。

## 手续费

手续费只在 Session 结束时计算。

```text
profit = finalBalance - sessionStartBalance
fee = max(profit, 0) * feeRate
netBalance = finalBalance - fee
```

规则：

- 亏损者不收费。
- 持平者不收费。
- 只对净盈利部分收费。
- 手续费率由平台配置。
- 已开始的 Session 不受后续手续费率变化影响。
- 合约层应设置手续费率上限。

待冻结参数：

```text
FEE_RATE = 0.1%
FEE_RATE_MAX = 待定
FEE_TREASURY = 待配置
```

## 合约账户模型

推荐合约采用内部余额模型，而不是每个 Session 都把所有人的钱转回钱包。

资金状态：

```text
availableBalance[user][asset]  房间可用余额
lockedBalance[session][user]   Session 锁定余额
pendingWithdraw[user][asset]   提现清算中
```

核心动作：

```text
deposit(asset, amount)
lockForSession(sessionId, players, amounts)
settleSession(sessionId, finalBalances, fees, withdrawFlags, transcriptHash)
withdrawToWallet(user, asset, amount)
```

其中 `settleSession` 由平台 relayer 提交，平台支付 gas。

## 入金流程

```text
用户进入房间
-> 使用 BOX
-> 检查 BSC
-> approve token 给 escrow
-> deposit 到 escrow
-> 合约记录 availableBalance
-> 前端显示房间余额
```

玩家承担 approve/deposit 的 gas。

## 开始 Session

```text
三名玩家在同一房间
-> 资产为 BOX
-> 房间余额满足最低锁定金额
-> 三人准备
-> 后台创建 sessionId
-> 合约或后台锁定三人本 Session 起始余额
-> 开始发牌
```

MVP 为了简单，建议 Session 开始时锁定三人的全部房间余额。

后续版本可支持只锁定部分余额。

## 每局结算

每局结束只更新后台账本：

```text
tableBalance += roundDelta
```

不触发链上交易。

每局必须生成 Round transcript。

## Session 结束

触发 Session 结束后：

```text
冻结当前 Session
生成最终余额
计算盈利手续费
生成 settlementNonce / transcriptHash
链上按完整 payload 计算 settlementId
生成 transcriptHash
生成清算任务
```

留下玩家：

```text
netBalance -> availableBalance
```

离开、被踢、掉线被清出玩家：

```text
netBalance -> pendingWithdrawal -> 用户自助 claim 或 relayer 代释放到钱包
```

## 后台清算窗口

清算发起后，前台不等待。

后台默认等待窗口：

```text
5 分钟
```

用途：

- 给用户看到结算状态。
- 给系统收集最后的确认和反馈。
- 避免瞬时网络状态导致错误体验。

没有反馈或异常时，清算任务自动提交链上交易。

## 链上提交

relayer 提交：

```text
settleSession(
  sessionId,
  settlementId,
  settlementNonce,
  finalBalances,
  fees,
  withdrawFlags,
  transcriptHash,
  settlementFeeRateBps
)
```

合约检查：

- Session 存在。
- Session 未结算。
- `settlementId` 必须等于链上 `computeSettlementId(...)` 对 session、players、lockedBalances、finalBalances、fees、withdrawFlags、transcriptHash、chainId、contract address 和 fee rate 的 digest。
- `settlementNonce` 未使用过。
- 三人 `finalBalances` 总额等于 Session 锁定总额。
- 手续费不超过盈利部分。
- 手续费率不超过上限。
- `netBalance = finalBalance - fee`。
- `sum(netBalance) + sum(fee)` 等于 Session 锁定总额。

提交后：

- 留桌资金转入 availableBalance。
- 提现资金进入 `pendingWithdrawal`，用户可自助 `claimPendingWithdrawal`，relayer/owner 也可代释放。
- 手续费转入 feeTreasury，且 BOX 实收必须等于应转金额。
- 事件写入 transcriptHash。

用户可随时 `withdrawAvailable` 提出闲置 availableBalance。`Locked` 或 `ManualReview` Session 超过链上退款延迟后，可调用 `refundExpiredSession` 退回锁定余额到 availableBalance，避免人工处理无限卡死。

## 失败和重试

可能失败原因：

- BSC RPC 抖动。
- relayer BNB 不足。
- gas 过低。
- 交易 pending 太久。
- 合约检查失败。
- token transfer 异常。

后台处理：

```text
自动重试
多 RPC 兜底
提高 gas 重发
多次失败进入 MANUAL_REVIEW
通知用户人工处理中
```

用户提示：

```text
资金清算中，通常 5 分钟内到账。
如果超过 5 分钟仍未到账，请联系客服，并提供结算单号。
```

## 开源可验证

每次 Session 结算必须公开或可导出：

- sessionId
- roomId
- asset
- players
- sessionStartBalances
- round transcript hashes
- finalBalances
- fees
- withdrawFlags
- transcriptHash
- settle transaction hash
